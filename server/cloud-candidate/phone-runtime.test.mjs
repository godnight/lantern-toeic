import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {buildAccountWorker} from './build-inputs.mjs';
import {prepareProductionPhoneAssembly,createServerPnvsCaller} from './phone-runtime.candidate.mjs';

const origin='https://synthetic.invalid',here=path.dirname(fileURLToPath(import.meta.url));
const policy=()=>({enabled:true,origin,signature:'synthetic-sign',schemeName:'synthetic',templates:{login:'100001'},referenceKeyFile:'/synthetic/private/key',limits:{maxSendsPerUtcDay:4,maxSendsPerMinute:4,maxSendsPerPhoneHour:1,maxVerificationsPerPhoneTenMinutes:5}});
const options=(script,persist,extra={})=>({modules:true,script,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],cf:false,host:'127.0.0.1',port:0,d1Databases:['DB'],d1Persist:persist,bindings:{LANTERN_AUTH_ENABLED:'true',LANTERN_AUTH_ORIGIN:origin,...extra.bindings},serviceBindings:extra.serviceBindings,outboundService:()=>new Response(null,{status:403}),log:new Log(LogLevel.ERROR)});
const request=(mf,route,body,cookie)=>mf.dispatchFetch(origin+route,{method:body?'POST':'GET',headers:{...(body?{Origin:origin,'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
async function migrate(db){
 const names=['0000_spotty_stellaris.sql','0001_study_data_v2.sql','0002_parched_edwin_jarvis.sql','0003_cynical_snowbird.sql','0004_study_sync_index.sql','0005_product_auth.sql','0006_auth_admission_ticket.sql','0007_phone_auth.sql','0008_phone_challenges.sql','0009_huawei_auth.sql'];
 await db.prepare('CREATE TABLE _lantern_local_migrations(name TEXT PRIMARY KEY,sha TEXT NOT NULL)').run();
 for(const name of names){const sql=await readFile(new URL('../../drizzle/'+name,import.meta.url),'utf8');await db.batch([...sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)),db.prepare('INSERT INTO _lantern_local_migrations VALUES(?,?)').bind(name,createHash('sha256').update(sql).digest('hex'))]);}
 await db.prepare('CREATE TABLE _lantern_phone_policy(singleton INTEGER PRIMARY KEY,policy TEXT NOT NULL)').run();
 const p=policy().limits;await db.prepare('INSERT INTO _lantern_phone_policy VALUES(1,?)').bind(JSON.stringify([p.maxSendsPerUtcDay,p.maxSendsPerMinute,p.maxSendsPerPhoneHour,p.maxVerificationsPerPhoneTenMinutes])).run();
}

// Expose the non-exported builder only in a disposable synthetic test module.
// The actual production module keeps the low-level builder private.
async function testBuilder(){
 const dir=await mkdtemp(path.join(os.tmpdir(),'lantern-phone-builder-test-')),file=path.join(dir,'runtime.mjs');
 const source=await readFile(new URL('./phone-runtime.candidate.mjs',import.meta.url),'utf8');
 assert.equal((source.match(/async function preparePhoneRuntime\(/g)||[]).length,1);
 const localBase=pathToFileURL(here+path.sep).href;
 const mapped=source.replaceAll("from './",`from '${localBase}`).replace("const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');",`const here=${JSON.stringify(here)},root=path.resolve(here,'../..');`);
 assert.notEqual(mapped,source);
 try{await writeFile(file,mapped.replace('async function preparePhoneRuntime(','export async function preparePhoneRuntime('),{flag:'wx'});return (await import(pathToFileURL(file))).preparePhoneRuntime}
 finally{const target=await realpath(dir),tmp=await realpath(os.tmpdir());assert.equal(path.dirname(target).toLowerCase(),tmp.toLowerCase());assert(path.basename(target).startsWith('lantern-phone-builder-test-'));await rm(target,{recursive:true,force:true})}
}

test('production preflight is default closed and rejects missing DB and mismatched budget before credentials',async t=>{
 assert.deepEqual(await prepareProductionPhoneAssembly(),{enabled:false});
 let calls=0;const credentials=async()=>{calls++;throw Error('must not be called')},pnvsFetch=async()=>{calls++;throw Error('must not be called')};
 await assert.rejects(prepareProductionPhoneAssembly({policy:policy(),accountOrigin:origin,getCredentials:credentials,pnvsFetch}),/database unavailable/);
 const base=await buildAccountWorker(),mf=new Miniflare(options(base.bytes.toString(),false));t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 await assert.rejects(prepareProductionPhoneAssembly({policy:policy(),accountOrigin:origin,getCredentials:credentials,pnvsFetch,mf}));
 await migrate(db);
 await assert.rejects(prepareProductionPhoneAssembly({policy:policy(),accountOrigin:origin,getCredentials:credentials,pnvsFetch,mf}));
 await db.prepare("UPDATE _lantern_local_migrations SET sha=? WHERE name='0008_phone_challenges.sql'").bind('0'.repeat(64)).run();
 await assert.rejects(prepareProductionPhoneAssembly({policy:policy(),accountOrigin:origin,getCredentials:credentials,pnvsFetch,mf}),/ledger mismatch/);
 const sql=await readFile(new URL('../../drizzle/0008_phone_challenges.sql',import.meta.url));await db.prepare("UPDATE _lantern_local_migrations SET sha=? WHERE name='0008_phone_challenges.sql'").bind(createHash('sha256').update(sql).digest('hex')).run();
 await db.prepare('UPDATE _lantern_phone_policy SET policy=?').bind('{}').run();
 await assert.rejects(prepareProductionPhoneAssembly({policy:policy(),accountOrigin:origin,getCredentials:credentials,pnvsFetch,mf}),/budget policy mismatch/);
 assert.equal(calls,0);
});

test('synthetic PNVS provider registers, persists owner and enforces budget after restart',{timeout:60000},async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'lantern-phone-runtime-'));let mf;
 t.after(async()=>{if(mf)await mf.dispose();const d=await realpath(dir),tmp=await realpath(os.tmpdir());assert.equal(path.dirname(d).toLowerCase(),tmp.toLowerCase());assert(path.basename(d).startsWith('lantern-phone-runtime-'));await rm(d,{recursive:true,force:true})});
 const base=await buildAccountWorker();mf=new Miniflare(options(base.bytes.toString(),dir));let db=await mf.getD1Database('DB');await migrate(db);
 const closed=await request(mf,'/api/auth/phone/status');assert.equal((await closed.json()).capabilities.phoneLogin,false);
 await mf.dispose();mf=undefined;
 let calls=0,mode='ok';const fakeFetch=async(url,init)=>{
  calls++;assert.equal(url,'https://dypnsapi.aliyuncs.com/');assert.equal(init.redirect,'manual');const fields=new URLSearchParams(Buffer.from(init.body).toString());
  if(mode==='unknown')throw Error('synthetic lost acknowledgement');
  if(init.headers['x-acs-action']==='SendSmsVerifyCode')return Response.json({Code:'OK',Success:true,Model:{OutId:fields.get('OutId')}});
  return Response.json({Code:'OK',Success:true,Model:{OutId:fields.get('OutId'),VerifyResult:fields.get('VerifyCode')==='619274'?'PASS':'UNKNOWN'}});
 };
 const caller=await createServerPnvsCaller({enabled:true,getCredentials:async()=>({accessKeyId:'synthetic-id',accessKeySecret:'synthetic-secret',securityToken:'synthetic-token',expiration:Date.now()+600000}),pnvsFetch:fakeFetch});
 const runtime=await (await testBuilder())({policy:policy(),referenceKey:randomBytes(32),pnvsCall:caller});
 mf=new Miniflare(options(runtime.script,dir,runtime));db=await mf.getD1Database('DB');
 const phone='+8613800000891',send=()=>request(mf,'/api/auth/phone/challenge',{phone,purpose:'login'});
 let response=await send();assert.equal(response.status,202,await response.clone().text());const challenge=await response.json();
 assert.equal((await send()).status,429);assert.equal(calls,1);
 response=await request(mf,'/api/auth/phone/login',{phone,challengeId:challenge.challengeId,code:'619274'});assert.equal(response.status,200,await response.clone().text());const owner=(await response.json()).user.id,cookie=response.headers.get('set-cookie').split(';')[0];
 const before=(await db.prepare("SELECT count FROM auth_phone_flow_buckets WHERE scope LIKE '%:send:global-day'").first()).count;assert.equal(before,1);
 await mf.dispose();mf=new Miniflare(options(runtime.script,dir,runtime));db=await mf.getD1Database('DB');
 response=await request(mf,'/api/auth/session',undefined,cookie);assert.equal(response.status,200);assert.equal((await response.json()).user.id,owner);
 assert.equal((await db.prepare("SELECT count FROM auth_phone_flow_buckets WHERE scope LIKE '%:send:global-day'").first()).count,1);
 // Advance only the synthetic per-phone window; global daily budget is intact.
 await db.prepare('UPDATE auth_phone_flow_cooldowns SET resend_at=0').run();await db.prepare("DELETE FROM auth_phone_flow_buckets WHERE scope LIKE '%:send:phone:%'").run();
 response=await send();assert.equal(response.status,202);const repeat=await response.json();
 response=await request(mf,'/api/auth/phone/login',{phone,challengeId:repeat.challengeId,code:'619274'});assert.equal(response.status,200);assert.equal((await response.json()).user.id,owner);
 assert.equal((await request(mf,'/api/auth/session',undefined,cookie)).status,200);
 mode='unknown';response=await request(mf,'/api/auth/phone/challenge',{phone:'+8613800000892',purpose:'login'});assert.equal(response.status,503);assert.equal((await response.json()).code,'phone-state-unknown');
 const sent=calls;await db.prepare('UPDATE auth_phone_flow_cooldowns SET resend_at=0').run();response=await request(mf,'/api/auth/phone/challenge',{phone:'+8613800000892',purpose:'login'});assert.notEqual(response.status,202);assert.equal(calls,sent);
 mode='ok';response=await request(mf,'/api/auth/phone/challenge',{phone:'+8613800000893',purpose:'login'});assert.equal(response.status,202);const total=calls;
 response=await request(mf,'/api/auth/phone/challenge',{phone:'+8613800000894',purpose:'login'});assert.equal(response.status,429);assert.equal(calls,total);
 await db.prepare('DROP INDEX auth_phone_proofs_expiry').run();
 response=await request(mf,'/api/auth/phone/status');assert.equal((await response.json()).capabilities.phoneLogin,false);
 response=await request(mf,'/api/auth/phone/challenge',{phone:'+8613800000895',purpose:'login'});assert.equal(response.status,503);assert.equal(calls,total);
});
