// Controlled same-Miniflare D1 candidate. Default disabled; no listener,
// production migration, identity shortcut, public origin or fake provider.
import {createHash,randomBytes,randomUUID,webcrypto} from 'node:crypto';

const cookieName='__Host-lantern-session=';
const syncPaths=new Set(['/candidate/sync/append','/candidate/sync/snapshot','/candidate/sync/page']);
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('\0')===[...keys].sort().join('\0');
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
const validSessionSql="EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash=? AND user_id=? AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))";
const digest=value=>createHash('sha256').update(value).digest('hex');
const randomToken=()=>randomBytes(32).toString('base64url');
function sessionHash(headers){const matches=(headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName));const token=matches.length===1?matches[0].slice(cookieName.length):'';return /^[a-f0-9]{64}$/.test(token)?digest(token):null;}
async function json(request){
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||!request.body)throw Error('invalid body');
 const reader=request.body.getReader(),chunks=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8192){await reader.cancel();throw Error('too large');}chunks.push(part.value);}}
 finally{reader.releaseLock();}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
function validEvent(event,model){
 if(!model.validVocabularyEvent(event))return false;
 return exact(event,event.type==='mark'?['id','wordId','createdAt','type','starred','revision']:event.type==='review'?['id','wordId','createdAt','type','grade']:['id','wordId','createdAt','type','reviewId','reviewHash','grade']);
}
export async function createUnifiedD1Sync({enabled=false,mf,origin,cursorKey,model}={}){
 if(enabled!==true)throw Error('sync disabled');
 if(!mf||typeof mf.getD1Database!=='function'||typeof mf.dispatchFetch!=='function'||typeof origin!=='string'||new URL(origin).origin!==origin||!origin.startsWith('https://')||
  !Buffer.isBuffer(cursorKey)||cursorKey.length!==32||typeof model?.validVocabularyEvent!=='function'||typeof model?.mergeVocabularyEvents!=='function'||typeof model?.readNativeStudyPage!=='function'||!Array.isArray(model?.QUESTIONS))throw Error('invalid sync configuration');
 const db=await mf.getD1Database('DB'),key=await webcrypto.subtle.importKey('raw',cursorKey,{name:'AES-GCM'},false,['encrypt','decrypt']);
 const questions=new Map(model.QUESTIONS.map(q=>[q.id,q]));
 async function live(hash,owner){return !!await db.prepare(`SELECT 1 AS ok WHERE ${validSessionSql}`).bind(hash,owner).first();}
 async function identify(request){
  const hash=sessionHash(request.headers);if(!hash)return null;
  const headers=new Headers({cookie:request.headers.get('cookie')});const proof=request.headers.get('x-lantern-session-proof');if(proof)headers.set('x-lantern-session-proof',proof);
  const response=await mf.dispatchFetch(origin+'/api/auth/session',{headers});if(response.status!==200)return null;
  const user=(await response.json())?.user?.id;return typeof user==='string'&&/^usr_[0-9a-f-]{36}$/.test(user)&&await live(hash,user)?{hash,owner:user}:null;
 }
 async function vocabulary(request,url,identity){
  if(request.method!=='POST'||url.search||request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')==='cross-site')return reply(403,{error:'invalid origin'});
  let body;try{body=await json(request);}catch{return reply(400,{error:'invalid body'});}
  const {owner,hash}=identity;if(body?.owner!==owner)return reply(409,{error:'owner mismatch'});
  if(url.pathname==='/candidate/sync/append'){
   if(!exact(body,['owner','event'])||!validEvent(body.event,model))return reply(400,{error:'invalid event'});
   const event=model.mergeVocabularyEvents([],[body.event])[0],text=JSON.stringify(event);
   await db.prepare(`INSERT INTO lantern_vocab_events(owner,event_id,body,revision) SELECT ?,?,?,COALESCE((SELECT MAX(revision) FROM lantern_vocab_events WHERE owner=?),0)+1 WHERE ${validSessionSql} ON CONFLICT(owner,event_id) DO NOTHING`).bind(owner,event.id,text,owner,hash,owner).run();
   if(!await live(hash,owner))return reply(401,{error:'unauthenticated'});
   const row=await db.prepare('SELECT revision,body FROM lantern_vocab_events WHERE owner=? AND event_id=?').bind(owner,event.id).first();
   if(!row||row.body!==text)return reply(409,{error:'event conflict'});
   return reply(200,{ok:true,owner,id:event.id});
  }
  if(url.pathname==='/candidate/sync/snapshot'){
   if(!exact(body,['owner','pageSize'])||!Number.isInteger(body.pageSize)||body.pageSize<1||body.pageSize>100)return reply(400,{error:'invalid snapshot'});
   const id=randomUUID(),cursor=randomToken(),now=Date.now(),expiry=now+15*60*1000;
   // The admission and cursor writes share one D1 batch and the same session.
   await db.batch([
    db.prepare(`DELETE FROM lantern_vocab_cursors WHERE snapshot_id IN (SELECT id FROM lantern_vocab_snapshots WHERE owner=? AND expires_at<=?) AND ${validSessionSql}`).bind(owner,now,hash,owner),
    db.prepare(`DELETE FROM lantern_vocab_snapshots WHERE owner=? AND expires_at<=? AND ${validSessionSql}`).bind(owner,now,hash,owner),
    db.prepare(`INSERT INTO lantern_vocab_snapshots(id,owner,upper_revision,page_size,expires_at) SELECT ?,?,COALESCE((SELECT MAX(revision) FROM lantern_vocab_events WHERE owner=?),0),?,? WHERE ${validSessionSql} AND (SELECT COUNT(*) FROM lantern_vocab_snapshots WHERE owner=?)<32`).bind(id,owner,owner,body.pageSize,expiry,hash,owner,owner),
    db.prepare(`INSERT INTO lantern_vocab_cursors(snapshot_id,token,after_revision) SELECT ?,?,0 WHERE EXISTS (SELECT 1 FROM lantern_vocab_snapshots WHERE id=? AND owner=?) AND ${validSessionSql}`).bind(id,cursor,id,owner,hash,owner),
   ]);
   const snapshot=await db.prepare(`SELECT upper_revision AS upper FROM lantern_vocab_snapshots WHERE id=? AND owner=? AND ${validSessionSql}`).bind(id,owner,hash,owner).first();
   return snapshot?reply(200,{id,owner,upper:snapshot.upper,cursor}):await live(hash,owner)?reply(429,{error:'too many snapshots'}):reply(401,{error:'unauthenticated'});
  }
  if(!exact(body,['owner','snapshot','cursor'])||typeof body.snapshot!=='string'||typeof body.cursor!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.cursor))return reply(400,{error:'invalid page'});
  const snap=await db.prepare(`SELECT s.upper_revision AS upper,s.page_size AS pageSize,c.after_revision AS after FROM lantern_vocab_snapshots s JOIN lantern_vocab_cursors c ON c.snapshot_id=s.id WHERE s.id=? AND s.owner=? AND s.expires_at>? AND c.token=? AND ${validSessionSql}`).bind(body.snapshot,owner,Date.now(),body.cursor,hash,owner).first();
  if(!snap)return await live(hash,owner)?reply(409,{error:'invalid snapshot'}):reply(401,{error:'unauthenticated'});
  const rows=(await db.prepare(`SELECT revision,body FROM lantern_vocab_events WHERE owner=? AND revision>? AND revision<=? AND ${validSessionSql} ORDER BY revision LIMIT ?`).bind(owner,snap.after,snap.upper,hash,owner,snap.pageSize+1).all()).results;
  if(!await live(hash,owner))return reply(401,{error:'unauthenticated'});
  const selected=rows.slice(0,snap.pageSize);let next=null;
  if(rows.length>snap.pageSize){const revision=selected.at(-1).revision,proposed=randomToken();
   await db.prepare(`INSERT INTO lantern_vocab_cursors(snapshot_id,token,after_revision) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM lantern_vocab_snapshots WHERE id=? AND owner=? AND expires_at>?) AND ${validSessionSql} ON CONFLICT(snapshot_id,after_revision) DO NOTHING`).bind(body.snapshot,proposed,revision,body.snapshot,owner,Date.now(),hash,owner).run();
   const found=await db.prepare(`SELECT token FROM lantern_vocab_cursors WHERE snapshot_id=? AND after_revision=? AND ${validSessionSql}`).bind(body.snapshot,revision,hash,owner).first();if(!found)return reply(401,{error:'unauthenticated'});next=found.token;
  }
  if(!await live(hash,owner))return reply(401,{error:'unauthenticated'});
  return reply(200,{owner,id:body.snapshot,upper:snap.upper,cursor:body.cursor,events:selected.map(x=>JSON.parse(x.body)),next});
 }
 async function study(request,url,identity){
  const {owner,hash}=identity;if(request.headers.get('x-lantern-owner')!==owner)return reply(409,{error:'owner mismatch'});
  if(request.method==='GET'){
   const names=[...url.searchParams.keys()];if(url.searchParams.get('sync')!=='native-m2a-v1'||names.some(n=>!['sync','cursor','checkpoint'].includes(n)||url.searchParams.getAll(n).length!==1)||url.searchParams.has('cursor')&&url.searchParams.has('checkpoint'))return reply(400,{error:'invalid request'});
   const result=await model.readNativeStudyPage(db,owner,url,key);if(!await live(hash,owner))return reply(401,{error:'unauthenticated'});return reply(200,result);
  }
  if(request.method!=='POST'||url.search||request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')==='cross-site')return reply(403,{error:'invalid origin'});
  let body;try{body=await json(request);}catch{return reply(400,{error:'invalid body'});}
  if(!exact(body,['type','data'])&&!exact(body,['id','owner','type','data']))return reply(400,{error:'invalid body'});
  if(body.owner!==undefined&&body.owner!==owner)return reply(409,{error:'owner mismatch'});
  let v=body.data;const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,stamp=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT/.test(s)&&Number.isFinite(Date.parse(s))&&Date.parse(s)<=Date.now()+300000;
  if(body.id!==undefined&&(typeof body.id!=='string'||!uuid.test(body.id)))return reply(400,{error:'invalid operation'});
  if(body.type==='attempt'){
   if(exact(v,['id','qid','choice','correct','createdAt','seconds','mode'])){if(typeof v.correct!=='boolean'||!['first','review'].includes(v.mode))return reply(400,{error:'invalid attempt'});v={id:v.id,qid:v.qid,choice:v.choice,createdAt:v.createdAt,seconds:v.seconds};}
   const q=questions.get(v?.qid);if(!exact(v,['id','qid','choice','createdAt','seconds'])||!uuid.test(v.id)||!q||!Number.isInteger(v.choice)||v.choice<0||v.choice>=q.options.length||!stamp(v.createdAt)||!Number.isInteger(v.seconds)||v.seconds<0||v.seconds>7200)return reply(400,{error:'invalid attempt'});
   const correct=Number(v.choice===q.correctIndex);
   await db.prepare(`INSERT INTO attempts(id,user_id,qid,choice,correct,created_at,seconds,mode) SELECT ?,?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE user_id=? AND qid=?) THEN 'review' ELSE 'first' END WHERE ${validSessionSql} ON CONFLICT(id) DO NOTHING`).bind(v.id,owner,v.qid,v.choice,correct,v.createdAt,v.seconds,owner,v.qid,hash,owner).run();
   if(!await live(hash,owner))return reply(401,{error:'unauthenticated'});
   const old=await db.prepare('SELECT qid,choice,correct,created_at AS createdAt,seconds FROM attempts WHERE id=? AND user_id=?').bind(v.id,owner).first();
   return old&&old.qid===v.qid&&old.choice===v.choice&&old.correct===correct&&old.createdAt===v.createdAt&&old.seconds===v.seconds?reply(200,{ok:true}):reply(409,{code:'event-payload-conflict'});
  }
  if(body.type==='checkin'){
   const d=v?.date,date=typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)?new Date(d+'T12:00:00Z'):null;
   if(!exact(v,['id','date','minutes','load','note','createdAt'])||!uuid.test(v.id)||!date||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==d||!Number.isInteger(v.minutes)||v.minutes<1||v.minutes>240||!['轻','刚好','重'].includes(v.load)||typeof v.note!=='string'||v.note.length>1000||!stamp(v.createdAt))return reply(400,{error:'invalid checkin'});
   const canonical=JSON.stringify({id:v.id,date:v.date,minutes:v.minutes,load:v.load,note:v.note,createdAt:v.createdAt});
   await db.prepare(`INSERT INTO checkins(id,user_id,body,created_at) SELECT ?,?,?,? WHERE ${validSessionSql} ON CONFLICT(id) DO NOTHING`).bind(v.id,owner,canonical,v.createdAt,hash,owner).run();
   if(!await live(hash,owner))return reply(401,{error:'unauthenticated'});const old=await db.prepare('SELECT body FROM checkins WHERE id=? AND user_id=?').bind(v.id,owner).first();
   return old?.body===canonical?reply(200,{ok:true}):reply(409,{code:'event-payload-conflict'});
  }
  return reply(503,{error:'record type not enabled'});
 }
 return Object.freeze({async fetch(request){try{
  const url=new URL(request.url);if(url.origin!==origin||!syncPaths.has(url.pathname)&&url.pathname!=='/api/study')return reply(404,{error:'not found'});
  const requestOrigin=request.headers.get('origin'),fetchSite=request.headers.get('sec-fetch-site');if(requestOrigin!==null&&requestOrigin!==origin||fetchSite!==null&&!['same-origin','none'].includes(fetchSite))return reply(403,{error:'invalid origin'});
  const identity=await identify(request);if(!identity)return reply(401,{error:'unauthenticated'});
  return syncPaths.has(url.pathname)?await vocabulary(request,url,identity):await study(request,url,identity);
 }catch(error){if(error?.name==='StudySyncError'&&[400,409,413,422,503].includes(error.status))return reply(error.status,{error:'sync unavailable',...(error.resetRequired===true?{resetRequired:true}:{})});return reply(503,{error:'sync unavailable'});}}});
}
