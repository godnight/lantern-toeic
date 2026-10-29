'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs'),root=path.resolve(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function snapshot(){return {FULL4109_CURRENT_MODE:true,FULL4109_CATALOG_STATUS:{configured:true,partitionValid:true,rejectedCount:0,acceptedCount:1},FULL4109_CURRENT_WORDS:[{id:'one'}]};}
function controlled(factory){return createSourceLoader({root,globals:{window:{}},imports:{'./vocabulary-content-admission':{vocabularyCatalogSteps:factory}}}).load('lib/prepare-vocabulary-catalog.ts');}
test('catalog callers share one pending task and cannot read empty or partial statistics',async()=>{
 let runs=0;const ready=snapshot(),api=controlled(function*(){runs++;yield;return ready;});
 assert.throws(()=>api.readPreparedVocabularyCatalog(),/仍在核验/);
 const first=api.prepareVocabularyCatalog(),second=api.prepareVocabularyCatalog();assert.equal(first,second);assert.equal(runs,0,'Heavy admission must not execute in the caller task');
 assert.throws(()=>api.readPreparedVocabularyCatalog(),/仍在核验/);assert.equal(await first,ready);assert.equal(await second,ready);assert.equal(api.readPreparedVocabularyCatalog(),ready);assert.equal(runs,1);
});
test('failed admission stays blocked across mounts and only explicit retry starts the next shared task',async()=>{
 let fail=true,runs=0;const ready=snapshot(),api=controlled(function*(){runs++;yield;if(fail)throw Error('Controlled invalid binding');return ready;});
 await assert.rejects(api.prepareVocabularyCatalog(),/invalid binding/);assert.throws(()=>api.readPreparedVocabularyCatalog(),/仍在核验/);
 await assert.rejects(api.prepareVocabularyCatalog(),/invalid binding/);assert.equal(runs,1);
 fail=false;const retry=api.prepareVocabularyCatalog(true);assert.equal(api.prepareVocabularyCatalog(),retry);assert.equal(await retry,ready);assert.equal(runs,2);
});
test('a rejected or incomplete current partition never publishes a ready catalog',async()=>{
 const invalid=snapshot();invalid.FULL4109_CATALOG_STATUS.rejectedCount=1;const api=controlled(function*(){yield;return invalid;});
 await assert.rejects(api.prepareVocabularyCatalog(),/完整核验未通过/);assert.throws(()=>api.readPreparedVocabularyCatalog(),/仍在核验/);
 assert.throws(()=>api.installServerVocabularyCatalog(()=>invalid),/仍在核验/,'Client callers cannot use the server compatibility path');
});
test('cooperative runner yields between bounded batches and returns only the final result',async()=>{
 const api=controlled(function*(){}),ready=snapshot();let slices=0,done=false;const gate=deferred();
 function* steps(){for(let i=0;i<5000;i++)yield;return ready;}
 const result=api.runVocabularyCatalogSteps(steps(),async()=>{slices++;if(slices===1)await gate.promise;}).then(value=>{done=true;return value;});
 await tick();assert.equal(done,false);assert.equal(slices,1);gate.resolve();assert.equal(await result,ready);assert(slices>=2);
});
test('full cooperative admission preserves the frozen 4040/69, historical selectors, provenance and seven wordbooks digest',async()=>{
 const loader=createSourceLoader({root,globals:{window:{}}}),prepare=loader.load('lib/prepare-vocabulary-catalog.ts');await prepare.prepareVocabularyCatalog();
 const content=loader.load('lib/vocabulary-content-catalog.ts'),audio=loader.load('lib/word-audio-bindings-v040.ts');
 const words=[...content.FULL4109_CURRENT_WORDS,...content.LEGACY_PRIVATE_WORDS],selectors=words.map(word=>[word.id,audio.getWordAudioBindingForSnapshot(word,'headword'),audio.getWordAudioBindingForSnapshot(word,'example'),audio.isPrivateWordAudioBlocked(word)]);
 const workflow=loader.load('lib/workflow-catalog.ts'),admission=loader.load('lib/natural-audio-admission.ts'),identity=admission.compiledNaturalAudioIdentity();
 const admitted=admission.compiledNaturalAudioRows(identity.packId,identity.manifestSha256).map(row=>admission.compiledNaturalAudioAdmission(identity.packId,identity.manifestSha256,{id:row.clipId,cacheKey:row.cacheKey,sha256:row.encodedSha256,sourceWavSha256:row.masterWavSha256,textSha256:row.textSha256,voiceProfileId:row.voiceProfileId,engine:row.engine,provenanceSha256:row.provenanceSha256,legacySourceId:row.legacySourceId,encodingObservationSha256:row.encodingObservationSha256},{materialId:row.materialId,segmentId:row.segmentId,contextHash:row.contextHash,activationAssetKey:row.activationAssetKey}));
 const value={status:content.FULL4109_CATALOG_STATUS,currentWords:content.FULL4109_CURRENT_WORDS,legacyWords:content.LEGACY_PRIVATE_WORDS,selectors,workflowBooks:workflow.WORKFLOW_BOOKS,workflowCatalogs:workflow.WORKFLOW_BOOKS.map(book=>[book.id,workflow.getWorkflowCatalog(book.id).map(w=>w.id)]),admitted};
 assert.equal(content.FULL4109_CURRENT_WORDS.length,4040);assert.equal(content.FULL4109_CATALOG_STATUS.heldCount,69);assert.equal(content.LEGACY_PRIVATE_WORDS.length,540);assert.equal(selectors.length,4580);assert.equal(admitted.length,1951);assert.equal(workflow.WORKFLOW_BOOKS.length,7);
 // Pinned by the existing 691-versus-b247 metadata/selector equivalence run,
 // not computed from the new implementation. No media files are played here.
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),'4ecc0daaac9da962d52558ac64ad8fd903753e1fcd6690a6f7a6ad61332f6d6b');
});
function gateFixture(){
 let cursor=0,pending=[],slots=[],active=true,loaded=0;const ready=deferred();
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useEffect(fn){const i=cursor++;if(!(i in slots)){slots[i]={};pending.push(()=>slots[i].cleanup=fn());}}};
 const jsx=(type,props)=>({type,props}),Content=()=>null;
 const module=createSourceLoader({root,imports:{react,'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/prepare-vocabulary-catalog':{prepareVocabularyCatalog:()=>ready.promise}}}).load('app/learn/prepared-study-content.tsx');
 const props={loader:async()=>{loaded++;return Content;},componentProps:{owner:'A'},current:()=>active};
 return {ready,setActive:value=>active=value,get loaded(){return loaded;},render(){cursor=0;const tree=module.PreparedStudyContent(props);const jobs=pending;pending=[];jobs.forEach(fn=>fn());return tree;},cleanup(){for(const slot of slots)slot?.cleanup?.();},Content};
}
test('an unmounted or expired owner consumer cannot import or mount a late prepared workspace',async()=>{
 for(const expire of [false,true]){const h=gateFixture();assert.notEqual(h.render().type,h.Content);if(expire)h.setActive(false);else h.cleanup();h.ready.resolve();await tick();await tick();assert.equal(h.loaded,0);assert.notEqual(h.render().type,h.Content);h.cleanup();}
 const live=gateFixture();live.render();live.ready.resolve();await tick();await tick();assert.equal(live.loaded,1);assert.equal(live.render().type,live.Content);live.cleanup();
});
