"""Internal worker for snapshot-rehearsal.ps1. Never writes a database file.

Both inputs must be self-contained online-backup review snapshots.  The
ledger mapping occurs only in RAM.  The manifest is not an identity proof and
independent database snapshots do not establish a consistent cutover point.
"""

import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import struct
import sys


def load_reviewed_rules():
    worker = Path(__file__).resolve().parents[2] / 'tools/cloud-migration/online_backup_worker.py'
    spec = importlib.util.spec_from_file_location('lantern_backup_reviewed_rules', worker)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest_file(file):
    result = hashlib.sha256()
    with open(file, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def identity(file):
    st = file.stat()
    return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns)


def assert_no_sidecars(directory):
    if {entry.name for entry in directory.iterdir()} != {'main.sqlite', 'metadata.sqlite', 'manifest.json'}:
        raise RuntimeError('snapshot is not self-contained')
    for name in ('main.sqlite', 'metadata.sqlite'):
        for suffix in ('-wal', '-shm', '-journal'):
            if (directory / (name + suffix)).exists():
                raise RuntimeError('snapshot has sidecars')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RuntimeError('duplicate manifest key')
        result[key] = value
    return result


def verified_manifest(directory):
    assert_no_sidecars(directory)
    file = directory / 'manifest.json'
    if file.stat().st_size > 16384:
        raise RuntimeError('invalid manifest')
    data = json.loads(file.read_text(encoding='utf-8'), object_pairs_hook=unique_object)
    if (not isinstance(data, dict) or set(data) != {'kind', 'crossDatabaseAtomic', 'finalMigration', 'main', 'metadata'} or
            data['kind'] != 'online-backup-review' or data['crossDatabaseAtomic'] is not False or data['finalMigration'] is not False):
        raise RuntimeError('invalid manifest')
    for role, expected in (('main', 'legacy-auth'), ('metadata', 'miniflare-metadata')):
        item = data[role]
        if (not isinstance(item, dict) or set(item) != {'role', 'startUtc', 'endUtc', 'sha256', 'integrity'} or
                item['role'] != expected or item['integrity'] != 'ok' or not isinstance(item['startUtc'], str) or
                not item['startUtc'] or not isinstance(item['endUtc'], str) or not item['endUtc'] or
                not isinstance(item['sha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', item['sha256'])):
            raise RuntimeError('invalid manifest')
        start = datetime.datetime.fromisoformat(item['startUtc'])
        end = datetime.datetime.fromisoformat(item['endUtc'])
        if start.utcoffset() != datetime.timedelta(0) or end.utcoffset() != datetime.timedelta(0) or start > end:
            raise RuntimeError('invalid manifest timestamps')
        if (directory / (role + '.sqlite')).stat().st_size > 256 * 1024 * 1024:
            raise RuntimeError('snapshot too large for in-memory rehearsal')
        if digest_file(directory / (role + '.sqlite')) != item['sha256']:
            raise RuntimeError('snapshot digest mismatch')
    return data


def content_fingerprint(db):
    """Hash typed ordered rows in memory; neither values nor digests are output."""
    result = {}
    tables = [row[0] for row in db.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name")]
    for table in tables:
        if table == '_lantern_local_migrations':
            continue
        quoted = '"' + table.replace('"', '""') + '"'
        columns = db.execute('PRAGMA table_info(' + quoted + ')').fetchall()
        if not columns:
            raise RuntimeError('invalid table')
        order = ','.join(str(index) for index in range(1, len(columns) + 1))
        hashed, count = hashlib.sha256(), 0
        for row in db.execute('SELECT * FROM ' + quoted + ' ORDER BY ' + order):
            count += 1
            for value in row:
                if value is None:
                    tag, encoded = b'n', b''
                elif isinstance(value, bytes):
                    tag, encoded = b'b', value
                elif isinstance(value, str):
                    tag, encoded = b's', value.encode('utf-8')
                elif isinstance(value, int):
                    tag, encoded = b'i', str(value).encode('ascii')
                elif isinstance(value, float):
                    tag, encoded = b'f', struct.pack('>d', value)
                else:
                    raise RuntimeError('unsupported SQLite value')
                hashed.update(tag + len(encoded).to_bytes(8, 'big') + encoded)
        result[table] = (count, hashed.digest())
    return result


def integrity(db):
    if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchone() is not None:
        raise RuntimeError('integrity check failed')


def connect_memory_temp(database, **kwargs):
    db = sqlite3.connect(database, **kwargs)
    try:
        db.execute('PRAGMA temp_store=MEMORY')
        if db.execute('PRAGMA temp_store').fetchone() != (2,):
            raise RuntimeError('in-memory temporary storage unavailable')
        return db
    except Exception:
        db.close()
        raise


def run(directory):
    rules = load_reviewed_rules()
    expected = rules._expected_schemas()
    before = {name: identity(directory / name) for name in ('manifest.json', 'main.sqlite', 'metadata.sqlite')}
    manifest = verified_manifest(directory)
    source = connect_memory_temp((directory / 'main.sqlite').as_uri() + '?mode=ro&immutable=1', uri=True)
    metadata = connect_memory_temp((directory / 'metadata.sqlite').as_uri() + '?mode=ro&immutable=1', uri=True)
    memory = connect_memory_temp(':memory:')
    metadata_memory = connect_memory_temp(':memory:')
    try:
        for db, role in ((source, 'main'), (metadata, 'metadata')):
            db.execute('PRAGMA query_only=ON')
            rules._validate_role(db, role, expected)
            integrity(db)
        source.backup(memory)
        metadata.backup(metadata_memory)
        rules._validate_role(metadata_memory, 'metadata', expected)
        integrity(metadata_memory)
        if content_fingerprint(metadata_memory) != content_fingerprint(metadata):
            raise RuntimeError('metadata snapshot copy mismatch')
        memory.execute('PRAGMA foreign_keys=ON')
        rules._validate_role(memory, 'main', expected)
        integrity(memory)
        original = content_fingerprint(source)
        if content_fingerprint(memory) != original:
            raise RuntimeError('snapshot copy mismatch')
        memory.execute('BEGIN IMMEDIATE')
        try:
            for old, old_hash, current, lf_hash in rules._MIGRATIONS:
                cursor = memory.execute('UPDATE _lantern_local_migrations SET name=?,sha=? WHERE name=? AND sha=?',
                                        (current, lf_hash, old, old_hash))
                if cursor.rowcount != 1:
                    raise RuntimeError('ledger changed')
            memory.commit()
        except Exception:
            memory.rollback()
            raise
        target_ledger = sorted((current, lf_hash) for _old, _old_hash, current, lf_hash in rules._MIGRATIONS)
        if memory.execute('SELECT name,sha FROM _lantern_local_migrations ORDER BY name').fetchall() != target_ledger:
            raise RuntimeError('target ledger mismatch')
        if rules._schema(memory) != expected['main'] or content_fingerprint(memory) != original:
            raise RuntimeError('mapped account records differ')
        integrity(memory)
    finally:
        metadata_memory.close()
        memory.close()
        metadata.close()
        source.close()
    # The native wrapper keeps path handles while this work is underway.  Also
    # re-read the manifest and every digest; same-account malicious replacement
    # and cross-database temporal consistency are outside this rehearsal.
    if ({name: identity(directory / name) for name in before} != before or verified_manifest(directory) != manifest):
        raise RuntimeError('snapshot changed during rehearsal')


def main():
    guard = os.environ.pop('LANTERN_SNAPSHOT_REHEARSAL_GUARD', '')
    request = json.load(sys.stdin)
    if (len(sys.argv) != 1 or not re.fullmatch(r'[0-9a-f]{64}', guard) or
            set(request) != {'guard', 'directory'} or not secrets.compare_digest(guard, request.get('guard', ''))):
        raise RuntimeError('guarded wrapper required')
    directory = Path(request['directory'])
    if not directory.is_absolute():
        raise RuntimeError('absolute snapshot directory required')
    run(directory)
    print('SNAPSHOT_REHEARSAL_OK')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Never log file contents, records, credentials, digests or paths.
        print('SNAPSHOT_REHEARSAL_FAILED:' + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
