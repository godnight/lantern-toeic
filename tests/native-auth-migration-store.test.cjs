'use strict';

// The actual ETS store is run with synthetic Asset ports. This does not prove
// an installed App, real Asset behavior, TLS, a trusted cutover, or migration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'harmony/entry/src/main/ets/auth/AuthSessionStore.ets'), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
const oldOrigin = 'https://pc-20230610ztoe.tail490ec1.ts.net';
const newOrigin = 'https://weiguangxue.cn';
const now = 1800000000000;
const token = 'a'.repeat(64);

test('shipped migration configuration remains disabled', () => {
  const configuration = fs.readFileSync(path.join(root, 'harmony/entry/src/main/ets/auth/AuthMigrationConfiguration.ets'), 'utf8');
  const js = ts.transpileModule(configuration, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports });
  assert.equal(exports.AUTH_MIGRATION_ENABLED, false);
  assert.equal(exports.AUTH_MIGRATION_OLD_ORIGIN, oldOrigin);
  assert.equal(exports.AUTH_MIGRATION_NEW_ORIGIN, newOrigin);
});

function storeHarness({ enabled = false, record, rows, fail, clock = now } = {}) {
  const calls = { query: 0, remove: 0, add: 0, update: 0 };
  const Tag = { ALIAS: 'alias', SECRET: 'secret', RETURN_TYPE: 'return', ACCESSIBILITY: 'access', SYNC_TYPE: 'sync' };
  const asset = { Tag, ReturnType: { ALL: 'all' }, Accessibility: { DEVICE_UNLOCKED: 'unlock' }, SyncType: { NEVER: 'never' },
    async query(query) {
      calls.query++;
      assert.equal(Buffer.from(query.get(Tag.ALIAS)).toString(), 'lantern-product-auth-session-v1');
      assert.equal(query.get(Tag.RETURN_TYPE), 'all');
      if (fail) throw fail;
      if (rows !== undefined) return rows;
      if (record === undefined) throw { code: 24000002 };
      return [new Map([[Tag.SECRET, new Uint8Array(Buffer.from(JSON.stringify(record))) ]])];
    },
    async remove() { calls.remove++; }, async add() { calls.add++; }, async update() { calls.update++; },
  };
  const exports = {};
  const imports = {
    '@ohos.security.asset': { __esModule: true, default: asset },
    '@kit.BasicServicesKit': {},
    './AuthConfiguration': { AUTH_SESSION_ALIAS: 'lantern-product-auth-session-v1' },
    './AuthMigrationConfiguration': { AUTH_MIGRATION_ENABLED: enabled, AUTH_MIGRATION_OLD_ORIGIN: oldOrigin,
      AUTH_MIGRATION_NEW_ORIGIN: newOrigin },
  };
  vm.runInNewContext(javascript, { exports, require: id => {
    if (!Object.hasOwn(imports, id)) throw Error('unexpected import');
    return imports[id];
  }, Uint8Array, Map, JSON, Number, String, Error, Date: { now: () => clock } });
  return { store: new exports.AuthSessionStore(), calls };
}

const valid = () => ({ version: 1, origin: oldOrigin, token, expiresAt: now + 10000 });

test('cold lookup never mutates Asset, including expired, mismatched or malformed records', async () => {
  const match = storeHarness({ record: valid() });
  assert.equal(await match.store.peekColdStartCandidate(oldOrigin), token);
  for (const options of [
    { record: { ...valid(), origin: newOrigin } }, { record: { ...valid(), expiresAt: now } },
    { record: { ...valid(), expiresAt: now + 43200001 } }, { record: { ...valid(), version: 2 } },
    { record: { ...valid(), token: 'bad' } }, { rows: [] }, { fail: { code: 123 } }, {},
  ]) {
    const h = storeHarness(options);
    assert.equal(await h.store.peekColdStartCandidate(oldOrigin), undefined);
    assert.equal(h.calls.remove, 0); assert.equal(h.calls.add, 0); assert.equal(h.calls.update, 0);
  }
});

test('migration candidate is disabled before any Asset access and rejects an unapproved target', async () => {
  const disabled = storeHarness({ record: valid() });
  assert.equal(await disabled.store.peekMigrationLegacy(newOrigin), undefined);
  assert.deepEqual(disabled.calls, { query: 0, remove: 0, add: 0, update: 0 });
  const enabled = storeHarness({ enabled: true, record: valid() });
  for (const target of ['https://attacker.invalid', 'http://weiguangxue.cn', newOrigin + '/', oldOrigin]) {
    assert.equal(await enabled.store.peekMigrationLegacy(target), undefined);
  }
  assert.deepEqual(enabled.calls, { query: 0, remove: 0, add: 0, update: 0 });
});

test('synthetic legacy record is read without an Asset mutation or fabricated owner', async () => {
  const h = storeHarness({ enabled: true, record: valid() });
  const result = await h.store.peekMigrationLegacy(newOrigin);
  assert.equal(result.token, token);
  assert.equal(result.expiresAt, now + 10000);
  assert.deepEqual(Object.keys(result).sort(), ['expiresAt', 'token']);
  assert.deepEqual(h.calls, { query: 1, remove: 0, add: 0, update: 0 });
});

test('wrong source, expired or implausibly long lifetime remains untouched', async () => {
  for (const record of [
    { ...valid(), origin: 'https://another.invalid' },
    { ...valid(), origin: newOrigin },
    { ...valid(), expiresAt: now },
    { ...valid(), expiresAt: now + 43200001 },
  ]) {
    const h = storeHarness({ enabled: true, record });
    assert.equal(await h.store.peekMigrationLegacy(newOrigin), undefined);
    assert.deepEqual(h.calls, { query: 1, remove: 0, add: 0, update: 0 });
  }
});

test('missing record and invalid or unavailable Asset fail without deleting anything', async () => {
  const absent = storeHarness({ enabled: true });
  assert.equal(await absent.store.peekMigrationLegacy(newOrigin), undefined);
  for (const options of [
    { record: { ...valid(), token: 'bad' } },
    { record: { ...valid(), expiresAt: 1.5 } },
    { record: { ...valid(), version: 2 } },
    { rows: [] },
    { rows: [new Map(), new Map()] },
    { fail: { code: 123 } },
  ]) {
    const h = storeHarness({ enabled: true, ...options });
    await assert.rejects(h.store.peekMigrationLegacy(newOrigin));
    assert.equal(h.calls.remove, 0);
    assert.equal(h.calls.add, 0);
    assert.equal(h.calls.update, 0);
  }
  const malformed = storeHarness({ enabled: true,
    rows: [new Map([['secret', new Uint8Array(Buffer.from('{"token":"synthetic-secret"'))]])] });
  await assert.rejects(malformed.store.peekMigrationLegacy(newOrigin), error =>
    error.message === 'Store unavailable' && !error.message.includes('synthetic-secret'));
  assert.equal(malformed.calls.remove, 0);
});
