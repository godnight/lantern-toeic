import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildNativePhoneWorker, verifyPinnedNativePhoneWorker } from './native-phone-worker-build.candidate.mjs';

const policy={enabled:true,origin:'https://synthetic.invalid',signature:'synthetic-sign',schemeName:'synthetic',templates:{login:'100001'},
  referenceKeyFile:'/synthetic/private/key',limits:{maxSendsPerUtcDay:10,maxSendsPerMinute:10,maxSendsPerPhoneHour:2,maxVerificationsPerPhoneTenMinutes:5}};

test('offline artifact is explicitly enabled, deterministic for fixed inputs, pinned to bytes and configured budget',async()=>{
  await assert.rejects(buildNativePhoneWorker(),/disabled/);
  await assert.rejects(verifyPinnedNativePhoneWorker(),/invalid/);
  const first=await buildNativePhoneWorker({enabled:true,policy}),second=await buildNativePhoneWorker({enabled:true,policy});
  assert.equal(first.sha256,second.sha256);assert.deepEqual(first.bytes,second.bytes);
  assert.equal(first.sha256,createHash('sha256').update(first.bytes).digest('hex'));
  assert.deepEqual(first.budget,[10,10,2,5]);
  const approved=await verifyPinnedNativePhoneWorker({enabled:true,bytes:first.bytes,sha256:first.sha256,policy});
  assert.equal(typeof approved.fetch,'function');
  assert.doesNotMatch(first.bytes.toString('utf8'),/synthetic-sign|synthetic\.invalid|\/synthetic\/private\/key/);
  const modified=Buffer.from(first.bytes);modified[modified.length-1]^=1;
  await assert.rejects(verifyPinnedNativePhoneWorker({enabled:true,bytes:modified,sha256:first.sha256,policy}),/digest mismatch/);
  await assert.rejects(verifyPinnedNativePhoneWorker({enabled:true,bytes:first.bytes,sha256:'0'.repeat(64),policy}),/digest mismatch/);
  const another={...policy,limits:{...policy.limits,maxSendsPerPhoneHour:1}};
  await assert.rejects(verifyPinnedNativePhoneWorker({enabled:true,bytes:first.bytes,sha256:first.sha256,policy:another}),/budget mismatch/);
  const changed=await buildNativePhoneWorker({enabled:true,policy:another});assert.notEqual(first.sha256,changed.sha256);
  assert.equal(typeof (await verifyPinnedNativePhoneWorker({enabled:true,bytes:changed.bytes,sha256:changed.sha256,policy:another})).fetch,'function');
});
