'use strict';
// Real NativeAccountController and page sync candidate, with synthetic native
// lease/drain, authentication and transports. No credentials or user data.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Module}=require('node:module'),{buildSync}=require('esbuild'),{IDBFactory}=require('fake-indexeddb');
const root=path.resolve(__dirname,'..');
const source=`export {NativeAccountController} from './lib/native-account-controller.ts'; export {createNativeSyncLifecycle} from './lib/cloud-sync/native-lifecycle.ts'; export * from './lib/cloud-sync/candidate-page.js'; export {STORE} from './lib/cloud-sync/offline-queue.js';`;
const built=buildSync({stdin:{contents:source,resolveDir:root,loader:'js'},bundle:true,write:false,format:'cjs',platform:'node',target:'node24',logLevel:'silent'});
const file=path.join(__dirname,'native-sync-lifecycle-bundle.cjs'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(__dirname);mod._compile(built.outputFiles[0].text,file);
const {NativeAccountController,createNativeSyncLifecycle,openSyntheticSyncDatabase,createCandidatePageClient,STORE}=mod.exports;
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},B={id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
const capabilities={passwordLogin:true,phoneLogin:false},tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fakeClock(){let now=0;const timers=new Map();let id=0;return {now:()=>now,set(fn,ms){const key=++id;timers.set(key,{fn,at:now+ms});return key;},clear:key=>timers.delete(key),advance(ms){now+=ms;for(const [key,t]of [...timers])if(t.at<=now){timers.delete(key);t.fn();}}};}
function nativePort(){let owner=A.id,seq=0,listener=()=>{},drain=()=>Promise.resolve();return {
 port:{snapshot:async()=>({owner,seq}),subscribeRevocation(fn){listener=fn;return()=>{listener=()=>{};};},drain:()=>drain(),hold:async()=>{},complete:async()=>{},resume:async()=>{}},
 switch(uid){owner=uid;seq++;listener();},setDrain(fn){drain=fn;},get sequence(){return seq;}};}
function read(db,owner){return new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get(owner);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function setup(){
 const native=nativePort(),clock=fakeClock(),log=[];let user=A;
 const auth={cancelAll(){},dispose(){},async request(action){log.push(action);
  if(action==='session')return user?{version:2,status:200,body:{user,capabilities,session:{validForMs:3600000}}}:{status:401,body:{code:'unauthenticated'}};
  if(action==='login'){user=B;native.switch(B.id);return {status:200,body:{}};}
  if(action==='logout'){user=null;native.switch(null);return {status:200,body:{}};}
  throw Error('unexpected auth');}};
 const account=new NativeAccountController(auth,clock),db=await openSyntheticSyncDatabase(new IDBFactory(),'lantern-synthetic-sync-native-life');
 const unused={append:async()=>{throw Error('unexpected');},begin:async()=>{throw Error('unexpected');},page:async()=>{throw Error('unexpected');}};
 const study={upload:async()=>{throw Error('unexpected');},pull:async()=>{throw Error('unexpected');}};
 const client=createCandidatePageClient({db,vocabTransport:unused,studyTransport:study}),adapter=createNativeSyncLifecycle(account,client,native.port);
 account.start();await tick();await adapter.settled();
 return {native,account,adapter,client,db,log,clock,close(){adapter.dispose();account.dispose();db.close();}};
}

test('verified account plus matching native lease activates, then account switch fences old queue',async()=>{
 const h=await setup();try{
  assert.equal(h.adapter.status().phase,'ready');assert.equal(h.adapter.status().owner,A.id);
  await h.client.vocabulary({id:'a-mark',wordId:'word1',createdAt:'2026-01-01T00:00:00.000Z',type:'mark',starred:true,revision:1});
  const old=h.client.session,p=h.account.mutate('login',{username:'synthetic_b',password:'synthetic-test-password'});
  // The synchronous account change event revokes local access before auth returns.
  assert.equal(old.signal.aborted,true);assert.equal(h.client.session,null);
  assert.equal(await p,true);await h.adapter.settled();assert.equal(h.adapter.status().owner,B.id);
  await assert.rejects(Promise.resolve().then(()=>h.client.vocabulary({id:'bad',wordId:'word1',createdAt:'2026-01-01T00:00:00.000Z',type:'mark',starred:true,revision:1},old)),/revoked/);
  assert.equal((await read(h.db,A.id)).queue.length,1);assert.equal((await read(h.db,B.id)).queue.length,0);
 }finally{h.close();}
});
test('native revocation immediately blocks further writes',async()=>{
 const h=await setup();try{
  const old=h.client.session;h.native.switch(null);assert.equal(old.signal.aborted,true);assert.equal(h.client.session,null);await h.adapter.settled();assert.equal(h.adapter.status().phase,'blocked');
  h.account.recheck();await tick();await h.adapter.settled();assert.equal(h.adapter.status().phase,'blocked');
 }finally{h.close();}
});
test('expired account proof revokes the local queue before any further write',async()=>{
 const h=await setup();try{
  const old=h.client.session;h.clock.advance(3600000);assert.equal(old.signal.aborted,true);assert.equal(h.client.session,null);
  await h.adapter.settled();assert.equal(h.adapter.status().phase,'blocked');
 }finally{h.close();}
});
test('account change barrier waits for native drain and does not send auth first',async()=>{
 const h=await setup(),d=deferred();try{
  const before=h.log.length;h.native.setDrain(()=>d.promise);const prepare=h.adapter.prepareAccountChange();await tick();assert.equal(h.log.length,before);assert.equal(h.client.session,null);
  d.resolve();await prepare;const p=h.account.mutate('logout');assert.equal(await p,true);await h.adapter.settled();assert.equal(h.adapter.status().phase,'blocked');
 }finally{d.resolve();h.close();}
});
test('late native snapshot after revocation is rejected without activating a queue',async()=>{
 let resolveSnapshot,revoked=()=>{},cancelCount=0,activated=0;
 const proof=new AbortController(),state={status:'ready',unavailable:false,user:A,access:{owner:A.id,user:A,epoch:1,sessionSignal:proof.signal,assertAccess:()=>true,canAccess:()=>true}},account={getSnapshot:()=>state,subscribe:()=>()=>{}};
 const client={async cancel(){cancelCount++;},async activate(){activated++;}},native={drain:async()=>{},hold:async()=>{},complete:async()=>{},resume:async()=>{},snapshot:()=>new Promise(resolve=>{resolveSnapshot=resolve;}),subscribeRevocation(fn){revoked=fn;return()=>{};}};
 const adapter=createNativeSyncLifecycle(account,client,native);try{
  for(let i=0;i<5&&!resolveSnapshot;i++)await tick();assert.equal(typeof resolveSnapshot,'function');revoked();resolveSnapshot({owner:A.id,seq:0});await adapter.settled();
  assert.equal(activated,0);assert.ok(cancelCount>=2);assert.equal(adapter.status().phase,'blocked');
 }finally{adapter.dispose();}
});
test('missing lease/drain port fails closed before any synchronization',()=>{
 let called=0;assert.throws(()=>createNativeSyncLifecycle({getSnapshot:()=>({status:'checking',message:''}),subscribe:()=>()=>{}},{cancel:async()=>{called++;},activate:async()=>{called++;}},{snapshot:async()=>null}),/unavailable/);assert.equal(called,0);
});
test('late activation must settle and be cancelled before a new owner activates',async()=>{
 const d=deferred(),entered=deferred(),calls=[];let listener=()=>{},seq=0;
 function state(user){const signal=new AbortController().signal;return {status:'ready',unavailable:false,user,access:{owner:user.id,user,epoch:1,sessionSignal:signal,assertAccess:()=>true,canAccess:()=>true}};}
 let current=state(A);const account={getSnapshot:()=>current,subscribe(fn){listener=fn;return()=>{};}};
 const client={async cancel(){calls.push('cancel');},async activate(owner){calls.push('start:'+owner);if(owner===A.id){entered.resolve();await d.promise;}calls.push('end:'+owner);}};
 const native={drain:async()=>{},hold:async()=>{},complete:async()=>{},resume:async()=>{},snapshot:async()=>({owner:current.user.id,seq}),subscribeRevocation(){return()=>{};}};
 const adapter=createNativeSyncLifecycle(account,client,native);try{
  await entered.promise;current=state(B);seq++;listener(current,true);await tick();assert.equal(calls.includes('start:'+B.id),false);
  d.resolve();await adapter.settled();assert.equal(adapter.status().owner,B.id);
  const oldEnd=calls.indexOf('end:'+A.id),newStart=calls.indexOf('start:'+B.id);assert.ok(oldEnd>=0&&newStart>oldEnd);assert.ok(calls.slice(oldEnd+1,newStart).includes('cancel'));
 }finally{d.resolve();adapter.dispose();}
});
test('cancellation failure poisons this lifecycle and prevents later activation',async()=>{
 const signal=new AbortController().signal;function state(user){return {status:'ready',unavailable:false,user,access:{owner:user.id,user,epoch:1,sessionSignal:signal,assertAccess:()=>true,canAccess:()=>true}};}
 let current=state(A),listener=()=>{},calls=0,activations=0;const account={getSnapshot:()=>current,subscribe(fn){listener=fn;return()=>{};}};
 const client={async cancel(){if(++calls===1)throw Error('synthetic storage failure');},async activate(){activations++;}},native={drain:async()=>{},hold:async()=>{},complete:async()=>{},resume:async()=>{},snapshot:async()=>({owner:current.user.id,seq:1}),subscribeRevocation:()=>()=>{}};
 const adapter=createNativeSyncLifecycle(account,client,native);try{
  await adapter.settled();assert.equal(adapter.status().phase,'blocked');current=state(B);listener(current,true);await adapter.settled();assert.equal(activations,0);assert.equal(adapter.status().phase,'blocked');
 }finally{adapter.dispose();}
});
test('unexpected native lease fields are rejected rather than propagated',async()=>{
 const signal=new AbortController().signal,state={status:'ready',unavailable:false,user:A,access:{owner:A.id,user:A,epoch:1,sessionSignal:signal,assertAccess:()=>true,canAccess:()=>true}};let activations=0;
 const account={getSnapshot:()=>state,subscribe:()=>()=>{}},client={cancel:async()=>{},activate:async()=>{activations++;}},native={drain:async()=>{},hold:async()=>{},complete:async()=>{},resume:async()=>{},snapshot:async()=>({owner:A.id,seq:1,token:'synthetic-unexpected'}),subscribeRevocation:()=>()=>{}};
 const adapter=createNativeSyncLifecycle(account,client,native);try{await adapter.settled();assert.equal(activations,0);assert.equal(adapter.status().phase,'blocked');assert.equal(JSON.stringify(adapter.status()).includes('synthetic-unexpected'),false);}finally{adapter.dispose();}
});
test('unresponsive native drain times out and leaves the queue disabled',async()=>{
 const signal=new AbortController().signal,state={status:'ready',unavailable:false,user:A,access:{owner:A.id,user:A,epoch:1,sessionSignal:signal,assertAccess:()=>true,canAccess:()=>true}};let activated=0;
 const account={getSnapshot:()=>state,subscribe:()=>()=>{}},client={cancel:async()=>{},activate:async()=>{activated++;}},native={drain:()=>new Promise(()=>{}),hold:async()=>{},complete:async()=>{},resume:async()=>{},snapshot:async()=>({owner:A.id,seq:1}),subscribeRevocation:()=>()=>{}};
 const adapter=createNativeSyncLifecycle(account,client,native,{nativeTimeoutMs:10});try{await adapter.settled();assert.equal(adapter.status().phase,'blocked');assert.equal(activated,0);}finally{adapter.dispose();}
});
