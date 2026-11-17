'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Parse real declarations/methods, rather than mirror their implementation or match log source strings.
// The only syntax adaptation is ArkTS's struct keyword; the unneeded ArkUI build DSL is not executed.
const nativeRoot = path.resolve(__dirname, '../entry/src/main/ets');
const source = fs.readFileSync(path.join(nativeRoot, 'pages/Index.ets'), 'utf8');
const parsed = ts.createSourceFile('Index.ts', source.replace(/\bstruct Index\b/, 'class Index'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const hostNode = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'Index');
assert.ok(hostNode, 'Real native Index declaration must be available');
const methods = ['isTrustedDocument', 'playbackConsole', 'errorResponse', 'readAsset', 'intercept'].map(name => {
  const node = hostNode.members.find(member => ts.isMethodDeclaration(member) && member.name?.getText(parsed) === name);
  assert.ok(node, 'Real native method missing: ' + name);
  return node;
});
const printer = ts.createPrinter();
const emit = node => printer.printNode(ts.EmitHint.Unspecified, node, parsed);
const prelude = [];
for (const node of parsed.statements) {
  if (node === hostNode) break;
  if (!ts.isImportDeclaration(node)) prelude.push(emit(node));
}
const code = ts.transpileModule(prelude.join('\n') + '\nclass Host {alive=true;attached=true;pageReady=true;controller={getUrl(){return documentURL;}};context(){return manager;}\n' + methods.map(emit).join('\n') + '\n}\nexports.Host=Host;', {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
}).outputText;
const rangeExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(nativeRoot, 'services/AssetRange.ets'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
}).outputText, {exports: rangeExports, Uint8Array, ArrayBuffer});

const audioPath = '/audio/offline/1935c17708c726884ac9.mp3';
const request = (headers = [], method = 'GET', url = 'https://lantern.local' + audioPath) => ({
  getRequestUrl: () => url, getRequestMethod: () => method, getRequestHeader: () => headers
});
const tick = () => new Promise(setImmediate);
function fixture({clockFailure = false, logFailure = false, missing = false, documentURL = 'https://lantern.local/'} = {}) {
  const logs = [], responses = [], calls = [];
  const bytes = Uint8Array.from({length: 20}, (_, i) => i).subarray(2, 14);
  let uptime = 1000, wall = 1700000000000;
  class Response {
    constructor() {responses.push(this); this.calls = [];}
    setResponseData(value) {this.body = value; this.calls.push('data');}
    setResponseCode(value) {this.code = value; this.calls.push('code');}
    setReasonMessage(value) {this.reason = value; this.calls.push('reason');}
    setResponseMimeType(value) {this.mime = value; this.calls.push('mime');}
    setResponseEncoding(value) {this.encoding = value; this.calls.push('encoding');}
    setResponseHeader(value) {this.headers = value; this.calls.push('headers');}
    setResponseIsReady(value) {this.ready = value; this.calls.push('ready:' + value);}
  }
  const manager = {resourceManager: {
    getRawFileContentSync(name) {calls.push({kind: 'sync', name}); if (missing) throw Error('not found'); return bytes;},
    async getRawFileContent(name) {calls.push({kind: 'async', name}); if (missing) throw Error('not found'); return bytes;}
  }};
  const exports = {};
  vm.runInNewContext(code, {
    exports, manager, documentURL, WebResourceResponse: Response, assetBytes: rangeExports.assetBytes,
    Uint8Array, ArrayBuffer,
    Date: class extends Date {static now() {return wall--;}},
    systemDateTime: {TimeType: {STARTUP: 0}, getUptime(type, nanoseconds) {
      assert.equal(type, 0); assert.equal(nanoseconds, false);
      if (clockFailure) throw Error('clock unavailable');
      return ++uptime;
    }},
    hilog: {info(domain, tag, format, message) {
      assert.equal(domain, 0x1001); assert.ok(['LANTERN_RANGE', 'LANTERN_PLAYBACK'].includes(tag)); assert.equal(format, '%{public}s');
      if (logFailure) throw Error('log unavailable');
      logs.push({tag, message, ready: responses.at(-1)?.ready});
    }},
    console: {info() {throw Error('Native media diagnostic must use the bounded HiLog path');}}
  });
  return {host: new exports.Host(), logs, responses, calls, bytes};
}
const fields = message => Object.fromEntries([...message.matchAll(/(?:^| )(\w+)=([^ ]*(?: [^= ]+)*?)(?= \w+=|$)/g)].map(match => [match[1], match[2]]));
const headersOf = response => Object.fromEntries(response.headers.map(header => [header.headerKey, header.headerValue]));

