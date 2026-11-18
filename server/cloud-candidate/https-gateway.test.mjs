import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { buildAccountWorker } from './build-inputs.mjs';
import { prepareCloudService } from './service.candidate.mjs';
import { createLocalChannel, signEnvelope, verifyEnvelope, createRequestEnvelopeVerifier } from './local-channel.candidate.mjs';
import { createHttpsHandler } from './https-handler.candidate.mjs';
import { startProductionGateway, readProductionCertificate, validateCertificateMaterial } from './https-gateway.candidate.mjs';

const host = 'account.synthetic.test', origin = 'https://' + host;
async function temporary() { return mkdtemp(path.join(os.tmpdir(), 'lantern-https-test-')); }
async function cleanup(dir) { const absolute = await realpath(dir), tmp = await realpath(os.tmpdir()); if (path.dirname(absolute) !== tmp || !path.basename(absolute).startsWith('lantern-https-test-')) throw Error('unsafe test directory'); await rm(absolute, { recursive: true, force: true }); }
async function certs(dir) {
  const config = path.join(dir, 'openssl.cnf'); await writeFile(config, '[req]\ndistinguished_name=dn\n[dn]\n');
  const exe = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  execFileSync(exe, ['req', '-config', config, '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=synthetic.test', '-addext', `subjectAltName=DNS:${host}`], { stdio: 'ignore', timeout: 15000 });
  return { key: await readFile(path.join(dir, 'key.pem')), cert: await readFile(path.join(dir, 'cert.pem')) };
}
function call(port, ca, route, { body, cookie, httpHost = host, sni = host, extra = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body && JSON.stringify(body);
    const req = https.request({ host: '127.0.0.1', port, servername: sni, ca, path: route, method: data ? 'POST' : 'GET',
      headers: { host: httpHost, ...(data ? { origin, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...extra } }, res => {
      const chunks = []; res.on('data', x => chunks.push(x)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }); req.on('error', reject); req.end(data);
  });
}
test('HTTPS fixed routes reach actual account Worker and D1; provider stays closed', { timeout: 60000 }, async () => {
  const dir = await temporary(); let mf, server, service;
  try {
    const material = await certs(dir), worker = await buildAccountWorker();
    validateCertificateMaterial({ ...material, origin });
    assert.throws(() => validateCertificateMaterial({ ...material, origin: 'https://other.synthetic.test' }), /certificate mismatch/);
    assert.throws(() => validateCertificateMaterial({ cert: material.cert, key: material.cert, origin }));
    mf = new Miniflare({ modules: true, script: worker.bytes.toString(), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
      cf: false, host: '127.0.0.1', port: 0, d1Databases: ['DB'], bindings: { LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin },
      outboundService: () => new Response(null, { status: 403 }), log: new Log(LogLevel.ERROR) });
    const db = await mf.getD1Database('DB');
    for (const name of ['0005_product_auth.sql', '0006_auth_admission_ticket.sql', '0009_huawei_auth.sql']) {
      const sql = await readFile(new URL('../../drizzle/' + name, import.meta.url), 'utf8');
      await db.batch(sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
    }
    service = await prepareCloudService({ enabled: true, origin, mf,
      directCredentialPolicy: { mode: 'direct', credentialsPerWindow: 2, registrationsPerWindow: 1, maxSources: 16 } });
    server = https.createServer(material, service.handler); server.on('tlsClientError', () => {});
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    assert.equal((await call(port, material.cert, '/health')).status, 200);
    assert.equal((await call(port, material.cert, '/health', { httpHost: 'other.synthetic.test' })).status, 403);
    assert.equal((await call(port, material.cert, '/not-a-route')).status, 404);
    assert.equal((await call(port, material.cert, '/api/auth/phone/status')).status, 404);
    assert.equal((await call(port, material.cert, '/candidate/sync/append', { body: {} })).status, 404);
    assert.equal((await call(port, material.cert, '/health', { extra: { 'x-lantern-proxy-signature': 'fake' } })).status, 400);
    assert.equal((await call(port, material.cert, '/health', { extra: { origin: [origin, origin] } })).status, 400);
    assert.equal((await call(port, material.cert, '/api/auth/register', { body: {}, extra: { origin: 'https://other.synthetic.test' } })).status, 403);
    const registration = await call(port, material.cert, '/api/auth/register', { body: { username: 'synthetic_https', password: 'synthetic-password-123' } });
    assert.equal(registration.status, 200, registration.body);
    const cookie = registration.headers['set-cookie'][0].split(';')[0];
    assert.equal((await call(port, material.cert, '/api/auth/session', { cookie })).status, 200);
    assert.equal((await call(port, material.cert, '/api/auth/logout', { cookie, body: {} })).status, 200);
    assert.equal((await call(port, material.cert, '/api/auth/session', { cookie })).status, 401);
    assert.equal((await call(port, material.cert, '/api/auth/login', { body: { username: 'synthetic_https', password: 'wrong-password-123' } })).status, 401);
    const stopped = await call(port, material.cert, '/api/auth/login', { body: { username: 'synthetic_other', password: 'wrong-password-123' }, extra: { 'cf-connecting-ip': '198.51.100.10' } });
    assert.equal(stopped.status, 429); assert.equal(JSON.parse(stopped.body).code, 'too-many-attempts');
    assert.equal((await db.prepare("SELECT count FROM auth_rate_limits WHERE scope='global:credentials'").first()).count, 2,
      'Source rejection must not spend another shared database admission slot');
    await assert.rejects(call(port, Buffer.from('untrusted'), '/health'));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (service) await service.close(); if (mf) await mf.dispose(); await cleanup(dir);
  }
});
test('direct source policy uses the real TLS socket peer and ignores forged IP headers', async () => {
  const dir = await temporary(); let server;
  try {
    const material = await certs(dir); let calls = 0;
    const handler = createHttpsHandler({ origin, directCredentialPolicy: { mode: 'direct', credentialsPerWindow: 2, registrationsPerWindow: 1, maxSources: 16 },
      channel: { async dispatch() { calls++; return Response.json({ code: 'invalid-credentials' }, { status: 401 }); } } });
    server = https.createServer(material, handler); server.on('tlsClientError', () => {});
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    for (let i = 0; i < 2; i++) assert.equal((await call(port, material.cert, '/api/auth/login', { body: { username: 'synthetic', password: 'synthetic-password' }, extra: { 'cf-connecting-ip': '198.51.100.' + i } })).status, 401);
    const limited = await call(port, material.cert, '/api/auth/login', { body: { username: 'synthetic', password: 'synthetic-password' }, extra: { 'cf-connecting-ip': '198.51.100.99' } });
    assert.equal(limited.status, 429); assert.deepEqual(JSON.parse(limited.body), { code: 'too-many-attempts', error: '尝试次数过多，请稍后再试' });
    assert.ok(Number(limited.headers['retry-after']) > 0); assert.equal(calls, 2);
    assert.equal((await call(port, material.cert, '/api/auth/login', { body: {}, extra: { 'x-forwarded-for': '203.0.113.1' } })).status, 400);
    assert.equal((await call(port, material.cert, '/health')).status, 401, 'Other routes do not spend or consult credential source budgets');
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await cleanup(dir); }
});
test('defaults are closed; envelope covers identity, route, body and response', async () => {
  await assert.rejects(prepareCloudService(), /disabled/);
  await assert.rejects(startProductionGateway(), /disabled/);
  let closed = false;
  await assert.rejects(startProductionGateway({ enabled: true, service: { handler() {}, async close() { closed = true; } }, bindAddress: '127.0.0.1' }), /socket activation/);
  assert.equal(closed, true);
  if (process.platform !== 'linux') assert.throws(() => readProductionCertificate(), /non-root Linux/);
  const key = randomBytes(32), body = ['POST', '/api/study?sync=native-m2a-v1', 1, 'nonce', { cookie: 'a', 'x-lantern-owner': 'user' }, 'body-hash'];
  const sig = signEnvelope(key, 'request', body); assert.equal(verifyEnvelope(key, 'request', body, sig), true);
  for (const changed of [[...body.slice(0, 1), '/api/study?other', ...body.slice(2)], [...body.slice(0, 4), { cookie: 'b', 'x-lantern-owner': 'user' }, body[5]], [...body.slice(0, 5), 'other-hash']]) assert.equal(verifyEnvelope(key, 'request', changed, sig), false);
  const response = ['nonce', 200, 'hash', ['session=a']], responseSig = signEnvelope(key, 'response', response);
  assert.equal(verifyEnvelope(key, 'response', ['nonce', 200, 'hash', ['session=b']], responseSig), false);
  const bytes = Buffer.from('payload'), verify = createRequestEnvelopeVerifier(key);
  const message = ['POST', '/api/study', Date.now(), randomBytes(16).toString('hex'), { cookie: 'a' }, createHash('sha256').update(bytes).digest('hex')];
  const signed = signEnvelope(key, 'request', message);
  assert.throws(() => verify(message, signed, Buffer.from('altered')), /invalid/);
  verify(message, signed, bytes); assert.throws(() => verify(message, signed, bytes), /replay/);
  const expired = [...message]; expired[2] = Date.now() - 31000; expired[3] = randomBytes(16).toString('hex');
  assert.throws(() => verify(expired, signEnvelope(key, 'request', expired), bytes), /invalid/);
});
test('channel shutdown waits after a real HTTPS client disconnects', async () => {
  const dir = await temporary(); let server, channel;
  try {
    const material = await certs(dir);
    let entered, release; const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    channel = createLocalChannel({ enabled: true, origin, assembly: { async fetch() { entered(); await gate; return Response.json({ ok: true }); } } });
    server = https.createServer(material, createHttpsHandler({ origin, channel }));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const req = https.request({ host: '127.0.0.1', port: server.address().port, servername: host, ca: material.cert, path: '/health', headers: { host } });
    req.on('error', () => {}); req.end(); await started; req.destroy();
    let finished = false; const close = channel.close().then(() => { finished = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false);
    release(); await close; assert.equal(finished, true);
    await assert.rejects(channel.dispatch(new Request(origin + '/health')), /unavailable/);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); if (channel) await channel.close(); await cleanup(dir); }
});
test('shutdown drains a request already reading its body', async () => {
  let entered, release; const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const channel = createLocalChannel({ enabled: true, origin, assembly: { async fetch(request) { return Response.json({ body: await request.text() }); } } });
  const stream = new ReadableStream({ async pull(controller) { entered(); await gate; controller.enqueue(new TextEncoder().encode('body')); controller.close(); } });
  const pending = channel.dispatch(new Request(origin + '/health', { method: 'POST', body: stream, duplex: 'half' }));
  await started; let finished = false; const close = channel.close().then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false); release();
  assert.equal((await (await pending).json()).body, 'body'); await close; assert.equal(finished, true);
});
