'use strict';
// Caller supplies ONLY synthetic DB and synthetic transports. No auth/network.
import * as q from './offline-queue.js';
import {createRunner} from './sync-runner.js';
import {FENCE,matches,createFence} from './idb-fence.js';
import {createCoordinator} from './coordinator.js';
function prepareVocab(db,session){return new Promise((resolve,reject)=>{
 let tx,reason;try{tx=db.transaction([FENCE,q.STORE],'readwrite');}catch(e){reject(e);return;}
 const f=tx.objectStore(FENCE).get('active'),store=tx.objectStore(q.STORE),v=store.get(session.owner);let count=0;
 const abort=()=>{reason=Error('session revoked');try{tx.abort();}catch{}};
 session.signal.addEventListener('abort',abort,{once:true});
 function done(){if(++count!==2)return;try{
  if(session.signal.aborted||!matches(f.result,session.ticket))throw Error('session revoked');
  if(!v.result)store.put(q.initial(session.owner));else if(v.result.owner!==session.owner)throw Error('owner mismatch');
 }catch(e){reason=e;try{tx.abort();}catch{}}}
 f.onsuccess=done;v.onsuccess=done;
 const cleanup=()=>session.signal.removeEventListener('abort',abort);
 tx.oncomplete=()=>{cleanup();resolve();};tx.onabort=()=>{cleanup();reject(reason??tx.error??Error('transaction aborted'));};tx.onerror=()=>{};
 if(session.signal.aborted)abort();
});}
function createSyntheticClient({db,project,vocabTransport,studyTransport,createStudyRunner}){
 const vocab=createRunner({db,project,transport:vocabTransport});
 const study=createStudyRunner({db,transport:studyTransport});
 const safeBusy=(err)=>{throw err;};
 const coordinator=createCoordinator({fence:createFence(db),
  vocabulary:async()=>{try{await vocab.run();}catch(e){safeBusy(e,'sync busy');}},
  study:async()=>{try{await study.run();}catch(e){safeBusy(e,'synthetic runner busy');}}});
 let active=null,serial=0,ready=false;
 async function activate(owner){
  ready=false;const revision=++serial;await coordinator.activate(owner);const session=coordinator.session();
  if(revision!==serial||session.owner!==owner||session.signal.aborted)throw Error('session revoked');active=session;
  const invalidate=()=>{if(active===session){ready=false;active=null;vocab.cancel();study.cancel();}};
  session.signal.addEventListener('abort',invalidate,{once:true});
  try{
   await prepareVocab(db,session);if(session.signal.aborted||revision!==serial)throw Error('session revoked');
   vocab.activate(owner,session.ticket);await study.activate(owner,session.ticket);
   if(session.signal.aborted||revision!==serial)throw Error('session revoked');
   ready=true;return session;
  }catch(e){if(active===session){ready=false;await coordinator.cancel();active=null;}throw e;}
 }
 async function cancel(){ready=false;serial++;const old=active;await coordinator.cancel();if(active===old)active=null;}
 function assertActive(){if(!ready||!active||active.signal.aborted)throw Error('session revoked');}
 return {activate,cancel,run:(expectedSession)=>{assertActive();if(expectedSession!==undefined&&active!==expectedSession)throw Error('session revoked');return coordinator.run();},
  vocabulary:(event,expectedSession)=>{assertActive();if(expectedSession!==undefined&&active!==expectedSession)throw Error('session revoked');return vocab.enqueue(event);},
  answer:(type,event,expectedSession,operationId)=>{assertActive();if(expectedSession!==undefined&&active!==expectedSession)throw Error('session revoked');return study.record(type,event,operationId);},
  readStudy:()=>{assertActive();return study.read();},
  get session(){return ready?active:null;}};
}
export {createSyntheticClient,prepareVocab};
