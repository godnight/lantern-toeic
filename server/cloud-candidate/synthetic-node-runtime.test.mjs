import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { buildAccountWorker } from './build-inputs.mjs';

const origin = 'https://synthetic.invalid';
const migrations = ['0005_product_auth.sql', '0006_auth_admission_ticket.sql', '0009_huawei_auth.sql'];

function launch(dir) {
  const child = fork(fileURLToPath(new URL('./synthetic-node-runtime.fixture.mjs', import.meta.url)), [dir], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let resolveReady, rejectReady, resolveExit, rejectExit, stderr = '';
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const exited = new Promise((resolve, reject) => { resolveExit = resolve; rejectExit = reject; });
  ready.catch(() => {}); exited.catch(() => {});
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('message', message => { if (typeof message?.ready === 'boolean') resolveReady(message); });
  child.on('error', error => { rejectReady(error); rejectExit(error); });
  child.on('exit', code => { if (code === 0 || code === 1) resolveExit(code); else { const error = Error('synthetic runtime exited: ' + stderr); rejectReady(error); rejectExit(error); } });
  return { child, ready, exited };
}

function request(port, cert, route, { body, cookie, host = 'synthetic.invalid', requestOrigin = origin, method } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = https.request({ host: '127.0.0.1', port, servername: 'synthetic.invalid', ca: cert, agent: false,
      method: method ?? (payload ? 'POST' : 'GET'), path: route, headers: { host, origin: requestOrigin,
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...(cookie ? { cookie } : {}) } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), cookie: res.headers['set-cookie']?.[0]?.split(';')[0] }));
    });
    req.setTimeout(10000, () => req.destroy(Error('synthetic request timed out')));
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}

test('Node Worker and SQLite serve only synthetic loopback, survive restart and fail closed', { timeout: 60000 }, async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lantern-node-runtime-'))), children = [];
  const database = path.join(dir, 'synthetic-only.sqlite');
  let sqlite;
  try {
    await writeFile(path.join(dir, 'SYNTHETIC-ONLY'), 'lantern-node-runtime-v1\n');
    await writeFile(path.join(dir, 'synthetic-worker.mjs'), (await buildAccountWorker()).bytes);
    const opensslConfig = path.join(dir, 'openssl.cnf'); await writeFile(opensslConfig, '[req]\ndistinguished_name=dn\n[dn]\n');
    const openssl = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
    execFileSync(openssl, ['req', '-config', opensslConfig, '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256',
      '-keyout', path.join(dir, 'synthetic-key.pem'), '-out', path.join(dir, 'synthetic-cert.pem'), '-days', '1',
      '-subj', '/CN=synthetic.invalid', '-addext', 'subjectAltName=DNS:synthetic.invalid'], { stdio: 'ignore', timeout: 15000 });
    const cert = await readFile(path.join(dir, 'synthetic-cert.pem'));
    sqlite = new DatabaseSync(database); sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE _lantern_local_migrations(name TEXT PRIMARY KEY,sha TEXT NOT NULL)');
    for (const name of migrations) {
      const sql = await readFile(new URL('../../drizzle/' + name, import.meta.url));
      sqlite.exec(sql.toString('utf8'));
      sqlite.prepare('INSERT INTO _lantern_local_migrations(name,sha) VALUES(?,?)').run(name, createHash('sha256').update(sql).digest('hex'));
    }
    sqlite.close(); sqlite = undefined;

    const first = launch(dir); children.push(first.child);
    const listening = await first.ready;
    assert.equal(listening.ready, true); assert.equal(listening.address, '127.0.0.1');
    const call = (route, options) => request(listening.port, cert, route, options);
    assert.equal((await call('/health')).status, 200);
    assert.equal((await call('/health', { host: 'other.invalid' })).status, 403);
    assert.equal((await call('/api/auth/register', { requestOrigin: 'https://other.invalid', body: { username: 'ignored_user', password: 'synthetic-password-123' } })).status, 403);
    assert.equal((await call('/api/auth/phone/status')).status, 404);
    assert.equal((await call('/candidate/sync/page', { body: {} })).status, 404);
    const alice = await call('/api/auth/register', { body: { username: 'synthetic_alice', password: 'synthetic-password-123' } });
    assert.equal(alice.status, 200, alice.body); const owner = JSON.parse(alice.body).user.id;
    const bob = await call('/api/auth/register', { body: { username: 'synthetic_bob', password: 'synthetic-password-456' } });
    assert.equal(bob.status, 200, bob.body); assert.notEqual(JSON.parse(bob.body).user.id, owner);
    assert.equal(JSON.parse((await call('/api/auth/session', { cookie: alice.cookie })).body).user.id, owner);
    assert.notEqual(JSON.parse((await call('/api/auth/session', { cookie: bob.cookie })).body).user.id, owner);
    const duplicate = await Promise.all([1, 2].map(n => call('/api/auth/register', { body: { username: 'synthetic_race', password: 'synthetic-password-' + n } })));
    assert.equal(duplicate.filter(item => item.status === 200).length, 1);
    assert.ok(duplicate.every(item => [200, 400, 429].includes(item.status)));

    const competing = launch(dir); children.push(competing.child);
    assert.equal((await competing.ready).ready, false); assert.equal(await competing.exited, 1);
    assert.equal((await call('/health')).status, 200);
    first.child.send('stop'); assert.equal(await first.exited, 0);
    assert.equal(existsSync(path.join(dir, 'lantern-d1.lock')), false);

    const second = launch(dir); children.push(second.child);
    const restarted = await second.ready; assert.equal(restarted.ready, true); assert.equal(restarted.address, '127.0.0.1');
    const next = (route, options) => request(restarted.port, cert, route, options);
    assert.equal(JSON.parse((await next('/api/auth/session', { cookie: alice.cookie })).body).user.id, owner);
    const login = await next('/api/auth/login', { body: { username: 'synthetic_alice', password: 'synthetic-password-123' } });
    assert.equal(login.status, 200, login.body); assert.equal(JSON.parse(login.body).user.id, owner);
    assert.equal((await next('/api/auth/logout', { method: 'POST', cookie: alice.cookie })).status, 200);
    assert.equal((await next('/api/auth/session', { cookie: alice.cookie })).status, 401);
    assert.equal((await next('/api/auth/session', { cookie: bob.cookie })).status, 200);
    second.child.send('stop'); assert.equal(await second.exited, 0);

    sqlite = new DatabaseSync(database);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM auth_users WHERE username=?').get('synthetic_race').n, 1);
    sqlite.exec('CREATE TRIGGER synthetic_tamper AFTER INSERT ON auth_users BEGIN SELECT 1; END');
    sqlite.close(); sqlite = undefined;
    const invalid = launch(dir); children.push(invalid.child);
    assert.equal((await invalid.ready).ready, false); assert.equal(await invalid.exited, 1);
    assert.equal(existsSync(path.join(dir, 'lantern-d1.lock')), false);
  } finally {
    await Promise.all(children.map(child => child.exitCode === null && child.signalCode === null
      ? new Promise(resolve => { child.once('exit', resolve); child.kill(); }) : undefined));
    sqlite?.close();
    const absolute = await realpath(dir), tmp = await realpath(os.tmpdir());
    if (path.dirname(absolute) !== tmp || !path.basename(absolute).startsWith('lantern-node-runtime-')) throw Error('unsafe synthetic directory');
    await rm(absolute, { recursive: true, force: true });
  }
});
