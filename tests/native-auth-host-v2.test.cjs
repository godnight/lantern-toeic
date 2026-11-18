'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {hostRuntime,response}=require('./helpers/native-auth-host-runtime.cjs');
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false},token='a'.repeat(64);
// Hosted response attributes reproduced with synthetic values; no live cookie is retained.
const gatewayCookie='__cf_bm=synthetic_gateway_value; HttpOnly; SameSite=None; Secure; Path=/; Domain=.example.test; Expires=Sat, 31 Oct 2026 14:30:00 GMT';
const productCookie='__Host-lantern-session='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200';
const clearedCookie='__Host-lantern-session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
test('a later busy session cannot cause a stale native owner proof to be returned',async()=>{
 let release,entered;const started=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
 const h=hostRuntime({initialToken:token,dispatch:async()=>{entered();await pending;return response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:1000}});}});
 try{
  const first=h.invoke({version:2,id:'first_session',action:'session'});await started;
  const second=await h.invoke({version:2,id:'second_session',action:'session'});assert.equal(second.status,503);
  release();const result=await first;assert.equal(result.status,503);assert.equal(result.body.user,undefined);
  assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
 }finally{release();h.dispose();}
});
function memoryResumeHarness(dispatch){
 const path=require('node:path'),crypto=require('node:crypto');
 const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
 const loader=createSourceLoader({root:path.resolve(__dirname,'..')});
 const {NativeAccountController}=loader.load('lib/native-account-controller.ts');
 const {createNativeAuthTransport}=loader.load('lib/native-auth-transport.ts');
 const target={location:{origin:'https://lantern.local'},crypto:{randomUUID:()=>crypto.randomUUID()}};target.self=target;target.top=target;
 const host=hostRuntime({resumeMemory:true,initialToken:token,dispatch,onReply:reply=>target.__lanternAuthReceive?.(reply)});
 target.LanternAuthHost={request:raw=>host.host.request(raw),isLocalActive:raw=>host.host.isLocalActive(raw)};
 const clock={now:()=>0,set:(fn,ms)=>setTimeout(fn,ms),clear:timer=>clearTimeout(timer)};
 const account=new NativeAccountController(createNativeAuthTransport(target,clock),clock,{resumeMemory:true,networkEvents:{addEventListener(){},removeEventListener(){}}});
 return {host,account,close(){account.dispose();host.dispose();}};
}
test('resume candidate restores only local study while independently checking the network',async()=>{
 let release,entered,count=0;const inFlight=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
 const h=memoryResumeHarness(async()=>{if(++count===1)return response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:10000}});entered();await pending;return response(503,{code:'native-auth-unavailable'});});
 try{
  h.account.start();await h.host.settle();assert.equal(h.account.getSnapshot().access.scope,'remote');
  const old=h.account.getSnapshot().access;h.host.lifecycle(false);h.account.suspend(true,true);assert.equal(old.canAccess(),false);
  h.host.lifecycle(true);h.account.resume();await inFlight;const local=h.account.getSnapshot();
  assert.equal(local.status,'ready');assert.equal(local.user.id,A.id);assert.equal(local.access.scope,'local-study-only');assert(local.access.canAccess());
  assert.equal(h.host.host.trustedOwnerProvider().snapshot(),undefined);
  release();await h.host.settle();assert.equal(h.account.getSnapshot().access.scope,'local-study-only');
 }finally{release();h.close();}
});
test('resume candidate blocks on a confirmed 401 and never keeps a cloud owner',async()=>{
 let count=0;const h=memoryResumeHarness(async()=>++count===1?response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:10000}}):response(401,{code:'unauthenticated'}));
 try{h.account.start();await h.host.settle();h.host.lifecycle(false);h.account.suspend(true,true);h.host.lifecycle(true);h.account.resume();await h.host.settle();
  assert.equal(h.account.getSnapshot().status,'blocked');assert.equal(h.host.host.trustedOwnerProvider().snapshot(),undefined);
 }finally{h.close();}
});
test('resume candidate cannot issue a memory proof on cold start or after host recreation',async()=>{
 const h=memoryResumeHarness(async()=>response(503,{code:'native-auth-unavailable'}));
 try{h.account.start();await h.host.settle();assert.equal(h.account.getSnapshot().status,'blocked');
  assert.equal((await h.host.invoke({id:'empty_memory',action:'local-session'})).status,401);
  h.host.recreate();assert.equal((await h.host.invoke({id:'recreated_memory',action:'local-session'})).status,401);
 }finally{h.close();}
});
test('resume candidate is cleared on host recreation even after a valid proof',async()=>{
 const h=memoryResumeHarness(async()=>response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:10000}}));
 try{h.account.start();await h.host.settle();assert.equal(h.account.getSnapshot().status,'ready');
  h.host.recreate();assert.equal((await h.host.invoke({id:'recreated_after_proof',action:'local-session'})).status,401);
 }finally{h.close();}
});
test('resume memory expires on the native monotonic clock and cannot authorize study',async()=>{
 let release,entered,count=0;const inFlight=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
 const h=memoryResumeHarness(async()=>{if(++count===1)return response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:1000}});entered();await pending;return response(503,{code:'native-auth-unavailable'});});
 try{h.account.start();await h.host.settle();h.host.lifecycle(false);h.account.suspend(true,true);h.host.lifecycle(true);h.account.resume();await inFlight;
  const local=h.account.getSnapshot().access;assert(local.canAccess());h.host.advance(1000);assert.equal(local.canAccess(),false);assert.equal(local.assertAccess(),false);assert.equal(local.sessionSignal.aborted,true);
 }finally{release();h.close();}
});
test('a second background during resume revokes local access and prevents its late network proof',async()=>{
 let release,entered,count=0;const inFlight=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
 const h=memoryResumeHarness(async()=>{if(++count===1)return response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:10000}});entered();await pending;return response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:10000}});});
 try{h.account.start();await h.host.settle();h.host.lifecycle(false);h.account.suspend(true,true);h.host.lifecycle(true);h.account.resume();await inFlight;
  const local=h.account.getSnapshot().access;assert(local.canAccess());h.host.lifecycle(false);h.account.suspend(true,true);assert.equal(local.canAccess(),false);
  release();await h.host.settle();assert.equal(h.account.getSnapshot().status,'blocked');assert.equal(h.host.host.trustedOwnerProvider().snapshot(),undefined);
 }finally{release();h.close();}
});
test('a different remote owner blocks the resumed partition until an explicit account decision',async()=>{
 const B={id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};let count=0;
 const h=memoryResumeHarness(async()=>response(200,{user:++count===1?A:B,capabilities:caps,session:{version:2,remainingMs:10000}}));
 try{h.account.start();await h.host.settle();h.host.lifecycle(false);h.account.suspend(true,true);h.host.lifecycle(true);h.account.resume();await h.host.settle();
  assert.equal(h.account.getSnapshot().status,'blocked');h.account.resume();await h.host.settle();assert.equal(h.account.getSnapshot().status,'blocked');
 }finally{h.close();}
});
test('starting logout immediately revokes a resumed memory lease and rejects a late session result',async()=>{
 let release,entered,count=0;const inFlight=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
 const h=memoryResumeHarness(async()=>{if(++count===1)return response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:10000}});entered();await pending;return response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:10000}});});
 try{h.account.start();await h.host.settle();h.host.lifecycle(false);h.account.suspend(true,true);h.host.lifecycle(true);h.account.resume();await inFlight;
  const local=h.account.getSnapshot().access;assert(local.canAccess());const logout=h.account.mutate('logout');assert.equal(local.canAccess(),false);assert.equal(local.sessionSignal.aborted,true);
  assert.equal(await logout,false);release();await h.host.settle();assert.equal(h.account.getSnapshot().status,'blocked');
  assert.equal((await h.host.invoke({id:'after_logout',action:'local-session'})).status,401);
 }finally{release();h.close();}
});
test('native-first repeated foreground transitions can restore the same local owner offline',async()=>{
 let count=0;const h=memoryResumeHarness(async()=>++count===1?response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:10000}}):response(503,{code:'native-auth-unavailable'}));
 try{h.account.start();await h.host.settle();for(let i=0;i<2;i++){
  h.host.lifecycle(false);h.account.suspend(true,true);h.host.lifecycle(true);h.account.resume();await h.host.settle();
  const local=h.account.getSnapshot();assert.equal(local.status,'ready');assert.equal(local.user.id,A.id);assert.equal(local.access.scope,'local-study-only');assert(local.access.canAccess());
 }}finally{h.close();}
});
test('a previous local lease never revives after a different owner and a later same-owner proof',async()=>{
 let release,entered,count=0;const inFlight=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
 const h=memoryResumeHarness(async()=>{if(++count===1)return response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:10000}});entered();await pending;return response(503,{code:'native-auth-unavailable'});});
 try{h.account.start();await h.host.settle();h.host.lifecycle(false);h.account.suspend(true,true);h.host.lifecycle(true);h.account.resume();await inFlight;
  const local=h.account.getSnapshot().access;assert(local.canAccess());const fence=h.host.load('VolatileOwnerFence').VolatileOwnerFence;
  const B={uid:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
  assert(fence.publish('https://auth.test',B,0,10000,fence.version()));assert.equal(local.canAccess(),false);
  assert(fence.publish('https://auth.test',{uid:A.id,username:A.username},0,10000,fence.version()));assert.equal(local.canAccess(),false);assert.equal(local.assertAccess(),false);assert(local.sessionSignal.aborted);
 }finally{release();h.close();}
});
test('actual host keeps v1 exact and negotiates v2 with a fixed header and conservative uptime budget',async()=>{
 const h=hostRuntime({initialToken:token,dispatch:async(_url,options,clock)=>{clock.advance(20);return response(200,{user:A,capabilities:caps,...options.header['X-Lantern-Session-Proof']==='2'?{session:{version:2,remainingMs:1000}}:{}});}});
 try{const v1=await h.invoke({id:'legacy',action:'session'});assert.deepEqual(Object.keys(v1).sort(),['body','id','status']);assert.deepEqual(Object.keys(v1.body).sort(),['capabilities','user']);const v2=await h.invoke({version:2,id:'current',action:'session'});assert.equal(v2.version,2);assert.equal(v2.status,200);assert.equal(v2.body.session.validForMs,980);assert.equal(h.requests[0].proof,undefined);assert.equal(h.requests[1].proof,'2');assert.equal(h.saves,0);assert(!JSON.stringify(h.replies).includes(token));}finally{h.dispose();}
});
test('v2 missing or malformed proof never opens identity, and bad versions never reach HTTP',async()=>{
 for(const session of [undefined,{version:1,remainingMs:1000},{version:2,remainingMs:0},{version:2,remainingMs:43200001},{version:2,remainingMs:1.5}]){
  const h=hostRuntime({initialToken:token,dispatch:async()=>response(200,{user:A,capabilities:caps,...session?{session}:{}})});try{const r=await h.invoke({version:2,id:'invalid',action:'session'});assert.equal(r.status,503);assert.equal(r.body.user,undefined);}finally{h.dispose();}
 }
 const h=hostRuntime();try{h.send({version:3,id:'bad',action:'session'});h.send({version:2,id:'bad2',action:'login',body:{username:'x',password:'x'}});await h.settle();assert.equal(h.requests.length,0);assert.equal(h.replies.length,0);}finally{h.dispose();}
});
test('budget exhaustion and monotonic rollback fail closed while read never refreshes Asset',async()=>{
 for(const elapsed of [1000,-1]){const h=hostRuntime({initialToken:token,dispatch:async(_url,_options,clock)=>{clock.advance(elapsed);return response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:1000}});}});try{assert.equal((await h.invoke({version:2,id:'expired',action:'session'})).status,503);assert.equal(h.saves,0);}finally{h.dispose();}}
});

