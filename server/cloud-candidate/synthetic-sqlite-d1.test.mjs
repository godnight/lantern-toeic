import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { createSyntheticSqliteD1 } from './synthetic-sqlite-d1.candidate.mjs';
import { buildAccountWorker } from './build-inputs.mjs';

const migrations = ['0005_product_auth.sql', '0006_auth_admission_ticket.sql', '0009_huawei_auth.sql'];
const origin = 'https://account.synthetic.invalid';

test('synthetic adapter binds values, separates prepared statements and rejects unsupported SQL', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('CREATE TABLE synthetic_users(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)');
    assert.throws(() => createSyntheticSqliteD1({ database }), /disabled/);
    assert.throws(() => createSyntheticSqliteD1({ enabled: true }), /disabled/);
    const db = createSyntheticSqliteD1({ enabled: true, database });
    const insert = db.prepare('INSERT INTO synthetic_users(name) VALUES(?)');
    const first = insert.bind("alice'); DROP TABLE synthetic_users; --"), second = insert.bind('bob');
    assert.equal((await first.run()).meta.changes, 1);
    assert.equal((await second.run()).meta.changes, 1);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM synthetic_users').first('n'), 2);
    assert.equal((await db.prepare('SELECT name FROM synthetic_users WHERE id=?').bind(1).first()).name, "alice'); DROP TABLE synthetic_users; --");
    assert.equal(await db.prepare('SELECT name FROM synthetic_users WHERE id=?').bind(123).first(), null);
    assert.equal((await db.prepare('SELECT 1 AS n').run()).meta.changes, 0);
    assert.throws(() => db.prepare('SELECT 1; DELETE FROM synthetic_users'), /multiple/);
    for (const sql of ['BEGIN', 'COMMIT', 'ROLLBACK', 'PRAGMA foreign_keys=OFF', 'ATTACH DATABASE ? AS other']) assert.throws(() => db.prepare(sql), /unsupported/);
    assert.throws(() => insert.bind({ unsafe: true }), /unsupported D1 parameter/);
    const other = createSyntheticSqliteD1({ enabled: true, database });
    await assert.rejects(other.batch([first]), /invalid D1 batch/);
  } finally { database.close(); }
});

test('synthetic batches are ordered and roll back all writes on constraint failure', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA foreign_keys=ON; CREATE TABLE parents(id INTEGER PRIMARY KEY); CREATE TABLE children(parent INTEGER NOT NULL REFERENCES parents(id), name TEXT NOT NULL UNIQUE)');
    const db = createSyntheticSqliteD1({ enabled: true, database });
    const result = await db.batch([db.prepare('INSERT INTO parents(id) VALUES(?)').bind(1), db.prepare('INSERT INTO children(parent,name) VALUES(?,?)').bind(1, 'first'), db.prepare('SELECT name FROM children WHERE parent=?').bind(1)]);
    assert.deepEqual(result.map(row => row.meta.changes), [1, 1, 0]);
    assert.equal(result[2].results[0].name, 'first');
    await assert.rejects(db.batch([db.prepare('INSERT INTO children(parent,name) VALUES(?,?)').bind(1, 'rolled-back'), db.prepare('INSERT INTO children(parent,name) VALUES(?,?)').bind(1, 'first')]));
    assert.equal(await db.prepare('SELECT count(*) AS n FROM children').first('n'), 1);
    await assert.rejects(db.batch([db.prepare('INSERT INTO children(parent,name) VALUES(?,?)').bind(1, 'also-rolled-back'), db.prepare('INSERT INTO children(parent,name) VALUES(?,?)').bind(999, 'bad-parent')]));
    assert.equal(await db.prepare('SELECT count(*) AS n FROM children').first('n'), 1);
  } finally { database.close(); }
});

