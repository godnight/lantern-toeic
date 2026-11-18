'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {hostRuntime,response}=require('./helpers/native-auth-host-runtime.cjs');
const token='a'.repeat(64), other='b'.repeat(64);
const user={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic'};
const caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false};
const proof=()=>response(200,{user,capabilities:caps,session:{version:2,remainingMs:1000}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const session=id=>({version:2,id,action:'session'});

test('cold candidate is off by default and cannot publish an owner before page session',async()=>{
 const h=hostRuntime({initialToken:token,dispatch:proof});
 try{h.host.beginColdStartCandidate(()=>true);await h.settle();assert.equal(h.requests.length,0);assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);}finally{h.dispose();}
});
test('a trusted page joins an in-flight proof and deducts the whole prefetch wait',async()=>{
 const d=deferred();const h=hostRuntime({coldPrefetch:true,initialToken:token,dispatch:()=>d.promise});
 try{
  h.host.beginColdStartCandidate(()=>true);await h.settle();assert.equal(h.requests.length,1);
  assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
  const result=h.invoke(session('cold_join'));h.advance(150);d.resolve(proof());
  const reply=await result;assert.equal(reply.status,200);assert.equal(reply.body.session.validForMs,850);
  assert.equal(h.requests.length,1);assert.equal(h.host.trustedOwnerProvider().snapshot().uid,user.id);
 }finally{d.resolve(proof());h.dispose();}
});
test('navigation and account change discard early results, including when a later request is busy',async()=>{
 for(const action of ['navigation','login']){
  const d=deferred();let calls=0;const h=hostRuntime({coldPrefetch:true,initialToken:token,dispatch:()=>++calls===1?d.promise:proof()});
  try{
   h.host.beginColdStartCandidate(()=>true);await h.settle();
   if(action==='navigation')h.host.invalidate();
   else {const r=await h.invoke({id:'busy_login',action:'login',body:{username:'synthetic',password:'12345678'}});assert.equal(r.status,503);}
   d.resolve(proof());await h.settle();assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
   const result=await h.invoke(session('fresh_'+action));assert.equal(result.status,200);assert.equal(h.requests.length,2);
  }finally{d.resolve(proof());h.dispose();}
 }
});
test('a pending cold session cannot re-establish identity after an intervening account action',async()=>{
 for(const action of ['logout','login']){
  const d=deferred();const h=hostRuntime({coldPrefetch:true,initialToken:token,dispatch:()=>d.promise});
  try{
   h.host.beginColdStartCandidate(()=>true);await h.settle();const waiting=h.invoke(session('old_session'));
   const operation=action==='logout'?{id:'identity_change',action:'logout'}:
    {id:'identity_change',action:'login',body:{username:'synthetic',password:'12345678'}};
   assert.equal((await h.invoke(operation)).status,503);
   d.resolve(proof());assert.equal((await waiting).status,503);await h.settle();
   assert.equal(h.requests.length,1);assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
  }finally{d.resolve(proof());h.dispose();}
 }
});
test('an identity action in another host invalidates a waiting cold join',async()=>{
 const d=deferred();const h=hostRuntime({coldPrefetch:true,initialToken:token,dispatch:()=>d.promise});let peer;
 try{
  h.host.beginColdStartCandidate(()=>true);await h.settle();const waiting=h.invoke(session('old_host'));
  peer=h.newPeer();peer.request(JSON.stringify({id:'peer_logout',action:'logout'}));await h.settle();
  assert.equal(h.replies.find(r=>r.id==='peer_logout').status,503);
  d.resolve(proof());assert.equal((await waiting).status,503);assert.equal(h.requests.length,1);
  assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
 }finally{d.resolve(proof());peer?.dispose();h.dispose();}
});
test('a peer account action invalidates session consumption while Asset is being re-read',async()=>{
 const read=deferred();const store={peekColdStartCandidate:async()=>token,load:()=>read.promise,save:async()=>{},clear:async()=>{},hasDormantPersistent:()=>false};
 const h=hostRuntime({coldPrefetch:true,initialToken:token,sessionStore:store,dispatch:proof});let peer;
 try{
  h.host.beginColdStartCandidate(()=>true);await h.settle();const waiting=h.invoke(session('reading_asset'));
  await h.settle();peer=h.newPeer();peer.request(JSON.stringify({id:'peer_logout',action:'logout'}));await h.settle();
  assert.equal(h.replies.find(r=>r.id==='peer_logout').status,503);
  read.resolve(token);assert.equal((await waiting).status,503);assert.equal(h.requests.length,1);
  assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
 }finally{read.resolve(token);peer?.dispose();h.dispose();}
});
test('a peer logout revokes published owner while offline-proof persistence is pending',async()=>{
 const save=deferred();const entered=deferred();const fence={saveVerified:async()=>{entered.resolve();return save.promise;},markPending:async()=>{}};
 const h=hostRuntime({coldPrefetch:true,offlineFence:fence,initialToken:token,dispatch:proof});let peer;
 try{
  h.host.beginColdStartCandidate(()=>true);await h.settle();const waiting=h.invoke(session('persisting'));
  await entered.promise;assert.equal(h.host.trustedOwnerProvider().snapshot().uid,user.id);
  peer=h.newPeer();peer.request(JSON.stringify({id:'peer_logout',action:'logout'}));await h.settle();
  assert.equal(h.replies.find(r=>r.id==='peer_logout').status,503);
  assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
  save.resolve(true);await h.settle();assert.equal(h.replies.some(r=>r.id==='persisting'&&r.status===200),false);
 }finally{save.resolve(true);peer?.dispose();h.dispose();}
});
test('a non-app calling frame cannot consume a candidate or receive an owner',async()=>{
 const h=hostRuntime({coldPrefetch:true,initialToken:token,dispatch:proof});
 try{
  h.host.beginColdStartCandidate(()=>true);await h.settle();h.setFrame('https://attacker.invalid/');
  h.send(session('foreign_frame'));await h.settle();assert.equal(h.replies.length,0);
  assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
 }finally{h.dispose();}
});
test('a changed token or expired candidate forces the original session request',async()=>{
 for(const reason of ['token','age']){
  const h=hostRuntime({coldPrefetch:true,initialToken:token,dispatch:proof});
  try{
   h.host.beginColdStartCandidate(()=>true);await h.settle();assert.equal(h.requests.length,1);
   if(reason==='token')await h.store.save('https://auth.test',other,100);
   else h.advance(5001);
   const reply=await h.invoke(session('fresh_'+reason));assert.equal(reply.status,200);assert.equal(h.requests.length,2);
  }finally{h.dispose();}
 }
});
test('an unconsumed proof is discarded on its own deadline',async()=>{
 const h=hostRuntime({coldPrefetch:true,initialToken:token,dispatch:proof});
 try{
  h.host.beginColdStartCandidate(()=>true);await h.settle();assert.equal(h.requests.length,1);
  h.advance(5000);h.expire(5000);const reply=await h.invoke(session('after_expiry'));
  assert.equal(reply.status,200);assert.equal(h.requests.length,2);
 }finally{h.dispose();}
});
test('prefetch failures do not clear the store or replace normal 401 handling',async()=>{
 for(const bad of [response(401,{code:'unauthenticated'}),response(200,{},{'set-cookie':'__Host-lantern-session=x'}),response(302,{})]){
  let calls=0;const h=hostRuntime({coldPrefetch:true,initialToken:token,dispatch:()=>++calls===1?bad:response(401,{code:'unauthenticated'})});
  try{
   h.host.beginColdStartCandidate(()=>true);await h.settle();assert.equal(h.clears,0);assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
   const reply=await h.invoke(session('reject_'+calls));assert.equal(reply.status,401);assert.equal(h.clears,1);assert.equal(h.requests.length,2);
  }finally{h.dispose();}
 }
});
test('waiting page receives one timeout and a late result grants no owner',async()=>{
 const d=deferred();const h=hostRuntime({coldPrefetch:true,initialToken:token,dispatch:()=>d.promise});
 try{
  h.host.beginColdStartCandidate(()=>true);await h.settle();const waiting=h.invoke(session('timeout'));
  h.expire(15000);assert.equal((await waiting).status,503);d.resolve(proof());await h.settle();
  assert.equal(h.replies.length,1);assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
 }finally{d.resolve(proof());h.dispose();}
});

test('a permanently pending speculative Asset read releases only its own slot after the deadline',async()=>{
 const read=deferred(), next=deferred();let peekCount=0;
 const store={peekColdStartCandidate:()=>{peekCount++;return read.promise;},load:async()=>token,save:async()=>{},clear:async()=>{},hasDormantPersistent:()=>false};
 const h=hostRuntime({coldPrefetch:true,sessionStore:store,dispatch:()=>next.promise});let peer;
 try{
  h.host.beginColdStartCandidate(()=>true);await h.settle();assert.equal(peekCount,1);assert.equal(h.requests.length,0);
  const waiting=h.invoke(session('hung_asset'));h.expire(15000);assert.equal((await waiting).status,503);
  const current=h.invoke(session('after_hung_asset'));await h.settle();assert.equal(h.requests.length,1);
  read.resolve(token);await h.settle();assert.equal(h.requests.length,1,'late read must not start its GET');
  peer=h.newPeer();peer.request(JSON.stringify({id:'while_current_busy',action:'providers'}));await h.settle();
  assert.equal(h.replies.find(r=>r.id==='while_current_busy').status,503,'late finally must not release the current slot');
  next.resolve(proof());assert.equal((await current).status,200);
  h.host.invalidate();h.host.beginColdStartCandidate(()=>true);await h.settle();assert.equal(peekCount,1,'do not accumulate abandoned speculative reads');
 }finally{read.resolve(token);next.resolve(proof());peer?.dispose();h.dispose();}
});

test('a late speculative GET cannot restore an owner after a subsequent logout',async()=>{
 const coldGet=deferred(), logout=deferred();let calls=0;
 const h=hostRuntime({coldPrefetch:true,initialToken:token,dispatch:()=>++calls===1?coldGet.promise:logout.promise});let peer;
 try{
  h.host.beginColdStartCandidate(()=>true);await h.settle();assert.equal(h.requests.length,1);
  const waiting=h.invoke(session('hung_get'));h.expire(15000);assert.equal((await waiting).status,503);
  const signedOut=h.invoke({id:'logout_after_hung_get',action:'logout'});await h.settle();assert.equal(h.requests.length,2);
  coldGet.resolve(proof());await h.settle();assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
  peer=h.newPeer();peer.request(JSON.stringify({id:'while_logout_busy',action:'providers'}));await h.settle();
  assert.equal(h.replies.find(r=>r.id==='while_logout_busy').status,503);
  logout.resolve(response(200,{ok:true},{'set-cookie':'__Host-lantern-session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'}));
  assert.equal((await signedOut).status,200);assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);assert.equal(h.clears,1);
 }finally{coldGet.resolve(proof());logout.resolve(response(503,{}));peer?.dispose();h.dispose();}
});