test('actual synchronous media response logs correlated request/ready after readiness without changing bytes', () => {
  const h = fixture();
  const response = h.host.intercept(request([{headerKey: 'rAnGe', headerValue: 'bytes=3-6'}]));
  assert.equal(response.ready, true);
  assert.equal(response.code, 206);
  assert.deepEqual([...new Uint8Array(response.body)], [5, 6, 7, 8]);
  assert.equal(headersOf(response)['Content-Range'], 'bytes 3-6/12');
  assert.equal(headersOf(response)['Content-Length'], '4');
  assert.deepEqual(response.calls, ['ready:false', 'data', 'mime', 'encoding', 'code', 'reason', 'headers', 'ready:true']);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].kind, 'sync');
  assert.equal(h.logs.length, 2);
  const before = fields(h.logs[0].message), after = fields(h.logs[1].message);
  assert.equal(before.phase, 'request'); assert.equal(after.phase, 'ready');
  assert.equal(before.id, after.id); assert.equal(after.id, '1');
  assert.equal(after.path, 'web' + audioPath); assert.equal(after.range, 'bytes=3-6');
  assert.equal(after.contentRange, 'bytes 3-6/12'); assert.equal(after.bodyBytes, '4'); assert.equal(after.contentLength, '4');
  assert.equal(after.code, '206'); assert.equal(after.ifRange, '0'); assert.equal(after.head, '0');
  assert.ok(Number(after.uptimeMs) > Number(before.uptimeMs));
  assert.ok(Number(after.elapsedMs) >= 0);
  assert.ok(Number(after.wallMs) < Number(before.wallMs), 'Wall-clock adjustment must not drive elapsed time');
  assert.equal(h.logs[0].ready, false); assert.equal(h.logs[1].ready, true);
});

test('200, 206, 416, HEAD and If-Range retain exact transport semantics and diagnostic lengths', () => {
  const cases = [
    {header: [], code: 200, body: 12, length: 12, range: 'none'},
    {header: [{headerKey: 'Range', headerValue: 'bytes=-4'}], code: 206, body: 4, length: 4, range: 'bytes=-4'},
    {header: [{headerKey: 'Range', headerValue: 'bytes=99-'}], code: 416, body: 0, length: 0, range: 'bytes=99-'},
    {header: [{headerKey: 'Range', headerValue: 'bytes=3-6'}], method: 'HEAD', code: 200, body: 0, length: 12, range: 'bytes=3-6'},
    {header: [{headerKey: 'Range', headerValue: 'bytes=3-6'}, {headerKey: 'If-Range', headerValue: 'private-validator'}], code: 200, body: 12, length: 12, range: 'bytes=3-6'},
    {header: [{headerKey: 'Range', headerValue: 'bytes=0-1'}, {headerKey: 'range', headerValue: 'bytes=5-6'}], code: 200, body: 12, length: 12, range: 'bytes=0-1,bytes=5-6'}
  ];
  const h = fixture();
  for (const [index, item] of cases.entries()) {
    const response = h.host.intercept(request(item.header, item.method));
    assert.equal(response.ready, true); assert.equal(response.code, item.code);
    assert.equal(response.body.byteLength, item.body); assert.equal(headersOf(response)['Content-Length'], String(item.length));
    const actual = fields(h.logs.at(-1).message);
    assert.equal(actual.id, String(index + 1)); assert.equal(actual.code, String(item.code));
    assert.equal(actual.range, item.range); assert.equal(actual.bodyBytes, String(item.body)); assert.equal(actual.contentLength, String(item.length));
    assert.equal(actual.ifRange, item.header.some(header => header.headerKey === 'If-Range') ? '1' : '0');
    assert.equal(actual.head, item.method === 'HEAD' ? '1' : '0');
    assert.ok(!h.logs.at(-1).message.includes('private-validator'));
  }
});

