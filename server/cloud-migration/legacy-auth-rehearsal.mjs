// Synthetic-only account ledger mapping rehearsal. Both databases are created
// inside this function in memory; no database paths or caller-owned handles are
// accepted. This is not a production backup or migration facility.
import { DatabaseSync, constants } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildAccountWorker } from '../cloud-candidate/build-inputs.mjs';
import { createSyntheticSqliteD1 } from '../cloud-candidate/synthetic-sqlite-d1.candidate.mjs';
import { verifyAccountDatabase } from '../cloud-candidate/account-db-preflight.candidate.mjs';

const pairs = Object.freeze([
  { old: '0000_product_auth.sql', current: '0005_product_auth.sql', oldHash: '343816721b4a8bd71b107de663dd672def7d54f86663234f606d2c749aab7628', lfHash: '1b88f0e2df5224f5115031bf52696c7d19ee6043a99a6c6cfa4f66607bebf04c' },
  { old: '0001_auth_admission_ticket.sql', current: '0006_auth_admission_ticket.sql', oldHash: '58d6fd8a377930234719104a61ea41487f5db322b92ffbc79aa0399bc6af87d1', lfHash: 'a547206b73bb57f2bfd9e76c83d15e4303354f299754d9ffbfd1e95fd3d84d2c' },
  { old: '0002_huawei_auth.sql', current: '0009_huawei_auth.sql', oldHash: 'd41bb1b0f4e3a66bb1582443ad1357336e14e4f7c07e94f24989fd66a8e5fd8b', lfHash: 'd41bb1b0f4e3a66bb1582443ad1357336e14e4f7c07e94f24989fd66a8e5fd8b' },
]);
const origin = 'https://legacy.synthetic.invalid';
const digest = x => createHash('sha256').update(x).digest('hex');
const queries = {
  auth_users: 'SELECT * FROM auth_users ORDER BY id',
  auth_password_credentials: 'SELECT * FROM auth_password_credentials ORDER BY user_id',
  auth_sessions: 'SELECT * FROM auth_sessions ORDER BY token_hash',
  auth_rate_limits: 'SELECT * FROM auth_rate_limits ORDER BY scope,window_start',
  auth_provider_bindings: 'SELECT * FROM auth_provider_bindings ORDER BY provider,audience,subject',
  auth_huawei_codes: 'SELECT * FROM auth_huawei_codes ORDER BY code_hash',
};

function canonical(db) {
  const state = {};
  for (const [table, query] of Object.entries(queries)) state[table] = db.prepare(query).all().map(row => ({ ...row }));
  return JSON.stringify(state);
}

function schema(db) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    .map(row => ({ ...row, sql: row.sql.replace(/\r\n/g, '\n') }));
}

async function reviewedSql() {
  const result = [];
  for (const pair of pairs) {
    const bytes = await readFile(new URL('../../drizzle/' + pair.current, import.meta.url), 'utf8');
    const lf = bytes.replace(/\r\n/g, '\n');
    if (digest(lf) !== pair.lfHash) throw Error('reviewed migration changed');
    if (![digest(lf), digest(lf.replace(/\n/g, '\r\n'))].includes(pair.oldHash)) throw Error('legacy migration bytes not equivalent');
    result.push(lf);
  }
  return result;
}

function initialize(db, sql) {
  if (db.location() !== null) throw Error('only in-memory synthetic databases allowed');
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE _lantern_local_migrations(name TEXT PRIMARY KEY,sha TEXT NOT NULL)');
  for (const text of sql) db.exec(text);
}

function legacyPreflight(db, expectedSchema) {
  if (db.location() !== null || JSON.stringify(schema(db)) !== JSON.stringify(expectedSchema)) throw Error('legacy synthetic schema mismatch');
  if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) throw Error('legacy synthetic integrity failure');
  const ledger = db.prepare('SELECT name,sha FROM _lantern_local_migrations ORDER BY name').all().map(row => ({ ...row }));
  const expected = pairs.map(({ old: name, oldHash: sha }) => ({ name, sha })).sort((a, b) => a.name.localeCompare(b.name));
  if (JSON.stringify(ledger) !== JSON.stringify(expected)) throw Error('legacy synthetic ledger mismatch');
}

async function worker() {
  const built = await buildAccountWorker();
  return (await import('data:text/javascript;base64,' + built.bytes.toString('base64'))).default;
}

