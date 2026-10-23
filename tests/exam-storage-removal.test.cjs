const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=process.env.LANTERN_EXAM_ROOT||path.resolve(__dirname,'..'),ts=require(process.env.LANTERN_TYPESCRIPT||path.join(root,'node_modules/typescript'));
const {IDBFactory,IDBObjectStore}=require('fake-indexeddb');
const fixture=require('./fixtures/synthetic-exam.cjs');
const plain=v=>JSON.parse(JSON.stringify(v));
function load(file,imports={}){const exports={},code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,require:name=>{if(!Object.hasOwn(imports,name))return require('./helpers/actual-source-loader.cjs').createSourceLoader({root,imports,globals:{}}).resolve(name,file);return imports[name];},Date,Map,Set,Error,JSON,Promise,structuredClone,TextEncoder,Uint8Array,Uint32Array,ArrayBuffer,Blob,File,URL,Request,Response,Headers,ReadableStream,AbortController,TextDecoder,atob,btoa,crypto:crypto.webcrypto});return exports;}
const model=load('lib/exam-model.ts'),storage=load('lib/exam-storage.ts',{'./exam-model':model});
const start=Date.parse('2026-10-11T00:00:00Z');
const repo=(factory=new IDBFactory(),owner='alice')=>storage.openExamRepository(owner,{factory,name:'removal-test'});
test('explicit unused removal deletes only chosen package and keeps complete backup restorable',async()=>{
 const r=await repo(),a=await r.importPackage(fixture('remove-me')),b=await r.importPackage(fixture('keep-me'));
 await r.removeUnusedPackage(a.summary.key);assert.deepEqual((await r.listPackages()).map(p=>p.key),[b.summary.key]);await assert.rejects(r.getPackage(a.summary.key),/没有/);
 const backup=await r.exportBackup(),other=await repo();await other.importBackup(backup,start);assert.equal((await other.listPackages()).length,1);assert.equal((await other.listAttempts()).length,0);r.close();other.close();
});
test('active, first completed and retake history protect the referenced package',async()=>{
 const r=await repo(),{summary}=await r.importPackage(fixture());await r.startAttempt(summary.key,start,'first');
 let before=JSON.stringify(await r.exportBackup());await assert.rejects(r.removeUnusedPackage(summary.key),/已有考试记录/);assert.equal(JSON.stringify(await r.exportBackup()),before);
 await r.submit('first',start+model.LISTENING_MS+1);before=JSON.stringify(await r.exportBackup());await assert.rejects(r.removeUnusedPackage(summary.key),/已有考试记录/);assert.equal(JSON.stringify(await r.exportBackup()),before);
 await r.startAttempt(summary.key,start+model.LISTENING_MS+2,'retake');await assert.rejects(r.removeUnusedPackage(summary.key),/已有考试记录/);assert.equal((await r.listAttempts()).length,2);r.close();
});
test('an unused second version may be removed without deleting the first-version history',async()=>{
 const r=await repo(),first=await r.importPackage(fixture());await r.startAttempt(first.summary.key,start,'first');
 const v2=fixture();v2.version=2;const second=await r.importPackage(v2);await r.removeUnusedPackage(second.summary.key);
 assert.equal((await r.listPackages()).length,1);assert.equal((await r.listAttempts())[0].attempt.examVersion,1);const other=await repo();await other.importBackup(await r.exportBackup(),start);assert.equal((await other.listAttempts()).length,1);r.close();other.close();
});
test('removal is owner scoped even when another owner has history for the same package',async()=>{
 const factory=new IDBFactory(),a=await repo(factory),b=await repo(factory,'bob'),aa=await a.importPackage(fixture()),bb=await b.importPackage(fixture());await b.startAttempt(bb.summary.key,start,'bob-first');
 await a.removeUnusedPackage(aa.summary.key);assert.equal((await a.listPackages()).length,0);assert.equal((await b.listPackages()).length,1);assert.equal((await b.listAttempts()).length,1);await assert.rejects(a.removeUnusedPackage(bb.summary.key),/没有/);a.close();b.close();
});
test('concurrent start and removal serialize so a surviving attempt never loses its package',async()=>{
 for(const startFirst of [true,false]) {
  const factory=new IDBFactory(),a=await repo(factory),b=await repo(factory),{summary}=await a.importPackage(fixture());
  const outcomes=await Promise.allSettled(startFirst?[a.startAttempt(summary.key,start,'race'),b.removeUnusedPackage(summary.key)]:[b.removeUnusedPackage(summary.key),a.startAttempt(summary.key,start,'race')]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);const history=await a.listAttempts(),catalog=await a.listPackages();
  assert.equal(catalog.length,history.length);if(history.length)assert.equal((await a.getPackage(summary.key)).id,history[0].attempt.examId);a.close();b.close();
 }
});
test('failed second deletion rolls the first deletion back atomically',async()=>{
 const r=await repo(),{summary}=await r.importPackage(fixture()),before=JSON.stringify(await r.exportBackup()),original=IDBObjectStore.prototype.delete;
 IDBObjectStore.prototype.delete=function(key){if(this.name==='catalog')throw Error('Injected second delete failure');return original.call(this,key);};
 try{await assert.rejects(r.removeUnusedPackage(summary.key),/Injected/);}finally{IDBObjectStore.prototype.delete=original;}
 assert.equal(JSON.stringify(await r.exportBackup()),before);assert.equal((await r.listPackages()).length,1);r.close();
});
