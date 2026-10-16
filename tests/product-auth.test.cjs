const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const {environment, ORIGIN, PASSWORD, COOKIE_NAME, plain, sha} = require('./helpers/product-auth-harness.cjs');
const backup = events => ({kind: 'lantern-vocabulary', schemaVersion: 1, events});
const review = (overrides = {}) => ({id: 'shared-vocabulary-id', wordId: 'schedule', createdAt: '2026-01-01T00:00:00.000Z', type: 'review', grade: 'remembered', ...overrides});

test('registration uses random salted scrypt hashes and one case-insensitive stable identity', async t => {
  const e = environment();t.after(() => e.close());
  const alice = await e.register('  ALIce  '), bob = await e.register('bob', PASSWORD);
  assert.equal(alice.username, 'alice');assert.match(alice.id, /^usr_[0-9a-f-]{36}$/);assert.notEqual(alice.id, bob.id);
  const credentials = e.rows('auth_password_credentials');
  assert.equal(credentials.length, 2);assert.notEqual(credentials[0].password_hash, credentials[1].password_hash);
  for (const row of credentials) {assert.match(row.password_hash, /^\$lantern\$scrypt\$v=1\$n=16384,r=8,p=5,k=64\$[a-f0-9]{32}\$[a-f0-9]{128}$/);assert.ok(!row.password_hash.includes(PASSWORD));}
  const storedTokens = e.rows('auth_sessions');assert.ok(storedTokens.every(row => !row.token_hash.includes(alice.cookie.split('=')[1])));
  assert.equal(storedTokens.find(row => row.user_id === alice.id).token_hash, sha(alice.cookie.split('=')[1]));
  const before = e.rows('auth_sessions');
  const duplicate = await e.call('register', 'POST', {cookie: alice.cookie, body: {username: 'Alice', password: PASSWORD}});
  assert.equal(duplicate.status, 400);assert.equal(duplicate.headers.has('set-cookie'), false);
  assert.equal(e.rows('auth_users').length, 2);assert.deepEqual(e.rows('auth_sessions'), before);
  assert.equal((await e.call('session', 'GET', {cookie: alice.cookie})).status, 200);
  const server = e.load('lib/server-auth.ts');assert.equal(await server.userId(e.request('study', 'GET', {cookie: alice.cookie})), alice.id);
  e.setAmbientHeaders({cookie: bob.cookie});assert.equal(await server.userId(), bob.id, 'Ambient Next request headers use the same real verifier');
});

test('wrong and unknown passwords return the same public failure with no new identity or session', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register();
  const responses = [];
  for (const username of ['alice', 'unknown_user']) responses.push(await e.call('login', 'POST', {body: {username, password: 'Wrong synthetic password 53!'}}));
  for (const response of responses) {assert.equal(response.status, 401);assert.equal(response.headers.has('set-cookie'), false);assert.match(response.headers.get('cache-control'), /no-store/);}
  assert.deepEqual(await responses[0].json(), await responses[1].json());
  assert.equal(e.rows('auth_users').length, 1);assert.equal(e.rows('auth_sessions').length, 1);
  const session = await (await e.call('session', 'GET', {cookie: alice.cookie})).json();
  assert.deepEqual(session.capabilities, {passwordLogin: true, phoneLogin: false, passwordRecovery: false});
});

test('concurrent normalized duplicate registration creates exactly one user, credential and session', async t => {
  const e = environment();t.after(() => e.close());
  const responses = await Promise.all(['Alice', 'ALICE', '  aLiCe  '].map(username => e.call('register', 'POST', {body: {username, password: PASSWORD}})));
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  assert.ok(responses.filter(response => response.status !== 200).every(response => [400, 429].includes(response.status)), 'Duplicates may be rejected by the no-queue KDF guard or the unique constraint');
  assert.equal(e.rows('auth_users').length, 1);assert.equal(e.rows('auth_password_credentials').length, 1);assert.equal(e.rows('auth_sessions').length, 1);
  const winningCookie = responses.find(response => response.status === 200).headers.get('set-cookie').split(';')[0];
  for (const username of ['ALICE', '  aLiCe  ']) {
    const duplicate = await e.call('register', 'POST', {cookie: winningCookie, body: {username, password: PASSWORD}});
    assert.equal(duplicate.status, 400);assert.equal(duplicate.headers.has('set-cookie'), false);
  }
  assert.equal((await e.call('session', 'GET', {cookie: winningCookie})).status, 200);
  assert.equal(e.rows('auth_users').length, 1);assert.equal(e.rows('auth_password_credentials').length, 1);assert.equal(e.rows('auth_sessions').length, 1);
});

