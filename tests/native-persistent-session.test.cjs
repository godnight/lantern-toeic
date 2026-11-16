'use strict';
// Real ETS host/store and project auth service against synthetic OS ports and
// SQLite only; no real account, provider, TLS, device or network is used.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {hostRuntime,response}=require('./helpers/native-auth-host-runtime.cjs');
const {environment,ORIGIN}=require('./helpers/product-auth-harness.cjs');
const TOKEN='a'.repeat(64),LONG=2592000,SHORT=43200;
const cookie=seconds=>`__Host-lantern-session=${TOKEN}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;

function assetHarness(initial){
 let bytes=initial,now=1800000000000,removes=0;
 const Tag={ALIAS:'alias',SECRET:'secret',RETURN_TYPE:'return',ACCESSIBILITY:'access',SYNC_TYPE:'sync'};
 const asset={Tag,ReturnType:{ALL:'all'},Accessibility:{DEVICE_UNLOCKED:'unlock'},SyncType:{NEVER:'never'},
  async query(){if(!bytes)throw {code:24000002};return [new Map([[Tag.SECRET,bytes]])];},
  async add(attrs){if(bytes)throw {code:24000003};bytes=attrs.get(Tag.SECRET);},
  async update(_q,attrs){bytes=attrs.get(Tag.SECRET);},async remove(){removes++;bytes=undefined;}};
 const source=fs.readFileSync(path.join(__dirname,'../harmony/entry/src/main/ets/auth/AuthSessionStore.ets'),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const exports={},imports={'@ohos.security.asset':{__esModule:true,default:asset},'@kit.BasicServicesKit':{},'./AuthMigrationConfiguration':{AUTH_MIGRATION_ENABLED:false}};
 vm.runInNewContext(js,{exports,require:id=>{if(!(id in imports))throw Error('unexpected import');return imports[id];},Uint8Array,Map,JSON,Number,String,Error,Date:{now:()=>now}});
 return {store:new exports.AuthSessionStore(),newStore:()=>new exports.AuthSessionStore(),advance:ms=>now+=ms,get bytes(){return bytes;},get removes(){return removes;}};
}

test('Asset preserves v1 compatibility and gates versioned long sessions without deleting them',async()=>{
 const h=assetHarness();await h.store.save(ORIGIN,TOKEN,SHORT);assert.equal(await h.store.load(ORIGIN),TOKEN);
 assert.equal(JSON.parse(Buffer.from(h.bytes).toString()).version,1);
 await assert.rejects(h.store.save(ORIGIN,TOKEN,LONG));
 await h.store.save(ORIGIN,TOKEN,LONG,true);const saved=JSON.parse(Buffer.from(h.bytes).toString());
 assert.equal(saved.version,2);assert.equal(saved.expiresAt-saved.issuedAt,LONG*1000);
 assert.equal(await h.store.load(ORIGIN),undefined);await h.store.clear();assert.equal(h.removes,0);
 h.advance(13*3600000);assert.equal(await h.store.load(ORIGIN,true),TOKEN);
 h.advance(LONG*1000);assert.equal(await h.store.load(ORIGIN,true),undefined);assert.equal(h.removes,1);
});

test('versioned Asset never accepts time rollback, malformed expiry or a different origin',async()=>{
 const now=1800000000000;
 for(const changes of [
  {issuedAt:now+1,expiresAt:now+1000},{issuedAt:now,expiresAt:now+LONG*1000+1},
  {issuedAt:now,expiresAt:now},{issuedAt:undefined,expiresAt:now+1000},
 ]){
  const raw=new Uint8Array(Buffer.from(JSON.stringify({version:2,origin:ORIGIN,token:TOKEN,issuedAt:now,expiresAt:now+1000,...changes})));
  const h=assetHarness(raw);await assert.rejects(h.store.load(ORIGIN,true));assert.equal(h.removes,0);
 }
 const h=assetHarness();await h.store.save(ORIGIN,TOKEN,LONG,true);
 assert.equal(await h.store.load('https://other.invalid',true),undefined);assert.equal(h.removes,1);
});

test('actual native host negotiates only supported long sessions with actual SQLite auth service',async()=>{
 for(const [nativeEnabled,serverEnabled,expected] of [[false,false,SHORT],[true,false,SHORT],[true,true,LONG]]){
  const e=environment({env:{LANTERN_PERSISTENT_SESSION_ENABLED:serverEnabled?'true':'false'}});
  let h;
  try{
   h=hostRuntime({origin:ORIGIN,persistent:nativeEnabled,dispatch:async(url,options)=>{
    const action=new URL(url).pathname.split('/').at(-1);
    const headers={};for(const key of ['X-Lantern-Session-Policy','X-Lantern-Session-Proof'])if(options.header[key])headers[key]=options.header[key];
    const r=await e.call(action,options.method,{cookie:options.header.Cookie,headers,...options.extraData?{body:JSON.parse(options.extraData)}:{}});
    const body=await r.json(),setCookie=r.headers.get('set-cookie');return response(r.status,body,setCookie?{'Set-Cookie':setCookie}:{});
   }});
   const credentials={username:'native_'+Number(nativeEnabled)+Number(serverEnabled),password:'Synthetic native password 42!'};
   const registered=await h.invoke({id:'register',action:'register',body:credentials});assert.equal(registered.status,200);
   assert.equal(h.store.age,expected);assert.equal(h.store.persistent,nativeEnabled);
   assert.equal(h.requests[0].policy,nativeEnabled?'persistent-v1':undefined);
   assert.equal(h.requests[1].policy,undefined,'independent session verification never requests a new policy');
   const proof=await h.invoke({id:'session',version:2,action:'session'});assert.equal(proof.status,200);assert(proof.body.session.validForMs<=SHORT*1000);
   assert(!JSON.stringify(h.replies).includes('Synthetic native password'));
   assert(!JSON.stringify(h.replies).includes(e.rows('auth_sessions')[0].token_hash));
   assert.equal((await h.invoke({id:'logout',action:'logout'})).status,200);assert.equal(h.requests.at(-1).policy,undefined);
  }finally{h?.dispose();e.close();}
 }
});

test('real native store and host recheck the same server session after thirteen offline hours',async()=>{
 const e=environment({env:{LANTERN_PERSISTENT_SESSION_ENABLED:'true'}}),asset=assetHarness();let h;
 try{
  h=hostRuntime({origin:ORIGIN,persistent:true,sessionStore:asset.store,dispatch:async(url,options)=>{
   const action=new URL(url).pathname.split('/').at(-1),headers={};
   for(const key of ['X-Lantern-Session-Policy','X-Lantern-Session-Proof'])if(options.header[key])headers[key]=options.header[key];
   const r=await e.call(action,options.method,{cookie:options.header.Cookie,headers,...options.extraData?{body:JSON.parse(options.extraData)}:{}});
   const body=await r.json(),setCookie=r.headers.get('set-cookie');return response(r.status,body,setCookie?{'Set-Cookie':setCookie}:{});
  }});
  const user=await h.invoke({id:'register',action:'register',body:{username:'flight_user',password:'Synthetic flight password 42!'}});assert.equal(user.status,200);
  const row=e.rows('auth_sessions')[0];assert.equal(row.expires_at-row.created_at,LONG*1000);
  const thirteen=13*3600000;asset.advance(thirteen);
  e.sqlite.prepare('UPDATE auth_sessions SET created_at=?, expires_at=? WHERE token_hash=?').run(row.created_at-thirteen,row.expires_at-thirteen,row.token_hash);
  const proof=await h.invoke({id:'resume',version:2,action:'session'});assert.equal(proof.status,200);assert.equal(proof.body.user.id,user.body.user.id);assert(proof.body.session.validForMs<=SHORT*1000);
  const raw=JSON.parse(Buffer.from(asset.bytes).toString()).token;assert(!JSON.stringify(h.replies).includes(raw));
  assert.equal((await h.invoke({id:'logout',action:'logout'})).status,200);assert.equal(asset.bytes,undefined);
  assert.equal(e.rows('auth_sessions').length,0);
 }finally{h?.dispose();e.close();}
});

test('rollback hides but preserves a long credential until explicit login rotation or logout',async()=>{
 for(const action of ['login','logout']){
  const e=environment({env:{LANTERN_PERSISTENT_SESSION_ENABLED:'true'}}),asset=assetHarness();let oldHost,newHost;
  const dispatch=async(url,options)=>{
   const route=new URL(url).pathname.split('/').at(-1),headers={};
   for(const key of ['X-Lantern-Session-Policy','X-Lantern-Session-Proof'])if(options.header[key])headers[key]=options.header[key];
   const r=await e.call(route,options.method,{cookie:options.header.Cookie,headers,...options.extraData?{body:JSON.parse(options.extraData)}:{}});
   const body=await r.json(),setCookie=r.headers.get('set-cookie');return response(r.status,body,setCookie?{'Set-Cookie':setCookie}:{});
  };
  try{
   const credentials={username:'rollback_'+action,password:'Synthetic rollback password 42!'};
   oldHost=hostRuntime({origin:ORIGIN,persistent:true,sessionStore:asset.store,dispatch});
   assert.equal((await oldHost.invoke({id:'register',action:'register',body:credentials})).status,200);
   const original=JSON.parse(Buffer.from(asset.bytes).toString()),hash=e.rows('auth_sessions')[0].token_hash;assert.equal(original.version,2);
   oldHost.dispose();oldHost=undefined;
   newHost=hostRuntime({origin:ORIGIN,persistent:false,sessionStore:asset.newStore(),dispatch});
   const dormant=await newHost.invoke({version:2,id:'session',action:'session'});assert.equal(dormant.status,401);
   assert.equal(Buffer.from(asset.bytes).toString(),JSON.stringify(original),'automatic 401 must not delete dormant credentials');
   assert.equal(newHost.requests[0].hasCookie,false,'dormant credentials do not prove account access');
   const outcome=await newHost.invoke(action==='login'?{id:'recover',action,body:credentials}:{id:'logout',action});assert.equal(outcome.status,200);
   assert.equal(newHost.requests.find(r=>r.path.endsWith('/'+action)).hasCookie,true,'explicit action presents old token only to revoke or rotate');
   assert(!e.rows('auth_sessions').some(row=>row.token_hash===hash),'server revokes old token');
   if(action==='login'){assert.equal(JSON.parse(Buffer.from(asset.bytes).toString()).version,1);assert.equal(e.rows('auth_sessions').length,1);}
   else {assert.equal(asset.bytes,undefined);assert.equal(e.rows('auth_sessions').length,0);}
  }finally{oldHost?.dispose();newHost?.dispose();e.close();}
 }
});

test('a failed rollback login preserves the dormant credential and later logout revokes it',async()=>{
 const e=environment({env:{LANTERN_PERSISTENT_SESSION_ENABLED:'true'}}),asset=assetHarness();let oldHost,newHost,failLogin=false;
 const dispatch=async(url,options)=>{
  const route=new URL(url).pathname.split('/').at(-1),headers={};
  if(failLogin&&route==='login')return response(503,{code:'synthetic-unavailable'});
  for(const key of ['X-Lantern-Session-Policy','X-Lantern-Session-Proof'])if(options.header[key])headers[key]=options.header[key];
  const r=await e.call(route,options.method,{cookie:options.header.Cookie,headers,...options.extraData?{body:JSON.parse(options.extraData)}:{}});
  const body=await r.json(),setCookie=r.headers.get('set-cookie');return response(r.status,body,setCookie?{'Set-Cookie':setCookie}:{});
 };
 try{
  const credentials={username:'rollback_failure',password:'Synthetic rollback password 42!'};
  oldHost=hostRuntime({origin:ORIGIN,persistent:true,sessionStore:asset.store,dispatch});assert.equal((await oldHost.invoke({id:'register',action:'register',body:credentials})).status,200);
  const original=Buffer.from(asset.bytes).toString(),hash=e.rows('auth_sessions')[0].token_hash;oldHost.dispose();oldHost=undefined;
  newHost=hostRuntime({origin:ORIGIN,persistent:false,sessionStore:asset.newStore(),dispatch});assert.equal((await newHost.invoke({version:2,id:'session',action:'session'})).status,401);
  failLogin=true;assert.equal((await newHost.invoke({id:'failed',action:'login',body:credentials})).status,503);await newHost.settle();assert.equal(Buffer.from(asset.bytes).toString(),original);
  failLogin=false;assert.equal((await newHost.invoke({id:'logout',action:'logout'})).status,200);assert(newHost.requests.at(-1).hasCookie);
  assert(!e.rows('auth_sessions').some(row=>row.token_hash===hash));assert.equal(asset.bytes,undefined);
 }finally{oldHost?.dispose();newHost?.dispose();e.close();}
});

test('long cookies reject excessive or malformed TTL and untrusted action headers',async()=>{
 const policy=hostRuntime({persistent:true});
 try{
  const parse=policy.load('AuthPolicy').sessionCookie;
  assert.equal(parse([cookie(LONG)],true).maxAge,LONG);assert.equal(parse([cookie(SHORT)],true).maxAge,SHORT);
  assert.equal(parse([cookie(LONG)]),undefined);assert.equal(parse([cookie(LONG+1)],true),undefined);
  assert.equal(parse([cookie(LONG)+'; Domain=auth.test'],true),undefined);
  assert.equal(parse([cookie(LONG),cookie(LONG)],true),undefined);
  policy.send({id:'evil',action:'login',body:{username:'someone',password:'synthetic password 42!',headers:{'X-Lantern-Session-Policy':'persistent-v1'}}});
  await policy.settle();assert.equal(policy.requests.length,0);
 }finally{policy.dispose();}
});

test('untrusted frames and rejected or malformed server responses cannot save a long credential',async()=>{
 const malicious=hostRuntime({persistent:true,frame:'https://attacker.invalid/'});
 try{malicious.send({id:'foreign',action:'login',body:{username:'someone',password:'synthetic password 42!'}});await malicious.settle();assert.equal(malicious.requests.length,0);assert.equal(malicious.saves,0);}finally{malicious.dispose();}
 for(const [enabled,status,header] of [
  [false,200,cookie(LONG)],[true,401,cookie(LONG)],[true,200,cookie(LONG+1)],
  [true,200,cookie(LONG)+'; Domain=auth.test'],[true,200,cookie(LONG)+'; Secure'],
 ]){
  const h=hostRuntime({persistent:enabled,dispatch:async()=>response(status,{user:{id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'someone'},capabilities:{passwordLogin:true,phoneLogin:false,passwordRecovery:false}},{'Set-Cookie':header})});
  try{const r=await h.invoke({id:'bad',action:'login',body:{username:'someone',password:'synthetic password 42!'}});assert.notEqual(r.status,200);assert.equal(h.saves,0);}finally{h.dispose();}
 }
});

test('only fixed identity-issuing actions send the native capability',async()=>{
 const observed=[];
 const h=hostRuntime({persistent:true,huawei:true,dispatch:async(url,options)=>{
  observed.push({path:new URL(url).pathname,policy:options.header['X-Lantern-Session-Policy']});
  if(new URL(url).pathname.endsWith('/providers'))return response(200,{huaweiLogin:true,huaweiBinding:true});
  return response(503,{code:'auth-disabled'});
 }});
 try{
  await h.invoke({id:'hw',action:'huawei-login'});await h.settle();
  assert.equal(observed.find(x=>x.path.endsWith('/providers')).policy,undefined);
  assert.equal(observed.find(x=>x.path.endsWith('/huawei/login')).policy,'persistent-v1');
  await h.invoke({id:'phone',action:'phone-login',body:{phone:'+8613800000103',challengeId:'a'.repeat(32),code:'123456'}});await h.settle();
  assert.equal(observed.find(x=>x.path.endsWith('/phone/login')).policy,'persistent-v1');
 }finally{h.dispose();}
});
