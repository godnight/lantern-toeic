import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateProtectedNativePhoneConfig, loadProtectedNativePhoneCandidate } from './native-phone-protected-config.candidate.mjs';
import { verifyPinnedNativePhoneWorker } from './native-phone-verification.candidate.mjs';

const policy = { enabled:true,origin:'https://synthetic.invalid',signature:'fixture',schemeName:'fixture',templates:{login:'100001'},
  referenceKeyFile:'/fixture/data/phone-reference-key',limits:{maxSendsPerUtcDay:10,maxSendsPerMinute:10,maxSendsPerPhoneHour:2,maxVerificationsPerPhoneTenMinutes:5} };
const account = {enabled:true,origin:policy.origin,bindAddress:'10.3.4.5',slot:'active',certRoot:'/fixture/certs',lockDir:'/fixture/data',workerRoot:'/fixture/worker',workerSha256:'a'.repeat(64)};
const entry = {policy,workerSha256:'b'.repeat(64)};

test('protected phone loading is closed unless explicitly enabled',async()=>{
  await assert.rejects(loadProtectedNativePhoneCandidate(),/disabled/);
  await assert.rejects(loadProtectedNativePhoneCandidate({enabled:true,accountConfigFile:'missing'}));
});

test('protected phone config binds owner origin, private key location and digest',{skip:process.platform!=='linux'},()=>{
  assert.deepEqual(validateProtectedNativePhoneConfig(entry,account).policy,policy);
  for(const invalid of [
    {...entry,workerSha256:'A'.repeat(64)}, {...entry,extra:true},
    {...entry,policy:{enabled:false}}, {...entry,policy:{...policy,origin:'https://other.invalid'}},
    {...entry,policy:{...policy,referenceKeyFile:'/fixture/other/phone-reference-key'}},
    {...entry,policy:{...policy,referenceKeyFile:'/fixture/data/wrong'}}
  ]) assert.throws(()=>validateProtectedNativePhoneConfig(invalid,account));
});

test('runtime verification checks trusted bytes and embedded budget before exposing a Worker',async()=>{
  const bytes=Buffer.from('export const LANTERN_PHONE_BUILD_BUDGET=[10,10,2,5];export default {fetch(){}};');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  assert.equal(typeof (await verifyPinnedNativePhoneWorker({enabled:true,bytes,sha256,policy})).fetch,'function');
  await assert.rejects(verifyPinnedNativePhoneWorker({enabled:true,bytes,sha256:'0'.repeat(64),policy}),/digest/);
  await assert.rejects(verifyPinnedNativePhoneWorker({enabled:true,bytes,sha256,policy:{...policy,limits:{...policy.limits,maxSendsPerMinute:1}}}),/budget/);
});
