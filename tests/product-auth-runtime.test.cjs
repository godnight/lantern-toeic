const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { scrypt } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const { buildSync } = require(path.join(root, 'node_modules/esbuild'));
const { Miniflare, Log, LogLevel } = require(path.join(root, 'node_modules/miniflare'));
const origin = 'https://study.test';
const password = 'Synthetic runtime learner phrase 2026!';
const hashPattern = /^\$lantern\$scrypt\$v=1\$n=16384,r=8,p=5,k=64\$[0-9a-f]{32}\$[0-9a-f]{128}$/;

// This bundle exists only inside this test. No test routes, lower-cost KDF,
// fixed credentials, network providers or development identities enter the app.
const workerSource = `
import { credentialAction, sessionAction } from './lib/auth-service';
import { hashPassword, verifyPassword } from './lib/password-credential';
export default {
  async fetch(request, env) {
    const route = new URL(request.url).pathname;
    if (route === '/register') return credentialAction(request, 'register', env);
    if (route === '/login') return credentialAction(request, 'login', env);
    if (route === '/logout') return sessionAction(request, 'logout', env);
    if (route === '/session') return sessionAction(request, 'read', env);
    if (route === '/test-only-kdf-concurrent') {
      const password = await request.text();
      // Launch all three calls in the same Worker turn/module. Do not rely on
      // separate HTTP fetches being scheduled concurrently by local workerd.
      const attempt = async () => {
        try {
          await hashPassword(password);
          return { status: 'fulfilled' };
        } catch (error) {
          return { status: 'rejected', name: error.name };
        }
      };
      const outcomes = await Promise.all([attempt(), attempt(), attempt()]);
      const afterCompletion = await attempt();
      // No hash, salt, password, stack or arbitrary error message leaves this
      // test branch; only statuses and error names support the concurrency check.
      return Response.json({ outcomes, afterCompletion });
    }
    if (route === '/test-only-kdf') {
      try {
        const password = await request.text();
        const start = Date.now();
        const hash = await hashPassword(password);
        const correct = await verifyPassword(password, hash);
        const wrong = await verifyPassword(password + 'x', hash);
        return Response.json({ hash, correct, wrong, elapsedMs: Date.now() - start });
      } catch (error) {
        return Response.json({ name: error.name, message: error.message }, { status: 500 });
      }
    }
    return new Response('not found', { status: 404 });
  }
};`;

