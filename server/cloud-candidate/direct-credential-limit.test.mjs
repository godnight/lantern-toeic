import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import path from 'node:path';
import { createDirectCredentialLimiter, directSourceGroup, validateDirectCredentialPolicy, DIRECT_CREDENTIAL_WINDOW_MS } from './direct-credential-limit.candidate.mjs';
import { createHttpsHandler } from './https-handler.candidate.mjs';
import { validateNativeAccountConfig } from './native-account-config.candidate.mjs';

const policy = Object.freeze({ mode: 'direct', credentialsPerWindow: 20, registrationsPerWindow: 4, maxSources: 8 });
const origin = 'https://account.synthetic.test', host = 'account.synthetic.test';
function request(address, action, extra = {}) {
  const req = Readable.from([Buffer.from('{}')]);
  req.method = 'POST'; req.url = '/api/auth/' + action;
  req.headers = { host, origin, 'content-type': 'application/json', ...extra };
  req.rawHeaders = Object.entries(req.headers).flat();
  req.socket = { servername: host, remoteAddress: address };
  return req;
}
function response() {
  return { headersSent: false, destroyed: false, writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    end(data) { this.body = data; }, destroy() { this.destroyed = true; } };
}
async function call(handler, address, action, extra) {
  const req = request(address, action, extra), res = response();
  await handler(req, res); return res;
}

test('direct source normalization groups mapped IPv4 and IPv6 privacy addresses', () => {
  assert.equal(directSourceGroup('192.0.2.1'), directSourceGroup('::ffff:192.0.2.1'));
  assert.equal(directSourceGroup('192.0.2.1'), directSourceGroup('::ffff:c000:201'));
  assert.equal(directSourceGroup('2001:DB8:1:2::1'), directSourceGroup('2001:db8:0001:0002:ffff::1'));
  assert.notEqual(directSourceGroup('2001:db8:1:2::1'), directSourceGroup('2001:db8:1:3::1'));
  for (const value of [undefined, '', '192.0.2.01', 'not-an-ip', 'fe80::1%eth0', 'x'.repeat(65)]) assert.equal(directSourceGroup(value), null);
});

test('policy is explicit, configurable and cannot allow one source the whole global budget', () => {
  assert.deepEqual(validateDirectCredentialPolicy(policy), policy);
  for (const bad of [null, {}, { ...policy, mode: 'proxy' }, { ...policy, credentialsPerWindow: 100 },
    { ...policy, registrationsPerWindow: 20 }, { ...policy, registrationsPerWindow: 21 },
    { ...policy, credentialsPerWindow: 3, registrationsPerWindow: 4 }, { ...policy, maxSources: 0 },
    { ...policy, maxSources: 16385 }, { ...policy, extra: true }]) assert.throws(() => validateDirectCredentialPolicy(bad));
  const base = { enabled: true, origin, bindAddress: '10.0.0.2', certRoot: path.resolve('synthetic-certs'), slot: 'current', lockDir: path.resolve('synthetic-data'), workerRoot: path.resolve('synthetic-worker'), workerSha256: 'a'.repeat(64) };
  assert.equal(validateNativeAccountConfig(base).directCredentialPolicy, undefined);
  assert.deepEqual(validateNativeAccountConfig({ ...base, directCredentialPolicy: policy }).directCredentialPolicy, policy);
  assert.deepEqual(validateNativeAccountConfig({ ...base, huawei: { clientId: '1234', secretFile: path.resolve('synthetic-huawei', 'huawei-client-secret') }, directCredentialPolicy: policy }).directCredentialPolicy, policy);
  assert.throws(() => validateNativeAccountConfig({ ...base, directCredentialPolicy: { ...policy, mode: 'proxy' } }));
});

test('one source has bounded attempts and registration share, without consuming another source', () => {
  let time = DIRECT_CREDENTIAL_WINDOW_MS;
  const limiter = createDirectCredentialLimiter(policy, { now: () => time });
  for (let i = 0; i < 4; i++) assert.equal(limiter.reserve('192.0.2.1', 'register').allowed, true);
  assert.equal(limiter.reserve('::ffff:192.0.2.1', 'register').allowed, false);
  for (let i = 0; i < 16; i++) assert.equal(limiter.reserve('192.0.2.1', 'login').allowed, true);
  assert.equal(limiter.reserve('192.0.2.1', 'login').allowed, false);
  assert.equal(limiter.reserve('192.0.2.2', 'login').allowed, true);
  time -= DIRECT_CREDENTIAL_WINDOW_MS; assert.equal(limiter.reserve('192.0.2.1', 'login').allowed, false, 'clock rollback cannot reset');
  time += 2 * DIRECT_CREDENTIAL_WINDOW_MS; assert.equal(limiter.reserve('192.0.2.1', 'login').allowed, true);
});

