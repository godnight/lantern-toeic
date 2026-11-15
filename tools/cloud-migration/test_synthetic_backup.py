import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("synthetic_backup.py")
SPEC = importlib.util.spec_from_file_location("lantern_synthetic_backup", SCRIPT)
rehearsal = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rehearsal)


class SyntheticBackupTests(unittest.TestCase):
    def test_explicit_opt_in_and_no_external_path_arguments(self):
        for args in ([], ["--run-synthetic", "--source", "not-a-fixture"]):
            result = subprocess.run([sys.executable, str(SCRIPT), *args],
                                    text=True, capture_output=True, timeout=15)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("PASS synthetic", result.stdout)

    def test_wal_backup_during_commit_and_independent_restores(self):
        result = rehearsal.run_rehearsal()
        root = Path(result["directory"])
        self.assertTrue(result["write_during_backup"])
        self.assertFalse(result["cross_database_atomic"])
        # A committed, uncheckpointed WAL row predates the snapshot. The
        # writer then commits another transaction during the paged backup.
        self.assertIn(result["main_rows"], (65, 66))
        self.assertEqual(rehearsal._read_snapshot(root, root / "main.sqlite"), 66)
        self.assertEqual(rehearsal._read_snapshot(root, root / "metadata.sqlite"), 1)
        self.assertEqual(rehearsal._read_snapshot(root, root / "main-restored.sqlite"), result["main_rows"])
        self.assertEqual(rehearsal._read_snapshot(root, root / "metadata-restored.sqlite"), 1)
        self.assertTrue((root / "main.sqlite").exists())
        self.assertTrue((root / "metadata.sqlite").exists())
        snapshot = root / "main-snapshot.sqlite"
        restored = root / "main-restored.sqlite"
        self.assertEqual(rehearsal._read_snapshot(root, snapshot, include_digest=True),
                         rehearsal._read_snapshot(root, restored, include_digest=True))
        db = sqlite3.connect(str(restored))
        db.execute("UPDATE events SET payload = 'synthetic-tampering' WHERE seq = 1")
        db.commit()
        db.close()
        self.assertEqual(rehearsal._read_snapshot(root, restored), result["main_rows"])
        self.assertNotEqual(rehearsal._read_snapshot(root, snapshot, include_digest=True),
                            rehearsal._read_snapshot(root, restored, include_digest=True))

    def test_refuses_outside_paths_wrong_pair_and_overwrite(self):
        root = Path(tempfile.mkdtemp(prefix="lantern-synthetic-backup-")).resolve()
        source = root / "main.sqlite"
        destination = root / "main-snapshot.sqlite"
        rehearsal._create_fixture(root, source, with_events=True)
        with self.assertRaisesRegex(RuntimeError, "outside"):
            rehearsal._snapshot(root, root.parent / "main.sqlite", destination)
        with self.assertRaisesRegex(RuntimeError, "pair"):
            rehearsal._snapshot(root, source, root / "metadata-snapshot.sqlite")
        rehearsal._snapshot(root, source, destination)
        before = hashlib.sha256(destination.read_bytes()).digest()
        with self.assertRaisesRegex(RuntimeError, "overwrite"):
            rehearsal._snapshot(root, source, destination)
        self.assertEqual(hashlib.sha256(destination.read_bytes()).digest(), before)

    def test_refuses_foreign_fixture_without_creating_destination(self):
        root = Path(tempfile.mkdtemp(prefix="lantern-synthetic-backup-")).resolve()
        source = root / "main.sqlite"
        db = sqlite3.connect(str(source))
        db.execute("CREATE TABLE fixture_identity(value TEXT)")
        db.execute("INSERT INTO fixture_identity VALUES ('other')")
        db.commit()
        db.close()
        destination = root / "main-snapshot.sqlite"
        with self.assertRaisesRegex(RuntimeError, "synthetic"):
            rehearsal._snapshot(root, source, destination)
        self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
