'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createSyntheticPhoneProvider, createSyntheticTransactionStore } = require('./helpers/synthetic-phone.cjs');
const { createPhoneVerificationBoundary, PHONE_PROOF_MAX_LIFETIME_MS, PHONE_PROOF_FUTURE_SKEW_MS } = require('./helpers/phone-verification-runtime.cjs')();

// Deliberately synthetic format-only numbers. Nothing sends SMS or calls a network.
const PHONE_A = '+8610000000001';
const PHONE_B = '+8610000000002';
const USER_A = 'usr_11111111-1111-4111-8111-111111111111';
const USER_B = 'usr_22222222-2222-4222-8222-222222222222';
const AUDIENCE = 'urn:lantern:phone:synthetic:v1';
const BIND_A = { purpose: 'bind', phone: PHONE_A, bindingUserId: USER_A };

function fixture(options = {}) {
  let time = 1_761_000_000_000;
  const now = () => time;
  const clock = { now, advance(ms) { time += ms; } };
  const fake = createSyntheticPhoneProvider({ now, ...options.fakeOptions });
  const memory = createSyntheticTransactionStore({ now, users: [USER_A, USER_B], ...options.storeOptions });
  const config = { provider: fake.provider, providerId: 'synthetic-test', audience: AUDIENCE, store: memory.store, now };
  return { clock, fake, memory, config, boundary: createPhoneVerificationBoundary(config) };
}

function credential(f, expected = BIND_A, changes = {}) {
  const context = { ...expected, audience: AUDIENCE, ...changes };
  const { challengeId } = f.fake.issueChallenge(context);
  const code = f.fake.readOutOfBandCode(challengeId);
  const token = f.fake.redeemChallenge({ challengeId, code, ...context });
  assert.equal(typeof token, 'string');
  return token;
}

function assertion(f, changes = {}) {
  return {
    ...BIND_A, audience: AUDIENCE, proofId: randomBytes(32).toString('base64url'),
    issuedAt: f.clock.now(), expiresAt: f.clock.now() + 60_000, ...changes,
  };
}

function boundaryWithAssertion(f, value, extra = {}) {
  return createPhoneVerificationBoundary({ ...f.config, provider: { async verify() { return value; } }, ...extra });
}

test('missing operator provider/audience/store stays unavailable; request flags cannot activate a fake', async () => {
  const f = fixture();
  for (const changes of [
    { provider: undefined }, { store: undefined }, { audience: undefined },
    { audience: '' }, { audience: ' contains-space' }, { providerId: undefined },
    { providerId: '../fake' }, { provider: {} }, { store: {} }, { now: null },
  ]) {
    const boundary = createPhoneVerificationBoundary({ ...f.config, ...changes });
    assert.equal(boundary.available, false);
    const response = await boundary.verifyAndCommit({ ...BIND_A, fake: true, provider: f.fake.provider }, 'opaque');
    assert.equal(response.error, 'unavailable');
  }
  assert.equal(f.fake.calls(), 0);
  assert.equal(f.memory.snapshot().attempts, 0);
});

test('synthetic challenge returns no code; separate test channel obtains random code and opaque assertion', async () => {
  const f = fixture();
  const context = { ...BIND_A, audience: AUDIENCE };
  const first = f.fake.issueChallenge(context);
  const second = f.fake.issueChallenge(context);
  assert.deepEqual(Object.keys(first), ['challengeId']);
  assert.notEqual(first.challengeId, second.challengeId);
  const firstCode = f.fake.readOutOfBandCode(first.challengeId);
  const secondCode = f.fake.readOutOfBandCode(second.challengeId);
  assert.match(firstCode, /^[0-9]{6}$/);
  assert.match(secondCode, /^[0-9]{6}$/);
  const firstToken = f.fake.redeemChallenge({ ...first, ...context, code: firstCode });
  const secondToken = f.fake.redeemChallenge({ ...second, ...context, code: secondCode });
  assert.notEqual(firstToken, secondToken);
  assert.match(firstToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(f.fake.redeemChallenge({ ...first, ...context, code: firstCode }), null);
  const result = await f.boundary.verifyAndCommit(BIND_A, firstToken);
  assert.equal(result.ok, true);
  assert.equal(result.userId, USER_A);
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'phone', 'purpose', 'userId']);
  assert.equal(f.memory.snapshot().phones.get(PHONE_A), USER_A);
});

