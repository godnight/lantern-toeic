'use strict';
// Executes actual ETS with synthetic OS ports, not the platform Asset service.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {hostRuntime,response}=require('./helpers/native-auth-host-runtime.cjs');
const file=path.resolve(__dirname,'../harmony/entry/src/main/ets/auth/OfflineOwnerFence.ets');
const source=fs.readFileSync(file,'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
function fixture({addFailure,updateFailure}={}){
 const Tag={ALIAS:'alias',SECRET:'secret',ACCESSIBILITY:'access',SYNC_TYPE:'sync'},writes=[];
 const asset={Tag,Accessibility:{DEVICE_UNLOCKED:'unlock'},SyncType:{NEVER:'never'},
  async add(attrs){writes.push({kind:'add',alias:Buffer.from(attrs.get(Tag.ALIAS)).toString(),secret:Buffer.from(attrs.get(Tag.SECRET)).toString(),access:attrs.get(Tag.ACCESSIBILITY),sync:attrs.get(Tag.SYNC_TYPE)});if(addFailure)throw addFailure;},
  async update(query,attrs){writes.push({kind:'update',alias:Buffer.from(query.get(Tag.ALIAS)).toString(),secret:Buffer.from(attrs.get(Tag.SECRET)).toString()});if(updateFailure)throw updateFailure;}};
 const exports={};vm.runInNewContext(js,{exports,require:id=>id==='@ohos.security.asset'?{__esModule:true,default:asset}:id==='@kit.BasicServicesKit'?{}:(()=>{throw Error('unexpected import');})(),Uint8Array,Map,JSON,Number,String,Error});
 return {fence:new exports.OfflineOwnerFence(),enabled:exports.OFFLINE_OWNER_ENABLED,writes};
}
test('offline-owner gate is disabled; pending marker uses a private Asset and contains no owner or token',async()=>{
 for(const options of [{},{addFailure:{code:24000003}}]){
  const f=fixture(options);assert.equal(f.enabled,false);await f.fence.markPending('https://auth.test');
  assert.deepEqual(JSON.parse(f.writes.at(-1).secret),{version:2,origin:'https://auth.test',state:'pending'});
  assert.equal(f.writes.at(-1).alias,'lantern-product-offline-owner-v2');
  assert.equal(f.writes[0].access,'unlock');assert.equal(f.writes[0].sync,'never');
 }
});
test('invalid origins and Asset failures reject before a trusted identity is released',async()=>{
 for(const origin of ['http://auth.test','https://lantern.local','https://evil.test/path','https://evil.test?token=x']){const f=fixture();await assert.rejects(f.fence.markPending(origin));assert.equal(f.writes.length,0);}
 for(const options of [{addFailure:{code:123}},{addFailure:{code:24000003},updateFailure:{code:123}}]){const f=fixture(options);await assert.rejects(f.fence.markPending('https://auth.test'),/Store unavailable/);}
});
test('pending persistence failure prevents every remote identity mutation',async()=>{
 for(const action of ['login','register','logout','phone-login','phone-bind','huawei-login','huawei-bind']){
  let called=0;const h=hostRuntime({initialToken:'a'.repeat(64),huawei:true,offlineFence:async()=>{called++;throw Error('synthetic failure');},dispatch:async()=>response(200,{})});
  try{
   const body=action==='login'?{username:'synthetic',password:'synthetic password'}:action==='register'?{username:'synthetic',password:'synthetic password'}:action==='phone-login'||action==='phone-bind'?{phone:'13800000000',challengeId:'a'.repeat(32),code:'123456'}:undefined;
   h.send({id:'pending-'+action,action,...body?{body}:{}});await h.settle();assert.equal(called,1,action);assert.equal(h.requests.length,0,action);
  }finally{h.dispose();}
 }
});
test('the host waits for pending persistence before a valid credential request',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});let called=0;
 const h=hostRuntime({offlineFence:async()=>{called++;await pending;},dispatch:async()=>response(401,{code:'invalid-credentials'})});
 try{const result=h.invoke({id:'held',action:'login',body:{username:'synthetic',password:'synthetic password'}});await h.settle();assert.equal(called,1);assert.equal(h.requests.length,0);release();assert.equal((await result).status,401);assert.equal(h.requests.length,1);}finally{h.dispose();}
});
test('timeout, page departure and disposal during pending persistence cannot issue a late request',async()=>{
 for(const interruption of ['timeout','background','dispose']){
  let release;const pending=new Promise(resolve=>{release=resolve;});let called=0;
  const h=hostRuntime({offlineFence:async()=>{called++;await pending;},dispatch:async()=>response(200,{})});
  try{
   h.send({id:'late-'+interruption,action:'login',body:{username:'synthetic',password:'synthetic password'}});
   await h.settle();assert.equal(called,1);assert.equal(h.requests.length,0);
   if(interruption==='timeout')h.expire();else if(interruption==='background')h.lifecycle(false);else h.dispose();
   release();await h.settle();assert.equal(h.requests.length,0,interruption);
  }finally{h.dispose();}
 }
});
test('background and foreground during a Huawei pending write cannot start SDK or network afterward',async()=>{
 for(const action of ['huawei-login','huawei-bind']){
  let release,entered=0;const pending=new Promise(resolve=>{release=resolve;});
  const h=hostRuntime({initialToken:'a'.repeat(64),huawei:true,offlineFence:async()=>{entered++;await pending;},dispatch:async()=>response(200,{huaweiLogin:true,huaweiBinding:true})});
  try{
   h.send({id:'delayed-'+action,action});await h.settle();assert.equal(entered,1,action);
   h.lifecycle(false);h.lifecycle(true);release();await h.settle();
   assert.equal(h.sdkCalls.length,0,action);assert.equal(h.requests.length,0,action);
  }finally{h.dispose();}
 }
});
