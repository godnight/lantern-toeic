import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteD1Core } from './sqlite-d1-core.candidate.mjs';
import { prepareNativePhoneCandidate } from './native-phone-composition.candidate.mjs';

const origin = 'https://synthetic.invalid';
const policy = { enabled: true, origin, signature: 'synthetic-sign', schemeName: 'synthetic', templates: { login: '100001', bind: '100004' },
  referenceKeyFile: '/synthetic/private/key', limits: { maxSendsPerUtcDay: 10, maxSendsPerMinute: 10, maxSendsPerPhoneHour: 2, maxVerificationsPerPhoneTenMinutes: 5 } };
async function syntheticDatabase(file=':memory:') {
  const sqlite = new DatabaseSync(file);
  if (file !== ':memory:') sqlite.exec('PRAGMA journal_mode=WAL');
  sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE _lantern_local_migrations(name TEXT PRIMARY KEY,sha TEXT NOT NULL)');
  for (const name of ['0005_product_auth.sql','0006_auth_admission_ticket.sql','0007_phone_auth.sql','0008_phone_challenges.sql','0009_huawei_auth.sql']) {
    const sql = await readFile(new URL('../../drizzle/' + name, import.meta.url));
    sqlite.exec(sql.toString('utf8'));
    sqlite.prepare('INSERT INTO _lantern_local_migrations VALUES(?,?)').run(name,createHash('sha256').update(sql).digest('hex'));
  }
  sqlite.exec('CREATE TABLE _lantern_phone_policy(singleton INTEGER PRIMARY KEY,policy TEXT NOT NULL)');
  const l=policy.limits;sqlite.prepare('INSERT INTO _lantern_phone_policy VALUES(1,?)').run(JSON.stringify([l.maxSendsPerUtcDay,l.maxSendsPerMinute,l.maxSendsPerPhoneHour,l.maxVerificationsPerPhoneTenMinutes]));
  return { sqlite, db: createSqliteD1Core({ enabled: true, database: sqlite }) };
}
function provider() {
  const challenges = new Map(); let fail = false;
  return { challenges, setFailure(value) { fail = value; }, async call(action, fields) {
    if (fail) throw Error('synthetic unavailable');
    if (action === 'SendSmsVerifyCode') {
      const code = String(randomInt(0,1000000)).padStart(6,'0'); challenges.set(fields.OutId, { code, phone: fields.PhoneNumber });
      return { Code:'OK',Success:true,Model:{OutId:fields.OutId} };
    }
    const entry = challenges.get(fields.OutId);
    return { Code:'OK',Success:true,Model:{OutId:fields.OutId,VerifyResult:entry?.phone === fields.PhoneNumber && entry.code === fields.VerifyCode ? 'PASS':'UNKNOWN'} };
  } };
}
function request(worker, route, body, cookie, requestOrigin = origin) {
  return worker.fetch(new Request(origin+route,{method:body?'POST':'GET',headers:{...(body?{origin:requestOrigin,'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}));
}

test('native phone composition remains disabled, and verifies exact ledger, schema and budget before construction',async()=>{
  assert.deepEqual(await prepareNativePhoneCandidate(),{enabled:false});
  const {sqlite,db}=await syntheticDatabase();try {
    let calls=0;const options={enabled:true,db,policy,accountOrigin:origin,referenceKey:randomBytes(32),pnvsCall:async()=>{calls++;throw Error('unexpected')}};
    await assert.rejects(prepareNativePhoneCandidate({...options,accountOrigin:'https://other.invalid'}),/incomplete/);
    sqlite.prepare('UPDATE _lantern_phone_policy SET policy=?').run('[]');
    await assert.rejects(prepareNativePhoneCandidate(options),/budget policy mismatch/);
    sqlite.prepare('UPDATE _lantern_phone_policy SET policy=?').run(JSON.stringify([10,10,2,5]));
    sqlite.prepare("UPDATE _lantern_local_migrations SET sha=? WHERE name='0008_phone_challenges.sql'").run('0'.repeat(64));
    await assert.rejects(prepareNativePhoneCandidate(options),/ledger mismatch/);
    assert.equal(calls,0);
  } finally {sqlite.close()}
});

test('native SQLite phone flow registers isolated owners, rejects replay and quarantines uncertain sends', {timeout:60000}, async()=>{
  const {sqlite,db}=await syntheticDatabase();const mock=provider();
  try {
    const options={enabled:true,db,policy,accountOrigin:origin,referenceKey:randomBytes(32),pnvsCall:mock.call};
    let worker=await prepareNativePhoneCandidate(options);assert.match(worker.sha256,/^[0-9a-f]{64}$/);
    const phoneA='+8613800000101',phoneB='+8613800000102';
    assert.equal((await request(worker,'/api/auth/phone/status')).status,200);
    assert.equal((await request(worker,'/api/auth/phone/challenge',{phone:phoneA,purpose:'login'},null,'https://other.invalid')).status,403);
    async function signup(phone) {
      let r=await request(worker,'/api/auth/phone/challenge',{phone,purpose:'login'});assert.equal(r.status,202,await r.clone().text());const challenge=await r.json();
      const code=mock.challenges.get(challenge.challengeId).code;
      const wrong=code==='000000'?'000001':'000000';
      r=await request(worker,'/api/auth/phone/login',{phone,challengeId:challenge.challengeId,code:wrong});assert.equal(r.status,400);assert.equal((await r.json()).code,'phone-invalid-code');
      r=await request(worker,'/api/auth/phone/login',{phone,challengeId:challenge.challengeId,code});assert.equal(r.status,200,await r.clone().text());
      return { owner:(await r.json()).user.id,cookie:r.headers.get('set-cookie').split(';')[0],challenge,code };
    }
    const a=await signup(phoneA),b=await signup(phoneB);assert.notEqual(a.owner,b.owner);
    assert.equal((await request(worker,'/api/auth/phone/login',{phone:phoneA,challengeId:a.challenge.challengeId,code:a.code})).status,409);
    assert.equal((await (await request(worker,'/api/auth/session',null,a.cookie)).json()).user.id,a.owner);
    assert.equal((await (await request(worker,'/api/auth/session',null,b.cookie)).json()).user.id,b.owner);
    const passwordAccount=await request(worker,'/api/auth/register',{username:'synthetic_password_owner',password:'synthetic-password-123'});
    assert.equal(passwordAccount.status,200,await passwordAccount.clone().text());
    const passwordOwner=(await passwordAccount.json()).user.id,passwordCookie=passwordAccount.headers.get('set-cookie').split(';')[0];
    const freshPhone='+8613800000105';let fresh=await request(worker,'/api/auth/phone/challenge',{phone:freshPhone,purpose:'bind'},passwordCookie);
    assert.equal(fresh.status,202,await fresh.clone().text());const freshChallenge=await fresh.json();
    fresh=await request(worker,'/api/auth/phone/bind',{phone:freshPhone,challengeId:freshChallenge.challengeId,code:mock.challenges.get(freshChallenge.challengeId).code},passwordCookie);
    assert.equal(fresh.status,200,await fresh.clone().text());
    assert.equal(sqlite.prepare('SELECT user_id FROM auth_phone_bindings WHERE phone=?').get(freshPhone).user_id,passwordOwner);
    const other=await request(worker,'/api/auth/register',{username:'synthetic_other_owner',password:'synthetic-password-456'});
    assert.equal(other.status,200,await other.clone().text());const otherCookie=other.headers.get('set-cookie').split(';')[0];
    // Synthetic clock advance for this number's cooldown; budgets and account
    // state remain unchanged. This assertion concerns binding conflict only.
    const prefix=createHash('sha256').update(origin+'/phone').digest('hex');
    const phoneHash=createHash('sha256').update(origin+'/phone'+'\0'+freshPhone).digest('hex');
    sqlite.prepare('UPDATE auth_phone_flow_cooldowns SET resend_at=0 WHERE scope=?').run(prefix+':'+phoneHash);
    let conflict=await request(worker,'/api/auth/phone/challenge',{phone:freshPhone,purpose:'bind'},otherCookie);
    assert.equal(conflict.status,202,await conflict.clone().text());const conflictChallenge=await conflict.json();
    conflict=await request(worker,'/api/auth/phone/bind',{phone:freshPhone,challengeId:conflictChallenge.challengeId,code:mock.challenges.get(conflictChallenge.challengeId).code},otherCookie);
    assert.equal(conflict.status,409,await conflict.clone().text());assert.equal((await conflict.json()).code,'phone-binding-conflict');
    assert.equal(sqlite.prepare('SELECT user_id FROM auth_phone_bindings WHERE phone=?').get(freshPhone).user_id,passwordOwner);

    const bindPhone='+8613800000104';
    let bind=await request(worker,'/api/auth/phone/challenge',{phone:bindPhone,purpose:'bind'},a.cookie);
    assert.equal(bind.status,202,await bind.clone().text());const bindChallenge=await bind.json();
    bind=await request(worker,'/api/auth/phone/bind',{phone:bindPhone,challengeId:bindChallenge.challengeId,code:mock.challenges.get(bindChallenge.challengeId).code},a.cookie);
    assert.equal(bind.status,409); // A already has phoneA; the binding cannot transfer or replace it.
    assert.equal(sqlite.prepare('SELECT user_id FROM auth_phone_bindings WHERE phone=?').get(phoneA).user_id,a.owner);
    assert.equal(sqlite.prepare('SELECT user_id FROM auth_phone_bindings WHERE phone=?').get(bindPhone),undefined);
    worker=await prepareNativePhoneCandidate(options);
    assert.equal((await (await request(worker,'/api/auth/session',null,a.cookie)).json()).user.id,a.owner);
    mock.setFailure(true);
    const failed=await request(worker,'/api/auth/phone/challenge',{phone:'+8613800000103',purpose:'login'});
    assert.equal(failed.status,503);assert.equal((await failed.json()).code,'phone-state-unknown');
    assert.equal(sqlite.prepare("SELECT state FROM auth_phone_challenges WHERE phone=?").get('+8613800000103').state,'unknown');
  } finally {sqlite.close()}
});


test('Huawei and phone share a verified owner with explicit constrained Huawei outbound only', {timeout:60000}, async()=>{
  const {sqlite,db}=await syntheticDatabase(), mock=provider();let calls=0,audience='123456';
  const options={enabled:true,db,policy,accountOrigin:origin,referenceKey:randomBytes(32),pnvsCall:mock.call};
  try {
    const disabled=await prepareNativePhoneCandidate(options);
    assert.deepEqual(await (await request(disabled,'/api/auth/providers')).json(),{huaweiLogin:false,huaweiBinding:false});
    await assert.rejects(prepareNativePhoneCandidate({...options,huawei:{clientId:'123456',clientSecret:'synthetic-secret'}}),/invalid Huawei/);
    await assert.rejects(prepareNativePhoneCandidate({...options,huawei:{clientId:'123456',clientSecret:'synthetic-secret',fetchImpl:async()=>{},extra:'forbidden'}}),/invalid Huawei/);
    const huawei={clientId:'123456',clientSecret:'synthetic-secret',fetchImpl:async(url,init)=>{
      calls++;assert.ok(['https://oauth-login.cloud.huawei.com/oauth2/v3/token','https://oauth-api.cloud.huawei.com/rest.php?nsp_fmt=JSON&nsp_svc=huawei.oauth2.user.getTokenInfo'].includes(url));
      assert.equal(init.redirect,'manual');return Response.json(url.includes('/token')?{token_type:'Bearer',access_token:'synthetic-access-token',expires_in:3600}:{client_id:audience,type:0,expire_in:3600,open_id:'SyntheticSubjectA'});
    }};
    const worker=await prepareNativePhoneCandidate({...options,huawei});
    assert.deepEqual(await (await request(worker,'/api/auth/providers')).json(),{huaweiLogin:true,huaweiBinding:true});
    assert.equal((await (await request(worker,'/api/auth/phone/status')).json()).capabilities.phoneLogin,true);
    const phone='+8613800000110';let r=await request(worker,'/api/auth/phone/challenge',{phone,purpose:'login'});assert.equal(r.status,202,await r.clone().text());
    const challenge=await r.json();r=await request(worker,'/api/auth/phone/login',{phone,challengeId:challenge.challengeId,code:mock.challenges.get(challenge.challengeId).code});
    assert.equal(r.status,200,await r.clone().text());const owner=(await r.json()).user.id,cookie=r.headers.get('set-cookie').split(';')[0];
    r=await request(worker,'/api/auth/huawei/bind',{code:'synthetic-bind'},cookie);assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).user.id,owner);
    r=await request(worker,'/api/auth/huawei/login',{code:'synthetic-login'});assert.equal(r.status,200,await r.clone().text());
    const response=await r.text();assert.equal(JSON.parse(response).user.id,owner);assert.doesNotMatch(response,/synthetic-secret|synthetic-access-token|SyntheticSubjectA/);
    audience='wrong';r=await request(worker,'/api/auth/huawei/login',{code:'synthetic-wrong-audience'});assert.equal(r.status,401);
    assert.equal(calls,6);
  } finally {sqlite.close()}
});


function launchSyntheticPhoneChild(file, syntheticKey) {
  const child=fork(fileURLToPath(new URL('./native-phone-child.fixture.mjs',import.meta.url)),[file,syntheticKey],{stdio:['ignore','ignore','pipe','ipc']});
  let seq=0,stderr='',readyResolve,readyReject,exitResolve,exitReject;const pending=new Map();
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject});
  const exited=new Promise((resolve,reject)=>{exitResolve=resolve;exitReject=reject});
  ready.catch(()=>{});exited.catch(()=>{});
  child.stderr.on('data',chunk=>{stderr+=chunk.toString()});
  child.on('message',message=>{
    if(typeof message?.ready==='boolean'){readyResolve(message.ready);return;}
    const promise=pending.get(message?.id);if(promise){pending.delete(message.id);message.error?promise.reject(Error(message.error)):promise.resolve(message)}
  });
  child.on('error',error=>{readyReject(error);exitReject(error);for(const p of pending.values())p.reject(error);pending.clear()});
  child.on('exit',(code,signal)=>{const error=Error('synthetic child exited: '+code+'/'+signal+' '+stderr);for(const p of pending.values())p.reject(error);pending.clear();if(code===0)exitResolve();else{readyReject(error);exitReject(error)}});
  return {child,ready,exited,send(message){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});child.send({...message,id},error=>{if(error&&pending.has(id)){pending.delete(id);reject(error)}})})}};
}