test('wrong codes consume a bounded challenge attempt budget; no universal fallback code', () => {
  const f = fixture();
  const context = { ...BIND_A, audience: AUDIENCE };
  const challenge = f.fake.issueChallenge(context);
  const correct = f.fake.readOutOfBandCode(challenge.challengeId);
  const wrong = correct === '100000' ? '100001' : '100000';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(f.fake.redeemChallenge({ ...challenge, ...context, code: wrong }), null);
  }
  assert.equal(f.fake.redeemChallenge({ ...challenge, ...context, code: correct }), null);
  assert.equal(f.memory.snapshot().consumed, 0);
});

test('fake rejects expired challenges and code redemption under altered context', () => {
  for (const change of [
    { purpose: 'login' }, { audience: 'another-audience' }, { phone: PHONE_B }, { bindingUserId: USER_B },
  ]) {
    const f = fixture();
    const context = { ...BIND_A, audience: AUDIENCE };
    const challenge = f.fake.issueChallenge(context);
    assert.equal(f.fake.redeemChallenge({ ...challenge, ...context, ...change, code: f.fake.readOutOfBandCode(challenge.challengeId) }), null);
  }
  const f = fixture();
  const context = { ...BIND_A, audience: AUDIENCE };
  const challenge = f.fake.issueChallenge(context);
  f.clock.advance(60_000);
  assert.equal(f.fake.redeemChallenge({ ...challenge, ...context, code: f.fake.readOutOfBandCode(challenge.challengeId) }), null);
});

test('malformed requests and credentials never call the provider or store', async () => {
  const f = fixture();
  for (const expected of [null, {}, { ...BIND_A, purpose: 'reset' }, { ...BIND_A, phone: '10000000001' },
    { ...BIND_A, phone: '+1' }, { ...BIND_A, phone: '+86 10000000001' },
    { ...BIND_A, phone: '+8610000000001\n' }, { ...BIND_A, bindingUserId: 'harmony-device' },
    { ...BIND_A, bindingUserId: USER_A.toUpperCase() }, { purpose: 'login', phone: PHONE_A, bindingUserId: USER_A },
  ]) {
    assert.equal((await f.boundary.verifyAndCommit(expected, 'opaque')).error, 'invalid-request');
  }
  for (const token of [undefined, null, {}, 123, '', 'a b', 'a\n', 'a\0', 'x'.repeat(4097), '验证码']) {
    assert.equal((await f.boundary.verifyAndCommit(BIND_A, token)).error, 'invalid-request');
  }
  assert.equal(f.fake.calls(), 0);
  assert.equal(f.memory.snapshot().attempts, 0);
});

test('provider receives a frozen server audience/context; client extra audience cannot replace it', async () => {
  const f = fixture();
  let seen;
  const provider = { async verify(token, expected) {
    seen = expected;
    assert.equal(Object.isFrozen(expected), true);
    return assertion(f);
  } };
  const boundary = createPhoneVerificationBoundary({ ...f.config, provider });
  const result = await boundary.verifyAndCommit({ ...BIND_A, audience: 'client-chosen-audience' }, 'opaque');
  assert.equal(result.ok, true);
  assert.equal(seen.audience, AUDIENCE);
  assert.equal(seen.bindingUserId, USER_A);
});

test('unrecognized opaque assertion and provider outage fail closed without transaction', async () => {
  const f = fixture();
  assert.equal((await f.boundary.verifyAndCommit(BIND_A, randomBytes(32).toString('base64url'))).error, 'invalid-proof');
  const boundary = createPhoneVerificationBoundary({ ...f.config, provider: { async verify() { throw new Error('Synthetic provider outage'); } } });
  assert.equal((await boundary.verifyAndCommit(BIND_A, 'opaque')).error, 'unavailable');
  assert.equal(f.memory.snapshot().attempts, 0);
});

test('wrapper independently rejects wrong purpose, audience, phone and binding user from an adapter', async () => {
  const f = fixture();
  for (const change of [
    { purpose: 'login' }, { audience: 'wrong' }, { phone: PHONE_B },
    { bindingUserId: USER_B }, { bindingUserId: null }, { bindingUserId: undefined },
  ]) {
    assert.equal((await boundaryWithAssertion(f, assertion(f, change)).verifyAndCommit(BIND_A, 'opaque')).error, 'invalid-proof');
  }
  assert.equal(f.memory.snapshot().attempts, 0);
});