test('successful login rotates the session, old cookies fail, and logout revokes the current cookie', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register();
  const response = await e.call('login', 'POST', {cookie: alice.cookie, body: {username: ' ALICE ', password: PASSWORD}});
  assert.equal(response.status, 200);const next = response.headers.get('set-cookie');
  assert.match(next, /Path=\//);assert.match(next, /HttpOnly/);assert.match(next, /Secure/);assert.match(next, /SameSite=Strict/);assert.match(next, /Max-Age=43200/);assert.ok(!/Domain=/i.test(next));
  const cookie = next.split(';')[0];assert.notEqual(cookie, alice.cookie);
  assert.equal((await response.json()).user.id, alice.id);
  assert.equal((await e.call('session', 'GET', {cookie: alice.cookie})).status, 401);
  assert.equal((await e.call('session', 'GET', {cookie})).status, 200);
  assert.equal((await e.call('study', 'GET', {cookie: alice.cookie})).status, 401);
  const logout = await e.call('logout', 'POST', {cookie});assert.equal(logout.status, 200);assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await e.call('session', 'GET', {cookie})).status, 401);assert.equal(e.rows('auth_sessions').length, 0);
});

test('expired, tampered, malformed and duplicate session cookies fail closed', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register();
  const token = alice.cookie.split('=')[1];
  const cookies = [`${COOKIE_NAME}=${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`, `${COOKIE_NAME}=short`, `${COOKIE_NAME}=${token.toUpperCase()}`, alice.cookie + '; ' + alice.cookie, `${COOKIE_NAME}=${'0'.repeat(64)}`];
  for (const cookie of cookies) assert.equal((await e.call('session', 'GET', {cookie})).status, 401);
  e.sqlite.prepare('UPDATE auth_sessions SET expires_at=?').run(Date.now() - 1);
  assert.equal((await e.call('session', 'GET', {cookie: alice.cookie})).status, 401);
  assert.equal(await e.load('lib/server-auth.ts').userId(e.request('study', 'GET', {cookie: alice.cookie})), null);
  for (const route of ['study', 'vocabulary', 'recordings', 'library']) assert.equal((await e.call(route, 'GET', {cookie: alice.cookie})).status, 401);
});

test('unconfigured authentication never mints a session or trusts gateway and owner headers', async t => {
  for (const env of [{LANTERN_AUTH_ENABLED: undefined}, {LANTERN_AUTH_ENABLED: 'false'}, {DB: undefined}, {LANTERN_AUTH_ORIGIN: undefined}, {LANTERN_AUTH_ORIGIN: 'http://study.test'}, {LANTERN_AUTH_ORIGIN: ORIGIN + '/path'}]) {
    const e = environment({env});try {
      const response = await e.call('register', 'POST', {body: {username: 'alice', password: PASSWORD}});
      assert.equal(response.status, 503);assert.equal(response.headers.has('set-cookie'), false);
      assert.equal((await e.call('session')).status, 503);assert.equal(e.rows('auth_users').length, 0);
      assert.equal((await e.call('study', 'GET', {headers: {'x-oai-user-id': 'alice', 'x-lantern-owner': 'alice'}})).status, 401);
    } finally {e.close();}
  }
});

test('missing auth tables return unavailable and private endpoints reject without a fallback identity', async t => {
  const e = environment({withoutAuth: true});t.after(() => e.close());
  const cookie = COOKIE_NAME + '=' + 'f'.repeat(64);
  assert.equal((await e.call('register', 'POST', {body: {username: 'alice', password: PASSWORD}})).status, 503);
  assert.equal((await e.call('session', 'GET', {cookie})).status, 503);
  assert.equal((await e.call('logout', 'POST', {cookie})).status, 503);
  for (const route of ['study', 'vocabulary', 'recordings', 'library']) assert.equal((await e.call(route, 'GET', {cookie, owner: 'alice'})).status, 401);
});

