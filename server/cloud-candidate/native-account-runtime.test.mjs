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
import { validateNativeAccountConfig, isRootControlledStat, readNativeAccountConfig, loadNativeAccountWorker, loadNativeHuaweiBindings } from './native-account-config.candidate.mjs';
import { createNativeHuaweiOutbound } from './native-huawei-outbound.candidate.mjs';
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

test('optional Huawei config is closed by default and fails closed on malformed or unsafe secret paths', async () => {
  assert.equal(await loadNativeHuaweiBindings(config()), null);
  const huawei = { clientId: '123456', secretFile: path.resolve('synthetic-huawei', 'huawei-client-secret') };
  assert.deepEqual(validateNativeAccountConfig({ ...config(), huawei }).huawei, huawei);
  for (const invalid of [undefined, {}, { ...huawei, clientId: 'x' }, { ...huawei, clientId: '1'.repeat(65) }, { ...huawei, secretFile: 'relative' },
    { ...huawei, secretFile: path.join(config().lockDir, 'huawei-client-secret') }, { ...huawei, secretFile: path.join(config().workerRoot, 'huawei-client-secret') },
    { ...huawei, secretFile: path.resolve('synthetic-huawei', 'wrong-name') }, { ...huawei, secret: 'synthetic' }])
    assert.throws(() => validateNativeAccountConfig({ ...config(), huawei: invalid }));
  await assert.rejects(loadNativeHuaweiBindings({ ...config(), huawei }));
  assert.throws(() => createNativeHuaweiOutbound());
});

test('Huawei outbound permits only the two fixed POST forms and does not log rejected input', async () => {
  const calls = [], fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response('{}'); };
  const send = createNativeHuaweiOutbound({ enabled: true, clientId: '123456', fetchImpl });
  const opts = { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: '123456', client_secret: 'synthetic-secret', code: 'synthetic-code', supportAlg: 'PS256' }) };
  const token = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
  await send(token, opts); assert.equal(calls.length, 1);
  for (const [url, change] of [['https://evil.invalid/', {}], [token + '?redirect=x', {}], [token, { redirect: 'follow' }], [token, { method: 'GET' }],
    [token, { body: new URLSearchParams({ ...Object.fromEntries(opts.body), client_id: '999' }) }],
    [token, { headers: { ...opts.headers, 'x-extra': 'bad' } }]]) await assert.rejects(send(url, { ...opts, ...change }), /Huawei outbound rejected/);
  assert.equal(calls.length, 1);
});

test('actual Worker enables Huawei only with server bindings and preserves password ownership', { timeout: 60000 }, async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys=ON');
    for (const name of migrations) sqlite.exec((await readFile(new URL('../../drizzle/' + name, import.meta.url))).toString('utf8'));
    const { createSqliteD1Core } = await import('./sqlite-d1-core.candidate.mjs');
    const db = createSqliteD1Core({ enabled: true, database: sqlite });
    const worker = await buildAccountWorker(), app = (await import('data:text/javascript;base64,' + worker.bytes.toString('base64'))).default;
    const base = { DB: db, LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin };
    const req = (route, body, cookie) => new Request(origin + route, { method: body ? 'POST' : 'GET', headers: { origin,
      ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const call = (route, body, env, cookie) => app.fetch(req(route, body, cookie), env);
    assert.deepEqual(await (await call('/api/auth/providers', null, base)).json(), { huaweiLogin: false, huaweiBinding: false });
    assert.equal((await call('/api/auth/huawei/login', { code: 'disabled-code' }, base)).status, 503);
    const registered = await call('/api/auth/register', { username: 'huawei_synthetic', password: 'synthetic-password-123' }, base);
    assert.equal(registered.status, 200, await registered.clone().text());
    const owner = (await registered.json()).user.id, cookie = registered.headers.get('set-cookie').split(';')[0];
    let subject = 'SyntheticSubjectA', audience = '123456', calls = 0;
    const mock = async url => { calls++; return new Response(JSON.stringify(url.includes('/token') ?
      { token_type: 'Bearer', access_token: 'synthetic-access-token', expires_in: 3600 } :
      { client_id: audience, type: 0, expire_in: 3600, open_id: subject })); };
    const env = { ...base, LANTERN_HUAWEI_CLIENT_ID: '123456', LANTERN_HUAWEI_CLIENT_SECRET: 'synthetic-secret',
      LANTERN_HUAWEI_OUTBOUND: createNativeHuaweiOutbound({ enabled: true, clientId: '123456', fetchImpl: mock }) };
    assert.deepEqual(await (await call('/api/auth/providers', null, env)).json(), { huaweiLogin: true, huaweiBinding: true });
    const bound = await call('/api/auth/huawei/bind', { code: 'synthetic-bind' }, env, cookie);
    assert.equal(bound.status, 200, await bound.clone().text());
    assert.equal((await bound.json()).user.id, owner);
    const login = await call('/api/auth/huawei/login', { code: 'synthetic-login' }, env);
    assert.equal(login.status, 200, await login.clone().text());
    const text = await login.text(); assert.equal(JSON.parse(text).user.id, owner);
    assert.doesNotMatch(text, /synthetic-secret|synthetic-access-token|SyntheticSubjectA/);
    const password = await call('/api/auth/login', { username: 'huawei_synthetic', password: 'synthetic-password-123' }, base);
    assert.equal(password.status, 200); assert.equal((await password.json()).user.id, owner);
    const second = await call('/api/auth/register', { username: 'other_synthetic', password: 'synthetic-password-456' }, base);
    assert.equal(second.status, 200); const otherCookie = second.headers.get('set-cookie').split(';')[0];
    const conflict = await call('/api/auth/huawei/bind', { code: 'synthetic-conflict' }, env, otherCookie);
    assert.equal(conflict.status, 409); assert.equal(sqlite.prepare('SELECT user_id FROM auth_provider_bindings').get().user_id, owner);
    audience = 'wrong'; subject = 'SyntheticSubjectB';
    assert.equal((await call('/api/auth/huawei/login', { code: 'synthetic-wrong-audience' }, env)).status, 401);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM auth_provider_bindings').get().n, 1);
    assert.equal(calls, 8);
  } finally { sqlite.close(); }
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
