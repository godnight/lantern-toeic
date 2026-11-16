'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{Module}=require('node:module'),{buildSync}=require('esbuild');
const root=path.resolve(__dirname,'..');
const output=buildSync({entryPoints:[path.join(root,'lib/cloud-sync/study-source-upload-guard.js')],bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'}).outputFiles[0].text;
const filename=path.join(__dirname,'study-source-guard-bundle.cjs'),mod=new Module(filename);mod.filename=filename;mod._compile(output,filename);
const {guardStudyJournalUpload}=mod.exports;
function setup(){
 const owner='usr_aaaaaaaa-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
 const key='lantern-v1-'+owner+':op:'+id, rows=new Map();
 const storage={getItem:k=>rows.get(k)??null},controller=new AbortController(),session={owner,signal:controller.signal},client={session};
 const data={id:'33333333-3333-4333-8333-333333333333',date:'2026-01-01',minutes:4,load:'轻',note:'test',createdAt:'2026-01-01T10:00:00.000Z'};
 const operation={id,owner,type:'checkin',data},payload={owner,wire:{id,owner,type:'checkin',data},signal:controller.signal};
 client.readStudy=async()=>({pendingOperations:[operation]});rows.set(key,JSON.stringify(operation));return {rows,storage,client,controller,key,operation,payload};
}
test('unchanged owner journal record can be uploaded',async()=>{
 const f=setup();let sent=0;const guard=guardStudyJournalUpload(f.storage,f.client,{upload:async p=>{sent++;return p.wire.id;},pull:async()=>1});
 assert.equal(await guard.upload(f.payload),f.operation.id);assert.equal(sent,1);assert.equal(await guard.pull({}),1);
});
test('changed or removed source never sends queued stale data',async()=>{
 for(const mode of ['changed','removed','owner']){
  const f=setup();let sent=0;const guard=guardStudyJournalUpload(f.storage,f.client,{upload:async()=>{sent++;},pull:async()=>{}});
  if(mode==='changed')f.rows.set(f.key,JSON.stringify({...f.operation,data:{...f.operation.data,minutes:6}}));
  if(mode==='removed')f.rows.delete(f.key);
  if(mode==='owner')f.client.session={...f.client.session,owner:'usr_bbbbbbbb-2222-4222-8222-222222222222'};
  await assert.rejects(guard.upload(f.payload),e=>e.code==='NATIVE_EVENT_CONFLICT');assert.equal(sent,0);
 }
});
test('source mutation during upload prevents accepting its acknowledgement',async()=>{
 const f=setup();const guard=guardStudyJournalUpload(f.storage,f.client,{upload:async()=>{f.rows.set(f.key,JSON.stringify({...f.operation,data:{...f.operation.data,minutes:6}}));return {status:200};},pull:async()=>{}});
 await assert.rejects(guard.upload(f.payload),e=>e.code==='NATIVE_EVENT_CONFLICT');
 assert.equal(JSON.parse(f.rows.get(f.key)).data.minutes,6);
});
test('changed local grading also blocks dispatch although grading is omitted from the wire',async()=>{
 const f=setup(),attempt={id:f.operation.data.id,qid:'question-1',choice:1,correct:true,createdAt:f.operation.data.createdAt,seconds:5,mode:'first'};
 const operation={id:f.operation.id,owner:f.operation.owner,type:'attempt',data:attempt,firstAttemptId:attempt.id};
 f.client.readStudy=async()=>({pendingOperations:[operation]});
 f.rows.set(f.key,JSON.stringify({...operation,data:{...attempt,correct:false}}));let sent=0;
 const payload={owner:operation.owner,wire:{id:operation.id,owner:operation.owner,type:'attempt',data:{id:attempt.id,qid:attempt.qid,choice:attempt.choice,createdAt:attempt.createdAt,seconds:attempt.seconds,firstAttemptId:attempt.id}}};
 const guard=guardStudyJournalUpload(f.storage,f.client,{upload:async()=>{sent++;},pull:async()=>{}});
 await assert.rejects(guard.upload(payload),e=>e.code==='NATIVE_EVENT_CONFLICT');assert.equal(sent,0);
});
test('revoked session and checkpoint changes reject the response',async()=>{
 for(const mode of ['revoked','checkpoint']){
  const f=setup();const guard=guardStudyJournalUpload(f.storage,f.client,{upload:async()=>{if(mode==='revoked')f.controller.abort();else f.rows.set('lantern-v1-'+f.operation.owner+':checkpoint-epoch','changed');return {status:200};},pull:async()=>{}});
  await assert.rejects(guard.upload(f.payload),e=>e.code==='NATIVE_EVENT_CONFLICT');assert.ok(f.rows.has(f.key));
 }
});
test('candidate pump retains a changed journal operation instead of sending stale bytes',async()=>{
 const {IDBFactory}=require('fake-indexeddb');
 const candidateCode=buildSync({stdin:{contents:"export * from './lib/cloud-sync/candidate-page.js'",resolveDir:root,loader:'js'},bundle:true,write:false,format:'cjs',platform:'node',target:'node24',logLevel:'silent'}).outputFiles[0].text;
 const file=path.join(__dirname,'study-source-candidate-bundle.cjs'),candidate=new Module(file);candidate.filename=file;candidate.paths=Module._nodeModulePaths(__dirname);candidate._compile(candidateCode,file);
 const f=setup();f.storage.key=i=>[...f.rows.keys()][i]??null;Object.defineProperty(f.storage,'length',{get:()=>f.rows.size});
 const changed={...f.operation,data:{...f.operation.data,minutes:7}},changedSignal=Promise.withResolvers();let sent=0;
 const target={addEventListener(){},removeEventListener(){}};
 const vocabTransport={append:async()=>{throw Error('unexpected');},begin:async()=>{f.rows.set(f.key,JSON.stringify(changed));changedSignal.resolve();const e=Error('conflict');e.code='NATIVE_EVENT_CONFLICT';throw e;},page:async()=>{throw Error('unexpected');}};
 const studyTransport={upload:async()=>{sent++;return {status:200,body:{ok:true}};},pull:async()=>{throw Error('unexpected');}};
 const db=await candidate.exports.openSyntheticSyncDatabase(new IDBFactory(),'lantern-synthetic-sync-study-guard');
 const client=candidate.exports.createCandidatePageClient({db,vocabTransport,studyTransport,autoCapture:{storage:f.storage,target}});
 try{
  await client.activate(f.operation.owner);client.start(f.operation.owner);await changedSignal.promise;
  for(let i=0;i<40;i++)await new Promise(resolve=>setImmediate(resolve));
  const state=await client.readStudy();assert.equal(sent,0);assert.equal(state.pendingOperations.length,1);assert.equal(state.pendingOperations[0].data.minutes,4);
  assert.equal(JSON.parse(f.rows.get(f.key)).data.minutes,7);
 }finally{await client.cancel();db.close();}
});