test('wrapper independently rejects malformed proof identifiers and assertion schema', async () => {
  const f = fixture();
  for (const value of [null, [], true, 'assertion', {},
    assertion(f, { proofId: 'short' }), assertion(f, { proofId: 'x'.repeat(129) }),
    assertion(f, { proofId: 'a'.repeat(22) + '\n' }), assertion(f, { proofId: 123 }),
    assertion(f, { issuedAt: '1761000000000' }), assertion(f, { expiresAt: Infinity }),
  ]) {
    assert.equal((await boundaryWithAssertion(f, value).verifyAndCommit(BIND_A, 'opaque')).error, 'invalid-proof');
  }
  assert.equal(f.memory.snapshot().attempts, 0);
});

test('server validates expiry, future skew, lifetime, clock units and exact millisecond boundaries', async () => {
  const f = fixture();
  const now = f.clock.now();
  for (const change of [
    { expiresAt: now }, { issuedAt: now - 60_001, expiresAt: now - 1 },
    { issuedAt: now + PHONE_PROOF_FUTURE_SKEW_MS + 1, expiresAt: now + 60_000 },
    { issuedAt: now - PHONE_PROOF_MAX_LIFETIME_MS - 1, expiresAt: now + 1 },
    { expiresAt: now + PHONE_PROOF_MAX_LIFETIME_MS + 1 },
    { issuedAt: now, expiresAt: now }, { issuedAt: now + 1, expiresAt: now },
    { issuedAt: -1 }, { issuedAt: now + 0.1 }, { expiresAt: Number.MAX_SAFE_INTEGER + 1 },
    { issuedAt: Math.floor(now / 1000), expiresAt: Math.floor(now / 1000) + 60 },
  ]) {
    assert.equal((await boundaryWithAssertion(f, assertion(f, change)).verifyAndCommit(BIND_A, 'opaque')).error, 'invalid-proof');
  }
  const lastMillisecond = assertion(f, { issuedAt: now - 59_999, expiresAt: now + 1 });
  assert.equal((await boundaryWithAssertion(f, lastMillisecond).verifyAndCommit(BIND_A, 'opaque')).ok, true);
});

test('expiry while waiting for provider is checked after verification', async () => {
  const f = fixture();
  const proof = assertion(f);
  const boundary = createPhoneVerificationBoundary({ ...f.config, provider: { async verify() {
    f.clock.advance(60_000);
    return proof;
  } } });
  assert.equal((await boundary.verifyAndCommit(BIND_A, 'opaque')).error, 'invalid-proof');
  assert.equal(f.memory.snapshot().attempts, 0);
});

test('store rechecks expiry at commit and rolls back an otherwise valid proof', async () => {
  const f = fixture();
  const memory = createSyntheticTransactionStore({ now: f.clock.now, users: [USER_A], beforeCommit() { f.clock.advance(60_000); } });
  const boundary = createPhoneVerificationBoundary({ ...f.config, store: memory.store });
  assert.equal((await boundary.verifyAndCommit(BIND_A, credential(f))).error, 'invalid-proof');
  assert.equal(memory.snapshot().consumed, 0);
  assert.equal(memory.snapshot().phones.size, 0);
});

test('successful bind consumes one proof; replay does not add bindings or sessions', async () => {
  const f = fixture();
  const token = credential(f);
  assert.equal((await f.boundary.verifyAndCommit(BIND_A, token)).ok, true);
  assert.equal((await f.boundary.verifyAndCommit(BIND_A, token)).error, 'replayed');
  assert.equal(f.memory.snapshot().consumed, 1);
  assert.equal(f.memory.snapshot().phones.size, 1);
  assert.equal(f.memory.snapshot().sessions.length, 0);
});

test('parallel attempts of the same proof commit exactly once', async () => {
  const f = fixture();
  const token = credential(f);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.boundary.verifyAndCommit(BIND_A, token)));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => result.error === 'replayed').length, 7);
  assert.equal(f.memory.snapshot().consumed, 1);
});