test('full source table never evicts live entries, and busy refunds are idempotent and window-scoped', () => {
  let time = DIRECT_CREDENTIAL_WINDOW_MS;
  const limiter = createDirectCredentialLimiter({ ...policy, credentialsPerWindow: 1, registrationsPerWindow: 1, maxSources: 1 }, { now: () => time });
  const first = limiter.reserve('192.0.2.1', 'login'); assert.equal(first.allowed, true);
  assert.equal(limiter.reserve('192.0.2.2', 'login').allowed, false);
  assert.equal(limiter.reserve('192.0.2.1', 'login').allowed, false);
  first.refundBusy(); first.refundBusy();
  const second = limiter.reserve('192.0.2.1', 'login'); assert.equal(second.allowed, true);
  assert.equal(limiter.reserve('192.0.2.1', 'login').allowed, false);
  time += DIRECT_CREDENTIAL_WINDOW_MS;
  assert.equal(limiter.reserve('192.0.2.1', 'login').allowed, true);
  second.refundBusy(); assert.equal(limiter.reserve('192.0.2.1', 'login').allowed, false, 'old-window response cannot refund new window');
});

test('a source with only refunded busy requests cannot fill the bounded table', () => {
  const limiter = createDirectCredentialLimiter({ ...policy, maxSources: 1 });
  const one = limiter.reserve('192.0.2.1', 'login'); assert.equal(one.allowed, true); one.refundBusy();
  assert.equal(limiter.reserve('192.0.2.2', 'login').allowed, true);
});

test('busy refunds remain correct when requests finish out of order', () => {
  const limiter = createDirectCredentialLimiter({ ...policy, credentialsPerWindow: 2, registrationsPerWindow: 1 });
  const first = limiter.reserve('192.0.2.1', 'login'), second = limiter.reserve('192.0.2.1', 'login');
  assert.equal(limiter.reserve('192.0.2.1', 'login').allowed, false);
  second.refundBusy(); const third = limiter.reserve('192.0.2.1', 'login'); assert.equal(third.allowed, true);
  second.refundBusy(); assert.equal(limiter.reserve('192.0.2.1', 'login').allowed, false);
  first.refundBusy(); assert.equal(limiter.reserve('192.0.2.1', 'login').allowed, true);
  assert.equal(limiter.reserve('192.0.2.1', 'login').allowed, false);
});

test('handler trusts only socket peer, bounds concurrent requests and ignores spoofed client IP headers', async () => {
  let calls = 0;
  const handler = createHttpsHandler({ origin, directCredentialPolicy: policy,
    channel: { async dispatch() { calls++; await new Promise(resolve => setImmediate(resolve)); return Response.json({ code: 'invalid-credentials' }, { status: 401 }); } } });
  const results = await Promise.all(Array.from({ length: 60 }, (_, i) => call(handler, '192.0.2.1', 'login', { 'cf-connecting-ip': '198.51.100.' + i })));
  assert.equal(calls, 20); assert.equal(results.filter(result => result.status === 401).length, 20);
  assert.equal(results.filter(result => result.status === 429).length, 40);
  assert.equal(JSON.parse(results.find(result => result.status === 429).body).code, 'too-many-attempts');
  assert.equal((await call(handler, '192.0.2.2', 'login')).status, 401);
  assert.equal((await call(handler, '192.0.2.2', 'login', { 'x-forwarded-for': '192.0.2.3' })).status, 400);
  assert.equal((await call(handler, undefined, 'login')).status, 429);
});

test('handler refunds only a definitive completed busy response; disconnects and failures spend reservation', async () => {
  const small = { ...policy, credentialsPerWindow: 1, registrationsPerWindow: 1 };
  let responseStatus = 'busy', currentResponse;
  const handler = createHttpsHandler({ origin, directCredentialPolicy: small, channel: { async dispatch() {
    if (responseStatus === 'throw') throw Error('synthetic failure');
    if (responseStatus === 'malformed') return new Response('{', { status: 429 });
    if (responseStatus === 'disconnect') currentResponse.destroyed = true;
    return Response.json({ code: 'auth-busy' }, { status: 429 });
  } } });
  for (let i = 0; i < 5; i++) assert.equal((await call(handler, '192.0.2.1', 'login')).status, 429);
  responseStatus = 'throw'; assert.equal((await call(handler, '192.0.2.1', 'login')).status, 503);
  assert.equal((await call(handler, '192.0.2.1', 'login')).status, 429);
  responseStatus = 'disconnect'; const req = request('192.0.2.2', 'login'); currentResponse = response();
  await handler(req, currentResponse);
  assert.equal((await call(handler, '192.0.2.2', 'login')).status, 429);
  responseStatus = 'malformed'; const malformed = await call(handler, '192.0.2.3', 'login');
  assert.equal(malformed.status, 429); assert.equal(malformed.body.toString(), '{');
  const denied = await call(handler, '192.0.2.3', 'login');
  assert.equal(denied.status, 429); assert.equal(JSON.parse(denied.body).code, 'too-many-attempts');
});
