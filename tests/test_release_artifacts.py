import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
import zipfile


SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), SCRIPTS / (name + '.py'))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


pack = module('prepare-release-artifacts')
installer = module('install-release-clt')


def json_file(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf-8')


def hap(path, version='0.1.0', private=False):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('module.json', json.dumps({'app': {'versionName': version, 'versionCode': 20005,
            'bundleName': 'com.lantern.toeic', 'buildMode': 'debug', 'compileSdkType': 'HarmonyOS',
            'compileSdkVersion': '6.1.0.26-fixture', 'minAPIVersion': 50000012, 'targetAPIVersion': 50000012}}))
        z.writestr('ets/modules.abc', b'compiled-native-fixture')
        if private:
            z.writestr('signing/profile.p7b', b'must-not-publish')


def add_external_block(path):
    original = path.read_bytes()
    central = struct.unpack_from('<I', original, len(original) - 6)[0]
    block = b'fake-device-authorized-signing-block'
    changed = bytearray(original[:central] + block + original[central:])
    struct.pack_into('<I', changed, len(changed) - 6, central + len(block))
    path.write_bytes(changed)


class HapPrivacyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lantern-hap-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'entry-unsigned.hap'
        hap(self.path)

    def test_plain_unsigned_records_are_accepted(self):
        self.assertEqual(pack.plain_unsigned_zip(self.path)['versionCode'], 20005)

    def test_external_signing_block_is_rejected_even_when_zip_still_reads(self):
        add_external_block(self.path)
        with zipfile.ZipFile(self.path) as archive:
            self.assertIsNone(archive.testzip())
        with self.assertRaisesRegex(ValueError, 'signing block'):
            pack.plain_unsigned_zip(self.path)

    def test_trailing_data_and_zip_comments_are_rejected(self):
        self.path.write_bytes(self.path.read_bytes() + b'private-tail')
        with self.assertRaisesRegex(ValueError, 'end record'):
            pack.plain_unsigned_zip(self.path)
        hap(self.path)
        with zipfile.ZipFile(self.path, 'a') as archive:
            archive.comment = b'private-comment'
        with self.assertRaisesRegex(ValueError, 'end record'):
            pack.plain_unsigned_zip(self.path)

    def test_embedded_device_profile_is_rejected(self):
        hap(self.path, private=True)
        with self.assertRaisesRegex(ValueError, 'Signing/account material'):
            pack.plain_unsigned_zip(self.path)

    def test_duplicate_and_traversal_entries_are_rejected(self):
        with zipfile.ZipFile(self.path, 'a') as archive:
            archive.writestr('../private', 'must-not-publish')
        with self.assertRaisesRegex(ValueError, 'unsafe path'):
            pack.plain_unsigned_zip(self.path)


class ArtifactIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lantern-artifacts-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'repo'
        self.root.mkdir()
        self.output = self.base / 'release-assets'
        self.hap = self.base / 'entry-unsigned.hap'
        self.report = self.base / 'verification.json'
        self.clt = self.base / 'command-line-tools'
        self.clt.mkdir()
        (self.clt / 'version.txt').write_text('# Version: 5.1.0.840\nHarmonyOS SDK: actual SDK fixture\n', encoding='utf-8')
        for file in ['package.json', 'mobile/package.json', 'harmony/package.json']:
            json_file(self.root / file, {'version': '0.1.0'})
        json_file(self.root / 'release-manifest.json', {'version': '0.1.0', 'prerelease': True,
                  'nativeHapAvailable': True, 'qa': 'docs/testing/acceptance.md'})
        json_file(self.root / 'harmony/AppScope/app.json5', {'app': {'versionName': '0.1.0', 'versionCode': 20005}})
        json_file(self.root / 'harmony/build-profile.json5', {'app': {'signingConfigs': []}})
        (self.root / 'docs/testing').mkdir(parents=True)
        (self.root / 'docs/testing/acceptance.md').write_text('# QA\nVerified fixture.\n', encoding='utf-8')
        (self.root / '.gitignore').write_text('dist/\n.env\n', encoding='utf-8')
        (self.root / '.env').write_text('PRIVATE=not-in-source-archive\n', encoding='utf-8')
        (self.root / 'dist/server').mkdir(parents=True)
        (self.root / 'dist/client').mkdir(parents=True)
        (self.root / 'dist/server/index.js').write_text('export default {};\n', encoding='utf-8')
        (self.root / 'dist/client/index.html').write_text('<html>Fixture</html>', encoding='utf-8')
        hap(self.hap)
        self.report_value = {'schemaVersion': 1, 'bytes': self.hap.stat().st_size,
            'sha256': pack.sha256(self.hap), 'bundleName': 'com.lantern.toeic', 'versionName': '0.1.0',
            'buildMode': 'debug', 'compileSdkType': 'HarmonyOS', 'compileSdkVersion': '6.1.0.26-fixture',
            'minAPIVersion': 50000012, 'targetAPIVersion': 50000012,
            'nativeBytecodePresent': True, 'verifiedWebAssets': 490, 'webManifestSha256': 'a' * 64,
            'privateDiagnosticPath': '/home/private/device-id/signing-profile'}
        json_file(self.report, self.report_value)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        self.commit()
        check_output = subprocess.check_output
        run = subprocess.run

        def command_output(command, *args, **kwargs):
            if command[0] == 'node':
                return b'v22.13.0\n'
            if command[0] == str(self.clt / 'tool/node/bin/node'):
                return b'v18.20.1\n'
            return check_output(command, *args, **kwargs)

        def command_run(command, *args, **kwargs):
            if command[0] == 'java':
                return SimpleNamespace(stderr='openjdk version "21-fixture"', returncode=0)
            return run(command, *args, **kwargs)

        self.addCleanup(mock.patch.stopall)
        mock.patch.object(pack.subprocess, 'check_output', side_effect=command_output).start()
        mock.patch.object(pack.subprocess, 'run', side_effect=command_run).start()
        mock.patch.dict(os.environ, {'LANTERN_HARMONY_CLT': str(self.clt)}, clear=False).start()
        if 'GITHUB_SHA' in os.environ:
            mock.patch.dict(os.environ, {'GITHUB_SHA': pack.git(self.root, 'rev-parse', 'HEAD')}).start()

    def commit(self):
        subprocess.run(['git', '-C', str(self.root), 'add', '.'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                        'commit', '-qm', 'fixture'], check=True, capture_output=True)

    def prepare(self):
        return pack.prepare(self.root, self.hap, self.report, self.output)

    def test_exact_seven_public_artifacts_checksums_source_and_actual_sdk_evidence(self):
        plan = self.prepare()
        self.assertEqual(len(plan['assets']), 7)
        for entry in plan['assets']:
            path = self.output / entry['name']
            self.assertEqual(pack.sha256(path), entry['sha256'])
            self.assertEqual(path.stat().st_size, entry['bytes'])
        source = self.output / 'lantern-v0.1.0-source.zip'
        with zipfile.ZipFile(source) as z:
            self.assertFalse(any(name.endswith('/.env') or '/dist/' in name for name in z.namelist()))
        info = json.loads((self.output / 'build-info.json').read_text('utf-8'))
        self.assertEqual(info['sdkVersion'], '6.1.0.26-fixture')
        self.assertEqual(info['cltNodeVersion'], 'v18.20.1')
        self.assertIsNone(info['cltArchiveSha256'])
        self.assertEqual(info['hapSigning'], 'unsigned')
        report = json.loads((self.output / 'package-verification.json').read_text('utf-8'))
        self.assertNotIn('privateDiagnosticPath', report)
        for line in (self.output / 'SHA256SUMS.txt').read_text('ascii').splitlines():
            digest, name = line.split('  ')
            self.assertEqual(pack.sha256(self.output / name), digest)

    def test_mismatched_package_report_stops_before_creating_output(self):
        self.report_value['sha256'] = '0' * 64
        json_file(self.report, self.report_value)
        with self.assertRaisesRegex(ValueError, 'report does not match'):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_signed_hap_cannot_be_relabelled_unsigned(self):
        add_external_block(self.hap)
        self.report_value.update(bytes=self.hap.stat().st_size, sha256=pack.sha256(self.hap))
        json_file(self.report, self.report_value)
        with self.assertRaisesRegex(ValueError, 'signing block'):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_changed_tracked_source_cannot_be_packaged_as_head(self):
        (self.root / 'docs/testing/acceptance.md').write_text('Uncommitted QA', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'clean workflow commit'):
            self.prepare()

    def test_existing_output_is_never_silently_overwritten(self):
        self.prepare()
        before = (self.output / 'release-assets.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'empty directory'):
            self.prepare()
        self.assertEqual((self.output / 'release-assets.json').read_bytes(), before)


class InstallerTests(unittest.TestCase):
    def test_changed_archive_rejected_even_with_matching_length(self):
        with tempfile.TemporaryDirectory(prefix='lantern-clt-') as temp:
            archive = Path(temp) / 'cached.zip'
            archive.write_bytes(b'bad')
            with mock.patch.object(installer, 'BYTES', 3), mock.patch.object(installer, 'SHA256', hashlib.sha256(b'yes').hexdigest()):
                with self.assertRaisesRegex(RuntimeError, 'SHA256 mismatch'):
                    installer.download(archive)

    def test_insufficient_disk_space_fails_without_download(self):
        with tempfile.TemporaryDirectory(prefix='lantern-clt-') as temp:
            with mock.patch.object(installer.shutil, 'disk_usage', return_value=SimpleNamespace(free=1)), mock.patch.object(installer.urllib.request, 'urlopen') as download:
                with self.assertRaisesRegex(RuntimeError, 'Insufficient runner disk'):
                    installer.download(Path(temp) / 'cached.zip')
                download.assert_not_called()


if __name__ == '__main__':
    unittest.main()
