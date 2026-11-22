'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..'),loader=createSourceLoader({root});
const {canonicalJson}=loader.load('lib/domain-command.ts');
const {stageAndActivateRemotePractice,readRemotePracticeAsset}=loader.load('lib/remote-practice-update.ts');
const bytes=s=>new TextEncoder().encode(s),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sign=b=>crypto.createHmac('sha256','synthetic-not-a-production-key').update(b).digest();
const verify=async (manifest,signature)=>{const expected=sign(manifest);return signature.length===expected.length&&crypto.timingSafeEqual(Buffer.from(signature),expected);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function definition(version,revision,change={}){
 const data={
  'questions/catalog.json':bytes(JSON.stringify({version,items:[`${version}-q1`]})),
  'images/picture.png':bytes(`synthetic-image-${version}`),
  'audio/speech.mp3':bytes(`synthetic-audio-${version}`),
 };
 const descriptor=(name,kind,mime)=>({path:name,kind,mime,bytes:data[name].length,sha256:hash(data[name])});
 const manifest={schemaVersion:1,kind:'practice-catalog',version,revision,minAppVersion:'0.4.10',assets:[
  descriptor('questions/catalog.json','catalog','application/json'),descriptor('images/picture.png','image','image/png'),descriptor('audio/speech.mp3','audio','audio/mpeg'),
 ],...change};
 const raw=bytes(canonicalJson(manifest));return {manifest,data,envelope:{manifest:raw,signature:sign(raw)}};
}
function memoryStore(){
 let head=null,watermark={kind:'first-install',proof:'synthetic-one-use-proof'},freshAuthority=true;
 const versions=new Map(),control={discarded:0,failWrite:false,failCommit:false,truncateRead:false,begins:0,fetches:0,
  clearActive(){head=null;},loseWatermark(){watermark=null;},replayFirstInstall(){head=null;watermark={kind:'first-install',proof:'synthetic-one-use-proof'};},
  replaceWatermark(value){watermark=value;}};
 const copyHead=x=>x&&JSON.parse(JSON.stringify(x));
 const state=()=>JSON.parse(JSON.stringify({active:head,watermark}));
 const store={
  async active(){return copyHead(head);},
  async securityState(){return state();},
  async begin(version,manifestHash){
   control.begins++;const files=new Map();let ended=false,sealed=false;
   return {
    async write(name,chunk){if(control.failWrite)throw Error('synthetic quota exceeded');assert(!ended&&!sealed);files.set(name,[...(files.get(name)||[]),Uint8Array.from(chunk)]);},
    async finishWrites(){assert(!ended&&!sealed);sealed=true;},
    async *read(name){const chunks=files.get(name)||[];for(const chunk of chunks){if(control.truncateRead){control.truncateRead=false;yield chunk.slice(0,-1);}else yield Uint8Array.from(chunk);}},
    async commit(envelope,next,expected,signal){
     assert(sealed);if(control.failCommit)throw Error('synthetic transaction aborted');
     if(signal?.aborted||!same(state(),expected))throw Error('synthetic CAS transaction aborted');
     const prior=versions.get(version);if(prior&&prior.head.manifestSha256!==manifestHash)throw Error('immutable version collision');
     const saved={head:copyHead(next),envelope:{manifest:Uint8Array.from(envelope.manifest),signature:Uint8Array.from(envelope.signature)},
      files:new Map([...files].map(([name,chunks])=>[name,chunks.map(chunk=>Uint8Array.from(chunk))]))};
     // These assignments stand for one store transaction in this fake. Its
     // fresh authority is independent of the evictable in-memory state.
     versions.set(version,saved);head=copyHead(next);watermark={kind:'installed',head:copyHead(next)};freshAuthority=false;ended=true;
    },
    async discard(){control.discarded++;ended=true;files.clear();},
   };
  },
  async envelope(version){const saved=versions.get(version);return saved?{manifest:Uint8Array.from(saved.envelope.manifest),signature:Uint8Array.from(saved.envelope.signature)}:null;},
  async *read(version,name){const chunks=versions.get(version)?.files.get(name);if(!chunks)throw Error('synthetic resource missing');for(const chunk of chunks)yield Uint8Array.from(chunk);},
 };
 function dependencies(f,overrides={}){return {store,verify,appVersion:'0.4.10',trustedMinimumRevision:1,
  async verifyFirstInstall(proof){return freshAuthority&&proof==='synthetic-one-use-proof';},
  async *fetch(asset){control.fetches++;const body=f.data[asset.path];if(!body)throw Error('synthetic disconnected');const split=Math.max(1,Math.floor(body.length/2));yield body.slice(0,split);if(split<body.length)yield body.slice(split);},
  async admit(manifest,stage){const catalog=manifest.assets.find(x=>x.kind==='catalog');let result='';for await(const part of stage.read(catalog.path))result+=new TextDecoder().decode(part);const parsed=JSON.parse(result);return parsed.version===manifest.version&&parsed.items.length===1;},...overrides};}
 return {store,control,versions,dependencies};
}
async function setup(){const mem=memoryStore(),a=definition('pack_a',1);await stageAndActivateRemotePractice(a.envelope,mem.dependencies(a));return {mem,a,head:await mem.store.active()};}

test('trusted full B activation retains A for sessions pinned to its version and manifest digest',async()=>{
 const {mem,a,head}=await setup(),b=definition('pack_b',2);
 const session={catalogHead:head,answer:'A'};
 const next=await stageAndActivateRemotePractice(b.envelope,mem.dependencies(b));
 assert.equal(next.version,'pack_b');assert.equal((await mem.store.active()).revision,2);
 for(const name of Object.keys(a.data))assert.deepEqual(Buffer.from(await readRemotePracticeAsset(session.catalogHead,name,mem.dependencies(b))),Buffer.from(a.data[name]));
 assert.equal(session.answer,'A');
 assert.deepEqual(Buffer.from(await readRemotePracticeAsset(next,'audio/speech.mp3',mem.dependencies(b))),Buffer.from(b.data['audio/speech.mp3']));
});

test('manifest trust is checked before any store or network and is isolated from verifier mutation',async()=>{
 const {mem,head}=await setup(),b=definition('pack_b',2);let fetched=mem.control.fetches,begins=mem.control.begins;
 const bad={manifest:b.envelope.manifest,signature:bytes('forged')};
 await assert.rejects(stageAndActivateRemotePractice(bad,mem.dependencies(b)),/untrusted-manifest/);
 assert.equal(mem.control.fetches,fetched);assert.equal(mem.control.begins,begins);assert(same(await mem.store.active(),head));
 const mutateVerifier=async (manifest,signature)=>{const ok=await verify(manifest,signature);manifest.fill(0);signature.fill(0);return ok;};
 const next=await stageAndActivateRemotePractice(b.envelope,mem.dependencies(b,{verify:mutateVerifier}));
 assert.equal((await mem.store.active()).version,'pack_b');
 assert.deepEqual(Buffer.from(await readRemotePracticeAsset(next,'questions/catalog.json',mem.dependencies(b))),Buffer.from(b.data['questions/catalog.json']));
});

test('invalid schema, unsafe paths, duplicates, type, version and app compatibility fail before fetch',async()=>{
 const {mem,head}=await setup(),base=definition('pack_b',2);const cases=[
  {...base.manifest,assets:base.manifest.assets.map((x,i)=>i?x:{...x,path:'../private.json'})},
  {...base.manifest,assets:[...base.manifest.assets,base.manifest.assets[0]]},
  {...base.manifest,assets:base.manifest.assets.map((x,i)=>i?x:{...x,mime:'image/png'})},
  {...base.manifest,assets:base.manifest.assets.map((x,i)=>i?x:{...x,bytes:16*1024*1024+1})},
  {...base.manifest,minAppVersion:'0.5.0'},
  {...base.manifest,revision:1},
  {...base.manifest,unexpected:'extra'},
 ];
 const fetched=mem.control.fetches;
 for(const item of cases){const raw=bytes(canonicalJson(item));await assert.rejects(stageAndActivateRemotePractice({manifest:raw,signature:sign(raw)},mem.dependencies(base)));assert(same(await mem.store.active(),head));}
 assert.equal(mem.control.fetches,fetched);
 const raw=bytes('{"schemaVersion":1,"schemaVersion":1}');
 await assert.rejects(stageAndActivateRemotePractice({manifest:raw,signature:sign(raw)},mem.dependencies(base)),/manifest-canonical/);
});

test('disconnect, truncation, oversized data, wrong hash, corrupted staging, quota and transaction abort preserve A',async()=>{
 for(const fault of ['disconnect','truncated','oversized','hash','stage-read','quota','commit','admission']){
  const {mem,head}=await setup(),b=definition('pack_b',2);let overrides={};
  if(fault==='disconnect')overrides.fetch=async function*(){throw Error('synthetic disconnected');};
  if(fault==='truncated')overrides.fetch=async function*(asset){yield b.data[asset.path].slice(0,-1);};
  if(fault==='oversized')overrides.fetch=async function*(asset){yield new Uint8Array(asset.bytes+1);};
  if(fault==='hash')overrides.fetch=async function*(asset){const x=b.data[asset.path].slice();x[0]^=1;yield x;};
  if(fault==='stage-read')mem.control.truncateRead=true;
  if(fault==='quota')mem.control.failWrite=true;
  if(fault==='commit')mem.control.failCommit=true;
  if(fault==='admission')overrides.admit=async()=>false;
  await assert.rejects(stageAndActivateRemotePractice(b.envelope,mem.dependencies(b,overrides)),undefined,fault);
  assert(same(await mem.store.active(),head),`${fault}: old active changed`);
  assert.equal(await mem.store.envelope('pack_b'),null,`${fault}: version B leaked`);
  assert.equal(mem.control.discarded,1,`${fault}: staged data not discarded`);
  assert.deepEqual(Buffer.from(await readRemotePracticeAsset(head,'audio/speech.mp3',mem.dependencies(b))),Buffer.from(definition('pack_a',1).data['audio/speech.mp3']));
 }
});

test('catalog admission gets read-only sealed data and cannot replace an old version id',async()=>{
 const {mem,head}=await setup(),sameId=definition('pack_a',2);let admitted=false;
 const deps=mem.dependencies(sameId,{async admit(manifest,view){
  admitted=true;assert.equal(typeof view.read,'function');assert.equal(view.write,undefined);assert.equal(view.commit,undefined);return true;
 }});
 await assert.rejects(stageAndActivateRemotePractice(sameId.envelope,deps),/immutable version collision/);
 assert.equal(admitted,true);assert(same(await mem.store.active(),head));
 assert.deepEqual(Buffer.from(await readRemotePracticeAsset(head,'audio/speech.mp3',deps)),Buffer.from(definition('pack_a',1).data['audio/speech.mp3']));
});

test('readback detects evicted or altered media and never substitutes the active version',async()=>{
 const {mem,head}=await setup(),b=definition('pack_b',2);await stageAndActivateRemotePractice(b.envelope,mem.dependencies(b));
 mem.versions.get('pack_a').files.get('audio/speech.mp3')[0][0]^=1;
 await assert.rejects(readRemotePracticeAsset(head,'audio/speech.mp3',mem.dependencies(b)),/asset-hash/);
 mem.versions.get('pack_a').files.delete('images/picture.png');
 await assert.rejects(readRemotePracticeAsset(head,'images/picture.png',mem.dependencies(b)),/resource missing/);
 await assert.rejects(readRemotePracticeAsset({...head,version:'pack_missing'},'audio/speech.mp3',mem.dependencies(b)),/version-missing/);
 assert.equal((await mem.store.active()).version,'pack_b');
});

test('a signed but replaced manifest under the same version cannot change a pinned session',async()=>{
 const {mem,head}=await setup(),replacement=definition('pack_a',1,{minAppVersion:'0.4.9'});
 mem.versions.get('pack_a').envelope=replacement.envelope;
 await assert.rejects(readRemotePracticeAsset(head,'audio/speech.mp3',mem.dependencies(replacement)),/version-mismatch/);
});

test('cancellation and a changed active pointer abort activation without clobbering a newer head',async()=>{
 const {mem,head}=await setup(),b=definition('pack_b',2),controller=new AbortController();
 const cancel=mem.dependencies(b,{signal:controller.signal,fetch:async function*(asset){yield b.data[asset.path];controller.abort();}});
 await assert.rejects(stageAndActivateRemotePractice(b.envelope,cancel),/cancelled/);assert(same(await mem.store.active(),head));
 const c=definition('pack_c',3);let once=false;
 const concurrent=mem.dependencies(b,{admit:async()=>{if(!once){once=true;await stageAndActivateRemotePractice(c.envelope,mem.dependencies(c));}return true;}});
 await assert.rejects(stageAndActivateRemotePractice(b.envelope,concurrent),/CAS/);
 assert.equal((await mem.store.active()).version,'pack_c');assert.equal(await mem.store.envelope('pack_b'),null);
});

test('first installation requires independently verified proof and the compiled minimum revision',async()=>{
 const mem=memoryStore(),old=definition('old_signed',2),first=definition('first_valid',3);
 await assert.rejects(stageAndActivateRemotePractice(old.envelope,mem.dependencies(old,{trustedMinimumRevision:3})),/revision-below-floor/);
 assert.equal(mem.control.begins,0);assert.equal(await mem.store.active(),null);
 await assert.rejects(stageAndActivateRemotePractice(first.envelope,mem.dependencies(first,{trustedMinimumRevision:3,verifyFirstInstall:async()=>false})),/first-install-unverified/);
 assert.equal(mem.control.begins,0);
 const head=await stageAndActivateRemotePractice(first.envelope,mem.dependencies(first,{trustedMinimumRevision:3}));
 assert.equal(head.revision,3);assert.deepEqual((await mem.store.securityState()).watermark,{kind:'installed',head:JSON.parse(JSON.stringify(head))});
 // A replayed fresh-install proof is rejected by the independent authority;
 // a local-empty-database check alone cannot implement that authority.
 mem.control.replayFirstInstall();
 const newer=definition('another',4);
 await assert.rejects(stageAndActivateRemotePractice(newer.envelope,mem.dependencies(newer,{trustedMinimumRevision:3})),/first-install-unverified/);
});

test('an empty active pointer cannot roll back an established watermark; missing watermark fails closed',async()=>{
 const mem=memoryStore(),a=definition('pack_a',10),old=definition('old_signed',9);
 const pinned=await stageAndActivateRemotePractice(a.envelope,mem.dependencies(a,{trustedMinimumRevision:5}));
 mem.control.clearActive();
 await assert.rejects(stageAndActivateRemotePractice(old.envelope,mem.dependencies(old,{trustedMinimumRevision:5})),/revision-rollback/);
 assert.equal(await mem.store.active(),null);
 // Exact revision + identity is allowed for restoring an evicted active head.
 const restored=await stageAndActivateRemotePractice(a.envelope,mem.dependencies(a,{trustedMinimumRevision:5}));
 assert(same(restored,pinned));
 mem.control.clearActive();mem.control.loseWatermark();
 const newer=definition('newer_signed',11),begins=mem.control.begins;
 await assert.rejects(stageAndActivateRemotePractice(newer.envelope,mem.dependencies(newer,{trustedMinimumRevision:5})),/watermark-unavailable/);
 assert.equal(mem.control.begins,begins);assert.equal(await mem.store.active(),null);
 // A previously pinned session still verifies its own signed immutable data.
 assert.deepEqual(Buffer.from(await readRemotePracticeAsset(pinned,'audio/speech.mp3',mem.dependencies(a))),Buffer.from(a.data['audio/speech.mp3']));
});

test('equal revisions require the same manifest identity and inconsistent state fails closed',async()=>{
 const mem=memoryStore(),a=definition('pack_a',8),head=await stageAndActivateRemotePractice(a.envelope,mem.dependencies(a));
 mem.control.clearActive();const conflict=definition('pack_b',8);
 await assert.rejects(stageAndActivateRemotePractice(conflict.envelope,mem.dependencies(conflict)),/revision-conflict/);
 const changed=definition('pack_a',8,{minAppVersion:'0.4.9'});
 await assert.rejects(stageAndActivateRemotePractice(changed.envelope,mem.dependencies(changed)),/revision-conflict/);
 mem.control.replaceWatermark({kind:'installed',head:{...head,revision:0}});
 const newer=definition('newer',9);
 await assert.rejects(stageAndActivateRemotePractice(newer.envelope,mem.dependencies(newer)),/stored-head/);
});

test('concurrent first-install updates compare and publish the high-water mark atomically',async()=>{
 const mem=memoryStore(),older=definition('older',2),newer=definition('newer',3);let once=false;
 const stale=mem.dependencies(older,{admit:async()=>{if(!once){once=true;await stageAndActivateRemotePractice(newer.envelope,mem.dependencies(newer));}return true;}});
 await assert.rejects(stageAndActivateRemotePractice(older.envelope,stale),/CAS/);
 const state=await mem.store.securityState();assert.equal(state.active.version,'newer');assert.equal(state.watermark.head.revision,3);
 assert.equal(await mem.store.envelope('older'),null);
});
