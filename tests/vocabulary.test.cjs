const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const ts = require(root + '/node_modules/typescript');
const orm = require(root + '/node_modules/drizzle-orm');
const { SQLiteSyncDialect } = require(root + '/node_modules/drizzle-orm/sqlite-core');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

// Execute the actual repository modules; only platform I/O is replaced.
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require(name) {
    if(!Object.hasOwn(imports,name))return require('./helpers/actual-source-loader.cjs').createSourceLoader({root,imports,globals:globals}).resolve(name,file);
    return imports[name];
  }, Date, Intl, Map, Set, Error, JSON, structuredClone, Request, Response, Headers,
    AbortController, crypto: crypto.webcrypto, ...globals }, { filename: file });
  return exports;
}
const study = load('lib/study-model.ts');
test('the authored vocabulary has 240 unique complete entries in twelve balanced scenes',()=>{
 const rows=JSON.parse(fs.readFileSync(path.join(root,'content/vocabulary.json'),'utf8'));
 assert.equal(rows.length,240);assert.equal(new Set(rows.map(w=>w.id)).size,240);assert.equal(new Set(rows.map(w=>w.word.toLowerCase().trim())).size,240);
 const categories=new Map();for(const w of rows){for(const field of ['id','word','pos','meaning','category','example','translation','collocation'])assert.ok(typeof w[field]==='string'&&w[field].trim(),`${w.id}: ${field}`);assert.match(w.meaning,/[\u4e00-\u9fff]/);assert.match(w.translation,/[\u4e00-\u9fff]/);assert.ok(!Object.values(w).some(v=>String(v).includes('\ufffd')));categories.set(w.category,(categories.get(w.category)||0)+1);}
 assert.equal(categories.size,12);assert.ok([...categories.values()].every(n=>n===20));
});
const model = load('lib/vocabulary-model.ts', { './study-model': study });
const stamp = '2026-01-01T00:00:00.000Z';
const review = (overrides = {}) => ({ id: crypto.randomUUID(), wordId: 'schedule', createdAt: stamp, type: 'review', grade: 'remembered', ...overrides });
const mark = (overrides = {}) => ({ id: crypto.randomUUID(), wordId: 'schedule', createdAt: stamp, type: 'mark', starred: true, revision: 1, ...overrides });
const backup = events => ({ kind: 'lantern-vocabulary', schemaVersion: 1, events });
function storageFixture(initial = new Map()) {
  let failWrites = false;
  return { raw: initial, fail(value) { failWrites = value; },
    storage: { get length() { return initial.size; }, key(i) { return [...initial.keys()][i] ?? null; },
      getItem(key) { return initial.get(key) ?? null; },
      setItem(key, value) { if (failWrites) throw Error('QuotaExceededError'); initial.set(key, String(value)); },
    },
  };
}

test('vocabulary search preserves Chinese and combines normalized terms with scene filtering', () => {
  const words = [
    { id: 'schedule', word: 'Schedule', pos: 'n.', meaning: '日程安排', category: 'office', example: 'Confirm the meeting schedule.', translation: '确认会议日程。', collocation: 'meeting schedule' },
    { id: 'reservation', word: 'reservation', pos: 'n.', meaning: '预订', category: 'travel', example: 'Check the reservation.', translation: '检查预订。', collocation: 'make a reservation' },
  ];
  assert.deepEqual(Array.from(model.searchWords(words, 'ＳＣＨＥＤＵＬＥ 日程', 'office'), w => w.id), ['schedule']);
  assert.equal(model.searchWords(words, '日程', 'travel').length, 0);
  assert.equal(model.searchWords(words, 'not-present').length, 0);
});

test('event identity ignores property order and equivalent timestamp representations but rejects changed content', () => {
  const event = review({ id: 'same-id' });
  const reordered = { grade: event.grade, type: event.type, createdAt: '2026-01-01T08:00:00+08:00', wordId: event.wordId, id: event.id };
  assert.equal(model.mergeVocabularyEvents([event], [reordered]).length, 1);
  assert.throws(() => model.mergeVocabularyEvents([event], [{ ...event, grade: 'again' }]), /冲突/);
  const restored = model.parseVocabularyBackup(backup([event, reordered]));
  assert.equal(restored.events.length, 1);
  assert.deepEqual(plain(model.parseVocabularyBackup(restored)), plain(restored));
});

