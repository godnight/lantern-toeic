'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {hostRuntime,response}=require('./helpers/native-auth-host-runtime.cjs');
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false},token='a'.repeat(64);
const proof=()=>response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:1000}});
test('native-private owner exists only after a strict v2 proof and expires at the original monotonic deadline',async()=>{
 const h=hostRuntime({initialToken:token,dispatch:async(_url,options,clock)=>{clock.advance(20);return options.header['X-Lantern-Session-Proof']==='2'?proof():response(200,{user:A,capabilities:caps});}});
 try{const provider=h.host.trustedOwnerProvider();assert.equal(provider.snapshot(),undefined);await h.invoke({id:'legacy',action:'session'});assert.equal(provider.snapshot(),undefined);await h.invoke({version:2,id:'strict',action:'session'});const lease=provider.snapshot();assert.equal(lease.uid,A.id);assert.deepEqual(Object.keys(lease).sort(),['authEpoch','expiresAtUptimeMs','uid']);assert.equal(lease.expiresAtUptimeMs,1020);h.setTime(1019);assert.ok(provider.snapshot());h.setTime(1020);assert.equal(provider.snapshot(),undefined);assert(!JSON.stringify(h.replies).includes('authEpoch'));assert(!JSON.stringify(h.replies).includes(token));}finally{h.dispose();}
});
test('a new request synchronously revokes media and a late older proof cannot recreate its lease',async()=>{
 let release;const held=new Promise(resolve=>release=resolve);let pending=false;
 const h=hostRuntime({initialToken:token,dispatch:async()=>pending?held:proof()});
 try{const provider=h.host.trustedOwnerProvider();await h.invoke({version:2,id:'initial',action:'session'});assert.ok(provider.snapshot());let invalidations=0;provider.subscribe(()=>invalidations++);pending=true;const older=h.invoke({version:2,id:'older',action:'session'});assert.equal(provider.snapshot(),undefined);await h.settle();const busy=await h.invoke({version:2,id:'competing',action:'session'});assert.equal(busy.status,503);release(proof());await older;assert.equal(provider.snapshot(),undefined);assert.ok(invalidations>=2);}finally{h.dispose();}
});
test('lifecycle invalidation and host dispose suppress pending proof publication; no stale UID survives',async()=>{
 let release;const held=new Promise(resolve=>release=resolve);const h=hostRuntime({initialToken:token,dispatch:async()=>held});
 try{const provider=h.host.trustedOwnerProvider();h.send({version:2,id:'pending',action:'session'});await h.settle();h.host.invalidate();release(proof());await h.settle();assert.equal(provider.snapshot(),undefined);assert.equal(h.replies.length,0);h.host.dispose();assert.equal(provider.snapshot(),undefined);}finally{h.dispose();}
});
test('malformed proof, rollback and logout unknown all leave the native media provider unavailable',async()=>{
 for(const scenario of ['malformed','rollback','logout']){
  let loggingOut=false;const h=hostRuntime({initialToken:token,dispatch:async(_url,_options,clock)=>{if(loggingOut)return response(503,{});if(scenario==='malformed')return response(200,{user:A,capabilities:caps});if(scenario==='rollback')clock.advance(-1);return proof();}});
  try{const provider=h.host.trustedOwnerProvider();const r=await h.invoke({version:2,id:'session',action:'session'});if(scenario==='logout'){assert.equal(r.status,200);loggingOut=true;await h.invoke({id:'logout',action:'logout'});h.host.invalidate();}else assert.equal(r.status,503);assert.equal(provider.snapshot(),undefined);}finally{h.dispose();}
 }
});
