'use strict';
// Runs the actual Worker proxy source with explicit network seams. These tests
// do not substitute for the release's anonymous live upstream and deployed probes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const actualManifest = JSON.parse(fs.readFileSync(path.join(root, 'worker/natural-media-manifest.json'), 'utf8'));
function load(file, imports) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const exports = {};
  vm.runInNewContext(result.outputText, { exports, require(name) { assert(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name); return imports[name]; },
    Request, Response, Headers, URL, AbortController, Uint8Array, crypto: webcrypto, setTimeout, clearTimeout,
    fetch() { throw new Error('Uninjected network'); } }, { filename: file });
  return exports;
}
const proxy = load('worker/natural-media-proxy.ts', { './natural-media-manifest.json': actualManifest });
const bytes = Buffer.from('a small exact public audio sample');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const mediaPath = '/audio/natural/test-pack/' + sha256 + '.mp3';
const jsonPath = '/audio/natural/test-pack/manifest.json';
function manifest(entries = [{ path: mediaPath, bytes: bytes.length, sha256, contentType: 'audio/mpeg' }]) {
  return { schemaVersion: 1, upstreamCommit: proxy.NATURAL_MEDIA_UPSTREAM_COMMIT, upstreamBase: proxy.NATURAL_MEDIA_UPSTREAM_BASE, entries };
}
function fixture(options = {}) {
  const calls = [];
  const handle = proxy.createNaturalMediaHandler(options.manifest || manifest(), async request => {
    calls.push(request);
    if (options.fetch) return options.fetch(request);
    return new Response(request.method === 'HEAD' ? null : bytes, { status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(bytes.length) } });
  }, options.timeoutMs || 20000);
  return { calls, handle };
}
function request(pathname = mediaPath, init) { return new Request('https://private.example' + pathname, init); }

test('actual sealed manifest contains every 12,556 natural file and fixed public commit', () => {
  assert.equal(actualManifest.schemaVersion, 1);
  assert.equal(actualManifest.upstreamCommit, 'ea3b729174763ac5a63e86bcb729a5ff865e3cbb');
  assert.equal(actualManifest.upstreamBase, 'https://raw.githubusercontent.com/godnight/lantern-toeic/ea3b729174763ac5a63e86bcb729a5ff865e3cbb/public');
  assert.equal(actualManifest.entries.length, 12556);
  assert.equal(new Set(actualManifest.entries.map(row => row.path)).size, 12556);
  assert.equal(actualManifest.entries.filter(row => row.contentType === 'audio/mpeg').length, 12510);
  assert.equal(actualManifest.entries.filter(row => row.contentType === 'application/json').length, 46);
  for (const row of actualManifest.entries) {
    assert(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 16 * 1024 * 1024);
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    if (row.path.endsWith('.mp3')) assert.equal(path.posix.basename(row.path, '.mp3'), row.sha256);
  }
  assert.equal(Math.max(...actualManifest.entries.map(row => row.bytes)), 10155401);
  assert.equal(typeof proxy.handleNaturalMediaRequest, 'function');
});

test('full GET returns exact validated bytes and immutable same-origin media headers', async () => {
  const f = fixture(), response = await f.handle(request());
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('content-length'), String(bytes.length));
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('etag'), '"sha256-' + sha256 + '"');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(f.calls[0].url, proxy.NATURAL_MEDIA_UPSTREAM_BASE + mediaPath);
});

test('upstream receives only fixed headers, method and URL; visitor credentials and query never leave', async () => {
  const f = fixture();
  const response = await f.handle(request(mediaPath + '?upstream=https://evil.example/secret', { headers: {
    Cookie: 'owner=secret', Authorization: 'Bearer secret', Origin: 'https://private.example',
    'X-Visitor-Id': 'secret-visitor', 'X-Forwarded-For': 'secret', Range: 'bytes=1-3', 'If-Range': '"sha256-' + sha256 + '"',
  } }));
  assert.equal(response.status, 206);
  assert.equal(f.calls[0].url, proxy.NATURAL_MEDIA_UPSTREAM_BASE + mediaPath);
  assert.equal(f.calls[0].redirect, 'manual');
  assert.equal(f.calls[0].method, 'GET');
  assert.deepEqual([...f.calls[0].headers], [['accept', 'audio/mpeg'], ['accept-encoding', 'identity']]);
});