test('actual host rejects malformed capability types and respects only verified numeric Retry-After',async()=>{
 const bad=hostRuntime({initialToken:token,dispatch:async()=>response(200,{user:A,capabilities:{...caps,cloudSync:'yes'},session:{version:2,remainingMs:1000}})});
 try{assert.equal((await bad.invoke({version:2,id:'badcaps',action:'session'})).status,503);}finally{bad.dispose();}
 const h=hostRuntime({dispatch:async()=>response(429,{code:'too-many-attempts'},{'Retry-After':'1'})});
 try{const body={username:'synthetic_a',password:'synthetic password long'};assert.equal((await h.invoke({id:'first',action:'login',body})).status,429);assert.equal(h.requests.length,1);h.advance(999);assert.equal((await h.invoke({id:'early',action:'login',body})).status,429);assert.equal(h.requests.length,1);await h.invoke({version:2,id:'read',action:'session'});assert.equal(h.requests.length,2);h.advance(1001);await h.invoke({id:'later',action:'login',body});assert.equal(h.requests.length,3);}finally{h.dispose();}
});

test('gateway-only cookies do not quarantine an unauthenticated or verified v2 session',async()=>{
 for(const initialToken of [undefined,token]){
  const h=hostRuntime({initialToken,dispatch:async()=>response(initialToken?200:401,initialToken?{user:A,capabilities:caps,session:{version:2,remainingMs:1000}}:{code:'unauthenticated'},{'Set-Cookie':gatewayCookie})});
  try{const result=await h.invoke({version:2,id:'gateway_session',action:'session'});await h.settle();assert.equal(result.status,initialToken?200:401);assert.equal(h.saves,0);assert.equal(h.clears,initialToken?0:1);assert(!JSON.stringify(h.replies).includes('synthetic_gateway_value'));}finally{h.dispose();}
 }
});

