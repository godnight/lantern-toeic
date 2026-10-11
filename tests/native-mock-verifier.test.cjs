'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(process.env.LANTERN_NATIVE_MOCK_REPO || path.join(__dirname, '..'));
const sibling = path.join(__dirname, 'verify-native-mock.cjs');
const script = fs.existsSync(sibling) ? sibling : path.join(root, 'scripts/verify-native-mock.cjs');
const v = require(script);
const fixture = require(path.join(root, 'tests/fixtures/synthetic-exam.cjs'));
const model = v.loadModel(root);
const clone = x => JSON.parse(JSON.stringify(x));
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const now = Date.now();
const stamp = now - 30_000;
let folder, manifestFile, context, packs;
test.before(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-native-mock-qa-'));
  packs = [fixture('page-packer-qa-only'), fixture('browser-qa-alpha')];
  const entries = packs.map((pack, i) => {
    const file = path.join(folder, 'qa-only-' + i + '.json'), bytes = Buffer.from(JSON.stringify(pack));
    fs.writeFileSync(file, bytes);
    return { file, sha256: hash(bytes), deviceFile: 'qa-only-' + i + '.json', id: pack.id, version: pack.version, title: pack.title };
  });
  manifestFile = path.join(folder, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify({ kind: 'lantern-native-mock-qa', schemaVersion: 1,
    packages: entries, examId: packs[0].id, answers: { '1': 0, '2': 1 } }));
  context = await v.loadManifest(manifestFile, model);
});
function removeOwnedDirectory(target, parent, prefix) {
  const resolved = path.resolve(target), expectedParent = path.resolve(parent);
  assert.equal(path.dirname(resolved), expectedParent);
  assert.ok(path.basename(resolved).startsWith(prefix));
  fs.rmSync(resolved, { recursive: true, force: true });
}
test.after(() => removeOwnedDirectory(folder, os.tmpdir(), 'lantern-native-mock-qa-'));
function fresh(t) {
  const dir = fs.mkdtempSync(path.join(folder, 'case-'));
  // Temporary test files only. No repository or device paths are written.
  t.after(() => removeOwnedDirectory(dir, folder, 'case-'));
  return dir;
}
function save(dir, name, value) { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(value)); return file; }
function makeAttempt(id, exam = 0, ordinal = 1, start = stamp) {
  const row = context.expected.get(packs[exam].id + '@1');
  return clone(model.createAttempt(row.pack, { id, ownerId: v.OWNER, fingerprint: row.fingerprint, ordinal, now: start }));
}
function history(exam = 0) {
  const a = makeAttempt('old-' + exam, exam, 1, stamp - 4 * 3600_000);
  return clone(model.advanceAttempt(a, a.readingDeadline));
}
function backup(attempts = [], packages = packs) {
  return { kind: 'lantern-exam-backup', schemaVersion: 1, ownerId: v.OWNER, packages: clone(packages), attempts: clone(attempts) };
}
function series(old = [history(0), history(1)]) {
  let a = makeAttempt('qa-new', 0, old.filter(x => x.examId === packs[0].id).length + 1);
  a = model.answerQuestion(a, 1, 0, stamp + 100);
  a = model.answerQuestion(a, 2, 1, stamp + 200);
  a = model.advanceAttempt(a, stamp + 300);
  const snapshots = [backup([...old, a])];
  a = model.markInterrupted(a, 'background', stamp + 400); snapshots.push(backup([...old, a]));
  a = model.advanceAttempt(a, stamp + 500); snapshots.push(backup([...old, a]));
  a = model.markInterrupted(a, 'audio-interrupted', stamp + 600); snapshots.push(backup([...old, a]));
  return { baseline: backup(old), snapshots };
}
async function checkSeries(data, before = null) {
  const base = await v.validateBackup(data.baseline, context, model, now);
  const states = await Promise.all(data.snapshots.map(s => v.validateBackup(s, context, model, now)));
  return v.compareStates(context, base, states, before && await v.validateBackup(before, context, model, now));
}
const rejected = (fn, code) => assert.rejects(fn, e => e instanceof v.VerificationError && (!code || e.code === code));

