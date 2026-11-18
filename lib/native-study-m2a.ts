/**
 * Pure native-m2a-v1 projection candidate. NOT connected to an app, bridge,
 * localStorage or live network. The existing Web pages-v1 merge helper must
 * not be used for this protocol: a missing cloud profile must not reset local
 * settings, and native checkpoints are deliberately opaque and scoped.
 *
 * A future integration must commit data, download progress, upload acks and
 * the existing journal together under an owner-scoped cross-context lock and
 * a real account-lifecycle abort fence. A returned value alone is NOT a durable
 * or atomic commit; on uncertain/failed commit do not advance either progress.
 * That commit must compare an owner/session-scoped version against the version
 * read before projection, within the same transaction or equivalent fence.
 */
import {compareMutableRecords, DATA_SCHEMA_VERSION, validStudyDate, type StudyData, type Profile, type Attempt, type Checkin, type QuestionMark, type ResourceTask} from './study-model';
import {canonicalStudyEvent} from './study-journal';
import {parseStudySyncPage, STUDY_SYNC_MAX_PAGE_BYTES, STUDY_SYNC_PAGE_SIZE, StudySyncError} from './study-sync';

export const NATIVE_STUDY_PROTOCOL = 'native-m2a-v1' as const;
type Kind = 'profile'|'attempt'|'checkin'|'questionMark'|'resourceTask';
type WritableKind = Exclude<Kind,'profile'>;
type Change = {kind:Kind;id:string;data:unknown};
export type NativeStudyPage = {syncProtocol:typeof NATIVE_STUDY_PROTOCOL;schemaVersion:2;owner:string;hasProfile:boolean;profilePolicy:'preserve-local-when-absent';changes:Change[];nextCursor:string|null;checkpoint:string|null};
export type NativeDownload = {checkpoint:string|null;continuation:string|null;pendingProfiles:Profile[]};
export type NativePendingOperation = {id:string;owner:string;type:string;data:unknown;firstAttemptId?:string};
export type NativeUploadAck = {id:string;fingerprint:string};
export type NativeProjection = {version:1;stateVersion:number;owner:string;data:StudyData;download:NativeDownload;pendingOperations:NativePendingOperation[];uploadAcks:NativeUploadAck[]};
export type NativeStudyLease = {owner:string;signal:AbortSignal;isCurrent:()=>boolean};
/** Captured by the trusted transport before starting the associated request. */
export type NativeDownloadRequest = {owner:string;stateVersion:number;checkpoint:string|null;continuation:string|null};
export type NativePreparedUpload = {id:string;owner:string;type:WritableKind;fingerprint:string;wire:{id:string;owner:string;type:WritableKind;data:Record<string,unknown>}};
const kinds = new Set<Kind>(['profile','attempt','checkin','questionMark','resourceTask']);
const fields: Record<Kind,readonly string[]> = {
 profile:['name','lrGoal','speakingGoal','examDate','dailyMinutes','timezone','theme','weeklyTarget','onboarded'],
 attempt:['id','qid','choice','correct','createdAt','seconds','mode'],
 checkin:['id','date','minutes','load','note','createdAt'],
 questionMark:['qid','flagged','reason','note','revision','mutationId','updatedAt'],
 resourceTask:['id','resourceId','plannedDate','status','minutes','checkinId','revision','mutationId','updatedAt'],
};
const ownerPattern=/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenPattern=/^n1\.[A-Za-z0-9_-]{2086}$/;
const isRecord=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x:Record<string,unknown>,keys:readonly string[])=>Object.keys(x).sort().join('\u0000')===[...keys].sort().join('\u0000');
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const invalid=()=>new StudySyncError('同步内容无效，本机记录已保留',422);
function current(lease:NativeStudyLease,owner:string){
 if(!ownerPattern.test(owner)||lease?.owner!==owner||!lease.signal||lease.signal.aborted||typeof lease.isCurrent!=='function'||!lease.isCurrent())throw new StudySyncError('账号已切换，同步已取消',409);
}
function token(value:unknown):value is string|null{return value===null||(typeof value==='string'&&tokenPattern.test(value));}
function validateProjection(snapshot:NativeProjection,lease:NativeStudyLease){
 current(lease,snapshot?.owner);
 if(snapshot.version!==1||!Number.isSafeInteger(snapshot.stateVersion)||snapshot.stateVersion<0||snapshot.stateVersion>=Number.MAX_SAFE_INTEGER||snapshot.data?.schemaVersion!==DATA_SCHEMA_VERSION||!snapshot.download||!token(snapshot.download.checkpoint)||!token(snapshot.download.continuation)||!Array.isArray(snapshot.download.pendingProfiles)||!Array.isArray(snapshot.pendingOperations)||!Array.isArray(snapshot.uploadAcks))throw invalid();
 for(const name of ['attempts','checkins','recordings','questionMarks','resourceTasks'] as const)if(!Array.isArray(snapshot.data[name]))throw invalid();
 if(snapshot.download.pendingProfiles.length>100||snapshot.pendingOperations.some(op=>!op||op.owner!==snapshot.owner))throw invalid();
 for(const [rows,key] of [[snapshot.data.attempts,'id'],[snapshot.data.checkins,'id'],[snapshot.data.questionMarks,'qid'],[snapshot.data.resourceTasks,'id']] as const){
  const seen=new Set<string>();for(const row of rows){const value=(row as unknown as Record<string,unknown>)[key];if(typeof value!=='string'||!value||seen.has(value))throw invalid();seen.add(value);}
 }
}

