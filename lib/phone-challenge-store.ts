import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {ProductIdentity} from './auth-service';
import type {PhoneChallengeContext} from './phone-challenge-provider';
export const PHONE_FLOW_SQL_NOW=`(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))`;
export const PHONE_FLOW_POLICY=Object.freeze({lifetimeMs:300000,cooldownMs:60000,maxAttempts:5,sendPhone:{span:3600000,max:3},sendGlobal:{span:60000,max:30},verifyPhone:{span:600000,max:10},verifyGlobal:{span:60000,max:100}});
const N=PHONE_FLOW_SQL_NOW;
export type FlowCode='phone-unavailable'|'phone-state-unknown'|'phone-rate-limited'|'phone-invalid-code'|'phone-expired'|'phone-replayed'|'invalid-phone-request'|'unauthenticated';
export class PhoneFlowError extends Error {
 constructor(readonly code:FlowCode,readonly status:number,readonly retryAt?:number,readonly attemptsRemaining?:number){super(code);}
}
export type ChallengeRow={challenge_id:string;provider_id:string;audience:string;purpose:'bind'|'login';phone:string;binding_user_id:string|null;reservation_ticket:string;state:string;provider_reference:string|null;issued_at:number;expires_at:number;resend_at:number;attempts:number;verification_ticket:string|null;consumption_ticket:string|null};
export type FlowContext={db:D1Database;providerId:string;audience:string;purpose:'bind'|'login';phone:string;bindingUser:ProductIdentity|null;bindingTokenHash:string|null};
type Rate={scope:string;span:number;max:number};
export const toChallengeContext=(r:ChallengeRow):PhoneChallengeContext=>({challengeId:r.challenge_id,purpose:r.purpose,audience:r.audience,phone:r.phone,bindingUserId:r.binding_user_id,issuedAt:r.issued_at,expiresAt:r.expires_at});
export function createPhoneChallengeStore(c:FlowContext){
 const d=c.db,phoneHash=createHash('sha256').update(c.audience+'\0'+c.phone).digest('hex'),prefix=createHash('sha256').update(c.audience).digest('hex');
 const live=`EXISTS(SELECT 1 FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>${N})`;
 const liveSQL=c.purpose==='bind'?live:'1',liveArgs=c.purpose==='bind'?[c.bindingTokenHash,c.bindingUser?.id??null]:[];
 const rates=(kind:'send'|'verify'):Rate[]=>[{scope:prefix+':'+kind+':phone:'+phoneHash,...PHONE_FLOW_POLICY[kind==='send'?'sendPhone':'verifyPhone']},{scope:prefix+':'+kind+':global',...PHONE_FLOW_POLICY[kind==='send'?'sendGlobal':'verifyGlobal']}];
 const rateStatement=(r:Rate,ticket:string)=>d.prepare(`INSERT INTO auth_phone_flow_buckets(scope,window_start,count,admission_ticket) VALUES(?,CAST(${N}/? AS INTEGER)*?,1,?) ON CONFLICT(scope,window_start) DO UPDATE SET count=auth_phone_flow_buckets.count+1,admission_ticket=excluded.admission_ticket WHERE auth_phone_flow_buckets.count<?`).bind(r.scope,r.span,r.span,ticket,r.max);
 const gates=(rs:Rate[])=>rs.map(()=>`EXISTS(SELECT 1 FROM auth_phone_flow_buckets WHERE scope=? AND window_start=CAST(${N}/? AS INTEGER)*? AND admission_ticket=?)`).join(' AND ');
 const gateArgs=(rs:Rate[],ticket:string)=>rs.flatMap(r=>[r.scope,r.span,r.span,ticket]);
 const get=async(id:string)=>await d.prepare('SELECT * FROM auth_phone_challenges WHERE challenge_id=?').bind(id).first<ChallengeRow>();
 async function rateRejection(kind:'send'|'verify',withCooldown:boolean):Promise<never>{
  if(c.purpose==='bind'&&!(await d.prepare(`SELECT 1 AS live WHERE ${live}`).bind(...liveArgs).first()))throw new PhoneFlowError('unauthenticated',401);
  let retry=0;
  for(const r of rates(kind)){
   const row=await d.prepare(`SELECT window_start+? AS retry_at FROM auth_phone_flow_buckets WHERE scope=? AND window_start=CAST(${N}/? AS INTEGER)*? AND count>=?`).bind(r.span,r.scope,r.span,r.span,r.max).first<{retry_at:number}>();
   if(row)retry=Math.max(retry,row.retry_at);
  }
  if(withCooldown){const row=await d.prepare(`SELECT resend_at FROM auth_phone_flow_cooldowns WHERE scope=? AND resend_at>${N}`).bind(prefix+':'+phoneHash).first<{resend_at:number}>();if(row)retry=Math.max(retry,row.resend_at);}
  if(retry)throw new PhoneFlowError('phone-rate-limited',429,retry);
  throw new PhoneFlowError('phone-state-unknown',503);
 }
 function validateRow(r:ChallengeRow|null):asserts r is ChallengeRow {
  if(!r||r.phone!==c.phone||r.purpose!==c.purpose||r.audience!==c.audience||r.provider_id!==c.providerId||r.binding_user_id!==(c.purpose==='bind'?c.bindingUser?.id:null))throw new PhoneFlowError('invalid-phone-request',400);
 }
 async function verifyRejection(id:string):Promise<never>{
  const r=await get(id);validateRow(r);
  const time=await d.prepare(`SELECT ${N} AS now`).first<{now:number}>();if(!time)throw new PhoneFlowError('phone-state-unknown',503);
  if(r.state==='consumed')throw new PhoneFlowError('phone-replayed',409);
  if(r.expires_at<=time.now)throw new PhoneFlowError('phone-expired',410);
  if(r.attempts>=PHONE_FLOW_POLICY.maxAttempts)throw new PhoneFlowError('phone-rate-limited',429,r.expires_at,0);
  if(r.state!=='sent')throw new PhoneFlowError('phone-state-unknown',503);
  return rateRejection('verify',false);
 }
 return {
  get,
  async reserveSend():Promise<ChallengeRow>{
   const id=randomBytes(24).toString('base64url'),ticket=randomUUID(),rs=rates('send'),cooldown=prefix+':'+phoneHash;
   const ss=rs.map(r=>rateStatement(r,ticket));
   ss.push(d.prepare(`INSERT INTO auth_phone_flow_cooldowns(scope,resend_at,admission_ticket) VALUES(?,${N}+?,?) ON CONFLICT(scope) DO UPDATE SET resend_at=excluded.resend_at,admission_ticket=excluded.admission_ticket WHERE auth_phone_flow_cooldowns.resend_at<=${N}`).bind(cooldown,PHONE_FLOW_POLICY.cooldownMs,ticket));
   ss.push(d.prepare(`INSERT INTO auth_phone_challenges(challenge_id,provider_id,audience,purpose,phone,binding_user_id,reservation_ticket,state,issued_at,expires_at,resend_at,attempts)
    SELECT CASE WHEN ${gates(rs)} AND cd.admission_ticket=? AND ${liveSQL} THEN ? ELSE NULL END,?,?,?,?,?,?,'pending',${N},${N}+?,cd.resend_at,0 FROM (SELECT 1) anchor LEFT JOIN auth_phone_flow_cooldowns cd ON cd.scope=?`)
    .bind(...gateArgs(rs,ticket),ticket,...liveArgs,id,c.providerId,c.audience,c.purpose,c.phone,c.bindingUser?.id??null,ticket,PHONE_FLOW_POLICY.lifetimeMs,cooldown));
   ss.push(d.prepare('SELECT * FROM auth_phone_challenges WHERE challenge_id=? AND reservation_ticket=?').bind(id,ticket));
   try{const result=await d.batch(ss),row=result.at(-1)?.results?.[0] as ChallengeRow|undefined;if(result[3].meta.changes!==1||!row)throw new Error('unconfirmed reservation');return row;}
   catch(error){if(String(error).includes('NOT NULL constraint failed: auth_phone_challenges.challenge_id'))return rateRejection('send',true);throw new PhoneFlowError('phone-state-unknown',503);}
  },
  async markSent(row:ChallengeRow,reference:string,issuedAt:number,expiresAt:number):Promise<ChallengeRow>{
   try{
    const results=await d.batch([d.prepare(`UPDATE auth_phone_challenges SET state='sent',provider_reference=?,issued_at=?,expires_at=MIN(expires_at,?) WHERE challenge_id=? AND reservation_ticket=? AND state='pending' AND expires_at>${N} AND ?>${N} AND ?>=resend_at`).bind(reference,issuedAt,expiresAt,row.challenge_id,row.reservation_ticket,expiresAt,expiresAt),d.prepare('SELECT * FROM auth_phone_challenges WHERE challenge_id=?').bind(row.challenge_id)]);
    const sent=results[1].results?.[0] as ChallengeRow|undefined;
    if(results[0].meta.changes!==1||!sent||sent.state!=='sent')throw new Error('unconfirmed delivery');return sent;
   }catch{throw new PhoneFlowError('phone-state-unknown',503);}
  },
  async quarantine(row:ChallengeRow,state:'unknown'|'failed',verificationTicket?:string):Promise<void>{
   try{await d.prepare(`UPDATE auth_phone_challenges SET state=? WHERE challenge_id=? AND ${verificationTicket?"state='verifying' AND verification_ticket=?":"state='pending' AND reservation_ticket=?"}`).bind(state,row.challenge_id,verificationTicket??row.reservation_ticket).run();}catch{/* Never turn an ambiguous provider/DB result into a successful response. */}
  },
  async claimVerification(id:string):Promise<{row:ChallengeRow;ticket:string}>{
   // This read is only an error discriminator. The batch repeats every gate.
   const prior=await get(id);validateRow(prior);
   if(prior.state!=='sent'||prior.attempts>=5)return verifyRejection(id);
   const ticket=randomUUID(),rs=rates('verify'),ss=rs.map(r=>rateStatement(r,ticket));
   ss.push(d.prepare(`UPDATE auth_phone_challenges SET state='verifying',verification_ticket=?,attempts=attempts+1 WHERE challenge_id=? AND state='sent' AND attempts<5 AND expires_at>${N} AND provider_reference IS NOT NULL AND phone=? AND purpose=? AND audience=? AND provider_id=? AND binding_user_id IS ? AND ${liveSQL} AND ${gates(rs)}`)
    .bind(ticket,id,c.phone,c.purpose,c.audience,c.providerId,c.bindingUser?.id??null,...liveArgs,...gateArgs(rs,ticket)));
   // A zero UPDATE must roll back both buckets, not merely return a JS error.
   ss.push(d.prepare(`INSERT INTO auth_phone_flow_operations(ticket,challenge_id,kind,created_at) SELECT CASE WHEN EXISTS(SELECT 1 FROM auth_phone_challenges WHERE challenge_id=? AND state='verifying' AND verification_ticket=?) THEN ? ELSE NULL END,?,'verify',${N}`).bind(id,ticket,ticket,id));
   ss.push(d.prepare('SELECT * FROM auth_phone_challenges WHERE challenge_id=? AND verification_ticket=?').bind(id,ticket));
   try{const result=await d.batch(ss),row=result.at(-1)?.results?.[0] as ChallengeRow|undefined;if(result[2].meta.changes!==1||!row)throw new Error('unconfirmed verification admission');return {row,ticket};}
   catch(error){if(String(error).includes('NOT NULL constraint failed: auth_phone_flow_operations.ticket'))return verifyRejection(id);throw new PhoneFlowError('phone-state-unknown',503);}
  },
  async rejectCode(row:ChallengeRow,ticket:string):Promise<number>{
   try{const result=await d.prepare(`UPDATE auth_phone_challenges SET state=CASE WHEN attempts<5 THEN 'sent' ELSE 'failed' END WHERE challenge_id=? AND verification_ticket=? AND state='verifying' AND expires_at>${N}`).bind(row.challenge_id,ticket).run();if(result.meta.changes!==1)throw new Error('unconfirmed rejection');return Math.max(0,5-row.attempts);}
   catch{throw new PhoneFlowError('phone-state-unknown',503);}
  },
 };
}
