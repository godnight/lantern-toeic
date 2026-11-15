import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { verifyAccountDatabase } from './account-db-preflight.candidate.mjs';
import { buildAccountWorker } from './build-inputs.mjs';

const base = ['0005_product_auth.sql', '0006_auth_admission_ticket.sql', '0009_huawei_auth.sql'];
const phone = ['0007_phone_auth.sql', '0008_phone_challenges.sql'];
const digest = value => createHash('sha256').update(value).digest('hex');
async function fixture({ withPhone = false, format = 'lf', extraSql } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE _lantern_local_migrations(name TEXT PRIMARY KEY,sha TEXT NOT NULL)');
  const names = withPhone ? [...base.slice(0, 2), ...phone, base[2]] : base;
  for (let i = 0; i < names.length; i++) {
    const name = names[i], raw = await readFile(new URL('../../drizzle/' + name, import.meta.url), 'utf8'), lf = raw.replace(/\r\n/g, '\n');
    const sql = format === 'source' ? raw : format === 'crlf' || (format === 'mixed' && i % 2) ? lf.replace(/\n/g, '\r\n') : lf;
    db.exec(extraSql?.name === name ? extraSql.change(sql) : sql);
    db.prepare('INSERT INTO _lantern_local_migrations(name,sha) VALUES (?,?)').run(name, digest(sql));
  }
  const d1 = { prepare(sql) { return { async all() { return { results: db.prepare(sql).all() }; }, bind(...args) { return { async all() { return { results: db.prepare(sql).all(...args) }; } }; } }; } };
  return { db, d1 };
}

test('both reviewed versions accept only exact LF, CRLF and mixed line endings', async () => {
  for (const withPhone of [false, true]) for (const format of ['source', 'lf', 'crlf', 'mixed']) {
    const { db, d1 } = await fixture({ withPhone, format });
    try { await verifyAccountDatabase(d1); } finally { db.close(); }
  }
});
test('partial, missing, duplicated or altered migration ledgers fail closed', async () => {
  for (const mutation of [
    "DELETE FROM _lantern_local_migrations WHERE name='0005_product_auth.sql'",
    "DELETE FROM _lantern_local_migrations WHERE name='0007_phone_auth.sql'",
    "UPDATE _lantern_local_migrations SET sha='bad' WHERE name='0008_phone_challenges.sql'",
  ]) {
    const { db, d1 } = await fixture({ withPhone: true });
    try { db.exec(mutation); await assert.rejects(verifyAccountDatabase(d1), /ledger mismatch/); } finally { db.close(); }
  }
  const ledger = await Promise.all(base.map(async name => ({ name, sha: digest(await readFile(new URL('../../drizzle/' + name, import.meta.url), 'utf8')) })));
  ledger.push({ ...ledger[0] });
  const duplicate = { prepare() { return { bind() { return { async all() { return { results: ledger }; } }; } }; } };
  await assert.rejects(verifyAccountDatabase(duplicate), /ledger mismatch/);
  await assert.rejects(verifyAccountDatabase({ prepare() { throw Error('database unavailable'); } }), /database unavailable/);
});
test('missing or changed account and phone schema objects are rejected', async () => {
  for (const [withPhone, mutation] of [
    [false, 'DROP INDEX auth_sessions_expiry'],
    [false, 'ALTER TABLE auth_users ADD COLUMN unexpected TEXT'],
    [true, 'DROP INDEX auth_phone_proofs_expiry'],
    [true, 'DROP TABLE auth_phone_flow_cooldowns'],
    [true, 'CREATE TRIGGER unexpected AFTER INSERT ON auth_users BEGIN SELECT 1; END'],
  ]) {
    const { db, d1 } = await fixture({ withPhone });
    try { db.exec(mutation); await assert.rejects(verifyAccountDatabase(d1), /schema mismatch/); } finally { db.close(); }
  }
  const { db, d1 } = await fixture({ withPhone: true, extraSql: { name: phone[0], change: sql => sql.replace('CHECK(length(proof_hash)=64)', 'CHECK(length(proof_hash)=63)') } });
  try { await assert.rejects(verifyAccountDatabase(d1), /schema mismatch/); } finally { db.close(); }
  const loneCr = await fixture({ withPhone: true, extraSql: { name: phone[0], change: sql => sql.replace(' phone TEXT', '\r phone TEXT') } });
  try { await assert.rejects(verifyAccountDatabase(loneCr.d1), /schema mismatch/); } finally { loneCr.db.close(); }
});
test('phone schema and CRLF ledger are checked through real synthetic D1', { timeout: 60000 }, async () => {
  const worker = await buildAccountWorker(), mf = new Miniflare({ modules: true, script: worker.bytes.toString(), compatibilityDate: '2026-05-15',
    compatibilityFlags: ['nodejs_compat'], cf: false, host: '127.0.0.1', port: 0, d1Databases: ['DB'], log: new Log(LogLevel.ERROR),
    outboundService: () => new Response(null, { status: 403 }) });
  try {
    const db = await mf.getD1Database('DB');
    await db.prepare('CREATE TABLE _lantern_local_migrations(name TEXT PRIMARY KEY,sha TEXT NOT NULL)').run();
    for (const name of [...base.slice(0, 2), ...phone, base[2]]) {
      const raw = await readFile(new URL('../../drizzle/' + name, import.meta.url), 'utf8'), sql = raw.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
      await db.batch(sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
      await db.prepare('INSERT INTO _lantern_local_migrations(name,sha) VALUES (?,?)').bind(name, digest(sql)).run();
    }
    await verifyAccountDatabase(db);
    await db.prepare('DROP INDEX auth_phone_challenges_expiry').run();
    await assert.rejects(verifyAccountDatabase(db), /schema mismatch/);
  } finally { await mf.dispose(); }
});
