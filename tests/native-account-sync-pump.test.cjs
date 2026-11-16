'use strict';
// Actual account lifecycle, source reader and candidate IDB queue; no device,
// production credentials, real service or user data is used.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Module}=require('node:module'),{randomUUID}=require('node:crypto'),{buildSync}=require('esbuild'),{IDBFactory}=require('fake-indexeddb');
const root=path.resolve(__dirname,'..');
const source=`export {NativeAccountController} from './lib/native-account-controller.ts';
export {attachNativeAccountSync} from './lib/cloud-sync/native-account-root.ts';
export {createNativeSyncLifecycle} from './lib/cloud-sync/native-lifecycle.ts';
export * from './lib/cloud-sync/candidate-page.js';
export {STORE} from './lib/cloud-sync/offline-queue.js';
export {writeVocabulary,vocabularyKey,vocabularyBackup,vocabularyReviewHash} from './lib/vocabulary-model.ts';`;
const bundle=buildSync({stdin:{contents:source,resolveDir:root,loader:'js'},bundle:true,write:false,format:'cjs',platform:'node',target:'node24',logLevel:'silent'});
const filename=path.join(__dirname,'native-account-sync-pump-bundle.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(__dirname);mod._compile(bundle.outputFiles[0].text,filename);
const app=mod.exports,A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},B={id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function storage(){const rows=new Map();let reads=0;return {rows,get reads(){return reads;},get length(){return rows.size;},key(i){reads++;return [...rows.keys()][i]??null;},getItem(k){reads++;return rows.get(k)??null;},setItem(k,v){rows.set(k,String(v));}};}
const read=(db,owner)=>new Promise((resolve,reject)=>{const r=db.transaction(app.STORE).objectStore(app.STORE).get(owner);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
function target(){const listeners=new Map();return {addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},dispatch(type,details={}){for(const fn of listeners.get(type)??[])fn({type,...details});},count(){return [...listeners.values()].reduce((n,s)=>n+s.size,0);}};}
test('real owner source waits for native resume before capture and is fenced on account change',async()=>{
 const local=storage(),view=target(),factory=new IDBFactory(),resume=deferred(),entered=deferred();
 const word={id:'review-synthetic',wordId:'archive',createdAt:'2026-01-01T10:00:00.000Z',type:'review',grade:'remembered'};
 const mark={id:'mark-synthetic',wordId:'archive',createdAt:'2026-01-01T10:01:00.000Z',type:'mark',starred:true,revision:1};
 app.writeVocabulary(local,app.vocabularyKey(A.id),[word]);app.writeVocabulary(local,app.vocabularyKey(A.id),[mark],{captureNewMark:true});const before=[...local.rows.entries()];
 let user=A,seq=0,notify=()=>{},networkCalls=0;
 const native={snapshot:async()=>({owner:user.id,seq}),subscribeRevocation(fn){notify=fn;return()=>{notify=()=>{};};},drain:async()=>{},hold:async()=>{},complete:async()=>{},resume:async()=>{entered.resolve();await resume.promise;},dispose(){}};
 const transport={dispose(){},cancelAll(){},async request(action){
  if(action==='session')return {status:200,version:2,body:{user,capabilities:{passwordLogin:true,phoneLogin:false},session:{validForMs:3600000}}};
  if(action==='login'){user=B;seq++;notify();return {status:200,body:{}};}throw Error('unexpected');}};
 const offline=()=>{networkCalls++;const e=Error('offline');e.code='NATIVE_TRANSIENT';throw e;};
 const db=await app.openSyntheticSyncDatabase(factory,'lantern-synthetic-sync-native-pump');
 const client=app.createCandidatePageClient({db,vocabTransport:{append:offline,begin:offline,page:offline},studyTransport:{upload:offline,pull:offline},autoCapture:{storage:local,target:view}});
 // The actual-source importer must handle mark chunks too; running the legacy
 // mark path first would enqueue without that importer's source guard.
 client.vocabulary=()=>{throw Error('legacy mark scanner must not run');};
 const account=new app.NativeAccountController(transport,{now:()=>0,set:()=>1,clear:()=>{}});
 const detach=app.attachNativeAccountSync(account,{enabled:true,createClient:()=>client,createPort:()=>native});
 try{
  account.start();await entered.promise;const beforeResumeReads=local.reads;await tick();await tick();
  assert.equal(local.reads,beforeResumeReads);assert.equal(networkCalls,0);assert.equal(view.count(),0);
  resume.resolve();for(let i=0;i<100;i++){await tick();const state=await read(db,A.id);if(state?.queue.length===2)break;}
  const state=await read(db,A.id);assert.deepEqual(state.queue.map(item=>item.id).sort(),[mark.id,word.id].sort());assert.deepEqual([...local.rows.entries()],before);
  const old=client.session;await account.mutate('login',{username:'synthetic_b',password:'synthetic-password'});assert.equal(old.signal.aborted,true);
  for(let i=0;i<15&&client.session?.owner!==B.id;i++)await tick();
  assert.notEqual(client.session,old);assert.deepEqual([...local.rows.entries()],before);
 }finally{resume.resolve();detach();account.dispose();await client.cancel();db.close();}
});
test('orphan correction retains its source while independent vocabulary and study uploads proceed',async()=>{
 const local=storage(),view=target(),key=app.vocabularyKey(A.id),db=await app.openSyntheticSyncDatabase(new IDBFactory(),'lantern-synthetic-sync-source-isolate');
 const independent={id:'independent-review',wordId:'archive',createdAt:'2026-01-01T10:00:00.000Z',type:'review',grade:'remembered'};
 const missing={id:'missing-review',wordId:'other',createdAt:'2026-01-01T09:00:00.000Z',type:'review',grade:'remembered'};
 const orphan={id:'orphan-correction',wordId:'other',createdAt:'2026-01-01T11:00:00.000Z',type:'review-correction',reviewId:missing.id,reviewHash:app.vocabularyReviewHash(missing),grade:'again'};
 app.writeVocabulary(local,key,[independent]);local.setItem(key+'orphan',JSON.stringify(app.vocabularyBackup([orphan])));
 const id=randomUUID(),checkin={id:randomUUID(),date:'2026-01-01',minutes:4,load:'轻',note:'synthetic',createdAt:'2026-01-01T10:00:00.000Z'};
 local.setItem('lantern-v1-'+A.id+':op:'+id,JSON.stringify({id,owner:A.id,type:'checkin',data:checkin}));const before=[...local.rows.entries()];
 const sent=[],study=[],checkpoint='n1.'+'A'.repeat(2086);let vocabDownloads=0;
 const vt={append:async p=>{sent.push(p.event.id);return {ok:true,owner:p.owner,id:p.event.id};},begin:async()=>{vocabDownloads++;throw Error('must not advance');},page:async()=>{throw Error('must not page');}};
 const st={upload:async p=>{study.push(p.wire.data.id);return {status:200,body:{ok:true}};},pull:async p=>({syncProtocol:'native-m2a-v1',schemaVersion:2,owner:p.owner,hasProfile:false,profilePolicy:'preserve-local-when-absent',changes:[],nextCursor:null,checkpoint})};
 const client=app.createCandidatePageClient({db,vocabTransport:vt,studyTransport:st,autoCapture:{storage:local,target:view}});
 try{await client.activate(A.id);client.start(A.id);for(let i=0;i<200&&study.length===0;i++)await tick();
  assert.deepEqual(sent,[independent.id]);assert.deepEqual(study,[checkin.id]);assert.equal(vocabDownloads,0);
  assert.equal((await read(db,A.id)).download.snapshot,null);assert.deepEqual([...local.rows.entries()],before);
 }finally{await client.cancel();db.close();}
});
test('a source payload conflict never uploads the older queued payload but does not block independent work',async()=>{
 const local=storage(),view=target(),key=app.vocabularyKey(A.id),db=await app.openSyntheticSyncDatabase(new IDBFactory(),'lantern-synthetic-sync-source-conflict');
 const conflict={id:'same-review',wordId:'archive',createdAt:'2026-01-01T10:00:00.000Z',type:'review',grade:'remembered'};
 const independent={id:'independent-mark',wordId:'other',createdAt:'2026-01-01T10:01:00.000Z',type:'mark',starred:true,revision:1};
 app.writeVocabulary(local,key,[conflict]);app.writeVocabulary(local,key,[independent]);
 const id=randomUUID(),checkin={id:randomUUID(),date:'2026-01-01',minutes:4,load:'轻',note:'synthetic',createdAt:'2026-01-01T10:00:00.000Z'};
 local.setItem('lantern-v1-'+A.id+':op:'+id,JSON.stringify({id,owner:A.id,type:'checkin',data:checkin}));
 const sent=[],study=[],checkpoint='n1.'+'A'.repeat(2086);let downloads=0;
 const vt={append:async p=>{sent.push(p.event.id);return {ok:true,owner:p.owner,id:p.event.id};},begin:async()=>{downloads++;throw Error('must not advance');},page:async()=>{throw Error('must not page');}};
 const st={upload:async p=>{study.push(p.wire.data.id);return {status:200,body:{ok:true}};},pull:async p=>({syncProtocol:'native-m2a-v1',schemaVersion:2,owner:p.owner,hasProfile:false,profilePolicy:'preserve-local-when-absent',changes:[],nextCursor:null,checkpoint})};
 const client=app.createCandidatePageClient({db,vocabTransport:vt,studyTransport:st,autoCapture:{storage:local,target:view}});
 try{await client.activate(A.id);await client.vocabulary({...conflict,grade:'again'});client.start(A.id);
  for(let i=0;i<200&&study.length===0;i++)await tick();
  assert.deepEqual(sent,[independent.id]);assert.deepEqual(study,[checkin.id]);assert.equal(downloads,0);
  const state=await read(db,A.id);assert.equal(state.queue.find(x=>x.id===conflict.id).acked,false);assert.equal(state.download.snapshot,null);
 }finally{await client.cancel();db.close();}
});
test('source changes during capture retry with bounded delay and preserve both events',async()=>{
 const local=storage(),view=target(),key=app.vocabularyKey(A.id),db=await app.openSyntheticSyncDatabase(new IDBFactory(),'lantern-synthetic-sync-source-retry');
 const first={id:'review-first',wordId:'archive',createdAt:'2026-01-01T10:00:00.000Z',type:'review',grade:'remembered'};
 const second={id:'review-second',wordId:'other',createdAt:'2026-01-01T10:01:00.000Z',type:'review',grade:'remembered'};
 app.writeVocabulary(local,key,[first]);const sent=[];
 const vt={append:async p=>{sent.push(p.event.id);return {ok:true,owner:p.owner,id:p.event.id};},begin:async()=>{const e=Error('offline');e.code='NATIVE_TRANSIENT';throw e;},page:async()=>{throw Error('unexpected');}};
 const st={upload:async()=>{throw Error('unexpected');},pull:async()=>{throw Error('unexpected');}};
 const client=app.createCandidatePageClient({db,vocabTransport:vt,studyTransport:st,autoCapture:{storage:local,target:view}});
 const enqueue=client.importVocabularySource;let changed=false;
 client.importVocabularySource=(...args)=>{if(!changed){changed=true;app.writeVocabulary(local,key,[second]);view.dispatch('lantern-vocabulary-changed',{detail:key});}return enqueue(...args);};
 try{await client.activate(A.id);client.start(A.id);const deadline=Date.now()+4000;
  while(sent.length<2&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual([...new Set(sent)].sort(),[first.id,second.id].sort());assert.equal(local.rows.size,2);
 }finally{await client.cancel();db.close();}
});
test('source changes during an in-flight append retain the operation and retry its original ID',async()=>{
 const local=storage(),view=target(),key=app.vocabularyKey(A.id),db=await app.openSyntheticSyncDatabase(new IDBFactory(),'lantern-synthetic-sync-source-inflight');
 const first={id:'review-inflight',wordId:'archive',createdAt:'2026-01-01T10:00:00.000Z',type:'review',grade:'remembered'};
 const second={id:'review-added',wordId:'other',createdAt:'2026-01-01T10:01:00.000Z',type:'review',grade:'remembered'};
 app.writeVocabulary(local,key,[first]);const sent=[];let changed=false;
 const vt={append:async p=>{sent.push(p.event.id);if(!changed){changed=true;app.writeVocabulary(local,key,[second]);view.dispatch('lantern-vocabulary-changed',{detail:key});}return {ok:true,owner:p.owner,id:p.event.id};},begin:async()=>{const e=Error('offline');e.code='NATIVE_TRANSIENT';throw e;},page:async()=>{throw Error('unexpected');}};
 const st={upload:async()=>{throw Error('unexpected');},pull:async()=>{throw Error('unexpected');}};
 const client=app.createCandidatePageClient({db,vocabTransport:vt,studyTransport:st,autoCapture:{storage:local,target:view}});
 try{await client.activate(A.id);client.start(A.id);const deadline=Date.now()+4000;
  while((sent.filter(id=>id===first.id).length<2||!sent.includes(second.id))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(sent.filter(id=>id===first.id).length,2);assert.ok(sent.includes(second.id));assert.equal(local.rows.size,2);
 }finally{await client.cancel();db.close();}
});
for(const kind of ['malformed-source','auth','global-conflict'])test(`${kind} stops all candidate network progress`,async()=>{
 const local=storage(),view=target(),key=app.vocabularyKey(A.id),db=await app.openSyntheticSyncDatabase(new IDBFactory(),'lantern-synthetic-sync-stop-'+kind);
 const event={id:'review-stop',wordId:'archive',createdAt:'2026-01-01T10:00:00.000Z',type:'review',grade:'remembered'};
 if(kind==='malformed-source')local.setItem(key+'bad','{');else app.writeVocabulary(local,key,[event]);
 const id=randomUUID(),checkin={id:randomUUID(),date:'2026-01-01',minutes:4,load:'轻',note:'synthetic',createdAt:'2026-01-01T10:00:00.000Z'};
 local.setItem('lantern-v1-'+A.id+':op:'+id,JSON.stringify({id,owner:A.id,type:'checkin',data:checkin}));
 let vocabCalls=0,studyCalls=0;
 const vt={append:async()=>{vocabCalls++;const error=Error('unavailable');error.code=kind==='auth'?'NATIVE_AUTH':'NATIVE_CONFLICT';throw error;},begin:async()=>{throw Error('unexpected');},page:async()=>{throw Error('unexpected');}};
 const st={upload:async()=>{studyCalls++;throw Error('unexpected');},pull:async()=>{studyCalls++;throw Error('unexpected');}};
 const client=app.createCandidatePageClient({db,vocabTransport:vt,studyTransport:st,autoCapture:{storage:local,target:view}});
 try{await client.activate(A.id);client.start(A.id);for(let i=0;i<30;i++)await tick();
  assert.equal(vocabCalls,kind==='malformed-source'?0:1);assert.equal(studyCalls,0);
  assert.ok(local.getItem('lantern-v1-'+A.id+':op:'+id));
 }finally{await client.cancel();db.close();}
});
test('a failed native resume never starts a client pump',async()=>{
 const signal=new AbortController().signal,state={status:'ready',unavailable:false,user:A,access:{owner:A.id,user:A,epoch:1,sessionSignal:signal,assertAccess:()=>true,canAccess:()=>true}};
 const account={getSnapshot:()=>state,subscribe:()=>()=>{}};let starts=0,cancels=0,holds=0;
 const client={activate:async()=>{},cancel:async()=>{cancels++;},start:()=>{starts++;}};
 const native={drain:async()=>{},snapshot:async()=>({owner:A.id,seq:1}),hold:async()=>{holds++;},complete:async()=>{},resume:async()=>{throw Error('native unavailable');},subscribeRevocation:()=>()=>{}};
 const lifecycle=app.createNativeSyncLifecycle(account,client,native);
 try{await lifecycle.settled();assert.equal(lifecycle.status().phase,'blocked');assert.equal(starts,0);assert.ok(cancels>=2);assert.ok(holds>=1);}finally{lifecycle.dispose();}
});
test('local-only and unknown access scopes never activate cloud even with a matching native snapshot',async()=>{
 for(const scope of ['local-study-only','unknown']){
  const signal=new AbortController().signal,state={status:'ready',unavailable:false,user:A,access:{scope,owner:A.id,user:A,epoch:1,sessionSignal:signal,assertAccess:()=>true,canAccess:()=>true}};
  const account={getSnapshot:()=>state,subscribe:()=>()=>{}};let activations=0,snapshots=0,starts=0;
  const client={activate:async()=>{activations++;},cancel:async()=>{},start:()=>{starts++;}};
  const native={drain:async()=>{},snapshot:async()=>{snapshots++;return {owner:A.id,seq:1};},hold:async()=>{},complete:async()=>{},resume:async()=>{},subscribeRevocation:()=>()=>{}};
  const lifecycle=app.createNativeSyncLifecycle(account,client,native);
  try{await lifecycle.settled();assert.equal(lifecycle.status().phase,'blocked');assert.equal(activations,0);assert.equal(starts,0);assert.equal(snapshots,0);}finally{lifecycle.dispose();}
 }
});
test('a remote scope still requires matching native owner and may start only after resume',async()=>{
 const signal=new AbortController().signal,state={status:'ready',unavailable:false,user:A,access:{scope:'remote',owner:A.id,user:A,epoch:1,sessionSignal:signal,assertAccess:()=>true,canAccess:()=>true}};
 const account={getSnapshot:()=>state,subscribe:()=>()=>{}};const calls=[];
 const client={activate:async()=>{calls.push('activate');},cancel:async()=>{},start:()=>{calls.push('start');}};
 const native={drain:async()=>{},snapshot:async()=>({owner:A.id,seq:1}),hold:async()=>{},complete:async()=>{},resume:async()=>{calls.push('resume');},subscribeRevocation:()=>()=>{}};
 const lifecycle=app.createNativeSyncLifecycle(account,client,native);
 try{await lifecycle.settled();assert.equal(lifecycle.status().phase,'ready');assert.ok(calls.indexOf('resume')<calls.indexOf('start'));}finally{lifecycle.dispose();}
});
test('account switch drains a delayed start before a different owner starts',async()=>{
 const gate=deferred(),entered=deferred(),calls=[];let listener=()=>{},seq=1;
 const state=user=>{const signal=new AbortController().signal;return {status:'ready',unavailable:false,user,access:{owner:user.id,user,epoch:seq,sessionSignal:signal,assertAccess:()=>true,canAccess:()=>true}};};
 let current=state(A);const account={getSnapshot:()=>current,subscribe(fn){listener=fn;return()=>{};}};
 const client={async activate(owner){calls.push('activate:'+owner);},async cancel(){calls.push('cancel');},async start(owner){calls.push('start:'+owner);if(owner===A.id){entered.resolve();await gate.promise;}calls.push('end:'+owner);}};
 const native={drain:async()=>{},snapshot:async()=>({owner:current.user.id,seq}),hold:async()=>{calls.push('hold');},complete:async()=>{},resume:async()=>{},subscribeRevocation:()=>()=>{}};
 const lifecycle=app.createNativeSyncLifecycle(account,client,native);
 try{await entered.promise;seq++;current=state(B);listener(current,true);await tick();assert.equal(calls.includes('start:'+B.id),false);
  gate.resolve();await lifecycle.settled();assert.equal(lifecycle.status().owner,B.id);
  assert.ok(calls.indexOf('end:'+A.id)<calls.indexOf('start:'+B.id));assert.ok(calls.slice(calls.indexOf('end:'+A.id)+1,calls.indexOf('start:'+B.id)).includes('cancel'));
 }finally{gate.resolve();lifecycle.dispose();}
});
