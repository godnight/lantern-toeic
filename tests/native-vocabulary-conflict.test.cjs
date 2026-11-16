'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRequire,Module}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'package.json'));
const {IDBFactory}=req('fake-indexeddb'),{buildSync}=req('esbuild');
const {SyntheticTransport}=require('./helpers/synthetic-sync-transport.cjs');
const source="export * from './lib/cloud-sync/candidate-page.js'; export {STORE} from './lib/cloud-sync/offline-queue.js'; export {vocabularyReviewHash} from './lib/vocabulary-model.ts';";
const bundle=buildSync({stdin:{contents:source,resolveDir:root,loader:'js'},bundle:true,write:false,format:'cjs',platform:'node',target:'node24',logLevel:'silent'});
const file=path.join(__dirname,'vocab-conflict-test-bundle.cjs'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(__dirname);mod._compile(bundle.outputFiles[0].text,file);
const q=mod.exports,owner='usr_00000000-0000-4000-8000-000000000001';
const first={id:'review-1',wordId:'archive',createdAt:'2026-01-01T10:00:00.000Z',type:'review',grade:'remembered'};
const correction={id:'correction-1',wordId:'archive',createdAt:'2026-01-01T10:01:00.000Z',type:'review-correction',reviewId:first.id,reviewHash:q.vocabularyReviewHash(first),grade:'again'};
const mark={id:'mark-1',wordId:'archive',createdAt:'2026-01-01T10:02:00.000Z',type:'mark',starred:true,revision:1};
const read=db=>new Promise((resolve,reject)=>{const req=db.transaction(q.STORE).objectStore(q.STORE).get(owner);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const put=(db,value)=>new Promise((resolve,reject)=>{const tx=db.transaction(q.STORE,'readwrite');tx.objectStore(q.STORE).put(value);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
async function setup(name){
 const db=await q.openSyntheticSyncDatabase(new IDBFactory(),'lantern-synthetic-sync-'+name),sent=[];let failure=null,begins=0,studyPulls=0;
 const vocabTransport={append:async p=>{sent.push(p.event.id);if(failure?.id===p.event.id){const error=Error('rejected');error.code=failure.code;throw error;}return {ok:true,owner:p.owner,id:p.event.id};},
  begin:async()=>{begins++;return {id:'snapshot',owner,upper:0,cursor:'first'};},page:async()=>({id:'snapshot',owner,upper:0,cursor:'first',events:[],next:null})};
 const studyTransport={upload:async()=>{throw Error('unexpected upload');},pull:async()=>{studyPulls++;return {syncProtocol:'native-m2a-v1',schemaVersion:2,owner,hasProfile:false,profilePolicy:'preserve-local-when-absent',changes:[],nextCursor:null,checkpoint:'n1.'+'A'.repeat(2086)};}};
 const client=q.createCandidatePageClient({db,vocabTransport,studyTransport});await client.activate(owner);
 return {db,client,sent,fail(id,code){failure={id,code};},clear(){failure=null;},begins:()=>begins,studyPulls:()=>studyPulls,async close(){await client.cancel();db.close();}};
}

test('a single review conflict preserves its correction, advances an independent mark, and leaves vocabulary checkpoint untouched',async()=>{
 const f=await setup('vocab-conflict-isolation');try{
  await f.client.vocabulary(first);await f.client.vocabulary(correction);await f.client.vocabulary(mark);f.fail(first.id,'NATIVE_EVENT_CONFLICT');
  await assert.rejects(f.client.run(),error=>error.code==='NATIVE_EVENT_CONFLICT');
  assert.deepEqual(f.sent,[first.id,mark.id]);assert.equal(f.begins(),0);assert.equal(f.studyPulls(),1);
  let state=await read(f.db);assert.deepEqual(state.queue.map(x=>[x.id,x.acked]),[[first.id,false],[correction.id,false],[mark.id,true]]);assert.equal(state.download.snapshot,null);assert.equal(state.download.lastUpper,null);
  f.clear();f.sent.length=0;await f.client.run();assert.deepEqual(f.sent,[first.id,correction.id]);
  state=await read(f.db);assert.ok(state.queue.every(x=>x.acked));assert.equal(f.begins(),1);
 }finally{await f.close();}
});

test('a global owner conflict stops immediately rather than processing another account operation',async()=>{
 const f=await setup('vocab-global-conflict');try{
  await f.client.vocabulary(first);await f.client.vocabulary(mark);f.fail(first.id,'NATIVE_CONFLICT');
  await assert.rejects(f.client.run(),error=>error.code==='NATIVE_CONFLICT');
  assert.deepEqual(f.sent,[first.id]);assert.equal(f.begins(),0);assert.equal(f.studyPulls(),0);assert.ok((await read(f.db)).queue.every(x=>!x.acked));
 }finally{await f.close();}
});

test('a correction whose original review has not been queued remains pending without sending or pulling vocabulary',async()=>{
 const f=await setup('vocab-orphan-correction');try{
  await f.client.vocabulary(correction);await f.client.vocabulary(mark);
  await assert.rejects(f.client.run(),error=>error.code==='NATIVE_EVENT_CONFLICT');
  assert.deepEqual(f.sent,[mark.id]);assert.equal(f.begins(),0);
  assert.deepEqual((await read(f.db)).queue.map(x=>[x.id,x.acked]),[[correction.id,false],[mark.id,true]]);
  await f.client.vocabulary(first);f.sent.length=0;await f.client.run();assert.deepEqual(f.sent,[first.id,correction.id]);
 }finally{await f.close();}
});

test('downloaded review is idempotently confirmed after lost response and restart before a new-device correction',async()=>{
 const factory=new IDBFactory(),server=new SyntheticTransport(),token=server.issueTestSession(owner),sent=[];
 server.append(token,owner,[first]);let loseReply=true,db=await q.openSyntheticSyncDatabase(factory,'lantern-synthetic-sync-vocab-downloaded-parent');
 const vocabTransport={append:async p=>{sent.push(p.event.id);const result=server.append(token,p.owner,[p.event]);if(p.event.id===first.id&&loseReply){loseReply=false;const error=Error('reply lost');error.code='NATIVE_TRANSIENT';throw error;}return result;},
  begin:async p=>server.begin(token,p.pageSize),page:async p=>server.page(token,p.snapshot,p.cursor)};
 const studyTransport={upload:async()=>{throw Error('unexpected upload');},pull:async()=>({syncProtocol:'native-m2a-v1',schemaVersion:2,owner,hasProfile:false,profilePolicy:'preserve-local-when-absent',changes:[],nextCursor:null,checkpoint:'n1.'+'A'.repeat(2086)})};
 let client=q.createCandidatePageClient({db,vocabTransport,studyTransport});
 try{
  await client.activate(owner);await client.run();let state=await read(db);
  assert.deepEqual(state.events.map(e=>e.id),[first.id]);assert.deepEqual(state.queue,[]);
  await client.vocabulary(correction);await assert.rejects(client.run(),error=>error.code==='NATIVE_TRANSIENT');
  state=await read(db);assert.deepEqual(state.queue.map(row=>[row.id,row.acked]),[[correction.id,false],[first.id,false]]);assert.deepEqual(sent,[first.id]);
  await client.cancel();db.close();db=await q.openSyntheticSyncDatabase(factory,'lantern-synthetic-sync-vocab-downloaded-parent');
  client=q.createCandidatePageClient({db,vocabTransport,studyTransport});await client.activate(owner);await client.run();
  state=await read(db);assert.ok(state.queue.every(row=>row.acked));assert.deepEqual(sent,[first.id,first.id,correction.id]);
  assert.equal(server.server.db.prepare('SELECT COUNT(*) AS n FROM events WHERE owner=?').get(owner).n,2);
  assert.deepEqual(state.events.map(e=>e.id),[first.id,correction.id]);
 }finally{await client.cancel();db.close();server.close();}
});

test('downloaded review conflict leaves its correction pending while independent marks can advance',async()=>{
 const factory=new IDBFactory(),server=new SyntheticTransport(),token=server.issueTestSession(owner),sent=[];
 server.append(token,owner,[first]);const db=await q.openSyntheticSyncDatabase(factory,'lantern-synthetic-sync-vocab-downloaded-conflict');
 const vocabTransport={append:async p=>{sent.push(p.event.id);try{return server.append(token,p.owner,[p.event]);}catch{const error=Error('event conflict');error.code='NATIVE_EVENT_CONFLICT';throw error;}},
  begin:async p=>server.begin(token,p.pageSize),page:async p=>server.page(token,p.snapshot,p.cursor)};
 const studyTransport={upload:async()=>{throw Error('unexpected upload');},pull:async()=>({syncProtocol:'native-m2a-v1',schemaVersion:2,owner,hasProfile:false,profilePolicy:'preserve-local-when-absent',changes:[],nextCursor:null,checkpoint:'n1.'+'A'.repeat(2086)})};
 const client=q.createCandidatePageClient({db,vocabTransport,studyTransport});
 try{
  await client.activate(owner);await client.run();const before=await read(db);
  server.server.db.prepare('UPDATE events SET payload=? WHERE owner=? AND id=?').run(JSON.stringify({...first,grade:'again'}),owner,first.id);
  await client.vocabulary(correction);await client.vocabulary(mark);
  await assert.rejects(client.run(),error=>error.code==='NATIVE_EVENT_CONFLICT');
  assert.deepEqual(sent,[mark.id,first.id]);const after=await read(db);
  assert.deepEqual(after.queue.map(row=>[row.id,row.acked]),[[correction.id,false],[mark.id,true],[first.id,false]]);
  assert.equal(after.download.lastUpper,before.download.lastUpper);assert.equal(after.download.snapshot,null);
  assert.equal(server.server.db.prepare('SELECT COUNT(*) AS n FROM events WHERE owner=?').get(owner).n,2);
 }finally{await client.cancel();db.close();server.close();}
});

test('account switch during downloaded-review confirmation never sends the old correction under the new owner',async()=>{
 const other='usr_00000000-0000-4000-8000-000000000002',factory=new IDBFactory(),server=new SyntheticTransport(),tokens=new Map([[owner,server.issueTestSession(owner)],[other,server.issueTestSession(other)]]),sent=[];
 server.append(tokens.get(owner),owner,[first]);const db=await q.openSyntheticSyncDatabase(factory,'lantern-synthetic-sync-vocab-downloaded-switch');
 let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),released=new Promise(resolve=>{release=resolve;});
 const vocabTransport={append:async p=>{sent.push([p.owner,p.event.id]);const result=server.append(tokens.get(p.owner),p.owner,[p.event]);if(p.event.id===first.id){enter();await released;}return result;},
  begin:async p=>server.begin(tokens.get(p.owner),p.pageSize),page:async p=>server.page(tokens.get(p.owner),p.snapshot,p.cursor)};
 const studyTransport={upload:async()=>{throw Error('unexpected upload');},pull:async p=>({syncProtocol:'native-m2a-v1',schemaVersion:2,owner:p.owner,hasProfile:false,profilePolicy:'preserve-local-when-absent',changes:[],nextCursor:null,checkpoint:'n1.'+'A'.repeat(2086)})};
 const client=q.createCandidatePageClient({db,vocabTransport,studyTransport});
 try{
  await client.activate(owner);await client.run();await client.vocabulary(correction);
  const pending=client.run(),rejected=assert.rejects(pending,/revoked|aborted/);await entered;
  await client.activate(other);release();await rejected;
  const previous=await read(db);assert.deepEqual(previous.queue.map(row=>[row.id,row.acked]),[[correction.id,false],[first.id,false]]);
  assert.deepEqual(sent,[[owner,first.id]]);assert.equal(server.server.db.prepare('SELECT COUNT(*) AS n FROM events WHERE owner=?').get(other).n,0);
 }finally{release?.();await client.cancel();db.close();server.close();}
});

test('a duplicated parent event ID cannot authorize a correction or send the parent',async()=>{
 const server=new SyntheticTransport(),token=server.issueTestSession(owner),sent=[];server.append(token,owner,[first]);
 const db=await q.openSyntheticSyncDatabase(new IDBFactory(),'lantern-synthetic-sync-vocab-duplicate-parent');
 const vocabTransport={append:async p=>{sent.push(p.event.id);return server.append(token,p.owner,[p.event]);},begin:async p=>server.begin(token,p.pageSize),page:async p=>server.page(token,p.snapshot,p.cursor)};
 const studyTransport={upload:async()=>{throw Error('unexpected upload');},pull:async()=>({syncProtocol:'native-m2a-v1',schemaVersion:2,owner,hasProfile:false,profilePolicy:'preserve-local-when-absent',changes:[],nextCursor:null,checkpoint:'n1.'+'A'.repeat(2086)})};
 const client=q.createCandidatePageClient({db,vocabTransport,studyTransport});
 try{
  await client.activate(owner);await client.run();await client.vocabulary(correction);const corrupted=await read(db);
  corrupted.events.push({...mark,id:first.id});await put(db,corrupted);
  await assert.rejects(client.run(),error=>error.code==='NATIVE_EVENT_CONFLICT');
  assert.deepEqual(sent,[]);assert.deepEqual(await read(db),corrupted);
 }finally{await client.cancel();db.close();server.close();}
});