test('actual TS model parses both complete original fixtures and manifest fingerprints', () => {
  assert.equal(context.expected.size, 2);
  for (const row of context.expected.values()) assert.equal(row.pack.questions.length, 200);
});
test('manifest rejects byte hash mismatch, altered identity and non-original source', async t => {
  const dir = fresh(t), source = JSON.parse(fs.readFileSync(manifestFile));
  for (const mutate of [m => { m.packages[0].sha256 = '0'.repeat(64); }, m => { m.packages[0].title = 'wrong'; },
    m => { m.packages[1].id = m.packages[0].id; }]) {
    const m = clone(source); mutate(m); await rejected(() => v.loadManifest(save(dir, crypto.randomUUID() + '.json', m), model));
  }
  const pack = clone(packs[0]); pack.source.classification = 'other';
  const file = save(dir, 'other.json', pack), m = clone(source);
  m.packages[0].file = file; m.packages[0].sha256 = hash(fs.readFileSync(file));
  await rejected(() => v.loadManifest(save(dir, 'other-manifest.json', m), model), 'INPUT_IDENTITY');
});
test('manifest validates exact safe device basenames and fixed two-answer contract', async t => {
  const dir = fresh(t), source = JSON.parse(fs.readFileSync(manifestFile));
  for (const mutate of [m => { m.packages[0].deviceFile = '../qa.json'; },
    m => { m.packages[1].deviceFile = m.packages[0].deviceFile.toUpperCase().replace('.JSON', '.json'); },
    m => { m.packages[0].file = 'https://example.invalid/private.json'; }, m => { m.answers['2'] = 2; },
    m => { m.extra = true; }]) {
    const m = clone(source); mutate(m); await rejected(() => v.loadManifest(save(dir, crypto.randomUUID() + '.json', m), model));
  }
});
test('updated SHA cannot make an incomplete 199-question input pass the actual model', async t => {
  const dir = fresh(t), pack = clone(packs[0]); pack.questions.pop();
  const file = save(dir, 'bad-pack.json', pack), m = JSON.parse(fs.readFileSync(manifestFile));
  m.packages[0].file = file; m.packages[0].sha256 = hash(fs.readFileSync(file));
  await rejected(() => v.loadManifest(save(dir, 'bad-manifest.json', m), model), 'INPUT_MODEL');
});
test('inspect accepts zero, one or two known packages and at most one model-valid active attempt', async () => {
  for (let n = 0; n <= 2; n++) {
    const s = await v.validateBackup(backup([], packs.slice(0, n)), context, model, now);
    assert.equal(s.packages.size, n); assert.equal(s.activeId, null);
  }
  const s = await v.validateBackup(backup([history(), makeAttempt('active', 0, 2)]), context, model, now);
  assert.equal(v.summary(s).activeId, 'active'); assert.equal(s.attempts.size, 2);
});
test('inspect rejects owner leakage, unknown fields, duplicate/changed/unknown packages', async () => {
  for (const mutate of [b => { b.ownerId = 'other-person'; }, b => { b.privateField = 'SECRET MATERIAL'; },
    b => { b.packages[1] = b.packages[0]; }, b => { b.packages[0].questions[0].answer = 3; },
    b => { b.packages[0].id = 'unknown-original'; }]) {
    const b = backup(); mutate(b); await rejected(() => v.validateBackup(b, context, model, now));
  }
});
test('inspect rejects duplicate attempt IDs, missing packages, ordinal gaps and multiple active attempts', async () => {
  const cases = [backup([history(), history()]), backup([history()], []), backup([makeAttempt('gap', 0, 2)]),
    backup([makeAttempt('a', 0), makeAttempt('b', 1)])];
  for (const b of cases) await rejected(() => v.validateBackup(b, context, model, now));
});
test('attempt fingerprints, fixed deadlines and future-time limits are checked by actual model', async () => {
  for (const mutate of [a => { a.ownerId = 'other'; }, a => { a.fingerprint = 'sha256:' + '0'.repeat(64); },
    a => { a.listeningDeadline++; }, a => { a.answers = { '7': { choice: 3, savedAt: a.startedAt } }; }]) {
    const a = makeAttempt('bad'); mutate(a); await rejected(() => v.validateBackup(backup([a]), context, model, now), 'ATTEMPT_MODEL');
  }
  await rejected(() => v.validateBackup(backup([makeAttempt('future', 0, 1, now + 300001)]), context, model, now), 'ATTEMPT_MODEL');
});
test('compare permits an explicitly empty caller baseline without attesting device export', async t => {
  const dir = fresh(t), data = series([]); data.baseline.packages = [];
  const args = { repo: root, manifest: manifestFile, baseline: save(dir, 'empty.json', data.baseline),
    files: data.snapshots.map((x, i) => save(dir, 'B' + i + '.json', x)) };
  const report = await v.verify(args, now);
  assert.equal(report.baselineEmpty, true); assert.equal(report.ordinal, 1);
  assert.match(report.evidenceOrigin, /not independently attested/); assert.equal(report.liveDeviceRun, undefined);
});
test('compare preserves submitted histories and accepts legitimate observation/revision/interruption growth', async () => {
  const result = await checkSeries(series());
  assert.equal(result.historyAttemptCount, 2); assert.equal(result.ordinal, 2);
  assert.equal(result.exactlyOneNewAttempt, true); assert.equal(result.finalPhase, 'listening');
});
test('historical attempt fields and IDs cannot change or disappear even at equal counts', async () => {
  for (const mutate of [b => { b.attempts[0].clockRollback = true; }, b => { b.attempts[0].id = 'replacement'; },
    b => { b.attempts.shift(); }]) {
    const data = series(); mutate(data.snapshots[2]); await rejected(() => checkSeries(data));
  }
});
test('before-start active attempt is rejected instead of treated as test-owned history', async () => {
  const data = series([]); data.baseline = backup([makeAttempt('unowned')]);
  await rejected(() => checkSeries(data), 'BASELINE_ACTIVE');
});
test('extra attempts and new attempts of the other synthetic exam are rejected', async () => {
  const data = series();
  let extra = makeAttempt('extra', 1, 2, stamp - 3 * 3600_000); extra = model.advanceAttempt(extra, extra.readingDeadline);
  data.snapshots[3].attempts.push(clone(extra)); await rejected(() => checkSeries(data), 'NEW_ATTEMPT_COUNT');
  const other = series();
  for (const b of other.snapshots) {
    const a = b.attempts.at(-1), row = context.expected.get(packs[1].id + '@1');
    a.examId = packs[1].id; a.fingerprint = row.fingerprint;
  }
  await rejected(() => checkSeries(other), 'NEW_ATTEMPT_IDENTITY');
});
test('two-answer values, savedAt and same-exam new ID stay stable across all snapshots', async () => {
  for (const mutate of [a => { a.answers['2'].choice = 0; }, a => { a.answers['2'].savedAt++; },
    a => { a.id = 'other-new'; }, a => { delete a.answers['2']; }]) {
    const data = series(); mutate(data.snapshots[2].attempts.at(-1)); await rejected(() => checkSeries(data));
  }
});
test('revision, observation and clock-rollback markers cannot regress', async () => {
  const revision = series(); revision.snapshots[2].attempts.at(-1).revision = 1;
  await rejected(() => checkSeries(revision), 'REGRESSION');
  const observed = series(); observed.snapshots[2].attempts.at(-1).lastObservedAt = stamp + 400;
  observed.snapshots[2].attempts.at(-1).questionTimeMs['2'] -= 100;
  observed.snapshots[1].attempts.at(-1).lastObservedAt = stamp + 450;
  observed.snapshots[1].attempts.at(-1).questionTimeMs['2'] += 50;
  await rejected(() => checkSeries(observed), 'REGRESSION');
  const clock = series(); clock.snapshots[1].attempts.at(-1).clockRollback = true;
  await rejected(() => checkSeries(clock), 'REGRESSION');
});
test('per-question time cannot be redistributed to hide a decrease at equal total elapsed', async () => {
  const data = series(), a = data.snapshots[2].attempts.at(-1);
  a.questionTimeMs['1']--; a.questionTimeMs['2']++;
  await rejected(() => checkSeries(data), 'QUESTION_TIME_REGRESSION');
});
test('interruptions must remain an exact prefix, not just a set of matching members', async () => {
  const data = series();
  data.snapshots[1].attempts.at(-1).interruptions.push({ reason: 'audio-seek', at: stamp + 400 });
  data.snapshots[2].attempts.at(-1).interruptions = clone(data.snapshots[1].attempts.at(-1).interruptions).reverse();
  await rejected(() => checkSeries(data), 'INTERRUPTION_REGRESSION');
});
test('comparison explicitly rejects a final backup that naturally reached reading', async () => {
  const data = series(), a = data.snapshots[3].attempts.at(-1);
  data.snapshots[3].attempts[data.snapshots[3].attempts.length - 1] = clone(model.advanceAttempt(a, a.listeningDeadline));
  // Supply a later validation clock without mutating the host or any device clock.
  const base = await v.validateBackup(data.baseline, context, model, a.listeningDeadline);
  const states = await Promise.all(data.snapshots.map(b => v.validateBackup(b, context, model, a.listeningDeadline)));
  assert.throws(() => v.compareStates(context, base, states), e => e.code === 'NEW_ATTEMPT_IDENTITY');
});
test('before-import preserves a partial catalog and all history, rejects package loss and added history', async () => {
  const old = [history(0)], data = series(old), before = backup(old, [packs[0]]);
  assert.equal((await checkSeries(data, before)).historyAttemptCount, 1);
  const b = await v.validateBackup(backup([], packs), context, model, now);
  const lost = await v.validateBackup(backup([], [packs[0]]), context, model, now);
  assert.throws(() => v.preserve(b, lost), e => e.code === 'PACKAGE_LOST');
  const added = await v.validateBackup(backup([history()]), context, model, now);
  assert.throws(() => v.preserve(b, added), e => e.code === 'IMPORT_ADDED_ATTEMPT');
});
test('semantic property order changes do not count as history changes', async () => {
  const data = series();
  for (const b of data.snapshots) b.attempts[0] = Object.fromEntries(Object.entries(b.attempts[0]).reverse());
  assert.equal((await checkSeries(data)).exactlyOneNewAttempt, true);
});
test('CLI mode rejects missing/extra snapshots, duplicate options and mixed inspection/comparison', () => {
  const base = ['--manifest', 'manifest.json', '--out', 'out.json'];
  for (const extra of [['--baseline', 'before.json', '--files', 'B0', 'B1', 'B2'],
    ['--inspect', 'B0', '--baseline', 'before'], ['--inspect', 'B0', '--out', 'twice'], ['--shell', 'x']]) {
    assert.throws(() => v.parseArgs([...base, ...extra]), v.VerificationError);
  }
});
test('CLI writes only a new summary and failures never publish passed reports or disclose material', t => {
  const dir = fresh(t), state = save(dir, 'empty.json', backup([], [])), out = path.join(dir, 'report.json');
  const args = ['--repo', root, '--manifest', manifestFile, '--inspect', state, '--out', out];
  let child = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(fs.readFileSync(out)); assert.equal(report.status, 'passed');
  assert.equal(report.activeId, null); assert.deepEqual(report.packageKeys, []);
  const previous = fs.readFileSync(out);
  child = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  assert.equal(child.status, 1); assert.deepEqual(fs.readFileSync(out), previous);
  const bad = backup(); bad.secret = 'PRIVATE QUESTION AND ANSWER BODY';
  fs.writeFileSync(state, JSON.stringify(bad)); const failed = path.join(dir, 'failed-report.json');
  child = spawnSync(process.execPath, [script, ...args.slice(0, -1), failed], { encoding: 'utf8' });
  assert.equal(child.status, 1); assert.equal(fs.existsSync(failed), false);
  assert.doesNotMatch(child.stderr + child.stdout, /PRIVATE QUESTION|base64|PRIVATE.*BODY/);
  assert.ok(!(child.stderr + child.stdout).includes(dir));
  assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.tmp')), false);
});
