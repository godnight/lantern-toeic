// AUTH-01: actual auth service, real Node scrypt and SQLite transactions.
// Independent harness environments have separate VM/module/KDF state while
// their D1 adapters deliberately share one SQLite database. This is a local
// SQL concurrency regression, not a deployed D1 or cross-isolate load result.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const {environment, PASSWORD, sha} = require('./helpers/product-auth-harness.cjs');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const FROZEN = '101209685a200ba49a8762818f86dd8be8a91f29';
// Exact bytes extracted once with git show from the reviewed frozen commit.
// Runtime verification needs neither the Git history nor a network fetch.
const FROZEN_SERVICE_SHA256 = 'f8bb8bc6d3943c3a23ec1f18d4a4f459a47c51bbbaad7b707cce5382bc313afc';
const windowNow = () => Math.floor(Date.now() / 900000) * 900000;
const rateScope = (action, username) => action + ':username:' + sha(username);
const send = (e, username, action = 'login') => e.call(action, 'POST', {body: {username, password: PASSWORD}});
const seed = (e, scope, count, windowStart = windowNow()) => e.sqlite.prepare('INSERT INTO auth_rate_limits(scope,window_start,count) VALUES(?,?,?)').run(scope, windowStart, count);
const count = (e, scope, windowStart = windowNow()) => e.rows('auth_rate_limits').find(row => row.scope === scope && row.window_start === windowStart)?.count ?? 0;
async function limited(response) {
  assert.equal(response.status, 429);assert.equal(response.headers.has('set-cookie'), false);
  assert.equal((await response.json()).code, 'too-many-attempts', 'Reject by the shared SQL admission budget, not an isolate-local KDF busy slot');
  assert.ok(Number(response.headers.get('retry-after')) > 0);
}
function modules(t, n = 4) {
  const a = environment(), all = [a];
  for (let i = 1; i < n; i++) all.push(environment({env: {DB: a.d1}}));
  t.after(() => {for (const e of all.reverse()) e.close();});
  assert.notEqual(all[0].load('lib/password-credential.ts').hashPassword, all[1].load('lib/password-credential.ts').hashPassword);
  return all;
}

test('AUTH-01 negative control: frozen code allocates 1000 new buckets after the global budget is full', async t => {
  const frozenBytes = fs.readFileSync(path.join(root, 'tests/fixtures/auth-service-1012096.ts.txt'));
  assert.equal(sha(frozenBytes), FROZEN_SERVICE_SHA256, 'Negative-control source must match the reviewed git-show bytes exactly');
  const frozenSource = frozenBytes.toString('utf8');
  const e = environment({sourceOverrides: {'lib/auth-service.ts': frozenSource}});t.after(() => e.close());
  const windowStart = windowNow();seed(e, 'global:credentials', 100, windowStart);
  const snapshots = [];
  for (let i = 1; i <= 1000; i++) {
    await limited(await send(e, 'review_synthetic_' + i));
    if ([100, 500, 1000].includes(i)) snapshots.push({requests: i, usernameRows: e.rows('auth_rate_limits').filter(row => row.scope.startsWith('login:username:')).length,
      rateLimitRows: e.rows('auth_rate_limits').length, globalCount: count(e, 'global:credentials', windowStart), sqlOperations: e.queries.length});
  }
  assert.equal(windowNow(), windowStart, 'Negative control must stay within one fixed admission window');
  assert.equal(snapshots[2].usernameRows, 1000);assert.equal(snapshots[2].rateLimitRows, 1001);assert.equal(snapshots[2].globalCount, 1100);
  assert.deepEqual(e.rows('auth_users'), []);assert.deepEqual(e.rows('auth_sessions'), []);
  t.diagnostic(JSON.stringify({result: 'VULNERABILITY_REPRODUCED', commit: FROZEN, snapshots,
    sourceSha256: FROZEN_SERVICE_SHA256, scope: 'hash-verified frozen-source fixture, real in-memory SQLite/D1 adapter; no frozen worktree mutation, external service or production throughput measurement'}));
});

