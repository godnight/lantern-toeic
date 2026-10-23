// Real reducers/hook; synthetic in-memory storage only. No auth or media claim.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const loader=createSourceLoader({root}),ids=loader.load('lib/dictionary-legacy-ids.ts'),model=loader.load('lib/vocabulary-model.ts'),dictionary=loader.load('lib/dictionary-model.ts');
const legacy='dict-3a7bd3e2360a3d29eea4',canonical='v041-word-3a7bd3e2360a3d29eea4';
const mark=(wordId,revision=7,starred=true,id='mark-old')=>({id,wordId,type:'mark',starred,revision,createdAt:'2026-01-01T00:00:00.000Z'});
const review=(wordId,id='review-old',grade='again',at='2026-01-01T00:00:01.000Z')=>({id,wordId,type:'review',grade,createdAt:at});
const plain=x=>JSON.parse(JSON.stringify(x));
test('only the1371 proven one-to-one dictionary IDs project; old authored and unknown IDs stay unchanged',()=>{
 const index=JSON.parse(fs.readFileSync(path.join(root,'content/dictionary-legacy-ids.json'),'utf8'));
 assert.equal(ids.DICTIONARY_LEGACY_ALIAS_COUNT,1371);assert.equal(Object.keys(index.aliases).length,1371);assert.equal(new Set(Object.values(index.aliases)).size,1371);
 for(const [old,current]of Object.entries(index.aliases)){assert.equal(ids.canonicalVocabularyWordId(old),current);assert.equal(old.slice(5),current.slice(10));}
 for(const id of ['v-allergy','qv-document','dict-00000000000000000000',canonical])assert.equal(ids.canonicalVocabularyWordId(id),id);
});
test('legacy-only marks and review project to current ID while every input fact stays byte-identical',()=>{
 const events=[mark(legacy),review(legacy)],before=JSON.stringify(events),states=dictionary.vocabularyStates(events);
 assert.equal(states.size,1);assert.equal(states.has(legacy),false);assert.equal(states.get(canonical).starred,true);assert.equal(states.get(canonical).reviews,1);assert.ok(states.get(canonical).due>0);assert.equal(JSON.stringify(events),before);
});
test('mixed histories deduplicate exact event IDs, retain distinct reviews and preserve cancellation ordering',()=>{
 const old=[mark(legacy),review(legacy)],next=[mark(canonical,8,false,'mark-new'),review(canonical,'review-new','remembered','2026-01-02T00:00:01.000Z')];
 const raw=model.mergeVocabularyEvents([...old,...old],next),before=JSON.stringify(raw),states=dictionary.vocabularyStates(raw);
 assert.equal(raw.length,4);assert.equal(states.size,1);assert.equal(states.get(canonical).starred,false);assert.equal(states.get(canonical).reviews,2);assert.equal(JSON.stringify(raw),before);
 const cancelled=dictionary.vocabularyStates([mark(legacy,9,true),mark(canonical,9,false,'cancel')]);assert.equal(cancelled.get(canonical).starred,false,'Equal-revision cancellation wins across aliases exactly as in the original reducer');
});
test('alias projection cannot hide an immutable event-ID conflict or manufacture a new source word ID',()=>{
 assert.throws(()=>dictionary.vocabularyStates([mark(legacy),mark(canonical)]),/标识冲突/);
 const base={id:canonical,word:'apple',pos:'noun',meaning:'苹果（水果）',category:'office',example:'',translation:'',collocation:''};
 const extra={id:legacy,word:'apple',phonetics:['/ˈæp(ə)l/'],senses:[{pos:'noun',meaning:'苹果（水果）'}]};const before=JSON.stringify([base,extra]);
 const merged=dictionary.mergeWordCatalog([base],[extra]);assert.equal(merged[0].id,canonical);assert.equal(JSON.stringify([base,extra]),before);
});
function harness(){
 let owner='usr_11111111-1111-4111-8111-111111111111',cursor=0,slots=[],effects=[],fail=false;const storage=new Map(),writes=[],listeners=new Map();
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const previous=slots[i];slots[i]={deps};effects.push(()=>{previous?.cleanup?.();slots[i].cleanup=fn();});}}};
 const localStorage={get length(){return storage.size;},key:i=>[...storage.keys()][i]??null,getItem:key=>storage.get(key)??null,setItem(key,value){if(fail)throw Error('synthetic quota failure');storage.set(key,String(value));writes.push(key);}};
 const window={addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);}};
 const hook=createSourceLoader({root,imports:{react,sonner:{toast:{error(){}}}},globals:{localStorage,window,fetch(){throw Error('No remote API allowed');}}}).load('lib/use-vocabulary.ts');
 const render=next=>{if(next!==undefined)owner=next;cursor=0;const result=hook.useVocabulary(owner,false);const pending=effects;effects=[];pending.forEach(run=>run());return result;};
 return{storage,localStorage,writes,render,setFail(value){fail=value;},cleanup(){slots.forEach(slot=>slot?.cleanup?.());}};
}
test('real hook appends max-alias revision+1, never rewrites old facts and backup retains original word IDs',()=>{
 const h=harness(),owner='usr_11111111-1111-4111-8111-111111111111',key=model.vocabularyKey(owner);const old=[mark(legacy),review(legacy)];model.writeVocabulary(h.localStorage,key,old);
 const before=new Map(h.storage);h.render();let api=h.render();assert.equal(api.mark(canonical,false),true);api=h.render();
 const backup=api.backup(),current=backup.events.find(event=>event.type==='mark'&&event.wordId===canonical);assert.equal(current.revision,8);assert.equal(current.starred,false);
 for(const [name,bytes]of before)assert.equal(h.storage.get(name),bytes);assert.deepEqual(plain(backup.events.filter(event=>event.wordId===legacy)),plain(old));assert.equal(dictionary.vocabularyStates(backup.events).get(canonical).starred,false);h.cleanup();
});
test('failed alias mark remains unsaved and retry re-reads the same durable max revision',()=>{
 const h=harness(),key=model.vocabularyKey('usr_11111111-1111-4111-8111-111111111111');model.writeVocabulary(h.localStorage,key,[mark(legacy)]);h.render();h.render();h.setFail(true);assert.equal(h.render().mark(canonical,false),false);assert.equal(h.render().backup().events.length,1);
 h.setFail(false);assert.equal(h.render().mark(canonical,false),true);assert.equal(h.render().backup().events.find(event=>event.wordId===canonical).revision,8);h.cleanup();
});
test('A/B/guest revision floors stay partitioned and a departed owner callback cannot append to replacement storage',()=>{
 const h=harness(),a='usr_11111111-1111-4111-8111-111111111111',b='usr_22222222-2222-4222-8222-222222222222';model.writeVocabulary(h.localStorage,model.vocabularyKey(a),[mark(legacy,40)]);h.render();const old=h.render();
 h.render(b);let next=h.render();assert.equal(next.events.length,0);assert.equal(next.mark(canonical,true),true);assert.equal(h.render().backup().events[0].revision,1);
 const before=JSON.stringify([...h.storage]);assert.equal(old.mark(canonical,false),false);assert.equal(JSON.stringify([...h.storage]),before);
 h.render(null);next=h.render();assert.equal(next.events.length,0);assert.equal(next.mark(legacy,true),true);assert.equal(h.render().backup().events[0].revision,1);
 h.render(a);assert.equal(h.render().backup().events[0].revision,40);h.cleanup();
});

