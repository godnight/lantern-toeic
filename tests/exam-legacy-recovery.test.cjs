'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {IDBFactory,IDBObjectStore}=require('fake-indexeddb');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const fixture=require('./fixtures/synthetic-exam.cjs');
const {load}=createSourceLoader({root:path.resolve(__dirname,'..')});
const {NativeAccountController}=load('lib/native-account-controller.ts');
const {openExamRepository}=load('lib/exam-storage.ts');
const {copySelectedLegacyExam}=load('lib/exam-legacy-recovery.ts');
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'};
const B={id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(initial=A){
 let user=initial,now=0;const clock={now:()=>now,set:()=>1,clear:()=>{}};
 const transport={cancelAll(){},dispose(){},async request(action){
  if(action==='session')return user?{status:200,version:2,body:{user,capabilities:{passwordLogin:true,phoneLogin:false},session:{validForMs:1000}}}:{status:401,body:{code:'unauthenticated'}};
  if(action==='login'){user=B;return {status:200,body:{}};}throw Error('unexpected request');
 }};
 const controller=new NativeAccountController(transport,clock);
 return {controller,advance:ms=>{now+=ms;},async start(){controller.start();await tick();return controller.getSnapshot();}};
}
async function setup(){
 const factory=new IDBFactory(),name='synthetic-recovery-coordinator';
 const source=await openExamRepository('harmony-local-device',{factory,name});
 const a=await openExamRepository('harmony-'+A.id,{factory,name});
 const b=await openExamRepository('harmony-'+B.id,{factory,name});
 const {summary}=await source.importPackage(fixture());
 return {factory,source,a,b,selection:{key:summary.key,fingerprint:summary.fingerprint,confirmed:true},close(){source.close();a.close();b.close();}};
}

test('only an explicitly selected package reaches the currently proved account',async()=>{
 const db=await setup(),h=harness();try{
  const state=await h.start();const result=await copySelectedLegacyExam({controller:h.controller,access:state.access,source:db.source,target:db.a,selection:db.selection});
  assert.equal(result.status,'imported');assert.equal((await db.source.listPackages()).length,1);assert.equal((await db.a.listPackages()).length,1);assert.equal((await db.b.listPackages()).length,0);
  assert.equal((await db.source.listAttempts()).length,0);assert.equal((await db.a.listAttempts()).length,0);
 }finally{h.controller.dispose();db.close();}
});

test('guest, stale proof, mismatched target, unconfirmed and invalid selections fail closed',async()=>{
 const db=await setup(),h=harness(),guest=harness(null);try{
  const state=await h.start(),g=await guest.start(),base={controller:h.controller,access:state.access,source:db.source,target:db.a,selection:db.selection};
  for(const input of [{...base,target:db.b},{...base,selection:{...db.selection,confirmed:false}},{...base,selection:{...db.selection,key:''}},{...base,selection:{...db.selection,fingerprint:'bad'}},{...base,controller:guest.controller,access:g.access},{...base,access:{...state.access,epoch:state.access.epoch+1}},{...base,source:db.a}])await assert.rejects(copySelectedLegacyExam(input));
  h.controller.recheck();await tick();assert.notEqual(h.controller.getSnapshot().access,state.access);await assert.rejects(copySelectedLegacyExam(base));
  assert.equal((await db.source.listPackages()).length,1);assert.equal((await db.a.listPackages()).length,0);assert.equal((await db.b.listPackages()).length,0);
 }finally{h.controller.dispose();guest.controller.dispose();db.close();}
});

test('expiry detected before copying rejects without relying on delayed timer',async()=>{
 const db=await setup(),h=harness();try{
  const state=await h.start();h.advance(1001);
  await assert.rejects(copySelectedLegacyExam({controller:h.controller,access:state.access,source:db.source,target:db.a,selection:db.selection}));
  assert.equal(state.access.sessionSignal.aborted,true);assert.equal((await db.source.listPackages()).length,1);assert.equal((await db.a.listPackages()).length,0);
 }finally{h.controller.dispose();db.close();}
});

test('switching the real controller during final IDB put cancels publication and protects both accounts',async()=>{
 const db=await setup(),h=harness(),put=IDBObjectStore.prototype.put;let switching;try{
  const state=await h.start();let triggered=false;
  IDBObjectStore.prototype.put=function(value,...args){
   if(!triggered&&this.name==='v040ImportRuns'&&value.ownerId==='harmony-'+A.id&&value.status==='active'){
    triggered=true;switching=h.controller.mutate('login',{username:'synthetic_b',password:'synthetic-test-password'});assert.equal(state.access.sessionSignal.aborted,true);
   }
   return put.call(this,value,...args);
  };
  await assert.rejects(copySelectedLegacyExam({controller:h.controller,access:state.access,source:db.source,target:db.a,selection:db.selection}));
  assert.equal(triggered,true);assert.equal(await switching,true);assert.equal(h.controller.getSnapshot().user.id,B.id);
  assert.equal((await db.source.listPackages()).length,1);assert.equal((await db.a.listPackages()).length,0);assert.equal((await db.b.listPackages()).length,0);
  await assert.rejects(copySelectedLegacyExam({controller:h.controller,access:h.controller.getSnapshot().access,source:db.source,target:db.a,selection:db.selection}));
 }finally{IDBObjectStore.prototype.put=put;h.controller.dispose();db.close();}
});


test('background cancellation at commit leaves the source intact and removes staging',async()=>{
 const db=await setup(),h=harness(),put=IDBObjectStore.prototype.put;try{
  const state=await h.start();let triggered=false;
  IDBObjectStore.prototype.put=function(value,...args){
   if(!triggered&&this.name==='v040ImportRuns'&&value.ownerId==='harmony-'+A.id&&value.status==='active'){
    triggered=true;h.controller.suspend();assert.equal(state.access.sessionSignal.aborted,true);
   }
   return put.call(this,value,...args);
  };
  await assert.rejects(copySelectedLegacyExam({controller:h.controller,access:state.access,source:db.source,target:db.a,selection:db.selection}));
  assert.equal(triggered,true);assert.equal((await db.source.listPackages()).length,1);assert.equal((await db.a.listPackages()).length,0);
  const raw=await new Promise((resolve,reject)=>{const r=db.factory.open('synthetic-recovery-coordinator',4);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{const runs=await new Promise((resolve,reject)=>{const r=raw.transaction('v040ImportRuns','readonly').objectStore('v040ImportRuns').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});assert.equal(runs.filter(run=>run.ownerId==='harmony-'+A.id).length,0);}finally{raw.close();}
 }finally{IDBObjectStore.prototype.put=put;h.controller.dispose();db.close();}
});


test('expired proof during final IDB put rolls back even when its timer has not run',async()=>{
 const db=await setup(),h=harness(),put=IDBObjectStore.prototype.put;try{
  const state=await h.start();let triggered=false;
  IDBObjectStore.prototype.put=function(value,...args){
   if(!triggered&&this.name==='v040ImportRuns'&&value.ownerId==='harmony-'+A.id&&value.status==='active'){
    triggered=true;h.advance(1001);assert.equal(state.access.sessionSignal.aborted,false);
   }
   return put.call(this,value,...args);
  };
  await assert.rejects(copySelectedLegacyExam({controller:h.controller,access:state.access,source:db.source,target:db.a,selection:db.selection}));
  assert.equal(triggered,true);assert.equal(state.access.sessionSignal.aborted,true);
  assert.equal((await db.source.listPackages()).length,1);assert.equal((await db.a.listPackages()).length,0);assert.equal((await db.b.listPackages()).length,0);
 }finally{IDBObjectStore.prototype.put=put;h.controller.dispose();db.close();}
});
