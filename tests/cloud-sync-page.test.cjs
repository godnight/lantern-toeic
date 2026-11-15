'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRequire,Module}=require('node:module'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const req=createRequire(path.join(root,'package.json')),{IDBFactory}=req('fake-indexeddb'),{buildSync}=req('esbuild');
const {SyntheticTransport}=require('./helpers/synthetic-sync-transport.cjs');
const entry=`export * from './lib/cloud-sync/candidate-page.js'; export * from './lib/cloud-sync/offline-queue.js'; export {FENCE,COMMITS} from './lib/cloud-sync/idb-fence.js'; export * from './lib/cloud-sync/client.js'; export * from './lib/cloud-sync/study-runner.js'; export * from './lib/cloud-sync/vocabulary-projection.ts'; export * from './lib/cloud-sync/capture-vocabulary.js'; export * from './lib/cloud-sync/capture-study-journal.js'; export * from './lib/cloud-sync/vocabulary-capture.ts'; export {readVocabulary,writeVocabulary,vocabularyKey} from './lib/vocabulary-model.ts';`;
const built=buildSync({stdin:{contents:entry,resolveDir:root,loader:'js'},bundle:true,write:false,format:'cjs',platform:'node',target:'node24',logLevel:'silent'});
const file=path.join(__dirname,'cloud-sync-test-bundle.cjs'),moduleForTest=new Module(file);moduleForTest.filename=file;moduleForTest.paths=Module._nodeModulePaths(__dirname);moduleForTest._compile(built.outputFiles[0].text,file);
const page=moduleForTest.exports,q=page,study=page,{FENCE,COMMITS,createSyntheticClient,projectNativeVocabularyEvents:project}=page;
const A='usr_00000000-0000-4000-8000-000000000001',B='usr_00000000-0000-4000-8000-000000000002';
const stamp='2026-01-01T10:00:00.000Z',checkpoint='n1.'+'A'.repeat(2086);
const word=id=>({id,wordId:'word1',createdAt:stamp,type:'review',grade:'remembered'});
const attempt=()=>({id:randomUUID(),qid:'qa-q',choice:0,correct:true,createdAt:stamp,seconds:3,mode:'first'});
const checkin=()=>({id:randomUUID(),date:'2026-01-01',minutes:4,load:'轻',note:'synthetic',createdAt:stamp});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function open(factory,name){return page.openSyntheticSyncDatabase(factory,'lantern-synthetic-sync-'+name);}
function read(db,store,key){return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function server(){
 const vocab=new SyntheticTransport(),tokens=new Map([[A,vocab.issueTestSession(A)],[B,vocab.issueTestSession(B)]]),rows=new Map();let offline=false,delayAppend=null,delayPull=null,loseAppend=false,loseStudy=false;
 function gate(){if(offline)throw Error('synthetic offline');}
 const vt={append:async p=>{gate();const result=await vocab.append(tokens.get(p.owner),p.owner,[p.event]);if(delayAppend)await delayAppend();if(loseAppend){loseAppend=false;throw Error('synthetic lost acknowledgement');}return result;},
  begin:async p=>{gate();return vocab.begin(tokens.get(p.owner),p.pageSize);},page:async p=>{gate();return vocab.page(tokens.get(p.owner),p.snapshot,p.cursor);}};
 const st={upload:async p=>{gate();const w=p.wire;assert.equal(w.owner,p.owner);const key=p.owner+':'+w.type+':'+w.data.id;
  if(w.type==='attempt'){assert.equal('correct' in w.data,false);assert.equal('mode' in w.data,false);}
  const data=w.type==='attempt'?{...w.data,correct:false,mode:'first'}:w.data;
  const value={kind:w.type,id:data.id,data};if(rows.has(key))assert.deepEqual(rows.get(key),value);else rows.set(key,value);
  if(loseStudy){loseStudy=false;throw Error('synthetic lost acknowledgement');}return {status:200,body:{ok:true}};},
  pull:async p=>{gate();if(delayPull)await delayPull();return {syncProtocol:'native-m2a-v1',schemaVersion:2,owner:p.owner,hasProfile:false,profilePolicy:'preserve-local-when-absent',changes:[...rows.entries()].filter(([key])=>key.startsWith(p.owner+':')).map(([,x])=>x),nextCursor:null,checkpoint};}};
 return {vt,st,rows,vocab,setOffline(v){offline=v;},onAppend(fn){delayAppend=fn;},onPull(fn){delayPull=fn;},loseNextVocab(){loseAppend=true;},loseNextStudy(){loseStudy=true;},close(){vocab.close();}};
}
function client(db,s){return page.createCandidatePageClient({db,vocabTransport:s.vt,studyTransport:s.st});}
function memoryStorage(){const raw=new Map();let fail=false;return {raw,setFail(value){fail=value;},storage:{get length(){return raw.size;},key(i){return [...raw.keys()][i]??null;},getItem(key){return raw.get(key)??null;},setItem(key,value){if(fail)throw Error('QuotaExceededError');raw.set(key,String(value));}}};}
const vocabMark=(id,wordId='word1')=>({id,wordId,createdAt:stamp,type:'mark',starred:true,revision:1});

test('study journal capture preserves operation ids and resumes without duplicates after restart',async()=>{
 const source=memoryStorage(),s=server(),factory=new IDBFactory(),a=attempt(),b=checkin(),ids=[randomUUID(),randomUUID()];
 for(const [index,data] of [a,b].entries())source.storage.setItem('lantern-v1-'+A+':op:'+ids[index],JSON.stringify({id:ids[index],owner:A,type:index?'checkin':'attempt',data}));
 let db=await open(factory,'journal-restart'),c=client(db,s);try{
  await c.activate(A);assert.equal(await page.scanSyntheticStudyJournal(source.storage,A,c),2);
  s.setOffline(true);await assert.rejects(c.run(),/offline/);await c.cancel();db.close();
  db=await open(factory,'journal-restart');c=client(db,s);await c.activate(A);
  assert.equal(await page.scanSyntheticStudyJournal(source.storage,A,c),2);s.setOffline(false);await c.run();
  assert.equal(await page.scanSyntheticStudyJournal(source.storage,A,c),2);
  const state=await c.readStudy();assert.deepEqual(state.pendingOperations.map(x=>x.id),ids);assert.equal(state.uploadAcks.length,2);assert.equal(s.rows.size,2);
  assert.equal(source.raw.size,2);
 }finally{await c.cancel();db.close();s.close();}
});
test('study journal capture rejects account switch while an enqueue is pending',async()=>{
 const source=memoryStorage(),s=server(),db=await open(new IDBFactory(),'journal-switch'),c=client(db,s),opId=randomUUID(),entered=deferred(),release=deferred();
 source.storage.setItem('lantern-v1-'+A+':op:'+opId,JSON.stringify({id:opId,owner:A,type:'attempt',data:attempt()}));
 try{
  await c.activate(A);const original=c.answer;c.answer=async(...args)=>{entered.resolve();await release.promise;return original(...args);};
  const pending=page.scanSyntheticStudyJournal(source.storage,A,c),rejected=assert.rejects(pending,/revoked/);await entered.promise;await c.activate(B);release.resolve();await rejected;
  assert.equal((await c.readStudy()).pendingOperations.length,0);
 }finally{release.resolve();await c.cancel();db.close();s.close();}
});
test('study journal capture fails closed when journal owner or compaction epoch changes',async()=>{
 const source=memoryStorage(),s=server(),db=await open(new IDBFactory(),'journal-invalid'),c=client(db,s),opId=randomUUID(),name='lantern-v1-'+A+':op:'+opId;
 try{
  await c.activate(A);source.storage.setItem(name,JSON.stringify({id:opId,owner:B,type:'checkin',data:checkin()}));
  await assert.rejects(page.scanSyntheticStudyJournal(source.storage,A,c),/invalid journal/);
  source.storage.setItem(name,JSON.stringify({id:opId,owner:A,type:'checkin',data:checkin()}));
  const original=c.answer;c.answer=async(...args)=>{source.storage.setItem('lantern-v1-'+A+':checkpoint-epoch','changed');return original(...args);};
  await assert.rejects(page.scanSyntheticStudyJournal(source.storage,A,c),/journal changed/);
  assert.equal(source.raw.has(name),true);assert.equal((await c.readStudy()).pendingOperations.length,1);
 }finally{await c.cancel();db.close();s.close();}
});

test('capture is disabled by default and ordinary vocabulary chunk bytes remain compatible',()=>{
 assert.equal(page.VOCABULARY_MARK_CAPTURE_ENABLED,false);
 const first=memoryStorage(),second=memoryStorage(),key=page.vocabularyKey(A),event=vocabMark('legacy-1');
 page.writeVocabulary(first.storage,key,[event]);page.writeVocabulary(second.storage,key,[event],{captureNewMark:false});
 const [firstKey,firstValue]=[...first.raw][0],[secondKey,secondValue]=[...second.raw][0];
 assert.equal(firstValue,secondValue);assert.match(firstKey.slice(key.length),/^[0-9a-f-]{36}$/i);assert.match(secondKey.slice(key.length),/^[0-9a-f-]{36}$/i);
 assert.equal(firstValue,JSON.stringify({kind:'lantern-vocabulary',schemaVersion:1,events:[event]}));
 assert.deepEqual(page.readVocabulary(first.storage,key),page.readVocabulary(second.storage,key));
});
test('persisted new mark survives crash and queues once without importing old or remote records',async()=>{
 const source=memoryStorage(),key=page.vocabularyKey(A),factory=new IDBFactory(),s=server();
 page.writeVocabulary(source.storage,key,[vocabMark('old-mark')]);
 page.writeVocabulary(source.storage,key,[vocabMark('new-mark')],{captureNewMark:true});
 assert.equal([...source.raw.keys()].filter(x=>x.startsWith(key+page.VOCABULARY_MARK_CAPTURE_KEY_PREFIX)).length,1);
 // Simulate a crash after the synchronous local write, before opening the queue.
 let db=await open(factory,'capture-restart'),c=client(db,s);try{
  await c.activate(A);assert.equal(await page.scanCapturedVocabularyMarks(source.storage,A,c),1);
  let state=await read(db,q.STORE,A);assert.deepEqual(state.queue.map(x=>x.id),['new-mark']);
  s.setOffline(true);await assert.rejects(c.run());assert.equal((await read(db,q.STORE,A)).queue[0].acked,false);
  await c.cancel();db.close();db=await open(factory,'capture-restart');c=client(db,s);await c.activate(A);
  assert.equal(await page.scanCapturedVocabularyMarks(source.storage,A,c),1);s.setOffline(false);await c.run();
  page.writeVocabulary(source.storage,key,[vocabMark('remote-mark','word2')]);
  await page.scanCapturedVocabularyMarks(source.storage,A,c);await c.run();
  state=await read(db,q.STORE,A);assert.deepEqual(state.queue.map(x=>x.id),['new-mark']);assert.equal(state.queue[0].acked,true);
  assert.equal(s.vocab.server.db.prepare('SELECT COUNT(*) AS n FROM events WHERE owner=?').get(A).n,1);
  assert.deepEqual(page.readVocabulary(source.storage,key).map(x=>x.id),['new-mark','old-mark','remote-mark']);
 }finally{await c.cancel();db.close();s.close();}
});
test('storage failure leaves neither a local mark nor a queued event',async()=>{
 const source=memoryStorage(),key=page.vocabularyKey(A),db=await open(new IDBFactory(),'capture-quota'),s=server(),c=client(db,s);
 try{await c.activate(A);source.setFail(true);assert.throws(()=>page.writeVocabulary(source.storage,key,[vocabMark('no-save')],{captureNewMark:true}),/Quota/);
  assert.equal(await page.scanCapturedVocabularyMarks(source.storage,A,c),0);assert.equal((await read(db,q.STORE,A)).queue.length,0);
 }finally{await c.cancel();db.close();s.close();}
});
test('capture binds the original account ticket across an asynchronous account switch',async()=>{
 const source=memoryStorage(),key=page.vocabularyKey(A),db=await open(new IDBFactory(),'capture-switch'),s=server(),c=client(db,s),arrived=deferred(),release=deferred();
 page.writeVocabulary(source.storage,key,[vocabMark('a-only')],{captureNewMark:true});
 try{await c.activate(A);const realEnqueue=c.vocabulary;c.vocabulary=async(event,ticket)=>{arrived.resolve();await release.promise;return realEnqueue(event,ticket);};
  const scan=page.scanCapturedVocabularyMarks(source.storage,A,c),rejected=assert.rejects(scan,/revoked/);await arrived.promise;await c.activate(B);release.resolve();await rejected;
  assert.equal((await read(db,q.STORE,A)).queue.length,0);assert.equal((await read(db,q.STORE,B)).queue.length,0);
 }finally{release.resolve();await c.cancel();db.close();s.close();}
});
test('capture pump finds persisted marks after failure and resumes on network recovery',async()=>{
 const source=memoryStorage(),key=page.vocabularyKey(A),db=await open(new IDBFactory(),'capture-pump'),s=server(),c=client(db,s),target=new EventTarget();let pump;
 page.writeVocabulary(source.storage,key,[vocabMark('pump-mark')],{captureNewMark:true});
 try{
  await c.activate(A);pump=page.createCapturedVocabularyMarkPump({storage:source.storage,owner:A,client:c,target});s.setOffline(true);
  await assert.rejects(pump.wake());assert.equal((await read(db,q.STORE,A)).queue[0].acked,false);
  s.setOffline(false);target.dispatchEvent(new Event('online'));await pump.wake();
  assert.equal((await read(db,q.STORE,A)).queue[0].acked,true);assert.equal(s.vocab.server.db.prepare('SELECT COUNT(*) AS n FROM events WHERE owner=?').get(A).n,1);
  await c.activate(B);await assert.rejects(pump.wake(),/revoked/);
 }finally{pump?.stop();await c.cancel();db.close();s.close();}
});

test('product entry is disabled before accessing storage or network',()=>{
 const built=buildSync({entryPoints:[path.join(root,'lib/cloud-sync/index.ts')],bundle:true,write:false,format:'cjs',platform:'node',target:'node24',logLevel:'silent'});
 const f=path.join(__dirname,'cloud-sync-disabled.cjs'),m=new Module(f);m.filename=f;m.paths=Module._nodeModulePaths(__dirname);m._compile(built.outputFiles[0].text,f);
 assert.throws(()=>m.exports.createPageCloudSync(),/not available/);
});
test('candidate refuses non-synthetic database names before opening them',async()=>{
 let called=false;const factory={open(){called=true;throw Error('must not access');}};
 await assert.rejects(page.openSyntheticSyncDatabase(factory,'real-account-data'),/synthetic database required/);assert.equal(called,false);
 assert.throws(()=>page.createCandidatePageClient({db:{name:'real-account-data'},vocabTransport:{},studyTransport:{}}),/synthetic database required/);
});
test('an ambiguous busy failure is not automatically retried',async()=>{
 const s=server(),db=await open(new IDBFactory(),'busy'),c=client(db,s);let calls=0;
 const previous=s.vt.append;s.vt.append=async()=>{calls++;throw Error('sync busy');};
 try{await c.activate(A);await c.vocabulary(word('busy-1'));await assert.rejects(c.run(),/sync busy/);assert.equal(calls,1);assert.equal((await read(db,q.STORE,A)).queue[0].acked,false);}
 finally{s.vt.append=previous;await c.cancel();db.close();s.close();}
});

test('offline records survive re-open, retry, then restore on a second synthetic device',async()=>{
 const s=server(),f=new IDBFactory();let a=await open(f,'device-a'),b=await open(f,'device-b');let c=client(a,s),d=client(b,s);
 try{
  await c.activate(A);await c.vocabulary(word('one'));const x=attempt(),y=checkin();await c.answer('attempt',x);await c.answer('checkin',y);
  s.setOffline(true);await assert.rejects(c.run(),/offline/);assert.equal((await read(a,q.STORE,A)).queue[0].acked,false);
  await c.cancel();a.close();a=await open(f,'device-a');c=client(a,s);await c.activate(A);s.setOffline(false);await c.run();
  await d.activate(A);await d.run();const restored=await d.readStudy(),voc=await read(b,q.STORE,A);
  assert.equal(voc.events.length,1);assert.equal(voc.events[0].id,'one');assert.equal(restored.data.attempts.length,1);assert.equal(restored.data.attempts[0].correct,false);
  assert.equal(restored.data.checkins.length,1);assert.equal(s.rows.size,2);assert.equal((await read(a,q.STORE,A)).queue[0].acked,true);
 }finally{await c.cancel();await d.cancel();a.close();b.close();s.close();}
});
test('same-client switch cancels a late acknowledgement without writing into the new owner',async()=>{
 const s=server(),f=new IDBFactory(),db=await open(f,'single'),c=client(db,s),pause=deferred(),entered=deferred();
 try{
  await c.activate(A);await c.vocabulary(word('old'));s.onAppend(()=>{entered.resolve();return pause.promise;});
  const old=c.run(),rejected=assert.rejects(old);await entered.promise;await c.activate(B);await rejected;pause.resolve();
  await c.vocabulary(word('new'));assert.equal((await read(db,q.STORE,A)).queue[0].acked,false);
  assert.deepEqual((await read(db,q.STORE,B)).events.map(e=>e.id),['new']);
 }finally{await c.cancel();db.close();s.close();}
});
test('different DB connections reject old-owner operations and old cancellation cannot revoke new owner',async()=>{
 const s=server(),f=new IDBFactory(),a=await open(f,'shared'),b=await open(f,'shared'),one=client(a,s),two=client(b,s);
 try{
  await one.activate(A);await two.activate(B);await assert.rejects(one.vocabulary(word('old')),/revoked/);
  await one.cancel();await two.vocabulary(word('new'));assert.deepEqual((await read(b,q.STORE,B)).events.map(e=>e.id),['new']);
 }finally{await one.cancel();await two.cancel();a.close();b.close();s.close();}
});
test('late study page from a separate connection cannot write after the shared fence switches owner',async()=>{
 const s=server(),f=new IDBFactory(),a=await open(f,'shared-page'),b=await open(f,'shared-page'),one=client(a,s),two=client(b,s),pause=deferred(),entered=deferred();
 try{
  await one.activate(A);s.onPull(()=>{entered.resolve();return pause.promise;});const run=one.run(),rejected=assert.rejects(run);await entered.promise;
  const before=await read(a,study.STATE,A);await two.activate(B);pause.resolve();await rejected;
  const after=await read(a,study.STATE,A);assert.deepEqual(after,before);await two.answer('checkin',checkin());
 }finally{await one.cancel();await two.cancel();a.close();b.close();s.close();}
});
test('lost acknowledgements retry the same vocab and study events without duplicate server rows',async()=>{
 const s=server(),f=new IDBFactory(),db=await open(f,'lost-ack'),c=client(db,s);
 try{
  await c.activate(A);await c.vocabulary(word('one'));await c.answer('attempt',attempt());
  s.loseNextVocab();await assert.rejects(c.run(),/lost acknowledgement/);assert.equal((await read(db,q.STORE,A)).queue[0].acked,false);
  s.loseNextStudy();await assert.rejects(c.run(),/lost acknowledgement/);assert.equal((await read(db,q.STORE,A)).queue[0].acked,true);assert.equal((await c.readStudy()).uploadAcks.length,0);
  await c.run();assert.equal(s.rows.size,1);assert.equal(s.vocab.server.db.prepare('SELECT COUNT(*) AS n FROM events WHERE owner=?').get(A).n,1);
  assert.equal((await c.readStudy()).uploadAcks.length,1);assert.equal((await read(db,q.STORE,A)).events.length,1);
 }finally{await c.cancel();db.close();s.close();}
});
test('vocabulary projection failure aborts event and pending queue together',async()=>{
 const s=server(),f=new IDBFactory(),db=await open(f,'rollback');
 const c=createSyntheticClient({db,project:()=>{throw Error('synthetic projection failure');},vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:study.createStudyRunner});
 try{await c.activate(A);const before=await read(db,q.STORE,A);await assert.rejects(c.vocabulary(word('bad')),/projection failure/);
  assert.deepEqual(await read(db,q.STORE,A),before);
 }finally{await c.cancel();db.close();s.close();}
});
test('logout during an in-flight vocabulary transaction aborts event and queue together',async()=>{
 const s=server(),f=new IDBFactory(),db=await open(f,'logout-in-transaction');let c,cancellation;
 const cancelDuringProjection=(...args)=>{cancellation=c.cancel();return project(...args);};
 c=createSyntheticClient({db,project:cancelDuringProjection,vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:study.createStudyRunner});
 try{await c.activate(A);const before=await read(db,q.STORE,A);await assert.rejects(c.vocabulary(word('old')));await cancellation;
  assert.deepEqual(await read(db,q.STORE,A),before);const row=await read(db,FENCE,'active');assert.equal(row.owner,null);
 }finally{await c.cancel();db.close();s.close();}
});
