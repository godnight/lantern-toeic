import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { validDomainOrigin, isRootManagedCertificateStat } from './domain-policy.candidate.mjs';
import { createUnifiedD1Sync } from './unified-d1-sync.candidate.mjs';
import { parseProductionSyncSettings, requireIndependentSyncKey } from './production-sync-preflight.candidate.mjs';
import { prepareProductionSyncRuntime } from './production-sync-runtime.candidate.mjs';

test('domain policy only accepts a precise HTTPS DNS origin and protected certificate metadata', () => {
  assert.equal(validDomainOrigin('https://account.example.com'), true);
  for (const value of ['http://account.example.com', 'https://192.0.2.1', 'https://account.example.com:443', 'https://account.example.com/path', 'https://*.example.com']) assert.equal(validDomainOrigin(value), false);
  const file = { uid: 0, gid: 1234, mode: 0o100640, nlink: 1 };
  assert.equal(isRootManagedCertificateStat(file, 1234, false), true);
  for (const change of [{ uid: 1000 }, { mode: 0o100660 }, { nlink: 2 }]) assert.equal(isRootManagedCertificateStat({ ...file, ...change }, 1234, false), false);
});

test('sync cannot start accidentally and uses separate keys', async () => {
  assert.deepEqual(parseProductionSyncSettings({ enabled: false }), { enabled: false });
  await assert.rejects(createUnifiedD1Sync(), /disabled/);
  await assert.rejects(prepareProductionSyncRuntime({ settings: { enabled: false } }), /disabled/);
  const key = randomBytes(32), proxy = randomBytes(32), phone = randomBytes(32);
  requireIndependentSyncKey(key, proxy, phone);
  assert.throws(() => requireIndependentSyncKey(key, proxy, key), /independent/);
  assert.throws(() => requireIndependentSyncKey(key, key, phone), /independent/);
});

test('sync refuses missing or revoked sessions and a forged owner without writing', async () => {
  const origin = 'https://synthetic.invalid';
  const user = 'usr_01234567-89ab-4cde-8fab-0123456789ab';
  let active = true, calls = 0, writes = 0;
  const db = { prepare() { return { bind() { return { first: async () => active ? { ok: 1 } : null, run: async () => { writes++; } }; } }; } };
  const mf = { getD1Database: async () => db, dispatchFetch: async () => { calls++; return Response.json({ user: { id: user } }); } };
  const model = { validVocabularyEvent: () => true, mergeVocabularyEvents: () => [], readNativeStudyPage: () => ({}), QUESTIONS: [] };
  const sync = await createUnifiedD1Sync({ enabled: true, mf, origin, cursorKey: randomBytes(32), model });
  const request = (cookie, owner) => new Request(origin + '/candidate/sync/append', { method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ owner, event: {} }) });
  assert.equal((await sync.fetch(request('', user))).status, 401);
  assert.equal(calls, 0);
  const cookie = '__Host-lantern-session=' + 'a'.repeat(64);
  assert.equal((await sync.fetch(request(cookie, 'another-owner'))).status, 409);
  active = false;
  assert.equal((await sync.fetch(request(cookie, user))).status, 401);
  assert.equal(writes, 0);
});
