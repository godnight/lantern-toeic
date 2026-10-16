// The complete application auth/route stack runs against real Node crypto and
// SQLite. Only Cloudflare D1/R2 I/O and Next's ambient request header accessor
// are adapted. No identity, password verifier, route or authorization is mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'node_modules/typescript'));
const ORIGIN = 'https://study.test';
const PASSWORD = 'Synthetic only password 42!';
const COOKIE_NAME = '__Host-lantern-session';
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function environment(options = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) {
    if (options.withoutAuth && /^000[45]_/.test(file)) continue;
    sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'));
  }
  const queries = [], objects = new Map(), moduleCache = new Map();
  const storage = {puts: 0, gets: 0, deletes: 0};
  function prepared(sql, params = []) {
    function execute(method) {
      queries.push({sql, params: [...params], method});
      const stmt = sqlite.prepare(sql);
      if (method === 'first') return stmt.get(...params) || null;
      if (method === 'all') return {results: stmt.all(...params), success: true};
      if (method === 'raw') return stmt.all(...params).map(row => Object.values(row));
      const result = stmt.run(...params);
      return {meta: {changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid)}, success: true};
    }
    return {bind: (...values) => prepared(sql, values),
      first: async () => execute('first'), all: async () => execute('all'),
      raw: async () => execute('raw'), run: async () => execute('run'),
      _batch: () => execute('run')};
  }
  const d1 = {prepare: sql => prepared(sql), async batch(statements) {
    // D1 batch executes as one transaction; keep the adapter synchronous within
    // the transaction so Promise.all tests do not interleave its statements.
    sqlite.exec('BEGIN');
    try {const result = statements.map(statement => statement._batch()); sqlite.exec('COMMIT'); return result;}
    catch (error) {sqlite.exec('ROLLBACK'); throw error;}
  }};
  const bucket = {
    async put(key, body, options = {}) {
      storage.puts++;
      if (storage.beforePut) await storage.beforePut(key);
      const bytes = Buffer.from(await new Response(body).arrayBuffer());
      if (options.sha256) assert.equal(sha(bytes), options.sha256, 'R2 checksum adapter validates bytes');
      objects.set(key, {bytes, httpMetadata: options.httpMetadata});
      return {size: bytes.length};
    },
    async get(key) {storage.gets++;const object = objects.get(key);return object ? {size: object.bytes.length, body: new Response(object.bytes).body, httpMetadata: object.httpMetadata} : null;},
    async delete(key) {storage.deletes++;objects.delete(key);},
  };
  const env = {DB: d1, BUCKET: bucket, LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: ORIGIN, ...options.env};
  let ambientHeaders = new Headers();
  function load(file) {
    file = file.replaceAll('\\', '/');
    if (moduleCache.has(file)) return moduleCache.get(file);
    if (file.endsWith('.json')) {const value = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));moduleCache.set(file, value);return value;}
    const exports = {};moduleCache.set(file, exports);
    function resolve(name) {
      if (name === 'cloudflare:workers') return {env};
      if (name === 'next/headers') return {headers: async () => ambientHeaders};
      if (name.startsWith('node:')) return require(name);
      if (!name.startsWith('@/') && !name.startsWith('.')) return require(path.join(root, 'node_modules', name));
      let target = name.startsWith('@/') ? name.slice(2) : path.posix.join(path.posix.dirname(file), name);
      target = [target, target + '.ts', target + '/index.ts'].find(candidate => fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile());
      assert.ok(target, 'Resolve application import ' + name + ' from ' + file);
      return load(target);
    }
    // Test-only source override supports read-only frozen-commit negative
    // controls. The default always loads the real working-tree application.
    const source = options.sourceOverrides?.[file] ?? fs.readFileSync(path.join(root, file), 'utf8');
    const code = ts.transpileModule(source, {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true},
    }).outputText;
    vm.runInNewContext(code, {exports, require: resolve, Date, Intl, Map, Set, Error, SyntaxError, JSON,
      Promise, Buffer, structuredClone, TextEncoder, TextDecoder, Uint8Array, Uint32Array, ArrayBuffer,
      Blob, File, FormData, URL, Request, Response, Headers, ReadableStream, AbortController, atob, btoa,
      crypto: crypto.webcrypto}, {filename: file});
    return exports;
  }
  const routes = {
    register: load('app/api/auth/register/route.ts'), login: load('app/api/auth/login/route.ts'),
    logout: load('app/api/auth/logout/route.ts'), session: load('app/api/auth/session/route.ts'),
    study: load('app/api/study/route.ts'), vocabulary: load('app/api/vocabulary/route.ts'),
    recordings: load('app/api/recordings/route.ts'), library: load('app/api/exam-library/route.ts'),
  };
  function request(route, method = 'GET', {cookie, owner, body, headers = {}, query = ''} = {}) {
    const out = new Headers({origin: ORIGIN, ...headers});
    if (cookie) out.set('cookie', cookie);
    if (owner !== undefined) out.set('x-lantern-owner', owner);
    for (const [key, value] of Object.entries(headers)) if (value === undefined || value === null) out.delete(key);
    if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {out.set('content-type', 'application/json');body = JSON.stringify(body);}
    const api = route === 'library' ? 'exam-library' : ['register', 'login', 'logout', 'session'].includes(route) ? 'auth/' + route : route;
    return new Request(ORIGIN + '/api/' + api + query, {method, headers: out, ...(body === undefined ? {} : {body})});
  }
  const call = (route, method = 'GET', init) => routes[route][method](request(route, method, init));
  async function register(username = 'alice', password = PASSWORD, init = {}) {
    const response = await call('register', 'POST', {...init, body: {username, password}});
    assert.equal(response.status, 200, 'Synthetic test registration must succeed');
    return {cookie: response.headers.get('set-cookie').split(';')[0], ...(await response.json()).user, response};
  }
  function librarySample(id = 'synthetic-auth-exam') {
    const exam = require(path.join(root, 'tests/fixtures/synthetic-exam.cjs'))(id), body = JSON.stringify(exam);
    return {body, manifest: {examId: exam.id, version: exam.version, title: exam.title, bytes: Buffer.byteLength(body), sha256: sha(body)}};
  }
  function libraryInit(user, sample = librarySample(), extra = {}) {
    return {cookie: user.cookie, owner: user.id, body: sample.body, headers: {'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(sample.body)), 'x-exam-manifest': encodeURIComponent(JSON.stringify(sample.manifest)), ...extra}};
  }
  function recordingInit(user, id = crypto.randomUUID(), extra = {}) {
    const form = new FormData(), prompt = load('content/speaking.json')[0];
    form.set('meta', JSON.stringify({id, promptId: prompt.id, createdAt: new Date().toISOString(), duration: 1, userId: 'forged-body-owner', ...extra}));
    form.set('audio', new File(['synthetic audio only'], 'synthetic.webm', {type: 'audio/webm'}));
    return {cookie: user.cookie, owner: user.id, body: form};
  }
  return {sqlite, env, d1, objects, storage, queries, load, routes, request, call, register, librarySample, libraryInit, recordingInit,
    setAmbientHeaders(headers) {ambientHeaders = new Headers(headers);},
    rows(table) {assert.match(table, /^[a-z_]+$/);return plain(sqlite.prepare('SELECT * FROM ' + table).all());},
    close() {sqlite.close();}};
}
module.exports = {environment, ORIGIN, PASSWORD, COOKIE_NAME, plain, sha};
