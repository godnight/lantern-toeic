'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {hostRuntime,response}=require('./helpers/native-auth-host-runtime.cjs');
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false},token='a'.repeat(64);
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