test('review order is chronological across ISO offsets and early repetitions cannot advance the interval', () => {
  const events = [review({ id: 'earlier', createdAt: '2026-01-01T12:00:00+08:00', grade: 'again' }), review({ id: 'later', createdAt: '2026-01-01T06:00:00.000Z' })];
  const state = model.vocabularyState(events, 'schedule');
  assert.equal(state.level, 1);
  assert.equal(state.due, Date.parse('2026-01-02T06:00:00.000Z'));
  const early = review({ id: 'early-repeat', createdAt: '2026-01-01T06:01:00.000Z' });
  assert.equal(model.vocabularyState([...events, early], 'schedule').due, state.due);
  assert.equal(model.vocabularyState([...events, early], 'schedule').level, 1);
  const onTime = review({ id: 'due-repeat', createdAt: '2026-01-02T06:00:00.000Z' });
  assert.equal(model.vocabularyState([...events, early, onTime], 'schedule').level, 2);
  assert.equal(model.vocabularyState([...events, early, onTime], 'schedule').due, Date.parse('2026-01-05T06:00:00.000Z'));
});

test('same-revision cancellation wins regardless of event order; a later revision can re-enable a word', () => {
  const first = mark({ id: 'first' }), removed = mark({ id: 'removed', starred: false });
  assert.equal(model.vocabularyState([first, removed], 'schedule').starred, false);
  assert.equal(model.vocabularyState([removed, first], 'schedule').starred, false);
  assert.equal(model.vocabularyState([removed, first, mark({ id: 'again', revision: 2 })], 'schedule').starred, true);
});

test('journals preserve independent writes, repeated restores and existing study bytes while isolating owners', () => {
  const original = JSON.stringify({ data: { schemaVersion: 2, attempts: [{ id: 'existing-answer' }] } });
  const f = storageFixture(new Map([['lantern-v1-alice', original]]));
  const a = model.vocabularyKey('alice'), b = model.vocabularyKey('alice:other'), device = model.vocabularyKey(null);
  const first = review({ id: 'one' }), second = mark({ id: 'two' });
  model.writeVocabulary(f.storage, a, [first]); model.writeVocabulary(f.storage, a, [second]);
  const size = f.raw.size;
  model.writeVocabulary(f.storage, a, [first, second]);
  assert.equal(f.raw.size, size);
  assert.equal(model.readVocabulary(f.storage, a).length, 2);
  assert.equal(model.readVocabulary(f.storage, b).length, 0);
  assert.equal(model.readVocabulary(f.storage, device).length, 0);
  assert.equal(f.raw.get('lantern-v1-alice'), original);
  assert.notEqual(device, model.vocabularyKey('device'));
  f.fail(true);
  assert.throws(() => model.writeVocabulary(f.storage, a, [review({ id: 'failed' })]), /Quota/);
  assert.equal(model.readVocabulary(f.storage, a).length, 2);
});

test('future or malformed vocabulary storage blocks writing without removing any original bytes', () => {
  for (const raw of ['{broken', JSON.stringify({ ...backup([]), schemaVersion: 2 })]) {
    const key = model.vocabularyKey(null), f = storageFixture(new Map([[key + 'retained', raw]]));
    assert.throws(() => model.writeVocabulary(f.storage, key, [review()]));
    assert.equal(f.raw.size, 1); assert.equal(f.raw.get(key + 'retained'), raw);
  }
});

