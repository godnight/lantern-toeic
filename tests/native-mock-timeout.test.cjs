'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/verify-native-mock.cjs');
const v = require(script);
const fixture = require(path.join(root, 'tests/fixtures/synthetic-exam.cjs'));
const model = v.loadModel(root);
const clone = value => JSON.parse(JSON.stringify(value));
const start = 1700000000000;
const deadline = start + 7200000;
let directory, manifest, packs, context;

function removeOwned(target, parent, prefix) {
  assert.equal(path.dirname(path.resolve(target)), path.resolve(parent));
  assert.ok(path.basename(target).startsWith(prefix));
  fs.rmSync(target, { recursive: true, force: true });
}
test.before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-timeout-unit-'));
  packs = [fixture('page-packer-qa-only'), fixture('browser-qa-alpha')];
  const entries = packs.map((pack, i) => {
    const file = path.join(directory, `pack-${i}.json`), bytes = Buffer.from(JSON.stringify(pack));
    fs.writeFileSync(file, bytes);
    return { file, id: pack.id, version: pack.version, title: pack.title, deviceFile: `qa-${i}.json`,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  });
  manifest = path.join(directory, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ kind: 'lantern-native-mock-qa', schemaVersion: 1,
    packages: entries, examId: packs[0].id, answers: { '1': 0, '2': 1 } }));
  context = await v.loadManifest(manifest, model);
});
test.after(() => removeOwned(directory, os.tmpdir(), 'lantern-timeout-unit-'));
function attempt(id, exam = 0, ordinal = 1, now = start) {
  const row = context.expected.get(packs[exam].id + '@1');
  return clone(model.createAttempt(row.pack, { id, ownerId: v.OWNER, fingerprint: row.fingerprint, ordinal, now }));
}
function submittedHistory(id, exam) {
  const a = attempt(id, exam, 1, start - 14400000);
  return clone(model.advanceAttempt(a, a.readingDeadline));
}
function backup(attempts) {
  return { kind: 'lantern-exam-backup', schemaVersion: 1, ownerId: v.OWNER,
    packages: clone(packs), attempts: clone(attempts) };
}
function pair({ reading = false, rollback = false } = {}) {
  const histories = [submittedHistory('old-main', 0), submittedHistory('old-other', 1)];
  let a = attempt('owned-qa', 0, 2);
  a = model.answerQuestion(a, 1, 0, start + 100);
  a = model.answerQuestion(a, 2, 1, start + 200);
  a = model.markInterrupted(a, 'background', start + 300);
  if (reading) a = model.advanceAttempt(a, a.listeningDeadline + 100);
  if (rollback) a = model.advanceAttempt(a, a.lastObservedAt - 1);
  const baseline = backup([...histories, a]);
  a = model.markInterrupted(a, 'audio-interrupted', a.lastObservedAt + 100);
  a = model.advanceAttempt(a, a.readingDeadline);
  return { baseline, final: backup([...histories, a]) };
}
async function compare(data, now = deadline + 1000) {
  const baseline = await v.validateBackup(data.baseline, context, model, now);
  const final = await v.validateBackup(data.final, context, model, now);
  return v.compareTimeoutStates(context, baseline, final, model, now);
}
const rejected = (fn, code) => assert.rejects(fn,
  error => error instanceof v.VerificationError && (!code || error.code === code));
function caseFiles(t, data = pair()) {
  const folder = fs.mkdtempSync(path.join(directory, 'case-'));
  t.after(() => removeOwned(folder, directory, 'case-'));
  const baseline = path.join(folder, 'B3.json'), final = path.join(folder, 'FINAL.json');
  fs.writeFileSync(baseline, JSON.stringify(data.baseline));
  fs.writeFileSync(final, JSON.stringify(data.final));
  return { folder, baseline, final, args: { repo: root, manifest,
    'timeout-baseline': baseline, 'final-backup': final } };
}

test('timeout derives 0 correct/198 unanswered from actual package and preserves all histories', async t => {
  const data = pair(), bytes = JSON.stringify(data), files = caseFiles(t, data);
  const report = await v.verify(files.args, deadline + 1000);
  assert.equal(report.mode, 'timeout');
  assert.equal(report.activeId, null);
  assert.equal(report.attemptId, 'owned-qa');
  assert.equal(report.historyAttemptCount, 2);
  assert.equal(report.submittedAt, deadline);
  assert.equal(report.submittedReason, 'timeout');
  assert.equal(report.modelDerivedResult.correct, 0);
  assert.equal(report.modelDerivedResult.unanswered, 198);
  assert.equal(report.modelDerivedResult.total, 200);
  assert.equal(report.modelDerivedResult.elapsedMs, 7200000);
  assert.match(report.resultMeaning, /Synthetic QA.*not a user score/);
  assert.match(report.evidenceOrigin, /Caller-supplied.*not independently attested/);
  assert.ok(report.limitations.some(x => /Not 45\/120-minute live endurance/.test(x)));
  assert.equal(report.liveDeviceRun, undefined);
  assert.equal(JSON.stringify(data), bytes);
});

