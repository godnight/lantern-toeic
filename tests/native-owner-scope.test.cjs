'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { idb, plain, createRuntime, hookHarness, memoryStorage, stablePins } = require('./helpers/native-scope-runtime.cjs');
const A = 'usr_aaaaaaaa-1111-4111-8111-111111111111';
const B = 'usr_bbbbbbbb-2222-4222-8222-222222222222';
const scopes = [
  { kind: 'harmony-owner', ownerId: A }, { kind: 'harmony-owner', ownerId: B },
  { kind: 'harmony-device', partition: 'existing-device' }, { kind: 'web-local', partition: 'existing-device' },
];
const stamp = '2026-01-01T00:00:00.000Z';

test('actual IDB repository isolates identical record/command IDs, receipts, reopens and cross-scope backups', async t => {
  const runtime = createRuntime();
  const domain = runtime.load('lib/learning-domain-repository.ts');
  const factory = new idb.IDBFactory(), name = 'synthetic-native-scope-' + randomUUID();
  const repositories = [];
  t.after(() => repositories.forEach(repository => repository.close()));
  for (const scope of scopes) repositories.push(await domain.openLearningDomainRepository(scope, { factory, name }));
  const commands = repositories.map((repository, index) => ({
    commandId: 'same-command-id', occurredAt: stamp, payload: { syntheticScope: index },
    expected: [{ collection: 'plans', id: 'same-record-id', revision: null }, { collection: 'events', id: 'same-event-id', revision: null }],
    writes: [{ collection: 'plans', id: 'same-record-id', revision: 1, value: { syntheticScope: index } }, { collection: 'events', id: 'same-event-id', revision: 1, value: { syntheticScope: index } }],
  }));
  const receipts = [];
  for (let index = 0; index < repositories.length; index += 1) {
    const repository = repositories[index];
    const committed = await repository.commit(commands[index]);
    assert.equal(committed.status, 'committed'); receipts.push(committed.receipt);
    assert.equal((await repository.read('plans', 'same-record-id')).value.syntheticScope, index);
    assert.equal((await repository.list('events')).length, 1);
    assert.equal((await repository.commit(commands[index])).status, 'replayed');
    assert.equal((await repository.commit(commands[(index + 1) % commands.length])).status, 'conflict');
    assert.deepEqual(plain(await repository.getReceipt('same-command-id')), plain(committed.receipt));
  }
  assert.equal(new Set(receipts.map(receipt => receipt.payloadHash)).size, repositories.length);
  assert.equal(new Set(repositories.map(repository => repository.scopeKey)).size, repositories.length);
  const backups = await Promise.all(repositories.map(repository => repository.exportBackup()));
  for (let source = 0; source < repositories.length; source += 1) {
    for (let target = 0; target < repositories.length; target += 1) {
      const result = await repositories[target].restoreBackup(backups[source]);
      assert.equal(result.status, source === target ? 'replayed' : 'blocked');
      if (source !== target) assert.equal(result.reason, 'scope');
    }
    assert.deepEqual(plain(await repositories[source].exportBackup()), plain(backups[source]));
  }
  repositories[0].close();
  const reopened = await domain.openLearningDomainRepository(scopes[0], { factory, name }); repositories.push(reopened);
  assert.equal((await reopened.read('plans', 'same-record-id')).value.syntheticScope, 0);
  assert.deepEqual(plain(await reopened.getReceipt('same-command-id')), plain(receipts[0]));
  assert.deepEqual(plain(await repositories[2].exportBackup()), plain(backups[2]), 'Old harmony-device data stays exactly in its original partition');
});

function combinedFactory(runtime) {
  const { useStudy } = runtime.load('lib/use-study.ts');
  const { useVocabulary } = runtime.load('lib/use-vocabulary.ts');
  const { useVocabularyWorkflow } = runtime.load('lib/use-vocabulary-workflow.ts');
  const { usePracticeWorkflow } = runtime.load('lib/use-practice-workflow.ts');
  const question = runtime.load('content/questions.json').find(value => !value.groupId);
  const questions = [question];
  return ({ owner }) => {
    const study = useStudy(owner, false), vocabulary = useVocabulary(owner, false);
    const ready = study.ready && study.recordsReadable !== false;
    const flow = useVocabularyWorkflow({ owner, nativeMode: true, identityReady: ready, timezone: study.data.profile.timezone, legacy: vocabulary });
    const practice = usePracticeWorkflow({ owner, nativeMode: true, ready, timezone: study.data.profile.timezone, questions, attempts: study.data.attempts, legacy: study });
    return { study, vocabulary, flow, practice, question };
  };
}
const ready = value => value.study.ready && value.vocabulary.ready && value.flow.ready && value.practice.ready;