/** Strict protocol check. The fabricated revisions are validation-only and
 * are never persisted or exposed; native-m2a returns changes in server order. */
export function parseNativeStudyPage(value:unknown,owner:string):NativeStudyPage {
 if(!ownerPattern.test(owner)||!isRecord(value)||!exact(value,['syncProtocol','schemaVersion','owner','hasProfile','profilePolicy','changes','nextCursor','checkpoint']))throw invalid();
 if(value.owner!==owner)throw new StudySyncError('账号已切换，同步已取消',409);
 if(value.syncProtocol!==NATIVE_STUDY_PROTOCOL||value.schemaVersion!==DATA_SCHEMA_VERSION||value.profilePolicy!=='preserve-local-when-absent'||typeof value.hasProfile!=='boolean'||!Array.isArray(value.changes)||value.changes.length>STUDY_SYNC_PAGE_SIZE||!token(value.nextCursor)||!token(value.checkpoint)||Boolean(value.nextCursor)===Boolean(value.checkpoint))throw invalid();
 let bytes:number;try{bytes=new TextEncoder().encode(JSON.stringify(value)).byteLength;}catch{throw invalid();}
 if(bytes>STUDY_SYNC_MAX_PAGE_BYTES)throw invalid();
 const changes:Change[]=[];
 for(const item of value.changes){
  if(!isRecord(item)||!exact(item,['kind','id','data'])||typeof item.kind!=='string'||!kinds.has(item.kind as Kind)||typeof item.id!=='string'||!isRecord(item.data)||!exact(item.data,fields[item.kind as Kind]))throw invalid();
  if(item.kind==='profile'&&!value.hasProfile)throw invalid();
  if(item.kind==='checkin'&&!validStudyDate(item.data.date))throw invalid();
  changes.push({kind:item.kind as Kind,id:item.id,data:item.data});
 }
 // Reuse the existing application validators while keeping native protocol
 // and private kinds separate. Per-page order is preserved with local indexes.
 parseStudySyncPage({syncProtocol:'pages-v1',schemaVersion:2,owner,hasProfile:value.hasProfile,changes:changes.map((change,index)=>({...change,revision:index+1})),nextCursor:null,checkpoint:{version:1,owner,epoch:'0'.repeat(32),revision:changes.length}},owner);
 return {syncProtocol:NATIVE_STUDY_PROTOCOL,schemaVersion:2,owner,hasProfile:value.hasProfile,profilePolicy:'preserve-local-when-absent',changes:copy(changes),nextCursor:value.nextCursor as string|null,checkpoint:value.checkpoint as string|null};
}

function immutableWire(kind:'attempt'|'checkin',value:Attempt|Checkin):string {
 const v=JSON.parse(canonicalStudyEvent(kind,value)) as Record<string,unknown>;
 return JSON.stringify(kind==='attempt'?{id:v.id,qid:v.qid,choice:v.choice,createdAt:v.createdAt,seconds:v.seconds}:v);
}
function mergeMutable<T extends QuestionMark|ResourceTask>(local:T[],incoming:T,key:(row:T)=>string):T[] {
 const result=[...local],index=result.findIndex(row=>key(row)===key(incoming));
 if(index<0)result.push(incoming);
 else if(compareMutableRecords(incoming,result[index])>0)result[index]=incoming;
 return result;
}