test('database outages reject all private routes without storage writes or a falsely successful logout', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register();
  const sessions = e.rows('auth_sessions'), users = e.rows('auth_users'), prepare = e.env.DB.prepare;
  e.env.DB.prepare = () => {throw Error('Synthetic D1 outage');};
  try {
    for (const route of ['study', 'vocabulary', 'recordings', 'library']) {
      for (const method of route === 'library' ? ['GET', 'POST', 'DELETE'] : ['GET', 'POST']) {
        const response = await e.call(route, method, {cookie: alice.cookie, owner: alice.id, ...(method === 'POST' ? {body: {userId: alice.id}} : {})});
        assert.equal(response.status, 401, route + ' ' + method + ' fails closed when the session cannot be verified');
      }
    }
    for (const [route, method] of [['session', 'GET'], ['logout', 'POST']]) {
      const response = await e.call(route, method, {cookie: alice.cookie});
      assert.equal(response.status, 503);assert.equal(response.headers.has('set-cookie'), false, 'An unavailable revocation must not pretend to clear the server session');
    }
    assert.equal((await e.call('login', 'POST', {body: {username: 'alice', password: PASSWORD}})).status, 503);
    assert.equal((await e.call('register', 'POST', {body: {username: 'bob', password: PASSWORD}})).status, 503);
    assert.equal(e.storage.puts, 0);assert.equal(e.storage.deletes, 0);assert.equal(e.objects.size, 0);
    assert.deepEqual(e.rows('auth_sessions'), sessions);assert.deepEqual(e.rows('auth_users'), users);
    for (const table of ['profiles', 'attempts', 'checkins', 'recordings', 'question_marks', 'resource_tasks', 'vocabulary_events', 'exam_library']) assert.deepEqual(e.rows(table), []);
  } finally {e.env.DB.prepare = prepare;}
  assert.equal((await e.call('session', 'GET', {cookie: alice.cookie})).status, 200, 'The pre-outage session remains valid because failed logout did not revoke it');
});

test('D1 batch rollback preserves an old session and leaves no partial new registration when session insert fails', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register();
  const before = new Map(['auth_users', 'auth_password_credentials', 'auth_sessions'].map(table => [table, e.rows(table)]));
  e.sqlite.exec("CREATE TRIGGER reject_test_session BEFORE INSERT ON auth_sessions BEGIN SELECT RAISE(ABORT, 'Synthetic session insert failure'); END");
  for (const [route, username] of [['login', 'alice'], ['register', 'bob']]) {
    const response = await e.call(route, 'POST', {cookie: alice.cookie, body: {username, password: PASSWORD}});
    assert.equal(response.status, 503);assert.equal(response.headers.has('set-cookie'), false);
    for (const [table, rows] of before) assert.deepEqual(e.rows(table), rows, table + ' must roll back as one batch');
  }
  assert.equal((await e.call('session', 'GET', {cookie: alice.cookie})).status, 200);
});

test('credential parsing rejects Unicode aliases, weak or oversized passwords and extra identity fields', async t => {
  const e = environment();t.after(() => e.close());
  for (const [username, password] of [['Ａlice', PASSWORD], ['a\u200blice', PASSWORD], ['ab', PASSWORD], ['bad-name', PASSWORD], ['alice', 'short'], ['alice', 'x'.repeat(129)]]) {
    assert.equal((await e.call('register', 'POST', {body: {username, password}})).status, 400);
  }
  assert.equal((await e.call('register', 'POST', {body: {username: 'charlie', password: PASSWORD, userId: 'victim'}})).status, 400);
  assert.equal((await e.call('register', 'POST', {body: 'malformed json', headers: {'content-type': 'application/json'}})).status, 400);
  assert.equal((await e.call('register', 'POST', {body: JSON.stringify({username: 'david', password: PASSWORD}), headers: {'content-type': 'text/plain'}})).status, 400);
  assert.equal(e.rows('auth_users').length, 0);assert.equal(e.rows('auth_sessions').length, 0);
});