test('actual native hooks keep owner A/B and old guest locally writable while remoteEnabled=false prevents fetch', async t => {
  const h = hookHarness(combinedFactory, { owner: null }); t.after(() => h.dispose());
  await h.settle(ready);
  const model = h.runtime.load('lib/study-model.ts');
  const domain = h.runtime.load('lib/learning-domain-repository.ts');
  const sharedReviewId = 'native-scope-shared-review';
  const sharedAttemptId = '11111111-1111-4111-8111-111111111111';
  const scopeKey = owner => domain.workflowScopeKey(owner ? { kind: 'harmony-owner', ownerId: owner } : scopes[2]);
  function writeLocal(label, choice, grade) {
    assert.equal(h.value.study.saveProfile({ ...plain(model.DEFAULT_PROFILE), name: label }), true);
    const q = h.value.question;
    assert.equal(h.value.study.addAttempt({ id: sharedAttemptId, qid: q.id, choice, correct: choice === q.correctIndex, seconds: 3, createdAt: stamp, mode: 'first' }), true);
    assert.equal(h.value.vocabulary.reviewEvent({ id: sharedReviewId, wordId: 'schedule', type: 'review', grade, createdAt: stamp }), true);
  }
  writeLocal('Synthetic old native guest', 0, 'again'); await h.settle(ready);
  assert.equal(h.value.flow.scopeKey, scopeKey(null)); assert.equal(h.value.practice.scopeKey, scopeKey(null));
  const oldGuestPrimary = h.storage.getItem('lantern-v1-device');
  const oldGuestFlow = plain(await h.value.flow.exportWorkflow());
  h.render({ owner: A }); await h.settle(ready);
  assert.equal(h.value.study.data.attempts.length, 0); assert.equal(h.value.vocabulary.events.length, 0);
  assert.equal(h.value.practice.sessions.length, 0); assert.equal(h.value.flow.projection.counts.learned, 0);
  assert.equal(h.value.flow.scopeKey, scopeKey(A)); assert.equal(h.value.practice.scopeKey, scopeKey(A));
  writeLocal('Synthetic native A', 1, 'remembered'); await h.settle(ready);
  const staleA = h.value;
  const plan = { bookId: 'combined-core-1.2', goal: 2, dailyNew: 1, weekdays: [1, 2, 3, 4, 5, 6, 7] };
  assert.equal((await h.value.flow.savePlan(plan)).status, 'applied'); await h.settle(ready);
  assert.equal((await h.value.flow.startGroup('new')).status, 'applied'); await h.settle(ready);
  assert.equal((await h.value.flow.submitRating('known')).status, 'applied'); await h.settle(ready);
  assert.ok(h.value.flow.activeSession.currentStep.receipt);
  const q = h.value.question;
  const unit = q.groupId ? `group:${q.part}:${q.groupId}` : `question:${q.id}`;
  assert.equal((await h.value.practice.start([q], { unitIds: [unit] })).status, 'started'); await h.settle(ready);
  assert.equal((await h.value.practice.submit(q.correctIndex, 4, 0)).status, 'applied'); await h.settle(ready);
  const backupA = plain(await h.value.flow.exportWorkflow());
  const aCount = h.value.study.data.attempts.length;
  assert.equal(h.value.practice.session.steps[0].status, 'applied');
  assert.equal(h.value.flow.projection.counts.learned >= 1, true);
  h.render({ owner: B }); await h.settle(ready);
  assert.equal(h.value.study.data.attempts.length, 0); assert.equal(h.value.vocabulary.events.length, 0);
  assert.equal(h.value.flow.projection.plan, null); assert.equal(h.value.practice.sessions.length, 0);
  assert.equal(h.value.flow.scopeKey, scopeKey(B)); assert.equal(h.value.practice.scopeKey, scopeKey(B));
  assert.equal(staleA.study.saveProfile({ ...plain(model.DEFAULT_PROFILE), name: 'Synthetic stale A must not write B' }), false);
  assert.equal(staleA.vocabulary.reviewEvent({ id: 'stale-command', wordId: 'schedule', type: 'review', grade: 'again', createdAt: stamp }), false);
  assert.equal((await staleA.flow.startGroup('new')).status, 'blocked');
  assert.equal((await staleA.practice.start([q], { unitIds: [unit] })).status, 'blocked');
  const bBefore = plain(await h.value.flow.exportWorkflow());
  assert.equal((await h.value.flow.restoreWorkflow(backupA)).status, 'blocked'); await h.settle(ready);
  assert.deepEqual(plain(await h.value.flow.exportWorkflow()), bBefore);
  writeLocal('Synthetic native B', 2, 'again'); await h.settle(ready);
  assert.equal(h.value.study.readAttempt(sharedAttemptId).choice, 2);
  assert.equal(h.value.vocabulary.readEvent(sharedReviewId).grade, 'again');
  h.signal('online'); h.signal('focus'); await h.value.study.syncNow(); h.value.vocabulary.retry(); await h.settle(ready);
  assert.equal(h.calls.length, 0);
  h.render({ owner: A }); await h.settle(ready);
  assert.equal(h.value.study.data.profile.name, 'Synthetic native A');
  assert.equal(h.value.study.data.attempts.length, aCount);
  assert.equal(h.value.study.readAttempt(sharedAttemptId).choice, 1);
  assert.equal(h.value.vocabulary.readEvent(sharedReviewId).grade, 'remembered');
  assert.deepEqual(plain(await h.value.flow.exportWorkflow()), backupA, 'A workflow receipts survive B use and reopen');
  h.render({ owner: null }); await h.settle(ready);
  assert.equal(h.value.study.data.profile.name, 'Synthetic old native guest');
  assert.equal(h.value.study.readAttempt(sharedAttemptId).choice, 0);
  assert.equal(h.value.vocabulary.readEvent(sharedReviewId).grade, 'again');
  assert.deepEqual(plain(await h.value.flow.exportWorkflow()), oldGuestFlow);
  assert.equal(h.storage.getItem('lantern-v1-device'), oldGuestPrimary);
  assert.equal((await h.value.flow.restoreWorkflow(backupA)).status, 'blocked');
  assert.equal(h.calls.length, 0);
});

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('late vocabulary response from A cannot populate B or native A after disabling remote transport', async t => {
  const late = deferred(), storage = memoryStorage();
  const h = hookHarness(runtime => { const { useVocabulary } = runtime.load('lib/use-vocabulary.ts'); return props => useVocabulary(props.owner, props.remote); }, { owner: A, remote: true }, { storage, transport: () => late.promise });
  t.after(() => h.dispose()); await h.settle(value => value.ready && h.calls.length === 1);
  h.render({ owner: B, remote: false }); await h.settle(value => value.ready);
  const before = storage.getItem(h.value.key);
  late.resolve(Response.json({ kind: 'lantern-vocabulary', schemaVersion: 1, owner: A, events: [{ id: 'late-private-A', wordId: 'schedule', type: 'review', grade: 'remembered', createdAt: stamp }] }));
  await h.settle(value => value.ready);
  assert.equal(h.value.events.length, 0); assert.equal(storage.getItem(h.value.key), before);
  h.render({ owner: A, remote: false }); await h.settle(value => value.ready);
  assert.equal(h.value.events.length, 0); assert.equal(h.calls.length, 1);
});

