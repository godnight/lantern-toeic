import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, realpath } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { buildAccountWorker, buildSyncModel } from './build-inputs.mjs';
import { prepareAccountSyncAssembly } from './assembly.candidate.mjs';
import { validateSyncDatabase } from './production-sync-preflight.candidate.mjs';

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
    let app = await prepareAccountSyncAssembly({ settings, mf, origin, privateRoot, key, proxy, phoneKey, modelInfo });
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
    const otherCookie = registration2.headers.get('set-cookie').split(';')[0];
    assert.equal((await app.fetch(request('/candidate/sync/append', { cookie: otherCookie, body: { owner, event } }))).status, 409);
    assert.equal((await readPage(otherCookie)).status, 409);
    assert.equal((await app.fetch(request('/candidate/sync/append', { cookie, body: { owner, event: { ...event, grade: 'remembered' } } }))).status, 409);
    assert.equal((await (await prepareAccountSyncAssembly({ mf, origin })).fetch(request('/candidate/sync/append', { body: {} }))).status, 404);
    await mf.dispose(); mf = start(); db = await mf.getD1Database('DB');
    app = await prepareAccountSyncAssembly({ settings, mf, origin, privateRoot, key, proxy, phoneKey, modelInfo });
    for (const device of [cookie, cookieB, legacyCookie]) assert.equal((await app.fetch(request('/api/auth/session', { cookie: device }))).status, 200);
    const row = await db.prepare('SELECT COUNT(*) AS n FROM lantern_vocab_events WHERE owner=?').bind(owner).first();
    assert.equal(row.n, 1);
    assert.equal((await app.fetch(request('/api/auth/logout', { cookie, body: {} }))).status, 200);
    assert.equal((await append()).status, 401);
    assert.equal((await app.fetch(request('/api/auth/session', { cookie: cookieB }))).status, 200);
    assert.equal((await app.fetch(request('/api/auth/session', { cookie: legacyCookie }))).status, 200);
    assert.deepEqual((await (await readPage(cookieB)).json()).events, [event]);
  } finally {
    if (mf) await mf.dispose();
    const resolved = await realpath(directory), tmp = await realpath(os.tmpdir());
    if (path.dirname(resolved) !== tmp || !path.basename(resolved).startsWith('lantern-repo-assembly-')) throw Error('unsafe temporary directory');
    await rm(resolved, { recursive: true, force: true });
  }
});
