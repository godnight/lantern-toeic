const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const plain = value => JSON.parse(JSON.stringify(value));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => fs.readFileSync(file==='app/learn/vocabulary-library.tsx'&&process.env.LANTERN_SEARCH_COMPONENT?process.env.LANTERN_SEARCH_COMPONENT:path.join(root, file), 'utf8');
function load(file, imports = {}, globals = {}, append = '') {
  const exports = {};
  const code = ts.transpileModule(read(file) + append, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require(name) {
    assert.ok(name in imports, 'Unexpected import: ' + name); return name.endsWith('.json') ? {default:imports[name]} : imports[name];
  }, Date, Intl, Map, Set, Error, JSON, Uint8Array, TextDecoder, AbortController,
  crypto: crypto.webcrypto, setTimeout, clearTimeout, ...globals }, { filename: file });
  return exports;
}
const study = load('lib/study-model.ts');
const vocab = load('lib/vocabulary-model.ts', { './study-model': study });
const model = load('lib/dictionary-model.ts', { './vocabulary-model': vocab });
const metadata = JSON.parse(read('content/dictionary-metadata.json'));
const bytes = fs.readFileSync(path.join(root, 'public/dictionaries', metadata.file));
const payload = JSON.parse(bytes);
const core = JSON.parse(read('content/vocabulary.json'));
const expansion = JSON.parse(read('content/vocabulary-expansion.json'));
const questions = JSON.parse(read('content/questions.json'));
// Extract the actual component's catalog construction, rather than copying its merge algorithm.
const catalog = load('app/learn/vocabulary-library.tsx', {
  react: {}, 'react/jsx-runtime': {}, 'lucide-react': {}, './vocabulary-redesign.css': {},
  '@/components/ui/dialog': {}, '@/components/ui/select': {}, sonner: {},
  '@/lib/native-host': {}, '@/lib/use-vocabulary': {}, '@/lib/vocabulary-model': vocab,
  '@/content/vocabulary.json': core, '@/content/questions.json': questions,
  '@/content/vocabulary-expansion.json': expansion, '@/content/dictionary-metadata.json': metadata,
  '@/lib/dictionary-model': model, '@/lib/load-dictionary': {}, '@/lib/lesson-audio': {}, './practice': {},
}, {}, '\nexport const __qaCatalog = {core, questionWords, extraWords, learningWords};\n').__qaCatalog;
const merged = model.mergeWordCatalog(catalog.learningWords, payload.entries);
const indexed = model.indexDictionary(merged);
const legacyFields = ['id','word','pos','meaning','category','example','translation','collocation'];
const snapshot = row => Object.fromEntries(legacyFields.map(key => [key, row[key]]));
const entry = (overrides = {}) => ({ id: 'dict-0123456789abcdef0123', word: 'test', phonetics: [], senses: [{pos: 'noun', meaning: '测试'}], ...overrides });
const fixture = entries => ({ schemaVersion: 1, source: 'qa-dictionary', entries });
const stamp = '2026-01-01T00:00:00.000Z';
const mark = (wordId, overrides = {}) => ({id: crypto.randomUUID(), wordId, createdAt: stamp, type: 'mark', starred: true, revision: 1, ...overrides});
const review = (wordId, overrides = {}) => ({id: crypto.randomUUID(), wordId, createdAt: stamp, type: 'review', grade: 'remembered', ...overrides});
function storageFixture() {
  const raw = new Map();
  return {raw, storage:{get length(){return raw.size;},key:i=>[...raw.keys()][i]??null,getItem:k=>raw.get(k)??null,setItem:(k,v)=>raw.set(k,v)}};
}

test('actual dictionary bytes, hash, version, count and bundled filename match metadata', () => {
  assert.equal(bytes.byteLength, metadata.dictionaryBytes);
  assert.equal(hash(bytes), metadata.sha256);
  assert.equal(hash(bytes), metadata.dictionarySha256);
  assert.equal(metadata.file, `zh-en-${metadata.sha256.slice(0,12)}.json`);
  assert.equal(payload.source, metadata.source);
  assert.equal(payload.entries.length, metadata.count);
  assert.equal(payload.entries.length, metadata.entryCount);
  assert.equal(model.parseDictionary(payload).entries.length, 84979);
});