test('late Study page from A cannot overwrite B local state after disabling remote transport', async t => {
  const late = deferred(), storage = memoryStorage();
  const h = hookHarness(runtime => { const { useStudy } = runtime.load('lib/use-study.ts'); return props => useStudy(props.owner, props.remote); }, { owner: A, remote: true }, { storage, transport: () => late.promise });
  t.after(() => h.dispose()); await h.settle(value => value.ready && h.calls.length === 1);
  const model = h.runtime.load('lib/study-model.ts');
  h.render({ owner: B, remote: false }); await h.settle(value => value.ready && value.recordsReadable);
  assert.equal(h.value.saveProfile({ ...plain(model.DEFAULT_PROFILE), name: 'Synthetic local native B' }), true); await h.settle(value => value.ready);
  const beforeB = storage.getItem('lantern-v1-' + B), beforeA = storage.getItem('lantern-v1-' + A);
  late.resolve(Response.json({ syncProtocol: 'pages-v1', schemaVersion: 2, owner: A, hasProfile: true,
    changes: [{ revision: 1, kind: 'profile', id: A, data: { ...plain(model.DEFAULT_PROFILE), name: 'Synthetic late private A' } }], nextCursor: null,
    checkpoint: { version: 1, owner: A, epoch: 'a'.repeat(32), revision: 1 } }));
  await h.settle(value => value.ready);
  assert.equal(h.value.data.profile.name, 'Synthetic local native B');
  assert.equal(storage.getItem('lantern-v1-' + B), beforeB); assert.equal(storage.getItem('lantern-v1-' + A), beforeA);
  assert.equal(h.calls.length, 1);
});

test.after(() => {
  const pins = stablePins();
  if (process.env.LANTERN_NATIVE_SCOPE_PINS) {
    fs.writeFileSync(path.resolve(process.env.LANTERN_NATIVE_SCOPE_PINS), JSON.stringify({ scope: 'actual-source-closure-of-native-synthetic-tests', pins, syntheticOnly: true, liveReact: false, liveBrowser: false, liveHarmony: false }, null, 2) + '\n');
  }
});