test('account registration leaves no partial identity if its credential write fails', { timeout: 30000 }, async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys=ON');
    for (const name of migrations) sqlite.exec(await readFile(new URL('../../drizzle/' + name, import.meta.url), 'utf8'));
    sqlite.exec("CREATE TRIGGER synthetic_reject_credential BEFORE INSERT ON auth_password_credentials BEGIN SELECT RAISE(ABORT, 'synthetic constraint'); END");
    const db = createSyntheticSqliteD1({ enabled: true, database: sqlite });
    const worker = await buildAccountWorker();
    const app = (await import('data:text/javascript;base64,' + worker.bytes.toString('base64'))).default;
    const response = await app.fetch(new Request(origin + '/api/auth/register', { method: 'POST',
      headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'synthetic_failure', password: 'synthetic-password-123' }) }),
    { DB: db, LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin });
    assert.equal(response.status, 503);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM auth_users').first('n'), 0);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM auth_password_credentials').first('n'), 0);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM auth_sessions').first('n'), 0);
  } finally { sqlite.close(); }
});

test('actual account Worker works against synthetic SQLite across restart and account isolation', { timeout: 60000 }, async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lantern-sqlite-d1-')));
  const file = path.join(dir, 'synthetic-only.sqlite');
  let sqlite;
  try {
    sqlite = new DatabaseSync(file); sqlite.exec('PRAGMA foreign_keys=ON');
    for (const name of migrations) sqlite.exec(await readFile(new URL('../../drizzle/' + name, import.meta.url), 'utf8'));
    const worker = await buildAccountWorker();
    const app = (await import('data:text/javascript;base64,' + worker.bytes.toString('base64'))).default;
    let env = { DB: createSyntheticSqliteD1({ enabled: true, database: sqlite }), LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin };
    const request = (route, { body, cookie, method } = {}) => new Request(origin + route, { method: method ?? (body ? 'POST' : 'GET'), headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const fetch = (route, opts) => app.fetch(request(route, opts), env);
    const registration = await fetch('/api/auth/register', { body: { username: 'synthetic_alice', password: 'synthetic-password-123' } });
    assert.equal(registration.status, 200, await registration.clone().text());
    const owner = (await registration.json()).user.id, cookie = registration.headers.get('set-cookie').split(';')[0];
    const other = await fetch('/api/auth/register', { body: { username: 'synthetic_bob', password: 'synthetic-password-456' } });
    assert.equal(other.status, 200, await other.clone().text());
    assert.notEqual((await other.json()).user.id, owner);
    const otherCookie = other.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await fetch('/api/auth/session', { cookie })).json()).user.id, owner);
    assert.notEqual((await (await fetch('/api/auth/session', { cookie: otherCookie })).json()).user.id, owner);
    assert.equal((await fetch('/api/auth/login', { body: { username: 'synthetic_alice', password: 'wrong-password' } })).status, 401);
    sqlite.close();
    sqlite = new DatabaseSync(file); sqlite.exec('PRAGMA foreign_keys=ON');
    env = { ...env, DB: createSyntheticSqliteD1({ enabled: true, database: sqlite }) };
    const login = await fetch('/api/auth/login', { body: { username: 'synthetic_alice', password: 'synthetic-password-123' } });
    assert.equal(login.status, 200, await login.clone().text());
    assert.equal((await login.json()).user.id, owner);
    assert.equal((await fetch('/api/auth/session', { cookie })).status, 200);
    assert.equal((await fetch('/api/auth/logout', { method: 'POST', cookie })).status, 200);
    assert.equal((await fetch('/api/auth/session', { cookie })).status, 401);
    assert.equal((await fetch('/api/auth/session', { cookie: otherCookie })).status, 200);
  } finally {
    sqlite?.close();
    const absolute = await realpath(dir), tmp = await realpath(os.tmpdir());
    if (path.dirname(absolute) !== tmp || !path.basename(absolute).startsWith('lantern-sqlite-d1-')) throw Error('unsafe synthetic directory');
    await rm(absolute, { recursive: true, force: true });
  }
});