test('only packaged hashed local MP3 paths log; query, credentials, arbitrary Range text and long input never escape', async () => {
  const h = fixture();
  assert.equal(h.host.intercept(request([], 'GET', 'https://external.invalid/private?credential=secret')), null);
  assert.equal(h.host.intercept(request([], 'GET', 'blob:https://lantern.local/private-recording')), null);
  h.host.intercept(request([], 'GET', 'https://lantern.local/audio/private-recording.webm'));
  h.host.intercept(request([], 'GET', 'https://lantern.local/images/private-name.png'));
  await tick(); assert.equal(h.logs.length, 0);
  const response = h.host.intercept(request([
    {headerKey: 'Range', headerValue: 'malformed private payload\nsecret'},
    {headerKey: 'Authorization', headerValue: 'private-token'},
    {headerKey: 'Cookie', headerValue: 'private-cookie'}
  ], 'GET', 'https://lantern.local' + audioPath + '?token=private-token#private-fragment'));
  assert.equal(response.code, 200);
  assert.equal(fields(h.logs.at(-1).message).range, 'redacted');
  assert.equal(fields(h.logs.at(-1).message).id, '1', 'Unrelated resources do not consume the diagnostic budget');
  const huge = h.host.intercept(request([{headerKey: 'Range', headerValue: 'bytes=' + '9'.repeat(300) + '-'}]));
  assert.equal(huge.code, 416); assert.equal(fields(h.logs.at(-1).message).range, 'oversize');
  for (const {message} of h.logs) {
    assert.ok(!/private|secret|token|cookie|https?:|\n/i.test(message), message);
    assert.ok(message.length < 700);
  }
});

test('diagnostics stop at 64 requests plus one limit marker while all media requests still complete', () => {
  const h = fixture();
  for (let i = 0; i < 67; i++) {
    const response = h.host.intercept(request());
    assert.equal(response.ready, true); assert.equal(response.code, 200); assert.equal(response.body.byteLength, 12);
  }
  assert.equal(h.calls.length, 67);
  assert.equal(h.logs.length, 129);
  assert.equal(h.logs.filter(log => fields(log.message).phase === 'limit').length, 1);
  assert.equal(fields(h.logs[127].message).id, '64');
});

test('clock failures and logger failures never convert an actual 206 into a 404 or delay readiness', () => {
  for (const options of [{clockFailure: true}, {logFailure: true}, {clockFailure: true, logFailure: true}]) {
    const h = fixture(options), response = h.host.intercept(request([{headerKey: 'Range', headerValue: 'bytes=2-4'}]));
    assert.equal(response.ready, true); assert.equal(response.code, 206);
    assert.deepEqual([...new Uint8Array(response.body)], [4, 5, 6]);
    assert.equal(h.calls.length, 1);
    if (options.clockFailure && !options.logFailure) {
      assert.equal(fields(h.logs.at(-1).message).uptimeMs, '-1');
      assert.equal(fields(h.logs.at(-1).message).elapsedMs, '-1');
    }
  }
});

test('non-media asynchronous readiness and missing-media 404 keep their original behavior', async () => {
  const h = fixture();
  const document = h.host.intercept(request([], 'GET', 'https://lantern.local/index.html'));
  assert.equal(document.ready, false);
  await tick(); assert.equal(document.ready, true); assert.equal(document.code, 200); assert.equal(h.logs.length, 0);
  const missing = fixture({missing: true}), response = missing.host.intercept(request());
  assert.equal(response.ready, true); assert.equal(response.code, 404);
  assert.equal(response.body, 'Bundled resource not found');
  assert.equal(fields(missing.logs.at(-1).message).code, '404');
  assert.equal(fields(missing.logs.at(-1).message).bodyBytes, String(response.body.length));
  assert.equal(fields(missing.logs.at(-1).message).contentLength, '-1');
});

