import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {hashPassword, verifyPassword, normalizeUsername, validatePassword, PasswordHashBusyError} from './password-credential';

export type AuthEnvironment = {DB?:D1Database; LANTERN_AUTH_ENABLED?:string; LANTERN_AUTH_ORIGIN?:string};
export type ProductIdentity = {id:string;username:string};
const COOKIE='__Host-lantern-session';
const SESSION_SECONDS=12*60*60;
const MAX_BODY_BYTES=2048;
const capabilities={passwordLogin:true,phoneLogin:false,passwordRecovery:false} as const;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');

/** Server runtime only; no request flag or development identity can enable auth. */
export function authConfiguration(env:AuthEnvironment){
 if(env.LANTERN_AUTH_ENABLED!=='true'||!env.DB||!env.LANTERN_AUTH_ORIGIN)return null;
 try{
  const url=new URL(env.LANTERN_AUTH_ORIGIN);
  if(url.origin!==env.LANTERN_AUTH_ORIGIN||url.protocol!=='https:')return null;
  return {db:env.DB,origin:url.origin};
 }catch{return null;}
}
export function authJson(data:unknown,status=200){
 return Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
}
const unavailable=()=>authJson({code:'auth-unavailable',error:'账号服务尚未配置或暂不可用；本机记录保留'},503);
const denied=()=>authJson({code:'unauthenticated',error:'请通过真实账号登录'},401);
const loginFailed=()=>authJson({code:'invalid-credentials',error:'用户名或密码不正确'},401);
const registrationFailed=()=>authJson({code:'registration-not-accepted',error:'无法注册，请检查用户名和密码要求或选择其他用户名'},400);
export function sessionToken(headers:Headers):string|null {
 const found=(headers.get('cookie')||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(COOKIE+'='));
 if(found.length!==1)return null;
 const value=found[0].slice(COOKIE.length+1);
 return /^[a-f0-9]{64}$/.test(value)?value:null;
}
function cookie(value:string,seconds:number){return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;}
/** Caller gets a DB-verified stable product ID, never an editable owner or phone. */
export async function readProductIdentity(headers:Headers,env:AuthEnvironment):Promise<ProductIdentity|null>{
 const config=authConfiguration(env),token=sessionToken(headers);
 if(!config||!token)return null;
 const row=await config.db.prepare(`SELECT u.id,u.username FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id
  WHERE s.token_hash=? AND s.expires_at>?`).bind(digest(token),Date.now()).first<ProductIdentity>();
 return row&&/^usr_[0-9a-f-]{36}$/.test(row.id)?{id:row.id,username:row.username}:null;
}
export function sameOriginMutation(request:Request,expectedOrigin?:string){
 const origin=new URL(request.url).origin;
 return (!expectedOrigin||origin===expectedOrigin)&&request.headers.get('origin')===origin&&request.headers.get('sec-fetch-site')!=='cross-site';
}
async function readCredentials(request:Request):Promise<{username:unknown;password:unknown}|null>{
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||!request.body)return null;
 const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY_BYTES){await reader.cancel();return null;}chunks.push(value);}
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return null;}
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const record=value as Record<string,unknown>;
 if(Object.keys(record).sort().join(',')!=='password,username')return null;
 return {username:record.username,password:record.password};
}
/** Shared D1 atomic buckets: no in-process counters or untrusted client IPs. */
async function throttle(db:D1Database,action:'login'|'register',username:string){
 const now=Date.now(),windowMs=15*60*1000,windowStart=Math.floor(now/windowMs)*windowMs;
 await db.prepare('DELETE FROM auth_rate_limits WHERE window_start < ?').bind(now-24*60*60*1000).run();
 // Reject exhausted usernames before spending the shared CPU safety budget.
 const buckets=[{scope:`${action}:username:${digest(username)}`,limit:5},{scope:'global:credentials',limit:100}];
 if(action==='register')buckets.push({scope:'global:register',limit:20});
 for(const bucket of buckets){
  const row=await db.prepare(`INSERT INTO auth_rate_limits(scope,window_start,count) VALUES(?,?,1)
   ON CONFLICT(scope,window_start) DO UPDATE SET count=count+1 RETURNING count`).bind(bucket.scope,windowStart).first<{count:number}>();
  if(!row||row.count>bucket.limit){
   const response=authJson({code:'too-many-attempts',error:'尝试次数过多，请稍后再试'},429);
   response.headers.set('Retry-After',String(Math.max(1,Math.ceil((windowStart+windowMs-now)/1000))));return response;
  }
 }
 return null;
}
export async function credentialAction(request:Request,action:'login'|'register',env:AuthEnvironment):Promise<Response>{
 const config=authConfiguration(env);if(!config)return unavailable();
 if(!sameOriginMutation(request,config.origin))return authJson({code:'invalid-origin',error:'请求来源不匹配'},403);
 try{
  const input=await readCredentials(request);
  const normalized=normalizeUsername(input?.username);
  if(!input||!normalized.ok||!validatePassword(input.password).ok)return action==='login'?loginFailed():registrationFailed();
  // Malformed input never spends the shared expensive-hash budget or creates buckets.
  const limited=await throttle(config.db,action,normalized.username);if(limited)return limited;
  const password=input.password as string,username=normalized.username,now=Date.now();
  const token=randomBytes(32).toString('hex'),tokenHash=digest(token),oldToken=sessionToken(request.headers);
  const oldHash=oldToken?digest(oldToken):'';
  if(action==='register'){
   const user={id:'usr_'+randomUUID(),username},passwordHash=await hashPassword(password);
   // A duplicate normalized username creates no credential, session or old-session deletion.
   const result=await config.db.batch([
    config.db.prepare('INSERT INTO auth_users(id,username,created_at) VALUES(?,?,?) ON CONFLICT(username) DO NOTHING').bind(user.id,username,now),
    config.db.prepare('INSERT INTO auth_password_credentials(user_id,password_hash) SELECT id,? FROM auth_users WHERE id=?').bind(passwordHash,user.id),
    config.db.prepare('DELETE FROM auth_sessions WHERE (user_id=? OR token_hash=?) AND EXISTS(SELECT 1 FROM auth_users WHERE id=?)').bind(user.id,oldHash,user.id),
    config.db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) SELECT ?,id,?,? FROM auth_users WHERE id=?').bind(tokenHash,now,now+SESSION_SECONDS*1000,user.id),
    config.db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now)
   ]);
   if(!result[0].meta.changes)return registrationFailed();
   const response=authJson({user,capabilities});response.headers.set('Set-Cookie',cookie(token,SESSION_SECONDS));return response;
  }
  const stored=await config.db.prepare(`SELECT u.id,u.username,c.password_hash FROM auth_users u
   JOIN auth_password_credentials c ON c.user_id=u.id WHERE u.username=?`).bind(username).first<ProductIdentity&{password_hash:string}>();
  // An unknown username still pays the same scrypt work; no fixed usable password.
  const valid=stored?await verifyPassword(password,stored.password_hash):(await hashPassword(password),false);
  if(!stored||!valid)return loginFailed();
  await config.db.batch([
   config.db.prepare('DELETE FROM auth_sessions WHERE user_id=? OR token_hash=?').bind(stored.id,oldHash),
   config.db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').bind(tokenHash,stored.id,now,now+SESSION_SECONDS*1000),
   config.db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now)
  ]);
  const response=authJson({user:{id:stored.id,username:stored.username},capabilities});response.headers.set('Set-Cookie',cookie(token,SESSION_SECONDS));return response;
 }catch(error){
  if(error instanceof PasswordHashBusyError){
   const response=authJson({code:'auth-busy',error:'账号验证繁忙，请稍后重试'},429);
   response.headers.set('Retry-After','1');return response;
  }
  return unavailable();
 }
}
export async function sessionAction(request:Request,action:'read'|'logout',env:AuthEnvironment):Promise<Response>{
 const config=authConfiguration(env);if(!config)return unavailable();
 if(new URL(request.url).origin!==config.origin)return authJson({code:'invalid-origin',error:'请求来源不匹配'},403);
 if(action==='logout'&&!sameOriginMutation(request,config.origin))return authJson({code:'invalid-origin',error:'请求来源不匹配'},403);
 try{
  if(action==='read'){
   const user=await readProductIdentity(request.headers,env);return user?authJson({user,capabilities}):denied();
  }
  const token=sessionToken(request.headers);
  // No fallback identity; database failure never reports a successful revocation.
  if(token)await config.db.prepare('DELETE FROM auth_sessions WHERE user_id=(SELECT user_id FROM auth_sessions WHERE token_hash=?)').bind(digest(token)).run();
  const response=authJson({ok:true});response.headers.set('Set-Cookie',cookie('',0));return response;
 }catch{return unavailable();}
}
