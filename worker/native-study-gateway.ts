/**
 * Isolated M2a boundary candidate. This module is deliberately NOT registered
 * in any Worker or native bridge. Never enable it in production until the
 * auth-only service has the study schema, a bounded migration, and a native
 * session-bound transport. In particular, no request can turn this on.
 *
 * The injected handlers must be the trusted application's study handlers;
 * both they and this boundary independently verify the server session.
 */
import {authConfiguration, authJson, readProductIdentity, sameOriginMutation, type AuthEnvironment} from '../lib/auth-service';
import {readBoundedRequestBody, RequestBodyTooLargeError} from '../lib/request-body';
import {STUDY_SYNC_MAX_PAGE_BYTES, StudySyncError} from '../lib/study-sync';
import {NATIVE_M2A_PROTOCOL, readNativeStudyPage} from './native-study-page';

type Backend = {POST: (request: Request) => Promise<Response>};
type NativeEnvironment = AuthEnvironment & {LANTERN_M2A_CURSOR_KEY?:string};
type Options = {enabled?: boolean; env: NativeEnvironment; backend: Backend};
const MAX_REQUEST_BYTES = 8192;
const allowedKinds = new Set(['profile', 'attempt', 'checkin', 'questionMark', 'resourceTask']);
const unavailable = () => authJson({error:'同步暂时不可用，本机记录会保留'}, 503);
const invalid = () => authJson({error:'同步请求格式无效'}, 400);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sameKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000');
const changeFields: Record<string, readonly string[]> = {
 profile:['name','lrGoal','speakingGoal','examDate','dailyMinutes','timezone','theme','weeklyTarget','onboarded'],
 attempt:['id','qid','choice','correct','createdAt','seconds','mode'],
 checkin:['id','date','minutes','load','note','createdAt'],
 questionMark:['qid','flagged','reason','note','revision','mutationId','updatedAt'],
 resourceTask:['id','resourceId','plannedDate','status','minutes','checkinId','revision','mutationId','updatedAt'],
};
const writeFields: Record<string, readonly string[]> = {...changeFields,attempt:['id','qid','choice','createdAt','seconds']};

async function boundedResponse(response: Response): Promise<unknown> {
 if (!response.body) throw new Error('Empty backend response');
 const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
 try {
  while (true) {
   const {done,value} = await reader.read(); if (done) break;
   if (!value || value.byteLength > STUDY_SYNC_MAX_PAGE_BYTES - total) throw new Error('Backend response exceeds limit');
   total += value.byteLength; chunks.push(value);
  }
 } catch (error) { try { void reader.cancel().catch(() => {}); } catch {} throw error; }
 finally { try { reader.releaseLock(); } catch {} }
 const bytes = new Uint8Array(total); let offset = 0;
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
 return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
}