test('bundled dictionary contains only approved text fields, no third-party examples, audio or references', () => {
  const allowed = new Set(['id','word','phonetics','senses','etymology','forms']);
  for (const row of payload.entries) {
    assert.ok(Object.keys(row).every(key=>allowed.has(key)), row.word);
    assert.ok(row.senses.every(s=>Object.keys(s).sort().join(',')==='meaning,pos'), row.word);
    for (const sense of row.senses) assert.match(sense.meaning, /[\p{Script=Han}]/u, row.word);
  }
});

test('dictionary parser rejects damaged containers, entries and oversized field collections', () => {
  for (const bad of [null, {}, {...fixture([]), schemaVersion:2}, {...fixture([]), source:5}, {...fixture([]), entries:{}}]) assert.throws(()=>model.parseDictionary(bad));
  const corruptions = [null, entry({id:'user-word'}), entry({word:'   '}), entry({word:'x'.repeat(121)}), entry({phonetics:{}}), entry({phonetics:['x'.repeat(201)]}), entry({phonetics:Array(5).fill('a')}), entry({senses:[]}), entry({senses:[{pos:'n',meaning:''}]}), entry({senses:[{pos:4,meaning:'词'}]}), entry({senses:Array(9).fill({pos:'n',meaning:'词'})}), entry({etymology:'x'.repeat(1601)}), entry({forms:Array(13).fill('test')})];
  for (const row of corruptions) assert.throws(()=>model.parseDictionary(fixture([row])));
});

test('dictionary parser rejects duplicate IDs and NFKC/case/whitespace-equivalent headwords', () => {
  assert.throws(()=>model.parseDictionary(fixture([entry(),entry({word:'other'})])), /重复/);
  assert.throws(()=>model.parseDictionary(fixture([entry(),entry({id:'dict-1123456789abcdef0123',word:' ＴＥＳＴ '})])), /重复/);
  assert.equal(model.parseDictionary(fixture([entry()])).entries.length,1);
});

test('actual UI catalog retains all original 295 IDs, definitions and example fields', () => {
  const legacy = plain([...catalog.core,...catalog.questionWords]);
  assert.equal(legacy.length,295);
  // Baseline captured from pre-upgrade HEAD; changing this digest requires an explicit legacy-content migration.
  assert.equal(hash(JSON.stringify(legacy)), '0e7ca976ad812f2bfc6857e510532eaa1562e075875927784f6d29dd654bb224');
  const byId = new Map(merged.map(w=>[w.id,w]));
  for (const original of legacy) assert.deepEqual(snapshot(byId.get(original.id)),snapshot(original));
});

test('567 authored additions do not overlap legacy IDs/headwords and have valid scene glosses', () => {
  assert.equal(expansion.length,567);
  assert.equal(catalog.learningWords.length,862);
  const ids=new Set(),heads=new Set();
  for (const word of catalog.learningWords) {
    assert.ok(!ids.has(word.id), word.id); ids.add(word.id);
    const head=vocab.searchText(word.word); assert.ok(!heads.has(head), word.word); heads.add(head);
    assert.ok(vocab.validVocabularyEvent(mark(word.id)), word.id);
  }
  for (const word of expansion) {
    assert.ok(vocab.CATEGORIES[word.category], word.word);
    assert.ok(word.pos.trim(), word.word); assert.match(word.meaning, /[\p{Script=Han}]/u, word.word);
    assert.equal(word.example,undefined); assert.equal(word.audio,undefined);
  }
});

