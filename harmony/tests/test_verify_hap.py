"""Failure cases for package checks; fixtures do not simulate native compilation."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('verify_hap', Path(__file__).parents[1] / 'scripts/verify-hap.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class PackageChecks(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.web = self.root / 'web'
        self.web.mkdir()
        self.hap = self.root / 'test-unsigned.hap'
        asset = b'<div id="root"></div>'
        manifest = {'schemaVersion': 1, 'platform': 'HarmonyOS', 'files': [
            {'path': 'index.html', 'bytes': len(asset), 'sha256': hashlib.sha256(asset).hexdigest()}]}
        manifest_bytes = json.dumps(manifest).encode()
        (self.web / 'index.html').write_bytes(asset)
        (self.web / 'bundle-manifest.json').write_bytes(manifest_bytes)
        self.entries = {
            'module.json': json.dumps({'app': {
                'bundleName': 'com.lantern.toeic', 'compileSdkType': 'HarmonyOS',
                'compileSdkVersion': '5.1.0.125', 'minAPIVersion': 50000012,
                'targetAPIVersion': 50000012, 'versionName': '0.2.4', 'buildMode': 'debug'}}).encode(),
            'pack.info': b'fixture', 'resources.index': b'fixture', 'ets/modules.abc': b'fixture',
            'resources/rawfile/web/index.html': asset,
            'resources/rawfile/web/bundle-manifest.json': manifest_bytes,
        }

    def verify(self):
        with zipfile.ZipFile(self.hap, 'w') as archive:
            for name, data in self.entries.items():
                archive.writestr(name, data)
        return checker.verify(self.hap, self.web)

    def test_integrity_report_does_not_claim_device_or_signature_validation(self):
        report = self.verify()
        self.assertEqual(report['verifiedWebAssets'], 1)
        self.assertFalse(report['signatureVerified'])
        self.assertFalse(report['deviceTested'])

    def test_changed_asset_is_rejected(self):
        self.entries['resources/rawfile/web/index.html'] = b'stale'
        with self.assertRaisesRegex(ValueError, 'Stale or corrupt'):
            self.verify()

    def test_missing_bytecode_is_rejected(self):
        del self.entries['ets/modules.abc']
        with self.assertRaises(KeyError):
            self.verify()

    def test_extra_web_payload_is_rejected(self):
        self.entries['resources/rawfile/web/sw.js'] = b'stale worker'
        with self.assertRaisesRegex(ValueError, 'Unexpected or missing'):
            self.verify()

    def test_stale_source_manifest_is_rejected(self):
        (self.web / 'bundle-manifest.json').write_text('{"platform":"HarmonyOS","schemaVersion":1,"files":[]}', encoding='utf-8')
        with self.assertRaises(ValueError):
            self.verify()

    def test_private_key_material_is_rejected(self):
        self.entries['resources/rawfile/developer.p12'] = b'fixture'
        with self.assertRaisesRegex(ValueError, 'signing or account configuration'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
