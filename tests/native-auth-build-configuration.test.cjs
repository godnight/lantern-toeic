'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const configRelative = 'harmony/entry/src/main/ets/auth/AuthConfiguration.ets';
const storePath = path.join(root, 'harmony/entry/src/main/ets/auth/AuthSessionStore.ets');
const generator = path.join(root, 'harmony/scripts/prepare-auth-configuration.mjs');
const origin = 'https://auth.example.test';
const alias = 'synthetic-asset-v1';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-auth-build-'));
  t.after(() => {
    const tempRoot = fs.realpathSync(os.tmpdir());
    const target = fs.realpathSync(dir);
    assert.ok(target.startsWith(tempRoot + path.sep));
    fs.rmSync(target, { recursive: true });
  });
  const stage = path.join(dir, 'stage');
  const target = path.join(stage, ...configRelative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, ...configRelative.split('/')), target);
  const config = path.join(dir, 'private-input.json');
  fs.writeFileSync(config, JSON.stringify({ schemaVersion: 1, apiOrigin: origin, sessionAlias: alias }));
  return { dir, stage, target, config };
}
function run(config, stage) {
  return spawnSync(process.execPath, [generator, '--config', config, '--staging-root', stage],
    { cwd: root, encoding: 'utf8', windowsHide: true });
}

function storeRuntime(configAlias, records) {
  const Tag = { ALIAS: 'alias', SECRET: 'secret', RETURN_TYPE: 'return', ACCESSIBILITY: 'access', SYNC_TYPE: 'sync' };
  const key = query => Buffer.from(query.get(Tag.ALIAS)).toString('ascii');
  const asset = { Tag, ReturnType: { ALL: 1 }, Accessibility: { DEVICE_UNLOCKED: 1 }, SyncType: { NEVER: 1 },
    async query(query) { const value = records.get(key(query)); if (!value) throw { code: 24000002 }; return [new Map([[Tag.SECRET, value]])]; },
    async add(values) { const k = key(values); if (records.has(k)) throw { code: 24000003 }; records.set(k, values.get(Tag.SECRET)); },
    async update(query, values) { records.set(key(query), values.get(Tag.SECRET)); },
    async remove(query) { const k = key(query); if (!records.delete(k)) throw { code: 24000002 }; }
  };
  const source = fs.readFileSync(storePath, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: id => {
    if (id === '@ohos.security.asset') return { __esModule: true, default: asset };
    if (id === './AuthConfiguration') return { AUTH_SESSION_ALIAS: configAlias };
    if (id === '@kit.BasicServicesKit') return {};
    throw Error('Unexpected module');
  }, Uint8Array, Map, Date, JSON, Number, String, Error });
  return new exports.AuthSessionStore();
}

test('explicit protected build config changes only an isolated staging copy and does not print values', t => {
  const f = fixture(t);
  const original = fs.readFileSync(path.join(root, ...configRelative.split('/')), 'utf8');
  const result = run(f.config, f.stage);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes(origin) && !result.stdout.includes(alias));
  assert.equal(result.stderr, '');
  const generated = fs.readFileSync(f.target, 'utf8');
  assert.match(generated, /export const AUTH_API_ORIGIN: string = 'https:\/\/auth\.example\.test';/);
  assert.match(generated, /export const AUTH_SESSION_ALIAS: string = 'synthetic-asset-v1';/);
  assert.equal(fs.readFileSync(path.join(root, ...configRelative.split('/')), 'utf8'), original);
  assert.notEqual(run(f.config, f.stage).status, 0, 'unknown or already configured staged source is not overwritten');
});

test('unsafe config, unexpected fields and Git checkouts fail without modifying staged source', t => {
  const f = fixture(t);
  const original = fs.readFileSync(f.target, 'utf8');
  for (const candidate of [
    { schemaVersion: 1, apiOrigin: 'http://auth.example.test', sessionAlias: alias },
    { schemaVersion: 1, apiOrigin: 'https://lantern.local', sessionAlias: alias },
    { schemaVersion: 1, apiOrigin: 'https://auth.example.test/path', sessionAlias: alias },
    { schemaVersion: 1, apiOrigin: origin, sessionAlias: "bad'alias" },
    { schemaVersion: 1, apiOrigin: origin, sessionAlias: alias, password: 'not-accepted' },
  ]) {
    fs.writeFileSync(f.config, JSON.stringify(candidate));
    const result = run(f.config, f.stage);
    assert.notEqual(result.status, 0);
    assert.ok(!result.stderr.includes(candidate.sessionAlias) && !result.stderr.includes(candidate.apiOrigin));
    assert.equal(fs.readFileSync(f.target, 'utf8'), original);
  }
  fs.writeFileSync(f.config, JSON.stringify({ schemaVersion: 1, apiOrigin: origin, sessionAlias: alias }));
  fs.writeFileSync(path.join(f.stage, '.git'), 'gitdir: synthetic');
  assert.notEqual(run(f.config, f.stage).status, 0);
  assert.equal(fs.readFileSync(f.target, 'utf8'), original);
});

test('template substitution preserves additional exports and rejects ambiguous targets', async () => {
  const { renderAuthConfiguration } = await import('../harmony/scripts/prepare-auth-configuration.mjs');
  const current = fs.readFileSync(path.join(root, ...configRelative.split('/')), 'utf8');
  const value = { schemaVersion: 1, apiOrigin: origin, sessionAlias: alias };
  const extra = '\nexport const AUTH_FUTURE_SETTING: boolean = true;\n';
  assert.ok(renderAuthConfiguration(value, current + extra).endsWith(extra));
  assert.throws(() => renderAuthConfiguration(value, current + "\nexport const AUTH_SESSION_ALIAS: string = 'duplicate';\n"));
  assert.throws(() => renderAuthConfiguration(value, current.replace('AUTH_SESSION_ALIAS', 'AUTH_NOT_ALIAS')));
});

test('configured Asset namespace reuses the existing session without copying its token', async () => {
  const records = new Map();
  const token = 'a'.repeat(64);
  const original = storeRuntime(alias, records);
  await original.save(origin, token, 60);
  assert.equal(await storeRuntime(alias, records).load(origin), token);
  assert.equal(await storeRuntime('other-synthetic-alias', records).load(origin), undefined);
  assert.equal(records.size, 1);
});
