"""Internal worker for online_backup_candidate.ps1; do not invoke directly."""
import datetime
import hashlib
import json
import os
from contextlib import closing
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import time


# Exact reviewed legacy ledger and LF migration bytes. Only line-ending
# normalization is permitted when constructing the expected SQLite schema.
_MIGRATIONS = (
    ("0000_product_auth.sql", "343816721b4a8bd71b107de663dd672def7d54f86663234f606d2c749aab7628", "0005_product_auth.sql", "1b88f0e2df5224f5115031bf52696c7d19ee6043a99a6c6cfa4f66607bebf04c"),
    ("0001_auth_admission_ticket.sql", "58d6fd8a377930234719104a61ea41487f5db322b92ffbc79aa0399bc6af87d1", "0006_auth_admission_ticket.sql", "a547206b73bb57f2bfd9e76c83d15e4303354f299754d9ffbfd1e95fd3d84d2c"),
    ("0002_huawei_auth.sql", "d41bb1b0f4e3a66bb1582443ad1357336e14e4f7c07e94f24989fd66a8e5fd8b", "0009_huawei_auth.sql", "d41bb1b0f4e3a66bb1582443ad1357336e14e4f7c07e94f24989fd66a8e5fd8b"),
)
_CF_METADATA = """CREATE TABLE _cf_METADATA (
        key INTEGER PRIMARY KEY,
        value BLOB
      )"""
_CF_ALARM = """CREATE TABLE _cf_ALARM (
      actor_id TEXT PRIMARY KEY,
      scheduled_time INTEGER
    ) WITHOUT ROWID"""
_LEDGER_SQL = "CREATE TABLE _lantern_local_migrations (name TEXT PRIMARY KEY, sha TEXT NOT NULL)"


def _schema(db):
    rows = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema "
                      "WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' ORDER BY type,name").fetchall()
    return [(kind, name, table, sql.replace("\r\n", "\n")) for kind, name, table, sql in rows]


def _expected_schemas():
    root = Path(__file__).resolve().parents[2]
    with closing(sqlite3.connect(":memory:")) as main, closing(sqlite3.connect(":memory:")) as metadata:
        main.execute(_CF_METADATA)
        main.execute(_LEDGER_SQL)
        for _old, _old_hash, current, lf_hash in _MIGRATIONS:
            data = (root / "drizzle" / current).read_bytes().replace(b"\r\n", b"\n")
            if hashlib.sha256(data).hexdigest() != lf_hash:
                raise RuntimeError("reviewed migration changed")
            for statement in data.decode("utf-8").split("--> statement-breakpoint"):
                if statement.strip():
                    main.execute(statement.strip())
        metadata.execute(_CF_ALARM)
        return {"main": _schema(main), "metadata": _schema(metadata)}


def _validate_role(db, role, expected):
    if role not in ("main", "metadata") or _schema(db) != expected[role]:
        raise RuntimeError("database role or schema mismatch")
    if db.execute("PRAGMA user_version").fetchone() != (0,) or db.execute("PRAGMA application_id").fetchone() != (0,):
        raise RuntimeError("database version mismatch")
    if role == "main":
        actual = db.execute("SELECT name,sha FROM _lantern_local_migrations ORDER BY name").fetchall()
        if actual != sorted((name, sha) for name, sha, _current, _lf in _MIGRATIONS):
            raise RuntimeError("legacy account ledger mismatch")


def _readonly(source):
    db = sqlite3.connect(Path(source).as_uri() + "?mode=ro", uri=True, timeout=5)
    db.execute("PRAGMA query_only=ON")
    return db


def snapshot(src, target, role, expected):
    start = datetime.datetime.now(datetime.timezone.utc).isoformat()
    # The wrapper owns a fresh, ACL-protected directory. Refuse existing files;
    # SQLite opens only this invocation's new, empty placeholder.
    fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)
    dst = sqlite3.connect(str(target), timeout=5)
    try:
        deadline = time.monotonic() + 30
        def progress(_status, _remaining, _total):
            if time.monotonic() > deadline:
                raise TimeoutError("snapshot deadline")
        src.backup(dst, pages=64, progress=progress, sleep=0.05)
        _validate_role(dst, role, expected)
        if dst.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise RuntimeError("snapshot integrity failed")
    finally:
        dst.close()
    # A report/hash is useful only if the new target is self-contained.
    # Never delete residual SQLite sidecars here: let the guarded wrapper
    # fail and apply its restricted cleanup policy.
    if any(Path(str(target) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
        raise RuntimeError("snapshot has residual SQLite sidecars")
    digest = hashlib.sha256()
    with open(target, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"role": "legacy-auth" if role == "main" else "miniflare-metadata",
            "startUtc": start, "endUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
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
    expected = _expected_schemas()
    with closing(_readonly(request["main"])) as main_db, closing(_readonly(request["metadata"])) as metadata_db:
        # Validate both roles before creating either backup file. A live schema
        # can still change later, so snapshot() checks each copy again.
        _validate_role(main_db, "main", expected)
        _validate_role(metadata_db, "metadata", expected)
        report = {"kind": "online-backup-review", "crossDatabaseAtomic": False,
                  "finalMigration": False,
                  "main": snapshot(main_db, target / "main.sqlite", "main", expected),
                  "metadata": snapshot(metadata_db, target / "metadata.sqlite", "metadata", expected)}
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
