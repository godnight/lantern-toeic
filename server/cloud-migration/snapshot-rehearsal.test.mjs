import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
const here = fileURLToPath(new URL('./snapshot-rehearsal.ps1', import.meta.url));
const worker = fileURLToPath(new URL('./snapshot-rehearsal.py', import.meta.url));
const backup = fileURLToPath(new URL('../../tools/cloud-migration/online_backup_candidate.ps1', import.meta.url));
const setup = fileURLToPath(new URL('../../tools/cloud-migration/synthetic_private_parent.ps1', import.meta.url));
const migrations = [
  ['0000_product_auth.sql', '343816721b4a8bd71b107de663dd672def7d54f86663234f606d2c749aab7628', '0005_product_auth.sql'],
  ['0001_auth_admission_ticket.sql', '58d6fd8a377930234719104a61ea41487f5db322b92ffbc79aa0399bc6af87d1', '0006_auth_admission_ticket.sql'],
  ['0002_huawei_auth.sql', 'd41bb1b0f4e3a66bb1582443ad1357336e14e4f7c07e94f24989fd66a8e5fd8b', '0009_huawei_auth.sql'],
];
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const ps = args => spawnSync('pwsh', ['-NoProfile', '-NonInteractive', ...args], { encoding: 'utf8', timeout: 45000 });