test('dictionary enrichment does not mutate source objects or replace authored definitions', () => {
  const base=plain(catalog.learningWords.slice(0,3));
  const before=JSON.stringify(base);
  const rows=base.map((word,i)=>entry({id:'dict-'+String(i).padStart(20,'0'),word:word.word.toUpperCase(),senses:[{pos:'other',meaning:'另一个词典义项'}]}));
  const result=model.mergeWordCatalog(base,rows);
  assert.equal(JSON.stringify(base),before); assert.equal(result.length,base.length);
  result.forEach((word,i)=>{assert.deepEqual(snapshot(word),snapshot(base[i]));assert.equal(word.senses[0].meaning,'另一个词典义项');});
});

test('new dictionary IDs are unique, persistable event IDs and retain attached sense/part-of-speech', () => {
  assert.equal(new Set(merged.map(w=>w.id)).size,merged.length);
  const newWords=merged.filter(w=>w.source==='wiktionary'); assert.ok(newWords.length>80000);
  for (const word of newWords) {
    assert.ok(vocab.validVocabularyEvent(mark(word.id)), word.id);
    assert.equal(word.meaning,word.senses[0].meaning); assert.equal(word.pos,word.senses[0].pos);
    assert.equal(word.example,''); assert.equal(word.translation,'');
  }
});

test('lookup ranks exact normalized headwords before prefixes, substrings and meaning-only matches', () => {
  const base=(id,word,meaning,extra={})=>({id,word,meaning,category:'dictionary',pos:'n',example:'',translation:'',collocation:'',...extra});
  const index=model.indexDictionary([base('a','contact','联系 test'),base('b','tester','检测员'),base('c','test','测试'),base('d','protest','抗议')]);
  assert.deepEqual(Array.from(model.findDictionary(index,' ＴＥＳＴ '),w=>w.id),['c','b','d','a']);
  assert.equal(model.findDictionary(index,'   ').length,0);
  assert.equal(model.findDictionary(index,'not-a-match').length,0);
});

test('lookup searches Chinese secondary senses, inflected forms and combined terms', () => {
  const row={...entry({word:'book',forms:['booked'],senses:[{pos:'noun',meaning:'书籍'},{pos:'verb',meaning:'预订座位'}]}),meaning:'书籍',pos:'noun',category:'dictionary',example:'',translation:'',collocation:''};
  const index=model.indexDictionary([row]);
  for (const query of ['预订','BOOKED','book 预订','ｂｏｏｋ 座位']) assert.equal(model.findDictionary(index,query)[0]?.id,row.id,query);
  assert.equal(model.findDictionary(index,'book 不存在').length,0);
});

test('actual full dictionary exact-headword lookup works and reports machine timings', t => {
  const start=performance.now();
  for (const word of ['invoice','fee','product','vacancy','reservation']) {
    assert.equal(vocab.searchText(model.findDictionary(indexed,' '+word.toUpperCase()+' ')[0].word),word);
  }
  t.diagnostic(`5 full-catalog lookups over ${merged.length} entries: ${(performance.now()-start).toFixed(1)} ms (diagnostic, not device acceptance)`);
});

test('apple retains its common fruit meaning and IPA after source processing and catalog lookup', () => {
  const source=payload.entries.find(row=>row.word==='apple');
  assert.ok(source);assert.equal(source.senses[0].pos,'noun');assert.equal(source.senses[0].meaning,'苹果（水果）');
  assert.ok(source.phonetics.includes('/ˈæp(ə)l/'));
  const result=model.findDictionary(indexed,' ＡＰＰＬＥ ')[0];
  assert.equal(result.id,source.id);assert.equal(result.word,'apple');assert.equal(result.meaning,'苹果（水果）');
  assert.deepEqual(plain(result.phonetics),plain(source.phonetics));
});

test('new lookup word mark/review events survive backup, restore, repeated import and owner isolation', () => {
  const word=merged.find(w=>w.source==='wiktionary');
  const first=storageFixture(),other=storageFixture(),key=vocab.vocabularyKey(null);
  const events=[mark(word.id,{id:'new-word-star'}),review(word.id,{id:'new-word-review'})];
  vocab.writeVocabulary(first.storage,key,events);
  const backup=vocab.parseVocabularyBackup(JSON.parse(JSON.stringify({kind:'lantern-vocabulary',schemaVersion:1,events:vocab.readVocabulary(first.storage,key)})));
  vocab.writeVocabulary(other.storage,key,backup.events);
  const count=other.raw.size; vocab.writeVocabulary(other.storage,key,backup.events);
  assert.equal(other.raw.size,count);
  assert.deepEqual(plain(vocab.vocabularyState(vocab.readVocabulary(other.storage,key),word.id)),{starred:true,revision:1,level:1,due:Date.parse(stamp)+86400000,reviews:1});
  assert.equal(vocab.readVocabulary(other.storage,vocab.vocabularyKey('other-owner')).length,0);
});

