"""Role changes between preflight and backup are checked on synthetic snapshots."""
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("online_backup_worker", HERE / "online_backup_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def synthetic_main():
    db = sqlite3.connect(":memory:")
    db.execute(worker._CF_METADATA)
    db.execute(worker._LEDGER_SQL)
    for name, digest, file, _ in worker._MIGRATIONS:
        sql = (HERE.parents[1] / "drizzle" / file).read_text(encoding="utf-8")
        for statement in sql.split("--> statement-breakpoint"):
            if statement.strip():
                db.execute(statement.strip())
        db.execute("INSERT INTO _lantern_local_migrations VALUES (?, ?)", (name, digest))
    db.commit()
    return db


class RoleTests(unittest.TestCase):
    def test_snapshot_rechecks_schema_and_ledger_after_preflight(self):
        expected = worker._expected_schemas()
        for alteration in ("CREATE TABLE unexpected_synthetic(id INTEGER)",
                           "UPDATE _lantern_local_migrations SET sha='changed'"):
            with self.subTest(alteration=alteration), tempfile.TemporaryDirectory() as temp:
                db = synthetic_main()
                try:
                    worker._validate_role(db, "main", expected)
                    db.execute(alteration)
                    db.commit()
                    with self.assertRaises(RuntimeError):
                        worker.snapshot(db, Path(temp) / "snapshot.sqlite", "main", expected)
                finally:
                    db.close()

    def test_distinct_synthetic_roles(self):
        expected = worker._expected_schemas()
        main = synthetic_main()
        metadata = sqlite3.connect(":memory:")
        try:
            metadata.execute(worker._CF_ALARM)
            worker._validate_role(main, "main", expected)
            worker._validate_role(metadata, "metadata", expected)
            with self.assertRaises(RuntimeError):
                worker._validate_role(main, "metadata", expected)
            with self.assertRaises(RuntimeError):
                worker._validate_role(metadata, "main", expected)
        finally:
            main.close()
            metadata.close()


if __name__ == "__main__":
    unittest.main()
