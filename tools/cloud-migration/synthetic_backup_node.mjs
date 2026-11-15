// Synthetic-only SQLite WAL backup rehearsal. No user-supplied paths accepted.
// Each database is backed up separately; there is no cross-database atomicity.
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdtempSync, openSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = 'lantern-synthetic-node-backup-v1';
const PREFIX = 'lantern-synthetic-node-backup-';
const BASE_ROWS = 64;
const PAIRS = new Map([
  ['main.sqlite', 'main-snapshot.sqlite'],
  ['metadata.sqlite', 'metadata-snapshot.sqlite'],
  ['main-snapshot.sqlite', 'main-restored.sqlite'],
  ['metadata-snapshot.sqlite', 'metadata-restored.sqlite'],
]);
const NAMES = new Set([...PAIRS.keys(), ...PAIRS.values()]);

function guard(root, file) {
  const tempRoot = realpathSync(tmpdir());
  if (root !== realpathSync(root) || dirname(root) !== tempRoot || !basename(root).startsWith(PREFIX) ||
      dirname(file) !== root || !NAMES.has(basename(file)) ||
      (existsSync(file) && lstatSync(file).isSymbolicLink())) {
    throw new Error('path is outside the synthetic fixture');
  }
}

function reserve(root, file) {
  guard(root, file);
  // SQLite's backup API overwrites destinations; reserve a new file first.
  // All paths are fixed children of our new private fixture directory.
  const fd = openSync(file, 'wx', 0o600);
  closeSync(fd);
}

function fixture(root, file, count) {
  reserve(root, file);
  const db = new DatabaseSync(file);
  try {
    if (db.prepare('PRAGMA journal_mode=WAL').get().journal_mode.toLowerCase() !== 'wal') {
      throw new Error('WAL mode unavailable');
    }
    db.exec('CREATE TABLE fixture_identity (value TEXT NOT NULL); CREATE TABLE events (seq INTEGER PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE ledger (event_count INTEGER NOT NULL); BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO fixture_identity VALUES (?)').run(FIXTURE);
      const insert = db.prepare('INSERT INTO events VALUES (?, ?)');
      for (let seq = 1; seq <= count; seq++) insert.run(seq, 'synthetic-' + 'x'.repeat(4096));
      db.prepare('INSERT INTO ledger VALUES (?)').run(count);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}

function append(db, seq, payload) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO events VALUES (?, ?)').run(seq, payload);
    db.exec('UPDATE ledger SET event_count = event_count + 1');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function identity(db) {
  const rows = db.prepare('SELECT value FROM fixture_identity').all();
  if (rows.length !== 1 || rows[0].value !== FIXTURE) throw new Error('not our synthetic fixture');
}

function readState(root, file) {
  guard(root, file);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    identity(db);
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('integrity check failed');
    const stats = db.prepare('SELECT COUNT(*) AS count, MIN(seq) AS min, MAX(seq) AS max, SUM(seq) AS total FROM events').get();
    const ledger = db.prepare('SELECT event_count FROM ledger').all();
    if (ledger.length !== 1 || ledger[0].event_count !== stats.count || stats.min !== 1 ||
        stats.max !== stats.count || stats.total !== stats.count * (stats.count + 1) / 2) {
      throw new Error('inconsistent synthetic transaction');
    }
    const hash = createHash('sha256');
    for (const row of db.prepare('SELECT seq, payload FROM events ORDER BY seq').iterate()) {
      hash.update(`${row.seq}:${Buffer.byteLength(row.payload, 'utf8')}:`);
      hash.update(row.payload, 'utf8');
    }
    return { count: stats.count, digest: hash.digest('hex') };
  } finally { db.close(); }
}

async function snapshot(root, source, destination, progress) {
  guard(root, source);
  guard(root, destination);
  if (PAIRS.get(basename(source)) !== basename(destination)) throw new Error('invalid synthetic backup pair');
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    identity(db);
    reserve(root, destination);
    await backup(db, destination, { rate: 1, ...(progress ? { progress } : {}) });
  } finally { db.close(); }
  return readState(root, destination);
}

export async function runSyntheticRehearsal() {
  const tempRoot = realpathSync(tmpdir());
  const root = realpathSync(mkdtempSync(join(tempRoot, PREFIX)));
  const main = join(root, 'main.sqlite');
  const metadata = join(root, 'metadata.sqlite');
  fixture(root, main, BASE_ROWS);
  fixture(root, metadata, 1);
  const keeper = new DatabaseSync(main);
  let writer;
  try {
    append(keeper, BASE_ROWS + 1, 'synthetic-uncheckpointed-wal');
    const wal = main + '-wal';
    if (!existsSync(wal) || statSync(wal).size === 0) throw new Error('committed synthetic WAL missing');
    writer = new DatabaseSync(main, { timeout: 5000 });
    let wroteDuringBackup = false;
    const mainState = await snapshot(root, main, join(root, 'main-snapshot.sqlite'), ({ remainingPages }) => {
      if (!wroteDuringBackup && remainingPages > 0) {
        append(writer, BASE_ROWS + 2, 'synthetic-concurrent');
        wroteDuringBackup = true;
      }
    });
    if (!wroteDuringBackup || mainState.count < BASE_ROWS + 1) {
      throw new Error('synthetic WAL/concurrent backup evidence missing');
    }
    const metadataState = await snapshot(root, metadata, join(root, 'metadata-snapshot.sqlite'));
    const restoredMain = await snapshot(root, join(root, 'main-snapshot.sqlite'), join(root, 'main-restored.sqlite'));
    const restoredMetadata = await snapshot(root, join(root, 'metadata-snapshot.sqlite'), join(root, 'metadata-restored.sqlite'));
    if (JSON.stringify(restoredMain) !== JSON.stringify(mainState) ||
        JSON.stringify(restoredMetadata) !== JSON.stringify(metadataState) ||
        readState(root, main).count !== BASE_ROWS + 2 || readState(root, metadata).count !== 1) {
      throw new Error('synthetic restore or source validation failed');
    }
    return { directory: root, mainRows: mainState.count, metadataRows: metadataState.count,
      writeDuringBackup: true, crossDatabaseAtomic: false };
  } finally {
    if (writer) writer.close();
    keeper.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run-synthetic') {
    console.error('Requires --run-synthetic; external source/target paths are not supported');
    process.exitCode = 2;
  } else {
    try {
      const result = await runSyntheticRehearsal();
      console.log('PASS synthetic WAL online backup and restore; write committed during backup');
      console.log('Individual databases only; cross-database atomicity is not established');
      console.log('Retained synthetic fixtures: ' + result.directory);
    } catch (error) {
      console.error('Synthetic rehearsal failed: ' + error.message);
      process.exitCode = 1;
    }
  }
}
