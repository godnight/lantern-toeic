'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRequire,Module}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'package.json'));
const {IDBFactory}=req('fake-indexeddb'),{buildSync}=req('esbuild');
const source="export * from './lib/cloud-sync/candidate-page.js'; export {STORE,initial} from './lib/cloud-sync/offline-queue.js';";
const bundle=buildSync({stdin:{contents:source,resolveDir:root,loader:'js'},bundle:true,write:false,format:'cjs',platform:'node',target:'node24',logLevel:'silent'});
const file=path.join(__dirname,'vocab-queue-index-bundle.cjs'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(__dirname);mod._compile(bundle.outputFiles[0].text,file);
const q=mod.exports,owner='usr_00000000-0000-4000-8000-000000000001',other='usr_00000000-0000-4000-8000-000000000002';
const review={id:'review-1',wordId:'archive',createdAt:'2026-01-01T10:00:00.000Z',type:'review',grade:'remembered'};
const next={id:'review-2',wordId:'archive',createdAt:'2026-01-02T10:00:00.000Z',type:'review',grade:'again'};
const transports={vocabTransport:{append:async()=>{},begin:async()=>{},page:async()=>{}},studyTransport:{upload:async()=>{},pull:async()=>{}}};
const read=(db,key)=>new Promise((resolve,reject)=>{const req=db.transaction(q.STORE).objectStore(q.STORE).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const put=(db,row)=>new Promise((resolve,reject)=>{const tx=db.transaction(q.STORE,'readwrite');tx.objectStore(q.STORE).put(row);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});

for(const situation of ['missing event','duplicate event','payload mismatch','duplicate queue','invalid row'])test(`corrupt vocabulary queue rejects ${situation} without modifying either owner`,async()=>{
 const db=await q.openSyntheticSyncDatabase(new IDBFactory(),'lantern-synthetic-sync-queue-index'),client=q.createCandidatePageClient({db,...transports});
 try{
  await client.activate(owner);const state=q.initial(owner),row={id:review.id,event:review,acked:false};state.events=[review];state.queue=[row];
  if(situation==='missing event')state.events=[];
  if(situation==='duplicate event')state.events=[review,{...review}];
  if(situation==='payload mismatch')state.events=[{...review,grade:'again'}];
  if(situation==='duplicate queue')state.queue=[row,{...row}];
  if(situation==='invalid row')state.queue=[{...row,acked:'yes'}];
  const foreign=q.initial(other);foreign.events=[next];await put(db,state);await put(db,foreign);
  const before=await read(db,owner),foreignBefore=await read(db,other);
  await assert.rejects(client.vocabulary(next),/invalid queue|queue and local event mismatch/);
  assert.deepEqual(await read(db,owner),before);assert.deepEqual(await read(db,other),foreignBefore);
 }finally{await client.cancel();db.close();}
});