test('synthetic on-disk WAL survives an independent Node process restart, preserving sessions and phone ownership', {timeout:60000}, async()=>{
  const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'lantern-native-phone-restart-'))),file=path.join(dir,'synthetic-phone.sqlite'),children=[];
  let sqlite;const syntheticKey=randomBytes(32).toString('hex');
  try {
    ({sqlite}=await syntheticDatabase(file));sqlite.close();sqlite=undefined;
    let running=launchSyntheticPhoneChild(file,syntheticKey);children.push(running.child);assert.equal(await running.ready,true);
    async function signup(phone) {
      let reply=await running.send({action:'request',route:'/api/auth/phone/challenge',body:{phone,purpose:'login'}});
      assert.equal(reply.status,202,reply.body);const challenge=JSON.parse(reply.body);
      const code=(await running.send({action:'code',challengeId:challenge.challengeId})).code;
      reply=await running.send({action:'request',route:'/api/auth/phone/login',body:{phone,challengeId:challenge.challengeId,code}});
      assert.equal(reply.status,200,reply.body);return {owner:JSON.parse(reply.body).user.id,cookie:reply.cookie};
    }
    const phoneA='+8613800000201',phoneB='+8613800000202',a=await signup(phoneA),b=await signup(phoneB);
    assert.notEqual(a.owner,b.owner);
    await running.send({action:'stop'});await running.exited;
    // Advance only this synthetic phone's cooldown between processes; the
    // production hour/day budgets and the saved user/session data are intact.
    sqlite=new DatabaseSync(file);const prefix=createHash('sha256').update(origin+'/phone').digest('hex');
    const phoneHash=createHash('sha256').update(origin+'/phone'+'\0'+phoneA).digest('hex');
    assert.equal(sqlite.prepare('UPDATE auth_phone_flow_cooldowns SET resend_at=0 WHERE scope=?').run(prefix+':'+phoneHash).changes,1);
    assert.equal(sqlite.prepare('SELECT user_id FROM auth_phone_bindings WHERE phone=?').get(phoneA).user_id,a.owner);
    assert.equal(sqlite.prepare('SELECT user_id FROM auth_phone_bindings WHERE phone=?').get(phoneB).user_id,b.owner);
    sqlite.close();sqlite=undefined;
    running=launchSyntheticPhoneChild(file,syntheticKey);children.push(running.child);assert.equal(await running.ready,true);
    for(const account of [a,b]){
      const session=await running.send({action:'request',route:'/api/auth/session',cookie:account.cookie});
      assert.equal(session.status,200,session.body);assert.equal(JSON.parse(session.body).user.id,account.owner);
    }
    const loginAgain=await signup(phoneA);assert.equal(loginAgain.owner,a.owner);
    await running.send({action:'stop'});await running.exited;
  } finally {
    sqlite?.close();
    await Promise.all(children.map(child=>child.exitCode===null&&child.signalCode===null?new Promise(resolve=>{child.once('exit',resolve);child.kill()}):undefined));
    const actual=await realpath(dir),tmp=await realpath(os.tmpdir());
    if(path.dirname(actual).toLowerCase()!==tmp.toLowerCase()||!path.basename(actual).startsWith('lantern-native-phone-restart-'))throw Error('unsafe synthetic directory');
    await rm(actual,{recursive:true,force:true});
  }
});