test('word event IDs retain the existing getRandomValues fallback when randomUUID is unavailable', () => {
  const fallbackStudy = load('lib/study-model.ts', {}, { crypto: { getRandomValues: bytes => crypto.randomFillSync(bytes) } });
  const fallback = load('lib/vocabulary-model.ts', { './study-model': fallbackStudy }, { crypto: { getRandomValues: bytes => crypto.randomFillSync(bytes) } });
  const f = storageFixture();
  model.writeVocabulary(f.storage, model.vocabularyKey(null), [review({ id: 'seed' })]);
  assert.match(fallback.vocabularyId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  fallback.writeVocabulary(f.storage, model.vocabularyKey(null), [review({ id: 'fallback' })]);
  assert.equal(model.readVocabulary(f.storage, model.vocabularyKey(null)).length, 2);
});

function apiFixture() {
  const sqlite = new DatabaseSync(':memory:'), dialect = new SQLiteSyncDialect(), queries = [];
  const migration = fs.readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).map(name => fs.readFileSync(path.join(root, 'drizzle', name), 'utf8')).find(text => /CREATE TABLE [`"]?vocabulary_events/.test(text));
  assert.ok(migration, 'Use the actual additive vocabulary migration'); sqlite.exec(migration);
  let owner = 'alice';
  const db = { async run(statement) { const q = dialect.sqlToQuery(statement); queries.push(q); return sqlite.prepare(q.sql).run(...q.params); }, async all(statement) { const q = dialect.sqlToQuery(statement); queries.push(q); return sqlite.prepare(q.sql).all(...q.params); } };
  const api = load('app/api/vocabulary/route.ts', {
    '@/db': { getDb: () => db }, 'drizzle-orm': orm, '@/lib/vocabulary-model': model,
    '@/lib/request-body':load('lib/request-body.ts'),'@/lib/server-auth': { userId: async () => owner, safeMutation: req => req.headers.get('origin') === 'https://test.local', privateJson: (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } }) },
  });
  const post = (events, expectedOwner = owner, origin = 'https://test.local') => api.POST(new Request('https://test.local/api/vocabulary', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-lantern-owner': expectedOwner ?? '' }, body: JSON.stringify(backup(events)) }));
  return { api, post, queries, sqlite, setOwner(value) { owner = value; } };
}

test('vocabulary API checks login, current owner and origin before accessing the database', async () => {
  const h = apiFixture();
  try {
    h.setOwner(null); assert.equal((await h.api.GET()).status, 401); assert.equal((await h.post([review()])).status, 401);
    h.setOwner('alice'); assert.equal((await h.post([review()], 'bob')).status, 409);
    assert.equal((await h.post([review()], 'alice', 'https://other.local')).status, 403);
    assert.equal(h.queries.length, 0);
  } finally { h.sqlite.close(); }
});

test('real vocabulary SQL batches are idempotent, account scoped and reject conflicting event content', async () => {
  const h = apiFixture();
  try {
    const events = Array.from({ length: 25 }, (_, i) => review({ id: 'batch-' + i }));
    assert.equal((await h.post(events)).status, 200);
    assert.equal(h.queries.length, 2, 'One INSERT and one conflict-check SELECT for the whole batch');
    assert.ok(h.queries.every(q => q.params.length <= 100));
    const reordered = events.map(e => ({ grade: e.grade, createdAt: e.createdAt, type: e.type, wordId: e.wordId, id: e.id }));
    assert.equal((await h.post(reordered)).status, 200);
    const response = await h.api.GET(); assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal((await response.json()).events.length, 25);
    assert.equal((await h.post([{ ...events[0], grade: 'again' }])).status, 409);
    assert.equal((await (await h.api.GET()).json()).events.find(e => e.id === events[0].id).grade, 'remembered');
    h.setOwner('bob'); assert.equal((await (await h.api.GET()).json()).events.length, 0);
    assert.equal((await h.post([{ ...events[0], grade: 'again' }])).status, 200);
    assert.equal((await (await h.api.GET()).json()).events[0].grade, 'again');
    h.setOwner('alice'); assert.equal((await (await h.api.GET()).json()).events.length, 25);
    const before = h.queries.length;
    assert.equal((await h.post([...events, review({ id: 'over-batch-limit' })])).status, 400);
    assert.equal(h.queries.length, before);
  } finally { h.sqlite.close(); }
});

function hookFixture({ owner: initialOwner = 'alice', storage = storageFixture(), handle } = {}) {
  let owner = initialOwner, cursor = 0, dirty = true, mounted = true, latest;
  const slots = [], effects = [], requests = [], timers = new Map(), listeners = new Map(), notices = [];
  let timerId = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; dirty = true; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const addTimer = (fn, ms, repeat) => { const id = ++timerId; timers.set(id, { fn, ms, repeat }); return id; };
  const browser = {
    localStorage: storage.storage,
    window: { addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); } },
    setTimeout: (fn, ms) => addTimer(fn, ms, false), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => addTimer(fn, ms, true), clearInterval: id => timers.delete(id),
    fetch: async (url, init = {}) => {
      const request = { url, init, owner, body: init.body ? JSON.parse(init.body) : undefined }; requests.push(request);
      const special = handle ? await handle(request) : undefined; if (special) return special;
      return init.method === 'POST' ? Response.json({ ok: true }) : Response.json({ owner, ...backup([]) });
    },
  };
  const hook = load('lib/use-vocabulary.ts', { react, sonner: { toast: { error: text => notices.push(text) } }, './vocabulary-model': model }, browser);
  function render(nextOwner = owner) { assert.ok(mounted); owner = nextOwner; cursor = 0; dirty = false; latest = hook.useVocabulary(owner); while (effects.length) effects.shift()(); return latest; }
  async function settle() { for (let i = 0; i < 30; i++) { if (dirty) render(); await tick(); if (!dirty) return latest; } throw Error('Hook state did not settle'); }
  function fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { if (!timer.repeat) timers.delete(id); timer.fn(); } }
  function unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); }
  return { render, settle, fire, unmount, requests, timers, storage, notices, get current() { return latest; } };
}

function untilAborted(signal) {
  return new Promise((_, reject) => { const stop = () => { const error = Error('aborted'); error.name = 'AbortError'; reject(error); }; if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); });
}

test('native vocabulary writes stay local and a failed disk write cannot produce a completed review', async () => {
  const h = hookFixture({ owner: null }); h.render(); await h.settle();
  assert.equal(h.current.mark('schedule', true), true); await h.settle();
  h.storage.fail(true);
  assert.equal(h.current.review('schedule', 'remembered', 'write-failed'), false);
  assert.equal(h.current.events.filter(e => e.type === 'review').length, 0);
  assert.equal(h.requests.length, 0);
  assert.ok(h.notices.length); h.unmount();
});

for (const stage of ['fetch', 'body']) test(`a hung vocabulary ${stage} is aborted and the next timer can sync`, async () => {
  let first = true;
  const h = hookFixture({ handle: request => {
    if (!first) return; first = false;
    return stage === 'fetch' ? untilAborted(request.init.signal) : { ok: true, json: () => untilAborted(request.init.signal) };
  } });
  h.render(); await h.settle(); assert.equal(h.requests.length, 1);
  h.fire(25000); await h.settle(); assert.equal(h.requests[0].init.signal.aborted, true);
  assert.match(h.current.sync, /等待同步|重试/);
  h.fire(60000); await h.settle();
  assert.equal(h.requests.length, 2); assert.match(h.current.sync, /已同步/); h.unmount();
});

for (const status of [401, 409]) test(`HTTP ${status} remains blocked across local study changes until manual retry`, async () => {
  let blocked = true;
  const h = hookFixture({ handle: () => blocked ? Response.json({ error: 'blocked' }, { status }) : undefined });
  h.render(); await h.settle(); const firstCount = h.requests.length;
  assert.equal(h.current.mark('schedule', true), true); await h.settle();
  h.fire(60000); await h.settle(); assert.equal(h.requests.length, firstCount);
  blocked = false; h.current.retry(); await h.settle();
  assert.ok(h.requests.length > firstCount); assert.match(h.current.sync, /已同步/); h.unmount();
});

test('temporary failures stop after three attempts even if another card is saved', async () => {
  const h = hookFixture({ handle: () => Response.json({}, { status: 503 }) }); h.render(); await h.settle();
  h.fire(60000); await h.settle(); h.fire(60000); await h.settle();
  assert.equal(h.requests.length, 3);
  h.current.mark('schedule', true); await h.settle(); h.fire(60000); await h.settle();
  assert.equal(h.requests.length, 3); assert.match(h.current.sync, /手动重试/); h.unmount();
});

test('switching owners blocks old callbacks and excludes the previous account pending events', async () => {
  const h = hookFixture(); h.render(); await h.settle();
  h.current.mark('alice-only-word', true); await h.settle(); const old = h.current;
  h.render('bob'); await h.settle();
  assert.equal(h.current.events.length, 0);
  assert.equal(old.restore(backup([review({ id: 'late-alice' })])), false);
  assert.throws(() => old.backup(), /账号/);
  for (const req of h.requests.filter(r => r.owner === 'bob' && r.body)) assert.equal(req.body.events.some(e => e.wordId === 'alice-only-word'), false);
  assert.equal(model.readVocabulary(h.storage.storage, model.vocabularyKey('bob')).length, 0); h.unmount();
});

test('unmounted vocabulary imports and delayed cloud responses cannot write or expose a departed account', async () => {
  let resolveResponse;
  const h = hookFixture({ handle: () => new Promise(resolve => { resolveResponse = resolve; }) }); h.render(); await h.settle();
  const old = h.current, before = new Map(h.storage.raw); h.unmount();
  assert.equal(old.restore(backup([review({ id: 'late-import' })])), false);
  assert.throws(() => old.backup(), /账号/);
  resolveResponse(Response.json({ owner: 'alice', ...backup([review({ id: 'late-cloud' })]) })); await tick(); await tick();
  assert.deepEqual([...h.storage.raw], [...before]);
  assert.equal(h.timers.size, 0);
});

test('restored pending records are uploaded in batches no larger than the API contract', async () => {
  const storage = storageFixture(), events = Array.from({ length: 51 }, (_, i) => review({ id: 'restore-' + i }));
  model.writeVocabulary(storage.storage, model.vocabularyKey('alice'), events);
  const remote = new Map();
  const h = hookFixture({ storage, handle: request => {
    if (!request.body) return Response.json({ owner: 'alice', ...backup([...remote.values()]) });
    assert.ok(request.body.events.length <= 25);
    for (const event of request.body.events) remote.set(event.id, event);
    return Response.json({ ok: true });
  } });
  h.render(); await h.settle();
  assert.deepEqual(h.requests.filter(r => r.body).map(r => r.body.events.length), [25, 25, 1]);
  assert.equal(remote.size, 51); assert.equal(h.current.events.length, 51); assert.match(h.current.sync, /已同步/);
  h.unmount();
});

test('new local study during an uncertain POST survives cancellation and resumes without duplicate events', async () => {
  const remote = new Map(); let stall = true;
  const h = hookFixture({ handle: request => {
    if (!request.body) return Response.json({ owner: 'alice', ...backup([...remote.values()]) });
    for (const event of request.body.events) remote.set(event.id, event);
    if (stall) { stall = false; return untilAborted(request.init.signal); }
    return Response.json({ ok: true });
  } });
  h.render(); await h.settle();
  assert.equal(h.current.mark('schedule', true), true); await h.settle();
  const firstPost = h.requests.find(r => r.body);
  assert.ok(firstPost); assert.equal(remote.size, 1);
  assert.equal(h.current.mark('reservation', true), true); await h.settle();
  assert.equal(firstPost.init.signal.aborted, true);
  assert.equal(remote.size, 2); assert.equal(h.current.events.length, 2);
  assert.equal(model.vocabularyState(h.current.events, 'schedule').starred, true);
  assert.equal(model.vocabularyState(h.current.events, 'reservation').starred, true);
  assert.match(h.current.sync, /已同步/); h.unmount();
});
