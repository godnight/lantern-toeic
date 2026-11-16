'use strict';
// Experimental IDB queue for synthetic data only. There is no network or
// authentication implementation and no connection to real app storage.
const STORE='syntheticVocabularyQueue';
import {FENCE,matches} from './idb-fence.js';
const sessions=new WeakMap();
const copy=v=>JSON.parse(JSON.stringify(v));
const stable=v=>Array.isArray(v)?`[${v.map(stable).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`:JSON.stringify(v);

function createSession(owner,ticket){
 if(!ticket||ticket.owner!==owner)throw Error('invalid fence ticket');
 const c=new AbortController(),s=Object.freeze({owner,ticket,signal:c.signal,isCurrent:()=>!c.signal.aborted});sessions.set(s,c);return s;
}
function revokeSession(session){const c=sessions.get(session);if(!c)throw Error('invalid session');c.abort();}
function isCurrent(session,owner){return !!session&&sessions.has(session)&&session.owner===owner&&!session.signal.aborted;}
function initial(owner){return {owner,stateVersion:0,events:[],queue:[],download:{snapshot:null,cursor:null,upper:null,lastUpper:null}};}

function transact(db,session,owner,change){
 return new Promise((resolve,reject)=>{
  if(!isCurrent(session,owner)){reject(Error('session revoked'));return;}
  let tx,result,reason;
  try {tx=db.transaction([STORE,FENCE],'readwrite');}catch(e){reject(e);return;}
  const abort=()=>{reason=Error('session revoked');try{tx.abort();}catch{}};
  session.signal.addEventListener('abort',abort,{once:true});
  const cleanup=()=>session.signal.removeEventListener('abort',abort);
  tx.oncomplete=()=>{cleanup();resolve(copy(result));};
  tx.onabort=()=>{cleanup();reject(reason||tx.error||Error('transaction aborted'));};
  tx.onerror=()=>{};
  try {
   const store=tx.objectStore(STORE),request=store.get(owner),fence=tx.objectStore(FENCE).get('active');let ready=0;
   const process=()=>{if(++ready!==2)return;try{
    if(!isCurrent(session,owner)||!matches(fence.result,session.ticket))throw Error('session revoked');
    const state=request.result;if(!state||state.owner!==owner||!Array.isArray(state.events)||!Array.isArray(state.queue)||!Number.isSafeInteger(state.stateVersion)||state.stateVersion<0)throw Error('invalid state');
    const seen=new Set();let eventIndex;
    for(const item of state.queue){
     if(!item||typeof item.id!=='string'||typeof item.acked!=='boolean'||item.event?.id!==item.id||seen.has(item.id))throw Error('invalid queue');
     // Build once per transaction rather than scanning the complete event
     // array once per pending item. Keep duplicate detection and payload
     // comparison identical to the prior per-item filter.
     if(!eventIndex){eventIndex=new Map();for(const event of state.events){const id=event.id,old=eventIndex.get(id);if(old)old.count++;else eventIndex.set(id,{count:1,event});}}
     const match=eventIndex.get(item.id);if(!match||match.count!==1||stable(match.event)!==stable(item.event))throw Error('queue and local event mismatch');seen.add(item.id);
    }
    result=change(state);if(!isCurrent(session,owner))throw Error('session revoked');store.put(result);
   }catch(e){reason=e;try{tx.abort();}catch{}}};
   request.onsuccess=process;fence.onsuccess=process;
  }catch(e){reason=e;try{tx.abort();}catch{cleanup();reject(e);}}
 });
}

// Write the local event and its pending upload in the SAME IDB transaction.
// `project` is the existing isolated vocabulary validator/merger. The caller
// must arrange that all local writers use this store and lifecycle fence.
function enqueue(db,session,event,project,sourceGuard){
 if(sourceGuard!==undefined&&typeof sourceGuard!=='function')return Promise.reject(Error('invalid source guard'));
 let fixed;try{fixed=copy(event);}catch(e){return Promise.reject(e);}
 const owner=session?.owner;
 return transact(db,session,owner,state=>{
  // This guard executes immediately before this transaction decides to write.
  // It is a best-effort recheck, not an atomic localStorage/IDB lock.
  if(sourceGuard&&sourceGuard()!==true)throw Error('vocabulary source changed');
  const rows=state.queue.filter(q=>q.id===fixed?.id);
  if(rows.length>1)throw Error('duplicate queue id');
  if(rows.length){if(stable(rows[0].event)!==stable(fixed)){const error=Error('conflicting queue id');error.code='NATIVE_EVENT_CONFLICT';throw error;}return state;}
  const existing=state.events.filter(e=>e.id===fixed?.id);
  if(existing.length>1)throw Error('duplicate vocabulary event');
  if(existing.length&&stable(existing[0])!==stable(fixed)){const error=Error('conflicting vocabulary event');error.code='NATIVE_EVENT_CONFLICT';throw error;}
  const merged=project({version:1,owner,stateVersion:state.stateVersion,events:state.events},{version:1,owner,events:[fixed]},{owner,stateVersion:state.stateVersion},session);
  if(sourceGuard&&sourceGuard()!==true)throw Error('vocabulary source changed');
  return {...state,stateVersion:merged.stateVersion,events:copy(merged.events),queue:[...state.queue,{id:fixed.id,event:fixed,acked:false}]};
 });
}

