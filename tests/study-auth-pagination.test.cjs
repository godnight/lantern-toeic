'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { environment, plain } = require('./helpers/product-auth-harness.cjs');

test('authenticated Study pages and all continuations remain scoped to the server session', async t => {
  const e = environment();
  t.after(() => e.close());
  const alice = await e.register('page_alice');
  const bob = await e.register('page_bob');
  const model = e.load('lib/study-model.ts');
  const sync = e.load('lib/study-sync.ts');
  for (const [user, name] of [[alice, 'Synthetic page A'], [bob, 'Synthetic page B']]) {
    const response = await e.call('study', 'POST', { cookie: user.cookie, owner: user.id, body: { type: 'profile', data: { ...plain(model.DEFAULT_PROFILE), name } } });
    assert.equal(response.status, 200);
  }
  const question = e.load('content/questions.json')[0];
  const ids = new Set();
  const insert = e.sqlite.prepare('INSERT INTO attempts(id,user_id,qid,choice,correct,created_at,seconds,mode) VALUES(?,?,?,?,?,?,?,?)');
  for (let index = 0; index < sync.STUDY_SYNC_PAGE_SIZE + 2; index += 1) {
    const id = randomUUID(); ids.add(id);
    insert.run(id, alice.id, question.id, question.correctIndex, 1, '2026-01-01T00:00:00.000Z', 3, 'first');
  }
  const bobAttempt = randomUUID();
  insert.run(bobAttempt, bob.id, question.id, question.correctIndex, 1, '2026-01-01T00:00:00.000Z', 3, 'first');
  const get = (user, suffix = '', headers = {}) => e.call('study', 'GET', { cookie: user.cookie, query: '?sync=pages-v1' + suffix, headers });
  const firstResponse = await get(alice, '&userId=' + bob.id, { 'x-oai-user-id': bob.id, 'x-lantern-owner': bob.id });
  assert.equal(firstResponse.status, 200);
  assert.match(firstResponse.headers.get('cache-control'), /no-store/);
  const first = await firstResponse.json();
  assert.equal(first.owner, alice.id);
  assert.equal(first.changes.length, sync.STUDY_SYNC_PAGE_SIZE);
  assert.equal(first.checkpoint, null);
  assert.equal(typeof first.nextCursor, 'string');
  const crossCursor = await get(bob, '&cursor=' + encodeURIComponent(first.nextCursor));
  assert.equal(crossCursor.status, 409);
  assert.equal((await crossCursor.json()).resetRequired, true);
  const pages = [first];
  let next = first.nextCursor;
  while (next) {
    assert.ok(pages.length < 5, 'Bounded fixture must finish in at most four pages');
    const response = await get(alice, '&cursor=' + encodeURIComponent(next));
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(page.owner, alice.id);
    pages.push(page); next = page.nextCursor;
  }
  const changes = pages.flatMap(page => page.changes);
  assert.equal(changes.length, ids.size + 1);
  assert.deepEqual(new Set(changes.filter(change => change.kind === 'attempt').map(change => change.id)), ids);
  assert.equal(changes.some(change => change.id === bobAttempt), false);
  const profiles = changes.filter(change => change.kind === 'profile');
  assert.equal(profiles.length, 1); assert.equal(profiles[0].id, alice.id); assert.equal(profiles[0].data.name, 'Synthetic page A');
  const checkpoint = sync.encodeStudySyncToken(pages.at(-1).checkpoint);
  const crossCheckpoint = await get(bob, '&checkpoint=' + encodeURIComponent(checkpoint));
  assert.equal(crossCheckpoint.status, 409);
  assert.equal((await crossCheckpoint.json()).resetRequired, true);
  assert.equal((await e.call('study', 'GET', { query: '?sync=pages-v1', owner: alice.id, headers: { 'x-oai-user-id': alice.id } })).status, 401);
  assert.equal((await e.call('logout', 'POST', { cookie: alice.cookie })).status, 200);
  assert.equal((await get(alice, '&cursor=' + encodeURIComponent(first.nextCursor), { 'x-oai-user-id': alice.id })).status, 401);
  const bobPage = await (await get(bob)).json();
  assert.equal(bobPage.owner, bob.id);
  assert.deepEqual(bobPage.changes.filter(change => change.kind === 'attempt').map(change => change.id), [bobAttempt]);
});
