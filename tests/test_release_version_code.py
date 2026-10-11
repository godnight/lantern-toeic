import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('pack', Path(__file__).resolve().parents[1] / 'scripts/prepare-release-artifacts.py')
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


class PreviousVersionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lantern-version-gate-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'build-info.json'
        self.source = 'a' * 40
        self.app = {'versionName': '0.3.1', 'versionCode': 20007}
        self.previous = {'schemaVersion': 1, 'version': '0.3.0', 'versionCode': 20006, 'sourceCommit': 'b' * 40}

    def check(self):
        data = json.dumps(self.previous).encode()
        self.path.write_bytes(data)
        pack.check_previous_version(self.app, self.source, self.path, hashlib.sha256(data).hexdigest())

    def test_new_code_strictly_increases(self):
        self.check()

    def test_equal_or_older_is_rejected(self):
        for code in [20005, 20006]:
            with self.subTest(code=code), self.assertRaisesRegex(ValueError, 'greater'):
                self.app['versionCode'] = code
                self.check()

    def test_same_version_same_source_same_code_is_only_a_precheck(self):
        self.previous.update(version='0.3.1', versionCode=20007, sourceCommit=self.source)
        self.check()

    def test_same_version_changed_source_or_code_rejected(self):
        for change in [{'sourceCommit': 'b' * 40}, {'versionCode': 20006}]:
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'unchanged'):
                self.previous.update(version='0.3.1', versionCode=20007, sourceCommit=self.source)
                self.previous.update(change)
                self.check()

    def test_missing_sha_or_file_rejected(self):
        for path, sha in [(self.path, None), (None, 'a' * 64)]:
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'supplied together'):
                pack.check_previous_version(self.app, self.source, path, sha)

    def test_sha_mismatch_rejected(self):
        self.path.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            pack.check_previous_version(self.app, self.source, self.path, '0' * 64)

    def test_invalid_candidate_type_or_floor_rejected(self):
        for code in [True, 20007.0, '20007', 20004]:
            with self.subTest(code=code), self.assertRaisesRegex(ValueError, 'integer'):
                self.app['versionCode'] = code
                pack.check_previous_version(self.app, self.source)

    def test_invalid_previous_identity_rejected(self):
        for value in [True, 1.5, '20006', 0]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'identity'):
                self.previous['versionCode'] = value
                self.check()

    def test_no_offline_baseline_defers_to_online_publisher_without_claiming_first_release(self):
        pack.check_previous_version(self.app, self.source)


if __name__ == '__main__':
    unittest.main()
