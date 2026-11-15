"""Synthetic SQLite WAL backup rehearsal; never opens a caller-supplied database.

Run only with --run-synthetic. No source or destination arguments are accepted.
The independently captured databases do not form a cross-database atomic snapshot.
"""

import argparse
import hashlib
import os
from pathlib import Path
import sqlite3
import tempfile
import threading

_FIXTURE = "lantern-synthetic-backup-v1"
_BASE_ROWS = 64
_NAMES = frozenset({"main.sqlite", "metadata.sqlite", "main-snapshot.sqlite",
                    "metadata-snapshot.sqlite", "main-restored.sqlite", "metadata-restored.sqlite"})
_PAIRS = {"main.sqlite": "main-snapshot.sqlite", "metadata.sqlite": "metadata-snapshot.sqlite",
          "main-snapshot.sqlite": "main-restored.sqlite", "metadata-snapshot.sqlite": "metadata-restored.sqlite"}


def _guard(root, path):
    # Even helper functions reject paths outside a named temporary fixture root,
    # paths reached through a symlink, and names other than our six fixtures.
    if (root.is_symlink() or not root.is_dir() or
            root.parent != Path(tempfile.gettempdir()).resolve() or
            not root.name.startswith("lantern-synthetic-backup-") or
            path.parent != root or path.name not in _NAMES or path.is_symlink()):
        raise RuntimeError("path is outside the synthetic fixture")


def _create_fixture(root, path, *, with_events):
    # The containing directory is newly created by run_rehearsal, not supplied
    # by a caller; fail instead of opening an existing database.
    _guard(root, path)
    if path.exists():
        raise RuntimeError("synthetic fixture already exists")
    db = sqlite3.connect(str(path), timeout=5)
    try:
        if db.execute("PRAGMA journal_mode=WAL").fetchone()[0].lower() != "wal":
            raise RuntimeError("WAL mode unavailable")
        db.execute("CREATE TABLE fixture_identity (value TEXT NOT NULL)")
        db.execute("INSERT INTO fixture_identity VALUES (?)", (_FIXTURE,))
        db.execute("CREATE TABLE events (seq INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
        db.execute("CREATE TABLE ledger (event_count INTEGER NOT NULL)")
        count = _BASE_ROWS if with_events else 1
        for seq in range(1, count + 1):
            # Enough pages to make the concurrent-backup test meaningful.
            db.execute("INSERT INTO events VALUES (?, ?)", (seq, "synthetic-" + "x" * 4096))
        db.execute("INSERT INTO ledger VALUES (?)", (count,))
        db.commit()
    finally:
        db.close()


def _readonly(root, path):
    _guard(root, path)
    if not path.is_file():
        raise RuntimeError("synthetic fixture file is missing")
    return sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5)


