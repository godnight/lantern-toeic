'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const site=fs.realpathSync(process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..'));
const fixtureRoot=path.resolve(__dirname,'..');
const productOnly=process.env.LANTERN_PHONE_D1_PRODUCT_ONLY!=='0';
const candidate=productOnly?site:fixtureRoot;
const pinOutput=path.resolve(process.env.LANTERN_PHONE_D1_PINS||path.join(os.tmpdir(),'lantern-phone-d1-pins-'+crypto.randomUUID()+'.json'));
assert.equal(pinOutput.toLowerCase().startsWith(site.toLowerCase()+path.sep),false,'Runtime pin output must stay outside the product site');
const {build}=require(path.join(site,'node_modules/esbuild'));
const {Miniflare,Log,LogLevel}=require(path.join(site,'node_modules/miniflare'));
const origin='https://study.test',audience=origin+'/phone-verification-test';
const PHONE_A='+8610000000001',PHONE_B='+8610000000002';
const password='Synthetic phone D1 existing account phrase 2026!';
const sourcePins=new Map();

function resolveModule(root,relative){
 for(const suffix of ['', '.ts','.tsx','.json','/index.ts']){
  const file=path.resolve(root,relative+suffix);
  if(!file.startsWith(root+path.sep))continue;
  if(fs.existsSync(file)&&fs.statSync(file).isFile())return file;
 }
}
const wiring={name:'reviewed-phone-overlay-with-real-account-source',setup(builder){
 builder.onResolve({filter:/^next\/headers$/},()=>({path:'next/headers',namespace:'no-ambient-identity'}));
 builder.onLoad({filter:/.*/,namespace:'no-ambient-identity'},()=>({contents:'export function headers(){throw new Error("Actual request identity is required")}'}));
 builder.onResolve({filter:/^(?:@\/|\.)/},args=>{
  if(args.importer&&!args.importer.startsWith(site+path.sep)&&!args.importer.startsWith(candidate+path.sep))return;
  if(args.importer?.includes(path.sep+'node_modules'+path.sep))return;
  const base=args.importer?.startsWith(candidate+path.sep)?candidate:site;
  const relative=args.path.startsWith('@/')?args.path.slice(2):path.relative(base,path.resolve(args.importer?path.dirname(args.importer):site,args.path));
  const file=productOnly?resolveModule(site,relative):resolveModule(candidate,relative)||resolveModule(site,relative);
  if(!file)throw new Error('Resolve reviewed source '+relative);
  return {path:file};
 });
}};