test('synthetic phone flow persists an account using only an injected fake supplier', { timeout: 30000 }, async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys=ON');
    for (const name of ['0005_product_auth.sql', '0006_auth_admission_ticket.sql', '0007_phone_auth.sql', '0008_phone_challenges.sql', '0009_huawei_auth.sql'])
      sqlite.exec(await readFile(new URL('../../drizzle/' + name, import.meta.url), 'utf8'));
    const db = createSyntheticSqliteD1({ enabled: true, database: sqlite });
    const worker = await buildAccountWorker();
    const base = (await import('data:text/javascript;base64,' + worker.bytes.toString('base64'))).default;
    const composition = await build({ entryPoints: [fileURLToPath(new URL('./phone-cloud-composition.candidate.mjs', import.meta.url))],
      bundle: true, write: false, format: 'esm', platform: 'node', target: 'node24', external: ['node:*'] });
    const { createPhoneCloudCandidate } = await import('data:text/javascript;base64,' + Buffer.from(composition.outputFiles[0].contents).toString('base64'));
    let calls = 0, mode = 'ok';
    const app = createPhoneCloudCandidate({ base, enabled: true, signature: 'synthetic-sign', templates: { login: '100001' },
      schemeName: 'synthetic', referenceKey: randomBytes(32).toString('hex'), audience: origin + '/phone',
      getCredentials: async () => ({ synthetic: true }),
      makeClient: () => ({ async call(action, fields) {
        calls++;
        if (mode === 'unknown') throw Error('synthetic lost acknowledgement');
        return { Code: 'OK', Success: true, Model: { OutId: fields.OutId, ...(action === 'CheckSmsVerifyCode' ? { VerifyResult: fields.VerifyCode === '619274' ? 'PASS' : 'UNKNOWN' } : {}) } };
      } }),
    });
    const env = { DB: db, LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin };
    const request = (route, body, cookie) => app.fetch(new Request(origin + route, { method: body ? 'POST' : 'GET',
      headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
    const status = await request('/api/auth/phone/status');
    assert.equal((await status.json()).capabilities.phoneLogin, true);
    const phone = '+8613800000891';
    const challenge = await request('/api/auth/phone/challenge', { phone, purpose: 'login' });
    assert.equal(challenge.status, 202, await challenge.clone().text());
    const challengeId = (await challenge.json()).challengeId;
    assert.equal((await request('/api/auth/phone/login', { phone, challengeId, code: '000000' })).status, 400);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM auth_users').first('n'), 0);
    const login = await request('/api/auth/phone/login', { phone, challengeId, code: '619274' });
    assert.equal(login.status, 200, await login.clone().text());
    const owner = (await login.json()).user.id, cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await request('/api/auth/session', undefined, cookie)).json()).user.id, owner);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM auth_phone_bindings').first('n'), 1);
    assert.equal(calls, 3);
    assert.notEqual((await request('/api/auth/phone/login', { phone, challengeId, code: '619274' })).status, 200);
    assert.equal(calls, 3);
    mode = 'unknown';
    const unknownPhone = '+8613800000892';
    assert.equal((await request('/api/auth/phone/challenge', { phone: unknownPhone, purpose: 'login' })).status, 503);
    assert.equal(calls, 4);
    assert.notEqual((await request('/api/auth/phone/challenge', { phone: unknownPhone, purpose: 'login' })).status, 202);
    assert.equal(calls, 4);
  } finally { sqlite.close(); }
});

