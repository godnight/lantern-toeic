import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSyntheticRehearsal } from './synthetic_backup_node.mjs';

const script = fileURLToPath(new URL('./synthetic_backup_node.mjs', import.meta.url));

function rows(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    return db.prepare('SELECT seq, payload FROM events ORDER BY seq').all();
  } finally { db.close(); }
}

test('requires explicit opt-in and rejects source or destination arguments', () => {
  const outsider = join(mkdtempSync(join(tmpdir(), 'lantern-synthetic-outside-')), 'main.sqlite');
  writeFileSync(outsider, 'not a database');
  for (const args of [[], ['--run-synthetic', '--source', outsider]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout, /PASS synthetic/);
    assert.equal(readFileSync(outsider, 'utf8'), 'not a database');
  }
});

test('backs up committed WAL and a concurrent transaction, then independently restores both fixtures', async () => {
  const result = await runSyntheticRehearsal();
  const root = realpathSync(result.directory);
  assert.equal(dirname(root), realpathSync(tmpdir()));
  assert.equal(result.writeDuringBackup, true);
  assert.equal(result.crossDatabaseAtomic, false);
  assert.ok([65, 66].includes(result.mainRows));
  assert.equal(result.metadataRows, 1);
  const source = rows(join(root, 'main.sqlite'));
  const snapshot = rows(join(root, 'main-snapshot.sqlite'));
  const restored = rows(join(root, 'main-restored.sqlite'));
  assert.equal(source.length, 66);
  assert.equal(source[64].payload, 'synthetic-uncheckpointed-wal');
  assert.equal(source[65].payload, 'synthetic-concurrent');
  assert.equal(snapshot.length, result.mainRows);
  assert.equal(snapshot[64].payload, 'synthetic-uncheckpointed-wal');
  assert.deepEqual(restored, snapshot);
  assert.deepEqual(rows(join(root, 'metadata-restored.sqlite')), rows(join(root, 'metadata-snapshot.sqlite')));
  assert.equal(rows(join(root, 'metadata.sqlite')).length, 1);
});

test('standalone CLI runs only after opt-in', () => {
  const output = execFileSync(process.execPath, [script, '--run-synthetic'], { encoding: 'utf8', timeout: 15000 });
  assert.match(output, /PASS synthetic WAL online backup and restore/);
  assert.match(output, /cross-database atomicity is not established/);
});