function client(app, db) {
  const outbound = async url => Response.json(url.endsWith('/token')
    ? { token_type: 'Bearer', access_token: 'synthetic-token', expires_in: 3600 }
    : { client_id: '123456', type: 0, expire_in: 3600, open_id: 'synthetic-open-id' });
  const env = { DB: createSyntheticSqliteD1({ enabled: true, database: db }), LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin,
    LANTERN_HUAWEI_CLIENT_ID: '123456', LANTERN_HUAWEI_CLIENT_SECRET: 'synthetic-secret', LANTERN_HUAWEI_OUTBOUND: outbound };
  return (route, { body, cookie, method } = {}) => app.fetch(new Request(origin + route, {
    method: method ?? (body ? 'POST' : 'GET'), headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
}

/** Only fixed synthetic scenarios; no file paths, real handles or credentials. */
export async function rehearseLegacyAuthMigration(scenario = 'success') {
  const allowed = new Set(['success', 'bad-ledger', 'unknown-ledger', 'unknown-schema', 'bad-foreign-key', 'source-changed', 'copy-failure']);
  if (!allowed.has(scenario)) throw Error('unsupported synthetic scenario');
  const source = new DatabaseSync(':memory:'), copy = new DatabaseSync(':memory:'), reference = new DatabaseSync(':memory:');
  let session;
  try {
    const sql = await reviewedSql();
    for (const db of [source, copy, reference]) initialize(db, sql);
    const expectedSchema = schema(reference);
    session = source.createSession();
    for (const { old, oldHash } of pairs) source.prepare('INSERT INTO _lantern_local_migrations VALUES (?,?)').run(old, oldHash);
    const app = await worker(), old = client(app, source);
    const register = async (username, password) => {
      const response = await old('/api/auth/register', { body: { username, password } });
      if (response.status !== 200) throw Error('synthetic registration failed');
      return { identity: (await response.json()).user.id, cookie: response.headers.get('set-cookie').split(';')[0] };
    };
    const alice = await register('synthetic_alice', 'synthetic-password-123');
    const bob = await register('synthetic_bob', 'synthetic-password-456');
    const bound = await old('/api/auth/huawei/bind', { body: { code: 'synthetic-bind' }, cookie: alice.cookie });
    if (bound.status !== 200) throw Error('synthetic Huawei binding failed');
    if (scenario === 'bad-ledger') source.prepare('UPDATE _lantern_local_migrations SET sha=? WHERE name=?').run('0'.repeat(64), pairs[0].old);
    if (scenario === 'unknown-ledger') source.prepare('INSERT INTO _lantern_local_migrations VALUES (?,?)').run('unknown.sql', '0'.repeat(64));
    if (scenario === 'unknown-schema') source.exec('CREATE TABLE unknown_synthetic (id TEXT PRIMARY KEY)');
    if (scenario === 'bad-foreign-key') { source.exec('PRAGMA foreign_keys=OFF'); source.prepare('INSERT INTO auth_password_credentials VALUES (?,?)').run('missing-synthetic-user', 'invalid'); source.exec('PRAGMA foreign_keys=ON'); }
    legacyPreflight(source, expectedSchema);
    const before = canonical(source), sourceChanges = source.prepare('SELECT total_changes() AS n').get().n;
    const changeset = session.changeset();
    if (!copy.applyChangeset(changeset)) throw Error('synthetic logical copy failed');
    legacyPreflight(copy, expectedSchema);
    if (scenario === 'source-changed') source.prepare('UPDATE auth_users SET created_at=created_at+1 WHERE id=?').run(alice.identity);
    if (source.prepare('SELECT total_changes() AS n').get().n !== sourceChanges || canonical(source) !== before || canonical(copy) !== before) throw Error('synthetic source changed during copy');
    copy.exec('BEGIN IMMEDIATE');
    try {
      for (const [index, pair] of pairs.entries()) {
        if (scenario === 'copy-failure' && index === 1) throw Error('synthetic mapping failure');
        const result = copy.prepare('UPDATE _lantern_local_migrations SET name=?,sha=? WHERE name=? AND sha=?').run(pair.current, pair.lfHash, pair.old, pair.oldHash);
        if (result.changes !== 1) throw Error('synthetic ledger changed');
      }
      copy.exec('COMMIT');
    } catch (error) {
      copy.exec('ROLLBACK');
      legacyPreflight(copy, expectedSchema);
      if (canonical(copy) !== before || canonical(source) !== before) throw Error('synthetic rollback changed data');
      throw error;
    }
    if (canonical(source) !== before || canonical(copy) !== before) throw Error('synthetic account data changed');
    legacyPreflight(source, expectedSchema);
    await verifyAccountDatabase(createSyntheticSqliteD1({ enabled: true, database: copy }));
    const migrated = client(app, copy);
    const aliceSession = await migrated('/api/auth/session', { cookie: alice.cookie });
    const bobSession = await migrated('/api/auth/session', { cookie: bob.cookie });
    if (aliceSession.status !== 200 || bobSession.status !== 200 || (await aliceSession.json()).user.id !== alice.identity || (await bobSession.json()).user.id !== bob.identity || alice.identity === bob.identity) throw Error('synthetic session isolation failed');
    const password = await migrated('/api/auth/login', { body: { username: 'synthetic_alice', password: 'synthetic-password-123' } });
    const huawei = await migrated('/api/auth/huawei/login', { body: { code: 'synthetic-login' } });
    if (password.status !== 200 || huawei.status !== 200 || (await password.json()).user.id !== alice.identity || (await huawei.json()).user.id !== alice.identity) throw Error('synthetic account identity changed');
    return { ok: true, scenario, sourcePreserved: true, accounts: 2, sessionIsolation: true, huaweiBindingPreserved: true };
  } finally {
    session?.close(); source.close(); copy.close(); reference.close();
  }
}
