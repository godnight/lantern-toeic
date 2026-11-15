import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNativeAccountConfig, isRootControlledStat, readNativeAccountConfig, loadNativeAccountWorker } from './native-account-config.candidate.mjs';
import { isPrivateAccountStat, startNativeAccountGateway, verifyNativeAccountDatabase } from './native-account-runtime.candidate.mjs';
import { buildAccountWorker } from './build-inputs.mjs';
import { acquireD1Lock, openLockedD1 } from './d1-lock.candidate.mjs';

const migrations = ['0005_product_auth.sql', '0006_auth_admission_ticket.sql', '0009_huawei_auth.sql'];
const origin = 'https://account.synthetic.invalid';
const config = () => ({ enabled: true, origin, bindAddress: '10.3.4.5', slot: 'active',
  certRoot: path.resolve('synthetic-certs'), lockDir: path.resolve('synthetic-data'),
  workerRoot: path.resolve('synthetic-worker'), workerSha256: 'a'.repeat(64) });

test('native account startup is default closed and rejects phone, sync, unpinned or overlapping configuration', async () => {
  assert.deepEqual(validateNativeAccountConfig(config()), config());
  for (const change of [{ enabled: false }, { origin: 'http://account.synthetic.invalid' }, { bindAddress: '0.0.0.0' },
    { phone: {} }, { sync: true }, { workerSha256: '' }, { workerSha256: 'A'.repeat(64) },
    { workerRoot: 'relative' }, { workerRoot: config().lockDir }, { workerRoot: path.join(config().certRoot, 'nested') },
    { lockDir: path.join(config().workerRoot, 'nested') }]) assert.throws(() => validateNativeAccountConfig({ ...config(), ...change }));
  await assert.rejects(readNativeAccountConfig(), /disabled/);
  await assert.rejects(loadNativeAccountWorker({ ...config(), workerSha256: '' }), /invalid/);
  await assert.rejects(startNativeAccountGateway(), /disabled/);
  await assert.rejects(readNativeAccountConfig({ enabled: true, file: path.resolve('missing-native-config') }));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-native-account.candidate.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /explicit enable/);
});

test('root-controlled code/config and service-owned data require exact owner, group, mode and file links', () => {
  const rootFile = { uid: 0, gid: 42, mode: 0o100640, nlink: 1 };
  const rootDir = { uid: 0, gid: 42, mode: 0o040750, nlink: 2 };
  const dataFile = { uid: 1001, gid: 42, mode: 0o100600, nlink: 1 };
  const dataDir = { uid: 1001, gid: 42, mode: 0o040700, nlink: 2 };
  assert.equal(isRootControlledStat(rootFile, 42, false), true);
  assert.equal(isRootControlledStat(rootDir, 42, true), true);
  assert.equal(isPrivateAccountStat(dataFile, 1001, 42, false), true);
  assert.equal(isPrivateAccountStat(dataDir, 1001, 42, true), true);
  for (const change of [{ uid: 1001 }, { gid: 43 }, { mode: 0o100660 }, { mode: 0o104640 }, { nlink: 2 }])
    assert.equal(isRootControlledStat({ ...rootFile, ...change }, 42, false), false);
  for (const change of [{ uid: 0 }, { gid: 43 }, { mode: 0o100640 }, { mode: 0o104600 }, { nlink: 2 }])
    assert.equal(isPrivateAccountStat({ ...dataFile, ...change }, 1001, 42, false), false);
  assert.equal(isPrivateAccountStat(dataFile, 0, 42, false), false);
});

