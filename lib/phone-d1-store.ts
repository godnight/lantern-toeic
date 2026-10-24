import {createHash,randomUUID} from 'node:crypto';
import {PRODUCT_SESSION_SECONDS,type ProductIdentity} from './auth-service';
import {PHONE_PROOF_MAX_LIFETIME_MS,PHONE_PROOF_FUTURE_SKEW_MS,type PhoneTransactionStore,type VerifiedPhoneCommand,type PhoneCommitResult} from './phone-verification';

// SQLite server time, with milliseconds. The value is stable within a statement;
// no client clock controls proof expiry or the live binding-session check.
const SQL_NOW=`(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))`;
type FinalRow={status:string;id:string|null;username:string|null};
type SessionMaterial={tokenHash:string;oldTokenHash:string};
export type PhoneD1Context={db:D1Database;purpose:'bind'|'login';audience:string;providerId:string;phone:string;bindingUser:ProductIdentity|null;bindingTokenHash:string|null;session:SessionMaterial;challenge?:Readonly<{id:string;verificationTicket:string}>};

export function createPhoneD1Store(context:PhoneD1Context):PhoneTransactionStore&{committedIdentity:()=>ProductIdentity|null}{
 let committed:ProductIdentity|null=null;
 const db=context.db;
 return {
  committedIdentity:()=>committed,
  async commitVerifiedPhone(command:Readonly<VerifiedPhoneCommand>):Promise<PhoneCommitResult>{
   if(command.purpose!==context.purpose||command.audience!==context.audience||command.providerId!==context.providerId||command.phone!==context.phone)return {status:'unauthorized'};
   if(command.purpose==='bind'&&(!context.bindingUser||command.bindingUserId!==context.bindingUser.id||!context.bindingTokenHash))return {status:'unauthorized'};
   if(command.purpose==='login'&&command.bindingUserId!==null)return {status:'unauthorized'};
   const ticket=randomUUID(),hash=createHash('sha256').update(command.proofId).digest('hex');
   const fresh=`?<=${SQL_NOW}+? AND ?>${SQL_NOW} AND ?>? AND ?-?<=? AND ${SQL_NOW}-?<=?`;
   const times=[command.issuedAt,PHONE_PROOF_FUTURE_SKEW_MS,command.expiresAt,command.expiresAt,command.issuedAt,command.expiresAt,command.issuedAt,PHONE_PROOF_MAX_LIFETIME_MS,command.issuedAt,PHONE_PROOF_MAX_LIFETIME_MS];
   const liveSession=`SELECT 1 FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>${SQL_NOW}`;
   const challengePresent=context.challenge?`EXISTS(SELECT 1 FROM auth_phone_challenges c WHERE c.challenge_id=? AND c.verification_ticket=? AND c.state='verifying' AND c.expires_at>${SQL_NOW} AND c.phone=? AND c.purpose=? AND c.audience=? AND c.provider_id=? AND c.binding_user_id IS ?)`:'1';
   const challengeArgs=context.challenge?[context.challenge.id,context.challenge.verificationTicket,context.phone,context.purpose,context.audience,context.providerId,context.bindingUser?.id??null]:[];
   const statements:D1PreparedStatement[]=[];
   if(command.purpose==='bind'){
    statements.push(db.prepare(`INSERT INTO auth_phone_proofs(provider_id,proof_hash,consumption_ticket,purpose,audience,phone,user_id,issued_at,expires_at,consumed_at)
     SELECT ?,?,?,?,?,?,?,?, ?,${SQL_NOW} WHERE ${fresh} AND EXISTS(${liveSession}) AND ${challengePresent}
     ON CONFLICT(provider_id,proof_hash) DO NOTHING`).bind(context.providerId,hash,ticket,'bind',context.audience,context.phone,context.bindingUser!.id,command.issuedAt,command.expiresAt,...times,context.bindingTokenHash,context.bindingUser!.id,...challengeArgs));
    // Same owner is idempotent. A different phone owner deliberately violates
    // NOT NULL; a user's second phone violates UNIQUE(user_id). Either SQL error
    // rolls back the new proof claim and every other statement in this batch.
    statements.push(db.prepare(`INSERT INTO auth_phone_bindings(phone,user_id,created_at)
     SELECT phone,user_id,${SQL_NOW} FROM auth_phone_proofs WHERE consumption_ticket=?
     ON CONFLICT(phone) DO UPDATE SET user_id=CASE WHEN auth_phone_bindings.user_id=excluded.user_id THEN auth_phone_bindings.user_id ELSE NULL END`).bind(ticket));
   }else{
    statements.push(db.prepare(`INSERT INTO auth_phone_proofs(provider_id,proof_hash,consumption_ticket,purpose,audience,phone,user_id,issued_at,expires_at,consumed_at)
     SELECT ?,?,?,?,?,b.phone,b.user_id,?,?,${SQL_NOW} FROM auth_phone_bindings b JOIN auth_users u ON u.id=b.user_id
     WHERE b.phone=? AND ${fresh} AND ${challengePresent} ON CONFLICT(provider_id,proof_hash) DO NOTHING`).bind(context.providerId,hash,ticket,'login',context.audience,command.issuedAt,command.expiresAt,context.phone,...times,...challengeArgs));
    statements.push(db.prepare(`DELETE FROM auth_sessions WHERE (user_id=(SELECT user_id FROM auth_phone_proofs WHERE consumption_ticket=?) OR token_hash=?)
     AND EXISTS(SELECT 1 FROM auth_phone_proofs WHERE consumption_ticket=?)`).bind(ticket,context.session.oldTokenHash,ticket));
    statements.push(db.prepare(`INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at)
     SELECT ?,user_id,${SQL_NOW},${SQL_NOW}+? FROM auth_phone_proofs WHERE consumption_ticket=?`).bind(context.session.tokenHash,PRODUCT_SESSION_SECONDS*1000,ticket));
    statements.push(db.prepare(`DELETE FROM auth_sessions WHERE expires_at<=${SQL_NOW}
     AND EXISTS(SELECT 1 FROM auth_phone_proofs WHERE consumption_ticket=?)`).bind(ticket));
   }
   // Bounded retention cleanup, only after a newly claimed proof. Expired IDs
   // cannot be reused: the SQL freshness gate still applies on every insertion.
   statements.push(db.prepare(`DELETE FROM auth_phone_proofs WHERE rowid IN
    (SELECT rowid FROM auth_phone_proofs WHERE expires_at+? < ${SQL_NOW} AND consumption_ticket<>? ORDER BY expires_at LIMIT 128)
    AND EXISTS(SELECT 1 FROM auth_phone_proofs WHERE consumption_ticket=?)`).bind(PHONE_PROOF_FUTURE_SKEW_MS,ticket,ticket));
   if(context.challenge){
    statements.push(db.prepare(`UPDATE auth_phone_challenges SET state='consumed',consumption_ticket=?
     WHERE challenge_id=? AND verification_ticket=? AND state='verifying' AND expires_at>${SQL_NOW}
     AND EXISTS(SELECT 1 FROM auth_phone_proofs p WHERE p.consumption_ticket=? AND p.phone=auth_phone_challenges.phone AND p.purpose=auth_phone_challenges.purpose AND p.audience=auth_phone_challenges.audience AND p.provider_id=auth_phone_challenges.provider_id AND (auth_phone_challenges.binding_user_id IS NULL OR auth_phone_challenges.binding_user_id=p.user_id))`)
     .bind(ticket,context.challenge.id,context.challenge.verificationTicket,ticket));
   }
   // Last write before the result: crossing expiry or a missing required write
   // must be a real SQL error, so earlier proof/session changes also roll back.
   const bindingPresent=`EXISTS(SELECT 1 FROM auth_phone_bindings b WHERE b.phone=p.phone AND b.user_id=p.user_id)`;
   const identityPresent=command.purpose==='bind'?`EXISTS(${liveSession})`:`EXISTS(SELECT 1 FROM auth_sessions s WHERE s.token_hash=? AND s.user_id=p.user_id AND s.expires_at>${SQL_NOW})`;
   const challengeConsumed=context.challenge?`EXISTS(SELECT 1 FROM auth_phone_challenges c WHERE c.challenge_id=? AND c.verification_ticket=? AND c.state='consumed' AND c.consumption_ticket=p.consumption_ticket AND c.expires_at>${SQL_NOW})`:'1';
   const consumedArgs=context.challenge?[context.challenge.id,context.challenge.verificationTicket]:[];
   // Always select one anchor row. A missing claim produces NULL in required
   // columns and a SQL constraint failure, rather than an UPDATE of zero rows.
   // An existing claim only updates its consumed_at via the same primary key.
   statements.push(db.prepare(`INSERT INTO auth_phone_proofs(provider_id,proof_hash,consumption_ticket,purpose,audience,phone,user_id,issued_at,expires_at,consumed_at)
    SELECT p.provider_id,p.proof_hash,p.consumption_ticket,p.purpose,p.audience,p.phone,p.user_id,p.issued_at,p.expires_at,
     CASE WHEN p.expires_at>${SQL_NOW} AND ${bindingPresent} AND ${identityPresent} AND ${challengeConsumed} THEN ${SQL_NOW} ELSE NULL END
    FROM (SELECT 1) anchor LEFT JOIN auth_phone_proofs p ON p.consumption_ticket=? WHERE 1
    ON CONFLICT(provider_id,proof_hash) DO UPDATE SET consumed_at=excluded.consumed_at`)
    .bind(...(command.purpose==='bind'?[context.bindingTokenHash,context.bindingUser!.id]:[context.session.tokenHash]),...consumedArgs,ticket));
   const final=db.prepare(`SELECT CASE
    WHEN p.consumption_ticket IS NOT NULL THEN 'committed'
    WHEN EXISTS(SELECT 1 FROM auth_phone_proofs WHERE provider_id=? AND proof_hash=?) THEN 'replayed'
    WHEN NOT(${fresh}) THEN 'expired'
    ${command.purpose==='bind'?`WHEN NOT EXISTS(${liveSession}) THEN 'unauthorized'`:"WHEN NOT EXISTS(SELECT 1 FROM auth_phone_bindings WHERE phone=?) THEN 'not-bound'"}
    ELSE 'unavailable' END AS status,u.id,u.username
    FROM (SELECT 1) anchor LEFT JOIN auth_phone_proofs p ON p.consumption_ticket=? LEFT JOIN auth_users u ON u.id=p.user_id`)
    .bind(context.providerId,hash,...times,...(command.purpose==='bind'?[context.bindingTokenHash,context.bindingUser!.id]:[context.phone]),ticket);
   statements.push(final);
   const accepted=(row:FinalRow|undefined):PhoneCommitResult|null=>{
    if(row?.status==='committed'&&row.id&&row.username){committed={id:row.id,username:row.username};return {status:'committed',userId:row.id};}
    if(row?.status==='replayed'||row?.status==='expired'||row?.status==='unauthorized'||row?.status==='not-bound')return {status:row.status};
    return null;
   };
   try{
    const results=await db.batch(statements);
    const row=results.at(-1)?.results?.[0] as FinalRow|undefined;
    const result=accepted(row);
    if(!result)throw new Error('Phone transaction outcome unavailable');
    if(result.status==='committed'){
     const expectedSessionIndex=command.purpose==='login'?2:1;
     if(results[0].meta.changes!==1||results[expectedSessionIndex].meta.changes!==1||results.at(-2)?.meta.changes!==1)throw new Error('Phone transaction effect was not confirmed');
    }
    return result;
   }catch(error){
    // A transport error may happen after a real commit. Read only this random
    // request ticket; never retry writes or infer success from an old proof ID.
    try{
     const row=await db.prepare(`SELECT 'committed' AS status,u.id,u.username FROM auth_phone_proofs p JOIN auth_users u ON u.id=p.user_id
      WHERE p.consumption_ticket=? AND ${challengeConsumed} AND ${command.purpose==='login'?`EXISTS(SELECT 1 FROM auth_sessions s WHERE s.user_id=p.user_id AND s.token_hash=? AND s.expires_at>${SQL_NOW})`:`EXISTS(SELECT 1 FROM auth_phone_bindings b WHERE b.phone=p.phone AND b.user_id=p.user_id) AND EXISTS(${liveSession})`}`)
      .bind(ticket,...consumedArgs,...(command.purpose==='login'?[context.session.tokenHash]:[context.bindingTokenHash,context.bindingUser!.id])).first<FinalRow>();
     const recovered=accepted(row??undefined);if(recovered?.status==='committed')return recovered;
     if(command.purpose==='bind'){
      const conflict=await db.prepare('SELECT 1 AS conflict FROM auth_phone_bindings WHERE (phone=? AND user_id<>?) OR (user_id=? AND phone<>?) LIMIT 1')
       .bind(context.phone,context.bindingUser!.id,context.bindingUser!.id,context.phone).first();
      if(conflict)return {status:'binding-conflict'};
     }
     const rejected=accepted((await final.first<FinalRow>())??undefined);
     if(rejected&&rejected.status!=='committed')return rejected;
    }catch{/* Unknown ACK/read failure stays unavailable; do not claim rollback. */}
    throw error;
   }
  },
 };
}
