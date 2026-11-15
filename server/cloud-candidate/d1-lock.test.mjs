import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { acquireD1Lock, openLockedD1 } from './d1-lock.candidate.mjs';
import { verifyAccountDatabase } from './account-db-preflight.candidate.mjs';
import { buildAccountWorker } from './build-inputs.mjs';
import { prepareCloudService } from './service.candidate.mjs';
import { startLockedGateway } from './locked-service.candidate.mjs';

async function temporary() { return realpath(await mkdtemp(path.join(os.tmpdir(), 'lantern-d1-lock-'))); }
async function cleanup(dir) { const absolute = await realpath(dir), tmp = await realpath(os.tmpdir()); if (path.dirname(absolute) !== tmp || !path.basename(absolute).startsWith('lantern-d1-lock-')) throw Error('unsafe test directory'); await rm(absolute, { recursive: true, force: true }); }
const migrations = ['0005_product_auth.sql', '0006_auth_admission_ticket.sql', '0009_huawei_auth.sql'];
test('live separate process rejects another writer and crash leaves a conservative lock', { timeout: 15000 }, async () => {
  const dir = await temporary(); let child;
  try {
    child = spawn(process.execPath, [fileURLToPath(new URL('./lock-child.fixture.mjs', import.meta.url)), dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => { child.once('error', reject); child.stdout.once('data', data => data.toString().includes('locked') ? resolve() : reject(Error('child not ready'))); child.once('exit', () => reject(Error('child exited early'))); });
    let opened = false;
    await assert.rejects(openLockedD1({ lockDir: dir, openRuntime: async () => { opened = true; }, prepareService: async () => ({}) })); assert.equal(opened, false);
    const exit = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exit; child = undefined;
    await assert.rejects(acquireD1Lock(dir));
  } finally { if (child) child.kill(); await cleanup(dir); }
});
test('real D1 schema, exclusivity and graceful close; unsuccessful cleanup retains lock', { timeout: 60000 }, async () => {
  const dir = await temporary(); let locked;
  try {
    const worker = await buildAccountWorker(), origin = 'https://synthetic.invalid';
    locked = await openLockedD1({ lockDir: dir, openRuntime: async () => {
      const mf = new Miniflare({ modules: true, script: worker.bytes.toString(), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
        cf: false, host: '127.0.0.1', port: 0, d1Databases: ['DB'], d1Persist: path.join(dir, 'd1'), bindings: { LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin },
        outboundService: () => new Response(null, { status: 403 }), log: new Log(LogLevel.ERROR) });
      const db = await mf.getD1Database('DB'); await db.prepare('CREATE TABLE _lantern_local_migrations(name TEXT PRIMARY KEY,sha TEXT NOT NULL)').run();
      for (const name of migrations) {
        const sql = await readFile(new URL('../../drizzle/' + name, import.meta.url), 'utf8');
        await db.batch(sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
        await db.prepare('INSERT INTO _lantern_local_migrations(name,sha) VALUES (?,?)').bind(name, createHash('sha256').update(sql).digest('hex')).run();
      }
      await verifyAccountDatabase(db);
      await db.prepare("UPDATE _lantern_local_migrations SET sha='tampered' WHERE name='0005_product_auth.sql'").run();
      await assert.rejects(verifyAccountDatabase(db), /ledger mismatch/);
      const authSql = await readFile(new URL('../../drizzle/0005_product_auth.sql', import.meta.url), 'utf8');
      await db.prepare("UPDATE _lantern_local_migrations SET sha=? WHERE name='0005_product_auth.sql'").bind(createHash('sha256').update(authSql).digest('hex')).run();
      await db.prepare('CREATE TRIGGER synthetic_extra AFTER INSERT ON auth_users BEGIN SELECT 1; END').run();
      await assert.rejects(verifyAccountDatabase(db), /schema mismatch/);
      await db.prepare('DROP TRIGGER synthetic_extra').run(); await verifyAccountDatabase(db);
      return mf;
    }, prepareService: mf => prepareCloudService({ enabled: true, mf, origin }) });
    await assert.rejects(acquireD1Lock(dir));
    await locked.close(); locked = undefined;
    const release = await acquireD1Lock(dir); await release();
    const broken = await openLockedD1({ lockDir: dir, openRuntime: async () => ({ dispose: async () => { throw Error('disposal failed'); } }), prepareService: async () => ({ close: async () => {} }) });
    await assert.rejects(broken.close(), /disposal failed/); await assert.rejects(acquireD1Lock(dir));
  } finally { if (locked) await locked.close(); await cleanup(dir); }
});
test('locked gateway remains disabled before touching a data directory', async () => {
  await assert.rejects(startLockedGateway(), /disabled/);
});
