// Read-only verification against this exact repository's reviewed auth SQL.
// This is not a migration or recovery tool.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const migrations = ['0005_product_auth.sql', '0006_auth_admission_ticket.sql', '0009_huawei_auth.sql'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyAccountDatabase(db) {
  if (!db || typeof db.prepare !== 'function') throw Error('database unavailable');
  const expectedDb = new DatabaseSync(':memory:'), allowed = new Map();
  try {
    for (const name of migrations) {
      const text = await readFile(new URL('../../drizzle/' + name, import.meta.url), 'utf8');
      const lf = text.replace(/\r\n/g, '\n');
      allowed.set(name, new Set([digest(lf), digest(lf.replace(/\n/g, '\r\n'))]));
      expectedDb.exec(lf);
    }
    const query = "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name LIKE 'auth\\_%' ESCAPE '\\' AND sql IS NOT NULL ORDER BY type,name";
    const expected = expectedDb.prepare(query).all().map(row => ({ ...row, sql: row.sql.replace(/\r\n/g, '\n') }));
    const actual = (await db.prepare(query).all()).results.map(row => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql.replace(/\r\n/g, '\n') }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('account schema mismatch');
    const ledger = (await db.prepare('SELECT name,sha FROM _lantern_local_migrations WHERE name IN (?,?,?)').bind(...migrations).all()).results;
    if (ledger.length !== migrations.length || ledger.some(row => !allowed.get(row.name)?.has(row.sha))) throw Error('account migration ledger mismatch');
  } finally { expectedDb.close(); }
}