test('auth mutations require an explicit same origin and reject cross-site fetches', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register();
  for (const headers of [{origin: undefined}, {origin: 'https://evil.test'}, {'sec-fetch-site': 'cross-site'}]) {
    for (const route of ['register', 'login', 'logout']) {
      assert.equal((await e.call(route, 'POST', {cookie: alice.cookie, body: route === 'logout' ? undefined : {username: 'alice', password: PASSWORD}, headers})).status, 403);
    }
  }
  assert.equal((await e.call('session', 'GET', {cookie: alice.cookie})).status, 200);
  assert.equal(e.rows('auth_sessions').length, 1);
});

test('atomic concurrent per-username rate limiting admits at most five attempts in a window', async t => {
  const e = environment();t.after(() => e.close());
  const windowStart = Math.floor(Date.now() / 900000) * 900000;
  e.sqlite.prepare('INSERT INTO auth_rate_limits(scope,window_start,count) VALUES(?,?,?)').run('login:username:' + sha('alice'), windowStart, 4);
  const responses = await Promise.all(Array.from({length: 10}, (_, i) => e.call('login', 'POST', {body: {username: i % 2 ? 'Alice' : 'alice', password: 'Wrong synthetic password 53!'}})));
  assert.equal(responses.filter(response => response.status === 401).length, 1, 'Only the fifth attempt can consume the last username slot');
  assert.equal(responses.filter(response => response.status === 429).length, 9);
  assert.equal(e.rows('auth_rate_limits').find(row => row.scope.startsWith('login:username:')).count, 5);
  for (const response of responses.filter(response => response.status === 429)) assert.ok(Number(response.headers.get('retry-after')) > 0);
  assert.equal(e.rows('auth_users').length, 0);
});

test('the global credential bucket is atomic across different usernames and caller IP headers', async t => {
  const e = environment();t.after(() => e.close());
  const windowStart = Math.floor(Date.now() / 900000) * 900000;
  e.sqlite.prepare('INSERT INTO auth_rate_limits(scope,window_start,count) VALUES(?,?,?)').run('global:credentials', windowStart, 99);
  const responses = await Promise.all(Array.from({length: 10}, (_, i) => e.call('login', 'POST', {body: {username: 'synthetic_' + i, password: PASSWORD}, headers: {'x-forwarded-for': '192.0.2.' + i}})));
  assert.equal(responses.filter(response => response.status === 401).length, 1, 'Only the last slot of the 100-attempt budget is available');
  assert.equal(responses.filter(response => response.status === 429).length, 9);
  assert.equal(e.rows('auth_rate_limits').find(row => row.scope === 'global:credentials').count, 100);
});

test('a real strong KDF in flight gives another account immediate 429 without queuing or minting a session', async t => {
  const e = environment();t.after(() => e.close());await e.register('alice');const bob = await e.register('bob');
  const password = e.load('lib/password-credential.ts');let firstFinished = false;
  const inFlight = password.hashPassword(PASSWORD).finally(() => {firstFinished = true;});
  try {
    const busy = await e.call('login', 'POST', {body: {username: 'bob', password: PASSWORD}});
    assert.equal(busy.status, 429);assert.equal(busy.headers.get('retry-after'), '1');assert.equal(busy.headers.has('set-cookie'), false);
    assert.equal(firstFinished, false, 'Busy request returns before the strong KDF completes, rather than joining a queue');
    assert.equal(e.rows('auth_sessions').length, 2);
  } finally {await inFlight;}
  const login = await e.call('login', 'POST', {body: {username: 'bob', password: PASSWORD}});
  assert.equal(login.status, 200);assert.equal((await login.json()).user.id, bob.id);
});

test('malformed credential bodies and an exhausted username cannot consume other usernames hash budget', async t => {
  const e = environment();t.after(() => e.close());
  const malformed = await Promise.all(Array.from({length: 100}, () => e.call('login', 'POST', {body: {}})));
  assert.ok(malformed.every(response => response.status === 401));assert.deepEqual(e.rows('auth_rate_limits'), []);
  const windowStart = Math.floor(Date.now() / 900000) * 900000;
  e.sqlite.prepare('INSERT INTO auth_rate_limits(scope,window_start,count) VALUES(?,?,?)').run('login:username:' + sha('alice'), windowStart, 5);
  const blocked = await Promise.all(Array.from({length: 12}, () => e.call('login', 'POST', {body: {username: 'Alice', password: PASSWORD}})));
  assert.ok(blocked.every(response => response.status === 429));
  assert.ok(!e.rows('auth_rate_limits').some(row => row.scope === 'global:credentials'));
  assert.equal((await e.call('login', 'POST', {body: {username: 'bob', password: PASSWORD}})).status, 401);
  assert.equal(e.rows('auth_rate_limits').find(row => row.scope === 'global:credentials').count, 1);
});

