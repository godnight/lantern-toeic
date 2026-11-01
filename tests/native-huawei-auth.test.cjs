'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {hostRuntime,response}=require('./helpers/native-auth-host-runtime.cjs');
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'};
const B={id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
const caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false};
const token='a'.repeat(64),cookie='__Host-lantern-session='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200';
const userReply=(user=A)=>({user,capabilities:caps});
const proof=(user=A)=>({...userReply(user),session:{version:2,remainingMs:3600000}});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function dispatch(url,options){
 const path=new URL(url).pathname;
 if(path.endsWith('/providers'))return response(200,{huaweiLogin:true,huaweiBinding:true});
 if(path.endsWith('/huawei/login'))return response(200,userReply(),{'set-cookie':cookie});
 if(path.endsWith('/huawei/bind'))return response(200,{ok:true,user:A});
 if(path.endsWith('/session'))return response(200,proof());
 return response(503,{code:'synthetic-closed'});
}

test('provider discovery is separate, strict and native-gated without changing legacy caps',async()=>{
 for(const enabled of [false,true]){
  const h=hostRuntime({huawei:enabled,dispatch});
  try{
   const r=await h.invoke({id:'providers',action:'providers'});
   assert.deepEqual(JSON.parse(JSON.stringify(r.body)),{huaweiLogin:enabled,huaweiBinding:enabled});
   for(const action of ['huawei-login','huawei-bind','providers'])h.send({id:action,action,body:{code:'page-must-not-supply-code'}});
   await h.settle();assert.equal(h.requests.length,1);assert.equal(h.sdkCalls.length,0);
  }finally{h.dispose();}
 }
 const bad=hostRuntime({huawei:true,dispatch:()=>response(200,{huaweiLogin:true,huaweiBinding:true,secret:'must-not-pass'})});
 try{assert.equal((await bad.invoke({id:'bad',action:'providers'})).status,503);}finally{bad.dispose();}
});

test('native SDK code is sent once to the fixed route and only verified product identity crosses ArkWeb',async()=>{
 const posts=[];const h=hostRuntime({huawei:true,dispatch:(url,options)=>{if(options.method==='POST')posts.push({path:new URL(url).pathname,body:JSON.parse(options.extraData)});return dispatch(url,options);}});
 try{
  const r=await h.invoke({id:'login',action:'huawei-login'});
  assert.equal(r.status,200);assert.equal(r.body.user.id,A.id);assert.equal(h.saves,1);
  assert.deepEqual(posts,[{path:'/api/auth/huawei/login',body:{code:'synthetic-native-authorization-code'}}]);
  assert.match(h.sdkCalls[0].state,/^[a-f0-9]{64}$/);
  assert.equal(h.requests.at(-1).proof,'2');
  assert(!JSON.stringify(h.replies).includes('synthetic-native-authorization-code'));
  assert(!JSON.stringify(h.replies).includes(token));
 }finally{h.dispose();}
});

test('discovery after session proof leaves the verified native owner lease intact',async()=>{
 const h=hostRuntime({initialToken:token,huawei:true,dispatch});
 try{
  await h.invoke({version:2,id:'initial',action:'session'});
  const before=JSON.parse(JSON.stringify(h.host.trustedOwnerProvider().snapshot()));
  assert.equal((await h.invoke({id:'discovery',action:'providers'})).status,200);
  assert.deepEqual(JSON.parse(JSON.stringify(h.host.trustedOwnerProvider().snapshot())),before);
 }finally{h.dispose();}
});

test('cancel, mismatched state and malformed SDK code never exchange or expose credentials',async()=>{
 for(const authorize of [()=>Promise.reject({code:1001502012}),request=>({state:'wrong',data:{authorizationCode:'private-code'}}),request=>({state:request.state,data:{authorizationCode:''}})]){
  const h=hostRuntime({huawei:true,authorize,dispatch});
  try{const r=await h.invoke({id:'sdk_failure',action:'huawei-login'});assert.equal(r.status,400);assert(['huawei-cancelled','huawei-authorization-failed'].includes(r.body.code));assert.equal(h.requests.length,1);assert.equal(h.saves,0);assert(!JSON.stringify(h.replies).includes('private-code'));}finally{h.dispose();}
 }
});

