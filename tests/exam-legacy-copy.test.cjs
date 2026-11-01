'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const {IDBFactory,IDBObjectStore}=require('fake-indexeddb');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const fixture=require('./fixtures/synthetic-exam.cjs');
const root=path.resolve(__dirname,'..');
const {load}=createSourceLoader({root});
const {openExamRepository}=load('lib/exam-storage.ts');
const legacy='harmony-local-device', account='harmony-usr_aaaaaaaa-1111-4111-8111-111111111111', other='harmony-usr_bbbbbbbb-2222-4222-8222-222222222222';
const open=(owner,factory,name='legacy-copy-test')=>openExamRepository(owner,{factory,name});
const selection=(summary,target=account)=>({key:summary.key,fingerprint:summary.fingerprint,targetOwnerId:target,confirmed:true,accountIsCurrent:()=>true});
const copy=(source,target,selected,options={signal:new AbortController().signal})=>source.copySelectedLegacyPackageTo(target,selected,options);
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
const rawDb=(factory,name='legacy-copy-test')=>new Promise((resolve,reject)=>{const r=factory.open(name,4);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});

test('explicit selected package copies to the bound native account without touching source/history; duplicate is idempotent',async()=>{
 const factory=new IDBFactory(),source=await open(legacy,factory),target=await open(account,factory),another=await open(other,factory);
 try{
  const original=await source.importPackage(fixture());
  const copied=await copy(source,target,selection(original.summary));
  assert.equal(copied.status,'imported');assert.equal(copied.summary.fingerprint,original.summary.fingerprint);
  assert.equal((await source.listPackages()).length,1);assert.equal((await target.listPackages()).length,1);assert.equal((await another.listPackages()).length,0);
  assert.equal((await source.listAttempts()).length,0);assert.equal((await target.listAttempts()).length,0);
  assert.equal((await target.getPackage(original.summary.key)).questions.length,200);
  assert.equal((await copy(source,target,selection(original.summary))).status,'unchanged');
  assert.equal((await target.listPackages()).length,1);
 }finally{source.close();target.close();another.close();}
});

test('requires a selected fingerprint, explicit confirmation, same database and exact bound native account',async()=>{
 const factory=new IDBFactory(),source=await open(legacy,factory),target=await open(account,factory),otherTarget=await open(other,factory),guest=await open('guest',factory),differentDb=await open(account,factory,'different-db');
 try{
  const {summary}=await source.importPackage(fixture());
  await assert.rejects(source.copySelectedLegacyPackageTo(target,selection(summary)),/确认无效/);
  for(const [receiver,selected] of [[target,{...selection(summary),confirmed:false}],[target,{...selection(summary),fingerprint:'sha256:'+'f'.repeat(64)}],[target,{...selection(summary),targetOwnerId:other}],[otherTarget,selection(summary)],[guest,selection(summary,'guest')],[differentDb,selection(summary)]])
   await assert.rejects(copy(source,receiver,selected));
  await assert.rejects(copy(target,otherTarget,selection(summary,other)));
  assert.equal((await target.listPackages()).length,0);assert.equal((await source.listPackages()).length,1);
 }finally{source.close();target.close();otherTarget.close();guest.close();differentDb.close();}
});

test('source history blocks the copy instead of silently omitting a result or changing either owner',async()=>{
 const factory=new IDBFactory(),source=await open(legacy,factory),target=await open(account,factory);
 try{const {summary}=await source.importPackage(fixture());await source.startAttempt(summary.key,Date.now(),'old-exam');
  await assert.rejects(copy(source,target,selection(summary)),/考试记录/);
  assert.equal((await source.listAttempts()).length,1);assert.equal((await source.listPackages()).length,1);assert.equal((await target.listPackages()).length,0);assert.equal((await target.listAttempts()).length,0);
 }finally{source.close();target.close();}
});

test('history from any version of the same exam blocks copying another version',async()=>{
 const factory=new IDBFactory(),source=await open(legacy,factory),target=await open(account,factory);
 try{
  const first=await source.importPackage(fixture()),updated=fixture();updated.version=2;
  const second=await source.importPackage(updated);await source.startAttempt(first.summary.key,Date.now(),'old-version-attempt');
  await assert.rejects(copy(source,target,selection(second.summary)),/考试记录/);
  assert.equal((await source.listPackages()).length,2);assert.equal((await source.listAttempts()).length,1);
  assert.equal((await target.listPackages()).length,0);assert.equal((await target.listAttempts()).length,0);
 }finally{source.close();target.close();}
});

test('existing conflicting package and destination quota failure never replace original or publish partial destination',async()=>{
 const factory=new IDBFactory(),source=await open(legacy,factory),target=await open(account,factory);
 try{
  const {summary}=await source.importPackage(fixture());const changed=fixture();changed.questions[0].answer=2;await target.importPackage(changed);
  await assert.rejects(copy(source,target,selection(summary)),/冲突/);
  assert.equal((await target.getPackage(summary.key)).questions[0].answer,2);assert.equal((await source.getPackage(summary.key)).questions[0].answer,fixture().questions[0].answer);
  const second=await source.importPackage(fixture('quota-copy'));const add=IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add=function(value,...args){if(this.name==='catalog'&&value.ownerId===account&&value.id==='quota-copy'){const e=new Error('full');e.name='QuotaExceededError';throw e;}return add.call(this,value,...args)};
  try{await assert.rejects(copy(source,target,selection(second.summary)),/空间不足|存储不可用/);}finally{IDBObjectStore.prototype.add=add;}
  assert.equal((await source.listPackages()).length,2);assert.equal((await target.listPackages()).length,1);
  const db=await rawDb(factory);try{const tx=db.transaction('v040ImportRuns','readonly');const runs=await request(tx.objectStore('v040ImportRuns').getAll());assert.equal(runs.filter(r=>r.ownerId===account&&r.status==='staging').length,0);}finally{db.close();}
 }finally{source.close();target.close();}
});

