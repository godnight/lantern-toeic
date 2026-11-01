import {DATA_SCHEMA_VERSION,DEFAULT_PROFILE,migrateStudyData,mergeData,validQuestionMark,validResourceTask,type StudyData,type Profile} from './study-model';

export const STUDY_SYNC_PROTOCOL='pages-v1' as const;
export const STUDY_SYNC_PAGE_SIZE=100;
export const STUDY_SYNC_MAX_PAGE_BYTES=256*1024;
export const STUDY_SYNC_KINDS=['profile','attempt','checkin','recording','questionMark','resourceTask'] as const;
export type StudySyncKind=typeof STUDY_SYNC_KINDS[number];
export type StudySyncCheckpoint={version:1;owner:string;epoch:string;revision:number};
export type StudySyncCursor={version:1;owner:string;epoch:string;since:number;watermark:number;after:{revision:number;kind:StudySyncKind;id:string}};
export type StudySyncState={checkpoint:StudySyncCheckpoint|null;continuation:string|null};
export type StudySyncChange={revision:number;kind:StudySyncKind;id:string;data:unknown};
export type StudySyncPage={syncProtocol:typeof STUDY_SYNC_PROTOCOL;schemaVersion:2;owner:string;hasProfile:boolean;changes:StudySyncChange[];nextCursor:string|null;checkpoint:StudySyncCheckpoint|null};
export class StudySyncError extends Error {
 constructor(message:string,public status=0,public resetRequired=false){super(message);this.name='StudySyncError';}
}
export class StudySyncSchemaError extends StudySyncError {
 constructor(public schemaVersion:unknown){super('云端学习记录版本不受支持，请更新应用后继续',409);this.name='StudySyncSchemaError';}
}
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const text=(value:unknown,max=512):value is string=>typeof value==='string'&&value.length>0&&value.length<=max;
const epoch=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const kind=(value:unknown):value is StudySyncKind=>STUDY_SYNC_KINDS.includes(value as StudySyncKind);
export function validStudyCheckpoint(value:unknown,owner:string):value is StudySyncCheckpoint {
 const c=value as StudySyncCheckpoint;return !!c&&c.version===1&&c.owner===owner&&epoch(c.epoch)&&integer(c.revision);
}
/** Read from exactly the same primary bytes as the data being merged. Invalid
 * progress metadata only requests a fresh replay; it never empties study data. */
