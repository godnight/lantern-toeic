// Synthetic child-process fixture only. Never accepts production configuration,
// reads credentials, sends SMS, opens a listener, or calls external services.
import { randomInt } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { createSqliteD1Core } from './sqlite-d1-core.candidate.mjs';
import { prepareNativePhoneCandidate } from './native-phone-composition.candidate.mjs';

const origin = 'https://synthetic.invalid';
const policy = { enabled: true, origin, signature: 'synthetic-sign', schemeName: 'synthetic', templates: { login: '100001' },
  referenceKeyFile: '/synthetic/private/key', limits: { maxSendsPerUtcDay: 10, maxSendsPerMinute: 10, maxSendsPerPhoneHour: 2, maxVerificationsPerPhoneTenMinutes: 5 } };
const codes = new Map();
globalThis.fetch = async () => { throw Error('network disabled in synthetic fixture'); };
let sqlite, worker;
try {
  if (typeof process.send !== 'function' || !path.isAbsolute(process.argv[2] || '') || path.basename(process.argv[2]) !== 'synthetic-phone.sqlite' || !/^[a-f0-9]{64}$/.test(process.argv[3] || '')) throw Error('invalid fixture invocation');
  sqlite = new DatabaseSync(process.argv[2], { timeout: 0, allowExtension: false, defensive: true });
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL');
  if (sqlite.prepare('PRAGMA journal_mode').get().journal_mode !== 'wal') throw Error('fixture requires WAL');
  const db = createSqliteD1Core({ enabled: true, database: sqlite });
  worker = await prepareNativePhoneCandidate({ enabled: true, db, policy, accountOrigin: origin, referenceKey: Buffer.from(process.argv[3], 'hex'),
    pnvsCall: async (action, fields) => {
      if (action === 'SendSmsVerifyCode') {
        const code=String(randomInt(0,1000000)).padStart(6,'0');codes.set(fields.OutId,{code,phone:fields.PhoneNumber});
        return {Code:'OK',Success:true,Model:{OutId:fields.OutId}};
      }
      if (action !== 'CheckSmsVerifyCode') throw Error('unexpected synthetic action');
      const entry=codes.get(fields.OutId);
      return {Code:'OK',Success:true,Model:{OutId:fields.OutId,VerifyResult:entry?.phone===fields.PhoneNumber&&entry.code===fields.VerifyCode?'PASS':'UNKNOWN'}};
    } });
  process.send({ ready: true });
} catch {
  sqlite?.close();process.send?.({ready:false});process.exitCode=1;
}
if (worker) process.on('message', async message => {
  try {
    if (message.action === 'stop') { sqlite.close();process.send({id:message.id,stopped:true},()=>process.disconnect());return; }
    if (message.action === 'code') { process.send({id:message.id,code:codes.get(message.challengeId)?.code});return; }
    if (message.action !== 'request' || typeof message.route !== 'string' || !message.route.startsWith('/api/auth/')) throw Error('invalid fixture request');
    const body=message.body;
    const req=new Request(origin+message.route,{method:body?'POST':'GET',headers:{...(body?{origin,'content-type':'application/json'}:{}),...(message.cookie?{cookie:message.cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const response=await worker.fetch(req),text=await response.text();
    process.send({id:message.id,status:response.status,body:text,cookie:response.headers.get('set-cookie')?.split(';')[0]});
  } catch {process.send({id:message.id,error:'synthetic request failed'});}
});