test('all private routes reject missing or invalid sessions despite forged gateway, owner and body identities', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register();
  for (const cookie of [undefined, COOKIE_NAME + '=' + 'a'.repeat(64)]) {
    for (const route of ['study', 'vocabulary', 'recordings', 'library']) {
      for (const method of route === 'library' ? ['GET', 'POST', 'DELETE'] : ['GET', 'POST']) {
        const response = await e.call(route, method, {cookie, owner: alice.id, headers: {'oai-user-id': alice.id, 'x-oai-user-id': alice.id, 'x-user-id': alice.id}, ...(method === 'POST' ? {body: {userId: alice.id, owner: alice.id}} : {})});
        assert.equal(response.status, 401, route + ' ' + method);
        assert.match(response.headers.get('cache-control'), /private/);assert.match(response.headers.get('cache-control'), /no-store/);
      }
    }
  }
  assert.equal(e.storage.puts, 0);assert.equal(e.rows('profiles').length, 0);assert.equal(e.rows('vocabulary_events').length, 0);
});

test('a forged request host cannot turn an attacker origin into an accepted private mutation', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register();
  for (const route of ['study', 'vocabulary', 'recordings', 'library']) {
    const request = new Request('https://evil.test/api/' + route, {method: 'POST', headers: {cookie: alice.cookie, origin: 'https://evil.test', 'x-lantern-owner': alice.id, 'content-type': 'application/json'}, body: '{}'});
    assert.equal((await e.routes[route].POST(request)).status, 401);
  }
  assert.equal(e.storage.puts, 0);assert.equal(e.rows('profiles').length, 0);
});

test('private mutations reject a different owner and missing or hostile origins before storage access', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register(), bob = await e.register('bob');
  for (const route of ['study', 'vocabulary', 'recordings', 'library']) {
    const methods = route === 'library' ? ['POST', 'DELETE'] : ['POST'];
    for (const method of methods) {
      assert.equal((await e.call(route, method, {cookie: alice.cookie, owner: bob.id, body: method === 'POST' ? {} : undefined})).status, 409, route);
      assert.equal((await e.call(route, method, {cookie: alice.cookie, owner: alice.username, body: method === 'POST' ? {} : undefined})).status, 409, route + ' username is not ownership');
      for (const headers of [{origin: undefined}, {origin: 'https://evil.test'}, {'sec-fetch-site': 'cross-site'}]) {
        assert.equal((await e.call(route, method, {cookie: alice.cookie, owner: alice.id, headers, body: method === 'POST' ? {} : undefined})).status, 403, route + ' ' + method);
      }
    }
  }
  assert.equal(e.storage.puts, 0);assert.equal(e.storage.deletes, 0);assert.equal(e.rows('profiles').length, 0);
});

test('study and vocabulary use only the authenticated stable ID for A/B reads and writes', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register(), bob = await e.register('bob');
  const model = e.load('lib/study-model.ts');
  for (const [user, name] of [[alice, 'Synthetic Alice'], [bob, 'Synthetic Bob']]) {
    const init = {cookie: user.cookie, owner: user.id};
    assert.equal((await e.call('study', 'POST', {...init, body: {type: 'profile', data: {...plain(model.DEFAULT_PROFILE), name, userId: user === alice ? bob.id : alice.id}}})).status, 200);
    assert.equal((await e.call('vocabulary', 'POST', {...init, body: {...backup([review({grade: user === alice ? 'remembered' : 'again'})]), userId: user === alice ? bob.id : alice.id}})).status, 200);
  }
  for (const [user, name, grade] of [[alice, 'Synthetic Alice', 'remembered'], [bob, 'Synthetic Bob', 'again']]) {
    const study = await (await e.call('study', 'GET', {cookie: user.cookie, query: '?userId=' + (user === alice ? bob.id : alice.id), headers: {'x-oai-user-id': user === alice ? bob.id : alice.id}})).json();
    const vocabulary = await (await e.call('vocabulary', 'GET', {cookie: user.cookie})).json();
    assert.equal(study.owner, user.id);assert.equal(study.profile.name, name);assert.equal(vocabulary.owner, user.id);assert.equal(vocabulary.events[0].grade, grade);
  }
  assert.deepEqual(e.rows('profiles').map(row => row.user_id).sort(), [alice.id, bob.id].sort());
  assert.deepEqual(e.rows('vocabulary_events').map(row => row.user_id).sort(), [alice.id, bob.id].sort());
});