function snapshot() {
  const root = mkdtempSync(join(tmpdir(), 'lantern-online-fixture-'));
  const source = join(root, '合成 来源'); mkdirSync(source);
  const setupResult = ps(['-File', setup, '-FixtureRoot', root]);
  assert.equal(setupResult.status, 0, setupResult.stderr);
  const parent = join(root, 'private-target 合成');
  const python = execFileSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  const main = new DatabaseSync(join(source, 'main.sqlite'));
  const meta = new DatabaseSync(join(source, 'metadata.sqlite'));
  try {
    main.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA foreign_keys=ON');
    main.exec('CREATE TABLE _cf_METADATA (\n        key INTEGER PRIMARY KEY,\n        value BLOB\n      )');
    main.exec('CREATE TABLE _lantern_local_migrations (name TEXT PRIMARY KEY, sha TEXT NOT NULL)');
    for (const [name, digest, file] of migrations) {
      const sql = readFileSync(new URL('../../drizzle/' + file, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
      for (const statement of sql.split('--> statement-breakpoint')) if (statement.trim()) main.exec(statement.trim());
      main.prepare('INSERT INTO _lantern_local_migrations VALUES (?, ?)').run(name, digest);
    }
    main.prepare('INSERT INTO auth_users VALUES (?,?,?)').run('synthetic-owner', 'synthetic-user', 1);
    main.prepare('INSERT INTO auth_password_credentials VALUES (?,?)').run('synthetic-owner', 'synthetic-hash');
    main.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?)').run('synthetic-token-hash', 'synthetic-owner', 1, 2);
    main.prepare('INSERT INTO auth_provider_bindings VALUES (?,?,?,?,?)').run('huawei', 'synthetic-audience', 'synthetic-subject', 'synthetic-owner', 1);
    main.prepare('INSERT INTO _cf_METADATA VALUES (?,?)').run(1, new Uint8Array([1, 2]));
    meta.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
    meta.exec('CREATE TABLE _cf_ALARM (\n      actor_id TEXT PRIMARY KEY,\n      scheduled_time INTEGER\n    ) WITHOUT ROWID');
    meta.prepare('INSERT INTO _cf_ALARM VALUES (?,?)').run('synthetic-actor', 1);
    const result = ps(['-File', backup, '-Enable', '-SourceRoot', source, '-MainRelative', 'main.sqlite',
      '-MetadataRelative', 'metadata.sqlite', '-TargetParent', parent, '-PythonExecutable', python]);
    assert.equal(result.status, 0, result.stderr);
    const match = result.stdout.match(/ONLINE_BACKUP_REVIEW_OK ([^\r\n]+)/);
    assert.ok(match, result.stdout);
    return { root, directory: match[1].trim(), python };
  } finally { main.close(); meta.close(); }
}

function run(f) { return ps(['-File', here, '-Enable', '-SnapshotDirectory', f.directory, '-PythonExecutable', f.python]); }
function refreshManifest(f, role) {
  const file = join(f.directory, 'manifest.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data[role].sha256 = hash(join(f.directory, role + '.sqlite'));
  writeFileSync(file, JSON.stringify(data) + '\n');
}

test('requires explicit enable and rejects direct worker invocation', { skip: !windows }, () => {
  const result = ps(['-File', here]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Explicit -Enable/);
  const direct = spawnSync('python', ['-I', worker], { input: '{}', encoding: 'utf8' });
  assert.notEqual(direct.status, 0);
  assert.match(direct.stderr, /SNAPSHOT_REHEARSAL_FAILED/);
});

test('rehearses a private legacy snapshot in RAM without changing source bytes', { skip: !windows, timeout: 60000 }, () => {
  const f = snapshot();
  const before = ['main.sqlite', 'metadata.sqlite', 'manifest.json'].map(name => hash(join(f.directory, name)));
  const result = run(f);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SNAPSHOT_REHEARSAL_OK/);
  assert.deepEqual(['main.sqlite', 'metadata.sqlite', 'manifest.json'].map(name => hash(join(f.directory, name))), before);
  for (const name of ['main.sqlite', 'metadata.sqlite']) for (const suffix of ['-wal', '-shm', '-journal']) {
    assert.equal(existsSync(join(f.directory, name + suffix)), false);
  }
});

test('all four data connections use verified memory-only temporary storage', { skip: !windows, timeout: 60000 }, () => {
  const f = snapshot();
  const probe = `
import importlib.util, pathlib, sqlite3, sys
spec = importlib.util.spec_from_file_location('rehearsal', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
rules = module.load_reviewed_rules()
expected = rules._expected_schemas()
rules._expected_schemas = lambda: expected
module.load_reviewed_rules = lambda: rules
closed = []
class RecordingConnection(sqlite3.Connection):
    def close(self):
        closed.append(self.execute('PRAGMA temp_store').fetchone()[0])
        super().close()
original = sqlite3.connect
def tracked(*args, **kwargs):
    kwargs['factory'] = RecordingConnection
    return original(*args, **kwargs)
sqlite3.connect = tracked
module.run(pathlib.Path(sys.argv[2]))
assert closed == [2, 2, 2, 2], 'every data connection must use MEMORY'
`;
  const result = spawnSync(f.python, ['-I', '-c', probe, worker, f.directory], { encoding: 'utf8', timeout: 45000 });
  assert.equal(result.status, 0, result.stderr);
});

test('rejects altered manifest and unexpected SQLite sidecars', { skip: !windows, timeout: 60000 }, () => {
  const f = snapshot();
  const manifest = join(f.directory, 'manifest.json');
  const original = readFileSync(manifest);
  const data = JSON.parse(readFileSync(manifest, 'utf8'));
  data.main.sha256 = '0'.repeat(64); writeFileSync(manifest, JSON.stringify(data));
  assert.notEqual(run(f).status, 0);
  writeFileSync(manifest, original.toString().replace('{', '{"kind":"online-backup-review",'));
  assert.notEqual(run(f).status, 0, 'duplicate keys rejected');
  const invalidTime = JSON.parse(original.toString());
  invalidTime.main.startUtc = 'not-a-time';
  writeFileSync(manifest, JSON.stringify(invalidTime));
  assert.notEqual(run(f).status, 0, 'invalid timestamp rejected');
  writeFileSync(manifest, original);
  writeFileSync(join(f.directory, 'main.sqlite-wal'), 'synthetic');
  assert.notEqual(run(f).status, 0);
});

test('rejects unknown schema, altered ledger and orphaned records even with a recomputed manifest', { skip: !windows, timeout: 60000 }, () => {
  for (const scenario of ['schema', 'ledger', 'foreign-key']) {
    const f = snapshot();
    const main = new DatabaseSync(join(f.directory, 'main.sqlite'));
    try {
      if (scenario === 'schema') main.exec('CREATE TABLE synthetic_unreviewed (id TEXT)');
      else if (scenario === 'ledger') main.exec("UPDATE _lantern_local_migrations SET sha='synthetic-invalid' WHERE name='0000_product_auth.sql'");
      else main.exec("PRAGMA foreign_keys=OFF; INSERT INTO auth_sessions VALUES ('synthetic-orphan','missing-user',1,2)");
    } finally { main.close(); }
    refreshManifest(f, 'main');
    assert.notEqual(run(f).status, 0, scenario);
  }
});