test('same phone/same user is idempotent with a new proof; proof itself remains one-use', async () => {
  const f = fixture({ storeOptions: { bindings: [[PHONE_A, USER_A]] } });
  assert.equal((await f.boundary.verifyAndCommit(BIND_A, credential(f))).ok, true);
  assert.equal((await f.boundary.verifyAndCommit(BIND_A, credential(f))).ok, true);
  assert.equal(f.memory.snapshot().phones.size, 1);
  assert.equal(f.memory.snapshot().consumed, 2);
});

test('one phone cannot move to another user and rejection does not spend its proof', async () => {
  const f = fixture({ storeOptions: { bindings: [[PHONE_A, USER_A]] } });
  const expected = { ...BIND_A, bindingUserId: USER_B };
  const token = credential(f, expected);
  assert.equal((await f.boundary.verifyAndCommit(expected, token)).error, 'binding-conflict');
  assert.equal((await f.boundary.verifyAndCommit(expected, token)).error, 'binding-conflict');
  assert.equal(f.memory.snapshot().phones.get(PHONE_A), USER_A);
  assert.equal(f.memory.snapshot().consumed, 0);
});

test('bounded contract rejects replacing an existing user phone', async () => {
  const f = fixture({ storeOptions: { bindings: [[PHONE_A, USER_A]] } });
  const expected = { ...BIND_A, phone: PHONE_B };
  assert.equal((await f.boundary.verifyAndCommit(expected, credential(f, expected))).error, 'binding-conflict');
  assert.equal(f.memory.snapshot().phones.has(PHONE_B), false);
  assert.equal(f.memory.snapshot().consumed, 0);
});

test('parallel distinct proofs competing for one phone yield one stable user owner', async () => {
  const f = fixture();
  const expectedB = { ...BIND_A, bindingUserId: USER_B };
  const results = await Promise.all([
    f.boundary.verifyAndCommit(BIND_A, credential(f)),
    f.boundary.verifyAndCommit(expectedB, credential(f, expectedB)),
  ]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => result.error === 'binding-conflict').length, 1);
  assert.equal(f.memory.snapshot().phones.size, 1);
  assert.equal(f.memory.snapshot().consumed, 1);
});

test('bind cannot create a user or bypass an expired/revoked server session', async () => {
  const f = fixture();
  f.memory.setSessionActive(USER_A, false);
  const token = credential(f);
  assert.equal((await f.boundary.verifyAndCommit(BIND_A, token)).error, 'unauthorized');
  assert.equal(f.memory.snapshot().consumed, 0);
  const absentUser = 'usr_33333333-3333-4333-8333-333333333333';
  const expected = { ...BIND_A, bindingUserId: absentUser };
  assert.equal((await f.boundary.verifyAndCommit(expected, credential(f, expected))).error, 'unauthorized');
  assert.equal(f.memory.snapshot().phones.size, 0);
});

test('login resolves the bound existing user and commits one synthetic session marker atomically', async () => {
  const f = fixture({ storeOptions: { bindings: [[PHONE_A, USER_B]] } });
  const expected = { purpose: 'login', phone: PHONE_A };
  const token = credential(f, expected);
  const result = await f.boundary.verifyAndCommit(expected, token);
  assert.equal(result.ok, true);
  assert.equal(result.userId, USER_B);
  assert.deepEqual(f.memory.snapshot().sessions, [USER_B]);
  assert.equal((await f.boundary.verifyAndCommit(expected, token)).error, 'replayed');
  assert.equal(f.memory.snapshot().sessions.length, 1);
});

test('unbound phone login never creates an account, binding or session', async () => {
  const f = fixture();
  const expected = { purpose: 'login', phone: PHONE_A };
  assert.equal((await f.boundary.verifyAndCommit(expected, credential(f, expected))).error, 'not-bound');
  assert.equal(f.memory.snapshot().phones.size, 0);
  assert.equal(f.memory.snapshot().consumed, 0);
  assert.equal(f.memory.snapshot().sessions.length, 0);
});

test('login requires null binding-user assertion and bind proof cannot be reused for login', async () => {
  const f = fixture({ storeOptions: { bindings: [[PHONE_A, USER_A]] } });
  const login = { purpose: 'login', phone: PHONE_A };
  assert.equal((await f.boundary.verifyAndCommit(login, credential(f))).error, 'invalid-proof');
  const wrongAssertion = assertion(f, { purpose: 'login', bindingUserId: USER_A });
  assert.equal((await boundaryWithAssertion(f, wrongAssertion).verifyAndCommit(login, 'opaque')).error, 'invalid-proof');
  assert.equal(f.memory.snapshot().sessions.length, 0);
});