/** Compute a projection. The trusted transport MUST carry the exact request
 * identity captured at dispatch alongside its response; it must not recreate
 * that identity from current state on arrival. Persistence remains external. */
export function projectNativeStudyPage(snapshot:NativeProjection,value:unknown,request:NativeDownloadRequest,lease:NativeStudyLease):NativeProjection {
 validateProjection(snapshot,lease);
 if(!isRecord(request)||!exact(request,['owner','stateVersion','checkpoint','continuation'])||request.owner!==snapshot.owner||request.stateVersion!==snapshot.stateVersion||request.checkpoint!==snapshot.download.checkpoint||request.continuation!==snapshot.download.continuation)throw new StudySyncError('同步请求已过期，本机记录已保留',409);
 const page=parseNativeStudyPage(value,snapshot.owner);
 if(page.nextCursor && page.nextCursor===snapshot.download.continuation)throw new StudySyncError('同步游标未推进，本机记录已保留',422);
 // A projection must not alias mutable recordings, journal or ack arrays from
 // the caller. Snapshots are JSON-only, as required by the future store.
 const cloned=copy(snapshot),data:StudyData=cloned.data;
 const pendingProfiles=cloned.download.pendingProfiles;
 for(const change of page.changes){
  if(change.kind==='profile'){
   // Any remote settings/theme would be a visible product change. Preserve
   // local profile and retain distinct candidates for explicit future review.
   const profile=change.data as Profile;
   if(JSON.stringify(profile)!==JSON.stringify(data.profile)&&!pendingProfiles.some(old=>JSON.stringify(old)===JSON.stringify(profile))){if(pendingProfiles.length>=100)throw new StudySyncError('待确认的个人设置过多，本机记录已保留',507);pendingProfiles.push(copy(profile));}
  }else if(change.kind==='attempt'){
   const row=change.data as Attempt,index=data.attempts.findIndex(old=>old.id===row.id);
   if(index<0)data.attempts.push(row);else {
    const local=data.attempts[index];
    // A local attempt is also the exact durable fact referenced by an active
    // practice session. Server arrival order cannot rewrite its original mode.
    // A scoring disagreement must stop the page rather than accept a local
    // score as authoritative or overwrite that fact and break reconciliation.
    if(immutableWire('attempt',local)!==immutableWire('attempt',row)||local.correct!==row.correct)throw new StudySyncError('同一答题标识内容不同，本机记录已保留',422);
   }
  }else if(change.kind==='checkin'){
   const row=change.data as Checkin,index=data.checkins.findIndex(old=>old.id===row.id);
   if(index<0)data.checkins.push(row);else if(immutableWire('checkin',data.checkins[index])!==immutableWire('checkin',row))throw new StudySyncError('同一学习记录标识内容不同，本机记录已保留',422);
  }else if(change.kind==='questionMark')data.questionMarks=mergeMutable(data.questionMarks,change.data as QuestionMark,row=>row.qid);
  else data.resourceTasks=mergeMutable(data.resourceTasks,change.data as ResourceTask,row=>row.id);
 }
 current(lease,snapshot.owner);
 return {...cloned,stateVersion:cloned.stateVersion+1,data,download:{checkpoint:page.checkpoint??snapshot.download.checkpoint,continuation:page.nextCursor,pendingProfiles}};
}