test('study event collisions and mutable records cannot overwrite or attach another users data', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register(), bob = await e.register('bob');
  const question = e.load('content/questions.json')[0], resourceId = e.load('content/resources-v2.ts').resources[0].id;
  const stamp = '2026-01-01T00:00:00.000Z', aAttempt = crypto.randomUUID(), aCheckin = crypto.randomUUID(), taskId = crypto.randomUUID();
  const post = (user, type, data) => e.call('study', 'POST', {cookie: user.cookie, owner: user.id, body: {type, data}});
  const attempt = id => ({id, qid: question.id, choice: question.correctIndex, correct: false, createdAt: stamp, seconds: 3, userId: alice.id});
  const checkin = id => ({id, date: '2026-01-01', minutes: 5, load: '\u521a\u597d', note: '', createdAt: stamp, userId: alice.id});
  const mark = note => ({qid: question.id, flagged: true, reason: null, note, revision: 1, mutationId: crypto.randomUUID(), updatedAt: stamp});
  const task = (checkinId, status = 'completed') => ({id: taskId, resourceId, plannedDate: '2026-01-01', status, minutes: 5, checkinId, revision: 1, mutationId: crypto.randomUUID(), updatedAt: stamp});
  assert.equal((await post(alice, 'attempt', attempt(aAttempt))).status, 200);
  assert.equal((await post(alice, 'checkin', checkin(aCheckin))).status, 200);
  assert.equal((await post(alice, 'questionMark', mark('Alice only'))).status, 200);
  assert.equal((await post(alice, 'resourceTask', task(aCheckin))).status, 200);
  const beforeAttempts = e.rows('attempts'), beforeCheckins = e.rows('checkins');
  assert.equal((await post(bob, 'attempt', attempt(aAttempt))).status, 422);
  assert.equal((await post(bob, 'checkin', checkin(aCheckin))).status, 422);
  assert.equal((await post(bob, 'resourceTask', task(aCheckin))).status, 400, 'B cannot link a task to A checkin');
  assert.deepEqual(e.rows('attempts'), beforeAttempts);assert.deepEqual(e.rows('checkins'), beforeCheckins);
  const bAttempt = crypto.randomUUID(), bCheckin = crypto.randomUUID();
  assert.equal((await post(bob, 'attempt', attempt(bAttempt))).status, 200);
  assert.equal((await post(bob, 'checkin', checkin(bCheckin))).status, 200);
  assert.equal((await post(bob, 'questionMark', mark('Bob only'))).status, 200);
  assert.equal((await post(bob, 'resourceTask', task(bCheckin, 'in_progress'))).status, 200);
  for (const [user, attemptId, checkinId, note, status] of [[alice, aAttempt, aCheckin, 'Alice only', 'completed'], [bob, bAttempt, bCheckin, 'Bob only', 'in_progress']]) {
    const data = await (await e.call('study', 'GET', {cookie: user.cookie})).json();
    assert.deepEqual(data.attempts.map(row => row.id), [attemptId]);assert.equal(data.attempts[0].correct, true, 'Server recomputes correctness');
    assert.deepEqual(data.checkins.map(row => row.id), [checkinId]);assert.equal(data.questionMarks[0].note, note);
    assert.equal(data.resourceTasks[0].checkinId, checkinId);assert.equal(data.resourceTasks[0].status, status);
  }
});

