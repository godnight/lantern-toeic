import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { buildAccountWorker, buildSyncModel } from './build-inputs.mjs';
import { prepareAccountSyncAssembly } from './assembly.candidate.mjs';
import { validateSyncDatabase } from './production-sync-preflight.candidate.mjs';
import { prepareCloudService } from './service.candidate.mjs';

const origin = 'https://synthetic.invalid';
const root = new URL('../../', import.meta.url);
const schema = [
  'CREATE TABLE lantern_vocab_events (revision INTEGER NOT NULL, owner TEXT NOT NULL, event_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(owner,revision), UNIQUE(owner,event_id))',
  'CREATE INDEX lantern_vocab_events_owner_revision ON lantern_vocab_events(owner,revision)',
  'CREATE TABLE lantern_vocab_snapshots (id TEXT PRIMARY KEY, owner TEXT NOT NULL, upper_revision INTEGER NOT NULL, page_size INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
  'CREATE TABLE lantern_vocab_cursors (snapshot_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, after_revision INTEGER NOT NULL, PRIMARY KEY(snapshot_id,after_revision))',
];
async function migrate(db, name) {
  const sql = await readFile(new URL('drizzle/' + name, root), 'utf8');
  await db.batch(sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
}
async function makeCertificate(directory) {
  const config = path.join(directory, 'openssl.cnf'), certFile = path.join(directory, 'cert.pem'), keyFile = path.join(directory, 'key.pem');
  await writeFile(config, '[req]\ndistinguished_name=dn\n[dn]\n');
  const openssl = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  execFileSync(openssl, ['req', '-config', config, '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-keyout', keyFile,
    '-out', certFile, '-days', '1', '-subj', '/CN=synthetic.invalid', '-addext', 'subjectAltName=DNS:synthetic.invalid'], { stdio: 'ignore', timeout: 15000 });
  return { key: await readFile(keyFile), cert: await readFile(certFile) };
}
function httpsStudy(port, cert, cookie, owner) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, servername: 'synthetic.invalid', ca: cert,
      path: '/api/study?sync=native-m2a-v1', headers: { host: 'synthetic.invalid', cookie, 'x-lantern-owner': owner } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end();
  });
}
test('repository Worker and model share one D1; phone stays closed; session, isolation and restart work', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lantern-repo-assembly-'));
  const worker = await buildAccountWorker(), modelInfo = await buildSyncModel();
  const key = randomBytes(32), proxy = randomBytes(32), phoneKey = randomBytes(32);
  let mf;
  const start = () => new Miniflare({ modules: true, script: worker.bytes.toString(), compatibilityDate: '2026-05-15',
    compatibilityFlags: ['nodejs_compat'], cf: false, host: '127.0.0.1', port: 0, d1Databases: ['DB'], d1Persist: directory,
    bindings: { LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin }, outboundService: () => new Response(null, { status: 403 }), log: new Log(LogLevel.ERROR) });
  const request = (route, { body, cookie, owner } = {}) => new Request(origin + route, { method: body ? 'POST' : 'GET',
    headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(owner ? { 'x-lantern-owner': owner } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    mf = start(); let db = await mf.getD1Database('DB');
    for (const name of ['0000_spotty_stellaris.sql', '0001_study_data_v2.sql', '0002_parched_edwin_jarvis.sql', '0003_cynical_snowbird.sql', '0004_study_sync_index.sql', '0005_product_auth.sql', '0006_auth_admission_ticket.sql', '0009_huawei_auth.sql']) await migrate(db, name);
    await db.batch(schema.map(sql => db.prepare(sql)));
    await db.prepare('INSERT INTO study_sync_clock(id,epoch,revision,ready) VALUES(1,?,0,1)').bind(randomBytes(16).toString('hex')).run();
    await db.prepare('CREATE TABLE _lantern_local_migrations(name TEXT PRIMARY KEY,sha TEXT NOT NULL)').run();
    const manifest = JSON.parse(await readFile(new URL('./unified-sync-schema-manifest.candidate.json', import.meta.url), 'utf8'));
    await db.batch(Object.entries(manifest.migrations).map(([name, hashes]) => db.prepare('INSERT INTO _lantern_local_migrations(name,sha) VALUES(?,?)').bind(name, hashes[0])));
    // A damaged ledger without a UNIQUE constraint could duplicate one valid
    // migration while omitting another; row count and valid hashes alone do
    // not establish that every required migration exists.
    const ledger = Object.entries(manifest.migrations).map(([name, hashes]) => ({ name, sha: hashes[0] }));
    const withLedger = rows => ({ prepare(sql) {
      if (sql.startsWith('SELECT name,sha FROM _lantern_local_migrations')) return { bind: () => ({ all: async () => ({ results: rows }) }) };
      return db.prepare(sql);
    } });
    await validateSyncDatabase(withLedger(ledger));
    await assert.rejects(validateSyncDatabase(withLedger([...ledger.slice(0, -1), ledger[0]])), /ledger mismatch/);
    await assert.rejects(validateSyncDatabase(withLedger(ledger.slice(1))), /ledger mismatch/);
    await assert.rejects(validateSyncDatabase(withLedger([...ledger.slice(0, -1), { ...ledger.at(-1), sha: '0'.repeat(64) }])), /ledger mismatch/);
    const privateRoot = path.resolve('synthetic-private'), settings = { enabled: true, origin, cursorKeyFile: path.join(privateRoot, 'cursor.key'), modelSha256: modelInfo.sha };
    let app = await prepareAccountSyncAssembly({ settings, mf, origin, privateRoot, key, proxy, phoneKey, modelInfo, orderedAttemptsEnabled: true });
    const status = await app.fetch(request('/api/auth/phone/status'));
    assert.deepEqual((await status.json()).capabilities, { phoneLogin: false, phoneBinding: false });
    assert.equal((await app.fetch(request('/api/auth/phone/challenge', { body: {} }))).status, 503);
    const registration = await app.fetch(request('/api/auth/register', { body: { username: 'synthetic_user', password: 'synthetic-password-123' } }));
    assert.equal(registration.status, 200, await registration.clone().text());
    const owner = (await registration.json()).user.id, cookie = registration.headers.get('set-cookie').split(';')[0];
    // Seed the exact schema and hashed-token shape of a session created before this change.
    const legacyToken = randomBytes(32).toString('hex'), now = Date.now();
    const legacyCookie = '__Host-lantern-session=' + legacyToken;
    await db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
      .bind(createHash('sha256').update(legacyToken).digest('hex'), owner, now, now + 3600000).run();
    const deviceB = await app.fetch(request('/api/auth/login', { body: { username: 'synthetic_user', password: 'synthetic-password-123' } }));
    assert.equal(deviceB.status, 200, await deviceB.clone().text());
    assert.equal((await deviceB.json()).user.id, owner);
    const cookieB = deviceB.headers.get('set-cookie').split(';')[0];
    for (const device of [cookie, cookieB, legacyCookie]) assert.equal((await app.fetch(request('/api/auth/session', { cookie: device }))).status, 200);
    const event = { id: 'synthetic-review-1', wordId: 'archive', createdAt: new Date().toISOString(), type: 'review', grade: 'again' };
    const append = (who = owner) => app.fetch(request('/candidate/sync/append', { cookie, body: { owner: who, event } }));
    assert.equal((await append()).status, 200);
    assert.equal((await append()).status, 200);
    const snapshotResponse = await app.fetch(request('/candidate/sync/snapshot', { cookie: cookieB, body: { owner, pageSize: 20 } }));
    assert.equal(snapshotResponse.status, 200);
    const snapshot = await snapshotResponse.json();
    const pageBody = { owner, snapshot: snapshot.id, cursor: snapshot.cursor };
    const readPage = device => app.fetch(request('/candidate/sync/page', { cookie: device, body: pageBody }));
    assert.deepEqual((await (await readPage(cookieB)).json()).events, [event]);
    assert.equal((await append('different-owner')).status, 409);
    const registration2 = await app.fetch(request('/api/auth/register', { body: { username: 'synthetic_other', password: 'synthetic-password-123' } }));
    assert.equal(registration2.status, 200);
    const otherOwner = (await registration2.json()).user.id;
    const otherCookie = registration2.headers.get('set-cookie').split(';')[0];
    assert.equal((await app.fetch(request('/candidate/sync/append', { cookie: otherCookie, body: { owner, event } }))).status, 409);
    assert.equal((await readPage(otherCookie)).status, 409);
    assert.equal((await app.fetch(request('/candidate/sync/append', { cookie, body: { owner, event: { ...event, grade: 'remembered' } } }))).status, 409);
    // Exercise the repository's actual question catalog and native journal
    // through the same Worker and D1 as the account service.
    const questions = (await modelInfo.importModel()).QUESTIONS, question = questions[0];
    const attempt = { id: randomUUID(), qid: question.id, choice: 0, correct: question.correctIndex === 0,
      mode: 'first', createdAt: new Date().toISOString(), seconds: 3 };
    const checkin = { id: randomUUID(), date: '2026-01-01', minutes: 5, load: '轻', note: '', createdAt: new Date().toISOString() };
    const saveStudy = (device, who, type, data) => app.fetch(request('/api/study', { cookie: device, owner: who, body: { type, data } }));
    // Even a single device can enumerate persisted offline events out of
    // order. Unproven attempts stay local; the server must not invent mode.
    const pendingAttempt = await saveStudy(cookie, owner, 'attempt', attempt);
    assert.equal(pendingAttempt.status, 409);
    assert.equal((await pendingAttempt.json()).code, 'attempt-order-unproven');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE user_id=?').bind(owner).first()).n, 0);
    const wireAttempt = (record, firstAttemptId) => ({ id: record.id, qid: record.qid, choice: record.choice,
      createdAt: record.createdAt, seconds: record.seconds, firstAttemptId });
    const defaultClosed = await prepareAccountSyncAssembly({ settings, mf, origin, privateRoot, key, proxy, phoneKey, modelInfo });
    assert.equal((await defaultClosed.fetch(request('/api/study', { cookie, owner, body: { type: 'attempt', data: wireAttempt(attempt, attempt.id) } }))).status, 503);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE user_id=?').bind(owner).first()).n, 0);
    const review = { ...attempt, id: randomUUID(), choice: question.options.length > 1 ? 1 : 0, mode: 'review' };
    review.correct = review.choice === question.correctIndex;
    // Review may arrive early after an offline retry: reject it until its
    // same-owner, same-question first attempt is actually in the database.
    assert.equal((await saveStudy(cookie, owner, 'attempt', wireAttempt(review, attempt.id))).status, 409);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE user_id=?').bind(owner).first()).n, 0);
    assert.equal((await saveStudy(cookie, owner, 'attempt', wireAttempt(attempt, attempt.id))).status, 200);
    assert.equal((await saveStudy(cookie, owner, 'attempt', wireAttempt(attempt, attempt.id))).status, 200);
    const competingFirst = { ...attempt, id: randomUUID() };
    assert.equal((await saveStudy(cookie, owner, 'attempt', wireAttempt(competingFirst, competingFirst.id))).status, 409);
    assert.equal((await saveStudy(otherCookie, owner, 'attempt', wireAttempt(review, attempt.id))).status, 409);
    // One atomic admission may claim first even if requests race; an anchor
    // from another owner cannot be used to create a review.
    assert.equal((await saveStudy(otherCookie, otherOwner, 'attempt', wireAttempt(review, attempt.id))).status, 409);
    const otherFirstA = { ...attempt, id: randomUUID() }, otherFirstB = { ...attempt, id: randomUUID() };
    const competing = await Promise.all([otherFirstA, otherFirstB].map(row => saveStudy(otherCookie, otherOwner, 'attempt', wireAttempt(row, row.id))));
    assert.deepEqual(competing.map(result => result.status).sort(), [200, 409]);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE user_id=? AND qid=? AND mode=?').bind(otherOwner, question.id, 'first').first()).n, 1);
    const distinctQuestions = questions.filter(row => row.id !== question.id).slice(0, 2);
    assert.equal(distinctQuestions.length, 2);
    const acrossQuestions = distinctQuestions.map(row => ({ ...attempt, id: randomUUID(), qid: row.id, choice: 0 }));
    const independent = await Promise.all(acrossQuestions.map(row => saveStudy(otherCookie, otherOwner, 'attempt', wireAttempt(row, row.id))));
    assert.deepEqual(independent.map(result => result.status), [200, 200]);
    // An imported review without a first cannot establish a safe baseline.
    const registration3 = await app.fetch(request('/api/auth/register', { body: { username: 'synthetic_third', password: 'synthetic-password-123' } }));
    assert.equal(registration3.status, 200);
    const thirdOwner = (await registration3.json()).user.id, thirdCookie = registration3.headers.get('set-cookie').split(';')[0];
    const orphan = { ...attempt, id: randomUUID() };
    await db.prepare('INSERT INTO attempts(id,user_id,qid,choice,correct,created_at,seconds,mode) VALUES(?,?,?,?,?,?,?,?)')
      .bind(orphan.id, thirdOwner, orphan.qid, orphan.choice, Number(question.correctIndex === orphan.choice), orphan.createdAt, orphan.seconds, 'review').run();
    const afterOrphan = { ...attempt, id: randomUUID() };
    assert.equal((await saveStudy(thirdCookie, thirdOwner, 'attempt', wireAttempt(afterOrphan, afterOrphan.id))).status, 409);
    assert.equal((await saveStudy(thirdCookie, thirdOwner, 'attempt', wireAttempt(afterOrphan, orphan.id))).status, 409);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE user_id=? AND qid=?').bind(thirdOwner, question.id).first()).n, 1);
    const sharedQuestion = questions.find(row => row.id !== question.id && !distinctQuestions.some(seen => seen.id === row.id));
    assert.ok(sharedQuestion);
    const isolatedFirst = [otherOwner, thirdOwner].map(() => ({ ...attempt, id: randomUUID(), qid: sharedQuestion.id, choice: 0 }));
    const crossOwner = await Promise.all([[otherCookie, otherOwner], [thirdCookie, thirdOwner]].map(([device, who], index) =>
      saveStudy(device, who, 'attempt', wireAttempt(isolatedFirst[index], isolatedFirst[index].id))));
    assert.deepEqual(crossOwner.map(result => result.status), [200, 200]);
    // A previously committed event remains safe to acknowledge using the
    // old unanchored format, including a response lost before offline retry.
    for (const [type, data] of [['attempt', attempt], ['checkin', checkin]]) {
      assert.equal((await saveStudy(cookie, owner, type, data)).status, 200);
      assert.equal((await saveStudy(cookie, owner, type, data)).status, 200);
    }
    assert.equal((await saveStudy(cookie, owner, 'attempt', { ...attempt, seconds: attempt.seconds + 1 })).status, 409);
    assert.equal((await saveStudy(cookie, owner, 'attempt', { ...attempt, mode: 'review' })).status, 409);
    assert.equal((await saveStudy(cookie, owner, 'attempt', { ...attempt, correct: !attempt.correct })).status, 409);
    const unclassifiedRetry = { id: attempt.id, qid: attempt.qid, choice: attempt.choice, createdAt: attempt.createdAt, seconds: attempt.seconds };
    assert.equal((await saveStudy(cookie, owner, 'attempt', unclassifiedRetry)).status, 409);
    assert.equal((await db.prepare('SELECT mode,correct FROM attempts WHERE id=? AND user_id=?').bind(attempt.id, owner).first()).mode, 'first');
    assert.equal((await saveStudy(cookie, owner, 'checkin', { ...checkin, minutes: 6 })).status, 409);
    assert.equal((await saveStudy(otherCookie, owner, 'attempt', attempt)).status, 409);
    const readStudy = device => app.fetch(request('/api/study?sync=native-m2a-v1', { cookie: device, owner }));
    let journal = await (await readStudy(cookieB)).json();
    assert.deepEqual(journal.changes.map(change => change.kind), ['attempt', 'checkin']);
    assert.equal(journal.changes[0].data.correct, question.correctIndex === 0);
    assert.equal(journal.changes[0].data.mode, 'first');
    assert.equal((await readStudy(otherCookie)).status, 409);
    // Verify the real HTTPS handler, local channel, session check and D1 as a
    // single path, using only a self-signed synthetic certificate/account.
    const certificate = await makeCertificate(directory);
    const service = await prepareCloudService({ enabled: true, mf, origin, settings, privateRoot, key, proxy, phoneKey, modelInfo });
    const server = https.createServer(certificate, service.handler);
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const httpResult = await httpsStudy(server.address().port, certificate.cert, cookieB, owner);
      assert.equal(httpResult.status, 200);
      assert.deepEqual(JSON.parse(httpResult.body).changes.map(change => change.kind), ['attempt', 'checkin']);
      assert.equal((await httpsStudy(server.address().port, certificate.cert, otherCookie, owner)).status, 409);
    } finally { await new Promise(resolve => server.close(resolve)); await service.close(); }
    assert.equal((await (await prepareAccountSyncAssembly({ mf, origin })).fetch(request('/candidate/sync/append', { body: {} }))).status, 404);
    await mf.dispose(); mf = start(); db = await mf.getD1Database('DB');
    app = await prepareAccountSyncAssembly({ settings, mf, origin, privateRoot, key, proxy, phoneKey, modelInfo, orderedAttemptsEnabled: true });
    for (const device of [cookie, cookieB, legacyCookie]) assert.equal((await app.fetch(request('/api/auth/session', { cookie: device }))).status, 200);
    const row = await db.prepare('SELECT COUNT(*) AS n FROM lantern_vocab_events WHERE owner=?').bind(owner).first();
    assert.equal(row.n, 1);
    assert.equal((await app.fetch(request('/api/auth/logout', { cookie, body: {} }))).status, 200);
    assert.equal((await append()).status, 401);
    assert.equal((await app.fetch(request('/api/auth/session', { cookie: cookieB }))).status, 200);
    assert.equal((await app.fetch(request('/api/auth/session', { cookie: legacyCookie }))).status, 200);
    assert.deepEqual((await (await readPage(cookieB)).json()).events, [event]);
    journal = await (await readStudy(cookieB)).json();
    assert.deepEqual(journal.changes.map(change => change.kind), ['attempt', 'checkin']);
    assert.equal((await readStudy(cookie)).status, 401);
    assert.equal((await saveStudy(cookieB, owner, 'attempt', wireAttempt(review, randomUUID()))).status, 409);
    assert.equal((await saveStudy(cookieB, owner, 'attempt', wireAttempt(review, attempt.id))).status, 200);
    assert.equal((await saveStudy(cookieB, owner, 'attempt', wireAttempt(review, attempt.id))).status, 200);
    const reviewRow = await db.prepare('SELECT mode,correct FROM attempts WHERE id=? AND user_id=?').bind(review.id, owner).first();
    assert.equal(reviewRow.mode, 'review');
    assert.equal(reviewRow.correct, Number(review.choice === question.correctIndex));
    assert.equal((await saveStudy(cookieB, owner, 'attempt', review)).status, 200);
    assert.equal((await saveStudy(cookieB, owner, 'attempt', { ...review, mode: 'first' })).status, 409);
    assert.equal((await db.prepare('SELECT mode FROM attempts WHERE id=? AND user_id=?').bind(review.id, owner).first()).mode, 'review');
  } finally {
    if (mf) await mf.dispose();
    const resolved = await realpath(directory), tmp = await realpath(os.tmpdir());
    if (path.dirname(resolved) !== tmp || !path.basename(resolved).startsWith('lantern-repo-assembly-')) throw Error('unsafe temporary directory');
    await rm(resolved, { recursive: true, force: true });
  }
});
