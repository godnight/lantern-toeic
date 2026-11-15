import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Miniflare,Log,LogLevel} from 'miniflare';
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {buildAccountWorker} from './build-inputs.mjs';
import {prepareProductionPhoneAssembly,createServerPnvsCaller,verifyPhoneDatabase} from './phone-runtime.candidate.mjs';
import {openLockedD1,acquireD1Lock} from './d1-lock.candidate.mjs';
import {createSwitchableD1,prepareLockedCloudService} from './switchable-d1.candidate.mjs';

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

test('locked fixed HTTPS phone routing stays closed by default, registers and survives restart',{timeout:60000},async t=>{
 const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'lantern-phone-https-'))),d1=path.join(dir,'d1');let locked,server,seed;
 t.after(async()=>{if(server)await new Promise(r=>server.close(r));if(locked)await locked.close();if(seed)await seed.dispose();const d=await realpath(dir),tmp=await realpath(os.tmpdir());assert.equal(path.dirname(d).toLowerCase(),tmp.toLowerCase());assert(path.basename(d).startsWith('lantern-phone-https-'));await rm(d,{recursive:true,force:true})});
 const base=await buildAccountWorker();seed=new Miniflare(options(base.bytes.toString(),d1));await migrate(await seed.getD1Database('DB'));await seed.dispose();seed=undefined;
 const config=path.join(dir,'openssl.cnf'),keyPath=path.join(dir,'key.pem'),certPath=path.join(dir,'cert.pem');await writeFile(config,'[req]\ndistinguished_name=dn\n[dn]\n');
 const exe=process.platform==='win32'&&existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
 execFileSync(exe,['req','-config',config,'-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=synthetic.invalid','-addext','subjectAltName=DNS:synthetic.invalid'],{stdio:'ignore',timeout:15000});
 const material={key:await readFile(keyPath),cert:await readFile(certPath)};
 let sends=0;const caller=await createServerPnvsCaller({enabled:true,getCredentials:async()=>({accessKeyId:'synthetic-id',accessKeySecret:'synthetic-secret',securityToken:'synthetic-token',expiration:Date.now()+600000}),pnvsFetch:async(url,init)=>{
  const fields=new URLSearchParams(Buffer.from(init.body).toString());if(init.headers['x-acs-action']==='SendSmsVerifyCode'){sends++;return Response.json({Code:'OK',Success:true,Model:{OutId:fields.get('OutId')}})}
  return Response.json({Code:'OK',Success:true,Model:{OutId:fields.get('OutId'),VerifyResult:'PASS'}});
 }});
 const candidate=await (await testBuilder())({policy:policy(),referenceKey:randomBytes(32),pnvsCall:caller});
 const make=spec=>new Miniflare(options(spec.script,d1,spec));
 async function start(enabled){
  locked=await openLockedD1({lockDir:dir,openRuntime:()=>createSwitchableD1(make({script:base.bytes.toString()}),make),prepareService:runtime=>prepareLockedCloudService({runtime,origin,phone:enabled?{policy:policy()}:undefined,buildPhone:enabled?async mf=>{await assert.rejects(acquireD1Lock(dir));await verifyPhoneDatabase({mf,policy:policy()});return {enabled:true,...candidate}}:undefined})});
  server=https.createServer(material,locked.service.handler);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 }
 async function stop(){await new Promise(r=>server.close(r));server=undefined;await locked.close();locked=undefined}
 const call=(route,body,cookie)=>new Promise((resolve,reject)=>{const req=https.request({host:'127.0.0.1',port:server.address().port,servername:'synthetic.invalid',ca:material.cert,path:route,method:body?'POST':'GET',headers:{host:'synthetic.invalid',...(body?{origin,'content-type':'application/json'}:{}),...(cookie?{cookie}:{})}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}))});req.on('error',reject);req.end(body?JSON.stringify(body):undefined)});
 const phone='+8613800000891';await start(false);
 assert.equal((await call('/api/auth/phone/status')).status,404);assert.equal((await call('/api/auth/phone/challenge',{phone,purpose:'login'})).status,404);assert.equal(sends,0);await stop();
 await start(true);await assert.rejects(acquireD1Lock(dir));let r=await call('/api/auth/phone/status');assert.equal(JSON.parse(r.body).capabilities.phoneLogin,true);
 r=await call('/api/auth/phone/challenge',{phone,purpose:'login'});assert.equal(r.status,202,r.body);const challenge=JSON.parse(r.body);
 r=await call('/api/auth/phone/login',{phone,challengeId:challenge.challengeId,code:'619274'});assert.equal(r.status,200,r.body);const owner=JSON.parse(r.body).user.id,cookie=r.headers['set-cookie'][0].split(';')[0];
 await stop();await start(true);r=await call('/api/auth/session',undefined,cookie);assert.equal(r.status,200);assert.equal(JSON.parse(r.body).user.id,owner);assert.equal(sends,1);await stop();
 const release=await acquireD1Lock(dir);await release();
});

test('failed old-runtime disposal or unknown new-runtime outcome retain the D1 lock',async()=>{
 for(const stage of ['old-dispose','new-create','new-dispose']){
  const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'lantern-phone-lock-')));
  try{
   await assert.rejects(openLockedD1({lockDir:dir,openRuntime:()=>createSwitchableD1({async dispose(){if(stage==='old-dispose')throw Error('synthetic failure')}},()=>{if(stage==='new-dispose')return {ready:Promise.reject(Error('synthetic ready failure')),async dispose(){throw Error('synthetic cleanup failure')}};throw Error('synthetic creation failure')}),prepareService:async runtime=>{await runtime.replace({});return {async close(){}}}}),/lock retained/);
   await assert.rejects(acquireD1Lock(dir),{code:'EEXIST'});
  }finally{const d=await realpath(dir),tmp=await realpath(os.tmpdir());assert.equal(path.dirname(d).toLowerCase(),tmp.toLowerCase());assert(path.basename(d).startsWith('lantern-phone-lock-'));await rm(d,{recursive:true,force:true})}
 }
});

test('account preflight failure prevents phone construction and safely releases lock',async()=>{
 const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'lantern-phone-preflight-'))),base=await buildAccountWorker();let builds=0;
 try{
  const make=spec=>new Miniflare(options(spec.script,path.join(dir,'d1'),spec));
  await assert.rejects(openLockedD1({lockDir:dir,openRuntime:()=>createSwitchableD1(make({script:base.bytes.toString()}),make),prepareService:runtime=>prepareLockedCloudService({runtime,origin,phone:{policy:policy()},buildPhone:async()=>{builds++;throw Error('unexpected provider')}})}));
  assert.equal(builds,0);const release=await acquireD1Lock(dir);await release();
 }finally{const d=await realpath(dir),tmp=await realpath(os.tmpdir());assert.equal(path.dirname(d).toLowerCase(),tmp.toLowerCase());assert(path.basename(d).startsWith('lantern-phone-preflight-'));await rm(d,{recursive:true,force:true})}
});