test('existing WAL account DB preflight and actual Worker preserve account through reopen; invalid data fails closed', { timeout: 60000 }, async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lantern-native-preflight-'))), file = path.join(dir, 'synthetic-only.sqlite');
  let sqlite;
  try {
    sqlite = new DatabaseSync(file);
    sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE _lantern_local_migrations(name TEXT PRIMARY KEY,sha TEXT NOT NULL)');
    for (const name of migrations) {
      const sql = await readFile(new URL('../../drizzle/' + name, import.meta.url));
      sqlite.exec(sql.toString('utf8'));
      sqlite.prepare('INSERT INTO _lantern_local_migrations(name,sha) VALUES(?,?)').run(name, createHash('sha256').update(sql).digest('hex'));
    }
    let db = await verifyNativeAccountDatabase(sqlite);
    const worker = await buildAccountWorker(), app = (await import('data:text/javascript;base64,' + worker.bytes.toString('base64'))).default;
    const env = () => ({ DB: db, LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin });
    const request = (route, body, cookie) => new Request(origin + route, { method: body ? 'POST' : 'GET',
      headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const registered = await app.fetch(request('/api/auth/register', { username: 'synthetic_user', password: 'synthetic-password-123' }), env());
    assert.equal(registered.status, 200, await registered.clone().text());
    const owner = (await registered.json()).user.id, cookie = registered.headers.get('set-cookie').split(';')[0];
    sqlite.close(); sqlite = undefined;
    sqlite = new DatabaseSync(file, { readOnly: true }); sqlite.exec('PRAGMA foreign_keys=ON');
    db = await verifyNativeAccountDatabase(sqlite);
    assert.equal((await (await app.fetch(request('/api/auth/session', undefined, cookie), env())).json()).user.id, owner);
    sqlite.close(); sqlite = undefined;
    sqlite = new DatabaseSync(file); sqlite.exec('PRAGMA foreign_keys=ON');
    const original = sqlite.prepare('SELECT sha FROM _lantern_local_migrations WHERE name=?').get(migrations[0]).sha;
    sqlite.prepare('UPDATE _lantern_local_migrations SET sha=? WHERE name=?').run('0'.repeat(64), migrations[0]);
    await assert.rejects(verifyNativeAccountDatabase(sqlite), /ledger/);
    sqlite.prepare('UPDATE _lantern_local_migrations SET sha=? WHERE name=?').run(original, migrations[0]);
    sqlite.exec("PRAGMA foreign_keys=OFF; INSERT INTO auth_password_credentials(user_id,password_hash) VALUES('synthetic-orphan','synthetic'); PRAGMA foreign_keys=ON");
    await assert.rejects(verifyNativeAccountDatabase(sqlite), /integrity/);
    sqlite.exec("DELETE FROM auth_password_credentials WHERE user_id='synthetic-orphan'; DROP INDEX auth_sessions_expiry");
    await assert.rejects(verifyNativeAccountDatabase(sqlite), /schema/);
  } finally {
    sqlite?.close();
    const absolute = await realpath(dir), tmp = await realpath(os.tmpdir());
    if (path.dirname(absolute) !== tmp || !path.basename(absolute).startsWith('lantern-native-preflight-')) throw Error('unsafe synthetic directory');
    await rm(absolute, { recursive: true, force: true });
  }
});

test('account preflight refuses non-WAL databases and disabled foreign keys', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys=ON');
    await assert.rejects(verifyNativeAccountDatabase(sqlite), /mode/);
    sqlite.exec('PRAGMA foreign_keys=OFF');
    await assert.rejects(verifyNativeAccountDatabase(sqlite), /mode/);
  } finally { sqlite.close(); }
});

test('locked account preflight permits restart and releases the lock on invalid schema', { timeout: 30000 }, async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lantern-native-lock-'))), file = path.join(dir, 'synthetic-only.sqlite');
  let sqlite;
  try {
    sqlite = new DatabaseSync(file);
    sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE _lantern_local_migrations(name TEXT PRIMARY KEY,sha TEXT NOT NULL)');
    for (const name of migrations) {
      const sql = await readFile(new URL('../../drizzle/' + name, import.meta.url)); sqlite.exec(sql.toString('utf8'));
      sqlite.prepare('INSERT INTO _lantern_local_migrations(name,sha) VALUES(?,?)').run(name, createHash('sha256').update(sql).digest('hex'));
    }
    sqlite.close(); sqlite = undefined;
    const start = () => openLockedD1({ lockDir: dir,
      openRuntime: async () => {
        let connection;
        return { async check() { connection = new DatabaseSync(file, { readOnly: true }); connection.exec('PRAGMA foreign_keys=ON'); await verifyNativeAccountDatabase(connection); },
          async dispose() { connection?.close(); } };
      },
      prepareService: async runtime => { await runtime.check(); return { async close() {} }; },
    });
    let service = await start(); await assert.rejects(acquireD1Lock(dir)); await service.close();
    assert.equal(existsSync(path.join(dir, 'lantern-d1.lock')), false);
    service = await start(); await service.close();
    sqlite = new DatabaseSync(file); sqlite.exec('DROP INDEX auth_sessions_expiry'); sqlite.close(); sqlite = undefined;
    await assert.rejects(start(), /schema/);
    assert.equal(existsSync(path.join(dir, 'lantern-d1.lock')), false);
  } finally {
    sqlite?.close();
    const absolute = await realpath(dir), tmp = await realpath(os.tmpdir());
    if (path.dirname(absolute) !== tmp || !path.basename(absolute).startsWith('lantern-native-lock-')) throw Error('unsafe synthetic directory');
    await rm(absolute, { recursive: true, force: true });
  }
});
