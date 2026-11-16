'use strict';
// Executes actual ETS with synthetic OS ports, not the platform Asset service.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {hostRuntime,response}=require('./helpers/native-auth-host-runtime.cjs');
const file=path.resolve(__dirname,'../harmony/entry/src/main/ets/auth/OfflineOwnerFence.ets');
const source=fs.readFileSync(file,'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
function fixture({addFailure,updateFailure,record,queryFailure}={}){
 const Tag={ALIAS:'alias',SECRET:'secret',ACCESSIBILITY:'access',SYNC_TYPE:'sync',RETURN_TYPE:'return'},writes=[];
 let secret=record===undefined?undefined:new Uint8Array(Buffer.from(JSON.stringify(record)));
 const asset={Tag,ReturnType:{ALL:'all'},Accessibility:{DEVICE_UNLOCKED:'unlock'},SyncType:{NEVER:'never'},
  async query(){if(queryFailure)throw queryFailure;if(secret===undefined)throw {code:24000002};return [new Map([[Tag.SECRET,secret]])];},
  async add(attrs){writes.push({kind:'add',alias:Buffer.from(attrs.get(Tag.ALIAS)).toString(),secret:Buffer.from(attrs.get(Tag.SECRET)).toString(),access:attrs.get(Tag.ACCESSIBILITY),sync:attrs.get(Tag.SYNC_TYPE)});if(addFailure)throw addFailure;if(secret!==undefined)throw {code:24000003};secret=attrs.get(Tag.SECRET);},
  async update(query,attrs){writes.push({kind:'update',alias:Buffer.from(query.get(Tag.ALIAS)).toString(),secret:Buffer.from(attrs.get(Tag.SECRET)).toString()});if(updateFailure)throw updateFailure;secret=attrs.get(Tag.SECRET);}};
 const exports={};vm.runInNewContext(js,{exports,require:id=>id==='@ohos.security.asset'?{__esModule:true,default:asset}:id==='@kit.BasicServicesKit'?{}:(()=>{throw Error('unexpected import');})(),Uint8Array,Map,JSON,Number,String,Error});
 return {fence:new exports.OfflineOwnerFence(),enabled:exports.OFFLINE_OWNER_ENABLED,writes,reopen:()=>new exports.OfflineOwnerFence(),setUpdateFailure:value=>{updateFailure=value;}};
}
test('offline-owner gate is disabled; pending marker uses a private Asset and contains no owner or token',async()=>{
 for(const options of [{},{addFailure:{code:24000003}}]){
  const f=fixture(options);assert.equal(f.enabled,false);await f.fence.markPending('https://auth.test');
  assert.deepEqual(JSON.parse(f.writes.at(-1).secret),{version:2,origin:'https://auth.test',state:'pending'});
  assert.equal(f.writes.at(-1).alias,'lantern-product-offline-owner-v2');
  assert.equal(f.writes[0].access,'unlock');assert.equal(f.writes[0].sync,'never');
 }
});
test('verified synthetic identity persists locally; pending, unexpected owner and corrupt records fail closed',async()=>{
 const a={uid:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},b={uid:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
 const f=fixture();assert.equal(await f.fence.readLocal('https://auth.test'),undefined);
 assert.equal(await f.fence.saveVerified('https://auth.test',a,false),true);
 assert.deepEqual(JSON.parse(JSON.stringify(await f.reopen().readLocal('https://auth.test'))),a);
 assert.equal(f.writes.at(-1).secret.includes('token'),false);
 assert.equal(await f.fence.saveVerified('https://auth.test',b,false),false);
 assert.equal(await f.fence.readLocal('https://auth.test'),undefined);
 await f.fence.markPending('https://auth.test');assert.equal(await f.reopen().readLocal('https://auth.test'),undefined);
 assert.equal(await f.fence.saveVerified('https://auth.test',b,false),false);
 assert.equal(await f.fence.saveVerified('https://auth.test',b,true),true);
 assert.deepEqual(JSON.parse(JSON.stringify(await f.reopen().readLocal('https://auth.test'))),b);
 await assert.rejects(f.fence.readLocal('https://different.test'));
 for(const record of [{version:2,origin:'https://auth.test',state:'stable',uid:a.uid,username:a.username,token:'synthetic-secret'}, {version:2,origin:'https://auth.test',state:'stable',uid:'bad',username:a.username}]){
  const invalid=fixture({record});await assert.rejects(invalid.fence.readLocal('https://auth.test'));
 }
 const unavailable=fixture({queryFailure:{code:123}});await assert.rejects(unavailable.fence.readLocal('https://auth.test'));
});
test('native host persists only a verified v2 session and local restore never creates a network lease',async()=>{
 const f=fixture(),uid='usr_aaaaaaaa-1111-4111-8111-111111111111';let revoked=false;
 const user={id:uid,username:'synthetic_a'},caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false};
 const h=hostRuntime({initialToken:'a'.repeat(64),offlineFence:f.fence,dispatch:async()=>revoked?response(401,{code:'unauthenticated'}):response(200,{user,capabilities:caps,session:{version:2,remainingMs:3600000}})});
 try{
  assert.deepEqual(h.exposed,['request','isLocalActive']);assert.equal(h.exposed.includes('readLocalOfflineOwnerCandidate'),false);
  assert.equal((await h.invoke({version:2,id:'proof',action:'session'})).status,200);await h.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(await h.host.readLocalOfflineOwnerCandidate())),{uid,username:user.username});
  h.lifecycle(false);h.lifecycle(true);assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(await h.host.readLocalOfflineOwnerCandidate())),{uid,username:user.username});
  assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined,'local data identity is not a remote lease');
  revoked=true;assert.equal((await h.invoke({version:2,id:'revoked',action:'session'})).status,401);await h.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(await h.host.readLocalOfflineOwnerCandidate())),{uid,username:user.username});
  assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined,'401 closes only the remote lease');
 }finally{h.dispose();}
});
test('remote 401 does not clear the same device local identity, even across host restart',async()=>{
 const uid='usr_aaaaaaaa-1111-4111-8111-111111111111',user={id:uid,username:'synthetic_a'},caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false};
 const f=fixture();let revoked=false;
 const dispatch=async()=>revoked?response(401,{code:'unauthenticated'}):response(200,{user,capabilities:caps,session:{version:2,remainingMs:3600000}});
 const h=hostRuntime({initialToken:'a'.repeat(64),offlineFence:f.fence,dispatch});
 try{
  assert.equal((await h.invoke({version:2,id:'initial',action:'session'})).status,200);await h.settle();
  assert.ok(await h.host.readLocalOfflineOwnerCandidate());
  f.setUpdateFailure({code:123});revoked=true;
  assert.equal((await h.invoke({version:2,id:'remote-401',action:'session'})).status,401);await h.settle();
  assert.equal(h.requests.length,2);assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(await h.host.readLocalOfflineOwnerCandidate())),{uid,username:user.username});
 }finally{h.dispose();}
 f.setUpdateFailure(undefined);
 const h2=hostRuntime({offlineFence:f.reopen()});try{assert.deepEqual(JSON.parse(JSON.stringify(await h2.host.readLocalOfflineOwnerCandidate())),{uid,username:user.username});}finally{h2.dispose();}
});
test('malformed 401, redirect, and transport rejection never grant remote access or replace local owner',async()=>{
 const uid='usr_aaaaaaaa-1111-4111-8111-111111111111',user={id:uid,username:'synthetic_a'},caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false};
 for(const bad of [()=>({responseCode:401,result:{code:'unauthenticated'},header:{'content-type':'application/json'}}),()=>({responseCode:401,result:'x'.repeat(17000),header:{'content-type':'application/json'}}),()=>response(302,{}),()=>{throw Error('ambiguous transport');}]){
  const f=fixture();let mode=false;
  const h=hostRuntime({initialToken:'a'.repeat(64),offlineFence:f.fence,dispatch:async()=>mode?bad():response(200,{user,capabilities:caps,session:{version:2,remainingMs:3600000}})});
  try{
   assert.equal((await h.invoke({version:2,id:'initial',action:'session'})).status,200);await h.settle();mode=true;
   assert.equal((await h.invoke({version:2,id:'ambiguous',action:'session'})).status,503);await h.settle();
   assert.deepEqual(JSON.parse(JSON.stringify(await h.host.readLocalOfflineOwnerCandidate())),{uid,username:user.username});
   assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
  }finally{h.dispose();}
  const h2=hostRuntime({offlineFence:f.reopen()});try{assert.deepEqual(JSON.parse(JSON.stringify(await h2.host.readLocalOfflineOwnerCandidate())),{uid,username:user.username});}finally{h2.dispose();}
 }
});
test('the disabled host never exposes a local cached owner',async()=>{
 const h=hostRuntime();try{assert.equal(await h.host.readLocalOfflineOwnerCandidate(),undefined);assert.deepEqual(h.exposed,['request']);}finally{h.dispose();}
});
test('local session is scoped to the cached owner and revoked on lifecycle or explicit identity change',async()=>{
 const uid='usr_aaaaaaaa-1111-4111-8111-111111111111',username='synthetic_a',f=fixture();
 await f.fence.saveVerified('https://auth.test',{uid,username},false);
 const h=hostRuntime({initialToken:'a'.repeat(64),offlineFence:f.fence,dispatch:async()=>response(401,{code:'unauthenticated'})});
 try{
  assert.deepEqual(h.exposed,['request','isLocalActive']);
  const local=await h.invoke({id:'local-first',action:'local-session'});assert.equal(local.status,200);
  assert.equal(local.body.user.id,uid);assert.equal(local.body.local.scope,'local-study-only');
  const check=JSON.stringify({uid,generation:local.body.local.generation});
  assert.equal(h.host.isLocalActive(check),true);assert.equal(h.host.isLocalActive(JSON.stringify({uid:'usr_bbbbbbbb-2222-4222-8222-222222222222',generation:local.body.local.generation})),false);
  assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined,'local proof never creates remote lease');
  assert.equal((await h.invoke({version:2,id:'offline-network',action:'session'})).status,401);await h.settle();
  assert.equal(h.host.isLocalActive(check),true,'remote 401 does not clear local data authority');
  h.lifecycle(false);assert.equal(h.host.isLocalActive(check),false);h.lifecycle(true);
  const fresh=await h.invoke({id:'local-again',action:'local-session'});assert.equal(fresh.status,200);
  const current=JSON.stringify({uid,generation:fresh.body.local.generation});assert.equal(h.host.isLocalActive(current),true);
  const result=h.invoke({id:'explicit-switch',action:'login',body:{username:'synthetic_b',password:'synthetic password'}});
  assert.equal(h.host.isLocalActive(current),false,'explicit account change revokes local lease synchronously');
  assert.equal((await result).status,401);await h.settle();assert.equal((await h.invoke({id:'local-blocked',action:'local-session'})).status,401);
 }finally{h.dispose();}
});
test('a local Asset read cannot issue a stale lease after an identity mutation starts',async()=>{
 let release,started;const pending=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
 const h=hostRuntime({offlineFence:{async readLocal(){started();await pending;return {uid:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'};},async markPending(){}}});
 try{
  h.send({id:'late-local',action:'local-session'});await entered;
  h.send({id:'concurrent-switch',action:'login',body:{username:'synthetic_b',password:'synthetic password'}});
  release();await h.settle();assert.equal(h.replies.some(reply=>reply.id==='late-local'&&reply.status===200),false);
 }finally{h.dispose();}
});
test('actual native host, bridge and controller keep the same local-only owner on offline startup',async()=>{
 const uid='usr_aaaaaaaa-1111-4111-8111-111111111111',username='synthetic_a',f=fixture();await f.fence.saveVerified('https://auth.test',{uid,username},false);
 const loader=require('./helpers/actual-source-loader.cjs').createSourceLoader({root:path.resolve(__dirname,'..')});
 const {createNativeAuthTransport}=loader.load('lib/native-auth-transport.ts'),{NativeAccountController}=loader.load('lib/native-account-controller.ts');
 const target={location:{origin:'https://lantern.local'},crypto:{randomUUID:()=>require('node:crypto').randomUUID()}};target.self=target;target.top=target;
 const h=hostRuntime({initialToken:'a'.repeat(64),offlineFence:f.fence,dispatch:async()=>{throw Error('synthetic offline');},onReply:reply=>target.__lanternAuthReceive?.(reply)});
 target.LanternAuthHost={request:raw=>h.host.request(raw),isLocalActive:raw=>h.host.isLocalActive(raw)};
 const clock={now:()=>0,set:(fn,ms)=>setTimeout(fn,ms),clear:timer=>clearTimeout(timer)},transport=createNativeAuthTransport(target,clock);
 const account=new NativeAccountController(transport,clock,{localOffline:true,networkEvents:{addEventListener(){},removeEventListener(){}}});
 try{
  account.start();await h.settle();const state=account.getSnapshot();
  assert.equal(state.status,'ready');assert.equal(state.user.id,uid);assert.equal(state.access.scope,'local-study-only');assert.equal(state.access.canAccess(),true);
  assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);assert.equal(h.requests.length,1,'only the background online session check used HTTP');
  h.lifecycle(false);account.suspend();assert.equal(state.access.canAccess(),false);assert.equal(state.access.sessionSignal.aborted,true);
  h.lifecycle(true);account.resume();await h.settle();const resumed=account.getSnapshot();
  assert.equal(resumed.status,'ready');assert.equal(resumed.user.id,uid);assert.equal(resumed.access.scope,'local-study-only');assert(resumed.access.canAccess());
 }finally{account.dispose();h.dispose();}
});
test('actual host operation slot held past the fast retry window eventually restores same-owner local access',async()=>{
 const uid='usr_aaaaaaaa-1111-4111-8111-111111111111',user={id:uid,username:'synthetic_a'},f=fixture();
 const caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false};let release,entered,requests=0;
 const pending=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const loader=require('./helpers/actual-source-loader.cjs').createSourceLoader({root:path.resolve(__dirname,'..')});
 const {createNativeAuthTransport}=loader.load('lib/native-auth-transport.ts'),{NativeAccountController}=loader.load('lib/native-account-controller.ts');
 const target={location:{origin:'https://lantern.local'},crypto:{randomUUID:()=>require('node:crypto').randomUUID()}};target.self=target;target.top=target;
 const h=hostRuntime({initialToken:'a'.repeat(64),offlineFence:f.fence,onReply:reply=>target.__lanternAuthReceive?.(reply),dispatch:async()=>{
  if(++requests===1)return response(200,{user,capabilities:caps,session:{version:2,remainingMs:3600000}});
  if(requests===2){entered();await pending;}throw Error('synthetic offline');
 }});
 target.LanternAuthHost={request:raw=>h.host.request(raw),isLocalActive:raw=>h.host.isLocalActive(raw)};
 let now=0,next=0;const timers=new Map();const clock={now:()=>now,set(fn,ms){const id=++next;timers.set(id,{fn,at:now+ms});return id;},clear(id){timers.delete(id);},advance(ms){now+=ms;for(const [id,item]of [...timers])if(item.at<=now){timers.delete(id);item.fn();}}};
 const account=new NativeAccountController(createNativeAuthTransport(target,clock),clock,{localOffline:true,networkEvents:{addEventListener(){},removeEventListener(){}}});
 try{
  account.start();await h.settle();assert.equal(account.getSnapshot().access.scope,'remote');
  h.send({version:2,id:'synthetic-occupied-slot',action:'session'});await started;
  const online=account.getSnapshot().access;clock.advance(3600000);await h.settle();assert.equal(online.sessionSignal.aborted,true);
  for(const delay of [250,500,1000,2000,4000,8000]){clock.advance(delay);await h.settle();}
  assert.equal(account.getSnapshot().status,'blocked');assert(h.replies.filter(reply=>reply.body?.code==='local-unavailable').length>=7);
  release();await h.settle();clock.advance(59999);await h.settle();assert.equal(account.getSnapshot().status,'blocked');
  clock.advance(1);await h.settle();const state=account.getSnapshot();assert.equal(state.status,'ready');assert.equal(state.user.id,uid);
  assert.equal(state.access.scope,'local-study-only');assert(state.access.canAccess());assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
 }finally{release();account.dispose();h.dispose();}
});
test('failed identity change remains pending until a successful login and its independent v2 proof',async()=>{
 const f=fixture(),uid='usr_aaaaaaaa-1111-4111-8111-111111111111';let accept=false;
 const user={id:uid,username:'synthetic_a'},caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false};
 const cookie='__Host-lantern-session='+'a'.repeat(64)+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200';
 const h=hostRuntime({initialToken:'a'.repeat(64),offlineFence:f.fence,dispatch:async(url)=>{
  if(new URL(url).pathname.endsWith('/login'))return accept?response(200,{user,capabilities:caps},{'set-cookie':cookie}):response(401,{code:'invalid-credentials'});
  return response(200,{user,capabilities:caps,session:{version:2,remainingMs:3600000}});
 }});
 try{
  assert.equal((await h.invoke({version:2,id:'initial',action:'session'})).status,200);await h.settle();
  assert.ok(await h.host.readLocalOfflineOwnerCandidate());
  const body={username:user.username,password:'synthetic password'};
  assert.equal((await h.invoke({id:'wrong',action:'login',body})).status,401);await h.settle();
  assert.equal((await h.invoke({version:2,id:'ordinary',action:'session'})).status,503);await h.settle();
  assert.equal(await h.host.readLocalOfflineOwnerCandidate(),undefined);
  accept=true;assert.equal((await h.invoke({id:'login',action:'login',body})).status,200);await h.settle();
  assert.equal(await h.host.readLocalOfflineOwnerCandidate(),undefined);
  assert.equal((await h.invoke({version:2,id:'independent',action:'session'})).status,200);await h.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(await h.host.readLocalOfflineOwnerCandidate())),{uid,username:user.username});
 }finally{h.dispose();}
});
test('a fresh proof of a different owner cannot resolve a successful login pending marker',async()=>{
 const f=fixture(),a={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},b={id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
 const caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false};let sessionCount=0;
 const cookie='__Host-lantern-session='+'b'.repeat(64)+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200';
 const h=hostRuntime({initialToken:'a'.repeat(64),offlineFence:f.fence,dispatch:async(url)=>{
  if(new URL(url).pathname.endsWith('/login'))return response(200,{user:b,capabilities:caps},{'set-cookie':cookie});
  const user=++sessionCount===2?b:a;return response(200,{user,capabilities:caps,session:{version:2,remainingMs:3600000}});
 }});
 try{
  assert.equal((await h.invoke({version:2,id:'initial',action:'session'})).status,200);await h.settle();
  assert.equal((await h.invoke({id:'switch',action:'login',body:{username:b.username,password:'synthetic password'}})).status,200);await h.settle();
  assert.equal((await h.invoke({version:2,id:'mismatch',action:'session'})).status,503);await h.settle();
  assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
  assert.equal(await h.host.readLocalOfflineOwnerCandidate(),undefined);
 }finally{h.dispose();}
});
test('a stale pending local save is fenced after lifecycle invalidation',async()=>{
 let release,started;const pending=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});let fences=0;
 const offlineFence={async markPending(){fences++;},async saveVerified(){started();await pending;return true;}};
 const user={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false};
 const h=hostRuntime({initialToken:'a'.repeat(64),offlineFence,dispatch:async()=>response(200,{user,capabilities:caps,session:{version:2,remainingMs:3600000}})});
 try{
  h.send({version:2,id:'late-proof',action:'session'});await entered;h.lifecycle(false);release();await h.settle();
  assert.equal(fences,1);assert.equal(h.replies.length,0);assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
 }finally{h.dispose();}
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
test('with offline fence disabled, existing Huawei pre-SDK background and foreground behavior is unchanged',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const h=hostRuntime({huawei:true,dispatch:async(url)=>new URL(url).pathname.endsWith('/providers')?pending:response(503,{})});
 try{
  const result=h.invoke({id:'legacy-provider',action:'huawei-login'});await h.settle();assert.equal(h.requests.length,1);assert.equal(h.sdkCalls.length,0);
  h.lifecycle(false);h.lifecycle(true);release(response(200,{huaweiLogin:true,huaweiBinding:true}));
  assert.equal((await result).status,503);assert.equal(h.sdkCalls.length,1);
 }finally{h.dispose();}
});
test('with offline fence enabled, an already-started Huawei SDK can resume after background',async()=>{
 let release,request;const pending=new Promise(resolve=>{release=resolve;});
 const user={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false};
 const cookie='__Host-lantern-session='+'a'.repeat(64)+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200';
 const h=hostRuntime({huawei:true,offlineFence:async()=>{},authorize:value=>{request=value;return pending;},dispatch:async(url)=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/providers'))return response(200,{huaweiLogin:true,huaweiBinding:true});
  if(path.endsWith('/huawei/login'))return response(200,{user,capabilities:caps},{'set-cookie':cookie});
  if(path.endsWith('/session'))return response(200,{user,capabilities:caps,session:{version:2,remainingMs:3600000}});
  return response(503,{});
 }});
 try{
  const result=h.invoke({id:'new-sdk',action:'huawei-login'});await h.settle();assert.equal(h.sdkCalls.length,1);
  h.lifecycle(false);release({state:request.state,data:{authorizationCode:'synthetic-native-authorization-code'}});await h.settle();assert.equal(h.requests.length,1);
  h.lifecycle(true);assert.equal((await result).status,200);
 }finally{h.dispose();}
});