test('recordings cannot be downloaded by another account and uploads cannot choose a foreign owner', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register(), bob = await e.register('bob');
  const id = crypto.randomUUID();assert.equal((await e.call('recordings', 'POST', e.recordingInit(alice, id, {userId: bob.id}))).status, 200);
  const row = e.rows('recordings')[0];assert.equal(row.user_id, alice.id);assert.equal(row.object_key, 'recordings/' + alice.id + '/' + id);
  assert.equal((await e.call('recordings', 'GET', {cookie: alice.cookie, query: '?id=' + id})).status, 200);
  assert.equal((await e.call('recordings', 'GET', {cookie: bob.cookie, query: '?id=' + id, headers: {'x-oai-user-id': alice.id, 'x-lantern-owner': alice.id}})).status, 404);
  const bobId = crypto.randomUUID();assert.equal((await e.call('recordings', 'POST', e.recordingInit(bob, bobId, {userId: alice.id}))).status, 200);
  const b = e.rows('recordings').find(record => record.id === bobId);assert.equal(b.user_id, bob.id);
  assert.equal((await e.call('recordings', 'GET', {cookie: alice.cookie, query: '?id=' + bobId})).status, 404);
  const aStudy = await (await e.call('study', 'GET', {cookie: alice.cookie})).json();const bStudy = await (await e.call('study', 'GET', {cookie: bob.cookie})).json();
  assert.deepEqual(aStudy.recordings.map(record => record.id), [id]);assert.deepEqual(bStudy.recordings.map(record => record.id), [bobId]);
});

test('an existing foreign recording ID is rejected before R2 and leaves its row and bytes intact', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register(), bob = await e.register('bob'), id = crypto.randomUUID();
  assert.equal((await e.call('recordings', 'POST', e.recordingInit(bob, id))).status, 200);
  const rows = e.rows('recordings'), bytes = Buffer.from(e.objects.get(rows[0].object_key).bytes), puts = e.storage.puts;
  assert.equal((await e.call('recordings', 'POST', e.recordingInit(alice, id))).status, 422);
  assert.deepEqual(e.rows('recordings'), rows);assert.equal(e.storage.puts, puts);assert.equal(e.storage.deletes, 0);
  assert.equal(e.objects.size, 1);assert.deepEqual(e.objects.get(rows[0].object_key).bytes, bytes);
});

test('a foreign recording ID winner during upload preserves B and cleans only the losing A object', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register(), bob = await e.register('bob'), id = crypto.randomUUID();
  let entered, release;const gate = new Promise(resolve => {release = resolve;}), waiting = new Promise(resolve => {entered = resolve;});
  e.storage.beforePut = async key => {if (key === 'recordings/' + alice.id + '/' + id) {entered();await gate;}};
  const aliceUpload = e.call('recordings', 'POST', e.recordingInit(alice, id));await waiting;
  try {assert.equal((await e.call('recordings', 'POST', e.recordingInit(bob, id))).status, 200);} finally {release();}
  assert.equal((await aliceUpload).status, 422);
  const rows = e.rows('recordings');assert.equal(rows.length, 1);assert.equal(rows[0].user_id, bob.id);
  assert.equal(e.objects.size, 1);assert.ok(e.objects.has('recordings/' + bob.id + '/' + id));assert.ok(!e.objects.has('recordings/' + alice.id + '/' + id));
  assert.equal((await e.call('recordings', 'GET', {cookie: bob.cookie, query: '?id=' + id})).status, 200);
  assert.equal((await e.call('recordings', 'GET', {cookie: alice.cookie, query: '?id=' + id})).status, 404);
});