test('a reading baseline may time out after legitimate navigation and monotone interruption growth', async () => {
  const data = pair({ reading: true }), before = data.baseline.attempts.at(-1);
  let a = model.markInterrupted(before, 'audio-interrupted', before.lastObservedAt + 100);
  a = model.selectQuestion(a, 102, before.lastObservedAt + 200);
  a = model.advanceAttempt(a, a.readingDeadline);
  data.final.attempts[data.final.attempts.length - 1] = clone(a);
  assert.equal((await compare(data)).finalPhase, 'submitted');
});

test('semantic property order and package/attempt list order do not alter timeout identity', async () => {
  const data = pair();
  data.final.packages.reverse();
  data.final.attempts = data.final.attempts.map(a => Object.fromEntries(Object.entries(a).reverse())).reverse();
  assert.equal((await compare(data)).sameAttemptSet, true);
});

test('baseline requires one active known exam with exactly the fixed two answers', async () => {
  for (const mutate of [
    d => { d.baseline = clone(d.final); },
    d => { d.baseline.attempts.at(-1).answers['2'].choice = 0; },
    d => { d.baseline.attempts.at(-1).answers['3'] = { choice: 0, savedAt: start + 200 }; },
    d => { const a = d.baseline.attempts.at(-1); a.examId = packs[1].id; a.fingerprint = context.expected.get(packs[1].id + '@1').fingerprint; },
    d => { d.baseline.attempts.push(attempt('extra-active', 1, 2)); }
  ]) { const data = pair(); mutate(data); await rejected(() => compare(data)); }
});

test('final must already be natural timeout, never repaired from active/manual or early future state', async () => {
  const reading = pair(); reading.final.attempts[2] = clone(model.advanceAttempt(reading.baseline.attempts[2], start + 3000000));
  await rejected(() => compare(reading), 'TIMEOUT_PHASE');
  const manual = pair(); manual.final.attempts[2] = clone(model.submitAttempt(manual.baseline.attempts[2], start + 3000000));
  await rejected(() => compare(manual), 'TIMEOUT_FINAL');
  await rejected(() => compare(pair(), deadline - 1), 'TIMEOUT_NOT_DUE');
  const wrongQuestion = pair(); wrongQuestion.final.attempts[2].activeQuestion = 2;
  await rejected(() => compare(wrongQuestion), 'TIMEOUT_FINAL');
});

test('attempt identity/deadlines cannot drift even when an alternate record is model-valid', async () => {
  for (const mutate of [
    a => { a.id = 'replacement'; }, a => { a.ownerId = 'someone-else'; },
    a => { a.ordinal = 3; }, a => { a.examVersion = 2; },
    a => { a.fingerprint = 'sha256:' + '0'.repeat(64); },
    a => { a.startedAt--; }, a => { a.listeningDeadline++; }, a => { a.readingDeadline++; }
  ]) { const data = pair(); mutate(data.final.attempts[2]); await rejected(() => compare(data)); }
});

test('final answers and original savedAt cannot be changed, added or removed', async () => {
  for (const mutate of [
    a => { a.answers['2'].choice = 0; }, a => { a.answers['2'].savedAt++; },
    a => { a.answers['3'] = { choice: 0, savedAt: start + 200 }; },
    a => { delete a.answers['1']; }
  ]) { const data = pair(); mutate(data.final.attempts[2]); await rejected(() => compare(data), 'TIMEOUT_STABLE'); }
});

test('submitted history is preserved by raw semantics rather than only count or grade', async () => {
  for (const mutate of [
    a => { a.clockRollback = true; }, a => { a.revision++; }, a => { a.id = 'other-history'; },
    a => { a.answers['1'] = { choice: 0, savedAt: a.startedAt + 100 }; }
  ]) { const data = pair(); mutate(data.final.attempts[0]); await rejected(() => compare(data)); }
});

test('same package and attempt sets are required; extra or missing rows cannot hide in final', async () => {
  for (const mutate of [
    d => { d.final.packages.pop(); d.final.attempts.splice(1, 1); },
    d => { d.final.packages[0].questions[0].answer = 3; },
    d => { d.final.attempts.pop(); },
    d => { let a = attempt('extra-history', 1, 2); a = model.advanceAttempt(a, a.readingDeadline); d.final.attempts.push(clone(a)); }
  ]) { const data = pair(); mutate(data); await rejected(() => compare(data)); }
});

