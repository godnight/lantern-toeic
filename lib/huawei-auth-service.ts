import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {authConfiguration,authJson,readProductIdentity,sameOriginMutation,createProductSessionMaterial,productSessionResponse,productSessionTokenHash,PRODUCT_SESSION_SECONDS,type AuthEnvironment,type ProductIdentity} from './auth-service';
import {readBoundedRequestBody} from './request-body';

const TOKEN_URL='https://oauth-login.cloud.huawei.com/oauth2/v3/token';
const INFO_URL='https://oauth-api.cloud.huawei.com/rest.php?nsp_fmt=JSON&nsp_svc=huawei.oauth2.user.getTokenInfo';
const SQL_NOW=`(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))`;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const opaque=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&/^[\x21-\x7e]+$/.test(value);
const failure=(code:string,status=503)=>authJson({code:'huawei-'+code},status);
function configuration(env:AuthEnvironment){
 const auth=authConfiguration(env),clientId=env.LANTERN_HUAWEI_CLIENT_ID,secret=env.LANTERN_HUAWEI_CLIENT_SECRET;
 return auth&&typeof clientId==='string'&&/^\d{1,64}$/.test(clientId)&&typeof secret==='string'&&secret.length>0&&secret.length<=8192?{...auth,clientId,secret}:null;
}

/** Separate discovery keeps the strict v1/v2 password/session wire unchanged. */
export function huaweiProvidersAction(request:Request,env:AuthEnvironment):Response {
 const auth=authConfiguration(env);
 if(auth&&new URL(request.url).origin!==auth.origin)return authJson({code:'invalid-origin'},403);
 const enabled=Boolean(configuration(env));
 return authJson({huaweiLogin:enabled,huaweiBinding:enabled});
}

class InvalidHuaweiCredential extends Error {}
async function providerJson(response:Response):Promise<Record<string,unknown>>{
 if(!response.ok)throw new InvalidHuaweiCredential();
 const status=response.headers.get('NSP_STATUS');
 if(status!==null&&status!=='0')throw new InvalidHuaweiCredential();
 // Token-info deliberately returns JSON under text/plain. Count bytes instead
 // of trusting MIME or Content-Length; never retain/log a raw provider reply.
 const bytes=await readBoundedRequestBody(new Request('https://provider-response.invalid',{method:'POST',body:response.body,duplex:'half'} as RequestInit),32768);
 const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!object(value)||'error' in value||'sub_error' in value||'error_description' in value)throw new InvalidHuaweiCredential();
 return value;
}

