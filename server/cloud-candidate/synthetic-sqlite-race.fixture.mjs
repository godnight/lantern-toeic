// Child process for the synthetic-only SQLite writer race test.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import { realpathSync } from 'node:fs';
import { createSyntheticSqliteD1 } from './synthetic-sqlite-d1.candidate.mjs';

const [file, id] = process.argv.slice(2);
const dir = file && realpathSync.native(path.dirname(file));
if (!process.send) throw Error('synthetic fixture IPC required');
if (!file || path.basename(file) !== 'synthetic-only.sqlite') throw Error('synthetic fixture file required');
if (path.dirname(dir) !== realpathSync.native(os.tmpdir()) || !path.basename(dir).startsWith('lantern-sqlite-race-')) throw Error('synthetic fixture directory required');
if (!/^candidate-[12]$/.test(id)) throw Error('synthetic fixture ID required');
const sqlite = new DatabaseSync(file);
sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
const db = createSyntheticSqliteD1({ enabled: true, database: sqlite });
process.on('message', async message => {
  if (message !== 'go') return;
  try {
    const results = await db.batch([
      db.prepare('INSERT INTO users(id,name) VALUES(?,?) ON CONFLICT(name) DO NOTHING').bind(id, 'same-name'),
      db.prepare('INSERT INTO credentials(user_id) SELECT id FROM users WHERE id=?').bind(id),
    ]);
    process.send({ done: true, changes: results.map(result => result.meta.changes) });
  } catch { process.send({ done: true, error: 'synthetic write failed' }); process.exitCode = 1; }
  finally { sqlite.close(); process.disconnect(); }
});
process.send({ ready: true });
