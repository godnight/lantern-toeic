#!/usr/bin/env node
'use strict';
// Local synthetic QA only. Does not connect to devices, import records or mutate inputs.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const OWNER = 'harmony-local-device';
const IDS = new Set(['page-packer-qa-only', 'browser-qa-alpha']);
const EXPECTED_ANSWERS = { '1': 0, '2': 1 };
const STABLE = ['id', 'ownerId', 'examId', 'examVersion', 'fingerprint', 'ordinal',
  'startedAt', 'listeningDeadline', 'readingDeadline', 'answers'];
class VerificationError extends Error {
  constructor(code, message) { super(message); this.name = 'VerificationError'; this.code = code; }
}
function fail(code, message) { throw new VerificationError(code, message); }
function check(value, code, message) { if (!value) fail(code, message); }
function record(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function fields(value, expected, code) {
  check(record(value) && Object.keys(value).length === expected.length
    && Object.keys(value).every(k => expected.includes(k)), code, 'Object fields do not match the required contract');
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function equal(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function safeModel(operation, code) {
  try { return operation(); } catch { fail(code, 'Actual exam model rejected this input'); }
}
function localPath(filename) {
  check(typeof filename === 'string' && path.isAbsolute(filename)
    && !/^[\\/]{2}/.test(filename) && !/^[a-z]+:\/\//i.test(filename)
    && !filename.includes('\0'), 'LOCAL_PATH', 'Expected an absolute local filesystem path');
  return filename;
}
function readBounded(filename, limit) {
  localPath(filename);
  try {
    const stat = fs.statSync(filename);
    check(stat.isFile() && stat.size <= limit, 'FILE_LIMIT', 'Input is not a bounded regular file');
    const bytes = fs.readFileSync(filename);
    check(bytes.length <= limit, 'FILE_LIMIT', 'Input exceeded its read limit');
    return bytes;
  } catch (e) {
    if (e instanceof VerificationError) throw e;
    fail('INPUT_READ', 'Could not read a local input');
  }
}
function parseJson(bytes) {
  try { return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { fail('JSON', 'Input is not valid JSON'); }
}

function loadModel(repo) {
  try {
    const root = path.resolve(repo), ts = require(path.join(root, 'node_modules/typescript'));
    const source = fs.readFileSync(path.join(root, 'lib/exam-model.ts'), 'utf8');
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const exports = {};
    vm.runInNewContext(code, { exports, Date, Map, Set, Error, JSON, Promise,
      TextEncoder, Uint8Array, Uint32Array, ArrayBuffer, Blob, URL, atob, btoa,
      crypto: crypto.webcrypto }, { filename: 'lib/exam-model.ts' });
    return exports;
  } catch { fail('MODEL_LOAD', 'Could not load the actual repository exam model'); }
}

async function loadManifest(filename, model) {
  const bytes = readBounded(localPath(filename), 1024 * 1024), raw = parseJson(bytes);
  fields(raw, ['kind', 'schemaVersion', 'packages', 'examId', 'answers'], 'MANIFEST_FIELDS');
  check(raw.kind === 'lantern-native-mock-qa' && raw.schemaVersion === 1
    && raw.examId === 'page-packer-qa-only' && equal(raw.answers, EXPECTED_ANSWERS),
  'MANIFEST', 'Manifest must select the known synthetic exam and fixed QA answers');
  check(Array.isArray(raw.packages) && raw.packages.length === 2, 'MANIFEST_PACKAGES', 'Exactly two synthetic input packages are required');
  const expected = new Map(), ids = new Set(), deviceNames = new Set();
  for (const entry of raw.packages) {
    fields(entry, ['file', 'sha256', 'deviceFile', 'id', 'version', 'title'], 'MANIFEST_PACKAGE_FIELDS');
    check(IDS.has(entry.id) && !ids.has(entry.id), 'MANIFEST_IDS', 'Only the two unique known synthetic IDs are allowed');
    check(typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256), 'MANIFEST_SHA', 'Input SHA256 must be lowercase hexadecimal');
    check(typeof entry.deviceFile === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}\.json$/.test(entry.deviceFile)
      && !entry.deviceFile.includes('..') && !deviceNames.has(entry.deviceFile.toLowerCase()),
    'DEVICE_FILE', 'Each device filename must be an exact unique safe JSON basename');
    const input = readBounded(localPath(entry.file), model.EXAM_LIMITS.importBytes);
    check(sha(input) === entry.sha256, 'INPUT_SHA', 'Synthetic input bytes do not match the manifest hash');
    const pack = safeModel(() => model.parseExamPackage(input.toString('utf8').replace(/^\uFEFF/, '')), 'INPUT_MODEL');
    check(pack.id === entry.id && pack.version === entry.version && pack.title === entry.title
      && pack.source.classification === 'original', 'INPUT_IDENTITY', 'Manifest identity or original-source classification differs');
    const fingerprint = await model.fingerprintExam(pack), key = model.examKey(pack);
    ids.add(entry.id); deviceNames.add(entry.deviceFile.toLowerCase());
    expected.set(key, { pack, fingerprint, sha256: entry.sha256, deviceFile: entry.deviceFile });
  }
  return { expected, examId: raw.examId, answers: EXPECTED_ANSWERS, sha256: sha(bytes) };
}

async function validateBackup(raw, context, model, now = Date.now()) {
  fields(raw, ['kind', 'schemaVersion', 'ownerId', 'packages', 'attempts'], 'BACKUP_FIELDS');
  check(raw.kind === 'lantern-exam-backup' && raw.schemaVersion === 1 && raw.ownerId === OWNER,
    'BACKUP_OWNER', 'Backup kind, schema or owner differs from dedicated local QA');
  check(Array.isArray(raw.packages) && raw.packages.length <= 2 && Array.isArray(raw.attempts)
    && raw.attempts.length <= model.EXAM_LIMITS.attempts && model.jsonBytes(raw) <= model.EXAM_LIMITS.backupBytes,
  'BACKUP_LIMIT', 'Backup package, attempt or byte count is invalid');
  const packages = new Map();
  for (const value of raw.packages) {
    const pack = safeModel(() => model.parseExamPackage(value), 'BACKUP_PACKAGE_MODEL');
    const key = model.examKey(pack), expected = context.expected.get(key);
    check(expected && !packages.has(key), 'BACKUP_PACKAGE_ID', 'Backup package is unknown or duplicated');
    const fingerprint = await model.fingerprintExam(pack);
    check(fingerprint === expected.fingerprint, 'BACKUP_FINGERPRINT', 'Backup package differs from the manifest input');
    packages.set(key, { pack, fingerprint });
  }
  const attempts = new Map(), rawAttempts = new Map(), perExam = new Map();
  for (const value of raw.attempts) {
    check(record(value), 'ATTEMPT_OBJECT', 'Attempt must be an object');
    const entry = packages.get(model.examKey({ id: value.examId, version: value.examVersion }));
    check(entry, 'ATTEMPT_PACKAGE', 'Attempt is missing its exact package version');
    const attempt = plain(safeModel(() => model.validateAttempt(value, entry.pack, OWNER, entry.fingerprint, now), 'ATTEMPT_MODEL'));
    check(!attempts.has(attempt.id), 'ATTEMPT_DUPLICATE', 'Attempt ID is duplicated');
    attempts.set(attempt.id, attempt); rawAttempts.set(attempt.id, value);
    const rows = perExam.get(attempt.examId) || []; rows.push(attempt); perExam.set(attempt.examId, rows);
  }
  const active = [...attempts.values()].filter(a => a.status !== 'submitted');
  check(active.length <= 1, 'MULTIPLE_ACTIVE', 'More than one active attempt exists');
  for (const rows of perExam.values()) {
    rows.sort((a, b) => a.ordinal - b.ordinal);
    check(rows.every((a, i) => a.ordinal === i + 1 && (!i || a.startedAt >= rows[i - 1].startedAt)),
      'HISTORY_ORDINAL', 'Attempt ordinal history is not continuous or chronological');
  }
  return { packages, attempts, rawAttempts, activeId: active[0]?.id || null };
}

async function readBackup(filename, context, model, now) {
  const bytes = readBounded(localPath(filename), model.EXAM_LIMITS.backupBytes);
  const state = await validateBackup(parseJson(bytes), context, model, now);
  return { ...state, sha256: sha(bytes), bytes: bytes.length };
}
function summary(state) {
  return { activeId: state.activeId, attemptCount: state.attempts.size,
    packageKeys: [...state.packages.keys()].sort(), attemptIds: [...state.attempts.keys()].sort(),
    sha256: state.sha256, bytes: state.bytes };
}
function preserve(before, after, allowNewAttempt = false) {
  for (const [key, p] of before.packages) {
    check(after.packages.get(key)?.fingerprint === p.fingerprint, 'PACKAGE_LOST', 'An existing package changed or disappeared');
  }
  for (const [id, old] of before.rawAttempts) {
    check(after.rawAttempts.has(id) && equal(old, after.rawAttempts.get(id)),
      'HISTORY_CHANGED', 'An existing attempt changed or disappeared');
  }
  if (!allowNewAttempt) check(before.attempts.size === after.attempts.size, 'IMPORT_ADDED_ATTEMPT', 'Package import unexpectedly added attempts');
}
function compareStates(context, baseline, snapshots, beforeImport = null) {
  check(snapshots.length === 4, 'FOUR_SNAPSHOTS', 'Exactly B0, B1, B2 and B3 are required');
  check(!baseline.activeId, 'BASELINE_ACTIVE', 'Before-start baseline must contain only submitted history');
  if (beforeImport) preserve(beforeImport, baseline);
  const expectedKeys = [...context.expected.keys()].sort();
  let first, previous;
  for (const current of snapshots) {
    check(equal([...current.packages.keys()].sort(), expectedKeys), 'SNAPSHOT_PACKAGES', 'Every post-start backup must contain both known packages');
    preserve(baseline, current, true);
    const added = [...current.attempts.values()].filter(a => !baseline.attempts.has(a.id));
    check(current.attempts.size === baseline.attempts.size + 1 && added.length === 1,
      'NEW_ATTEMPT_COUNT', 'Post-start snapshots must add exactly one attempt');
    const next = added[0], expectedOrdinal = [...baseline.attempts.values()].filter(a => a.examId === context.examId).length + 1;
    check(next.examId === context.examId && next.ordinal === expectedOrdinal && next.status === 'listening'
      && current.activeId === next.id, 'NEW_ATTEMPT_IDENTITY', 'New attempt must be the specified next synthetic listening attempt');
    check(equal(Object.fromEntries(Object.entries(next.answers).map(([q, a]) => [q, a.choice])), context.answers),
      'NEW_ANSWERS', 'New attempt does not contain exactly the two fixed QA answers');
    if (!first) first = next;
    for (const field of STABLE) check(equal(next[field], first[field]), 'UNSTABLE_ATTEMPT', 'New attempt identity, answers or deadlines changed across snapshots');
    if (previous) {
      check(next.revision >= previous.revision && next.lastObservedAt >= previous.lastObservedAt
        && (!previous.clockRollback || next.clockRollback), 'REGRESSION', 'Revision, observed time or clock integrity regressed');
      for (const [q, milliseconds] of Object.entries(previous.questionTimeMs)) {
        check(Object.hasOwn(next.questionTimeMs, q) && next.questionTimeMs[q] >= milliseconds,
          'QUESTION_TIME_REGRESSION', 'Question time was lost or decreased');
      }
      check(next.interruptions.length >= previous.interruptions.length
        && previous.interruptions.every((event, i) => equal(event, next.interruptions[i])),
      'INTERRUPTION_REGRESSION', 'Existing interruption sequence was removed, reordered or changed');
    }
    previous = next;
  }
  return { activeId: first.id, newAttemptId: first.id, ordinal: first.ordinal,
    startedAt: first.startedAt, listeningDeadline: first.listeningDeadline, readingDeadline: first.readingDeadline,
    stableFields: STABLE, historyAttemptCount: baseline.attempts.size, exactlyOneNewAttempt: true,
    finalPhase: previous.status, finalRevision: previous.revision, finalObservedAt: previous.lastObservedAt };
}

function compareTimeoutStates(context, baseline, final, model, now) {
  const expectedKeys = [...context.expected.keys()].sort();
  check(equal([...baseline.packages.keys()].sort(), expectedKeys)
    && equal([...final.packages.keys()].sort(), expectedKeys),
  'TIMEOUT_PACKAGES', 'Both timeout snapshots must contain the same two known packages');
  check(equal([...baseline.attempts.keys()].sort(), [...final.attempts.keys()].sort()),
    'TIMEOUT_ATTEMPTS', 'Timeout must not add, replace or remove any attempt');
  check(baseline.activeId && !final.activeId, 'TIMEOUT_PHASE',
    'Baseline must contain exactly one active attempt and final must contain none');
  const before = baseline.attempts.get(baseline.activeId), after = final.attempts.get(baseline.activeId);
  check(before.examId === context.examId
    && equal(Object.fromEntries(Object.entries(before.answers).map(([q, a]) => [q, a.choice])), context.answers),
  'TIMEOUT_BASELINE', 'The active baseline must be the known synthetic exam with exactly the two QA answers');
  for (const [id, old] of baseline.rawAttempts) {
    if (id !== before.id) check(equal(old, final.rawAttempts.get(id)),
      'HISTORY_CHANGED', 'Submitted history changed across the timeout snapshots');
  }
  const rawBefore = baseline.rawAttempts.get(before.id), rawAfter = final.rawAttempts.get(before.id);
  for (const field of ['kind', 'schemaVersion', ...STABLE]) {
    check(equal(rawBefore[field], rawAfter[field]), 'TIMEOUT_STABLE',
      'Timeout changed identity, deadlines, answers or their original saved times');
  }
  check(after.status === 'submitted' && after.submittedReason === 'timeout'
    && after.submittedAt === before.readingDeadline && after.lastObservedAt === before.readingDeadline
    && after.activeQuestion >= 101,
  'TIMEOUT_FINAL', 'Final must already record natural timeout at the original reading deadline');
  // Import's five-minute future allowance cannot attest a deadline not yet reached.
  check(Number.isSafeInteger(now) && now >= after.submittedAt, 'TIMEOUT_NOT_DUE',
    'Validation time has not yet reached the original reading deadline');
  check(after.revision > before.revision && after.lastObservedAt > before.lastObservedAt
    && (!before.clockRollback || after.clockRollback),
  'TIMEOUT_REGRESSION', 'Timeout did not advance revisions/time or erased a clock-rollback marker');
  for (const [q, milliseconds] of Object.entries(before.questionTimeMs)) {
    check(Object.hasOwn(after.questionTimeMs, q) && after.questionTimeMs[q] >= milliseconds,
      'QUESTION_TIME_REGRESSION', 'Question time was lost or decreased');
  }
  check(after.interruptions.length >= before.interruptions.length
    && before.interruptions.every((event, i) => equal(event, after.interruptions[i])),
  'INTERRUPTION_REGRESSION', 'Existing interruptions changed, disappeared or were reordered');
  const appended = after.interruptions.slice(before.interruptions.length);
  check(appended.every((event, i) => event.at >= before.lastObservedAt
    && event.at < before.readingDeadline
    && !equal(event, after.interruptions[before.interruptions.length + i - 1])),
  'TIMEOUT_INTERRUPTION', 'New interruption predates the baseline, follows timeout or duplicates its predecessor');
  check(after.revision >= before.revision + appended.length + 1, 'TIMEOUT_REVISION',
    'Revision growth cannot account for the appended interruptions and timeout');
  // Grade the validated saved final state. Never advance/repair an unsubmitted
  // caller record and then mistake that derived state for an actual final export.
  const pack = final.packages.get(model.examKey({ id: after.examId, version: after.examVersion })).pack;
  const grade = plain(safeModel(() => model.gradeAttempt(pack, after), 'TIMEOUT_GRADE_MODEL'));
  check(grade.total === 200 && grade.correct === 0 && grade.unanswered === 198,
    'TIMEOUT_QA_RESULT', 'Actual model grade does not match the fixed synthetic two-answer QA scenario');
  return { attemptId: after.id, ordinal: after.ordinal, historyAttemptCount: baseline.attempts.size - 1,
    sameAttemptSet: true, submittedHistoryPreserved: true, stableFields: ['kind', 'schemaVersion', ...STABLE],
    startedAt: after.startedAt, listeningDeadline: after.listeningDeadline, readingDeadline: after.readingDeadline,
    submittedAt: after.submittedAt, submittedReason: after.submittedReason, finalPhase: after.status,
    finalRevision: after.revision, finalObservedAt: after.lastObservedAt,
    clockRollback: after.clockRollback, interruptionCount: after.interruptions.length,
    resultMeaning: 'Synthetic QA assertion only; not a user score or evidence of uninterrupted foreground execution',
    modelDerivedResult: grade };
}

function modeOf(args) {
  const timeout = args['timeout-baseline'] || args['final-backup'];
  if (timeout) {
    check(args['timeout-baseline'] && args['final-backup'] && !args.inspect && !args.baseline
      && !args.files && !args['before-import'], 'CLI_MODE',
    'Timeout mode requires timeout-baseline plus final-backup and cannot mix other modes');
    return 'timeout';
  }
  check(args.inspect ? !args.baseline && !args.files : args.baseline && args.files?.length === 4,
    'CLI_MODE', 'Use inspect mode or baseline plus exactly four files');
  return args.inspect ? 'inspect' : 'compare';
}

function parseArgs(argv) {
  const args = { repo: path.resolve(__dirname, '..') }, seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    check(['--repo', '--manifest', '--inspect', '--baseline', '--files', '--before-import', '--out',
      '--timeout-baseline', '--final-backup'].includes(key)
      && !seen.has(key), 'CLI_ARGUMENT', 'Unknown or repeated CLI argument');
    seen.add(key);
    if (key === '--files') {
      args.files = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args.files.push(path.resolve(argv[++i]));
    } else {
      check(i + 1 < argv.length && !argv[i + 1].startsWith('--'), 'CLI_ARGUMENT', 'Missing CLI value');
      args[key.slice(2)] = path.resolve(argv[++i]);
    }
  }
  check(args.manifest && args.out, 'CLI_ARGUMENT', 'Manifest and output paths are required');
  modeOf(args);
  return args;
}
function writeNewReport(filename, report) {
  localPath(filename);
  const temp = path.join(path.dirname(filename), '.native-mock-report-' + crypto.randomUUID() + '.tmp');
  let created = false;
  try {
    fs.writeFileSync(temp, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); created = true;
    fs.linkSync(temp, filename); // Atomic publish, never overwrite an existing output.
  } catch { fail('OUTPUT_WRITE', 'Could not create a new report without overwriting'); }
  finally { if (created) { try { fs.unlinkSync(temp); } catch {} } }
}
async function verify(args, now = Date.now()) {
  const mode = modeOf(args);
  const model = loadModel(args.repo), context = await loadManifest(args.manifest, model);
  const beforeImport = args['before-import'] ? await readBackup(args['before-import'], context, model, now) : null;
  const common = { kind: 'lantern-native-mock-verification', schemaVersion: 1, status: 'passed',
    checkedAt: new Date(now).toISOString(), manifestSha256: context.sha256,
    scope: 'Local synthetic QA backup comparison; no device operations',
    evidenceOrigin: 'Caller-supplied local JSON; a device export is not independently attested',
    packageFingerprintsMatchInputs: true,
    limitations: ['Not official test materials or hardware audio evidence', 'Not 45/120-minute live endurance evidence'] };
  if (mode === 'timeout') {
    const baseline = await readBackup(args['timeout-baseline'], context, model, now);
    const final = await readBackup(args['final-backup'], context, model, now);
    const compared = compareTimeoutStates(context, baseline, final, model, now);
    return { ...common, mode, ...summary(final), ...compared,
      baseline: summary(baseline), finalBackup: summary(final) };
  }
  if (mode === 'inspect') {
    const state = await readBackup(args.inspect, context, model, now);
    if (beforeImport) preserve(beforeImport, state);
    return { ...common, mode: 'inspect', ...summary(state),
      beforeImportPreserved: beforeImport ? true : null };
  }
  const baseline = await readBackup(args.baseline, context, model, now), snapshots = [];
  for (const file of args.files) snapshots.push(await readBackup(file, context, model, now));
  const compared = compareStates(context, baseline, snapshots, beforeImport);
  return { ...common, mode: 'compare', ...summary(snapshots.at(-1)), ...compared,
    beforeImportPreserved: beforeImport ? true : null,
    baselineEmpty: baseline.packages.size === 0 && baseline.attempts.size === 0,
    baseline: summary(baseline), snapshots: snapshots.map((state, i) => ({ label: 'B' + i, ...summary(state) })) };
}
async function main(argv) {
  try {
    const args = parseArgs(argv);
    check(!fs.existsSync(args.out), 'OUTPUT_EXISTS', 'Output already exists; choose a new report path');
    const report = await verify(args);
    writeNewReport(args.out, report);
    console.log(JSON.stringify(report));
    return 0;
  } catch (e) {
    console.error(JSON.stringify({ status: 'failed', code: e instanceof VerificationError ? e.code : 'INTERNAL',
      message: e instanceof VerificationError ? e.message : 'Unexpected verification failure; no passed report written' }));
    return 1;
  }
}
module.exports = { OWNER, VerificationError, loadModel, loadManifest, validateBackup, readBackup,
  summary, preserve, compareStates, compareTimeoutStates, parseArgs, writeNewReport, verify, main };
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; });