test('AUTH-01 fixed: a full global budget rejects 1000 new usernames without allocating or increasing any bucket', async t => {
  const e = environment();t.after(() => e.close());const windowStart = windowNow();
  seed(e, 'global:credentials', 100, windowStart);seed(e, rateScope('login', 'existing_user'), 2, windowStart);
  const before = e.rows('auth_rate_limits');
  for (let i = 0; i < 1000; i++) await limited(await send(e, 'bounded_synthetic_' + i));
  await limited(await send(e, 'existing_user'));
  assert.equal(windowNow(), windowStart);assert.deepEqual(e.rows('auth_rate_limits'), before);
  assert.deepEqual(e.rows('auth_users'), []);assert.deepEqual(e.rows('auth_sessions'), []);
  t.diagnostic(JSON.stringify({result: 'BOUNDED_REJECTION', requests: 1001, rowsBefore: before.length, rowsAfter: e.rows('auth_rate_limits').length, globalCount: count(e, 'global:credentials'), sqlOperations: e.queries.length}));
});

test('AUTH-01 fixed: independent KDF modules can work concurrently but atomically share the final global slot', async t => {
  const all = modules(t), a = all[0], windowStart = windowNow();
  // All four genuinely execute their own real KDF. An isolate-local busy guard
  // cannot turn a broken shared SQL limit into an apparently passing test.
  const open = await Promise.all(all.map((e, i) => send(e, 'open_slot_' + i)));
  assert.deepEqual(open.map(response => response.status), [401, 401, 401, 401]);assert.equal(count(a, 'global:credentials'), 4);
  a.sqlite.prepare('DELETE FROM auth_rate_limits').run();seed(a, 'global:credentials', 99, windowStart);
  const responses = await Promise.all(all.map((e, i) => send(e, 'last_slot_' + i)));
  assert.equal(responses.filter(response => response.status === 401).length, 1);
  for (const response of responses.filter(response => response.status !== 401)) await limited(response);
  assert.equal(count(a, 'global:credentials'), 100);
  assert.equal(a.rows('auth_rate_limits').filter(row => row.scope.startsWith('login:username:')).length, 1);
  assert.equal(a.rows('auth_rate_limits').find(row => row.scope.startsWith('login:username:')).count, 1);
});

test('AUTH-01 fixed: exhausted normalized usernames stay saturated without spending another users global budget', async t => {
  const e = environment();t.after(() => e.close());seed(e, rateScope('login', 'alice'), 5);seed(e, 'global:credentials', 7);
  const before = e.rows('auth_rate_limits');
  for (let i = 0; i < 12; i++) await limited(await send(e, i % 2 ? ' ALICE ' : 'alice'));
  assert.deepEqual(e.rows('auth_rate_limits'), before);
  assert.equal((await send(e, 'bob')).status, 401);assert.equal(count(e, 'global:credentials'), 8);assert.equal(count(e, rateScope('login', 'bob')), 1);
});

test('AUTH-01 fixed: the last username slot is atomic across independent modules and count saturates at five', async t => {
  const all = modules(t), a = all[0];seed(a, rateScope('login', 'shared_user'), 4);seed(a, 'global:credentials', 9);
  const responses = await Promise.all(all.map((e, i) => send(e, i % 2 ? ' SHARED_USER ' : 'shared_user')));
  assert.equal(responses.filter(response => response.status === 401).length, 1);
  for (const response of responses.filter(response => response.status !== 401)) await limited(response);
  assert.equal(count(a, rateScope('login', 'shared_user')), 5);assert.equal(count(a, 'global:credentials'), 10);
});