/** The caller must opt in explicitly in trusted server configuration. */
export function createNativeStudyGateway({enabled = false, env, backend}: Options) {
 return async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/study') return authJson({error:'未找到'},404);
  if (request.method !== 'GET' && request.method !== 'POST') return authJson({error:'请求方法不支持'},405);
  if (!enabled) return unavailable();
  const config = authConfiguration(env);
  if (!config || url.origin !== config.origin) return unavailable();
  // Provision a dedicated random 256-bit server-side key before any future
  // integration. It must be stable across restarts and never sent to clients.
  const keyHex = env.LANTERN_M2A_CURSOR_KEY;
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) return unavailable();
  // Native GET requests may omit both headers. An explicit same-site value
  // is insufficient: a sibling subdomain is not necessarily the same origin.
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if ((origin !== null && origin !== config.origin) || (fetchSite !== null && !['same-origin','none'].includes(fetchSite))) return authJson({error:'请求来源不匹配'},403);
  let user;
  try { user = await readProductIdentity(request.headers,env); } catch { return unavailable(); }
  if (!user) return authJson({error:'请登录后同步'},401);
  if (request.headers.get('x-lantern-owner') !== user.id) return authJson({error:'账号已切换，请刷新后重试'},409);
  try {
   if (request.method === 'GET') {
    const names = [...url.searchParams.keys()];
    if (url.searchParams.get('sync') !== NATIVE_M2A_PROTOCOL || names.some(name => !['sync','cursor','checkpoint'].includes(name)) || names.some(name => url.searchParams.getAll(name).length !== 1) || (url.searchParams.has('cursor') && url.searchParams.has('checkpoint'))) return invalid();
    // Query only allowed kinds in SQL. Filtering after an unrestricted query
    // would still disclose private record identifiers inside page cursors.
    const keyBytes=Uint8Array.from(keyHex.match(/../g)!,byte=>parseInt(byte,16));
    const key=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
    const page = await readNativeStudyPage(config.db,user.id,url,key);
    const changes = page.changes;
    if (changes.some(change => !allowedKinds.has(change.kind) || !isRecord(change.data) || !sameKeys(change.data,changeFields[change.kind]))) return unavailable();
    // Rebuild the response from a strict allowlist; do not forward arbitrary
    // backend fields, headers, recording metadata or audio under another key.
    return authJson({syncProtocol:page.syncProtocol,schemaVersion:page.schemaVersion,owner:page.owner,hasProfile:page.hasProfile,profilePolicy:page.profilePolicy,changes:changes.map(({kind,id,data})=>({kind,id,data})),nextCursor:page.nextCursor,checkpoint:page.checkpoint});
   }
   if (url.search || !sameOriginMutation(request,config.origin)) return authJson({error:'请求来源不匹配'},403);
   if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return invalid();
   const bytes = await readBoundedRequestBody(request,MAX_REQUEST_BYTES);
   let body: unknown;
   try { body = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { return invalid(); }
   if (!isRecord(body) || !(sameKeys(body,['type','data']) || sameKeys(body,['id','owner','type','data'])) || typeof body.type !== 'string' || !allowedKinds.has(body.type) || !isRecord(body.data)) return invalid();
   if ('owner' in body && (body.owner !== user.id || typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id))) return authJson({error:'账号已切换，请刷新后重试'},409);
   // The current Web profile upsert is unconditional. Replaying an older
   // offline write can overwrite a newer device's changes. Until a CAS and
   // conflict-resolution contract exist, never expose this mutation to M2a.
   if (body.type === 'profile') return authJson({code:'profile-sync-not-ready',error:'个人设置暂不支持跨设备写入'},503);
   let data = body.data;
   if (body.type === 'attempt' && sameKeys(data,changeFields.attempt)) {
    // Existing local journal stores a client prediction for correct/mode.
    // Strip it: only the authenticated server may assign either field.
    if (typeof data.correct !== 'boolean' || !['first','review'].includes(String(data.mode))) return invalid();
    data = Object.fromEntries(writeFields.attempt.map(key=>[key,data[key]]));
   }
   if (!sameKeys(data,writeFields[body.type])) return invalid();
   const forwardHeaders = new Headers(request.headers); forwardHeaders.delete('content-length');
   const forwarded = new Request(request.url,{method:'POST',headers:forwardHeaders,body:JSON.stringify({type:body.type,data})});
   const response = await backend.POST(forwarded);
   if (response.ok) {
    const result = await boundedResponse(response);
    return isRecord(result) && result.ok === true && sameKeys(result,['ok']) ? authJson({ok:true}) : unavailable();
   }
   const status = response.status >= 400 && response.status <= 599 ? response.status : 503;
   // Preserve the conflict signal needed for safe journal retry handling,
   // without copying untrusted body contents or cookies.
   const conflict = status === 409 && response.headers.get('x-lantern-conflict') === 'event-payload';
   const result = authJson(conflict ? {code:'event-payload-conflict',error:'记录标识已用于不同内容，请保留备份并检查导入来源'} : {error:'同步暂时不可用，本机记录会保留'},status);
   if (conflict) result.headers.set('X-Lantern-Conflict','event-payload');
   return result;
  } catch (error) {
   if (error instanceof RequestBodyTooLargeError) return authJson({error:'请求过大'},413);
   if (error instanceof StudySyncError) return authJson({error:'同步暂时不可用，本机记录会保留',...(error.resetRequired ? {resetRequired:true} : {})},error.status || 503);
   return unavailable();
  }
 };
}