test('old schema row stays legacy after copy, and an aborted request leaves both owners unchanged',async()=>{
 const factory=new IDBFactory(),source=await open(legacy,factory),target=await open(account,factory);
 try{
  const exam=fixture(),{summary}=await source.importPackage(exam),db=await rawDb(factory);
  try{const tx=db.transaction('packages','readwrite');await request(tx.objectStore('packages').put({ownerId:legacy,key:summary.key,exam}));await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});}finally{db.close();}
  const ctl=new AbortController();ctl.abort(new Error('cancelled'));await assert.rejects(copy(source,target,selection(summary),{signal:ctl.signal}),/cancelled/);
  assert.equal((await target.listPackages()).length,0);
  assert.equal((await copy(source,target,selection(summary))).status,'imported');
  const inspect=await rawDb(factory);try{const tx=inspect.transaction('packages','readonly');const row=await request(tx.objectStore('packages').get([legacy,summary.key]));assert.ok(row.exam);assert.equal('runId' in row,false);}finally{inspect.close();}
 }finally{source.close();target.close();}
});

test('source removal or a newly created source attempt during streaming prevents publication',async()=>{
 for(const change of ['remove','attempt']){
  const factory=new IDBFactory(),source=await open(legacy,factory),target=await open(account,factory);
  try{
   const {summary}=await source.importPackage(fixture());const original=target.importPackageFile.bind(target);
   target.importPackageFile=async(...args)=>{if(change==='remove')await source.removeUnusedPackage(summary.key);else await source.startAttempt(summary.key,Date.now(),'concurrent');return original(...args)};
   await assert.rejects(copy(source,target,selection(summary)),/旧题包|考试记录/);
   assert.equal((await target.listPackages()).length,0);assert.equal((await target.listAttempts()).length,0);
   const db=await rawDb(factory);try{const tx=db.transaction('v040ImportRuns','readonly');const runs=await request(tx.objectStore('v040ImportRuns').getAll());assert.equal(runs.filter(r=>r.ownerId===account&&r.status==='staging').length,0);}finally{db.close();}
  }finally{source.close();target.close();}
 }
});

test('a concurrent attempt on another version of the same exam blocks publication',async()=>{
 const factory=new IDBFactory(),source=await open(legacy,factory),target=await open(account,factory);
 try{
  const first=await source.importPackage(fixture()),updated=fixture();updated.version=2;const second=await source.importPackage(updated);
  const original=target.importPackageFile.bind(target);
  target.importPackageFile=async(...args)=>{await source.startAttempt(first.summary.key,Date.now(),'concurrent-v1');return original(...args)};
  await assert.rejects(copy(source,target,selection(second.summary)),/考试记录/);
  assert.equal((await source.listPackages()).length,2);assert.equal((await source.listAttempts()).length,1);
  assert.equal((await target.listPackages()).length,0);assert.equal((await target.listAttempts()).length,0);
 }finally{source.close();target.close();}
});

test('session invalidation aborts the transaction even during the final active-run put',async()=>{
 const factory=new IDBFactory(),source=await open(legacy,factory),target=await open(account,factory),ctl=new AbortController();
 try{
  const {summary}=await source.importPackage(fixture());const put=IDBObjectStore.prototype.put;let reachedFinalPut=false;
  IDBObjectStore.prototype.put=function(value,...args){if(this.name==='v040ImportRuns'&&value.ownerId===account&&value.status==='active'){reachedFinalPut=true;ctl.abort(new Error('session invalidated'));}return put.call(this,value,...args)};
  try{await assert.rejects(copy(source,target,selection(summary),{signal:ctl.signal}),/session invalidated/);}finally{IDBObjectStore.prototype.put=put;}
  assert.equal(reachedFinalPut,true);assert.equal((await source.listPackages()).length,1);assert.equal((await target.listPackages()).length,0);
  const db=await rawDb(factory);try{const tx=db.transaction('v040ImportRuns','readonly'),runs=await request(tx.objectStore('v040ImportRuns').getAll());assert.equal(runs.filter(r=>r.ownerId===account).length,0);}finally{db.close();}
 }finally{source.close();target.close();}
});

test('a stale authenticated-account guard refuses the copy and rechecks at commit',async()=>{
 const factory=new IDBFactory(),source=await open(legacy,factory),target=await open(account,factory);
 try{
  const {summary}=await source.importPackage(fixture());
  await assert.rejects(copy(source,target,{...selection(summary),accountIsCurrent:()=>false}),/确认无效/);
  let calls=0;
  await assert.rejects(copy(source,target,{...selection(summary),accountIsCurrent:()=>++calls<3}),/账号已切换/);
  assert.equal((await source.listPackages()).length,1);assert.equal((await target.listPackages()).length,0);
 }finally{source.close();target.close();}
});

test('per-account capacity is enforced during final publication without changing existing packages',async()=>{
 const factory=new IDBFactory(),source=await open(legacy,factory),target=await open(account,factory);
 try{
  const {summary}=await source.importPackage(fixture()),stored=await target.importPackage(fixture('existing'));
  const db=await rawDb(factory);try{const tx=db.transaction('catalog','readwrite'),store=tx.objectStore('catalog'),row=await request(store.get([account,stored.summary.key]));row.bytes=192*1024*1024;await request(store.put(row));await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});}finally{db.close();}
  await assert.rejects(copy(source,target,selection(summary)),/容量达到限额/);
  assert.equal((await target.listPackages()).length,1);assert.equal((await source.listPackages()).length,1);
 }finally{source.close();target.close();}
});