test('grouped states equal original scheduling semantics including early review and same-revision cancellation', () => {
  const a='dict-0123456789abcdef0123',b='qv-present-identification';
  const events=[mark(a,{id:'star'}),mark(a,{id:'cancel',starred:false}),review(a,{id:'a1'}),review(a,{id:'a2',createdAt:'2026-01-01T00:01:00.000Z'}),review(a,{id:'a3',createdAt:'2026-01-02T00:00:00.000Z'}),review(b,{id:'b1',grade:'again'}),review(b,{id:'b2',createdAt:'2026-01-01T00:05:00.000Z'})].reverse();
  const groups=model.vocabularyStates(events);
  for (const word of [a,b]) assert.deepEqual(plain(groups.get(word)),plain(vocab.vocabularyState(events,word)));
  assert.equal(groups.get(a).starred,false);assert.equal(groups.get(a).level,2);
  assert.equal(groups.get(b).level,0);assert.equal(groups.get(b).due,Date.parse(stamp)+600000);
  assert.equal(groups.has('missing'),false);assert.deepEqual(plain(model.emptyVocabularyState),plain(vocab.vocabularyState([],'missing')));
});

function loaderFixture(fetch, overrideMeta={}, timerApi={}) {
  return load('lib/load-dictionary.ts',{'@/content/dictionary-metadata.json':{...metadata,...overrideMeta},'./dictionary-model':model},{fetch,...timerApi});
}
const response=(body=bytes,ok=true)=>({ok,arrayBuffer:async()=>new Uint8Array(body).buffer});

test('actual dictionary loader validates bytes and shares successful concurrent requests', async () => {
  let calls=0;const loader=loaderFixture(async(url)=>{calls++;assert.equal(url,'/dictionaries/'+metadata.file);return response();});
  const a=loader.loadDictionary(),b=loader.loadDictionary();assert.equal(a,b);
  assert.equal((await a).entries.length,metadata.count);assert.equal(await b,await a);
  await loader.loadDictionary();assert.equal(calls,1);
});

for (const kind of ['http','hash','count','source']) test(`dictionary loader rejects ${kind} failures and retries after the rejected promise`,async()=>{
  let calls=0;
  const meta=kind==='count'?{count:metadata.count+1}:kind==='source'?{source:'other-version'}:{};
  const loader=loaderFixture(async()=>{calls++;return kind==='http'&&calls===1?response(bytes,false):kind==='hash'&&calls===1?response(Buffer.from('{}')):response();},meta);
  await assert.rejects(loader.loadDictionary(),/词典/);
  if(kind==='count'||kind==='source')await assert.rejects(loader.loadDictionary(),/版本或数量/);else assert.equal((await loader.loadDictionary()).entries.length,metadata.count);
  assert.equal(calls,2);
});

test('dictionary loader aborts a hung response body then allows another request',async()=>{
  let calls=0,abortDeadline,bodyEntered;
  const entered=new Promise(resolve=>{bodyEntered=resolve;});
  const loader=loaderFixture(async(_url,options)=>{
    calls++;if(calls>1)return response();
    return {ok:true,arrayBuffer:()=>new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});bodyEntered();})};
  },{},{setTimeout:callback=>{abortDeadline=callback;return 1;},clearTimeout:()=>{}});
  const pending=loader.loadDictionary();await entered;abortDeadline();
  await assert.rejects(pending,/aborted/);assert.equal((await loader.loadDictionary()).entries.length,metadata.count);assert.equal(calls,2);
});
