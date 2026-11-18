'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Module,createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'package.json'));
const {IDBFactory}=req('fake-indexeddb'),{buildSync}=req('esbuild');
const source=`export * from './lib/cloud-sync/candidate-page.js'; export * from './lib/cloud-sync/native-vocabulary-source.ts'; export {STORE} from './lib/cloud-sync/offline-queue.js'; export {writeVocabulary,vocabularyBackup,vocabularyKey,vocabularyReviewHash} from './lib/vocabulary-model.ts';`;
const bundle=buildSync({stdin:{contents:source,resolveDir:root,loader:'js'},bundle:true,write:false,format:'cjs',platform:'node',target:'node24',logLevel:'silent'});
const file=path.join(__dirname,'vocab-source-import-bundle.cjs'),m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(bundle.outputFiles[0].text,file);
const app=m.exports,A='usr_00000000-0000-4000-8000-000000000001',B='usr_00000000-0000-4000-8000-000000000002';
const original={id:'review-1',wordId:'archive',createdAt:'2026-01-01T10:00:00.000Z',type:'review',grade:'remembered'};
const correction={id:'correction-1',wordId:'archive',createdAt:'2026-01-01T10:01:00.000Z',type:'review-correction',reviewId:'review-1',reviewHash:app.vocabularyReviewHash(original),grade:'again'};
const mark={id:'mark-1',wordId:'archive',createdAt:'2026-01-01T10:02:00.000Z',type:'mark',starred:true,revision:1};
function storage(){const raw=new Map();return {raw,get length(){return raw.size;},key(i){return [...raw.keys()][i]??null;},getItem(k){return raw.get(k)??null;},setItem(k,v){raw.set(k,String(v));}};}
const read=(db,key)=>new Promise((resolve,reject)=>{const r=db.transaction(app.STORE).objectStore(app.STORE).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const noNetwork={append:async()=>{throw Error('offline');},begin:async()=>{throw Error('offline');},page:async()=>{throw Error('offline');}};
const noStudy={upload:async()=>{throw Error('offline');},pull:async()=>{throw Error('offline');}};
const open=(factory,name)=>app.openSyntheticSyncDatabase(factory,'lantern-synthetic-sync-'+name);
const client=db=>app.createCandidatePageClient({db,vocabTransport:noNetwork,studyTransport:noStudy});
const write=(s,event)=>app.writeVocabulary(s,app.vocabularyKey(A),[event]);

test('actual owner chunks survive a lost enqueue result and IDB reopen without duplicate reviews',async()=>{
 const s=storage(),factory=new IDBFactory();write(s,original);write(s,correction);write(s,mark);const before=[...s.raw.entries()];
 let db=await open(factory,'vocab-source-restart'),c=client(db);
 try{
  await c.activate(A);let calls=0;
  const crash={get session(){return c.session;},async importVocabularySource(...args){const result=await c.importVocabularySource(...args);if(++calls===1)throw Error('lost commit result');return result;}};
  await assert.rejects(app.importNativeVocabularySource(s,crash),/lost commit result/);
  let state=await read(db,A);assert.equal(state.queue.length,1);assert.equal(state.queue[0].id,original.id);
  await c.cancel();db.close();db=await open(factory,'vocab-source-restart');c=client(db);await c.activate(A);
  const result=await app.importNativeVocabularySource(s,c);assert.equal(result.accepted,3);
  state=await read(db,A);assert.deepEqual(state.queue.map(x=>x.id),['review-1','mark-1','correction-1']);assert.equal(new Set(state.queue.map(x=>x.id)).size,3);
  await app.importNativeVocabularySource(s,c);assert.equal((await read(db,A)).queue.length,3);assert.deepEqual([...s.raw.entries()],before);
 }finally{await c.cancel();db.close();}
});

test('same-ID conflict remains isolated and dependent correction stays in the local source',async()=>{
 const s=storage();write(s,original);write(s,correction);write(s,mark);const before=[...s.raw.entries()];
 const db=await open(new IDBFactory(),'vocab-source-conflict'),c=client(db);
 try{
  await c.activate(A);await c.vocabulary({...original,grade:'again'});
  const result=await app.importNativeVocabularySource(s,c);
  assert.deepEqual([...result.conflictingEventIds],['review-1']);assert.deepEqual([...result.deferredCorrectionIds],['correction-1']);assert.equal(result.accepted,1);
  const rows=(await read(db,A)).queue;assert.deepEqual(rows.map(x=>x.id),['review-1','mark-1']);assert.equal(rows[0].event.grade,'again');assert.deepEqual([...s.raw.entries()],before);
 }finally{await c.cancel();db.close();}
});

test('a changed source or revoked owner before IDB transaction write cannot enqueue old bytes',async()=>{
 for(const change of ['source','owner']){
  const s=storage();write(s,original);const db=await open(new IDBFactory(),'vocab-source-'+change),c=client(db);
  try{
   await c.activate(A);const pending=app.importNativeVocabularySource(s,c),rejected=assert.rejects(pending,/source changed|revoked/);
   if(change==='source'){const key=[...s.raw.keys()][0];s.setItem(key,JSON.stringify(app.vocabularyBackup([{...original,grade:'again'}])));}
   else await c.activate(B);
   await rejected;assert.equal((await read(db,A)).queue.length,0);
  }finally{await c.cancel();db.close();}
 }
});

test('unresolved correction stays in source until its original review arrives',async()=>{
 const s=storage(),key=app.vocabularyKey(A);s.setItem(key+'orphan',JSON.stringify(app.vocabularyBackup([correction])));
 const db=await open(new IDBFactory(),'vocab-source-orphan'),c=client(db);
 try{
  await c.activate(A);let result=await app.importNativeVocabularySource(s,c);assert.deepEqual([...result.deferredCorrectionIds],['correction-1']);assert.equal((await read(db,A)).queue.length,0);
  write(s,original);result=await app.importNativeVocabularySource(s,c);assert.equal(result.accepted,2);assert.deepEqual((await read(db,A)).queue.map(x=>x.id),['review-1','correction-1']);
 }finally{await c.cancel();db.close();}
});
