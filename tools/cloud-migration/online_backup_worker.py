"""Internal worker for online_backup_candidate.ps1; do not invoke directly."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import time


def snapshot(source, target):
    start = datetime.datetime.now(datetime.timezone.utc).isoformat()
    # The wrapper owns a fresh, ACL-protected directory. Refuse existing files;
    # SQLite opens only this invocation's new, empty placeholder.
    fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)
    src = sqlite3.connect(Path(source).as_uri() + "?mode=ro", uri=True, timeout=5)
    try:
        src.execute("PRAGMA query_only=ON")
        dst = sqlite3.connect(str(target), timeout=5)
        try:
            deadline = time.monotonic() + 30
            def progress(_status, _remaining, _total):
                if time.monotonic() > deadline:
                    raise TimeoutError("snapshot deadline")
            src.backup(dst, pages=64, progress=progress, sleep=0.05)
            if dst.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise RuntimeError("snapshot integrity failed")
        finally:
            dst.close()
    finally:
        src.close()
    # A report/hash is useful only if the new target is self-contained.
    # Never delete residual SQLite sidecars here: let the guarded wrapper
    # fail and apply its restricted cleanup policy.
    if any(Path(str(target) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
        raise RuntimeError("snapshot has residual SQLite sidecars")
    digest = hashlib.sha256()
    with open(target, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"startUtc": start, "endUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "sha256": digest.hexdigest(), "integrity": "ok"}


def main():
    if len(sys.argv) != 1:
        raise RuntimeError("internal worker only")
    guard = os.environ.pop("LANTERN_MIGRATION_GUARD", "")
    request = json.load(sys.stdin)
    if not re.fullmatch(r"[0-9a-f]{64}", guard) or not secrets.compare_digest(guard, request.get("guard", "")):
        raise RuntimeError("guarded wrapper required")
    if set(request) != {"guard", "main", "metadata", "target"}:
        raise RuntimeError("invalid request")
    target = Path(request["target"])
    report = {"kind": "online-backup-review", "crossDatabaseAtomic": False,
              "finalMigration": False,
              "main": snapshot(request["main"], target / "main.sqlite"),
              "metadata": snapshot(request["metadata"], target / "metadata.sqlite")}
    # Never replace an existing report or claim the two snapshots are atomic.
    with open(target / "manifest.json", "x", encoding="utf-8", newline="\n") as stream:
        json.dump(report, stream, sort_keys=True, separators=(",", ":"))
        stream.write("\n")
    print("ONLINE_BACKUP_OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Do not include SQLite error text, paths, or database content in logs.
        print("ONLINE_BACKUP_FAILED:" + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
