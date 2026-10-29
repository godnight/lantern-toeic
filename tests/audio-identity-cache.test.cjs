'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..'),domain=createSourceLoader({root}).load('lib/domain-command.ts');
const binding=()=>({wordId:'word-fixture',slot:'headword',textSha256:'a'.repeat(64),snapshotContextSha256:'b'.repeat(64),requestContextHash:'c'.repeat(64),mp3Sha256:'d'.repeat(64),audio:{audioKey:'asset',materialId:'material',segmentId:'headword',voiceProfileId:'voice'}});
function digestModule(){let hashes=0;const module=createSourceLoader({root,imports:{'../content/natural-audio-catalog-v1.json':{__esModule:true,default:{}},'./domain-command':{...domain,canonicalHash:value=>{hashes++;return domain.canonicalHash(value);}}}}).load('lib/natural-audio-catalog-index.ts');return {module,hashes:()=>hashes};}

test('immutable binding digests retain full identity and avoid repeated SHA work',()=>{
 const e=digestModule(),row=binding();Object.freeze(row.audio);Object.freeze(row);
 const first=e.module.naturalAudioBindingDigest(row);
 for(let i=0;i<20;i++)assert.equal(e.module.naturalAudioBindingDigest(row),first);
 assert.equal(e.hashes(),1);
});
for(const shallow of [false,true])test('mutable binding data is never hidden by cached identity; shallow freeze='+shallow,()=>{
 const e=digestModule(),row=binding();if(shallow)Object.freeze(row);
 const first=e.module.naturalAudioBindingDigest(row);row.audio.voiceProfileId='other-voice';
 assert.notEqual(e.module.naturalAudioBindingDigest(row),first);assert.equal(e.hashes(),2);
});
test('frozen accessors cannot make a stale audio binding digest authoritative',()=>{
 const e=digestModule(),row=binding();let key='asset';Object.defineProperty(row.audio,'audioKey',{enumerable:true,get:()=>key});Object.freeze(row.audio);Object.freeze(row);
 const first=e.module.naturalAudioBindingDigest(row);key='other';assert.notEqual(e.module.naturalAudioBindingDigest(row),first);assert.equal(e.hashes(),2);
});

function wordModule(){let hashes=0;const module=createSourceLoader({root,imports:{'../content/word-audio-bindings-v040.json':{__esModule:true,default:{schemaVersion:1,packId:'fixture',bindings:[],globalPronunciationHoldKeys:[]}},'./natural-audio-admission':{compiledBindingAdmission:()=>null,compiledCvWordException:()=>false,compiledIndexedBindingAdmission:()=>false,naturalAudioBindingDigest:()=>null},'./domain-command':{...domain,canonicalHash:value=>{hashes++;return domain.canonicalHash(value);}}}}).load('lib/word-audio-bindings-v040.ts');return {module,hashes:()=>hashes};}
const word=()=>({id:'fixture-word',word:'fixture',pos:'n.',meaning:'合成',example:'A synthetic fixture.',translation:'合成例句。'});
test('only fully immutable word values reuse context and authored-text hashes',()=>{
 const e=wordModule(),w=Object.freeze(word()),context=e.module.wordAudioSnapshotContext(w);
 for(let i=0;i<20;i++){assert.equal(e.module.wordAudioSnapshotContext(w),context);assert.equal(e.module.getCurrentWordAudioBindingForSnapshot(w,'headword'),null);}
 assert.equal(e.hashes(),2,'one context and one text digest, with no admission invented');
});
test('mutable snapshots and frozen getter snapshots still observe changed context',()=>{
 for(const getter of [false,true]){const e=wordModule(),w=word();let meaning=w.meaning;if(getter){Object.defineProperty(w,'meaning',{enumerable:true,get:()=>meaning});Object.freeze(w);}const first=e.module.wordAudioSnapshotContext(w);if(getter)meaning='changed';else w.meaning='changed';assert.notEqual(e.module.wordAudioSnapshotContext(w),first);}
});

function admission(duplicate=false){
 const row={clipId:'clip',cacheKey:'asset',activationAssetKey:'alias',encodedSha256:'d'.repeat(64),materialId:'material',segmentId:'headword',contextHash:'c'.repeat(64),voiceProfileId:'voice',textSha256:'a'.repeat(64)};
 return createSourceLoader({root,imports:{'../content/natural-audio-admission-v2.json':{__esModule:true,default:{schemaVersion:1,packId:'fixture-pack',manifestSha256:'f'.repeat(64),entries:duplicate?[row,{...row}]:[row],wordExceptions:[]}},'./natural-audio-catalog-index':{compiledNaturalAudioCatalog:null,compiledNaturalAudioPack:()=>null}}}).load('lib/natural-audio-admission.ts');
}
test('indexed admission still checks the full tuple, aliases and duplicate ambiguity',()=>{
 const actual=admission(),row=binding();assert(actual.compiledBindingAdmission('fixture-pack',row));
 assert(actual.compiledBindingAdmission('fixture-pack',{...row,audio:{...row.audio,audioKey:'alias'}}));
 for(const change of [{requestContextHash:'changed'},{mp3Sha256:'changed'},{audio:{...row.audio,voiceProfileId:'changed'}},{audio:{...row.audio,audioKey:'unknown'}}])assert.equal(actual.compiledBindingAdmission('fixture-pack',{...row,...change}),null);
 assert.equal(admission(true).compiledBindingAdmission('fixture-pack',row),null);
});