test('an invalidated unjoined flight still expires and cannot release a peer operation',async()=>{
 const peek=deferred(), peerSession=deferred();let peekCount=0;
 const store={peekColdStartCandidate:()=>{peekCount++;return peek.promise;},load:async()=>token,save:async()=>{},clear:async()=>{},hasDormantPersistent:()=>false};
 const h=hostRuntime({coldPrefetch:true,sessionStore:store,dispatch:()=>peerSession.promise});let peer;
 try{
  h.host.beginColdStartCandidate(()=>true);await h.settle();h.host.invalidate();
  peer=h.newPeer();peer.request(JSON.stringify(session('peer_before_deadline')));await h.settle();
  assert.equal(h.replies.find(r=>r.id==='peer_before_deadline').status,503);
  h.expire(15000);peer.request(JSON.stringify(session('peer_after_deadline')));await h.settle();assert.equal(h.requests.length,1);
  peek.resolve(token);await h.settle();
  peer.request(JSON.stringify({id:'peer_slot_still_busy',action:'providers'}));await h.settle();
  assert.equal(h.replies.find(r=>r.id==='peer_slot_still_busy').status,503);
  peerSession.resolve(proof());await h.settle();assert.equal(h.replies.find(r=>r.id==='peer_after_deadline').status,200);
  h.host.beginColdStartCandidate(()=>true);await h.settle();assert.equal(peekCount,1);
 }finally{peek.resolve(token);peerSession.resolve(proof());peer?.dispose();h.dispose();}
});
