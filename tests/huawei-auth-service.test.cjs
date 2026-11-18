'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {environment,ORIGIN,plain}=require('./helpers/product-auth-harness.cjs');
const clientId='6917620597803523113';
const configured={LANTERN_HUAWEI_CLIENT_ID:clientId,LANTERN_HUAWEI_CLIENT_SECRET:'synthetic-provider-secret-only'};
const info={client_id:clientId,type:0,expire_in:3600,open_id:'SyntheticOpenID_A'};
const token={token_type:'Bearer',access_token:'synthetic_access_token',expires_in:3600};
const cookie=response=>response.headers.get('set-cookie')?.split(';')[0];
function fixture(t,options={}){
 const e=environment({env:{...configured,...options.env}});t.after(()=>e.close());
 const calls=[];
 const provider=async(url,init)=>{
  const body=Object.fromEntries(init.body);calls.push({url,body,signal:init.signal,redirect:init.redirect});
  await options.beforeProvider?.(calls.length,e,init);
  const value=url.endsWith('/token')?(options.token??token):(options.info??info);
  const override=await options.response?.(calls.length,url,init,e);
  return override??new Response(JSON.stringify(value),{headers:{'Content-Type':calls.length%2?'application/json':'text/plain;charset=utf-8'}});
 };
 const service=e.load('lib/huawei-auth-service.ts');
 const action=service.createHuaweiAuthService({fetch:options.fetch??provider,timeoutMs:options.timeoutMs});
 const request=(purpose,code,sessionCookie,extras={})=>new Request(ORIGIN+'/api/auth/huawei/'+purpose,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',...sessionCookie?{Cookie:sessionCookie}:{},...extras.headers},body:JSON.stringify(Object.hasOwn(extras,'body')?extras.body:{code}),...extras.signal?{signal:extras.signal}:{}});
 const run=(purpose='login',code='synthetic_code_'+calls.length,sessionCookie,extras)=>action(request(purpose,code,sessionCookie,extras),purpose,e.env);
 return {e,service,action,request,run,calls};
}

test('Huawei is off without complete trusted config and discovery never changes legacy wire',async t=>{
 for(const env of [{LANTERN_HUAWEI_CLIENT_SECRET:undefined},{LANTERN_HUAWEI_CLIENT_ID:undefined},{LANTERN_AUTH_ENABLED:'false'},{LANTERN_HUAWEI_CLIENT_ID:'not-an-app-id'}]){
  const h=fixture(t,{env});
  assert.deepEqual(plain(await h.service.huaweiProvidersAction(new Request(ORIGIN+'/api/auth/providers'),h.e.env).json()),{huaweiLogin:false,huaweiBinding:false});
  assert.equal((await h.run()).status,503);assert.equal(h.calls.length,0);assert.equal(h.e.queries.length,0);
 }
 const h=fixture(t);assert.deepEqual(await h.service.huaweiProvidersAction(new Request(ORIGIN+'/api/auth/providers'),h.e.env).json(),{huaweiLogin:true,huaweiBinding:true});
 const user=await h.e.register();const old=await h.e.call('session','GET',{cookie:user.cookie});
 assert.deepEqual(Object.keys(await old.json()).sort(),['capabilities','user']);
 assert.equal(h.service.huaweiProvidersAction(new Request('https://wrong.example/api/auth/providers'),h.e.env).status,403);
});

test('Huawei rejects forged claims, malformed/oversized codes and cross-origin before provider work',async t=>{
 const h=fixture(t);
 for(const body of [{code:'valid',openid:'forged'},{code:''},{code:'has space'},{code:'x'.repeat(8193)},{code:1},{user:{id:'forged'}},null])assert.equal((await h.run('login','unused',undefined,{body})).status,400);
 assert.equal((await h.run('login','unused',undefined,{headers:{Origin:'https://wrong.test'}})).status,403);
 assert.equal(h.calls.length,0);assert.equal(h.e.rows('auth_huawei_codes').length,0);
 assert.equal((await h.run('bind','unused')).status,401);assert.equal(h.calls.length,0);
});

test('real service exchanges once with fixed encoded endpoints then issues a stable verified product session',async t=>{
 const h=fixture(t),first=await h.run('login','synthetic+code&with=encoding'),body=await first.json();
 assert.equal(first.status,200);assert.match(body.user.id,/^usr_[a-f0-9-]{36}$/);assert.match(body.user.username,/^[a-z0-9_]{3,32}$/);
 assert.deepEqual(Object.keys(body).sort(),['capabilities','user']);assert.equal(h.calls.length,2);
 assert.equal(h.calls[0].url,'https://oauth-login.cloud.huawei.com/oauth2/v3/token');
 assert.equal(h.calls[0].body.code,'synthetic+code&with=encoding');assert.equal(h.calls[0].body.grant_type,'authorization_code');assert.equal(h.calls[0].body.supportAlg,'PS256');
 assert.equal(h.calls[1].url,'https://oauth-api.cloud.huawei.com/rest.php?nsp_fmt=JSON&nsp_svc=huawei.oauth2.user.getTokenInfo');assert.deepEqual(h.calls[1].body,{access_token:'synthetic_access_token',open_id:'OPENID'});assert(h.calls.every(call=>call.redirect==='manual'));
 const proof=await h.e.call('session','GET',{cookie:cookie(first),headers:{'X-Lantern-Session-Proof':'2'}});assert.equal(proof.status,200);assert.deepEqual((await proof.json()).user,body.user);
 const next=await h.run('login','different_code'),nextBody=await next.json();assert.deepEqual(nextBody.user,body.user);assert.equal(h.e.rows('auth_users').length,1);assert.equal(h.e.rows('auth_provider_bindings').length,1);assert.equal(h.e.rows('auth_password_credentials').length,0);
 assert.equal((await h.e.call('session','GET',{cookie:cookie(first)})).status,401);assert.equal((await h.e.call('session','GET',{cookie:cookie(next)})).status,200);
 assert(!JSON.stringify(body).includes('synthetic_access_token'));assert(!JSON.stringify(h.e.rows('auth_huawei_codes')).includes('synthetic+code'));
});

test('code replay and simultaneous duplicate code never repeat provider exchange or create extra identities',async t=>{
 const h=fixture(t);const [a,b]=await Promise.all([h.run('login','one_code'),h.run('login','one_code')]);assert.deepEqual([a.status,b.status].sort(),[200,409]);assert.equal(h.calls.length,2);
 assert.equal((await h.run('login','one_code')).status,409);assert.equal(h.calls.length,2);assert.equal(h.e.rows('auth_users').length,1);
});

test('different fresh codes for the same subject converge atomically without orphan users',async t=>{
 const h=fixture(t),responses=await Promise.all([h.run('login','parallel_a'),h.run('login','parallel_b')]);
 assert(responses.every(response=>response.status===200));const bodies=await Promise.all(responses.map(response=>response.json()));assert.deepEqual(bodies[0].user,bodies[1].user);assert.equal(h.e.rows('auth_users').length,1);assert.equal(h.e.rows('auth_provider_bindings').length,1);assert.equal(h.e.rows('auth_sessions').length,1);
});

for(const [name,override] of [
 ['wrong audience',{client_id:'other-app'}],['application token',{type:1}],['string type',{type:'0'}],['expired',{expire_in:0}],['string expiry',{expire_in:'3600'}],['missing expiry',{expire_in:undefined}],['missing OpenID',{open_id:undefined}],['empty OpenID',{open_id:''}],['invalid OpenID',{open_id:'bad\nsubject'}],['HTTP200 business error',{error:'invalid session'}],
])test('token-info fails closed: '+name,async t=>{
 const h=fixture(t,{info:{...info,...override}});const response=await h.run();assert.equal(response.status,401);assert.equal(response.headers.has('set-cookie'),false);assert.equal(h.e.rows('auth_users').length,0);assert.equal(h.e.rows('auth_provider_bindings').length,0);assert.equal(h.e.rows('auth_sessions').length,0);
});

test('provider HTTP200 NSP_STATUS error, bad JSON and oversized body fail without identity',async t=>{
 for(const response of [()=>new Response(JSON.stringify(info),{headers:{NSP_STATUS:'102'}}),()=>new Response('not json'),()=>new Response('x'.repeat(32769))]){
  const h=fixture(t,{response:n=>n===2?response():undefined});assert.notEqual((await h.run()).status,200);assert.equal(h.e.rows('auth_users').length,0);
 }
});

test('official endpoints never follow a credential-bearing redirect',async t=>{
 for(const stage of [1,2]){
  const h=fixture(t,{response:n=>n===stage?new Response(null,{status:302,headers:{Location:'https://untrusted.example/collect'}}):undefined});
  assert.equal((await h.run()).status,401);assert.equal(h.calls.length,stage);assert(h.calls.every(call=>call.redirect==='manual'));assert.equal(h.e.rows('auth_users').length,0);
 }
});

test('invalid token responses never reach token-info and unknown exchange is never retried',async t=>{
 for(const value of [{...token,token_type:'MAC'},{...token,access_token:''},{...token,expires_in:0},{error:123}]){
  const h=fixture(t,{token:value});assert.equal((await h.run('login','bad_token')).status,401);assert.equal(h.calls.length,1);assert.equal((await h.run('login','bad_token')).status,409);assert.equal(h.calls.length,1);
 }
 let calls=0;const h=fixture(t,{fetch:async()=>{calls++;throw new Error('synthetic connection lost');}});assert.equal((await h.run('login','lost_code')).status,503);assert.equal((await h.run('login','lost_code')).status,409);assert.equal(calls,1);assert.equal(h.e.rows('auth_sessions').length,0);
});

test('provider deadline aborts one exchange, leaves owner untouched and requires a fresh code',async t=>{
 let calls=0;const h=fixture(t,{timeoutMs:5,fetch:async(_url,init)=>{calls++;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}});
 const owner=await h.e.register();assert.equal((await h.run('login','slow_code',owner.cookie)).status,503);assert.equal(calls,1);assert.equal((await h.e.call('session','GET',{cookie:owner.cookie})).status,200);assert.equal(h.e.rows('auth_provider_bindings').length,0);
});

test('caller cancellation consumes this attempt but cannot create an owner or binding',async t=>{
 const abort=new AbortController(),h=fixture(t,{beforeProvider:async n=>{if(n===2)abort.abort();}});
 assert.equal((await h.run('login','cancelled_code',undefined,{signal:abort.signal})).status,503);assert.equal(h.e.rows('auth_users').length,0);assert.equal(h.e.rows('auth_sessions').length,0);assert.equal((await h.run('login','cancelled_code')).status,409);
});

test('password owner explicitly binds, keeps password/session, then Huawei login reuses exactly that owner',async t=>{
 const h=fixture(t),owner=await h.e.register(),passwords=plain(h.e.rows('auth_password_credentials'));
 const response=await h.run('bind','bind_code',owner.cookie);assert.equal(response.status,200);assert.equal(response.headers.has('set-cookie'),false);assert.deepEqual(await response.json(),{ok:true,user:{id:owner.id,username:owner.username}});assert.deepEqual(h.e.rows('auth_password_credentials'),passwords);
 assert.equal((await h.e.call('session','GET',{cookie:owner.cookie})).status,200);
 assert.equal((await h.run('bind','bind_again',owner.cookie)).status,200);
 const login=await h.run('login','login_bound');assert.equal((await login.json()).user.id,owner.id);assert.equal(h.e.rows('auth_users').length,1);
 const passwordLogin=await h.e.call('login','POST',{body:{username:owner.username,password:'Synthetic only password 42!'}});assert.equal(passwordLogin.status,200);assert.equal((await passwordLogin.json()).user.id,owner.id);
});

test('unbound Huawei login creates a distinct owner even while a password owner is logged in',async t=>{
 const h=fixture(t),owner=await h.e.register();const response=await h.run('login','separate_login',owner.cookie),body=await response.json();assert.equal(response.status,200);assert.notEqual(body.user.id,owner.id);assert.equal(h.e.rows('auth_users').length,2);assert.equal(h.e.rows('auth_password_credentials')[0].user_id,owner.id);
});

test('binding conflict never transfers identities or revokes the original password owners',async t=>{
 const h=fixture(t),a=await h.e.register('owner_a'),b=await h.e.register('owner_b');assert.equal((await h.run('bind','bind_a',a.cookie)).status,200);
 const before=plain(h.e.rows('auth_provider_bindings')),sessions=plain(h.e.rows('auth_sessions'));
 const response=await h.run('bind','bind_b',b.cookie);assert.equal(response.status,409);assert.equal((await response.json()).code,'huawei-binding-conflict');assert.deepEqual(h.e.rows('auth_provider_bindings'),before);assert.deepEqual(h.e.rows('auth_sessions'),sessions);assert.equal(h.e.rows('auth_users').length,2);
});

test('one product owner cannot silently swap an existing Huawei identity',async t=>{
 let subject='FirstCase';const h=fixture(t,{response:n=>n%2===0?new Response(JSON.stringify({...info,open_id:subject})):undefined}),owner=await h.e.register();assert.equal((await h.run('bind','first',owner.cookie)).status,200);
 subject='firstcase';assert.equal((await h.run('bind','second',owner.cookie)).status,409);assert.equal(h.e.rows('auth_provider_bindings')[0].subject,'FirstCase');
 const other=await h.run('login','case_sensitive_new');assert.equal(other.status,200);assert.notEqual((await other.json()).user.id,owner.id);assert.equal(h.e.rows('auth_users').length,2);
});

test('binding rechecks its original live session after the provider dialog and in the commit transaction',async t=>{
 for(const stage of ['provider','transaction']){
  let owner;const h=fixture(t,{beforeProvider:async(n,e)=>{if(stage==='provider'&&n===2)e.sqlite.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(owner.id);}});owner=await h.e.register();
  if(stage==='transaction'){const batch=h.e.d1.batch;h.e.d1.batch=async statements=>{if(statements.length===2)h.e.sqlite.prepare('UPDATE auth_sessions SET expires_at=0 WHERE user_id=?').run(owner.id);return batch(statements);};}
  const response=await h.run('bind','expired_'+stage,owner.cookie);assert.equal(response.status,401);assert.equal(h.e.rows('auth_provider_bindings').length,0);assert.equal(h.e.rows('auth_huawei_codes')[0].completed_at,null);assert.equal(h.e.rows('auth_users').length,1);
 }
});

test('a transaction failure rolls back new owner, mapping and session while preserving the old owner',async t=>{
 const h=fixture(t),owner=await h.e.register(),before=plain(h.e.rows('auth_sessions')),batch=h.e.d1.batch;
 h.e.d1.batch=async statements=>{if(statements.length===5)statements.splice(3,0,h.e.d1.prepare('INSERT INTO auth_users(id,username,created_at) VALUES(NULL,NULL,NULL)'));return batch(statements);};
 assert.equal((await h.run('login','rollback_code',owner.cookie)).status,503);assert.equal(h.e.rows('auth_users').length,1);assert.equal(h.e.rows('auth_provider_bindings').length,0);assert.deepEqual(h.e.rows('auth_sessions'),before);assert.equal(h.e.rows('auth_huawei_codes')[0].completed_at,null);
});

test('global Huawei budget rejects before exchange and cannot mutate password rate buckets',async t=>{
 const h=fixture(t),window=Math.floor(Date.now()/900000)*900000;h.e.sqlite.prepare("INSERT INTO auth_rate_limits(scope,window_start,count,admission_id) VALUES('global:huawei',?,100,'synthetic')").run(window);
 assert.equal((await h.run()).status,429);assert.equal(h.calls.length,0);assert.equal(h.e.rows('auth_huawei_codes').length,0);assert.equal(h.e.rows('auth_rate_limits').length,1);
});
