// Read-only verification against this exact repository's reviewed auth SQL.
// This is not a migration or recovery tool.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// Pinned reviewed bytes. Line ending conversion is the only accepted variant.
const migrations = Object.freeze({
  '0005_product_auth.sql': ['1b88f0e2df5224f5115031bf52696c7d19ee6043a99a6c6cfa4f66607bebf04c', '343816721b4a8bd71b107de663dd672def7d54f86663234f606d2c749aab7628'],
  '0006_auth_admission_ticket.sql': ['a547206b73bb57f2bfd9e76c83d15e4303354f299754d9ffbfd1e95fd3d84d2c', '58d6fd8a377930234719104a61ea41487f5db322b92ffbc79aa0399bc6af87d1'],
  '0007_phone_auth.sql': ['4c9cbfa1a1b7554556b464f128ccb6dae9fed183b008b614ef7dba2d779112f4', '1c9e0334bf1f532bd9f201b9b36c886bc008d255d88270706b20e44ebeee1144'],
  '0008_phone_challenges.sql': ['d1eb16b49e5a36decfc87506fb06f6fbaa5815d88375a08fc907cc15f3900bd5', 'e529b5f26ffb853116c2d82c3cccbecb453b67e19b53a587a4a06f9b8e373cd5'],
  '0009_huawei_auth.sql': ['d41bb1b0f4e3a66bb1582443ad1357336e14e4f7c07e94f24989fd66a8e5fd8b', '18693a1dc2656fb22784a871e4ca23459288498c7abcf55e6070d902ec78773e'],
});
const base = ['0005_product_auth.sql', '0006_auth_admission_ticket.sql', '0009_huawei_auth.sql'];
const phone = ['0007_phone_auth.sql', '0008_phone_challenges.sql'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyAccountDatabase(db) {
  if (!db || typeof db.prepare !== 'function') throw Error('database unavailable');
  const expectedDb = new DatabaseSync(':memory:');
  try {
    const ledger = (await db.prepare('SELECT name,sha FROM _lantern_local_migrations WHERE name IN (?,?,?,?,?)').bind(...Object.keys(migrations)).all()).results;
    if (!Array.isArray(ledger)) throw Error('account migration ledger mismatch');
    const found = new Set();
    for (const row of ledger) {
      if (!row || !Object.hasOwn(migrations, row.name) || found.has(row.name) || !migrations[row.name].includes(row.sha)) throw Error('account migration ledger mismatch');
      found.add(row.name);
    }
    if (base.some(name => !found.has(name)) || found.has(phone[0]) !== found.has(phone[1])) throw Error('account migration ledger mismatch');
    const selected = found.has(phone[0]) ? [...base.slice(0, 2), ...phone, base[2]] : base;
    for (const name of selected) {
      const text = await readFile(new URL('../../drizzle/' + name, import.meta.url), 'utf8');
      const lf = text.replace(/\r\n/g, '\n');
      if (digest(lf) !== migrations[name][0] || digest(lf.replace(/\n/g, '\r\n')) !== migrations[name][1]) throw Error('reviewed account migration changed');
      expectedDb.exec(lf);
    }
    const query = "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name LIKE 'auth\\_%' ESCAPE '\\' AND sql IS NOT NULL ORDER BY type,name";
    const expected = expectedDb.prepare(query).all().map(row => ({ ...row, sql: row.sql.replace(/\r\n/g, '\n') }));
    const actual = (await db.prepare(query).all()).results.map(row => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql.replace(/\r\n/g, '\n') }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('account schema mismatch');
  } finally { expectedDb.close(); }
}
