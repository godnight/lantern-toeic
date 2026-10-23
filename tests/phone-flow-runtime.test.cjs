"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const site=fs.realpathSync(process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..'));
const productOnly=process.env.LANTERN_PHONE_FLOW_PRODUCT_ONLY!=='0',candidate=productOnly?site:path.resolve(__dirname,'..');
const pinsOut=path.resolve(process.env.LANTERN_PHONE_FLOW_PINS||path.join(os.tmpdir(),'phone-flow-'+crypto.randomUUID()+'.json'));
assert(!pinsOut.toLowerCase().startsWith(site.toLowerCase()+path.sep),'Pins output must stay outside product');
const {createPhoneFlowHarness}=require('./helpers/phone-flow-harness.cjs');
test('actual local workerd D1 SMS challenge/send/verify and stable account transaction boundary',{timeout:120000},async t=>{
 const {mf,db,sourcePins,origin}=await createPhoneFlowHarness({site,candidate,productOnly,pinsOut});t.after(async()=>{await mf.dispose();t.diagnostic('Local synthetic phone-flow workerd disposed; cleanup awaited');});
 const send=(route,body,cookie,headers={})=>mf.dispatchFetch(origin+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const config=async value=>assert.equal((await send('/__test/config',value)).status,200);
 const issue=async id=>(await (await send('/__test/issuer',{id})).json());
 const otp=async row=>(await issue(row.challengeId)).credential.code;
 const cookie=r=>{const c=r.headers.get('set-cookie');assert.match(c||'',/^__Host-lantern-session=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);return c.split(';')[0]};
 const register=async username=>{const r=await send('/register',{username,password:'Synthetic phone flow existing account phrase 2026!'});assert.equal(r.status,200,await r.clone().text());return {...(await r.json()).user,cookie:cookie(r)}};
 let serial=100;const number=()=>'+861'+String(serial++).padStart(10,'0');
 const challenge=async(purpose,phone,cookieValue)=>{const r=await send('/__test/phone/challenge',{purpose,phone},cookieValue);assert.equal(r.status,202,await r.clone().text());return r.json()};
 const verify=(row,code,cookieValue,extra={})=>send('/__test/phone/'+row.purpose,{challengeId:row.challengeId,phone:row.phone,code,...extra},cookieValue);
 const resetLimits=()=>db.batch(['DELETE FROM auth_phone_flow_buckets','DELETE FROM auth_phone_flow_cooldowns'].map(s=>db.prepare(s)));
 const allowResend=()=>db.prepare('UPDATE auth_phone_flow_cooldowns SET resend_at=0').run();
 const query=async(table)=> (await db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results;
 const identityState=async()=>({users:await query('auth_users'),sessions:await query('auth_sessions'),bindings:await query('auth_phone_bindings'),proofs:await query('auth_phone_proofs')});
 let a,b,aPhone,aCookie;const checkin=crypto.randomUUID();
 await t.test('production status false and all mutations503 despite caller/env fake flags, no DB writes/provider calls',async()=>{
  const before=await identityState();const status=await send('/api/auth/phone/status');assert.equal(status.status,200);assert.deepEqual(await status.json(),{capabilities:{phoneLogin:false,phoneBinding:false}});
  for(const action of ['challenge','bind','login']){const r=await send('/api/auth/phone/'+action,{phone:number(),purpose:'login',code:'123456',fake:true,provider:'fake'},undefined,{'x-phone-provider':'fake'});assert.equal(r.status,503);const body=await r.json();assert.equal(body.code,'phone-unavailable');assert.equal(body.capabilities.phoneLogin,false);assert.equal(body.capabilities.phoneBinding,false);assert(!r.headers.has('set-cookie'));}
  assert.deepEqual(await identityState(),before);assert.deepEqual(await query('auth_phone_challenges'),[]);assert.equal((await issue('')).stats.sendCalls,0);
 });
 await t.test('strict requests/origin and bind identity reject before provider/admission',async()=>{
  const before=await query('auth_phone_flow_buckets');
  for(const body of [{purpose:'recover',phone:number()},{purpose:'bind',phone:'１２３'},{purpose:'login',phone:number(),fake:true}])assert.equal((await send('/__test/phone/challenge',body)).status,400);
  assert.equal((await send('/__test/phone/challenge',{purpose:'login',phone:number()},undefined,{Origin:'https://evil.test'})).status,403);
  assert.equal((await send('/__test/phone/challenge',{purpose:'bind',phone:number()},undefined,{'x-oai-user-id':'usr_fake'})).status,401);
  assert.deepEqual(await query('auth_phone_flow_buckets'),before);assert.equal((await issue('')).stats.sendCalls,0);
 });
 await t.test('real password users and current Study API establish A private data, retain guest/B isolation',async()=>{
  a=await register('flow_alice');b=await register('flow_bob');aCookie=a.cookie;aPhone=number();
  const profile={name:'Synthetic phone flow A',lrGoal:650,speakingGoal:0,examDate:'',dailyMinutes:25,timezone:'Etc/UTC',theme:'paper',weeklyTarget:4,onboarded:true};
  await db.prepare('INSERT INTO profiles(user_id,body,updated_at) VALUES(?,?,?)').bind('guest',JSON.stringify({...profile,name:'Guest stays'}),'2026-01-01T00:00:00.000Z').run();
  assert.equal((await send('/study',{type:'profile',data:profile},a.cookie,{'x-lantern-owner':a.id})).status,200);
  assert.equal((await send('/study',{type:'checkin',data:{id:checkin,date:'2026-01-01',minutes:5,load:'刚好',note:'Only A',createdAt:'2026-01-01T00:00:00.000Z'}},a.cookie,{'x-lantern-owner':a.id})).status,200);
 });
 await t.test('atomic concurrent send admits only one phone cooldown, returns public ISO context after provider receipt',async()=>{
  await resetLimits();const stats=(await issue('')).stats;
  const rs=await Promise.all([send('/__test/phone/challenge',{purpose:'bind',phone:aPhone},a.cookie),send('/__test/phone/challenge',{purpose:'bind',phone:aPhone},a.cookie)]);
  assert.deepEqual(rs.map(r=>r.status).sort(),[202,429]);const row=await rs.find(r=>r.status===202).json();
  assert.deepEqual(Object.keys(row).sort(),['challengeId','expiresAt','phone','purpose','resendAt']);assert.match(row.challengeId,/^[A-Za-z0-9_-]{32}$/);assert.equal(new Date(row.expiresAt).toISOString(),row.expiresAt);assert(Date.parse(row.expiresAt)>Date.now());assert(Date.parse(row.resendAt)<=Date.parse(row.expiresAt));
  assert.equal((await issue('')).stats.sendCalls,stats.sendCalls+1);assert.equal((await query('auth_phone_flow_buckets')).reduce((n,r)=>n+r.count,0),2);
  const before=await identityState();const r=await verify(row,await otp(row),a.cookie);assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).user.id,a.id);assert(!r.headers.has('set-cookie'));
  assert.equal((await query('auth_phone_challenges')).find(c=>c.challenge_id===row.challengeId).state,'consumed');assert.equal((await query('auth_phone_proofs')).length,before.proofs.length+1);assert.deepEqual((await identityState()).sessions,before.sessions);
  const after=await identityState();assert.equal((await verify(row,await otp(row),a.cookie)).status,409);assert.deepEqual(await identityState(),after);
 });
 await t.test('phone login rotates existing sessions but preserves same usr and A Study, never claims guest',async()=>{
  await resetLimits();const row=await challenge('login',aPhone);const r=await verify(row,await otp(row),b.cookie);assert.equal(r.status,200,await r.clone().text());aCookie=cookie(r);assert.equal((await r.json()).user.id,a.id);
  assert.equal((await send('/session',undefined,a.cookie)).status,401);assert.equal((await send('/session',undefined,b.cookie)).status,401);
  const own=await(await send('/study',undefined,aCookie)).json();assert.equal(own.owner,a.id);assert.equal(own.profile.name,'Synthetic phone flow A');assert.deepEqual(own.checkins.map(c=>c.id),[checkin]);
  const rB=await send('/password-login',{username:'flow_bob',password:'Synthetic phone flow existing account phrase 2026!'});b.cookie=cookie(rB);const other=await(await send('/study',undefined,b.cookie,{'x-oai-user-id':a.id})).json();assert.equal(other.owner,b.id);assert.equal(other.hasProfile,false);assert.deepEqual(other.checkins,[]);assert.equal((await query('auth_users')).length,2);assert.equal(JSON.parse((await db.prepare("SELECT body FROM profiles WHERE user_id='guest'").first()).body).name,'Guest stays');
 });
 await t.test('wrong code bounded at five; bad ASCII/context cannot invoke provider or debit another attempt',async()=>{
  await resetLimits();const row=await challenge('login',aPhone),right=await otp(row),wrong=right==='999999'?'888888':'999999';const start=(await issue('')).stats.verifyCalls;
  for(const extra of [{code:'１２３４５６'},{code:'12345'},{phone:number()},{owner:a.id}])assert.equal((await verify(row,right,undefined,extra)).status,400);
  assert.equal((await issue('')).stats.verifyCalls,start);
  for(let n=0;n<5;n++){const r=await verify(row,wrong);assert.equal(r.status,400);assert.equal((await r.json()).attemptsRemaining,4-n);}
  const r=await verify(row,right);assert.equal(r.status,429);assert.equal((await r.json()).attemptsRemaining,0);assert.equal((await issue('')).stats.verifyCalls,start+5);
 });
 await t.test('SQL expiry, wrong-purpose and wrong-audience assertions never consume proof or select owner',async()=>{
  await resetLimits();const row=await challenge('login',aPhone);await db.prepare('UPDATE auth_phone_challenges SET expires_at=0 WHERE challenge_id=?').bind(row.challengeId).run();const start=(await issue('')).stats.verifyCalls;assert.equal((await verify(row,await otp(row))).status,410);assert.equal((await issue('')).stats.verifyCalls,start);
  for(const mode of ['wrong-purpose','wrong-audience']){await resetLimits();const r=await challenge('login',aPhone);const before=await identityState();await config({verify:mode});assert.equal((await verify(r,await otp(r))).status,400);assert.deepEqual(await identityState(),before);await config({});}
 });
 await t.test('provider send rejected or unknown never202, and budgets/cooldown are not released',async()=>{
  for(const mode of ['reject','unknown']){await resetLimits();await config({send:mode});const phone=number(),start=(await issue('')).stats.sendCalls;const r=await send('/__test/phone/challenge',{purpose:'login',phone});assert.equal(r.status,503);assert.equal((await r.json()).challengeId,undefined);assert.equal((await query('auth_phone_flow_buckets')).reduce((n,r)=>n+r.count,0),2);await config({});assert.equal((await send('/__test/phone/challenge',{purpose:'login',phone})).status,429);assert.equal((await issue('')).stats.sendCalls,start+1);}
 });
 await t.test('lost send reservation or sent ACK never fabricates202 or retries external sending',async()=>{
  for(const fault of ['reserve-ack','send-ack']){await resetLimits();await config({fault});const phone=number(),start=(await issue('')).stats.sendCalls;const r=await send('/__test/phone/challenge',{purpose:'login',phone});assert.equal(r.status,503);assert.equal((await r.json()).challengeId,undefined);assert.equal((await query('auth_phone_flow_buckets')).reduce((n,r)=>n+r.count,0),2);await config({});assert.equal((await send('/__test/phone/challenge',{purpose:'login',phone})).status,429);assert.equal((await issue('')).stats.sendCalls,start+(fault==='reserve-ack'?0:1));}
 });
 await t.test('verify in progress, concurrent success and replay yield one commit; late receipt cannot bypass state',async()=>{
  await resetLimits();const row=await challenge('login',aPhone),code=await otp(row),before=await identityState();await config({delayMs:150});const first=verify(row,code,aCookie);await new Promise(r=>setTimeout(r,30));const second=await verify(row,code,aCookie);assert.equal(second.status,503);const r=await first;assert.equal(r.status,200,await r.clone().text());aCookie=cookie(r);await config({});assert.equal((await verify(row,code,b.cookie)).status,409);assert.equal((await query('auth_phone_proofs')).length,before.proofs.length+1);assert.equal((await send('/session',undefined,aCookie)).status,200);
  await resetLimits();const late=await challenge('login',aPhone);await config({delayMs:150});const pending=verify(late,await otp(late),aCookie);await new Promise(r=>setTimeout(r,30));await db.prepare("UPDATE auth_phone_challenges SET state='unknown' WHERE challenge_id=?").bind(late.challengeId).run();const snapshot=await identityState();const refused=await pending;assert.equal(refused.status,503);assert(!refused.headers.has('set-cookie'));assert.deepEqual(await identityState(),snapshot);await config({});
 });
 await t.test('provider verify unknown quarantines challenge and consumes budget once without a fake session',async()=>{
  await resetLimits();const row=await challenge('login',aPhone);await config({verify:'unknown'});const before=await identityState(),start=(await issue('')).stats.verifyCalls;const r=await verify(row,await otp(row),aCookie);assert.equal(r.status,503);assert(!r.headers.has('set-cookie'));await config({});assert.equal((await verify(row,await otp(row),aCookie)).status,503);assert.equal((await issue('')).stats.verifyCalls,start+1);assert.deepEqual(await identityState(),before);
 });
 await t.test('hung and late-positive providers are aborted at deadline; budgets stay and late results cannot send success or mint sessions',{timeout:50000},async()=>{
  for(const mode of ['hung','late']){
   await resetLimits();await config({send:mode});const phone=number(),before=await identityState(),start=(await issue('')).stats.abortCount;
   const r=await send('/__test/phone/challenge',{purpose:'login',phone});assert.equal(r.status,503);assert.equal((await r.json()).code,'phone-state-unknown');assert.equal((await issue('')).stats.abortCount,start+1);
   await new Promise(resolve=>setTimeout(resolve,100));await config({});assert.equal((await send('/__test/phone/challenge',{purpose:'login',phone})).status,429);assert.deepEqual(await identityState(),before);assert.equal((await query('auth_phone_challenges')).filter(c=>c.phone===phone).at(-1).state,'unknown');
   await resetLimits();const row=await challenge('login',aPhone);await config({verify:mode});const snapshot=await identityState(),verifyStart=(await issue('')).stats.abortCount;
   const reply=await verify(row,await otp(row),aCookie);assert.equal(reply.status,503);assert(!reply.headers.has('set-cookie'));assert.equal((await issue('')).stats.abortCount,verifyStart+1);
   await new Promise(resolve=>setTimeout(resolve,100));await config({});assert.equal((await verify(row,await otp(row),aCookie)).status,503);assert.deepEqual(await identityState(),snapshot);assert.equal((await query('auth_phone_challenges')).find(c=>c.challenge_id===row.challengeId).state,'unknown');
  }
 });
 await t.test('proof/challenge consumption and session changes roll back together on SQL error or tail expiry',async()=>{
  for(const fault of ['proof-sql','proof-expiry']){await resetLimits();const row=await challenge('login',aPhone),before=await identityState();await config({fault});const r=await verify(row,await otp(row),aCookie);assert.equal(r.status,503);assert(!r.headers.has('set-cookie'));assert.deepEqual(await identityState(),before);const stored=(await query('auth_phone_challenges')).find(c=>c.challenge_id===row.challengeId);assert.equal(stored.consumption_ticket,null);assert.equal(stored.state,'unknown');assert.equal((await send('/session',undefined,aCookie)).status,200);await config({});}
 });
 await t.test('bind Cookie user and live session rechecked in real batch, B conflict never transfers phone',async()=>{
  await resetLimits();const row=await challenge('bind',aPhone,b.cookie),before=await identityState();const r=await verify(row,await otp(row),b.cookie);assert.equal(r.status,409);assert.deepEqual(await identityState(),before);assert.equal((await query('auth_phone_challenges')).find(c=>c.challenge_id===row.challengeId).consumption_ticket,null);
  await resetLimits();const other=await challenge('bind',number(),b.cookie);await config({fault:'proof-revoke'});const proofs=await query('auth_phone_proofs');assert.equal((await verify(other,await otp(other),b.cookie)).status,401);assert.deepEqual(await query('auth_phone_proofs'),proofs);await config({});
 });
 await t.test('lost commit ACK reconciles only current challenge/proof ticket; unreadable ACK never reports login success',async()=>{
  await resetLimits();let row=await challenge('login',aPhone);await config({fault:'proof-lost-ack'});let r=await verify(row,await otp(row),aCookie);assert.equal(r.status,200,await r.clone().text());aCookie=cookie(r);await config({});
  await resetLimits();row=await challenge('login',aPhone);await config({fault:'proof-unknown'});r=await verify(row,await otp(row),aCookie);assert.equal(r.status,503);assert(!r.headers.has('set-cookie'));assert.equal((await r.json()).user,undefined);assert.equal((await query('auth_phone_challenges')).find(c=>c.challenge_id===row.challengeId).state,'consumed');await config({});assert.equal((await send('/session',undefined,aCookie)).status,401);const recovered=await send('/password-login',{username:'flow_alice',password:'Synthetic phone flow existing account phrase 2026!'});assert.equal(recovered.status,200);aCookie=cookie(recovered);assert.equal((await recovered.json()).user.id,a.id);assert.equal((await(await send('/study',undefined,aCookie)).json()).profile.name,'Synthetic phone flow A');
 });
 await t.test('persistent per-phone send count survives cooldown reset and rejects fourth provider call',async()=>{
  await resetLimits();const phone=number(),start=(await issue('')).stats.sendCalls;
  for(let n=0;n<3;n++){await allowResend();await challenge('login',phone);}
  await allowResend();const r=await send('/__test/phone/challenge',{purpose:'login',phone});assert.equal(r.status,429);assert.equal(new Date((await r.json()).retryAt).toISOString().length,24);assert.equal((await issue('')).stats.sendCalls,start+3);
 });
 await t.test('global send admission is atomic at real SQL boundary and exhausted phone cannot debit another bucket',async()=>{
  await resetLimits();await challenge('login',number());const global=(await query('auth_phone_flow_buckets')).find(r=>r.scope.endsWith(':send:global'));await db.prepare('UPDATE auth_phone_flow_buckets SET count=29 WHERE scope=? AND window_start=?').bind(global.scope,global.window_start).run();const start=(await issue('')).stats.sendCalls;
  const responses=await Promise.all(Array.from({length:4},()=>send('/__test/phone/challenge',{purpose:'login',phone:number()})));assert.deepEqual(responses.map(r=>r.status).sort(),[202,429,429,429]);assert.equal((await issue('')).stats.sendCalls,start+1);assert.equal((await query('auth_phone_flow_buckets')).find(r=>r.scope===global.scope).count,30);
 });
 await t.test('per-phone verification count and global verify budget enforce atomic admission before provider',async()=>{
  await resetLimits();const phone=number();let last;
  for(let n=0;n<3;n++){await allowResend();const row=await challenge('login',phone),right=await otp(row),wrong=right==='999999'?'888888':'999999';if(n<2){for(let i=0;i<5;i++)assert.equal((await verify(row,wrong)).status,400);}else last=row;}
  const start=(await issue('')).stats.verifyCalls;assert.equal((await verify(last,await otp(last))).status,429);assert.equal((await issue('')).stats.verifyCalls,start);
  await resetLimits();const rows=[];for(let n=0;n<4;n++)rows.push(await challenge('login',number()));assert.equal((await verify(rows[0],'not-six')).status,400);await verify(rows[0],(await otp(rows[0]))==='999999'?'888888':'999999');
  const global=(await query('auth_phone_flow_buckets')).find(r=>r.scope.endsWith(':verify:global'));await db.prepare('UPDATE auth_phone_flow_buckets SET count=99 WHERE scope=? AND window_start=?').bind(global.scope,global.window_start).run();const count=(await issue('')).stats.verifyCalls;
  const rs=await Promise.all(rows.slice(1).map(async row=>verify(row,(await otp(row))==='999999'?'888888':'999999')));assert.deepEqual(rs.map(r=>r.status).sort(),[400,429,429]);assert.equal((await issue('')).stats.verifyCalls,count+1);assert.equal((await query('auth_phone_flow_buckets')).find(r=>r.scope===global.scope).count,100);
 });
 for(const p of sourcePins.values())assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p.path)).digest('hex'),p.sha256,'Source unchanged during actual runtime');
 if(productOnly)for(const p of sourcePins.values())assert(p.path.startsWith(site+path.sep),'Product-only loads actual product only');
 fs.writeFileSync(pinsOut,JSON.stringify({pins:[...sourcePins.values()],productOnly,realLocalWorkerdD1:true,syntheticOnly:true,remote:false,realProvider:false,realSms:false,device:false},null,2)+'\n');
 t.diagnostic('Runtime pins '+pinsOut+'; actual local workerd/D1, actual scrypt/session/Study API, random test-only SMS provider, no external network or real data.');
});
