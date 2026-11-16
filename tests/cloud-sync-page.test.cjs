'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRequire,Module}=require('node:module'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const req=createRequire(path.join(root,'package.json')),{IDBFactory}=req('fake-indexeddb'),{buildSync}=req('esbuild');
const {SyntheticTransport}=require('./helpers/synthetic-sync-transport.cjs');
const entry=`export * from './lib/cloud-sync/candidate-page.js'; export * from './lib/cloud-sync/offline-queue.js'; export {FENCE,COMMITS,createFence} from './lib/cloud-sync/idb-fence.js'; export {createRunner} from './lib/cloud-sync/sync-runner.js'; export * from './lib/cloud-sync/client.js'; export * from './lib/cloud-sync/study-runner.js'; export * from './lib/cloud-sync/vocabulary-projection.ts'; export * from './lib/cloud-sync/capture-vocabulary.js'; export * from './lib/cloud-sync/capture-study-journal.js'; export * from './lib/cloud-sync/vocabulary-capture.ts'; export {readVocabulary,writeVocabulary,vocabularyKey} from './lib/vocabulary-model.ts';`;
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
function server({grade=choice=>choice===0}={}){
 const vocab=new SyntheticTransport(),tokens=new Map([[A,vocab.issueTestSession(A)],[B,vocab.issueTestSession(B)]]),rows=new Map();let offline=false,delayAppend=null,delayPull=null,loseAppend=false,loseStudy=false;
 function gate(){if(offline)throw Error('synthetic offline');}
 const vt={append:async p=>{gate();const result=await vocab.append(tokens.get(p.owner),p.owner,[p.event]);if(delayAppend)await delayAppend();if(loseAppend){loseAppend=false;throw Error('synthetic lost acknowledgement');}return result;},
  begin:async p=>{gate();return vocab.begin(tokens.get(p.owner),p.pageSize);},page:async p=>{gate();return vocab.page(tokens.get(p.owner),p.snapshot,p.cursor);}};
 const st={upload:async p=>{gate();const w=p.wire;assert.equal(w.owner,p.owner);const key=p.owner+':'+w.type+':'+w.data.id;
  if(w.type==='attempt'){assert.equal('correct' in w.data,false);assert.equal('mode' in w.data,false);}
  const {firstAttemptId,...wireData}=w.data;
  const data=w.type==='attempt'?{...wireData,correct:grade(w.data.choice),mode:'first'}:w.data;
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
  const state=await c.readStudy();assert.deepEqual(state.pendingOperations,[]);assert.equal(state.uploadAcks.length,2);assert.equal(s.rows.size,2);
  assert.equal(source.raw.size,2);
 }finally{await c.cancel();db.close();s.close();}
});
test('a reordered offline queue uploads a proven first before its review and preserves conflicts',async()=>{
 const s=server(),db=await open(new IDBFactory(),'anchor-order'),c=client(db,s),first=attempt(),review={...attempt(),mode:'review',createdAt:'2025-01-01T00:00:00.000Z'},arrivals=[];
 s.st.upload=async p=>{
  const data=p.wire.data,root=s.rows.get(p.owner+':attempt:'+data.firstAttemptId);
  if(data.firstAttemptId!==data.id&&!root){const error=Error('anchor missing');error.code='NATIVE_CONFLICT';throw error;}
  arrivals.push(data.id);const {firstAttemptId,...body}=data;
  s.rows.set(p.owner+':attempt:'+data.id,{kind:'attempt',id:data.id,data:{...body,correct:body.choice===0,mode:data.id===firstAttemptId?'first':'review'}});
  return {status:200,body:{ok:true}};
 };
 try{
  await c.activate(A);await c.answer('attempt',review,undefined,randomUUID(),first.id);await c.answer('attempt',first,undefined,randomUUID(),first.id);
  await c.run();assert.deepEqual(arrivals,[first.id,review.id]);assert.equal((await c.readStudy()).uploadAcks.length,2);
  const orphan={...attempt(),qid:'unknown-q',mode:'review'};await c.answer('attempt',orphan,undefined,randomUUID(),randomUUID());
  await assert.rejects(c.run(),error=>error.code==='NATIVE_CONFLICT');
  assert.equal((await c.readStudy()).pendingOperations.length,1);assert.equal((await c.readStudy()).uploadAcks.length,2);
 }finally{await c.cancel();db.close();s.close();}
});
test('a server score disagreement stops download without losing the local attempt or advancing the checkpoint',async()=>{
 const s=server({grade:()=>false}),db=await open(new IDBFactory(),'score-conflict'),c=client(db,s),local=attempt();
 try{
  await c.activate(A);await c.answer('attempt',local);
  await assert.rejects(c.run(),error=>error.status===422);
  const state=await c.readStudy();
  assert.deepEqual(state.data.attempts,[local]);assert.equal(state.download.checkpoint,null);
  assert.equal(state.pendingOperations.length,0);assert.equal(state.data.attempts[0].correct,true);
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

test('capture pump retries only classified transient failures, preserving the durable event and owner',async()=>{
 const source=memoryStorage(),key=page.vocabularyKey(A),db=await open(new IDBFactory(),'capture-retry'),s=server(),c=client(db,s),target=new EventTarget();let pump,timer=null,calls=0;
 page.writeVocabulary(source.storage,key,[vocabMark('retry-mark')],{captureNewMark:true});
 const original=s.vt.append;s.vt.append=async(...args)=>{calls++;if(calls===1){const e=Error('temporarily unavailable');e.code='NATIVE_TRANSIENT';throw e;}return original(...args);};
 try{
  await c.activate(A);pump=page.createCapturedVocabularyMarkPump({storage:source.storage,owner:A,client:c,target,setTimer:(fn,ms)=>{timer={fn,ms};return timer;},clearTimer:()=>{timer=null;}});
  await assert.rejects(pump.wake());assert.equal((await read(db,q.STORE,A)).queue[0].acked,false);assert.equal(timer.ms,1000);
  const retry=timer.fn;timer=null;retry();await pump.wake();
  assert.equal((await read(db,q.STORE,A)).queue[0].acked,true);assert.equal(s.vocab.server.db.prepare('SELECT COUNT(*) AS n FROM events WHERE owner=?').get(A).n,1);
  const before=calls;s.vt.append=async()=>{calls++;const e=Error('conflict');e.code='NATIVE_CONFLICT';throw e;};
  page.writeVocabulary(source.storage,key,[vocabMark('conflict-mark')],{captureNewMark:true});await assert.rejects(pump.wake());
  assert.equal(timer,null);assert.equal(calls,before+1);assert.equal((await read(db,q.STORE,A)).queue.find(x=>x.id==='conflict-mark').acked,false);
 }finally{pump?.stop();await c.cancel();db.close();s.close();}
});
test('one wake captures offline study and vocabulary, then retries both without new operation ids',async()=>{
 const source=memoryStorage(),key=page.vocabularyKey(A),db=await open(new IDBFactory(),'combined-capture'),s=server(),c=client(db,s),target=new EventTarget(),first=attempt(),opId=randomUUID();let pump,timer=null,calls=0;
 page.writeVocabulary(source.storage,key,[vocabMark('combined-mark')],{captureNewMark:true});
 source.storage.setItem('lantern-v1-'+A+':op:'+opId,JSON.stringify({id:opId,owner:A,type:'attempt',data:first,firstAttemptId:first.id}));
 const original=s.vt.append;s.vt.append=async(...args)=>{if(++calls===1){const e=Error('offline');e.code='NATIVE_TRANSIENT';throw e;}return original(...args);};
 try{
  await c.activate(A);pump=page.createCapturedVocabularyMarkPump({storage:source.storage,owner:A,client:c,target,captureStudy:()=>page.scanSyntheticStudyJournal(source.storage,A,c),setTimer:fn=>{timer=fn;return fn;},clearTimer:()=>{timer=null;}});
  await assert.rejects(pump.wake());assert.equal((await c.readStudy()).pendingOperations[0].id,opId);assert.equal((await c.readStudy()).uploadAcks.length,0);
  const retry=timer;timer=null;retry();await pump.wake();
  assert.equal((await c.readStudy()).uploadAcks[0].id,opId);assert.equal(s.rows.size,1);assert.equal(s.vocab.server.db.prepare('SELECT COUNT(*) AS n FROM events WHERE owner=?').get(A).n,1);
 }finally{pump?.stop();await c.cancel();db.close();s.close();}
});
test('same-document study writes wake capture and upload without a focus or online event',async()=>{
 const source=memoryStorage(),db=await open(new IDBFactory(),'study-wake'),s=server(),c=client(db,s),target=new EventTarget(),first=attempt(),opId=randomUUID();let pump;
 try{
  await c.activate(A);pump=page.createCapturedVocabularyMarkPump({storage:source.storage,owner:A,client:c,target,captureStudy:()=>page.scanSyntheticStudyJournal(source.storage,A,c)});
  source.storage.setItem('lantern-v1-'+A+':op:'+opId,JSON.stringify({id:opId,owner:A,type:'attempt',data:first,firstAttemptId:first.id}));
  const change=new Event('lantern-study-changed');Object.defineProperty(change,'detail',{value:'lantern-v1-'+A});target.dispatchEvent(change);
  await pump.wake();assert.equal((await c.readStudy()).uploadAcks[0].id,opId);assert.equal(s.rows.size,1);
 }finally{pump?.stop();await c.cancel();db.close();s.close();}
});
test('a full study queue still accepts an exact rescan and never drops unacknowledged entries',async()=>{
 const s=server(),db=await open(new IDBFactory(),'study-cap'),c=client(db,s);
 try{
  await c.activate(A);const state=await c.readStudy(),rows=Array.from({length:5000},()=>({id:randomUUID(),owner:A,type:'checkin',data:checkin()}));
  state.pendingOperations=rows;state.data.checkins=rows.map(x=>x.data);
  await new Promise((resolve,reject)=>{const tx=db.transaction(study.STATE,'readwrite');tx.objectStore(study.STATE).put(state);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  await c.answer('checkin',rows[0].data,undefined,rows[0].id);await assert.rejects(c.answer('checkin',checkin(),undefined,randomUUID()),/queue full/);
  assert.equal((await c.readStudy()).pendingOperations.length,5000);
 }finally{await c.cancel();db.close();s.close();}
});
test('journal capture safely drains bounded batches and resumes the same source operation',async()=>{
 const source=memoryStorage(),s=server(),db=await open(new IDBFactory(),'study-batches'),ids=Array.from({length:5},()=>randomUUID()),items=ids.map(()=>checkin());
 const c=createSyntheticClient({db,project,vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:args=>page.createStudyRunner({...args,maxPending:2})});
 for(let i=0;i<ids.length;i++)source.storage.setItem('lantern-v1-'+A+':op:'+ids[i],JSON.stringify({id:ids[i],owner:A,type:'checkin',data:items[i]}));
 try{
  await c.activate(A);assert.equal(await page.scanSyntheticStudyJournal(source.storage,A,c),5);await c.run();
  let state=await c.readStudy();assert.equal(state.pendingOperations.length,0);assert.equal(state.uploadAcks.length,5);assert.equal(s.rows.size,5);assert.equal(source.raw.size,5);
  assert.equal(await page.scanSyntheticStudyJournal(source.storage,A,c),5);await c.run();state=await c.readStudy();
  assert.equal(state.uploadAcks.length,5);assert.equal(s.rows.size,5);
 }finally{await c.cancel();db.close();s.close();}
});
test('journal capture discovers the root before its earlier-enumerated review at capacity one',async()=>{
 const source=memoryStorage(),s=server(),db=await open(new IDBFactory(),'study-root-before-review'),first=attempt(),review={...attempt(),mode:'review'},ids=[randomUUID(),randomUUID()],arrivals=[];
 const c=createSyntheticClient({db,project,vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:args=>page.createStudyRunner({...args,maxPending:1})});
 for(const op of [{id:ids[1],owner:A,type:'attempt',data:review,firstAttemptId:first.id},{id:ids[0],owner:A,type:'attempt',data:first,firstAttemptId:first.id}])source.storage.setItem('lantern-v1-'+A+':op:'+op.id,JSON.stringify(op));
 s.st.upload=async p=>{const data=p.wire.data,key=p.owner+':attempt:'+data.firstAttemptId;if(data.firstAttemptId!==data.id&&!s.rows.has(key)){const error=Error('missing root');error.code='NATIVE_EVENT_CONFLICT';throw error;}
  arrivals.push(data.id);const {firstAttemptId,...body}=data;s.rows.set(p.owner+':attempt:'+data.id,{kind:'attempt',id:data.id,data:{...body,correct:body.choice===0,mode:data.id===firstAttemptId?'first':'review'}});return {status:200,body:{ok:true}};};
 try{await c.activate(A);assert.equal(await page.scanSyntheticStudyJournal(source.storage,A,c),2);await c.run();assert.deepEqual(arrivals,[first.id,review.id]);assert.equal(s.rows.size,2);assert.equal(source.raw.size,2);}
 finally{await c.cancel();db.close();s.close();}
});
test('an old full review queue yields atomically to its matching root and resumes after restart',async()=>{
 const source=memoryStorage(),s=server(),factory=new IDBFactory(),first=attempt(),review={...attempt(),mode:'review'},firstId=randomUUID(),reviewId=randomUUID(),arrivals=[];
 let db=await open(factory,'study-existing-review');const make=()=>createSyntheticClient({db,project,vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:args=>page.createStudyRunner({...args,maxPending:1})});let c=make();
 for(const op of [{id:reviewId,owner:A,type:'attempt',data:review,firstAttemptId:first.id},{id:firstId,owner:A,type:'attempt',data:first,firstAttemptId:first.id}])source.storage.setItem('lantern-v1-'+A+':op:'+op.id,JSON.stringify(op));
 s.st.upload=async p=>{const d=p.wire.data;if(d.firstAttemptId!==d.id&&!s.rows.has(p.owner+':attempt:'+d.firstAttemptId)){const e=Error('root absent');e.code='NATIVE_EVENT_CONFLICT';throw e;}
  arrivals.push(d.id);const {firstAttemptId,...body}=d;s.rows.set(p.owner+':attempt:'+d.id,{kind:'attempt',id:d.id,data:{...body,correct:body.choice===0,mode:d.id===firstAttemptId?'first':'review'}});return {status:200,body:{ok:true}};};
 try{
  await c.activate(A);await c.answer('attempt',review,undefined,reviewId,first.id);
  assert.equal(await page.scanSyntheticStudyJournal(source.storage,A,c),2);let state=await c.readStudy();
  assert.equal(state.pendingOperations[0].id,firstId);assert.equal(state.deferredOperations[0].id,reviewId);assert.equal(source.raw.size,2);
  await c.cancel();db.close();db=await open(factory,'study-existing-review');c=make();await c.activate(A);await c.run();
  state=await c.readStudy();assert.deepEqual(arrivals,[first.id,review.id]);assert.equal(state.pendingOperations.length,0);assert.equal(state.deferredOperations.length,0);assert.equal(state.uploadAcks.length,2);assert.equal(s.rows.size,2);
 }finally{await c.cancel();db.close();s.close();}
});
test('a permanently conflicting root cannot confirm or repeatedly run its deferred review',async()=>{
 const source=memoryStorage(),s=server(),db=await open(new IDBFactory(),'study-root-conflict'),first=attempt(),review={...attempt(),mode:'review'},firstId=randomUUID(),reviewId=randomUUID();let uploads=0;
 const c=createSyntheticClient({db,project,vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:args=>page.createStudyRunner({...args,maxPending:1})});
 for(const op of [{id:reviewId,owner:A,type:'attempt',data:review,firstAttemptId:first.id},{id:firstId,owner:A,type:'attempt',data:first,firstAttemptId:first.id}])source.storage.setItem('lantern-v1-'+A+':op:'+op.id,JSON.stringify(op));
 s.st.upload=async()=>{uploads++;const e=Error('conflict');e.code='NATIVE_EVENT_CONFLICT';throw e;};
 try{
  await c.activate(A);await c.answer('attempt',review,undefined,reviewId,first.id);await page.scanSyntheticStudyJournal(source.storage,A,c);
  await assert.rejects(c.run(),e=>e.code==='NATIVE_EVENT_CONFLICT');const state=await c.readStudy();
  assert.equal(uploads,1);assert.equal(state.pendingOperations[0].id,firstId);assert.equal(state.deferredOperations[0].id,reviewId);assert.equal(state.uploadAcks.length,0);assert.equal(state.download.checkpoint,null);
 }finally{await c.cancel();db.close();s.close();}
});
test('a lost root acknowledgement retries the same root before releasing its review',async()=>{
 const source=memoryStorage(),s=server(),db=await open(new IDBFactory(),'study-root-ack-loss'),first=attempt(),review={...attempt(),mode:'review'},firstId=randomUUID(),reviewId=randomUUID(),seen=[];let lost=false;
 const c=createSyntheticClient({db,project,vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:args=>page.createStudyRunner({...args,maxPending:1})});
 for(const op of [{id:reviewId,owner:A,type:'attempt',data:review,firstAttemptId:first.id},{id:firstId,owner:A,type:'attempt',data:first,firstAttemptId:first.id}])source.storage.setItem('lantern-v1-'+A+':op:'+op.id,JSON.stringify(op));
 s.st.upload=async p=>{const d=p.wire.data,key=p.owner+':attempt:'+d.id;seen.push(p.wire.id);
  if(d.id!==d.firstAttemptId&&!s.rows.has(p.owner+':attempt:'+d.firstAttemptId)){const e=Error('missing root');e.code='NATIVE_EVENT_CONFLICT';throw e;}
  const {firstAttemptId,...body}=d;s.rows.set(key,{kind:'attempt',id:d.id,data:{...body,correct:body.choice===0,mode:d.id===firstAttemptId?'first':'review'}});
  if(d.id===first.id&&!lost){lost=true;const e=Error('lost');e.code='NATIVE_TRANSIENT';throw e;}return {status:200,body:{ok:true}};};
 try{
  await c.activate(A);await c.answer('attempt',review,undefined,reviewId,first.id);await page.scanSyntheticStudyJournal(source.storage,A,c);
  await assert.rejects(c.run(),e=>e.code==='NATIVE_TRANSIENT');let state=await c.readStudy();assert.equal(state.pendingOperations[0].id,firstId);assert.equal(state.deferredOperations[0].id,reviewId);assert.equal(state.uploadAcks.length,0);
  await c.run();state=await c.readStudy();assert.deepEqual(seen,[firstId,firstId,reviewId]);assert.equal(state.deferredOperations.length,0);assert.equal(state.uploadAcks.length,2);assert.equal(s.rows.size,2);
 }finally{await c.cancel();db.close();s.close();}
});
test('unrelated reviews are never deferred to make room for a different question',async()=>{
 const source=memoryStorage(),s=server(),db=await open(new IDBFactory(),'study-unrelated-review'),first=attempt(),review={...attempt(),qid:'other-question',mode:'review'},firstId=randomUUID(),reviewId=randomUUID();
 const c=createSyntheticClient({db,project,vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:args=>page.createStudyRunner({...args,maxPending:1})});
 source.storage.setItem('lantern-v1-'+A+':op:'+firstId,JSON.stringify({id:firstId,owner:A,type:'attempt',data:first,firstAttemptId:first.id}));
 s.st.upload=async()=>{const e=Error('conflict');e.code='NATIVE_EVENT_CONFLICT';throw e;};
 try{
  await c.activate(A);await c.answer('attempt',review,undefined,reviewId,first.id);
  await assert.rejects(page.scanSyntheticStudyJournal(source.storage,A,c),e=>e.code==='NATIVE_EVENT_CONFLICT');const state=await c.readStudy();
  assert.equal(state.pendingOperations[0].id,reviewId);assert.equal(state.deferredOperations.length,0);assert.equal(source.raw.size,1);
 }finally{await c.cancel();db.close();s.close();}
});
test('root priority rejects operation IDs already held in blocked or deferred areas without writes',async()=>{
 for(const area of ['blockedOperations','deferredOperations']){
  const s=server(),db=await open(new IDBFactory(),'study-root-id-'+area.toLowerCase()),first=attempt(),review={...attempt(),mode:'review'},rootOpId=randomUUID(),reviewOpId=randomUUID();
  const c=createSyntheticClient({db,project,vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:args=>page.createStudyRunner({...args,maxPending:1})});
  try{
   await c.activate(A);await c.answer('attempt',review,undefined,reviewOpId,first.id);let state=await c.readStudy(),held={...attempt(),mode:'review'};
   state.data.attempts.push(held);state[area]=[{id:rootOpId,owner:A,type:'attempt',data:held,...(area==='deferredOperations'?{firstAttemptId:randomUUID()}:{})}];
   await new Promise((resolve,reject)=>{const tx=db.transaction(study.STATE,'readwrite');tx.objectStore(study.STATE).put(state);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
   const before=await c.readStudy();await assert.rejects(c.prioritizeRoot(first,c.session,rootOpId,first.id),/conflict/);assert.deepEqual(await c.readStudy(),before);
  }finally{await c.cancel();db.close();s.close();}
 }
});
test('an orphaned deferred review cannot advance the download checkpoint',async()=>{
 const s=server(),db=await open(new IDBFactory(),'study-deferred-orphan'),c=client(db,s),rootId=randomUUID(),review={...attempt(),mode:'review'},operation={id:randomUUID(),owner:A,type:'attempt',data:review,firstAttemptId:rootId};let pulls=0;
 s.st.pull=async()=>{pulls++;throw Error('must not pull');};
 try{
  await c.activate(A);let state=await c.readStudy();state.data.attempts.push(review);state.deferredOperations=[operation];
  await new Promise((resolve,reject)=>{const tx=db.transaction(study.STATE,'readwrite');tx.objectStore(study.STATE).put(state);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  await assert.rejects(c.run(),e=>e.code==='NATIVE_EVENT_CONFLICT');state=await c.readStudy();assert.equal(pulls,0);assert.equal(state.download.checkpoint,null);assert.deepEqual(state.deferredOperations,[operation]);
 }finally{await c.cancel();db.close();s.close();}
});
test('an old unanchored conflict in a full queue is preserved separately so a new proven root can upload',async()=>{
 const source=memoryStorage(),s=server(),db=await open(new IDBFactory(),'study-legacy-quarantine'),old={...attempt(),mode:'review'},first=attempt(),oldId=randomUUID(),firstId=randomUUID(),original=s.st.upload;
 const c=createSyntheticClient({db,project,vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:args=>page.createStudyRunner({...args,maxPending:1})});
 const legacy={id:oldId,owner:A,type:'attempt',data:old},root={id:firstId,owner:A,type:'attempt',data:first,firstAttemptId:first.id};
 source.storage.setItem('lantern-v1-'+A+':op:'+oldId,JSON.stringify(legacy));source.storage.setItem('lantern-v1-'+A+':op:'+firstId,JSON.stringify(root));
 s.st.upload=async p=>{if(p.wire.data.id===old.id){const error=Error('unproven');error.code='NATIVE_EVENT_CONFLICT';throw error;}return original(p);};
 try{
  await c.activate(A);await c.answer('attempt',old,undefined,oldId);assert.equal((await c.readStudy()).pendingOperations.length,1);
  assert.equal(await page.scanSyntheticStudyJournal(source.storage,A,c),2);await assert.rejects(c.run(),error=>error.code==='NATIVE_EVENT_CONFLICT');
  const state=await c.readStudy();assert.deepEqual(state.blockedOperations,[legacy]);assert.equal(state.pendingOperations.length,0);assert.equal(state.uploadAcks[0].id,firstId);assert.equal(state.download.checkpoint,null);assert.equal(s.rows.size,1);assert.equal(source.raw.size,2);
 }finally{await c.cancel();db.close();s.close();}
});
test('a conflict during batch drain preserves the record but does not starve later independent events',async()=>{
 const source=memoryStorage(),s=server(),db=await open(new IDBFactory(),'study-batch-conflict'),bad=attempt(),good=[checkin(),checkin()],ids=[randomUUID(),randomUUID(),randomUUID()],original=s.st.upload;
 const c=createSyntheticClient({db,project,vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:args=>page.createStudyRunner({...args,maxPending:2})});
 const operations=[{id:ids[0],owner:A,type:'attempt',data:bad,firstAttemptId:bad.id},...good.map((data,i)=>({id:ids[i+1],owner:A,type:'checkin',data}))];
 for(const op of operations)source.storage.setItem('lantern-v1-'+A+':op:'+op.id,JSON.stringify(op));
 s.st.upload=async p=>{if(p.wire.data.id===bad.id){const error=Error('conflict');error.code='NATIVE_EVENT_CONFLICT';throw error;}return original(p);};
 try{
  await c.activate(A);assert.equal(await page.scanSyntheticStudyJournal(source.storage,A,c),3);
  await assert.rejects(c.run(),error=>error.code==='NATIVE_EVENT_CONFLICT');
  const state=await c.readStudy();assert.deepEqual(state.pendingOperations.map(x=>x.id),[ids[0]]);assert.equal(state.uploadAcks.length,2);assert.equal(state.download.checkpoint,null);assert.equal(s.rows.size,2);assert.equal(source.raw.size,3);
 }finally{await c.cancel();db.close();s.close();}
});
test('a queue filled entirely by unresolved conflicts stops without spinning or losing later local events',async()=>{
 const source=memoryStorage(),s=server(),db=await open(new IDBFactory(),'study-batch-stalled'),bad=attempt(),later=checkin(),ids=[randomUUID(),randomUUID()];let calls=0;
 const c=createSyntheticClient({db,project,vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:args=>page.createStudyRunner({...args,maxPending:1})});
 for(const op of [{id:ids[0],owner:A,type:'attempt',data:bad,firstAttemptId:bad.id},{id:ids[1],owner:A,type:'checkin',data:later}])source.storage.setItem('lantern-v1-'+A+':op:'+op.id,JSON.stringify(op));
 s.st.upload=async()=>{calls++;const error=Error('conflict');error.code='NATIVE_EVENT_CONFLICT';throw error;};
 try{
  await c.activate(A);await assert.rejects(page.scanSyntheticStudyJournal(source.storage,A,c),error=>error.code==='NATIVE_EVENT_CONFLICT');
  assert.equal(calls,1);assert.equal((await c.readStudy()).pendingOperations[0].id,ids[0]);assert.equal(source.raw.size,2);assert.equal(s.rows.size,0);
 }finally{await c.cancel();db.close();s.close();}
});
test('a persistent conflict runs once more for a new in-flight study change without a hot loop',async()=>{
 const source=memoryStorage(),target=new EventTarget(),controller=new AbortController(),session={owner:A,signal:controller.signal},entered=deferred(),release=deferred();let calls=0;
 const client={session,vocabulary:async()=>{},async run(){calls++;if(calls===1){entered.resolve();await release.promise;}const error=Error('conflict');error.code='NATIVE_EVENT_CONFLICT';throw error;}};
 const pump=page.createCapturedVocabularyMarkPump({storage:source.storage,owner:A,client,target});
 try{
  const first=pump.wake(),failure=assert.rejects(first,error=>error.code==='NATIVE_EVENT_CONFLICT');await entered.promise;
  const changed=new Event('lantern-study-changed');Object.defineProperty(changed,'detail',{value:'lantern-v1-'+A});target.dispatchEvent(changed);release.resolve();await failure;
  for(let i=0;i<8&&calls<2;i++)await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls,2);
 }finally{release.resolve();pump.stop();controller.abort();}
});
test('confirmed study uploads compact only the pending entry and keep the event and fingerprint for rescans',async()=>{
 const s=server(),db=await open(new IDBFactory(),'study-ack-retention'),c=client(db,s),item=checkin(),id=randomUUID();
 try{
  await c.activate(A);await c.answer('checkin',item,undefined,id);await c.run();
  let state=await c.readStudy();assert.equal(state.pendingOperations.length,0);assert.equal(state.uploadAcks.length,1);assert.equal(state.data.checkins[0].id,item.id);
  await c.answer('checkin',item,undefined,id);state=await c.readStudy();assert.equal(state.pendingOperations.length,0);assert.equal(s.rows.size,1);
  await assert.rejects(c.answer('checkin',{...item,note:'conflicting'},undefined,id),/conflict/);assert.equal((await c.readStudy()).data.checkins[0].note,item.note);
 }finally{await c.cancel();db.close();s.close();}
});
test('upgraded old acknowledged pending rows are verified and cleared without another upload',async()=>{
 const s=server(),db=await open(new IDBFactory(),'study-legacy-ack'),c=client(db,s),item=checkin(),id=randomUUID();
 try{
  await c.activate(A);await c.answer('checkin',item,undefined,id);await c.run();let state=await c.readStudy();
  state.pendingOperations=[{id,owner:A,type:'checkin',data:item}];
  await new Promise((resolve,reject)=>{const tx=db.transaction(study.STATE,'readwrite');tx.objectStore(study.STATE).put(state);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  s.st.upload=async()=>{throw Error('must not upload again');};await c.run();state=await c.readStudy();
  assert.equal(state.pendingOperations.length,0);assert.equal(state.uploadAcks.length,1);assert.deepEqual(state.data.checkins,[item]);assert.equal(s.rows.size,1);
 }finally{await c.cancel();db.close();s.close();}
});
test('a full old acknowledged queue frees its slot for a new durable root during capture',async()=>{
 const source=memoryStorage(),s=server(),db=await open(new IDBFactory(),'study-legacy-full-ack'),item=checkin(),id=randomUUID(),root=attempt(),rootId=randomUUID();
 const c=createSyntheticClient({db,project,vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:args=>page.createStudyRunner({...args,maxPending:1})});
 source.storage.setItem('lantern-v1-'+A+':op:'+rootId,JSON.stringify({id:rootId,owner:A,type:'attempt',data:root,firstAttemptId:root.id}));
 try{
  await c.activate(A);await c.answer('checkin',item,undefined,id);await c.run();let state=await c.readStudy();
  state.pendingOperations=[{id,owner:A,type:'checkin',data:item}];
  await new Promise((resolve,reject)=>{const tx=db.transaction(study.STATE,'readwrite');tx.objectStore(study.STATE).put(state);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  assert.equal(await page.scanSyntheticStudyJournal(source.storage,A,c),1);await c.run();state=await c.readStudy();
  assert.equal(state.pendingOperations.length,0);assert.equal(state.uploadAcks.length,2);assert.equal(s.rows.size,2);assert.equal(source.raw.size,1);
 }finally{await c.cancel();db.close();s.close();}
});
test('old acknowledged rows with a mismatched local fact remain untouched',async()=>{
 const s=server(),db=await open(new IDBFactory(),'study-legacy-ack-invalid'),c=client(db,s),item=checkin(),id=randomUUID();
 try{
  await c.activate(A);await c.answer('checkin',item,undefined,id);await c.run();let state=await c.readStudy();
  state.pendingOperations=[{id,owner:A,type:'checkin',data:item}];state.data.checkins[0].note='conflicting';
  await new Promise((resolve,reject)=>{const tx=db.transaction(study.STATE,'readwrite');tx.objectStore(study.STATE).put(state);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  const before=await c.readStudy();await assert.rejects(c.run());assert.deepEqual(await c.readStudy(),before);
 }finally{await c.cancel();db.close();s.close();}
});
test('a single study record conflict keeps its queue and checkpoint while independent checkins upload',async()=>{
 const s=server(),db=await open(new IDBFactory(),'study-isolate-conflict'),c=client(db,s),bad=attempt(),good=checkin(),goodOp=randomUUID(),original=s.st.upload;
 s.st.upload=async p=>{if(p.wire.type==='attempt'){const e=Error('conflict');e.code='NATIVE_EVENT_CONFLICT';throw e;}return original(p);};
 try{
  await c.activate(A);await c.answer('attempt',bad,undefined,randomUUID(),bad.id);await c.answer('checkin',good,undefined,goodOp);
  await assert.rejects(c.run(),e=>e.code==='NATIVE_EVENT_CONFLICT');const state=await c.readStudy();
  assert.equal(state.pendingOperations.length,1);assert.equal(state.pendingOperations[0].data.id,bad.id);assert.equal(state.uploadAcks[0].id,goodOp);assert.equal(state.download.checkpoint,null);assert.equal(s.rows.size,1);
 }finally{await c.cancel();db.close();s.close();}
});
test('vocabulary event conflict permits independent study upload, but account errors stop both',async()=>{
 for(const code of ['NATIVE_EVENT_CONFLICT','NATIVE_AUTH','NATIVE_CONFLICT']){
  const s=server(),db=await open(new IDBFactory(),'vocab-study-'+code.toLowerCase().replaceAll('_','-')),c=client(db,s),item=checkin(),id=randomUUID();
  s.vt.append=async()=>{const error=Error('rejected');error.code=code;throw error;};
  try{
   await c.activate(A);await c.vocabulary(vocabMark('vocab-conflict'));await c.answer('checkin',item,undefined,id);
   await assert.rejects(c.run(),e=>e.code===code);const state=await c.readStudy();
   assert.equal(state.uploadAcks.length,code==='NATIVE_EVENT_CONFLICT'?1:0);assert.equal(state.pendingOperations.length,code==='NATIVE_EVENT_CONFLICT'?0:1);
  }finally{await c.cancel();db.close();s.close();}
 }
});
test('study timeout aborts its request and retries the same durable operation ID',async()=>{
 const s=server(),db=await open(new IDBFactory(),'study-timeout'),id=randomUUID(),item=checkin(),calls=[],original=s.st.upload;
 const c=createSyntheticClient({db,project,vocabTransport:s.vt,studyTransport:s.st,createStudyRunner:args=>page.createStudyRunner({...args,timeoutMs:10})});
 s.st.upload=async p=>{calls.push(p.wire.id);return new Promise((_resolve,reject)=>p.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));};
 try{
  await c.activate(A);await c.answer('checkin',item,undefined,id);await assert.rejects(c.run(),e=>e.code==='NATIVE_TRANSIENT');
  assert.equal((await c.readStudy()).pendingOperations[0].id,id);s.st.upload=async p=>{calls.push(p.wire.id);return original(p);};
  await c.run();assert.deepEqual(calls,[id,id]);assert.equal(s.rows.size,1);
 }finally{await c.cancel();db.close();s.close();}
});
test('vocabulary timeout aborts and preserves the same durable event for retry',async()=>{
 const s=server(),db=await open(new IDBFactory(),'vocab-timeout'),fence=page.createFence(db),ticket=await fence.activate(A),session={owner:A,ticket,signal:new AbortController().signal},seen=[],original=s.vt.append;
 s.vt.append=async (p,signal)=>{seen.push(p.event.id);return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));};
 const runner=page.createRunner({db,project,transport:s.vt,timeoutMs:10});
 try{
  await page.prepareVocab(db,session);runner.activate(A,ticket);await runner.enqueue(word('vocab-timeout'));
  await assert.rejects(runner.run(),e=>e.code==='NATIVE_TRANSIENT');assert.equal((await read(db,q.STORE,A)).queue[0].acked,false);
  s.vt.append=async (...args)=>{seen.push(args[0].event.id);return original(...args);};await runner.run();
  assert.deepEqual(seen,['vocab-timeout','vocab-timeout']);assert.equal((await read(db,q.STORE,A)).queue[0].acked,true);
 }finally{runner.cancel();await fence.revoke(ticket);db.close();s.close();}
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
  assert.equal(voc.events.length,1);assert.equal(voc.events[0].id,'one');assert.equal(restored.data.attempts.length,1);assert.equal(restored.data.attempts[0].correct,true);
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