// An acknowledgement only marks the exact enqueued payload. The event is
// never removed from local storage. Callers must verify authenticated server
// responses before invoking; a synthetic {ok:true} is NOT proof of upload.
function acknowledge(db,session,sent,ack){
 let fixedSent,fixedAck;try{fixedSent=copy(sent);fixedAck=copy(ack);}catch(e){return Promise.reject(e);}
 const owner=session?.owner;
 return transact(db,session,owner,state=>{
  if(!fixedAck || fixedAck.ok!==true || fixedAck.owner!==owner || fixedAck.id!==fixedSent?.id)throw Error('invalid acknowledgement');
  const rows=state.queue.filter(q=>q.id===fixedSent.id);if(rows.length!==1||stable(rows[0].event)!==stable(fixedSent))throw Error('acknowledgement does not match queued payload');
  if(rows[0].acked)return state;
  if(state.stateVersion>=Number.MAX_SAFE_INTEGER)throw Error('version overflow');
  return {...state,stateVersion:state.stateVersion+1,queue:state.queue.map(q=>q.id===fixedSent.id?{...q,acked:true}:q)};
 });
}

// A test-only download record is saved before requesting page one; it cannot
// replace another in-progress snapshot. Both token and cursor are untrusted
// prototypes and require authenticated, integrity-protected transport.
function beginSnapshot(db,session,metadata){
 let fixed;try{fixed=copy(metadata);}catch(e){return Promise.reject(e);}
 const owner=session?.owner;
 return transact(db,session,owner,state=>{
  if(!fixed||fixed.owner!==owner||typeof fixed.id!=='string'||!fixed.id||fixed.id.length>128||typeof fixed.cursor!=='string'||!fixed.cursor||fixed.cursor.length>128||!Number.isSafeInteger(fixed.upper)||fixed.upper<0)throw Error('invalid snapshot');
  if(!state.download||state.download.snapshot!==null)throw Error('snapshot in progress');
  if(state.download.lastUpper!==null&&fixed.upper<state.download.lastUpper)throw Error('snapshot regressed');
  if(state.stateVersion>=Number.MAX_SAFE_INTEGER)throw Error('version overflow');
  return {...state,stateVersion:state.stateVersion+1,download:{...state.download,snapshot:fixed.id,cursor:fixed.cursor,upper:fixed.upper}};
 });
}

// The page and its cursor advance together in a single owner-scoped IDB
// transaction. Request identity is captured at dispatch, not reconstructed
// after an async reply, to reject stale or cross-account responses.
function applySnapshotPage(db,session,request,page,project){
 let fixedRequest,fixedPage;try{fixedRequest=copy(request);fixedPage=copy(page);}catch(e){return Promise.reject(e);}
 const owner=session?.owner;
 return transact(db,session,owner,state=>{
  const d=state.download;
  if(!d||!fixedRequest||fixedRequest.owner!==owner||fixedRequest.snapshot!==d.snapshot||fixedRequest.cursor!==d.cursor||fixedRequest.upper!==d.upper||d.snapshot===null)throw Error('stale request');
  if(!fixedPage||fixedPage.owner!==owner||fixedPage.id!==d.snapshot||fixedPage.cursor!==d.cursor||fixedPage.upper!==d.upper||!Array.isArray(fixedPage.events)||(fixedPage.next!==null&&(typeof fixedPage.next!=='string'||!fixedPage.next||fixedPage.next===d.cursor)))throw Error('invalid page');
  const merged=project({version:1,owner,stateVersion:state.stateVersion,events:state.events},{version:1,owner,events:fixedPage.events},{owner,stateVersion:state.stateVersion},session);
  const download=fixedPage.next===null?{snapshot:null,cursor:null,upper:null,lastUpper:d.upper}:{...d,cursor:fixedPage.next};
  return {...state,stateVersion:merged.stateVersion,events:copy(merged.events),download};
 });
}
export {STORE,createSession,revokeSession,initial,enqueue,acknowledge,beginSnapshot,applySnapshotPage};