const worker=`
import {credentialAction,sessionAction,productSessionTokenHash} from './lib/auth-service';
import {createPhoneAuthService} from './lib/phone-auth-service';
import {POST as productionBind} from './app/api/auth/phone/bind/route';
import {POST as productionLogin} from './app/api/auth/phone/login/route';
import {POST as studyPost,GET as studyGet} from './app/api/study/route';
import {createTestPhoneIssuer} from './tests/helpers/test-phone-issuer';
const issuer=createTestPhoneIssuer();let fault=null,lastFault=null,lastError=null,batchCalls=0,readsUnavailable=false;
const provider={async verify(token,expected){const value=await issuer.provider.verify(token,expected);return value&&fault==='expiry'?{...value,issuedAt:Date.now(),expiresAt:Date.now()+25}:value;}};
const action=createPhoneAuthService({provider,providerId:'synthetic-test-only',audience:${JSON.stringify(audience)}});
function requestEnvironment(request,env){return {...env,DB:{prepare:sql=>{if(readsUnavailable)throw new Error('Synthetic reconciliation read unavailable');return env.DB.prepare(sql);},async batch(statements){
 batchCalls++;const selected=fault;fault=null;if(selected)lastFault=selected;
 if(selected==='expiry')await new Promise(resolve=>setTimeout(resolve,100));
 if(selected==='revoke-bind')await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(productSessionTokenHash(request.headers)).run();
 if(selected==='sql-fail')return env.DB.batch([...statements.slice(0,2),env.DB.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(NULL,NULL,0,0)'),...statements.slice(2)]);
 if(selected==='expire-own-claim')return env.DB.batch([statements[0],env.DB.prepare("UPDATE auth_phone_proofs SET expires_at=(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))-6000 WHERE rowid=(SELECT MAX(rowid) FROM auth_phone_proofs)"),...statements.slice(1)]);
 if(selected==='delete-own-claim-after-writes')return env.DB.batch([...statements.slice(0,-2),env.DB.prepare('DELETE FROM auth_phone_proofs WHERE rowid=(SELECT MAX(rowid) FROM auth_phone_proofs)'),...statements.slice(-2)]);
 try{const result=await env.DB.batch(statements);if(selected==='lost-ack-unreadable'){readsUnavailable=true;throw new Error('Synthetic lost commit acknowledgement and reads');}if(selected==='lost-ack')throw new Error('Synthetic lost commit acknowledgement');return result;}catch(error){lastError=String(error.message);throw error;}
 }}};}
export default {async fetch(request,env){
 const route=new URL(request.url).pathname;
 if(route==='/__test/issue'){return Response.json({opaqueCredential:issuer.issue(await request.json())});}
 if(route==='/__test/fault'){fault=(await request.json()).fault;readsUnavailable=false;return Response.json({ok:true});}
 if(route==='/__test/stats')return Response.json({lastFault,lastError,batchCalls});
 if(route==='/register')return credentialAction(request,'register',env);
 if(route==='/password-login')return credentialAction(request,'login',env);
 if(route==='/session')return sessionAction(request,'read',env);
 if(route==='/study')return request.method==='POST'?studyPost(request):studyGet(request);
 if(route==='/api/auth/phone/bind')return productionBind(request);
 if(route==='/api/auth/phone/login')return productionLogin(request);
 if(route==='/__test/phone/bind'||route==='/__test/phone/login')return action(request,route.endsWith('/bind')?'bind':'login',requestEnvironment(request,env));
 return new Response('not found',{status:404});
}};`;