function sessionCookie(response) {
  const value = response.headers.get('set-cookie');
  assert.match(value || '', /^__Host-lantern-session=[0-9a-f]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
  return value.split(';')[0];
}

test('locked workerd runtime executes production-cost scrypt and real D1 auth lifecycle', { timeout: 120000 }, async (t) => {
  const result = buildSync({
    stdin: { contents: workerSource, resolveDir: root, sourcefile: 'product-auth-runtime-worker.ts', loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    external: ['node:*'],
  });
  const mf = new Miniflare({
    name: 'lantern-auth-runtime-test',
    modules: true,
    script: result.outputFiles[0].text,
    compatibilityDate: '2026-05-15',
    compatibilityFlags: ['nodejs_compat'],
    cf: false, // Never fetch external metadata in this local-only runtime test.
    host: '127.0.0.1',
    port: 0,
    d1Databases: { DB: 'lantern-auth-runtime-test-only' },
    d1Persist: false,
    cachePersist: false,
    kvPersist: false,
    r2Persist: false,
    durableObjectsPersist: false,
    bindings: { LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin },
    outboundService: () => new Response('External network disabled in auth runtime test', { status: 502 }),
    log: new Log(LogLevel.ERROR),
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const migrations = fs.readdirSync(path.join(root, 'drizzle')).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of migrations) {
    const sql = fs.readFileSync(path.join(root, 'drizzle', name), 'utf8');
    const statements = sql.split('--> statement-breakpoint').map((statement) => statement.trim()).filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
  }
  t.diagnostic(`Miniflare ${require(path.join(root, 'node_modules/miniflare/package.json')).version}; workerd ${require(path.join(root, 'node_modules/workerd/package.json')).version}; migrations: ${migrations.join(', ')}`);

  const dispatch = (route, body, cookie) => mf.dispatchFetch(origin + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const cryptoStart = performance.now();
  const cryptoResponse = await mf.dispatchFetch(origin + '/test-only-kdf', { method: 'POST', body: password });
  const cryptoResult = await cryptoResponse.json();
  const cryptoWallMs = Math.round(performance.now() - cryptoStart);
  assert.equal(cryptoResponse.status, 200, `Worker crypto failed: ${JSON.stringify(cryptoResult)}`);
  assert.match(cryptoResult.hash, hashPattern);
  assert.equal(cryptoResult.correct, true);
  assert.equal(cryptoResult.wrong, false);
  const parts = cryptoResult.hash.split('$');
  const crossRuntimeKey = await promisify(scrypt)(password, Buffer.from(parts[5], 'hex'), 64,
    { N: 16384, r: 8, p: 5, maxmem: 64 * 1024 * 1024 });
  assert.equal(crossRuntimeKey.toString('hex'), parts[6], 'workerd hash matches native Node crypto with the exact production cost');
  t.diagnostic(`Worker hash + two verifications: ${cryptoWallMs} ms wall time; Worker Date.now delta ${cryptoResult.elapsedMs} ms (Workers clock may be frozen during CPU work)`);

  const concurrentStart = performance.now();
  const concurrentResponse = await mf.dispatchFetch(origin + '/test-only-kdf-concurrent', { method: 'POST', body: password });
  const concurrentResult = await concurrentResponse.json();
  assert.equal(concurrentResponse.status, 200);
  assert.deepEqual(concurrentResult.outcomes, [
    { status: 'fulfilled' },
    { status: 'rejected', name: 'PasswordHashBusyError' },
    { status: 'rejected', name: 'PasswordHashBusyError' },
  ], 'one same-module KDF runs; concurrent calls fail immediately instead of queuing');
  assert.deepEqual(concurrentResult.afterCompletion, { status: 'fulfilled' }, 'the KDF slot is reusable after completion');
  t.diagnostic(`Same-turn Promise.all of three production-cost KDF calls: 1 fulfilled, 2 busy; next hash fulfilled; ${Math.round(performance.now() - concurrentStart)} ms wall time including recovery hash`);
  t.diagnostic('Memory evidence: theoretical scrypt workspace 128*N*r = 16 MiB; maxmem = 64 MiB is the per-call option, neither is an isolate/process peak measurement. CPU billing = NOT_RUN; process/isolate peak memory = NOT_RUN; cross-request parallel scheduling = NOT_RUN.');

  assert.equal((await dispatch('/session')).status, 401);
  const registrationStart = performance.now();
  const registerResponse = await dispatch('/register', { username: ' Runtime_Learner ', password });
  const registered = await registerResponse.json();
  assert.equal(registerResponse.status, 200, JSON.stringify(registered));
  assert.match(registered.user.id, /^usr_[0-9a-f-]{36}$/);
  assert.equal(registered.user.username, 'runtime_learner');
  assert.deepEqual(registered.capabilities, { passwordLogin: true, phoneLogin: false, passwordRecovery: false });
  const registeredCookie = sessionCookie(registerResponse);
  t.diagnostic(`Worker registration (real strong hash + D1 transaction): ${Math.round(performance.now() - registrationStart)} ms`);
  assert.equal((await (await dispatch('/session', undefined, registeredCookie)).json()).user.id, registered.user.id);
  const v2=await mf.dispatchFetch(origin+'/session',{headers:{Cookie:registeredCookie,'X-Lantern-Session-Proof':'2'}});
  const proof=await v2.json();assert.equal(v2.status,200);assert.equal(proof.user.id,registered.user.id);assert.equal(proof.session.version,2);assert(Number.isSafeInteger(proof.session.remainingMs)&&proof.session.remainingMs>0&&proof.session.remainingMs<=43200000);assert.equal(v2.headers.get('set-cookie'),null);

  const credential = await db.prepare('SELECT password_hash FROM auth_password_credentials WHERE user_id=?').bind(registered.user.id).first();
  assert.match(credential.password_hash, hashPattern);
  assert.equal(credential.password_hash.includes(password), false);
  assert.notEqual(credential.password_hash, cryptoResult.hash, 'fresh registration has an independent random salt');
  const storedSession = await db.prepare('SELECT token_hash FROM auth_sessions WHERE user_id=?').bind(registered.user.id).first();
  assert.match(storedSession.token_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(storedSession.token_hash, registeredCookie.split('=')[1], 'D1 stores a token digest rather than the bearer token');

  const wrongResponse = await dispatch('/login', { username: 'runtime_learner', password: password + 'wrong' });
  const unknownResponse = await dispatch('/login', { username: 'unknown_runtime_learner', password });
  assert.equal(wrongResponse.status, 401);
  assert.equal(unknownResponse.status, 401);
  assert.deepEqual(await wrongResponse.json(), await unknownResponse.json(), 'existing and unknown users expose the same login failure');

  const loginStart = performance.now();
  const loginResponse = await dispatch('/login', { username: 'RUNTIME_LEARNER', password }, registeredCookie);
  assert.equal(loginResponse.status, 200, await loginResponse.clone().text());
  assert.equal((await loginResponse.json()).user.id, registered.user.id);
  const loggedInCookie = sessionCookie(loginResponse);
  assert.notEqual(loggedInCookie, registeredCookie);
  assert.equal((await dispatch('/session', undefined, registeredCookie)).status, 401, 'login rotates and revokes the prior session');
  assert.equal((await dispatch('/session', undefined, loggedInCookie)).status, 200);
  t.diagnostic(`Worker login (real strong verify + session rotation): ${Math.round(performance.now() - loginStart)} ms`);

  const logoutResponse = await dispatch('/logout', {}, loggedInCookie);
  assert.equal(logoutResponse.status, 200);
  assert.match(logoutResponse.headers.get('set-cookie'), /Max-Age=0$/);
  assert.equal((await dispatch('/session', undefined, loggedInCookie)).status, 401, 'logout invalidates the server-side session');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM auth_sessions').first()).count, 0);

  // Only this ephemeral test D1 is reset. Existing synthetic account/credential
  // rows stay in place; no app mock, KDF replacement or credential capture is used.
  const windowMs = 15 * 60 * 1000;
  const seedGlobalBudget = async (count) => {
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    await db.batch([
      db.prepare('DELETE FROM auth_rate_limits'),
      db.prepare("INSERT INTO auth_rate_limits(scope,window_start,count,admission_id) VALUES('global:credentials',?,?,'')").bind(windowStart, count),
    ]);
    return windowStart;
  };
  const unknownLogin = async (username) => {
    const response = await dispatch('/login', { username, password });
    const { code } = await response.json();
    return { status: response.status, code };
  };

  const saturatedWindow = await seedGlobalBudget(100);
  const saturatedStart = performance.now();
  const saturatedResults = await Promise.all(Array.from({ length: 1000 }, (_, index) => unknownLogin(`saturated_${index}`)));
  for (const outcome of saturatedResults) {
    assert.deepEqual(outcome, { status: 429, code: 'too-many-attempts' }, 'global denial occurs before the real KDF; auth-busy is not admission denial');
  }
  assert.equal(Math.floor(Date.now() / windowMs) * windowMs, saturatedWindow, 'runtime test must not straddle an admission window boundary');
  const saturatedRows = (await db.prepare('SELECT scope,count FROM auth_rate_limits WHERE window_start=? ORDER BY scope').bind(saturatedWindow).all()).results;
  assert.deepEqual(saturatedRows, [{ scope: 'global:credentials', count: 100 }], '1000 denied distinct valid usernames allocate zero username rows and never increment the saturated global bucket');
  t.diagnostic(`Real workerd + D1 saturated admission: 1000 distinct valid unknown usernames, 1000 too-many-attempts, 0 auth-busy, 0 username rows; global count stays 100; ${Math.round(performance.now() - saturatedStart)} ms wall time`);

  const lastSlotWindow = await seedGlobalBudget(99);
  const lastSlotStart = performance.now();
  const lastSlotResults = await Promise.all(Array.from({ length: 100 }, (_, index) => unknownLogin(`last_slot_${index}`)));
  assert.equal(lastSlotResults.filter(({ status, code }) => status === 401 && code === 'invalid-credentials').length, 1, 'exactly one request receives the last slot and completes real unknown-user KDF verification');
  assert.equal(lastSlotResults.filter(({ status, code }) => status === 429 && code === 'too-many-attempts').length, 99, 'all other cross-request competitors are rejected by shared D1 admission');
  assert.equal(lastSlotResults.filter(({ code }) => code === 'auth-busy').length, 0, 'KDF busy responses cannot stand in for atomic admission evidence');
  assert.equal(Math.floor(Date.now() / windowMs) * windowMs, lastSlotWindow, 'runtime test must not straddle an admission window boundary');
  const lastSlotRows = (await db.prepare('SELECT scope,count FROM auth_rate_limits WHERE window_start=? ORDER BY scope').bind(lastSlotWindow).all()).results;
  assert.equal(lastSlotRows.length, 2, 'only the admitted request allocates a username row');
  assert.deepEqual(lastSlotRows[0], { scope: 'global:credentials', count: 100 });
  assert.match(lastSlotRows[1].scope, /^login:username:[0-9a-f]{64}$/);
  assert.equal(lastSlotRows[1].count, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM auth_users').first()).count, 1, 'unknown logins create no account');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM auth_password_credentials').first()).count, 1, 'unknown logins create no credential');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM auth_sessions').first()).count, 0, 'unknown logins create no session');
  t.diagnostic(`Real workerd cross-request last-slot race: 100 requests, 1 invalid-credentials after real KDF, 99 too-many-attempts, 0 auth-busy; exactly 1 username row and global count 100; ${Math.round(performance.now() - lastSlotStart)} ms wall time. This is D1 admission evidence, not CPU/isolate parallelism or load-capacity evidence.`);
});
