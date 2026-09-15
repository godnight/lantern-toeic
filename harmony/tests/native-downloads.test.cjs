const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets/NativeDownloads.ets'), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const files = new Map(), removed = [], notices = [], pickers = [], reads = [];
  let allowed = true, uuid = 0, delegate;
  class Delegate {
    onBeforeDownload(fn) { this.before = fn; }
    onDownloadFinish(fn) { this.finish = fn; }
    onDownloadFailed(fn) { this.failed = fn; }
  }
  class Picker {
    save(options) {
      assert.equal(options.pickerMode, 1);
      return new Promise(resolve => pickers.push(resolve));
    }
  }
  const fileIo = {
    OpenMode: {CREATE:64, WRITE_ONLY:1},
    accessSync: value => files.has(value),
    unlinkSync(value) { removed.push(value); files.delete(value); },
    openSync(value) { files.set(value, 0); return {fd:value}; },
    writeSync(value, buffer) { files.set(value, files.get(value) + buffer.byteLength); return buffer.byteLength; },
    closeSync() {},
    statSync(value) { if (!files.has(value)) throw Error('missing'); return {size:files.get(value), isFile:()=>true}; },
  };
  const imports = {
    '@kit.AbilityKit': {},
    '@kit.ArkWeb': {webview:{WebDownloadDelegate:Delegate}},
    '@kit.CoreFileKit': {fileIo, picker:{DocumentViewPicker:Picker, DocumentPickerMode:{DOWNLOAD:1}}, fileUri:{FileUri:class {
      constructor(uri) { this.path = uri.replace('file://docs', ''); }
    }}},
    '@kit.ArkTS': {util:{generateRandomUUID:()=>`uuid-${++uuid}`}},
  };
  const exports = {};
  vm.runInNewContext(code, {exports, Uint8Array, ArrayBuffer, Error, require:name=>imports[name]});
  const manager = new exports.NativeDownloads(() => ({resourceManager:{
    async getRawFileContent(name) { reads.push(name); return new Uint8Array([1,2,3,4]); },
  }}), () => allowed, message => notices.push(message));
  manager.attach({setDownloadDelegate:value=>{delegate=value;}});
  return {manager, files, removed, notices, pickers, reads, get delegate(){return delegate;}, setAllowed(value){allowed=value;}};
}
let nextGuid = 0;
function item(overrides={}) {
  return {
    guid:`download-${++nextGuid}`, url:'blob:https://lantern.local/record',
    name:'lantern-my-study-records.json', mime:'application/json', received:5,
    started:'', cancelled:0, fullPath:'',
    getGuid(){return this.guid;}, getUrl(){return this.url;}, getSuggestedFileName(){return this.name;},
    getMimeType(){return this.mime;}, getReceivedBytes(){return this.received;}, getFullPath(){return this.fullPath;},
    start(value){this.started=value;}, cancel(){this.cancelled++;}, ...overrides,
  };
}
const directory = 'file://docs/storage/Download/com.lantern.toeic';

test('a local export succeeds only after the requested public file exists with the received bytes', async () => {
  const h = fixture(), request = item();
  h.delegate.before(request);
  h.pickers[0]([directory]); await tick();
  assert.equal(request.started, '/storage/Download/com.lantern.toeic/lantern-my-study-records-uuid-1.json');
  assert.equal(h.notices.length, 0);
  request.fullPath=request.started; h.files.set(request.started, 5);
  h.delegate.finish(request);
  assert.match(h.notices[0], /已保存/);
  h.manager.invalidate();
  assert.equal(h.files.size, 1, 'A completed user export must survive later page disposal');
});

test('remote, forged MIME and filename traversal requests never reach the picker', () => {
  const h = fixture();
  for (const overrides of [{url:'https://example.com/private'}, {url:'blob:https://lantern.local.evil/a'},
    {name:'../lantern-my-study-records.json'}, {mime:'text/html'}]) {
    const request = item(overrides); h.delegate.before(request); assert.equal(request.cancelled, 1);
  }
  assert.equal(h.pickers.length, 0);
});

test('page disposal during directory selection cannot revive a cancelled download', async () => {
  const h = fixture(), request = item();
  h.delegate.before(request); h.manager.invalidate();
  h.pickers[0]([directory]); await tick();
  assert.equal(request.started, ''); assert.equal(request.cancelled, 1);
  assert.equal(h.notices.length, 0);
});

test('a second request cannot displace the current export', async () => {
  const h = fixture(), first = item(), second = item();
  h.delegate.before(first); h.delegate.before(second);
  assert.equal(second.cancelled, 1); assert.equal(first.cancelled, 0);
  h.pickers[0]([directory]); await tick();
  assert.ok(first.started); h.manager.invalidate();
});

test('sandbox fallback and partial files never produce false success', async () => {
  for (const fallback of [true, false]) {
    const h = fixture(), request = item();
    h.delegate.before(request); h.pickers[0]([directory]); await tick();
    h.files.set(request.started, 3);
    request.fullPath = fallback ? '/private/sandbox/other-user-file.json' : request.started;
    h.delegate.finish(request);
    assert.equal(h.notices.some(message=>message.includes('已保存')), false);
    assert.deepEqual(h.removed, [request.started]);
  }
});

test('existing files are preserved if a generated filename collides', async () => {
  const h = fixture(), request = item();
  const existing='/storage/Download/com.lantern.toeic/lantern-my-study-records-uuid-1.json';
  h.files.set(existing, 99);
  h.delegate.before(request); h.pickers[0]([directory]); await tick();
  assert.equal(request.started, ''); assert.equal(h.files.get(existing), 99);
  assert.deepEqual(h.removed, []);
});

test('bundled art downloads copy rawfile bytes without fetching the internal origin', async () => {
  const h = fixture(), request = item({url:'https://lantern.local/art-packs/hollow-originals-v0.2.3.zip', name:'ignored.zip', mime:'application/octet-stream'});
  h.delegate.before(request); h.pickers[0]([directory]); await tick();
  assert.equal(request.cancelled, 1); assert.equal(request.started, '');
  assert.deepEqual(h.reads, ['web/art-packs/hollow-originals-v0.2.3.zip']);
  assert.match(h.notices[0], /已保存/); assert.equal([...h.files.values()][0], 4);
});

test('engine failure while the download directory is pending cannot cancel a bundled copy', async () => {
  const h = fixture(), request = item({url:'https://lantern.local/art-packs/silk-originals-v0.2.3.zip'});
  h.delegate.before(request);
  assert.equal(request.cancelled, 1, 'Take over the packaged download before awaiting the directory');
  h.delegate.failed(request);
  assert.equal(h.notices.length, 0);
  h.pickers[0]([directory]); await tick();
  assert.deepEqual(h.reads, ['web/art-packs/silk-originals-v0.2.3.zip']);
  assert.match(h.notices[0], /已保存/);
  assert.equal([...h.files.values()][0], 4);
});