// Exact post-admit proof. All dependencies are repository source/data only.
test('the original1346 alias pairs retain their exact ordered values',()=>{
 const pairs=Object.entries(JSON.parse(fs.readFileSync(path.join(root,'content/dictionary-legacy-ids.json'),'utf8')).aliases);
 assert.equal(require('node:crypto').createHash('sha256').update(JSON.stringify(pairs.slice(0,1346))).digest('hex'),'3531be753795475362544ebdc298d0d4d64204d9ef502b2e379e52d461ae11e9');
});
function getDictionaryLibrary(){
 const file=path.join(root,'tests/dictionary.test.cjs'),source=fs.readFileSync(file,'utf8'),end=source.indexOf('const merged =');assert(end>0);
 const exports={};require('node:vm').runInNewContext(source.slice(0,end)+'\nexports.proof={catalog,payload};',{exports,require:require('node:module').createRequire(file),__dirname:path.dirname(file),TextDecoder,TextEncoder,AbortController,setTimeout,clearTimeout,process:{env:{LANTERN_REVIEW_ROOT:root}}},{filename:file});return exports.proof;
}
test('appended aliases prove actual visible admitted teaching IDs and the exact same headword hash',()=>{
 const index=JSON.parse(fs.readFileSync(path.join(root,'content/dictionary-legacy-ids.json'),'utf8')),{catalog,payload}=getDictionaryLibrary(),current=createSourceLoader({root}).load('lib/vocabulary-content-catalog.ts');
 const admitted=new Map(current.FULL4109_CURRENT_LEARNING_ENTRIES.map(row=>[row.word.id,row])),visible=new Map(catalog.learningWords.map(word=>[word.id,word])),dictionaryById=new Map(payload.entries.map(row=>[row.id,row])),expectedNewIds=new Set(["v041-word-a38bcf73d352e4c7ecd5","v041-word-995ebc0e71867f2ca264","v041-word-a7a3c8f654761303e495","v041-word-eb0afd90509c50678e29","v041-word-a8ff1c41b8415cb2ae57","v041-word-be7f251c25c4a89fe8c7","v041-word-2b4b2eadf7b2aece598d","v041-word-1c42ddc0285b9c25135b","v041-word-b393086adbdb19452e69","v041-word-3549b2a205e694bb3089","vx-e0f167bc84b881bc06f6","v041-word-05e884950dccb9aad080","v041-word-827a02fd76a37fa49c71","v041-word-caea47fa084a8512bbe1","v041-word-6df87f4074da1af52b05","v041-word-cf07a76f938476da14a1","v041-word-b0688a56fae3ddb430c1","v041-word-917f771e83f940b557cc","v041-word-4231a97ecfd74fdbdde4","v041-word-1869c9d2a11e8ecde889","v041-word-512eea46ceb3921dff43","v041-word-115dc3606fbf8691fb69","v041-word-b65bf95cc4f9b4b3a52f","v041-word-1c6e6c4c02e55178e858","v041-word-c6de3c105315372cbbc4","v041-word-2355401ce9b52d24dea4","v041-word-372f7e2fd2d01ce2a1d7","v041-word-5a2a0ed9aa3ab7d82b53","vx-bbe81278780d62460410","v041-word-77df49137ca199201044","v041-word-b728b7e775f708faf513","v041-word-2e79db8f9719a84b11d0","v041-word-4cf35cf87435b1ba3c6d","v041-word-19b87ac5ecb1afe2d7f3","v041-word-9ee9e606474e322872c8","v041-word-b90f3c26a4734a89878f","v041-word-2269c0be009b610cfdbb","v041-word-32b36ae43a5ea4895ec8","vx-3a03dc4bfc9586f223ee","v041-word-98d44e13f455d916674d","v041-word-5c599616ac500daae9e6","v041-word-78af7bdb5626eb0a0467","v041-word-f86b1f62a8554232b940","v041-word-3b04837881bb07b621ae","v041-word-3da84369a8baf3835afe","v041-word-30390115b066968fc062","v041-word-d32ce7bf0277fd2ca3b6","v041-word-56c884a0a94e0999d9d4","v041-word-f379ccb92b9116442dc6","v041-word-0b547adfe90823f5cb69","v041-word-4ba69735ca53765ed6a7","v041-word-0c24734d7bf5954f08e5","v041-word-f99c095d32405dac653b","vx-ad9a0cab12eef9063923","v041-word-a5075550e1f2376f804a","v041-word-aee610558292023758a4","v041-word-e0ca449589b67a58abdd"]);
 const key=word=>word.normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' '),hash=word=>require('node:crypto').createHash('sha256').update(key(word)).digest('hex').slice(0,20),added=Object.entries(index.aliases).slice(1346);
 assert.equal(Object.keys(index.aliases).length,1371);assert.equal(added.length,25);
 for(const [legacy,canonical]of added){const row=admitted.get(canonical),word=visible.get(canonical),entry=dictionaryById.get(legacy);assert(row&&word&&entry);assert(expectedNewIds.has(canonical));assert.deepEqual(plain(word),plain(row.word));assert.equal(key(word.word),key(entry.word));assert.equal(hash(word.word),canonical.slice(10));assert.equal(hash(entry.word),legacy.slice(5));}
});
test('new aliases keep distinct reviews and revision max+1 without rewriting source events or backup',()=>{
 const index=JSON.parse(fs.readFileSync(path.join(root,'content/dictionary-legacy-ids.json'),'utf8'));
 for(const [legacy,canonical]of Object.entries(index.aliases).slice(1346)){
  const raw=[mark(legacy,10,true,'new-alias-mark'),review(legacy,'new-alias-review-one'),review(canonical,'new-alias-review-two')],before=JSON.stringify(raw),merged=model.mergeVocabularyEvents(raw,plain(raw));
  assert.equal(merged.length,3);assert.equal(dictionary.vocabularyStates(merged).get(canonical).reviews,2);assert.equal(ids.nextVocabularyMarkRevision(merged,canonical),11);assert.equal(JSON.stringify(raw),before);
  const h=harness(),owner='usr_11111111-1111-4111-8111-111111111111';model.writeVocabulary(h.localStorage,model.vocabularyKey(owner),raw);h.render();const api=h.render();assert.equal(api.mark(canonical,false),true);const backup=h.render().backup();assert.equal(backup.events.find(event=>event.type==='mark'&&event.wordId===canonical).revision,11);assert.deepEqual(plain(backup.events.filter(event=>raw.some(old=>old.id===event.id))),plain(raw));h.cleanup();
 }
});
