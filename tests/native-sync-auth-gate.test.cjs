'use strict';
// Executes the real ETS auth host with simulated ArkWeb, Asset and OS APIs.
const test=require('node:test'),assert=require('node:assert/strict');
const {hostRuntime}=require('./helpers/native-auth-host-runtime.cjs');
const owner='usr_00000000-0000-4000-8000-000000000001';
function setup(initialToken='a'.repeat(64)){
 const f=hostRuntime({initialToken}),lease=f.host.ownerLease;
 assert.equal(lease.publishVerifiedV2(owner,0,1000,lease.version()),true);
 return {f,lease,snapshot:lease.snapshot()};
}
test('sync uses native token, shares auth lock and releases only after the work settles',async()=>{
 const {f,snapshot}=setup();try{
  let release,started;const entered=new Promise(resolve=>{started=resolve;});
  const first=f.host.withSession(snapshot,async token=>{assert.equal(token,'a'.repeat(64));started();await new Promise(resolve=>{release=resolve;});});
  await entered;await assert.rejects(f.host.withSession(snapshot,async()=>{}));assert.equal(f.replies.length,0);
  release();await first;await f.host.withSession(snapshot,async()=>{});assert.equal(f.replies.length,0);
 }finally{f.dispose();}
});
test('revocation, expiry, wrong token and untrusted frame fail closed',async()=>{
 for(const mode of ['revocation','expiry','token','frame']){
  const {f,snapshot}=setup(mode==='token'?'bad-token':undefined);try{
   if(mode==='expiry')f.advance(1001);
   if(mode==='frame')f.setFrame('https://lantern.local.evil/');
   if(mode==='revocation')f.host.invalidate();
   let ran=false;await assert.rejects(f.host.withSession(snapshot,async()=>{ran=true;}));assert.equal(ran,false);
  }finally{f.dispose();}
 }
});
test('in-flight revocation rejects completion and does not expose the token',async()=>{
 const {f,snapshot}=setup();try{
  let release,started;const entered=new Promise(resolve=>{started=resolve;});
  const p=f.host.withSession(snapshot,async()=>{started();await new Promise(resolve=>{release=resolve;});});
  await entered;f.host.invalidate();release();await assert.rejects(p);assert.equal(f.replies.length,0);
 }finally{f.dispose();}
});
test('an auth request during sync revokes the lease and does not race the native session lock',async()=>{
 const {f,snapshot}=setup();try{
  let release,started;const entered=new Promise(resolve=>{started=resolve;});
  const sync=f.host.withSession(snapshot,async()=>{started();await new Promise(resolve=>{release=resolve;});});
  await entered;
  const reply=await f.invoke({version:2,id:'auth-during-sync',action:'session'});
  assert.equal(reply.status,503);assert.equal(f.requests.length,0);
  release();await assert.rejects(sync);assert.equal(f.replies.length,1);
 }finally{f.dispose();}
});
