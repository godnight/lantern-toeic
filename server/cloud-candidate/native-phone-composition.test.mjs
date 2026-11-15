import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteD1Core } from './sqlite-d1-core.candidate.mjs';
import { prepareNativePhoneCandidate } from './native-phone-composition.candidate.mjs';

const origin = 'https://synthetic.invalid';
const policy = { enabled: true, origin, signature: 'synthetic-sign', schemeName: 'synthetic', templates: { login: '100001', bind: '100004' },
  referenceKeyFile: '/synthetic/private/key', limits: { maxSendsPerUtcDay: 10, maxSendsPerMinute: 10, maxSendsPerPhoneHour: 2, maxVerificationsPerPhoneTenMinutes: 5 } };
async function syntheticDatabase() {
  const sqlite = new DatabaseSync(':memory:');
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