test('gateway cookie arrays and combined headers preserve register/login proof and logout',async()=>{
 for(const [action,combine] of [
  ['register',(product)=>[product,gatewayCookie]],
  ['login',(product)=>[gatewayCookie,product]],
  ['register',(product)=>product+', '+gatewayCookie],
  ['login',(product)=>gatewayCookie+', '+product],
 ]){
  const outbound=[];
  const h=hostRuntime({dispatch:async(url,options)=>{
   outbound.push(options.header.Cookie);
   const route=new URL(url).pathname;
   if(route.endsWith('/session'))return response(200,{user:A,capabilities:caps},{'set-cookie':gatewayCookie});
   if(route.endsWith('/logout'))return response(200,{ok:true},{'Set-Cookie':combine(clearedCookie)});
   return response(200,{user:A,capabilities:caps},{'Set-Cookie':combine(productCookie)});
  }});
  try{
   const result=await h.invoke({id:'gateway_mutation',action,body:{username:A.username,password:'synthetic password long'}});await h.settle();
   assert.equal(result.status,200);assert.equal(result.body.user.id,A.id);assert.equal(h.saves,1);assert.deepEqual(outbound,[undefined,'__Host-lantern-session='+token]);
   assert.equal((await h.invoke({id:'gateway_logout',action:'logout'})).status,200);await h.settle();assert.equal(h.clears,1);
   assert.equal(outbound[2],'__Host-lantern-session='+token);assert(!JSON.stringify(h.replies).includes(token));assert(!JSON.stringify(h.replies).includes('synthetic_gateway_value'));
  }finally{h.dispose();}
 }
});