function playbackData(overrides = {}) {
  return {
    player: 1, request: 2, stage: 'paused-seek', event: 'begin',
    target: 9.5, targetPosition: 9.5, current: 0, baseline: 9.5, readyState: 1, duration: 33.15, preparedDuration: 33.15,
    preparedPosition: null, firstProgressPosition: null, firstProgressElapsed: null,
    paused: true, seeking: true, muted: false, rate: .85, sourceMatches: true,
    metadataSeen: true, seekAssigned: true, seekEventSeen: false, seekComplete: false,
    playingSeen: false, interrupted: false, advances: 0, elapsed: 0,
    seekable: [[0, 33.15]], events: {begin: 1}, ...overrides
  };
}
function consoleMessage(message) {
  return {getMessage: () => message, getSourceId() {throw Error('Source identifiers must never be read or logged');}};
}
function playbackMessage(data = playbackData()) {return consoleMessage('Bundled playback ' + JSON.stringify(data));}
const playbackRows = h => h.logs.filter(log => log.tag === 'LANTERN_PLAYBACK');

test('actual onConsole handler forwards only a trusted local document and preserves ordinary console handling', () => {
  for (const documentURL of ['https://external.invalid/', 'https://lantern.local.evil/', 'file:///private', 'blob:https://lantern.local/private']) {
    const h = fixture({documentURL});
    assert.equal(h.host.playbackConsole({getMessage() {throw Error('Untrusted console must not be inspected');}}), false);
    assert.equal(h.logs.length, 0);
  }
  for (const field of ['alive', 'attached', 'pageReady']) {
    const h = fixture(); h.host[field] = false;
    assert.equal(h.host.playbackConsole(playbackMessage()), false); assert.equal(h.logs.length, 0);
  }
  const h = fixture();
  for (const text of ['ordinary console user text', 'Bundled playbackx {}', 'prefix Bundled playback {}', 'Bundled playback {bad', 'Bundled playback null', 'Bundled playback []', 'Bundled playback ' + 'x'.repeat(4096)]) {
    assert.equal(h.host.playbackConsole(consoleMessage(text)), false);
  }
  assert.equal(h.logs.length, 0);
  assert.equal(h.host.playbackConsole(playbackMessage()), true);
  const row = JSON.parse(playbackRows(h)[0].message);
  assert.equal(row.seq, 1); assert.equal(row.data.player, 1); assert.equal(row.data.request, 2);
  assert.equal(typeof row.uptimeMs, 'number'); assert.equal(typeof row.wallMs, 'number');
});

test('console projection drops arbitrary fields, unknown strings, source URLs and exception messages', () => {
  const h = fixture();
  const payload = playbackData({
    event: 'rejected', reason: 'private lesson text', exceptionName: 'PrivateRecordingName',
    exceptionCode: 9, message: 'private lesson text', url: 'https://private.invalid/?token=secret',
    sourceId: 'private source name', account: 'private account',
    events: {begin: 1, rejected: 1, privateKey: 'private text'}
  });
  assert.equal(h.host.playbackConsole(playbackMessage(payload)), true);
  const row = JSON.parse(playbackRows(h)[0].message);
  assert.equal(row.data.reason, undefined); assert.equal(row.data.exceptionName, undefined);
  assert.equal(row.data.exceptionCode, 9);
  assert.deepEqual(row.data.events, {begin: 1, rejected: 1});
  for (const key of ['message', 'url', 'sourceId', 'account']) assert.equal(row.data[key], undefined);
  assert.ok(!/private|secret|token|https?:/i.test(playbackRows(h)[0].message));
  assert.equal(h.host.playbackConsole(playbackMessage(playbackData({event: 'rejected', reason: 'confirmation-timeout', exceptionName: 'AbortError'}))), true);
  const known = JSON.parse(playbackRows(h).at(-1).message);
  assert.equal(known.data.reason, 'confirmation-timeout'); assert.equal(known.data.exceptionName, 'AbortError');
  assert.equal(h.host.playbackConsole(playbackMessage(playbackData({event: 'play', reason: 'confirmation-timeout'}))), true);
  assert.equal(JSON.parse(playbackRows(h).at(-1).message).data.reason, undefined, 'Only rejection can carry a reason');
});