/** Construct only the four permitted operations. No transport is performed. */
export async function prepareNativeUpload(operation:NativePendingOperation,lease:NativeStudyLease):Promise<NativePreparedUpload> {
 current(lease,operation?.owner);
 const before=JSON.stringify(operation),frozen=copy(operation);
 if(!uuidPattern.test(frozen.id)||!['attempt','checkin','questionMark','resourceTask'].includes(frozen.type)||!isRecord(frozen.data))throw invalid();
 const kind=frozen.type as WritableKind, data=frozen.data;
 if(frozen.firstAttemptId!==undefined&&(kind!=='attempt'||typeof frozen.firstAttemptId!=='string'||!uuidPattern.test(frozen.firstAttemptId)))throw invalid();
 // Existing validators verify authored event fields, including their shape.
 // Server owns the attempt's correct/mode; they are omitted from wire data.
 let wireData:Record<string,unknown>;
 if(kind==='attempt'){
  if(!exact(data,fields.attempt))throw invalid();immutableWire('attempt',data as Attempt);
  const {id,qid,choice,createdAt,seconds}=data;
  if(frozen.firstAttemptId!==undefined&&((data.mode==='first')!==(frozen.firstAttemptId===id)))throw invalid();
  wireData={id,qid,choice,createdAt,seconds,...(frozen.firstAttemptId?{firstAttemptId:frozen.firstAttemptId}:{})};
 }else if(kind==='checkin'){
  if(!exact(data,fields.checkin))throw invalid();immutableWire('checkin',data as Checkin);wireData=data;
 }else{
  if(!exact(data,fields[kind]))throw invalid();
  const id=kind==='questionMark'?data.qid:data.id;
  parseStudySyncPage({syncProtocol:'pages-v1',schemaVersion:2,owner:frozen.owner,hasProfile:true,changes:[{revision:1,kind,id,data}],nextCursor:null,checkpoint:{version:1,owner:frozen.owner,epoch:'0'.repeat(32),revision:1}},frozen.owner);
  wireData=data;
 }
 const wire={id:frozen.id,owner:frozen.owner,type:kind,data:wireData};
 const bytes=new TextEncoder().encode(JSON.stringify(wire));if(bytes.byteLength>8192)throw invalid();
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 current(lease,frozen.owner);
 if(JSON.stringify(operation)!==before)throw new StudySyncError('待上传记录已变化，本机记录已保留',409);
 const fingerprint=Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
 return {...wire,fingerprint,wire};
}

/** Record a validated acknowledgement separately from the download cursor.
 * Never remove a pending journal entry here; future compaction must prove the
 * local durable snapshot covers it. The caller authenticates the response. */
export async function acknowledgeNativeUpload(snapshot:NativeProjection,sent:NativePreparedUpload,response:{status:number;body:unknown},lease:NativeStudyLease):Promise<NativeProjection> {
 validateProjection(snapshot,lease);current(lease,sent?.owner);
 // Capture all mutable inputs before yielding to WebCrypto. A local comparison
 // protects this call only; the real store still needs a transactional version
 // fence to cover external tabs/processes and the interval before commit.
 const beforeSnapshot=JSON.stringify(snapshot),beforeSent=JSON.stringify(sent),beforeResponse=JSON.stringify(response);
 const frozenSnapshot=copy(snapshot),frozenSent=copy(sent),frozenResponse=copy(response);
 if(frozenSent.owner!==frozenSnapshot.owner||!Number.isInteger(frozenResponse?.status)||frozenResponse.status<200||frozenResponse.status>=300||!isRecord(frozenResponse.body)||!exact(frozenResponse.body,['ok'])||frozenResponse.body.ok!==true)throw invalid();
 const operations=frozenSnapshot.pendingOperations.filter(row=>row.id===frozenSent.id&&row.owner===frozenSnapshot.owner);
 if(operations.length!==1||frozenSent.id!==frozenSent.wire?.id||frozenSent.owner!==frozenSent.wire?.owner||frozenSent.type!==frozenSent.wire?.type)throw new StudySyncError('待上传记录已变化，本机记录已保留',409);
 const expected=await prepareNativeUpload(operations[0],lease);
 const sentBytes=new TextEncoder().encode(JSON.stringify(frozenSent.wire));if(sentBytes.byteLength>8192)throw invalid();
 const sentHash=await crypto.subtle.digest('SHA-256',sentBytes);
 const fingerprint=Array.from(new Uint8Array(sentHash),value=>value.toString(16).padStart(2,'0')).join('');
 if(expected.fingerprint!==frozenSent.fingerprint||fingerprint!==frozenSent.fingerprint)throw new StudySyncError('待上传记录已变化，本机记录已保留',409);
 const priorRows=frozenSnapshot.uploadAcks.filter(row=>row.id===frozenSent.id);if(priorRows.length>1)throw invalid();const prior=priorRows[0];
 if(prior&&prior.fingerprint!==frozenSent.fingerprint)throw new StudySyncError('上传确认与本机记录冲突',409);
 current(lease,frozenSnapshot.owner);
 if(JSON.stringify(snapshot)!==beforeSnapshot||JSON.stringify(sent)!==beforeSent||JSON.stringify(response)!==beforeResponse)throw new StudySyncError('待上传记录已变化，本机记录已保留',409);
 return prior?frozenSnapshot:{...frozenSnapshot,stateVersion:frozenSnapshot.stateVersion+1,uploadAcks:[...frozenSnapshot.uploadAcks,{id:frozenSent.id,fingerprint:frozenSent.fingerprint}]};
}