test('exam library A/B lists, downloads, uploads and deletes are isolated by verified sessions', async t => {
  const e = environment();t.after(() => e.close());const alice = await e.register(), bob = await e.register('bob'), data = e.librarySample();
  const uploaded = await e.call('library', 'POST', e.libraryInit(alice, data));assert.equal(uploaded.status, 200);const id = (await uploaded.json()).id;
  assert.equal((await (await e.call('library', 'GET', {cookie: bob.cookie})).json()).items.length, 0);
  assert.equal((await e.call('library', 'GET', {cookie: bob.cookie, query: '?id=' + id})).status, 404);
  assert.equal((await e.call('library', 'DELETE', {cookie: bob.cookie, owner: alice.id, query: '?id=' + id})).status, 409);
  assert.equal((await e.call('library', 'DELETE', {cookie: bob.cookie, owner: bob.id, query: '?id=' + id})).status, 200);
  assert.equal(e.rows('exam_library').length, 1);assert.equal(e.storage.deletes, 0);
  const downloaded = await e.call('library', 'GET', {cookie: alice.cookie, query: '?id=' + id});assert.equal(downloaded.status, 200);assert.equal(await downloaded.text(), data.body);
  assert.equal((await e.call('library', 'POST', e.libraryInit(bob, data))).status, 200);
  assert.equal(e.rows('exam_library').length, 2);assert.equal(e.objects.size, 2);
  for (const user of [alice, bob]) {const items = (await (await e.call('library', 'GET', {cookie: user.cookie})).json()).items;assert.equal(items.length, 1);assert.equal('user_id' in items[0], false);assert.equal('object_key' in items[0], false);}
  assert.equal((await e.call('library', 'DELETE', {cookie: alice.cookie, owner: alice.id, query: '?id=' + id})).status, 200);
  assert.equal(e.rows('exam_library').length, 1);assert.equal(e.rows('exam_library')[0].user_id, bob.id);
});

test('new registration never claims or migrates guest, username-owned or legacy learning records', async t => {
  const e = environment();t.after(() => e.close());
  const stamp = new Date().toISOString();
  for (const owner of ['guest', 'device', 'alice', 'legacy-oai-user']) {
    const body = JSON.stringify({...plain(e.load('lib/study-model.ts').DEFAULT_PROFILE), name: 'Retained ' + owner});
    e.sqlite.prepare('INSERT INTO profiles(user_id,body,updated_at) VALUES(?,?,?)').run(owner, body, stamp);
    e.sqlite.prepare('INSERT INTO vocabulary_events(user_id,event_id,body) VALUES(?,?,?)').run(owner, 'legacy-' + owner, JSON.stringify(review()));
    const id = crypto.randomUUID(), recording = {id, promptId: e.load('content/speaking.json')[0].id, duration: 1, createdAt: stamp};
    e.sqlite.prepare('INSERT INTO attempts(id,user_id,qid,choice,correct,created_at,seconds,mode) VALUES(?,?,?,?,?,?,?,?)').run(id, owner, e.load('content/questions.json')[0].id, 0, 0, stamp, 1, 'first');
    e.sqlite.prepare('INSERT INTO checkins(id,user_id,body,created_at) VALUES(?,?,?,?)').run(id, owner, JSON.stringify({id, note: owner}), stamp);
    e.sqlite.prepare('INSERT INTO recordings(id,user_id,object_key,body,created_at) VALUES(?,?,?,?,?)').run(id, owner, 'legacy/' + owner, JSON.stringify(recording), stamp);
    for (const table of ['question_marks', 'resource_tasks']) e.sqlite.prepare('INSERT INTO ' + table + '(user_id,entity_id,body,revision,cancelled,mutation_id) VALUES(?,?,?,?,?,?)').run(owner, id, JSON.stringify({id, note: owner}), 1, 0, crypto.randomUUID());
    const sample = e.librarySample('legacy-' + owner);
    e.sqlite.prepare('INSERT INTO exam_library(id,user_id,object_key,manifest,bytes,sha256,state,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, owner, 'legacy-exam/' + owner, JSON.stringify(sample.manifest), sample.manifest.bytes, sample.manifest.sha256, 'ready', stamp);
  }
  const tables = ['profiles', 'vocabulary_events', 'attempts', 'checkins', 'recordings', 'question_marks', 'resource_tasks', 'exam_library'];
  const retained = new Map(tables.map(table => [table, e.rows(table)]));
  const alice = await e.register('alice');
  const study = await (await e.call('study', 'GET', {cookie: alice.cookie})).json(), vocabulary = await (await e.call('vocabulary', 'GET', {cookie: alice.cookie})).json();
  assert.equal(study.hasProfile, false);assert.equal(study.profileOrigin, 'missing');
  for (const field of ['attempts', 'checkins', 'recordings', 'questionMarks', 'resourceTasks']) assert.deepEqual(study[field], []);
  assert.deepEqual(vocabulary.events, []);assert.deepEqual((await (await e.call('library', 'GET', {cookie: alice.cookie})).json()).items, []);
  for (const table of tables) assert.deepEqual(e.rows(table), retained.get(table), table + ' legacy rows are byte-for-byte retained');
});
