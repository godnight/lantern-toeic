import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
const wrapper = fileURLToPath(new URL('./online_backup_candidate.ps1', import.meta.url));
const setup = fileURLToPath(new URL('./synthetic_private_parent.ps1', import.meta.url));
const worker = fileURLToPath(new URL('./online_backup_worker.py', import.meta.url));

function ps(args, timeout = 45000) {
  return spawnSync('pwsh', ['-NoProfile', '-NonInteractive', ...args], { encoding: 'utf8', timeout });
}

function setupFixture(extraSetup = []) {
  const root = mkdtempSync(join(tmpdir(), 'lantern-online-fixture-'));
  const source = join(root, '合成 来源 (一)');
  mkdirSync(source);
  const result = ps(['-File', setup, '-FixtureRoot', root, ...extraSetup]);
  assert.equal(result.status, 0, result.stderr);
  const target = join(root, 'private-target 合成');
  const python = execFileSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  return { root, source, target, python };
}

function createDb(path, rows) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE fixture(id INTEGER PRIMARY KEY, value TEXT); BEGIN IMMEDIATE');
  const insert = db.prepare('INSERT INTO fixture VALUES(?, ?)');
  for (let index = 1; index <= rows; index++) insert.run(index, 'synthetic-' + 'x'.repeat(65536));
  db.exec('COMMIT');
  assert.ok(existsSync(path + '-wal'));
  assert.ok(existsSync(path + '-shm'));
  return db;
}

function args(fixture, extra = []) {
  return ['-File', wrapper, '-Enable', '-SourceRoot', fixture.source,
    '-MainRelative', 'main.sqlite', '-MetadataRelative', 'metadata.sqlite',
    '-TargetParent', fixture.target, '-PythonExecutable', fixture.python, ...extra];
}

function readCount(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare('SELECT COUNT(*) AS count FROM fixture').get().count; }
  finally { db.close(); }
}

function inspectAcl(path) {
  const command = `$a=Get-Acl -LiteralPath $env:LANTERN_SYNTHETIC_ACL_PATH
$rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object { [pscustomobject]@{sid=$_.IdentityReference.Value; rights=[int]$_.FileSystemRights; access=$_.AccessControlType.ToString()} })
[pscustomobject]@{ protected=$a.AreAccessRulesProtected; rules=$rules; current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value } | ConvertTo-Json -Compress -Depth 4`;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8', env: { ...process.env, LANTERN_SYNTHETIC_ACL_PATH: path }, timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

test('requires explicit enable before using any source or target', { skip: !windows }, () => {
  const result = ps(['-File', wrapper]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Explicit -Enable is required/);
  const direct = spawnSync('python', [worker], { input: '{}', encoding: 'utf8' });
  assert.notEqual(direct.status, 0);
  assert.match(direct.stderr, /ONLINE_BACKUP_FAILED/);
});

test('copies separate live WAL databases to a new private target and validates hashes', { skip: !windows, timeout: 60000 }, async () => {
  const f = setupFixture();
  const mainPath = join(f.source, 'main.sqlite');
  const metaPath = join(f.source, 'metadata.sqlite');
  const main = createDb(mainPath, 128);
  const metadata = createDb(metaPath, 1);
  const existing = join(f.target, 'previous-file.txt');
  writeFileSync(existing, 'synthetic-keep');
  let timer;
  let writes = 0;
  const writeTimes = [];
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', ...args(f)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', started = false;
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (!started && stdout.includes('ONLINE_BACKUP_STARTED')) {
          started = true;
          timer = setInterval(() => {
            if (writes >= 500) { clearInterval(timer); return; }
            const id = 129 + writes;
            try {
              main.prepare('INSERT INTO fixture VALUES (?, ?)').run(id, 'synthetic-concurrent');
              writeTimes.push(Date.now());
              writes++;
            } catch (error) { clearInterval(timer); reject(error); }
          }, 3);
        }
      });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => { clearInterval(timer); resolve({ code, stdout, stderr }); });
    });
    assert.equal(result.code, 0, result.stderr + '\n' + result.stdout);
    const match = result.stdout.match(/ONLINE_BACKUP_REVIEW_OK ([^\r\n]+)/);
    assert.ok(match, result.stdout);
    const output = match[1].trim();
    const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.crossDatabaseAtomic, false);
    assert.equal(manifest.finalMigration, false);
    assert.equal(manifest.main.integrity, 'ok');
    assert.equal(manifest.metadata.integrity, 'ok');
    assert.match(manifest.main.sha256, /^[0-9a-f]{64}$/);
    assert.match(manifest.metadata.sha256, /^[0-9a-f]{64}$/);
    for (const [name, file] of [['main', 'main.sqlite'], ['metadata', 'metadata.sqlite']]) {
      assert.equal(createHash('sha256').update(readFileSync(join(output, file))).digest('hex'), manifest[name].sha256);
    }
    const acl = inspectAcl(output);
    assert.equal(acl.protected, true);
    const fileAcl = inspectAcl(join(output, 'main.sqlite'));
    for (const observed of [acl, fileAcl]) {
      assert.deepEqual(observed.rules.map((rule) => rule.sid).sort(), [observed.current, 'S-1-5-18', 'S-1-5-32-544'].sort());
      for (const rule of observed.rules) {
        assert.equal(rule.access, 'Allow');
        assert.equal(rule.rights & 2032127, 2032127); // FileSystemRights.FullControl
      }
    }
    assert.equal(readFileSync(existing, 'utf8'), 'synthetic-keep');
    assert.equal(readCount(metaPath), 1);
    assert.equal(readCount(join(output, 'metadata.sqlite')), 1);
    assert.equal(readCount(mainPath), 128 + writes);
    assert.ok(readCount(join(output, 'main.sqlite')) >= 128);
    assert.ok(writeTimes.some((value) => value >= Date.parse(manifest.main.startUtc) && value <= Date.parse(manifest.main.endUtc)),
      'a different connection must commit during the main backup interval');
    assert.ok(existsSync(mainPath + '-wal'));
    assert.ok(existsSync(metaPath + '-wal'));
  } finally {
    clearInterval(timer);
    metadata.close(); main.close();
  }
});

