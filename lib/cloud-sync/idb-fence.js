'use strict';
// Synthetic IndexedDB-only fence. Tokens are local coordination values, NOT
// authenticated identity, credentials, or authority to use a remote account.
const FENCE='syntheticUnifiedFence',COMMITS='syntheticUnifiedCommits';
const invalid=()=>Error('stale or invalid synthetic fence');
const matches=(record,ticket)=>!!record&&!!ticket&&record.owner===ticket.owner&&
 Number.isSafeInteger(record.generation)&&record.generation===ticket.generation&&record.nonce===ticket.nonce;
function createFence(db,{randomUUID=()=>globalThis.crypto.randomUUID()}={}){
 if(!db||typeof randomUUID!=='function')throw Error('invalid synthetic fence');
 function activate(owner){return new Promise((resolve,reject)=>{
  let tx,ticket,reason;try{tx=db.transaction(FENCE,'readwrite');}catch(e){reject(e);return;}
  const store=tx.objectStore(FENCE),req=store.get('active');
  req.onsuccess=()=>{try{
   const old=req.result?.generation??0,nonce=randomUUID();
   if(!Number.isSafeInteger(old)||old<0||old>=Number.MAX_SAFE_INTEGER||typeof nonce!=='string'||!nonce)throw invalid();
   ticket={owner,generation:old+1,nonce};store.put({id:'active',...ticket});
  }catch(e){reason=e;tx.abort();}};
  tx.oncomplete=()=>resolve(Object.freeze(ticket));tx.onabort=()=>reject(reason??tx.error??invalid());tx.onerror=()=>{};
 });}
 function revoke(ticket){return new Promise((resolve,reject)=>{
  let tx,reason;try{tx=db.transaction(FENCE,'readwrite');}catch(e){reject(e);return;}
  const store=tx.objectStore(FENCE),req=store.get('active');
  req.onsuccess=()=>{try{const row=req.result;if(matches(row,ticket)){
   if(row.generation>=Number.MAX_SAFE_INTEGER)throw invalid();
   store.put({id:'active',owner:null,generation:row.generation+1,nonce:null});
  }}catch(e){reason=e;tx.abort();}};
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(reason??tx.error??invalid());tx.onerror=()=>{};
 });}
 function commit(ticket,payload,isLive){return new Promise((resolve,reject)=>{
  let tx,reason;try{tx=db.transaction([FENCE,COMMITS],'readwrite');}catch(e){reject(e);return;}
  const req=tx.objectStore(FENCE).get('active');
  req.onsuccess=()=>{try{if(!matches(req.result,ticket)||!isLive())throw invalid();
   tx.objectStore(COMMITS).put({id:globalThis.crypto.randomUUID(),owner:ticket.owner,payload});
  }catch(e){reason=e;tx.abort();}};
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(reason??tx.error??invalid());tx.onerror=()=>{};
 });}
 return {activate,revoke,commit};
}
export {FENCE,COMMITS,matches,createFence};
