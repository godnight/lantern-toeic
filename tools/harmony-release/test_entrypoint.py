"""Public fixtures and mocks only; no credentials, SDK, signing or device calls."""
from pathlib import Path
from unittest.mock import patch
import contextlib
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest

import sign_final_phone as signer


class StableEntrypoint(unittest.TestCase):
    def setUp(self):
        self.area = tempfile.TemporaryDirectory()
        self.addCleanup(self.area.cleanup)
        self.config_path = Path(self.area.name)/'environment.local.json'
        self.config = {
            'schemaVersion': 1,
            'studioRoot': str(Path(self.area.name)/'studio'),
            'encryptedBuildProfile': str(Path(self.area.name)/'encrypted.json'),
            'privateOutputRoot': str(Path(self.area.name)/'private'),
            'knownGoodReceipt': str(Path(self.area.name)/'receipt.json'),
            'knownGoodReceiptSha256': 'a'*64, 'signerDerSha256': 'b'*64,
            'certificateSha256': 'c'*64, 'profileSha256': 'd'*64,
            'toolEntrypoints': [{'name': 'studio/'+name, 'bytes': 1, 'sha256': 'e'*64}
                                for name in signer.OFFICIAL_ENTRYPOINTS],
        }
        self.save_config()
        signer.configure_environment(self.config_path)

    def save_config(self):
        self.config_path.write_text(json.dumps(self.config), encoding='utf-8')

    def test_next_build_output_uses_explicit_identity(self):
        self.assertEqual(signer.signed_filename({'versionName': '0.4.5', 'versionCode': 20060}),
                         'lantern-0.4.5-20060-signed.hap')

    def test_filename_rejects_traversal_and_noninteger_codes(self):
        for name, code in [('../0.4.5', 20060), ('0.4.5', True), ('0.4.5', '20060'),
                           ('0.4.5', 0), ('0.4.5', 2147483648)]:
            with self.subTest(name=name, code=code), self.assertRaises(signer.GateError):
                signer.signed_filename({'versionName': name, 'versionCode': code})

    def test_local_support_bytes_match_pinned_baseline(self):
        entries = signer.read(signer.HERE/'SUPPORT-PINS.json')['entries']
        for row in entries:
            if row['name'].startswith('support/'):
                actual = signer.pin(signer.HERE/row['name'])
                self.assertEqual((actual['bytes'], actual['sha256']), (row['bytes'], row['sha256']))

    def test_entrypoint_check_accepts_exact_pins_and_rejects_changes(self):
        entries = signer.read(signer.HERE/'SUPPORT-PINS.json')['entries'] + self.config['toolEntrypoints']
        actual = []
        for row in entries:
            prefix, relative = row['name'].split('/', 1)
            root = signer.SUPPORT if prefix == 'support' else signer.STUDIO
            actual.append({'path': str(root/relative), 'bytes': row['bytes'], 'sha256': row['sha256']})
        signer.verify_entrypoints({'toolEntrypointsOnly': actual})
        actual[0]['sha256'] = '0'*64
        with self.assertRaisesRegex(signer.GateError, 'SIGNING_TOOL_ENTRYPOINT_CHANGED'):
            signer.verify_entrypoints({'toolEntrypointsOnly': actual})

    def test_sign_command_dispatches_once_without_external_check(self):
        with tempfile.TemporaryDirectory() as folder:
            request = Path(folder)/'request.json'; result = Path(folder)/'result.json'
            request.write_text('{"identity":{"versionCode":20060}}', encoding='utf-8')
            outcome = {'status': 'SYNTHETIC_ONLY', 'signed': {'sha256': 'a'*64}}
            with patch.object(sys, 'argv', ['sign_final_phone.py', 'sign', '--config', str(self.config_path), '--request', str(request), '--result', str(result)]), \
                 patch.object(signer, 'sign', return_value=outcome) as sign, \
                 patch.object(signer, 'verify_request', side_effect=AssertionError('EXTRA_PREFLIGHT')), \
                 patch.object(signer, 'inspect', side_effect=AssertionError('EXTRA_INSPECTION')), \
                 contextlib.redirect_stdout(io.StringIO()):
                signer.main()
            sign.assert_called_once_with({'identity': {'versionCode': 20060}})
            self.assertEqual(json.loads(result.read_text(encoding='utf-8')), outcome)

    def test_existing_receipt_is_never_overwritten_or_resigned(self):
        with tempfile.TemporaryDirectory() as folder:
            result = Path(folder)/'result.json'; result.write_text('keep', encoding='utf-8')
            with patch.object(sys, 'argv', ['sign_final_phone.py', 'sign', '--request', 'unused', '--result', str(result)]), \
                 patch.object(signer, 'sign', side_effect=AssertionError('RESIGN_ATTEMPT')):
                with self.assertRaisesRegex(signer.GateError, 'RESULT_ALREADY_EXISTS_CHOOSE_NEW_LABEL'):
                    signer.main()
            self.assertEqual(result.read_text(encoding='utf-8'), 'keep')

    def test_environment_requires_absolute_paths_and_complete_pins(self):
        for field, value in [('studioRoot', 'relative/studio'), ('signerDerSha256', ''),
                             ('profileSha256', '0'*64), ('toolEntrypoints', [])]:
            with self.subTest(field=field):
                changed = dict(self.config); changed[field] = value
                self.config_path.write_text(json.dumps(changed), encoding='utf-8')
                with self.assertRaises(signer.GateError):
                    signer.configure_environment(self.config_path)
                self.assertIsNone(signer.ENVIRONMENT)

    def test_environment_rejects_credentials_and_custom_executable_paths(self):
        self.config['storePassword'] = 'synthetic-forbidden-field'
        self.save_config()
        with self.assertRaisesRegex(signer.GateError, 'INVALID_ENVIRONMENT_CONFIG'):
            signer.configure_environment(self.config_path)
        del self.config['storePassword']
        self.config['toolEntrypoints'][0]['name'] = 'studio/../untrusted.exe'
        self.save_config()
        with self.assertRaisesRegex(signer.GateError, 'INVALID_OFFICIAL_ENTRYPOINT_PIN'):
            signer.configure_environment(self.config_path)

    def test_empty_template_is_not_a_signable_configuration(self):
        with self.assertRaises(signer.GateError):
            signer.configure_environment(signer.HERE/'ENVIRONMENT.template.json')

    def test_check_command_needs_no_signing_environment(self):
        result = Path(self.area.name)/'check.json'; request = Path(self.area.name)/'request.json'
        request.write_text('{}', encoding='utf-8')
        identity = {'versionName': '0.4.5', 'versionCode': 20060}
        with patch.object(sys, 'argv', ['sign_final_phone.py', 'check', '--request', str(request), '--result', str(result)]), \
             patch.object(signer, 'ENVIRONMENT', None), \
             patch.object(signer, 'verify_request', return_value=(Path('synthetic.hap'), identity)) as check, \
             patch.object(signer, 'pin', return_value={'sha256': 'a'*64}), \
             patch.object(signer, 'configure_environment', side_effect=AssertionError('ENVIRONMENT_READ')), \
             patch.object(signer, 'inspect', side_effect=AssertionError('SIGNER_INSPECTION')), \
             contextlib.redirect_stdout(io.StringIO()):
            signer.main()
        check.assert_called_once_with({})
        self.assertFalse(json.loads(result.read_text(encoding='utf-8'))['signingInvoked'])

    def test_sign_without_environment_stops_before_preflight(self):
        with patch.object(signer, 'ENVIRONMENT', None), \
             patch.object(signer, 'verify_request', side_effect=AssertionError('PREFLIGHT_CALLED')):
            with self.assertRaisesRegex(signer.GateError, 'LOCAL_SIGNING_ENVIRONMENT_REQUIRED'):
                signer.sign({})

    def test_extracted_public_path_and_digest_primitives(self):
        spec = importlib.util.spec_from_file_location('public_primitives', signer.SUPPORT/'public_core.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'fixture.txt'; body = b'public fixture'
            path.write_bytes(body)
            self.assertEqual(module.plain_path(path), path)
            self.assertEqual(module.read(path), body)
            self.assertEqual(module.digest(body), hashlib.sha256(body).hexdigest())
            rows = [{'path': 'fixture.txt', 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}]
            expected = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            self.assertEqual(module.tree_sha(folder), expected)


if __name__ == '__main__':
    unittest.main(verbosity=2)
