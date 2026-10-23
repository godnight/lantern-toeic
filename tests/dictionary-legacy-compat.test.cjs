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
test('only the1346 proven one-to-one dictionary IDs project; old authored and unknown IDs stay unchanged',()=>{
 const index=JSON.parse(fs.readFileSync(path.join(root,'content/dictionary-legacy-ids.json'),'utf8'));
 assert.equal(ids.DICTIONARY_LEGACY_ALIAS_COUNT,1346);assert.equal(Object.keys(index.aliases).length,1346);assert.equal(new Set(Object.values(index.aliases)).size,1346);
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
