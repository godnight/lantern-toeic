'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto');
const {environment,ORIGIN}=require('./helpers/product-auth-harness.cjs');
const FLAG='LANTERN_PERSISTENT_SESSION_ENABLED',HEADER='X-Lantern-Session-Policy';
const longSeconds=30*24*60*60,shortSeconds=12*60*60,password='Synthetic policy password 42!';
const token=response=>response.headers.get('set-cookie')?.split(';')[0];
function checkStored(e,response,seconds){
 const cookie=response.headers.get('set-cookie');
 assert.match(cookie,new RegExp('^__Host-lantern-session=[0-9a-f]{64}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+seconds+'$'));
 const raw=cookie.split(';')[0].split('=')[1],hash=createHash('sha256').update(raw).digest('hex');
 const row=e.rows('auth_sessions').find(row=>row.token_hash===hash);
 assert.ok(row);assert.equal(row.expires_at-row.created_at,seconds*1000);
 assert.ok(!JSON.stringify(e.rows('auth_sessions')).includes(raw));
 return cookie.split(';')[0];
}
test('persistent sessions are fixed, explicit and default closed; legacy and duplicate hints stay short',async t=>{
 const e=environment();t.after(()=>e.close());
 const hint={[HEADER]:'persistent-v1'};
 let r=await e.call('register','POST',{body:{username:'policy_off',password},headers:hint});
 assert.equal(r.status,200);checkStored(e,r,shortSeconds);
 e.env[FLAG]='true';
 for(const [name,headers] of [['policy_old',{}],['policy_unknown',{[HEADER]:'persistent-v2'}],['policy_duplicate',{[HEADER]:'persistent-v1, persistent-v1'}]]){
  r=await e.call('register','POST',{body:{username:name,password},headers});assert.equal(r.status,200);checkStored(e,r,shortSeconds);
 }
 r=await e.call('register','POST',{body:{username:'policy_new',password},headers:hint});
 assert.equal(r.status,200);const a=checkStored(e,r,longSeconds),owner=(await r.json()).user.id;
 const original=e.rows('auth_sessions').find(row=>row.user_id===owner);
 let proof=await e.call('session','GET',{cookie:a,headers:{'X-Lantern-Session-Proof':'2'}});
 assert.equal(proof.status,200);const body=await proof.json();assert.equal(body.user.id,owner);assert(body.session.remainingMs>0&&body.session.remainingMs<=shortSeconds*1000);assert.equal(proof.headers.get('set-cookie'),null);
 assert.deepEqual(e.rows('auth_sessions').find(row=>row.user_id===owner),original,'reading never extends absolute session');
  const afterThirteenHours=Date.now()-13*60*60*1000;
  e.sqlite.prepare('UPDATE auth_sessions SET created_at=?,expires_at=? WHERE token_hash=?').run(afterThirteenHours,afterThirteenHours+longSeconds*1000,original.token_hash);
  proof=await e.call('session','GET',{cookie:a,headers:{'X-Lantern-Session-Proof':'2'}});
  assert.equal(proof.status,200,'a long session survives more than 12 hours offline');assert((await proof.json()).session.remainingMs<=shortSeconds*1000);
 // Existing 12h sessions keep their own expiration when the feature flips on.
 const old=e.rows('auth_sessions').find(row=>row.token_hash!==original.token_hash);assert.equal(old.expires_at-old.created_at,shortSeconds*1000);
 r=await e.call('login','POST',{body:{username:'policy_new',password},headers:hint});assert.equal(r.status,200);const b=checkStored(e,r,longSeconds);
 assert.notEqual(a,b);assert.equal((await e.call('session','GET',{cookie:a})).status,200);
 assert.equal((await e.call('logout','POST',{cookie:a})).status,200);assert.equal((await e.call('session','GET',{cookie:a})).status,401);assert.equal((await e.call('session','GET',{cookie:b})).status,200,'logout revokes only presented session');
 e.env[FLAG]='false';
 const bHash=createHash('sha256').update(b.split('=')[1]).digest('hex');
 e.sqlite.prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=?').run(Date.now()+300000,bHash);
 proof=await e.call('session','GET',{cookie:b,headers:{'X-Lantern-Session-Proof':'2'}});
 assert.equal(proof.status,200,'turning off new issuance does not revoke an existing session');
 assert((await proof.json()).session.remainingMs<=300000,'proof must not outlive actual expiry');
 e.sqlite.prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=?').run(Date.now()-1,createHash('sha256').update(b.split('=')[1]).digest('hex'));
 proof=await e.call('session','GET',{cookie:b,headers:{'X-Lantern-Session-Proof':'2'}});assert.equal(proof.status,401);
});
test('candidate phone registration issues exactly the negotiated cookie and database TTL',async t=>{
 const e=environment({env:{[FLAG]:'true'}});t.after(()=>e.close());
 const {createSqliteD1Core}=await import('../server/cloud-candidate/sqlite-d1-core.candidate.mjs');
 e.env.DB=createSqliteD1Core({enabled:true,database:e.sqlite});
 const audience=ORIGIN+'/phone',issuer=e.load('tests/helpers/test-phone-challenge-provider.ts').createTestPhoneChallengeProvider();
 const service=e.load('server/cloud-candidate/phone-registration-flow.candidate.ts').createPhoneFlowService({provider:issuer.provider,providerId:'synthetic-only',audience,allowPhoneRegistration:true});
 const phone='+8613800000103';
 const request=(kind,body)=>new Request(ORIGIN+'/api/auth/phone/'+kind,{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json',[HEADER]:'persistent-v1'},body:JSON.stringify(body)});
 const challenged=await service(request('challenge',{phone,purpose:'login'}),'challenge',e.env);assert.equal(challenged.status,202,await challenged.clone().text());
 const challenge=await challenged.json(),generated=issuer.read(challenge.challengeId);assert.ok(generated);
 const result=await service(request('login',{phone,challengeId:challenge.challengeId,code:generated.code}),'login',e.env);
 assert.equal(result.status,200,await result.clone().text());const cookie=checkStored(e,result,longSeconds);assert.equal((await e.call('session','GET',{cookie})).status,200);
});
test('Huawei and phone login use the same negotiated expiration for database and cookie',async t=>{
 const clientId='6917620597803523113',e=environment({env:{[FLAG]:'true',LANTERN_HUAWEI_CLIENT_ID:clientId,LANTERN_HUAWEI_CLIENT_SECRET:'synthetic-only'}});t.after(()=>e.close());
 const action=e.load('lib/huawei-auth-service.ts').createHuaweiAuthService({fetch:async url=>new Response(JSON.stringify(url.endsWith('/token')?{token_type:'Bearer',access_token:'synthetic-token',expires_in:3600}:{client_id:clientId,type:0,expire_in:3600,open_id:'synthetic-subject'}),{headers:{'Content-Type':'application/json'}})});
 const request=new Request(ORIGIN+'/api/auth/huawei/login',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json',[HEADER]:'persistent-v1'},body:JSON.stringify({code:'synthetic-code'})});
 let r=await action(request,'login',e.env);assert.equal(r.status,200);const huawei=checkStored(e,r,longSeconds);assert.equal((await e.call('session','GET',{cookie:huawei})).status,200);
 const user=await e.register('policy_phone',password),phone='+8613800000101',audience=ORIGIN+'/phone';
 e.sqlite.prepare('INSERT INTO auth_phone_bindings(phone,user_id,created_at) VALUES(?,?,?)').run(phone,user.id,Date.now());
 const provider={async verify(_value,expected){return {...expected,proofId:randomBytes(32).toString('hex'),issuedAt:Date.now(),expiresAt:Date.now()+60000};}};
 const phoneAction=e.load('lib/phone-auth-service.ts').createPhoneAuthService({provider,providerId:'synthetic-only',audience});
 const phoneRequest=new Request(ORIGIN+'/api/auth/phone/login',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json',[HEADER]:'persistent-v1'},body:JSON.stringify({phone,opaqueCredential:'synthetic-proof'})});
 r=await phoneAction(phoneRequest,'login',e.env);assert.equal(r.status,200);const phoneCookie=checkStored(e,r,longSeconds);assert.equal((await r.json()).user.id,user.id);assert.equal((await e.call('session','GET',{cookie:phoneCookie})).status,200);
});