export function studySyncStateFromSnapshot(bytes:string|null,owner:string|null):StudySyncState {
 const empty=():StudySyncState=>({checkpoint:null,continuation:null});
 if(!owner||!bytes)return empty();
 try{
  const state=(JSON.parse(bytes) as {studySync?:StudySyncState}).studySync;
  if(!state||!(state.checkpoint===null||validStudyCheckpoint(state.checkpoint,owner))||!(state.continuation===null||text(state.continuation,4096)))return empty();
  if(state.continuation){const cursor=decodeStudySyncToken(state.continuation) as StudySyncCursor;if(cursor?.owner!==owner||!epoch(cursor.epoch))return empty();}
  return {checkpoint:state.checkpoint,continuation:state.continuation};
 }catch{return empty();}
}
export function encodeStudySyncToken(value:StudySyncCheckpoint|StudySyncCursor):string {
 const bytes=new TextEncoder().encode(JSON.stringify(value));
 return btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function decodeStudySyncToken(token:string):unknown {
 if(!/^[A-Za-z0-9_-]{1,4096}$/.test(token))throw new StudySyncError('同步游标格式无效',400);
 try{const bytes=atob(token.replace(/-/g,'+').replace(/_/g,'/'));return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(bytes,char=>char.charCodeAt(0))));}
 catch{throw new StudySyncError('同步游标格式无效',400);}
}
export function parseStudySyncRequest(url:URL,owner:string,clock:{epoch:string;revision:number}):StudySyncCursor {
 if(!epoch(clock.epoch)||!integer(clock.revision))throw new StudySyncError('同步索引暂不可用',503);
 const cursorToken=url.searchParams.get('cursor'),checkpointToken=url.searchParams.get('checkpoint');
 if(cursorToken&&checkpointToken)throw new StudySyncError('同步游标参数冲突',400);
 if(cursorToken){
  const c=decodeStudySyncToken(cursorToken) as StudySyncCursor;
  if(!c||c.version!==1||!text(c.owner)||!epoch(c.epoch)||!integer(c.since)||!integer(c.watermark)||c.since>c.watermark||!c.after||!integer(c.after.revision)||c.after.revision>c.watermark||c.after.revision<c.since||!kind(c.after.kind)||!text(c.after.id))throw new StudySyncError('同步游标格式无效',400);
  if(c.owner!==owner)throw new StudySyncError('账号已切换，请重新同步',409,true);
  if(c.epoch!==clock.epoch||c.watermark>clock.revision)throw new StudySyncError('云端同步索引已重建，请保留本机记录后重新同步',409,true);
  return c;
 }
 let since=0;
 if(checkpointToken){
  const c=decodeStudySyncToken(checkpointToken) as StudySyncCheckpoint;
  if(!validStudyCheckpoint(c,owner))throw new StudySyncError('同步检查点不属于当前账号或格式无效',409,true);
  if(c.epoch!==clock.epoch||c.revision>clock.revision)throw new StudySyncError('云端同步索引已重建，请保留本机记录后重新同步',409,true);
  since=c.revision;
 }
 return {version:1,owner,epoch:clock.epoch,since,watermark:clock.revision,after:{revision:since,kind:'profile',id:''}};
}
function validChange(change:StudySyncChange):boolean {
 if(!change||!integer(change.revision)||!kind(change.kind)||!text(change.id)||!change.data||typeof change.data!=='object'||Array.isArray(change.data))return false;
 const d=change.data as Record<string,unknown>;
 if(change.kind==='profile')return validProfile(d);
 if(change.kind==='questionMark')return d.qid===change.id&&validQuestionMark(d);
 if(change.kind==='resourceTask')return d.id===change.id&&validResourceTask(d);
 if(d.id!==change.id||typeof d.createdAt!=='string'||!Number.isFinite(Date.parse(d.createdAt)))return false;
 if(change.kind==='attempt')return text(d.qid,100)&&Number.isInteger(d.choice)&&Number(d.choice)>=0&&Number(d.choice)<=3&&typeof d.correct==='boolean'&&integer(d.seconds)&&Number(d.seconds)<=7200&&(d.mode==='first'||d.mode==='review');
 if(change.kind==='checkin')return typeof d.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d.date)&&Number.isInteger(d.minutes)&&Number(d.minutes)>=1&&Number(d.minutes)<=240&&['轻','刚好','重'].includes(String(d.load))&&typeof d.note==='string'&&d.note.length<=1000;
 return typeof d.promptId==='string'&&typeof d.title==='string'&&typeof d.mime==='string'&&typeof d.duration==='number'&&Number.isFinite(d.duration)&&d.duration>=0&&d.duration<=240;
}
function validProfile(value:unknown):value is Profile {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const p=value as Profile;
 return typeof p.name==='string'&&p.name.trim().length>0&&p.name.length<=40&&Number.isInteger(p.lrGoal)&&p.lrGoal>=10&&p.lrGoal<=990&&Number.isInteger(p.speakingGoal)&&p.speakingGoal>=0&&p.speakingGoal<=200&&typeof p.examDate==='string'&&typeof p.timezone==='string'&&p.timezone.length>0&&p.timezone.length<=100&&Number.isInteger(p.dailyMinutes)&&p.dailyMinutes>=5&&p.dailyMinutes<=120&&Number.isInteger(p.weeklyTarget)&&p.weeklyTarget>=1&&p.weeklyTarget<=7&&typeof p.onboarded==='boolean'&&['paper','crystal','hollow','silk'].includes(p.theme);
}
export function parseLegacyStudySync(value:unknown,owner:string):StudyData&{owner:string;hasProfile:boolean} {
 const p=value as StudyData&{owner:string;hasProfile:boolean};
 if(!p||p.owner!==owner||typeof p.hasProfile!=='boolean')throw new StudySyncError('同步账号或响应格式无效',409);
 try{migrateStudyData(p);}catch{throw new StudySyncSchemaError(p.schemaVersion);}
 if(!validProfile(p.profile)||!Array.isArray(p.attempts)||!Array.isArray(p.checkins)||!Array.isArray(p.recordings)||![['attempt',p.attempts],['checkin',p.checkins],['recording',p.recordings]].every(([kind,rows])=>(rows as Array<{id:string}>).every(data=>validChange({revision:0,kind:kind as StudySyncKind,id:data?.id,data}))))throw new StudySyncError('同步全量响应损坏，本机记录已保留',422);
 if((p.questionMarks!==undefined&&(!Array.isArray(p.questionMarks)||!p.questionMarks.every(validQuestionMark)))||(p.resourceTasks!==undefined&&(!Array.isArray(p.resourceTasks)||!p.resourceTasks.every(validResourceTask)))||(p.schemaVersion===2&&(!Array.isArray(p.questionMarks)||!Array.isArray(p.resourceTasks))))throw new StudySyncError('同步全量响应损坏，本机记录已保留',422);
 return {...migrateStudyData(p),owner,hasProfile:p.hasProfile};
}
export function parseStudySyncPage(value:unknown,owner:string):StudySyncPage {
 const p=value as StudySyncPage;
 if(p?.owner!==owner)throw new StudySyncError('账号已切换，已停止接收同步记录',409);
 if(p.schemaVersion!==DATA_SCHEMA_VERSION)throw new StudySyncSchemaError(p.schemaVersion);
 if(p.syncProtocol!==STUDY_SYNC_PROTOCOL)throw new StudySyncError('同步格式或版本不受支持，请更新应用',409);
 if(typeof p.hasProfile!=='boolean'||!Array.isArray(p.changes)||p.changes.length>STUDY_SYNC_PAGE_SIZE||!p.changes.every(validChange)||!(p.nextCursor===null||text(p.nextCursor,4096))||!(p.checkpoint===null||validStudyCheckpoint(p.checkpoint,owner))||Boolean(p.nextCursor)===Boolean(p.checkpoint))throw new StudySyncError('同步分页内容无效，本机记录已保留',422);
 if(new TextEncoder().encode(JSON.stringify(p)).byteLength>STUDY_SYNC_MAX_PAGE_BYTES)throw new StudySyncError('同步分页超过安全大小',413);
 const entities=new Set<string>();
 for(const change of p.changes){const entity=change.kind+':'+change.id;if(entities.has(entity)||change.kind==='profile'&&change.id!==owner)throw new StudySyncError('同步分页实体重复或不属于当前账号',422);entities.add(entity);}
 for(let index=1;index<p.changes.length;index++){
  const a=p.changes[index-1],b=p.changes[index];
  if(a.revision>b.revision||a.revision===b.revision&&(a.kind>b.kind||a.kind===b.kind&&a.id>=b.id))throw new StudySyncError('同步分页顺序无效，本机记录已保留',422);
 }
 return p;
}
/** Reapplying a page is safe: immutable IDs and mutable revision ordering are retained. */
export function applyStudySyncPage(local:StudyData,page:StudySyncPage):StudyData {
 const remote=migrateStudyData(undefined);remote.profile=local.profile;
 const attempts=new Map(local.attempts.map(row=>[row.id,row])),checkins=new Map(local.checkins.map(row=>[row.id,row]));
 for(const change of page.changes){
  if(change.kind==='profile'){remote.profile=change.data as Profile;continue;}
  if(change.kind==='attempt'){
   const row=change.data as StudyData['attempts'][number],prior=attempts.get(row.id);
   // Correct and mode are assigned by the server. All client-authored wire
   // fields are immutable, including time and seconds; compare complete data.
   if(prior&&JSON.stringify([prior.id,prior.qid,prior.choice,prior.createdAt,prior.seconds])!==JSON.stringify([row.id,row.qid,row.choice,row.createdAt,row.seconds]))throw new StudySyncError('同一答题标识的云端内容不同，请保留备份后检查',422);
   remote.attempts.push(row);
  }
  else if(change.kind==='checkin'){
   const row=change.data as StudyData['checkins'][number],prior=checkins.get(row.id);
   if(prior&&JSON.stringify([prior.id,prior.date,prior.minutes,prior.load,prior.note,prior.createdAt])!==JSON.stringify([row.id,row.date,row.minutes,row.load,row.note,row.createdAt]))throw new StudySyncError('同一学习时间标识的云端内容不同，请保留备份后检查',422);
   remote.checkins.push(row);
  }
  else if(change.kind==='recording')remote.recordings.push({...change.data as StudyData['recordings'][number],uploaded:true});
  else if(change.kind==='questionMark')remote.questionMarks.push(change.data as StudyData['questionMarks'][number]);
  else remote.resourceTasks.push(change.data as StudyData['resourceTasks'][number]);
 }
 if(!page.hasProfile)remote.profile={...DEFAULT_PROFILE};
 return mergeData(local,remote);
}
export function studySyncUrl(state:StudySyncState):string {
 const params=new URLSearchParams({sync:STUDY_SYNC_PROTOCOL});
 if(state.continuation)params.set('cursor',state.continuation);
 else if(state.checkpoint)params.set('checkpoint',encodeStudySyncToken(state.checkpoint));
 return '/api/study?'+params;
}
/** commitPage MUST durably merge the page and its nextState in one snapshot write.
 * A failed/uncertain commit must return false or throw, so no later request runs.
 * Keeping continuation with that snapshot makes a bounded run resumable. */