test('timeout must increase revision and cannot clear existing rollback evidence', async () => {
  for (const delta of [0, -1]) {
    const data = pair(); data.final.attempts[2].revision = data.baseline.attempts[2].revision + delta;
    await rejected(() => compare(data), 'TIMEOUT_REGRESSION');
  }
  const erased = pair({ rollback: true }); erased.final.attempts[2].clockRollback = false;
  await rejected(() => compare(erased), 'TIMEOUT_REGRESSION');
  const marked = pair(); marked.final.attempts[2].clockRollback = true;
  const report = await compare(marked);
  assert.equal(report.clockRollback, true);
  assert.equal(report.modelDerivedResult.integrity, 'interrupted');
});

test('equal total question time cannot conceal a decrease or removed existing entry', async () => {
  for (const remove of [false, true]) {
    const data = pair(), a = data.final.attempts[2], old = a.questionTimeMs['1'];
    if (remove) { delete a.questionTimeMs['1']; a.questionTimeMs['2'] += old; }
    else { a.questionTimeMs['1']--; a.questionTimeMs['2']++; }
    await rejected(() => compare(data), 'QUESTION_TIME_REGRESSION');
  }
});

test('interruptions retain exact prefix and new entries cannot be retroactive, duplicate or post-submit', async () => {
  for (const mutate of [
    a => { a.interruptions.shift(); },
    a => { a.interruptions[0].reason = 'audio-seek'; },
    a => { a.interruptions[1].at = start + 299; },
    a => { a.interruptions[1] = clone(a.interruptions[0]); },
    a => { a.interruptions[1].at = deadline; }
  ]) { const data = pair(); mutate(data.final.attempts[2]); await rejected(() => compare(data)); }
  const lowRevision = pair(); lowRevision.final.attempts[2].revision = lowRevision.baseline.attempts[2].revision + 1;
  await rejected(() => compare(lowRevision), 'TIMEOUT_REVISION');
});

test('model grade is derived, not filled with expected constants', async () => {
  const data = pair();
  const base = await v.validateBackup(data.baseline, context, model, deadline);
  const final = await v.validateBackup(data.final, context, model, deadline);
  // Keep a model-valid state but provide a different rubric to the comparison
  // boundary; it must detect the actual nonzero model grade rather than emit 0.
  const row = final.packages.get(packs[0].id + '@1');
  row.pack.questions[0].answer = 0;
  assert.throws(() => v.compareTimeoutStates(context, base, final, model, deadline),
    e => e.code === 'TIMEOUT_QA_RESULT');
});

test('CLI timeout pair is exclusive with inspect, four-file comparison and before-import', () => {
  const common = ['--manifest', 'm.json', '--out', 'out.json'];
  const mode = ['--timeout-baseline', 'B3.json', '--final-backup', 'final.json'];
  assert.ok(v.parseArgs([...common, ...mode])['final-backup'].endsWith('final.json'));
  for (const suffix of [[], ['--final-backup', 'f.json'], ['--timeout-baseline', 'b.json']]) {
    assert.throws(() => v.parseArgs([...common, ...suffix]), v.VerificationError);
  }
  for (const other of [['--inspect', 'b'], ['--baseline', 'b', '--files', 'b0', 'b1', 'b2', 'b3'],
    ['--before-import', 'b'], ['--timeout-baseline', 'duplicate'], ['--now', String(deadline)]]) {
    assert.throws(() => v.parseArgs([...common, ...mode, ...other]), v.VerificationError);
  }
});

test('actual CLI only writes a new timeout report, never mutates inputs or leaves passed failure output', t => {
  const data = pair(), f = caseFiles(t, data), out = path.join(f.folder, 'report.json');
  const beforeBytes = fs.readFileSync(f.baseline), finalBytes = fs.readFileSync(f.final);
  const args = ['--repo', root, '--manifest', manifest, '--timeout-baseline', f.baseline,
    '--final-backup', f.final, '--out', out];
  let child = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(fs.readFileSync(out)).mode, 'timeout');
  assert.deepEqual(fs.readFileSync(f.baseline), beforeBytes);
  assert.deepEqual(fs.readFileSync(f.final), finalBytes);
  const report = fs.readFileSync(out);
  child = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 1);
  assert.deepEqual(fs.readFileSync(out), report);
  const failed = path.join(f.folder, 'failed.json');
  data.final.attempts[2].answers['2'].choice = 0;
  fs.writeFileSync(f.final, JSON.stringify(data.final));
  child = spawnSync(process.execPath, [script, ...args.slice(0, -1), failed], { encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 1);
  assert.equal(fs.existsSync(failed), false);
  assert.ok(!child.stderr.includes(f.folder));
  assert.doesNotMatch(child.stdout + child.stderr, /base64|Fixture A|TEST ONLY/);
  assert.equal(fs.readdirSync(f.folder).some(name => name.endsWith('.tmp')), false);
});
