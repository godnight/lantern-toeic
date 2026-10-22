'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { environment, plain } = require('./helpers/product-auth-harness.cjs');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');

test('withoutAuth omits only the four auth migrations and keeps complete Study sync triggers', t => {
  const e = environment({ withoutAuth: true });
  t.after(() => e.close());
  const tables = e.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name);
  for (const name of ['study_sync_clock', 'study_sync_index', 'profiles', 'recordings']) assert.ok(tables.includes(name), name);
  assert.equal(tables.some(name => name.startsWith('auth_')), false);
  const source = fs.readFileSync(path.join(root, 'drizzle/0004_study_sync_index.sql'), 'utf8');
  const expectedTriggers = [...source.matchAll(/CREATE TRIGGER IF NOT EXISTS ([a-z_]+)/g)].map(match => match[1]).sort();
  const actualTriggers = e.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' ORDER BY name").all().map(row => row.name);
  assert.deepEqual(actualTriggers, expectedTriggers);
  const before = e.sqlite.prepare('SELECT revision,ready FROM study_sync_clock WHERE id=1').get();
  assert.equal(before.ready, 1);
  const owner = 'synthetic-migration-wiring-only';
  const profile = { ...plain(e.load('lib/study-model.ts').DEFAULT_PROFILE), name: 'Synthetic trigger check' };
  e.sqlite.prepare('INSERT INTO profiles(user_id,body,updated_at) VALUES(?,?,?)').run(owner, JSON.stringify(profile), '2026-01-01T00:00:00.000Z');
  const row = e.sqlite.prepare('SELECT user_id,kind,entity_id,revision,deleted FROM study_sync_index WHERE user_id=?').get(owner);
  assert.deepEqual(plain(row), { user_id: owner, kind: 'profile', entity_id: owner, revision: before.revision + 1, deleted: 0 });
});

test('normal migration load retains auth tables and the admission column alongside Study sync', t => {
  const e = environment();
  t.after(() => e.close());
  const tables = e.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name);
  for (const name of ['auth_users', 'auth_password_credentials', 'auth_sessions', 'auth_rate_limits', 'auth_phone_challenges', 'auth_phone_flow_buckets', 'auth_phone_flow_cooldowns', 'auth_phone_flow_operations', 'study_sync_index']) assert.ok(tables.includes(name), name);
  const columns = e.sqlite.prepare('PRAGMA table_info(auth_rate_limits)').all().map(row => row.name);
  assert.ok(columns.includes('admission_id'));
});