/** Server-only injection is for deterministic provider boundary tests. */
export function createHuaweiAuthService(options:Readonly<{fetch?:typeof fetch;timeoutMs?:number}>={}){
 return async function action(request:Request,purpose:'login'|'bind',env:AuthEnvironment):Promise<Response>{
  const config=configuration(env);if(!config)return failure('unavailable');
  if(!sameOriginMutation(request,config.origin))return authJson({code:'invalid-origin'},403);
  let ticket='',bindingUser:ProductIdentity|null=null;
  const bindingHash=productSessionTokenHash(request.headers);
  try{
   if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return failure('invalid-request',400);
   let input:unknown;
   try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedRequestBody(request,12288)));}catch{return failure('invalid-request',400);}
   if(!object(input)||Object.keys(input).join(',')!=='code'||!opaque(input.code,8192))return failure('invalid-request',400);
   if(purpose==='bind'){
    bindingUser=await readProductIdentity(request.headers,env);
    if(!bindingUser||!bindingHash)return failure('unauthenticated',401);
   }
   const codeHash=digest(input.code),windowStart=Math.floor(Date.now()/900000)*900000;
   ticket=randomUUID();
   // Reserve a digest BEFORE contacting Huawei: unknown exchange outcomes are
   // never retried. A shared transactional budget bounds provider work/storage.
   const reserved=await config.db.batch([
    config.db.prepare('DELETE FROM auth_huawei_codes WHERE rowid IN (SELECT rowid FROM auth_huawei_codes WHERE reserved_at<? ORDER BY reserved_at LIMIT 128)').bind(Date.now()-86400000),
    config.db.prepare(`INSERT INTO auth_huawei_codes(code_hash,ticket,purpose,reserved_at,expires_at)
     SELECT ?,?,?,${SQL_NOW},${SQL_NOW}+300000 WHERE COALESCE((SELECT count FROM auth_rate_limits WHERE scope='global:huawei' AND window_start=?),0)<100
     ON CONFLICT(code_hash) DO NOTHING`).bind(codeHash,ticket,purpose,windowStart),
    config.db.prepare(`INSERT INTO auth_rate_limits(scope,window_start,count,admission_id)
     SELECT 'global:huawei',?,1,? WHERE EXISTS(SELECT 1 FROM auth_huawei_codes WHERE ticket=?)
     ON CONFLICT(scope,window_start) DO UPDATE SET count=count+1,admission_id=excluded.admission_id WHERE count<100`).bind(windowStart,ticket,ticket),
    config.db.prepare(`DELETE FROM auth_rate_limits WHERE rowid IN (SELECT rowid FROM auth_rate_limits
     WHERE scope='global:huawei' AND window_start<? ORDER BY window_start LIMIT 128)`).bind(Date.now()-86400000)
   ]);
   if(reserved[1].meta.changes!==1){
    const used=await config.db.prepare('SELECT 1 AS used FROM auth_huawei_codes WHERE code_hash=?').bind(codeHash).first();
    return failure(used?'replayed':'too-many-attempts',used?409:429);
   }
   if(reserved[2].meta.changes!==1)return failure('unavailable');
   const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,options.timeoutMs??15000);
   request.signal.addEventListener('abort',cancel,{once:true});
   if(request.signal.aborted)controller.abort();
   let subject:string;
   try{
    const call=options.fetch??fetch;
    const token=await providerJson(await call(TOKEN_URL,{method:'POST',redirect:'manual',signal:controller.signal,
     headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:config.clientId,client_secret:config.secret,code:input.code,supportAlg:'PS256'})}));
    if(token.token_type!=='Bearer'||!opaque(token.access_token,8192)||!positive(token.expires_in))throw new InvalidHuaweiCredential();
    const info=await providerJson(await call(INFO_URL,{method:'POST',redirect:'manual',signal:controller.signal,
     headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({access_token:token.access_token,open_id:'OPENID'})}));
    if(info.client_id!==config.clientId||info.type!==0||!positive(info.expire_in)||!opaque(info.open_id,256))throw new InvalidHuaweiCredential();
    if(controller.signal.aborted)throw new Error('Provider deadline elapsed');
    subject=info.open_id;
   }catch(error){return failure(error instanceof InvalidHuaweiCredential?'invalid-credential':'unavailable',error instanceof InvalidHuaweiCredential?401:503);}
   finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);}
   if(request.signal.aborted)return failure('unavailable');
   const session=createProductSessionMaterial(request.headers),userId='usr_'+randomUUID(),username='hw_'+randomBytes(12).toString('hex');
   const active=`SELECT 1 FROM auth_huawei_codes WHERE ticket=? AND completed_at IS NULL AND expires_at>${SQL_NOW}`;
   const live=`SELECT 1 FROM auth_sessions WHERE token_hash=? AND user_id=? AND expires_at>${SQL_NOW}`;
   const mapping=`SELECT user_id FROM auth_provider_bindings WHERE provider='huawei' AND audience=? AND subject=?`;
   const statements:D1PreparedStatement[]=[];
   if(purpose==='login'){
    statements.push(config.db.prepare(`INSERT INTO auth_users(id,username,created_at) SELECT ?,?,${SQL_NOW} WHERE EXISTS(${active}) AND NOT EXISTS(${mapping})`).bind(userId,username,ticket,config.clientId,subject));
    statements.push(config.db.prepare(`INSERT INTO auth_provider_bindings(provider,audience,subject,user_id,created_at)
     SELECT 'huawei',?,?,id,${SQL_NOW} FROM auth_users WHERE id=? AND EXISTS(${active}) AND NOT EXISTS(${mapping})`).bind(config.clientId,subject,userId,ticket,config.clientId,subject));
    statements.push(config.db.prepare(`DELETE FROM auth_sessions WHERE (user_id=(${mapping}) OR token_hash=?) AND EXISTS(${active})`).bind(config.clientId,subject,session.oldTokenHash,ticket));
    statements.push(config.db.prepare(`INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at)
     SELECT ?,user_id,${SQL_NOW},${SQL_NOW}+? FROM auth_provider_bindings WHERE provider='huawei' AND audience=? AND subject=? AND EXISTS(${active})`).bind(session.tokenHash,PRODUCT_SESSION_SECONDS*1000,config.clientId,subject,ticket));
   }else{
    // Same binding is idempotent; another owner is a NOT NULL violation and
    // rolls back the entire batch. The per-user unique key also prevents swaps.
    statements.push(config.db.prepare(`INSERT INTO auth_provider_bindings(provider,audience,subject,user_id,created_at)
     SELECT 'huawei',?,?,?,${SQL_NOW} WHERE EXISTS(${active}) AND EXISTS(${live})
     ON CONFLICT(provider,audience,subject) DO UPDATE SET user_id=CASE WHEN auth_provider_bindings.user_id=excluded.user_id THEN auth_provider_bindings.user_id ELSE NULL END`)
     .bind(config.clientId,subject,bindingUser!.id,ticket,bindingHash,bindingUser!.id));
   }
   // A failed final live check deliberately violates the paired completion
   // CHECK, rolling back ALL identity, mapping and session changes in the batch.
   const confirmed=purpose==='login'?`EXISTS(SELECT 1 FROM auth_sessions WHERE token_hash=? AND user_id=(${mapping}) AND expires_at>${SQL_NOW})`:`EXISTS(${live}) AND (${mapping})=?`;
   statements.push(config.db.prepare(`UPDATE auth_huawei_codes SET completed_at=${SQL_NOW},committed_user_id=
    CASE WHEN completed_at IS NULL AND expires_at>${SQL_NOW} AND ${confirmed} THEN (${mapping}) ELSE NULL END WHERE ticket=?`)
    .bind(...(purpose==='login'?[session.tokenHash,config.clientId,subject]:[bindingHash,bindingUser!.id,config.clientId,subject,bindingUser!.id]),config.clientId,subject,ticket));
   try{
    const result=await config.db.batch(statements);
    if(result.at(-1)?.meta.changes!==1)return failure('unavailable');
   }catch{
    if(purpose==='bind'){
     const conflict=await config.db.prepare(`SELECT 1 AS conflict FROM auth_provider_bindings WHERE provider='huawei' AND audience=? AND ((subject=? AND user_id<>?) OR (user_id=? AND subject<>?)) LIMIT 1`)
      .bind(config.clientId,subject,bindingUser!.id,bindingUser!.id,subject).first();
     if(conflict)return failure('binding-conflict',409);
     const stillLive=await readProductIdentity(request.headers,env);
     if(!stillLive||stillLive.id!==bindingUser!.id)return failure('unauthenticated',401);
    }
    // A DB ACK may be lost after commit. Never repeat writes or exchange a code;
    // the caller independently rechecks session and requires a fresh auth flow.
    return failure('unavailable');
   }
   const user=await config.db.prepare(`SELECT u.id,u.username FROM auth_huawei_codes c JOIN auth_users u ON u.id=c.committed_user_id
    WHERE c.ticket=? AND c.completed_at IS NOT NULL AND c.purpose=? AND EXISTS(SELECT 1 FROM auth_provider_bindings b WHERE b.provider='huawei' AND b.audience=? AND b.subject=? AND b.user_id=u.id)`)
    .bind(ticket,purpose,config.clientId,subject).first<ProductIdentity>();
   if(!user||purpose==='bind'&&user.id!==bindingUser!.id)return failure('unavailable');
   return purpose==='login'?productSessionResponse(user,session.token):authJson({ok:true,user});
  }catch{return failure('unavailable');}
 };
}

export const huaweiAuthAction=createHuaweiAuthService();