def _read_snapshot(root, path, *, include_digest=False):
    db = _readonly(root, path)
    try:
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise RuntimeError("snapshot integrity check failed")
        if db.execute("SELECT value FROM fixture_identity").fetchall() != [(_FIXTURE,)]:
            raise RuntimeError("not our synthetic fixture")
        count, minimum, maximum, total = db.execute(
            "SELECT COUNT(*), MIN(seq), MAX(seq), SUM(seq) FROM events"
        ).fetchone()
        if db.execute("SELECT event_count FROM ledger").fetchall() != [(count,)]:
            raise RuntimeError("snapshot contains a partial transaction")
        if (minimum, maximum, total) != (1, count, count * (count + 1) // 2):
            raise RuntimeError("snapshot event sequence is inconsistent")
        if include_digest:
            digest = hashlib.sha256()
            for seq, payload in db.execute("SELECT seq, payload FROM events ORDER BY seq"):
                encoded = payload.encode("utf-8")
                digest.update(str(seq).encode("ascii") + b":" + str(len(encoded)).encode("ascii") + b":" + encoded)
            return count, digest.hexdigest()
        return count
    finally:
        db.close()


def _snapshot(root, source, destination, progress=None):
    _guard(root, source)
    _guard(root, destination)
    if _PAIRS.get(source.name) != destination.name:
        raise RuntimeError("invalid synthetic backup pair")
    if destination.exists():
        raise RuntimeError("refusing to overwrite a snapshot")
    # No caller can choose either path. Both are under the fresh fixture root.
    source_db = _readonly(root, source)
    try:
        if source_db.execute("SELECT value FROM fixture_identity").fetchall() != [(_FIXTURE,)]:
            raise RuntimeError("not our synthetic fixture")
        destination_db = sqlite3.connect(str(destination), timeout=5)
        try:
            source_db.backup(destination_db, pages=1, progress=progress, sleep=0.01)
        finally:
            destination_db.close()
    finally:
        source_db.close()
    return _read_snapshot(root, destination)


def run_rehearsal():
    # Create all inputs locally. The function cannot receive a real source path.
    root = Path(tempfile.mkdtemp(prefix="lantern-synthetic-backup-")).resolve()
    if os.name != "nt":
        os.chmod(str(root), 0o700)
    main, metadata = root / "main.sqlite", root / "metadata.sqlite"
    _create_fixture(root, main, with_events=True)
    _create_fixture(root, metadata, with_events=False)
    # Keep a connection open so this committed row remains in a live WAL when
    # the online backup starts. Do not copy a database/WAL file directly.
    keeper = sqlite3.connect(str(main), timeout=5)
    try:
        keeper.execute("INSERT INTO events VALUES (?, ?)", (_BASE_ROWS + 1, "synthetic-wal"))
        keeper.execute("UPDATE ledger SET event_count = event_count + 1")
        keeper.commit()
        wal = Path(str(main) + "-wal")
        if not wal.is_file() or wal.stat().st_size == 0:
            raise RuntimeError("synthetic committed WAL is not present")
        return _rehearse_with_live_wal(root, main, metadata)
    finally:
        keeper.close()


def _rehearse_with_live_wal(root, main, metadata):

    begin_write, writer_done = threading.Event(), threading.Event()
    writer_errors = []

    def write_during_backup():
        try:
            if not begin_write.wait(10):
                raise TimeoutError("backup did not start")
            db = sqlite3.connect(str(main), timeout=5)
            try:
                db.execute("BEGIN IMMEDIATE")
                db.execute("INSERT INTO events VALUES (?, ?)", (_BASE_ROWS + 2, "synthetic-concurrent"))
                db.execute("UPDATE ledger SET event_count = event_count + 1")
                db.commit()
            finally:
                db.close()
        except Exception as exc:
            writer_errors.append(exc)
        finally:
            writer_done.set()

    writer = threading.Thread(target=write_during_backup, daemon=True)
    writer.start()
    calls = [0]

    def after_page(_status, _remaining, _total):
        calls[0] += 1
        if calls[0] == 1:
            begin_write.set()
            if not writer_done.wait(10):
                raise TimeoutError("concurrent synthetic write did not complete")
            if writer_errors:
                raise RuntimeError("concurrent synthetic write failed") from writer_errors[0]

    try:
        main_count = _snapshot(root, main, root / "main-snapshot.sqlite", after_page)
    finally:
        begin_write.set()
        writer.join(timeout=10)
    if writer.is_alive() or writer_errors or calls[0] < 1:
        raise RuntimeError("concurrent synthetic writer did not finish")
    if main_count < _BASE_ROWS + 1:
        raise RuntimeError("snapshot missed the committed synthetic WAL row")
    metadata_count = _snapshot(root, metadata, root / "metadata-snapshot.sqlite")
    restored_main = _snapshot(root, root / "main-snapshot.sqlite", root / "main-restored.sqlite")
    restored_metadata = _snapshot(root, root / "metadata-snapshot.sqlite", root / "metadata-restored.sqlite")
    if (restored_main, restored_metadata) != (main_count, metadata_count):
        raise RuntimeError("synthetic restore differs from snapshot")
    for name in ("main", "metadata"):
        if _read_snapshot(root, root / (name + "-snapshot.sqlite"), include_digest=True) != _read_snapshot(
                root, root / (name + "-restored.sqlite"), include_digest=True):
            raise RuntimeError("synthetic restore contents differ from snapshot")
    if _read_snapshot(root, main) != _BASE_ROWS + 2 or _read_snapshot(root, metadata) != 1:
        raise RuntimeError("source fixture was unexpectedly changed")
    return {"directory": str(root), "main_rows": main_count,
            "metadata_rows": metadata_count, "write_during_backup": True,
            "cross_database_atomic": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-synthetic", action="store_true")
    args = parser.parse_args()
    if not args.run_synthetic:
        parser.error("requires --run-synthetic; no real database paths are supported")
    result = run_rehearsal()
    print("PASS synthetic WAL backup and restore; write committed during backup")
    print("Individual databases only; cross-database atomicity is not established")
    print("Retained synthetic fixtures: " + result["directory"])


if __name__ == "__main__":
    main()