test('HEAD uses upstream HEAD and returns no body with verified length', async () => {
  const f = fixture(), response = await f.handle(request(mediaPath, { method: 'HEAD' }));
  assert.equal(f.calls[0].method, 'HEAD');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), String(bytes.length));
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

for (const [value, start, end] of [['bytes=2-5', 2, 5], ['bytes=3-', 3, bytes.length - 1],
  ['bytes=-4', bytes.length - 4, bytes.length - 1], ['bytes=0-999', 0, bytes.length - 1], ['bytes=-999', 0, bytes.length - 1]]) {
  test('single range ' + value + ' returns exact 206 slice after whole-file verification', async () => {
    const f = fixture(), response = await f.handle(request(mediaPath, { headers: { Range: value } }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`);
    assert.equal(response.headers.get('content-length'), String(end - start + 1));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1));
    assert.equal(f.calls[0].headers.has('range'), false);
  });
}

test('HEAD range returns 206 metadata without fetching a body', async () => {
  const f = fixture(), response = await f.handle(request(mediaPath, { method: 'HEAD', headers: { Range: 'bytes=1-3' } }));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes 1-3/${bytes.length}`);
  assert.equal(response.headers.get('content-length'), '3');
  assert.equal((await response.arrayBuffer()).byteLength, 0);
  assert.equal(f.calls[0].method, 'HEAD');
});

test('mismatched If-Range requests the complete current representation', async () => {
  const f = fixture(), response = await f.handle(request(mediaPath, { headers: { Range: 'bytes=1-3', 'If-Range': '"old"' } }));
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

for (const range of ['bytes=', 'bytes=-', 'bytes=-0', 'bytes=5-2', 'bytes=999-', 'bytes=1-2,4-5', 'items=0-2', 'bytes=1.5-2', 'bytes=9007199254740992-', 'bytes=0-9007199254740992']) {
  test('invalid or unsatisfiable range rejects before network: ' + range, async () => {
    const f = fixture(), response = await f.handle(request(mediaPath, { headers: { Range: range } }));
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), `bytes */${bytes.length}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(f.calls.length, 0);
  });
}

test('JSON text/plain from raw host is hashed and served as application/json', async () => {
  const f = fixture({ manifest: manifest([{ path: jsonPath, bytes: bytes.length, sha256, contentType: 'application/json' }]),
    fetch: async () => new Response(bytes, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': String(bytes.length) } }) });
  const response = await f.handle(request(jsonPath));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

for (const [label, change] of [
  ['HTML fallback', { type: 'text/html' }], ['wrong MP3 MIME', { type: 'application/octet-stream' }],
  ['wrong header length', { length: String(bytes.length + 1) }], ['missing header length', { length: null }],
  ['non-numeric length', { length: '1e2' }], ['compressed upstream', { encoding: 'gzip' }],
  ['truncated body', { body: bytes.subarray(0, -1) }], ['overlong body', { body: Buffer.concat([bytes, Buffer.from('x')]) }],
  ['same-length SHA mismatch', { body: Buffer.alloc(bytes.length, 0) }],
  ['redirect', { status: 302 }], ['partial upstream', { status: 206 }], ['HTTP failure', { status: 503 }],
]) {
  test('upstream ' + label + ' fails closed with no HTML fallback', async () => {
    const f = fixture({ fetch: async () => {
      const headers = { 'Content-Type': change.type || 'audio/mpeg', 'Content-Length': change.length === undefined ? String(bytes.length) : change.length };
      if (change.length === null) delete headers['Content-Length'];
      if (change.encoding) headers['Content-Encoding'] = change.encoding;
      return new Response(change.body || bytes, { status: change.status || 200, headers });
    } });
    const response = await f.handle(request());
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(await response.text(), 'Media upstream unavailable');
    assert.equal(f.calls[0].signal.aborted, true);
  });
}

test('range cannot bypass a whole-file SHA mismatch', async () => {
  const wrong = Buffer.from(bytes); wrong[wrong.length - 1] ^= 1;
  const f = fixture({ fetch: async () => new Response(wrong, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(bytes.length) } }) });
  assert.equal((await f.handle(request(mediaPath, { headers: { Range: 'bytes=0-2' } }))).status, 502);
});

test('HEAD validates MIME and length and gives bodyless errors', async () => {
  const f = fixture({ fetch: async () => new Response(null, { headers: { 'Content-Type': 'text/html', 'Content-Length': String(bytes.length) } }) });
  const response = await f.handle(request(mediaPath, { method: 'HEAD' }));
  assert.equal(response.status, 502);
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test('network rejection and timeouts fail closed and abort the public request', async () => {
  for (const fail of ['reject', 'timeout']) {
    const f = fixture({ timeoutMs: 5, fetch: async () => fail === 'reject' ? Promise.reject(new Error('private network detail')) : new Promise(() => {}) });
    const response = await f.handle(request());
    assert.equal(response.status, 502);
    assert.equal(f.calls[0].signal.aborted, true);
    assert.equal(await response.text(), 'Media upstream unavailable');
  }
});

test('unknown, encoded and URL-like media paths never reach upstream', async () => {
  const f = fixture();
  for (const pathname of ['/audio/natural', '/audio/natural/', '/audio/natural/missing.mp3', '/audio/natural/https://evil.example/file',
    '/audio/natural/test-pack/%2fetc.json', '/audio/natural/test-pack/manifest.json?url=https://evil.example']) {
    const response = await f.handle(request(pathname));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(f.calls.length, 0);
});

test('non-media and API routes return null for the original Worker handler', async () => {
  const f = fixture();
  for (const pathname of ['/', '/api/recordings', '/api/account', '/listening200-r1/image.png', '/audio/naturally/file.mp3']) {
    assert.equal(await f.handle(request(pathname)), null);
  }
  assert.equal(f.calls.length, 0);
});

test('non-read methods cannot proxy or mutate public assets', async () => {
  const f = fixture();
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await f.handle(request(mediaPath, { method }));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(f.calls.length, 0);
});

test('manifest cannot introduce arbitrary upstream URLs, files, duplicate entries or over-limit allocations', () => {
  const mutations = [m => { m.schemaVersion = 2; }, m => { m.upstreamBase = 'https://evil.example'; },
    m => { m.upstreamCommit = 'main'; }, m => { m.entries.push({ ...m.entries[0] }); },
    m => { m.entries[0].path = '/api/private'; }, m => { m.entries[0].bytes = 16 * 1024 * 1024 + 1; },
    m => { m.entries[0].bytes = 0; }, m => { m.entries[0].sha256 = 'bad'; }, m => { m.entries[0].contentType = 'text/html'; }];
  for (const mutate of mutations) { const m = manifest(); mutate(m); assert.throws(() => fixture({ manifest: m }), /Invalid/); }
});

test('factory snapshots admitted entries so later mutation cannot change upstream or integrity checks', async () => {
  const m = manifest(), f = fixture({ manifest: m });
  m.entries[0].sha256 = '0'.repeat(64); m.entries[0].path = '/api/private'; m.upstreamBase = 'https://evil.example';
  const response = await f.handle(request());
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].url, proxy.NATURAL_MEDIA_UPSTREAM_BASE + mediaPath);
});

test('actual Worker checks media first and preserves existing API and image handlers', async () => {
  const calls = [];
  const worker = load('worker/index.ts', {
    './natural-media-proxy': { async handleNaturalMediaRequest(req) { calls.push('media:' + new URL(req.url).pathname); return req.url.endsWith(mediaPath) ? new Response('media', { status: 200 }) : null; } },
    'vinext/server/app-router-entry': { fetch(req, env, ctx) { calls.push('app'); assert.equal(env.marker, 1); assert.equal(ctx.marker, 2); return new Response('app'); } },
    'vinext/server/image-optimization': { DEFAULT_DEVICE_SIZES: [640], DEFAULT_IMAGE_SIZES: [32], handleImageOptimization() { calls.push('image'); return new Response('image'); } },
  }).default;
  assert.equal(await (await worker.fetch(request(), { marker: 1 }, { marker: 2 })).text(), 'media');
  assert.deepEqual(calls.splice(0), ['media:' + mediaPath]);
  assert.equal(await (await worker.fetch(request('/api/recordings'), { marker: 1 }, { marker: 2 })).text(), 'app');
  assert.deepEqual(calls.splice(0), ['media:/api/recordings', 'app']);
  assert.equal(await (await worker.fetch(request('/_vinext/image'), { marker: 1 }, { marker: 2 })).text(), 'image');
  assert.deepEqual(calls, ['media:/_vinext/image', 'image']);
});