test('gateway cookies on credential rejection preserve the existing private session',async()=>{
 const outbound=[];
 const h=hostRuntime({initialToken:token,dispatch:async(url,options)=>{outbound.push(options.header.Cookie);return new URL(url).pathname.endsWith('/login')?response(401,{code:'invalid-credentials'},{'set-cookie':gatewayCookie}):response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:1000}},{'set-cookie':[gatewayCookie,'__Host-lantern-session_extra=synthetic; Path=/']});}});
 try{assert.equal((await h.invoke({id:'rejected',action:'login',body:{username:A.username,password:'synthetic wrong password'}})).status,401);await h.settle();assert.equal((await h.invoke({version:2,id:'retained',action:'session'})).status,200);assert.equal(h.clears,0);assert.equal(h.saves,0);assert.deepEqual(outbound,['__Host-lantern-session='+token,'__Host-lantern-session='+token]);}finally{h.dispose();}
});

test('combined cookies never relax duplicate or invalid product attributes',async()=>{
 for(const cookies of [
  [gatewayCookie,productCookie,productCookie],
  gatewayCookie+', '+productCookie+', '+productCookie,
  productCookie+'; Domain=auth.test, '+gatewayCookie,
  productCookie+'; Expires=Sat, 31 Oct 2026 14:30:00 GMT, '+gatewayCookie,
  productCookie+'; Secure, '+gatewayCookie,
  productCookie+', malformed',
 ]){
  const h=hostRuntime({dispatch:async()=>response(200,{user:A,capabilities:caps},{'set-cookie':cookies})});
  try{assert.equal((await h.invoke({id:'invalid_cookie',action:'login',body:{username:A.username,password:'synthetic password long'}})).status,503);await h.settle();assert.equal(h.saves,0);assert.ok(h.clears>0);}finally{h.dispose();}
 }
});

test('unexpected product-cookie rotation still quarantines even beside gateway cookies',async()=>{
 const h=hostRuntime({initialToken:token,dispatch:async()=>response(200,{user:A,capabilities:caps,session:{version:2,remainingMs:1000}},{'set-cookie':gatewayCookie+', '+productCookie})});
 try{assert.equal((await h.invoke({version:2,id:'rotated',action:'session'})).status,503);await h.settle();assert.ok(h.clears>0);assert.equal(h.saves,0);assert.equal(h.replies[0].body.user,undefined);}finally{h.dispose();}
});