test('console validation rejects malformed numbers, booleans, event enums, counters and seekable tuples', () => {
  const h = fixture();
  const invalid = [
    {stage: 'private text'}, {event: 'private text'}, {player: 0}, {request: 1.2}, {target: '9.5'},
    {baseline: -1}, {elapsed: null}, {readyState: 5}, {rate: 0}, {rate: 17}, {advances: -.1},
    {paused: 'true'}, {interrupted: 0}, {seekComplete: null}, {current: 'private'},
    {duration: -3}, {preparedDuration: 'private'}, {firstProgressElapsed: 'private'}, {preparedPosition: []},
    {seekable: Array.from({length: 9}, () => [0, 1])}, {seekable: [[0, 1, 2]]},
    {seekable: [[2, 1]]}, {seekable: [['0', 1]]}, {seekable: [null]},
    {events: []}, {events: null}, {events: {begin: 'private'}}, {events: {begin: -1}},
    {events: {begin: 1000001}}
  ];
  for (const patch of invalid) assert.equal(h.host.playbackConsole(playbackMessage(playbackData(patch))), false, JSON.stringify(patch));
  const nonfinite = 'Bundled playback ' + JSON.stringify(playbackData()).replace('"target":9.5', '"target":1e309');
  assert.equal(h.host.playbackConsole(consoleMessage(nonfinite)), false);
  assert.equal(h.logs.length, 0);
  assert.equal(h.host.playbackConsole(playbackMessage(playbackData({current: null, duration: null}))), true);
  const data = JSON.parse(playbackRows(h)[0].message).data;
  assert.equal(data.current, null); assert.equal(data.duration, null);
});

test('all fixed event and reason values round-trip; arbitrary keys never consume extra output fields', () => {
  const events = ['begin', 'load', 'loadedmetadata', 'canplay', 'progress', 'durationchange', 'seek-request', 'seeked',
    'seek-settled', 'play', 'play-resolved', 'playing', 'timeupdate', 'waiting', 'stalled', 'abort', 'emptied',
    'rejected', 'confirmed', 'confirmed-short-end', 'stop', 'pause', 'ended'];
  const reasons = ['ended-before-confirmation', 'media-error', 'startup-position', 'playing-position', 'progress-position',
    'confirmed-position', 'not-prepared-paused', 'play-rejected', 'play-threw', 'paused-seek-position', 'source-changed',
    'metadata-source', 'preparation-not-paused', 'seek-threw', 'media-aborted', 'media-emptied', 'confirmation-timeout', 'load-threw'];
  const h = fixture();
  for (const event of events) {
    assert.equal(h.host.playbackConsole(playbackMessage(playbackData({event, events: {[event]: 1}}))), true, event);
    assert.deepEqual(JSON.parse(playbackRows(h).at(-1).message).data.events, {[event]: 1});
  }
  for (const reason of reasons) {
    assert.equal(h.host.playbackConsole(playbackMessage(playbackData({event: 'rejected', reason}))), true, reason);
    assert.equal(JSON.parse(playbackRows(h).at(-1).message).data.reason, reason);
  }
});

test('console budget emits at most 256 projected rows and one marker; valid excess messages stay handled', () => {
  const h = fixture();
  for (let i = 0; i < 260; i++) assert.equal(h.host.playbackConsole(playbackMessage()), true);
  assert.equal(playbackRows(h).length, 257);
  assert.equal(JSON.parse(playbackRows(h)[255].message).seq, 256);
  assert.equal(playbackRows(h)[256].message, 'v=1 phase=limit messages=256');
  assert.equal(h.host.playbackConsole(consoleMessage('ordinary private console')), false);
  assert.equal(playbackRows(h).length, 257);
});

test('console getter, clock and HiLog exceptions are contained and leave transport and ordinary console behavior intact', () => {
  const unreadable = fixture();
  assert.equal(unreadable.host.playbackConsole({getMessage() {throw Error('unavailable');}}), false);
  for (const options of [{clockFailure: true}, {logFailure: true}, {clockFailure: true, logFailure: true}]) {
    const h = fixture(options);
    assert.equal(h.host.playbackConsole(playbackMessage()), true);
    assert.equal(h.host.playbackConsole(consoleMessage('ordinary message')), false);
    const response = h.host.intercept(request([{headerKey: 'Range', headerValue: 'bytes=2-4'}]));
    assert.equal(response.ready, true); assert.equal(response.code, 206);
    assert.deepEqual([...new Uint8Array(response.body)], [4, 5, 6]);
    if (options.clockFailure && !options.logFailure) assert.equal(JSON.parse(playbackRows(h)[0].message).uptimeMs, -1);
  }
});