test('rejects unprotected parent, links and missing WAL coordination files', { skip: !windows, timeout: 60000 }, () => {
  const f = setupFixture();
  const mainPath = join(f.source, 'main.sqlite');
  const main = createDb(mainPath, 1);
  const metadata = createDb(join(f.source, 'metadata.sqlite'), 1);
  try {
    const unprotected = join(f.root, 'unprotected'); mkdirSync(unprotected);
    const badParent = { ...f, target: unprotected };
    assert.notEqual(ps(args(badParent)).status, 0);
    assert.deepEqual(readdirSync(unprotected), []);

    const traversal = ps(['-File', wrapper, '-Enable', '-SourceRoot', f.source,
      '-MainRelative', '..\\main.sqlite', '-MetadataRelative', 'metadata.sqlite',
      '-TargetParent', f.target, '-PythonExecutable', f.python]);
    assert.notEqual(traversal.status, 0);
    assert.deepEqual(readdirSync(f.target), []);
    assert.notEqual(ps(args({ ...f, target: f.source })).status, 0);

    const junction = join(f.root, 'source-junction');
    symlinkSync(f.source, junction, 'junction');
    assert.notEqual(ps(args({ ...f, source: junction })).status, 0);
    assert.deepEqual(readdirSync(f.target), []);

    const targetJunction = join(f.root, 'target-junction');
    symlinkSync(f.target, targetJunction, 'junction');
    assert.notEqual(ps(args({ ...f, target: targetJunction })).status, 0);
    assert.deepEqual(readdirSync(f.target), []);

    linkSync(mainPath, join(f.source, 'hard.sqlite'));
    assert.notEqual(ps(['-File', wrapper, '-Enable', '-SourceRoot', f.source,
      '-MainRelative', 'hard.sqlite', '-MetadataRelative', 'metadata.sqlite',
      '-TargetParent', f.target, '-PythonExecutable', f.python]).status, 0);
    assert.deepEqual(readdirSync(f.target), []);

    writeFileSync(join(f.source, 'missing.sqlite'), 'synthetic');
    assert.notEqual(ps(['-File', wrapper, '-Enable', '-SourceRoot', f.source,
      '-MainRelative', 'missing.sqlite', '-MetadataRelative', 'metadata.sqlite',
      '-TargetParent', f.target, '-PythonExecutable', f.python]).status, 0);
    assert.deepEqual(readdirSync(f.target), []);
  } finally { metadata.close(); main.close(); }
});

test('rejects a protected parent that grants an additional principal', { skip: !windows, timeout: 30000 }, () => {
  const f = setupFixture(['-IncludeEveryone']);
  const main = createDb(join(f.source, 'main.sqlite'), 1);
  const metadata = createDb(join(f.source, 'metadata.sqlite'), 1);
  try {
    assert.notEqual(ps(args(f)).status, 0);
    assert.deepEqual(readdirSync(f.target), []);
  } finally { metadata.close(); main.close(); }
});

test('exclusive directory creation rejects existing target without changes', { skip: !windows, timeout: 30000 }, () => {
  const f = setupFixture();
  const marker = join(f.target, 'synthetic-marker.txt');
  writeFileSync(marker, 'keep');
  const guard = fileURLToPath(new URL('./windows_handle_guard.cs', import.meta.url));
  const command = `Add-Type -Path $env:LANTERN_SYNTHETIC_GUARD
try { [LanternMigrationPathGuard]::CreateDirectoryExclusive($env:LANTERN_SYNTHETIC_TARGET); exit 9 }
catch { Write-Output 'EXISTING_TARGET_REFUSED' }`;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8', env: { ...process.env, LANTERN_SYNTHETIC_GUARD: guard, LANTERN_SYNTHETIC_TARGET: f.target }, timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /EXISTING_TARGET_REFUSED/);
  assert.equal(readFileSync(marker, 'utf8'), 'keep');
});