test('SDK dialog survives background past fifteen seconds, but exchange waits for foreground and old lease stays revoked',async()=>{
 const sdk=deferred();let request;
 const h=hostRuntime({initialToken:token,huawei:true,authorize:value=>{request=value;return sdk.promise;},dispatch});
 try{
  await h.invoke({version:2,id:'initial',action:'session'});assert.equal(h.host.trustedOwnerProvider().snapshot().uid,A.id);
  const pending=h.invoke({id:'sdk_pending',action:'huawei-login'});await h.settle();
  h.lifecycle(false);h.expire(15000);assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined);
  sdk.resolve({state:request.state,data:{authorizationCode:'private-background-code'}});await h.settle();
  assert.equal(h.requests.length,2);assert.equal(h.replies.length,1);
  h.lifecycle(true);const r=await pending;assert.equal(r.status,200);assert.equal(h.host.trustedOwnerProvider().snapshot(),undefined,'Mutation must not republish the prior learning lease');
  await h.invoke({version:2,id:'new_proof',action:'session'});assert.equal(h.host.trustedOwnerProvider().snapshot().uid,A.id);
 }finally{h.dispose();}
});

test('navigation, untrusted frame and dispose abandon late SDK credentials without consuming them',async()=>{
 for(const invalidate of [h=>h.host.invalidate(),h=>h.setFrame('https://evil.test/'),h=>h.dispose()]){
  const sdk=deferred();let request;const h=hostRuntime({huawei:true,authorize:value=>{request=value;return sdk.promise;},dispatch});
  try{h.send({id:'abandoned',action:'huawei-login'});await h.settle();invalidate(h);sdk.resolve({state:request.state,data:{authorizationCode:'late-code'}});await h.settle();assert.equal(h.requests.length,1);assert.equal(h.saves,0);assert.equal(h.replies.length,0);}finally{h.dispose();}
 }
});

test('SDK timeout has its own deadline, retains the live native slot and cannot exchange a late code',async()=>{
 const sdk=deferred();let request;const h=hostRuntime({huawei:true,authorize:value=>{request=value;return sdk.promise;},dispatch});
 try{
  h.send({id:'slow_sdk',action:'huawei-login'});await h.settle();h.expire(15000);assert.equal(h.replies.length,0);
  h.expire(180000);assert.equal(h.replies[0].status,408);assert.equal(h.replies[0].body.code,'huawei-timeout');
  const busy=await h.invoke({version:2,id:'still_busy',action:'session'});assert.equal(busy.status,503);assert.equal(h.requests.length,1);
  sdk.resolve({state:request.state,data:{authorizationCode:'expired-code'}});await h.settle();assert.equal(h.requests.length,1);assert.equal(h.saves,0);
 }finally{h.dispose();}
});

test('explicit bind verifies the same private session before and after, without replacing its cookie',async()=>{
 const h=hostRuntime({initialToken:token,huawei:true,dispatch});
 try{const r=await h.invoke({id:'bind',action:'huawei-bind'});assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.equal(r.body.user.id,A.id);assert.equal(h.saves,0);assert.equal(h.clears,0);assert.equal(h.requests.filter(item=>item.path.endsWith('/session')).length,2);assert(h.requests.filter(item=>item.path.endsWith('/session')).every(item=>item.proof==='2'&&item.hasCookie));}finally{h.dispose();}
});

test('binding conflict preserves original cookie, while changed owner or unknown backend result stays quarantined',async()=>{
 for(const mode of ['conflict','changed-owner','unknown']){
  let sessions=0;const h=hostRuntime({initialToken:token,huawei:true,dispatch:(url,options)=>{
   const path=new URL(url).pathname;
   if(path.endsWith('/huawei/bind')&&mode==='conflict')return response(409,{code:'huawei-binding-conflict',error:'untrusted diagnostic'});
   if(path.endsWith('/huawei/bind')&&mode==='unknown')return response(503,{code:'huawei-unavailable'});
   if(path.endsWith('/session'))return response(200,proof(++sessions>1&&mode==='changed-owner'?B:A));
   return dispatch(url,options);
  }});
  try{
   const r=await h.invoke({id:'bind_'+mode,action:'huawei-bind'});
   assert.equal(r.status,mode==='conflict'?409:503);assert.equal(h.saves,0);
   if(mode==='conflict')assert.equal(h.clears,0);else {assert.equal(r.body.code,'auth-state-unknown');assert(h.clears>0);}
   assert(!JSON.stringify(h.replies).includes('untrusted diagnostic'));
  }finally{h.dispose();}
 }
});

test('post-code HTTP timeout clears any uncertain session and never retries the authorization code',async()=>{
 const http=deferred();let exchanges=0;const h=hostRuntime({initialToken:token,huawei:true,dispatch:(url,options)=>{if(new URL(url).pathname.endsWith('/huawei/login')){exchanges++;return http.promise;}return dispatch(url,options);}});
 try{h.send({id:'network_pending',action:'huawei-login'});await h.settle();h.expire(15000);assert.equal(h.replies[0].body.code,'auth-state-unknown');http.resolve(response(200,userReply(),{'set-cookie':cookie}));await h.settle();assert.equal(exchanges,1);assert.equal(h.saves,0);assert(h.clears>0);assert.equal(h.replies.length,1);}finally{h.dispose();}
});
