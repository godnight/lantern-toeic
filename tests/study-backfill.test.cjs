'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Module,createRequire}=require('node:module'),{randomUUID,webcrypto}=require('node:crypto');
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'package.json'));
const {IDBFactory}=req('fake-indexeddb'),{buildSync}=req('esbuild');
const source=`export * from './lib/cloud-sync/study-backfill.ts';export * from './lib/cloud-sync/candidate-page.js';export {EMPTY_DATA} from './lib/study-model.ts';`;
const built=buildSync({stdin:{contents:source,resolveDir:root,loader:'js'},bundle:true,write:false,format:'cjs',platform:'node',target:'node24',logLevel:'silent'});
const file=path.join(__dirname,'study-backfill-bundle.cjs'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(__dirname);mod._compile(built.outputFiles[0].text,file);
const {backfillNativeStudy,openSyntheticSyncDatabase,createCandidatePageClient,EMPTY_DATA}=mod.exports;
const A='usr_00000000-0000-4000-8000-000000000001',B='usr_00000000-0000-4000-8000-000000000002',when='2026-01-01T10:00:00.000Z';
const event=(mode,qid='q')=>({id:randomUUID(),qid,choice:0,correct:true,createdAt:when,seconds:3,mode});
const checkin=()=>({id:randomUUID(),date:'2026-01-01',minutes:4,load:'轻',note:'',createdAt:when});
function storage(){const raw=new Map();return {raw,get length(){return raw.size;},key(i){return [...raw.keys()][i]??null;},getItem(k){return raw.get(k)??null;},setItem(k,v){raw.set(k,String(v));},removeItem(k){raw.delete(k);}};}
function data(attempts=[],checkins=[]){return {...structuredClone(EMPTY_DATA),attempts,checkins};}
function putPrimary(s,owner,d){s.setItem('lantern-v1-'+owner,JSON.stringify({data:d}));}
function putCheckpoint(s,owner,d){s.setItem('lantern-v1-'+owner+':checkpoint:'+randomUUID(),JSON.stringify({kind:'lantern-study-checkpoint',version:1,owner,data:d}));}
function putOp(s,owner,type,item,id=randomUUID()){s.setItem('lantern-v1-'+owner+':op:'+id,JSON.stringify({id,owner,type,data:item}));return id;}
async function setup(name,factory=new IDBFactory()){const db=await openSyntheticSyncDatabase(factory,'lantern-synthetic-sync-'+name),fail=async()=>{throw Error('network should not be used');};const client=createCandidatePageClient({db,vocabTransport:{append:fail,begin:fail,page:fail},studyTransport:{upload:fail,pull:fail}});await client.activate(A);return {db,client,factory};}

test('disabled by default; stages real primary, checkpoint and loose events without mutating source and rescans idempotently',async()=>{
 const s=storage(),first=event('first'),review=event('review'),day=checkin();putPrimary(s,A,data([first]));putCheckpoint(s,A,data([first,review]));putOp(s,A,'checkin',day);putPrimary(s,B,data([event('first')]));
 const before=[...s.raw],{db,client}=await setup('backfill-mixed');try{
  await assert.rejects(backfillNativeStudy({storage:s,client}),/disabled/);
  assert.deepEqual(await backfillNativeStudy({enabled:true,storage:s,client}),{staged:3,deferred:[]});
  assert.deepEqual(await backfillNativeStudy({enabled:true,storage:s,client}),{staged:3,deferred:[]});
  const state=await client.readStudy();assert.equal(state.pendingOperations.length,3);assert.equal(state.data.attempts.length,2);assert.equal(state.data.checkins.length,1);
  assert.equal(state.pendingOperations.find(x=>x.data.id===review.id).firstAttemptId,first.id);assert.deepEqual([...s.raw],before);
 }finally{await client.cancel();db.close();}
});
test('reuses an existing loose-operation mapping and keeps ambiguous or missing roots deferred',async()=>{
 const s=storage(),first=event('first','good'),review=event('review','good'),missing=event('review','missing'),a=event('first','ambiguous'),b=event('first','ambiguous');
 putPrimary(s,A,data([first,review,missing,a,b]));const old=putOp(s,A,'attempt',first),{db,client}=await setup('backfill-existing');try{
  await client.answer('attempt',first,undefined,old,first.id);
  const result=await backfillNativeStudy({enabled:true,storage:s,client});assert.equal(result.staged,2);assert.deepEqual(result.deferred.sort(),[missing.id,a.id,b.id].sort());
  const state=await client.readStudy();assert.equal(state.pendingOperations.length,2);assert.equal(state.pendingOperations.find(x=>x.data.id===first.id).id,old);
 }finally{await client.cancel();db.close();}
});
test('conflicting facts or corrupt source reject before staging and preserve all bytes',async()=>{
 const s=storage(),first=event('first');putPrimary(s,A,data([first]));putCheckpoint(s,A,data([{...first,mode:'review'}]));const before=[...s.raw],{db,client}=await setup('backfill-conflict');try{
  await assert.rejects(backfillNativeStudy({enabled:true,storage:s,client}),/conflicting/);assert.equal((await client.readStudy()).pendingOperations.length,0);assert.deepEqual([...s.raw],before);
 }finally{await client.cancel();db.close();}
});
test('the same required-schema guard as the app blocks newer unsupported local data',async()=>{
 const s=storage();putPrimary(s,A,data([event('first')]));s.setItem('lantern-v1-'+A+':required-schema',JSON.stringify({schemaVersion:99}));
 const before=[...s.raw],{db,client}=await setup('backfill-schema');try{
  await assert.rejects(backfillNativeStudy({enabled:true,storage:s,client}),/版本不受支持/);
  assert.equal((await client.readStudy()).pendingOperations.length,0);assert.deepEqual([...s.raw],before);
 }finally{await client.cancel();db.close();}
});
test('source change or account switch during staging fails and keeps original source for idempotent retry',async()=>{
 const s=storage(),first=event('first');putPrimary(s,A,data([first]));const {db,client}=await setup('backfill-switch');try{
  const session=client.session;let calls=0;const wrapping={get session(){return client.session;},async answer(...args){calls++;const value=await client.answer(...args);if(calls===1)s.setItem('lantern-v1-'+A+':op:'+randomUUID(),JSON.stringify({id:randomUUID()}));return value;}};
  await assert.rejects(backfillNativeStudy({enabled:true,storage:s,client:wrapping}),/source changed/);assert.equal((await client.readStudy()).pendingOperations.length,1);assert.equal(client.session,session);
  await client.cancel();await assert.rejects(backfillNativeStudy({enabled:true,storage:s,client}),/lease unavailable/);
 }finally{await client.cancel();db.close();}
});
test('backfill does not stage a stale event when its source changes during the IDB preparation',async()=>{
 const s=storage(),first=event('first');putPrimary(s,A,data([first]));const {db,client}=await setup('backfill-staging-source-race');
 const subtle=globalThis.crypto.subtle,own=Object.getOwnPropertyDescriptor(subtle,'digest'),original=subtle.digest.bind(subtle);let count=0;
 try{
  Object.defineProperty(subtle,'digest',{configurable:true,value:async(...args)=>{
   if(++count===2)putPrimary(s,A,data([{...first,choice:2}]));
   return original(...args);
  }});
  await assert.rejects(backfillNativeStudy({enabled:true,storage:s,client}),/study source changed/);
  const result=await client.readStudy();assert.equal(result.pendingOperations.length,0);assert.equal(result.data.attempts.length,0);assert.equal(result.eventLinks.length,0);
  assert.equal(JSON.parse(s.getItem('lantern-v1-'+A)).data.attempts[0].choice,2);
 }finally{if(own)Object.defineProperty(subtle,'digest',own);else delete subtle.digest;await client.cancel();db.close();}
});
test('legacy acknowledged event without a link stays deferred together with its reviews',async()=>{
 const s=storage(),first=event('first'),review=event('review');putPrimary(s,A,data([first,review]));const before=[...s.raw],{db,client}=await setup('backfill-legacy-ack');try{
  const prior=await client.readStudy();prior.data.attempts.push(first);prior.uploadAcks.push({id:randomUUID(),fingerprint:'0'.repeat(64)});delete prior.eventLinks;
  await new Promise((resolve,reject)=>{const tx=db.transaction('syntheticNativeStudyState','readwrite');tx.objectStore('syntheticNativeStudyState').put(prior);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  const result=await backfillNativeStudy({enabled:true,storage:s,client});assert.equal(result.staged,0);assert.deepEqual(result.deferred.sort(),[first.id,review.id].sort());
  const next=await client.readStudy();assert.equal(next.pendingOperations.length,0);assert.equal(next.uploadAcks.length,1);assert.deepEqual([...s.raw],before);
 }finally{await client.cancel();db.close();}
});
test('when the account changes during an enqueue the importer cannot stage into the new account',async()=>{
 const s=storage();putPrimary(s,A,data([event('first'),event('review')]));const {db,client}=await setup('backfill-account-swap');try{
  let called=0;const wrapper={get session(){return client.session;},async answer(...args){called++;await client.answer(...args);if(called===1)await client.activate(B);}};
  await assert.rejects(backfillNativeStudy({enabled:true,storage:s,client:wrapper}),/lease changed/);assert.equal((await client.readStudy()).owner,B);assert.equal((await client.readStudy()).pendingOperations.length,0);
 }finally{await client.cancel();db.close();}
});
test('a process restart can rescan the same staged local events without duplicates',async()=>{
 const s=storage(),first=event('first'),review=event('review');putPrimary(s,A,data([first,review]));let ctx=await setup('backfill-restart');const factory=ctx.factory;try{
  await backfillNativeStudy({enabled:true,storage:s,client:ctx.client});const before=await ctx.client.readStudy();
  await ctx.client.cancel();ctx.db.close();ctx=await setup('backfill-restart',factory);
  await backfillNativeStudy({enabled:true,storage:s,client:ctx.client});const after=await ctx.client.readStudy();
  assert.equal(after.pendingOperations.length,2);assert.deepEqual(after.pendingOperations,before.pendingOperations);assert.equal(after.eventLinks.length,2);
 }finally{await ctx.client.cancel();ctx.db.close();}
});

async function guardedBackfill(name,s){
 const db=await openSyntheticSyncDatabase(new IDBFactory(),'lantern-synthetic-sync-'+name),sent=[],done=Promise.withResolvers();
 const conflict=async()=>{const e=Error('synthetic vocabulary conflict');e.code='NATIVE_EVENT_CONFLICT';throw e;};
 const target={addEventListener(){},removeEventListener(){}};
 const client=createCandidatePageClient({db,vocabTransport:{append:conflict,begin:conflict,page:conflict},studyTransport:{upload:async p=>{sent.push(p.wire);return {status:200,body:{ok:true}};},pull:async p=>({syncProtocol:'native-m2a-v1',schemaVersion:2,owner:p.owner,hasProfile:false,profilePolicy:'preserve-local-when-absent',changes:[],nextCursor:null,checkpoint:'n1.'+'A'.repeat(2086)})},autoCapture:{storage:s,target}});
 const run=client.run;client.run=(...args)=>{const result=run(...args);result.then(value=>done.resolve({value}),error=>done.resolve({error}));return result;};
 await client.activate(A);return {db,client,sent,done:done.promise};
}
async function settlePump(done){let timer;try{return await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('candidate pump timeout')),3000);})]);}finally{clearTimeout(timer);}}
test('candidate pump permits matching backfill from primary and checkpoint without loose operations',async()=>{
 const s=storage(),first=event('first'),review=event('review'),day=checkin();putPrimary(s,A,data([first],[]));putCheckpoint(s,A,data([first,review],[day]));
 const {db,client,sent,done}=await guardedBackfill('backfill-guard-valid',s),before=[...s.raw];try{
  assert.deepEqual(await backfillNativeStudy({enabled:true,storage:s,client}),{staged:3,deferred:[]});
  client.start(A);await settlePump(done);const state=await client.readStudy();
  assert.equal(sent.length,3);assert.equal(state.pendingOperations.length,0);assert.equal(state.uploadAcks.length,3);assert.deepEqual([...s.raw],before);
  assert.equal(sent.find(x=>x.data.id===review.id).data.firstAttemptId,first.id);
 }finally{await client.cancel();db.close();}
});
test('candidate refuses stale or missing reconstructed source and ambiguous first anchors',async()=>{
 for(const scenario of ['changed','removed','ambiguous','root-payload-conflict']){
  const s=storage(),first=event('first');putPrimary(s,A,data([first]));const {db,client,sent,done}=await guardedBackfill('backfill-guard-'+scenario,s);
  try{
   await backfillNativeStudy({enabled:true,storage:s,client});
   if(scenario==='changed')putPrimary(s,A,data([{...first,choice:2}]));
   if(scenario==='removed')s.removeItem('lantern-v1-'+A);
   if(scenario==='ambiguous')putCheckpoint(s,A,data([first,event('first')]));
   if(scenario==='root-payload-conflict')putCheckpoint(s,A,data([{...first,correct:!first.correct}]));
   client.start(A);await settlePump(done);const state=await client.readStudy();
   assert.equal(sent.length,0,scenario);assert.equal(state.pendingOperations.length,1,scenario);assert.equal(state.uploadAcks.length,0,scenario);
  }finally{await client.cancel();db.close();}
 }
});
test('source change during reconstructed-id hashing prevents dispatch',async()=>{
 const s=storage(),first=event('first');putPrimary(s,A,data([first]));const {db,client,sent,done}=await guardedBackfill('backfill-guard-hash-race',s);
 const waiting=Promise.withResolvers(),release=Promise.withResolvers(),subtle=globalThis.crypto.subtle,own=Object.getOwnPropertyDescriptor(subtle,'digest'),original=subtle.digest.bind(subtle);let count=0;
 try{
  await backfillNativeStudy({enabled:true,storage:s,client});
  Object.defineProperty(subtle,'digest',{configurable:true,value:async(...args)=>{if(++count===2){waiting.resolve();await release.promise;}return original(...args);}});
  client.start(A);await waiting.promise;putPrimary(s,A,data([{...first,choice:2}]));release.resolve();await settlePump(done);
  assert.equal(sent.length,0);assert.equal((await client.readStudy()).pendingOperations.length,1);
 }finally{release.resolve();if(own)Object.defineProperty(subtle,'digest',own);else delete subtle.digest;await client.cancel();db.close();}
});
test('a no-journal operation with a non-backfill id cannot use snapshot evidence',async()=>{
 const s=storage(),first=event('first');putPrimary(s,A,data([first]));const {db,client,sent,done}=await guardedBackfill('backfill-guard-wrong-id',s);
 try{await client.answer('attempt',first,client.session,randomUUID(),first.id);client.start(A);await settlePump(done);assert.equal(sent.length,0);assert.equal((await client.readStudy()).pendingOperations.length,1);}
 finally{await client.cancel();db.close();}
});