for (const kind of ['file', 'directory']) test(`held ${kind} cannot be renamed until the guarded handle is closed`, { skip: !windows, timeout: 30000 }, async () => {
  const f = setupFixture();
  const file = join(f.source, 'synthetic-locked');
  const renamed = join(f.source, 'synthetic-renamed');
  if (kind === 'file') writeFileSync(file, 'synthetic');
  else mkdirSync(file);
  const guard = fileURLToPath(new URL('./windows_handle_guard.cs', import.meta.url));
  const command = `Add-Type -Path $env:LANTERN_SYNTHETIC_GUARD
$h=[LanternMigrationPathGuard]::Hold($env:LANTERN_SYNTHETIC_FILE, ($env:LANTERN_SYNTHETIC_DIRECTORY -eq 'yes'))
[Console]::WriteLine('SYNTHETIC_HELD'); [Console]::Out.Flush()
[void][Console]::ReadLine(); $h.Dispose()`;
  const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LANTERN_SYNTHETIC_GUARD: guard, LANTERN_SYNTHETIC_FILE: file,
      LANTERN_SYNTHETIC_DIRECTORY: kind === 'directory' ? 'yes' : 'no' } });
  const exited = new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (part) => { stderr += part; });
    child.on('error', reject); child.on('close', (code) => resolve({ code, stderr }));
  });
  try {
    await new Promise((resolve, reject) => {
      let stdout = '';
      child.stdout.setEncoding('utf8'); child.stdout.on('data', (part) => {
        stdout += part;
        if (stdout.includes('SYNTHETIC_HELD')) resolve();
      });
      child.on('error', reject);
      child.on('close', (code) => reject(new Error('guard exited before ready: ' + code)));
    });
    assert.equal(child.exitCode, null, 'guard process must remain alive');
    assert.throws(() => renameSync(file, renamed));
    assert.ok(existsSync(file));
  } finally { child.stdin.end('\n'); }
  const result = await exited;
  assert.equal(result.code, 0, result.stderr);
  renameSync(file, renamed);
  assert.ok(existsSync(renamed));
});

test('failure removes only known partial files and preserves synthetic sources', { skip: !windows, timeout: 60000 }, () => {
  const f = setupFixture();
  const mainPath = join(f.source, 'main.sqlite');
  const main = createDb(mainPath, 1);
  const meta = join(f.source, 'metadata.sqlite');
  writeFileSync(meta, 'synthetic-not-a-sqlite-database');
  writeFileSync(meta + '-wal', 'synthetic');
  writeFileSync(meta + '-shm', 'synthetic');
  try {
    const result = ps(args(f));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /known-partial-files-removed/);
    assert.equal(readFileSync(meta, 'utf8'), 'synthetic-not-a-sqlite-database');
    assert.equal(readCount(mainPath), 1);
    const created = readdirSync(f.target);
    assert.equal(created.length, 1);
    assert.deepEqual(readdirSync(join(f.target, created[0])), []);
  } finally { main.close(); }
});

test('failure retains the private directory if an unexpected object appears', { skip: !windows, timeout: 60000 }, async () => {
  const f = setupFixture();
  const main = createDb(join(f.source, 'main.sqlite'), 64);
  const meta = join(f.source, 'metadata.sqlite');
  writeFileSync(meta, 'synthetic-invalid');
  writeFileSync(meta + '-wal', 'synthetic');
  writeFileSync(meta + '-shm', 'synthetic');
  let sentinel;
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', ...args(f)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (!sentinel && stdout.includes('ONLINE_BACKUP_STARTED')) {
          try {
            const [dir] = readdirSync(f.target);
            sentinel = join(f.target, dir, 'unknown-synthetic.txt');
            writeFileSync(sentinel, 'keep');
          } catch (error) { reject(error); }
        }
      });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /private-incomplete-retained/);
    assert.ok(sentinel);
    assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
    assert.equal(readFileSync(meta, 'utf8'), 'synthetic-invalid');
  } finally { main.close(); }
});

test('failure never cleans a hard-linked source through a known target name', { skip: !windows, timeout: 60000 }, async () => {
  const f = setupFixture();
  const source = join(f.source, 'main.sqlite');
  const main = createDb(source, 64);
  const meta = join(f.source, 'metadata.sqlite');
  writeFileSync(meta, 'synthetic-invalid');
  writeFileSync(meta + '-wal', 'synthetic');
  writeFileSync(meta + '-shm', 'synthetic');
  let linked;
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', ...args(f)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (!linked && stdout.includes('ONLINE_BACKUP_STARTED')) {
          try {
            const [dir] = readdirSync(f.target);
            linked = join(f.target, dir, 'manifest.json');
            linkSync(source, linked);
          } catch (error) { reject(error); }
        }
      });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /private-incomplete-retained/);
    assert.ok(linked && existsSync(linked));
    assert.equal(readCount(source), 64);
    assert.equal(statSync(source).nlink, 2);
  } finally { main.close(); }
});