test('real local workerd D1 phone proof/binding/session transactions preserve stable users and private Study data',{timeout:120000},async t=>{
 const built=await build({stdin:{contents:worker,resolveDir:site,sourcefile:'phone-d1-test-worker.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['node:*','cloudflare:workers'],nodePaths:[path.join(site,'node_modules')],plugins:[wiring],metafile:true});
 for(const input of Object.keys(built.metafile.inputs)){
  if(input.startsWith('<')||input.startsWith('no-ambient-identity:'))continue;
  const file=path.isAbsolute(input)?input:path.resolve(input);
  if(!fs.existsSync(file)||file.includes(path.sep+'node_modules'+path.sep))continue;
  const raw=fs.readFileSync(file);sourcePins.set(file,{path:file,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')});
 }
 const mf=new Miniflare({name:'phone-d1-synthetic-only',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],cf:false,host:'127.0.0.1',port:0,d1Databases:{DB:'phone-d1-synthetic-only'},d1Persist:false,cachePersist:false,kvPersist:false,r2Persist:false,durableObjectsPersist:false,bindings:{LANTERN_AUTH_ENABLED:'true',LANTERN_AUTH_ORIGIN:origin,LANTERN_PHONE_FAKE:'true'},log:new Log(LogLevel.ERROR),outboundService:()=>new Response('External network denied',{status:502})});
 t.after(async()=>{await mf.dispose();t.diagnostic('Local synthetic workerd D1 disposed; cleanup awaited');});
 const db=await mf.getD1Database('DB');
 const migrationFiles=fs.readdirSync(path.join(site,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort().map(name=>path.join(site,'drizzle',name));
 if(productOnly){assert.equal(migrationFiles.length,9,'Final product has exactly the nine approved migrations');assert.equal(migrationFiles.some(file=>path.basename(file)==='0007_phone_auth.sql'),true,'Final product owns the actual phone proof migration');assert.equal(migrationFiles.some(file=>path.basename(file)==='0008_phone_challenges.sql'),true,'Final product owns the actual phone challenge migration');}
 else{assert.equal(migrationFiles.some(file=>path.basename(file).startsWith('0007_')),false,'0007 must still be unoccupied in the source site');migrationFiles.push(path.join(candidate,'drizzle/0007_phone_auth.sql'));}
 for(const file of migrationFiles){const raw=fs.readFileSync(file);sourcePins.set(file,{path:file,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')});const statements=raw.toString('utf8').split('--> statement-breakpoint').map(value=>value.trim()).filter(Boolean);await db.batch(statements.map(sql=>db.prepare(sql)));}
 // Miniflare dispatchFetch accepts one init object, unlike Node Request. Keep
 // JSON encoding in this adapter, never substitute a product auth result.
 const send=(route,body,cookie,headers={})=>mf.dispatchFetch(origin+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const cookie=response=>{const value=response.headers.get('set-cookie');assert.match(value||'',/^__Host-lantern-session=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);return value.split(';')[0];};
 const register=async username=>{const response=await send('/register',{username,password});assert.equal(response.status,200,await response.clone().text());return {...(await response.json()).user,cookie:cookie(response)};};
 const issue=async(purpose,userId,extra={})=>{const response=await send('/__test/issue',{purpose,audience,phone:PHONE_A,bindingUserId:purpose==='bind'?userId:null,...extra});assert.equal(response.status,200);return (await response.json()).opaqueCredential;};
 const phone=(purpose,opaqueCredential,cookieValue,extra={})=>send('/__test/phone/'+purpose,{phone:PHONE_A,opaqueCredential,...extra},cookieValue);
 const state=async()=>{const result={};for(const table of ['auth_users','auth_phone_bindings','auth_phone_proofs','auth_sessions'])result[table]=(await db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results;return result;};
 const configure=async fault=>assert.equal((await send('/__test/fault',{fault})).status,200);
 let alice,bob,phoneCookie;
 const checkinId=crypto.randomUUID();

 await t.test('production factory is closed despite env/request fake flags, with zero database changes',async()=>{
  const before=await state();
  for(const purpose of ['bind','login']){
   const response=await send('/api/auth/phone/'+purpose,{phone:PHONE_A,opaqueCredential:'not-a-real-assertion',fake:true,provider:'fake'},undefined,{'x-phone-provider':'fake'});
   assert.equal(response.status,503);assert.equal((await response.json()).capabilities.phoneLogin,false);assert.equal(response.headers.has('set-cookie'),false);
  }
  assert.deepEqual(await state(),before);
 });
 await t.test('real password registration and current Study API establish A data without claiming guest',async()=>{
  alice=await register('phone_alice');bob=await register('phone_bob');
  const profile={name:'Synthetic A private profile',lrGoal:650,speakingGoal:0,examDate:'',dailyMinutes:25,timezone:'Etc/UTC',theme:'paper',weeklyTarget:4,onboarded:true};
  await db.prepare('INSERT INTO profiles(user_id,body,updated_at) VALUES(?,?,?)').bind('guest',JSON.stringify({...profile,name:'Synthetic retained guest'}),'2026-01-01T00:00:00.000Z').run();
  assert.equal((await send('/study',{type:'profile',data:profile},alice.cookie,{'x-lantern-owner':alice.id})).status,200);
  assert.equal((await send('/study',{type:'checkin',data:{id:checkinId,date:'2026-01-01',minutes:5,load:'刚好',note:'Synthetic A only',createdAt:'2026-01-01T00:00:00.000Z'}},alice.cookie,{'x-lantern-owner':alice.id})).status,200);
  const own=await (await send('/study',undefined,alice.cookie)).json();assert.equal(own.owner,alice.id);assert.equal(own.profile.name,profile.name);assert.deepEqual(own.checkins.map(row=>row.id),[checkinId]);
  const other=await (await send('/study',undefined,bob.cookie,{'x-oai-user-id':alice.id})).json();assert.equal(other.owner,bob.id);assert.equal(other.hasProfile,false);assert.deepEqual(other.checkins,[]);
 });
 await t.test('verified bind uses the live Cookie user and does not create another identity/session',async()=>{
  const before=await state();const token=await issue('bind',alice.id);const response=await phone('bind',token,alice.cookie);
  assert.equal(response.status,200,(await response.clone().text())+' '+(await (await send('/__test/stats')).text()));const body=await response.json();assert.equal(body.user.id,alice.id);assert.equal(body.capabilities.phoneLogin,false);assert.equal(response.headers.has('set-cookie'),false);
  const after=await state();assert.equal(after.auth_users.length,2);assert.deepEqual(after.auth_sessions,before.auth_sessions);assert.equal(after.auth_phone_bindings.length,1);assert.equal(after.auth_phone_bindings[0].user_id,alice.id);assert.equal(after.auth_phone_proofs.length,1);
  assert.equal((await phone('bind',token,alice.cookie)).status,409);
 });
 await t.test('B conflict and A second-number conflict roll back proof claims and retain old sessions',async()=>{
  const before=await state();
  assert.equal((await phone('bind',await issue('bind',bob.id),bob.cookie)).status,409);
  assert.deepEqual(await state(),before);
  assert.equal((await phone('bind',await issue('bind',alice.id,{phone:PHONE_B}),alice.cookie,{phone:PHONE_B})).status,409);
  assert.deepEqual(await state(),before);
  assert.equal((await send('/session',undefined,alice.cookie)).status,200);assert.equal((await send('/session',undefined,bob.cookie)).status,200);
 });
 await t.test('wrong context, expiry, forged user fields and absent binding never consume proofs',async()=>{
  const before=await state();
  for(const changes of [{purpose:'login',bindingUserId:null},{audience:'wrong-audience'},{bindingUserId:bob.id},{expiresAt:Date.now()-1,issuedAt:Date.now()-60001},{phone:PHONE_B}]){
   assert.equal((await phone('bind',await issue('bind',alice.id,changes),alice.cookie)).status,400);
  }
  assert.equal((await phone('bind',await issue('bind',alice.id),alice.cookie,{bindingUserId:bob.id})).status,400);
  assert.equal((await phone('bind',await issue('bind',alice.id),undefined)).status,401);
  assert.equal((await phone('login',await issue('login',null,{phone:PHONE_B}),undefined,{phone:PHONE_B})).status,400);
  assert.deepEqual(await state(),before);
 });
 await t.test('phone login reuses A stable user/data and original session rotation policy; B remains isolated',async()=>{
  const response=await phone('login',await issue('login'),bob.cookie);assert.equal(response.status,200,await response.clone().text());phoneCookie=cookie(response);assert.equal((await response.json()).user.id,alice.id);
  assert.equal((await send('/session',undefined,alice.cookie)).status,401);assert.equal((await send('/session',undefined,bob.cookie)).status,401);
  const own=await (await send('/study',undefined,phoneCookie)).json();assert.equal(own.owner,alice.id);assert.equal(own.profile.name,'Synthetic A private profile');assert.deepEqual(own.checkins.map(row=>row.id),[checkinId]);
  const relog=await send('/password-login',{username:'phone_bob',password});assert.equal(relog.status,200);bob.cookie=cookie(relog);
  const other=await (await send('/study',undefined,bob.cookie,{'x-oai-user-id':alice.id})).json();assert.equal(other.owner,bob.id);assert.equal(other.hasProfile,false);assert.deepEqual(other.checkins,[]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM auth_users').first()).count,2);
  assert.equal(JSON.parse((await db.prepare("SELECT body FROM profiles WHERE user_id='guest'").first()).body).name,'Synthetic retained guest');
 });
 await t.test('concurrent proof reuse commits once; replay cannot revoke the winner or another browser session',async()=>{
  const token=await issue('login');const before=await state();const responses=await Promise.all([phone('login',token,phoneCookie),phone('login',token,phoneCookie)]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);phoneCookie=cookie(responses.find(response=>response.status===200));
  const after=await state();assert.equal(after.auth_phone_proofs.length,before.auth_phone_proofs.length+1);
  const again=await phone('login',token,bob.cookie);assert.equal(again.status,409);assert.equal(again.headers.has('set-cookie'),false);assert.deepEqual(await state(),after);
  assert.equal((await send('/session',undefined,phoneCookie)).status,200);assert.equal((await send('/session',undefined,bob.cookie)).status,200);
 });
 await t.test('real SQL failure after proof and session deletion rolls back every change and preserves old session',async()=>{
  const before=await state();await configure('sql-fail');const response=await phone('login',await issue('login'),phoneCookie);assert.equal(response.status,503);assert.equal(response.headers.has('set-cookie'),false);assert.deepEqual(await state(),before);
  assert.equal((await send('/session',undefined,phoneCookie)).status,200);
 });
 await t.test('SQL server clock rejects expiry between wrapper verification and transaction commit',async()=>{
  const before=await state();await configure('expiry');const response=await phone('login',await issue('login'),phoneCookie);assert.equal(response.status,400);assert.deepEqual(await state(),before);assert.equal((await (await send('/__test/stats')).json()).lastFault,'expiry');
 });
 await t.test('binding session is rechecked inside the real transaction after concurrent revocation',async()=>{
  const before=(await state()).auth_phone_proofs;await configure('revoke-bind');const response=await phone('bind',await issue('bind',bob.id,{phone:PHONE_B}),bob.cookie,{phone:PHONE_B});assert.equal(response.status,401);assert.deepEqual((await state()).auth_phone_proofs,before);assert.equal((await state()).auth_phone_bindings.length,1);
 });
 await t.test('lost commit acknowledgement is reconciled by this random ticket without retrying any writes',async()=>{
  const before=await state();await configure('lost-ack');const response=await phone('login',await issue('login'),phoneCookie);assert.equal(response.status,200,await response.clone().text());const previous=phoneCookie;phoneCookie=cookie(response);
  const after=await state();assert.equal(after.auth_phone_proofs.length,before.auth_phone_proofs.length+1);assert.equal(after.auth_users.length,2);assert.equal((await send('/session',undefined,previous)).status,401);assert.equal((await send('/session',undefined,phoneCookie)).status,200);
 });
 await t.test('unknown commit with failed reconciliation never fabricates success or claims the old session survived',async()=>{
  const before=await state();await configure('lost-ack-unreadable');
  const response=await phone('login',await issue('login'),phoneCookie);
  assert.equal(response.status,503);assert.equal(response.headers.has('set-cookie'),false);assert.equal((await response.json()).user,undefined);
  assert.equal((await state()).auth_phone_proofs.length,before.auth_phone_proofs.length+1,'Injected lost ACK occurred after the actual commit');
  assert.equal((await send('/session',undefined,phoneCookie)).status,401,'An unconfirmed transport result cannot promise preservation of the revoked old session');
  await configure(null);
  const recovery=await send('/password-login',{username:'phone_alice',password});assert.equal(recovery.status,200);phoneCookie=cookie(recovery);assert.equal((await recovery.json()).user.id,alice.id);
  assert.equal((await (await send('/study',undefined,phoneCookie)).json()).profile.name,'Synthetic A private profile');
 });
 await t.test('cleanup never removes its own expired claim and a missing tail claim forces actual rollback',async()=>{
  for(const fault of ['expire-own-claim','delete-own-claim-after-writes']){
   const before=await state();await configure(fault);
   const response=await phone('login',await issue('login'),phoneCookie);
   assert.equal(response.status,503);assert.equal(response.headers.has('set-cookie'),false);
   assert.deepEqual(await state(),before,fault+' must roll back claim, session revocation and fresh session together');
   assert.equal((await send('/session',undefined,phoneCookie)).status,200);
  }
 });
 for(const pin of sourcePins.values())assert.equal(crypto.createHash('sha256').update(fs.readFileSync(pin.path)).digest('hex'),pin.sha256,'Source stayed stable during runtime test: '+pin.path);
 if(productOnly)for(const pin of sourcePins.values())assert.equal(pin.path.startsWith(site+path.sep),true,'Product-only mode never loads a candidate overlay');
 fs.writeFileSync(pinOutput,JSON.stringify({pins:[...sourcePins.values()],scope:'Actual local test bundle inputs plus migrations; node_modules not copied',productOnly,syntheticOnly:true,realLocalWorkerdD1:true,online:false,realProvider:false,device:false},null,2)+'\n');
 t.diagnostic('Runtime source pins: '+pinOutput+'; productOnly='+productOnly);
 t.diagnostic('Real local workerd + D1, original scrypt/cookie/session policy, actual Study API, additive phone migration. Test-only random issuer and fault branches exist only in this ephemeral test Worker; production factory remains null. No real data, provider, SMS, TLS key, remote service, device or deployment.');
});