test('concurrent duplicate registrations have the same one-owner outcome as synthetic D1', { timeout: 60000 }, async () => {
  const worker = await buildAccountWorker();
  const app = (await import('data:text/javascript;base64,' + worker.bytes.toString('base64'))).default;
  const sqlite = new DatabaseSync(':memory:');
  const mf = new Miniflare({ modules: true, script: worker.bytes.toString(), compatibilityDate: '2026-05-15',
    compatibilityFlags: ['nodejs_compat'], cf: false, host: '127.0.0.1', port: 0, d1Databases: ['DB'],
    bindings: { LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin },
    outboundService: () => new Response(null, { status: 403 }), log: new Log(LogLevel.ERROR) });
  try {
    sqlite.exec('PRAGMA foreign_keys=ON');
    const remote = await mf.getD1Database('DB');
    for (const name of migrations) {
      const sql = await readFile(new URL('../../drizzle/' + name, import.meta.url), 'utf8');
      sqlite.exec(sql);
      await remote.batch(sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).map(s => remote.prepare(s)));
    }
    const local = createSyntheticSqliteD1({ enabled: true, database: sqlite });
    const env = { DB: local, LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin };
    const request = password => new Request(origin + '/api/auth/register', { method: 'POST',
      headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'synthetic_race', password }) });
    for (const [db, dispatch] of [[local, req => app.fetch(req, env)], [remote, async req => mf.dispatchFetch(req.url, { method: req.method, headers: Object.fromEntries(req.headers), body: await req.text() })]]) {
      const responses = await Promise.all([dispatch(request('synthetic-password-first')), dispatch(request('synthetic-password-second'))]);
      const statuses = responses.map(r => r.status);
      // The shared scrypt admission gate may reject the parallel request
      // before it reaches SQLite; it must never create a second account.
      assert.equal(statuses.filter(status => status === 200).length, 1);
      assert.ok(statuses.every(status => [200, 400, 429].includes(status)));
      assert.equal((await dispatch(request('synthetic-password-third'))).status, 400);
      assert.equal(await db.prepare('SELECT count(*) AS n FROM auth_users WHERE username=?').bind('synthetic_race').first('n'), 1);
      assert.equal(await db.prepare('SELECT count(*) AS n FROM auth_password_credentials').first('n'), 1);
      assert.equal(await db.prepare('SELECT count(*) AS n FROM auth_sessions').first('n'), 1);
    }
  } finally { await mf.dispose(); sqlite.close(); }
});

test('two independent SQLite processes serialize competing identity transactions', { timeout: 30000 }, async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lantern-sqlite-race-')));
  const file = path.join(dir, 'synthetic-only.sqlite');
  const sqlite = new DatabaseSync(file);
  const children = [];
  try {
    sqlite.exec('PRAGMA journal_mode=WAL; CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE); CREATE TABLE credentials(user_id TEXT PRIMARY KEY REFERENCES users(id))');
    const childPath = fileURLToPath(new URL('./synthetic-sqlite-race.fixture.mjs', import.meta.url));
    const makeChild = id => {
      const child = fork(childPath, [file, id], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      children.push(child);
      let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
      let readyResolve, readyReject, resultResolve, resultReject, exitResolve, exitReject;
      const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      const result = new Promise((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
      const exited = new Promise((resolve, reject) => { exitResolve = resolve; exitReject = reject; });
      ready.catch(() => {}); result.catch(() => {}); exited.catch(() => {});
      child.on('message', message => { if (message?.ready) readyResolve(); if (message?.done) message.error ? resultReject(Error(message.error)) : resultResolve(message.changes); });
      child.on('error', error => { readyReject(error); resultReject(error); exitReject(error); });
      child.on('exit', code => {
        if (code === 0) exitResolve();
        else { const error = Error('synthetic writer exited: ' + stderr); readyReject(error); resultReject(error); exitReject(error); }
      });
      return { child, ready, result, exited };
    };
    const writers = [makeChild('candidate-1'), makeChild('candidate-2')];
    await Promise.all(writers.map(writer => writer.ready));
    for (const writer of writers) writer.child.send('go');
    const outcomes = await Promise.all(writers.map(writer => writer.result));
    await Promise.all(writers.map(writer => writer.exited));
    assert.deepEqual(outcomes.map(changes => changes.join(',')).sort(), ['0,0', '1,1']);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM users').get().n, 1);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM credentials').get().n, 1);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM credentials c JOIN users u ON u.id=c.user_id').get().n, 1);
  } finally {
    await Promise.all(children.map(child => child.exitCode === null && child.signalCode === null
      ? new Promise(resolve => { child.once('exit', resolve); child.kill(); }) : undefined));
    sqlite.close();
    const absolute = await realpath(dir), tmp = await realpath(os.tmpdir());
    if (path.dirname(absolute) !== tmp || !path.basename(absolute).startsWith('lantern-sqlite-race-')) throw Error('unsafe synthetic directory');
    await rm(absolute, { recursive: true, force: true });
  }
});