test('transaction exception rolls back binding, proof and session changes; exact retry can succeed', async () => {
  for (const purpose of ['bind', 'login']) {
    const f = fixture({ storeOptions: { bindings: purpose === 'login' ? [[PHONE_A, USER_A]] : [] } });
    const expected = purpose === 'bind' ? BIND_A : { purpose, phone: PHONE_A };
    const token = credential(f, expected);
    f.memory.failNextCommit();
    assert.equal((await f.boundary.verifyAndCommit(expected, token)).error, 'unavailable');
    assert.equal(f.memory.snapshot().consumed, 0);
    assert.equal(f.memory.snapshot().sessions.length, 0);
    assert.equal(f.memory.snapshot().phones.size, purpose === 'login' ? 1 : 0);
    assert.equal((await f.boundary.verifyAndCommit(expected, token)).ok, true);
    assert.equal(f.memory.snapshot().consumed, 1);
  }
});

test('transaction receives only checked context and proof primitives, never raw credential or extra adapter fields', async () => {
  const f = fixture();
  let command;
  const store = { async commitVerifiedPhone(value) {
    command = value;
    return { status: 'committed', userId: USER_A };
  } };
  const value = assertion(f, { providerSecret: 'synthetic-extra', token: 'synthetic-extra' });
  const result = await boundaryWithAssertion(f, value, { store }).verifyAndCommit(BIND_A, 'synthetic-opaque-input');
  assert.equal(result.ok, true);
  assert.equal(Object.isFrozen(command), true);
  assert.deepEqual(Object.keys(command).sort(), ['audience', 'bindingUserId', 'expiresAt', 'issuedAt', 'phone', 'proofId', 'providerId', 'purpose', 'verifiedAt']);
  assert.equal(JSON.stringify(command).includes('synthetic-opaque-input'), false);
  assert.equal(JSON.stringify(result).includes(value.proofId), false);
  assert.equal(JSON.stringify(result).includes('synthetic-extra'), false);
});

test('malformed or mismatched store success never becomes an authenticated response', async () => {
  const f = fixture();
  for (const response of [null, {}, { status: 'unknown' }, { status: 'committed', userId: 'harmony-device' },
    { status: 'committed', userId: USER_B }, { status: 'committed', userId: undefined }]) {
    const store = { async commitVerifiedPhone() { return response; } };
    assert.equal((await boundaryWithAssertion(f, assertion(f), { store }).verifyAndCommit(BIND_A, 'opaque')).error, 'unavailable');
  }
});

test('clock failure or hostile assertion access cannot authenticate or call the transaction', async () => {
  const f = fixture();
  for (const now of [() => NaN, () => -1, () => Infinity, () => { throw new Error('Synthetic clock error'); }]) {
    assert.equal((await boundaryWithAssertion(f, assertion(f), { now }).verifyAndCommit(BIND_A, 'opaque')).error, 'invalid-proof');
  }
  const value = { get purpose() { throw new Error('Synthetic malformed adapter object'); } };
  assert.equal((await boundaryWithAssertion(f, value).verifyAndCommit(BIND_A, 'opaque')).error, 'invalid-proof');
  assert.equal(f.memory.snapshot().attempts, 0);
});

test('adapter fields are snapshotted once before checks rather than reread from changing getters', async () => {
  const f = fixture();
  const value = assertion(f);
  const reads = new Map();
  const snapshot = {};
  for (const [key, field] of Object.entries(value)) {
    Object.defineProperty(snapshot, key, { get() {
      reads.set(key, (reads.get(key) || 0) + 1);
      if (reads.get(key) > 1) throw new Error('Synthetic repeated field access');
      return field;
    } });
  }
  assert.equal((await boundaryWithAssertion(f, snapshot).verifyAndCommit(BIND_A, 'opaque')).ok, true);
  assert.equal([...reads.values()].every(count => count === 1), true);
});

test('product source has no import/require, fake factory, environment flag, network client or logging path', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../lib/phone-verification.ts'), 'utf8');
  const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(executable, /\b(?:import|require|process|fetch|console|XMLHttpRequest|createSyntheticPhoneProvider)\b/);
});
