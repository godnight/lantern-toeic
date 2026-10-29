'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs'),root=path.resolve(__dirname,'..');
const api=createSourceLoader({root}).load('lib/natural-audio.ts');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
function clip(text='Hello fixture.',key='first'){
 const cacheKey=sha('cache:'+key);
 return {id:'natural-'+cacheKey,text,textSha256:sha(text),cacheKey,sha256:sha('encoded:'+key),bytes:64,durationSeconds:1,codec:'mp3',sampleRateHz:24000,channels:1,bitrateKbps:64,sourceWavSha256:sha('master:'+key),voiceProfileId:'fixture-neutral',locale:'en-US',references:[{materialId:'fixture-'+key,segmentId:'line',kind:'existing-core',contentReview:'fixture'}],qualityStatus:'TECHNICAL_CANDIDATE',humanAccepted:false,publishAllowed:false};
}
function sign(pack){const {packId,manifestSha256,...payload}=pack;pack.manifestSha256=sha(canonical(payload));pack.packId=(pack.schemaVersion===1?'v040-kokoro-':'v040-natural-')+pack.manifestSha256.slice(0,12);return pack;}
function manifest(text='Hello fixture.',key='first'){
 return sign({schemaVersion:1,packId:'',manifestSha256:'',status:'PRIVATE_LOCAL_CANDIDATE',engine:'kokoro',engineIdentity:{model:'synthetic fixture'},generationConfig:{sampleRate:24000},voiceProfileId:'fixture-neutral',locale:'en-US',accentValidated:false,humanAccepted:false,publishAllowed:false,clips:[clip(text,key)],excluded:[],knownAssetSha256Hold:[],sourceFiles:[{path:'synthetic.txt',sha256:sha('fixture')}]});
}
test('complete shipped manifest remains detached, deeply frozen and byte-equivalent after cooperative validation',async()=>{
 const input=JSON.parse(fs.readFileSync(path.join(root,'content/natural-audio-manifest.json'),'utf8')),before=JSON.stringify(input);
 const result=await api.validateNaturalAudioManifest(input,true);assert.notEqual(result,input);assert.equal(sha(JSON.stringify(result)),sha(before));assert.equal(result.manifestSha256,input.manifestSha256);assert.equal(result.clips.length,input.clips.length);assert(Object.isFrozen(result)&&Object.isFrozen(result.clips)&&Object.isFrozen(result.clips[0].references));assert.equal(JSON.stringify(input),before);
});
test('caller mutation immediately after invoking validation cannot affect the captured manifest',async()=>{
 const input=manifest(),before=JSON.stringify(input),pending=api.validateNaturalAudioManifest(input,true);input.clips[0].text='Changed after invocation';input.clips.push(clip('Late clip.','late'));input.publishAllowed=true;
 const result=await pending;assert.equal(JSON.stringify(result),before);assert.equal(result.clips.length,1);assert.equal(result.publishAllowed,false);assert.equal(Object.isFrozen(input),false,'Validation must not freeze the caller object');
});
test('local-candidate authorization and the complete manifest SHA remain mandatory',async()=>{
 await assert.rejects(api.validateNaturalAudioManifest(manifest()),/本地候选/);
 const bad=manifest();bad.manifestSha256='0'.repeat(64);bad.packId='v040-kokoro-'+bad.manifestSha256.slice(0,12);await assert.rejects(api.validateNaturalAudioManifest(bad,true),/清单校验失败/);
});
test('duplicate identities, altered text and held pronunciation cannot be admitted by a valid outer digest',async()=>{
 const duplicate=manifest();duplicate.clips.push(structuredClone(duplicate.clips[0]));sign(duplicate);await assert.rejects(api.validateNaturalAudioManifest(duplicate,true),/重复音频身份/);
 const text=manifest();text.clips[0].text='A different sentence.';sign(text);await assert.rejects(api.validateNaturalAudioManifest(text,true),/文本与清单身份/);
 await assert.rejects(api.validateNaturalAudioManifest(manifest('resume','held'),true),/条目无效/);
 const quarantined=manifest();quarantined.knownAssetSha256Hold=[quarantined.clips[0].sha256];sign(quarantined);await assert.rejects(api.validateNaturalAudioManifest(quarantined,true),/保留名单/);
});
test('clip and aggregate size limits and compiled v2 provenance authority remain unchanged',async()=>{
 const tooLarge=manifest();tooLarge.clips[0].bytes=8*1024*1024+1;sign(tooLarge);await assert.rejects(api.validateNaturalAudioManifest(tooLarge,true),/条目无效/);
 const total=manifest();total.clips=Array.from({length:9},(_,i)=>({...clip('Fixture '+i+'.',String(i)),bytes:8*1024*1024}));sign(total);await assert.rejects(api.validateNaturalAudioManifest(total,true),/本机校验容量/);
 const changed=JSON.parse(fs.readFileSync(path.join(root,'content/natural-audio-manifest.json'),'utf8'));changed.engineIdentity={...changed.engineIdentity,changed:true};sign(changed);await assert.rejects(api.validateNaturalAudioManifest(changed,true),/编译期精确准入表/);
});
test('activation publishes no prefix and a failed replacement keeps the prior exact source',async()=>{
 const registry=new api.NaturalAudioRegistry(),first=manifest(),states=[];registry.subscribe(()=>states.push(registry.getSnapshot().phase));
 const pending=registry.activate(first,{allowLocalCandidate:true});assert.equal(registry.getSnapshot().phase,'preparing');assert.equal(registry.resolve(first.clips[0].text),null);assert.equal((await pending).status,'ready');const source=registry.resolve(first.clips[0].text).sourceId;
 const bad=manifest('Replacement.','bad');bad.clips[0].textSha256='0'.repeat(64);sign(bad);assert.equal((await registry.activate(bad,{allowLocalCandidate:true})).status,'failed');assert.equal(registry.getSnapshot().phase,'error');assert.equal(registry.getSnapshot().activePackId,first.packId);assert.equal(registry.resolve(first.clips[0].text).sourceId,source);assert.equal(registry.resolve(bad.clips[0].text),null);assert.deepEqual(states,['preparing','ready','preparing','error']);
});
test('superseded and aborted preparation cannot install late audio selectors',async()=>{
 const registry=new api.NaturalAudioRegistry(),first=manifest(),second=manifest('The second fixture.','second');
 const old=registry.activate(first,{allowLocalCandidate:true}),current=registry.activate(second,{allowLocalCandidate:true});assert.equal((await old).status,'superseded');assert.equal((await current).status,'ready');assert.equal(registry.getSnapshot().activePackId,second.packId);assert.equal(registry.resolve(first.clips[0].text),null);
 const controller=new AbortController(),late=registry.activate(first,{allowLocalCandidate:true,signal:controller.signal});controller.abort();assert.equal((await late).status,'failed');assert.equal(registry.getSnapshot().activePackId,second.packId);
});
test('audio validation always closes its owned message ports on success and failure',async()=>{
 let closed=0,created=0;class Channel{constructor(){created++;this.port1={onmessage:null,close(){closed++;}};this.port2={postMessage:()=>queueMicrotask(()=>this.port1.onmessage?.({data:0})),close(){closed++;}};}}
 const media=createSourceLoader({root,globals:{MessageChannel:Channel}}).load('lib/natural-audio.ts');await media.validateNaturalAudioManifest(manifest(),true);
 const bad=manifest();bad.clips[0].text='tampered';sign(bad);await assert.rejects(media.validateNaturalAudioManifest(bad,true));assert.equal(created,2);assert.equal(closed,4);
});