export async function fetchStudySyncPages(options:{owner:string;state:StudySyncState;isCurrent:()=>boolean;request:(url:string)=>Promise<{response:Response;payload:unknown}>;commitPage:(page:StudySyncPage,nextState:StudySyncState)=>boolean|Promise<boolean>;maxPages?:number}):Promise<{state:StudySyncState;complete:boolean;pages:number;legacy?:StudyData&{owner:string;hasProfile:boolean}}> {
 let state=options.state;const budget=Math.max(1,Math.min(100,options.maxPages??20));
 for(let pageNumber=0;pageNumber<budget;pageNumber++){
  if(!options.isCurrent())throw new StudySyncError('账号已切换，同步已取消',409);
  const {response,payload}=await options.request(studySyncUrl(state));
  if(!options.isCurrent())throw new StudySyncError('账号已切换，同步已取消',409);
  if(!response.ok)throw new StudySyncError('同步暂时不可用，本机记录已保留',response.status,!!(payload as {resetRequired?:unknown}|null)?.resetRequired);
  if(!(payload as {syncProtocol?:unknown}|null)?.syncProtocol){
   if(pageNumber!==0||state.continuation)throw new StudySyncError('同步协议在分页期间发生变化，请稍后重试',409);
   const legacy=parseLegacyStudySync(payload,options.owner);return {state:{checkpoint:null,continuation:null},complete:true,pages:0,legacy};
  }
  const page=parseStudySyncPage(payload,options.owner);
  if(page.nextCursor&&page.nextCursor===state.continuation)throw new StudySyncError('同步游标未推进，请稍后重试',422);
  const nextState:StudySyncState={checkpoint:page.checkpoint??state.checkpoint,continuation:page.nextCursor};
  if(!options.isCurrent())throw new StudySyncError('账号已切换，同步已取消',409);
  if(!await options.commitPage(page,nextState))throw new StudySyncError('同步分页未能保存，原记录和游标已保留',507);
  state=nextState;
  if(!page.nextCursor)return {state,complete:true,pages:pageNumber+1};
 }
 return {state,complete:false,pages:budget};
}