test('AUTH-01 fixed: registration has its own atomic twenty-attempt budget while login remains available', async t => {
  const all = modules(t), a = all[0];seed(a, 'global:register', 19);seed(a, 'global:credentials', 30);
  const responses = await Promise.all(all.map((e, i) => send(e, 'registration_slot_' + i, 'register')));
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  for (const response of responses.filter(response => response.status !== 200)) await limited(response);
  assert.equal(count(a, 'global:register'), 20);assert.equal(count(a, 'global:credentials'), 31);
  assert.equal(a.rows('auth_users').length, 1);assert.equal(a.rows('auth_password_credentials').length, 1);assert.equal(a.rows('auth_sessions').length, 1);
  const before = a.rows('auth_rate_limits');
  for (let i = 0; i < 100; i++) await limited(await send(a, 'registration_denied_' + i, 'register'));
  assert.deepEqual(a.rows('auth_rate_limits'), before);
  assert.equal((await send(a, 'login_after_register_limit')).status, 401);
  assert.equal(count(a, 'global:credentials'), 32);assert.equal(count(a, 'global:register'), 20);
});

test('AUTH-01 fixed: admission batch faults fail closed and a failed global update rolls back the username reservation', async t => {
  for (const mode of ['batch-unavailable', 'sql-abort']) {
    const e = environment();try {
      if (mode === 'batch-unavailable') e.env.DB.batch = async () => {throw Error('Synthetic admission transaction unavailable');};
      else e.sqlite.exec("CREATE TRIGGER reject_admission_global BEFORE INSERT ON auth_rate_limits WHEN NEW.scope='global:credentials' BEGIN SELECT RAISE(ABORT, 'Synthetic global admission failure'); END");
      for (const action of ['login', 'register']) {
        const response = await send(e, 'fault_synthetic_user', action);
        assert.equal(response.status, 503, mode + ' ' + action);assert.equal(response.headers.has('set-cookie'), false);
        assert.deepEqual(e.rows('auth_rate_limits'), [], 'No partial bucket reservation survives the failed transaction');
        assert.deepEqual(e.rows('auth_users'), []);assert.deepEqual(e.rows('auth_password_credentials'), []);assert.deepEqual(e.rows('auth_sessions'), []);
      }
    } finally {e.close();}
  }
});

test('AUTH-01 fixed: each denied request cleans at most 128 expired rows and leaves recent prior-window rows unchanged', async t => {
  const e = environment();t.after(() => e.close());const windowStart = windowNow(), expired = windowStart - 25 * 60 * 60 * 1000;
  for (let i = 0; i < 500; i++) seed(e, 'expired_synthetic_' + i, 1, expired);
  seed(e, 'global:credentials', 100, windowStart);seed(e, 'global:credentials', 100, windowStart - 900000);
  seed(e, rateScope('login', 'prior_window_user'), 5, windowStart - 900000);
  const recent = e.rows('auth_rate_limits').filter(row => row.window_start > expired);
  const remaining = [];
  for (let i = 0; i < 4; i++) {
    await limited(await send(e, 'cleanup_denied_' + i));
    remaining.push(e.rows('auth_rate_limits').filter(row => row.window_start === expired).length);
    assert.deepEqual(e.rows('auth_rate_limits').filter(row => row.window_start > expired), recent);
  }
  assert.deepEqual(remaining, [372, 244, 116, 0]);
  assert.equal(e.rows('auth_rate_limits').length, recent.length);
});

test('AUTH-01 fixed: a recent exhausted prior window does not block current admission or expand under later denial', async t => {
  const e = environment();t.after(() => e.close());const windowStart = windowNow();
  seed(e, 'global:credentials', 100, windowStart - 900000);seed(e, rateScope('login', 'prior_user'), 5, windowStart - 900000);
  const prior = e.rows('auth_rate_limits');assert.equal((await send(e, 'prior_user')).status, 401);
  assert.equal(count(e, 'global:credentials'), 1);assert.equal(count(e, rateScope('login', 'prior_user')), 1);
  assert.deepEqual(e.rows('auth_rate_limits').filter(row => row.window_start < windowStart), prior);
  e.sqlite.prepare('UPDATE auth_rate_limits SET count=100 WHERE scope=? AND window_start=?').run('global:credentials', windowStart);
  const before = e.rows('auth_rate_limits');
  for (let i = 0; i < 20; i++) await limited(await send(e, 'old_window_denied_' + i));
  assert.deepEqual(e.rows('auth_rate_limits'), before);
});
