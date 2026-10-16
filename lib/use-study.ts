'use client';
import {useState,useEffect,useRef,useCallback} from 'react';
import {toast} from 'sonner';
import {createId,EMPTY_DATA,migrateStudyData,mergeData,mergeMutableRecords,validQuestionMark,validResourceTask,validStudyDate,compareMutableRecords,uniqueById,type StudyData,type Profile,type Theme,type Attempt,type Checkin,type Recording,type QuestionMark,type ResourceTask} from './study-model';
import {restoreStudyBackup} from './study-backup';
type Op={id:string;owner:string|null;type:'profile'|'theme'|'attempt'|'checkin'|'questionMark'|'resourceTask';data:Profile|{theme:Theme}|Attempt|Checkin|QuestionMark|ResourceTask};
type ProfileSetup={version:1;state:'suggested'|'skipped'|'existing'|'confirmed';timezone:string;timezoneSource?:'device'|'fallback'|'user'|'existing'};
function storedSetup(key:string):ProfileSetup|null{const bytes=localStorage.getItem(key+':setup');if(bytes===null)return null;const value=JSON.parse(bytes) as ProfileSetup;if(value.version!==1||!['suggested','skipped','existing','confirmed'].includes(value.state)||typeof value.timezone!=='string')throw Error('首次设置状态无法读取，原记录保留');new Intl.DateTimeFormat('en',{timeZone:value.timezone});return value;}
function initializeSetup(key:string):ProfileSetup{
 const prior=storedSetup(key);if(prior)return prior;
 // Called only after strict primary validation, before automatic sync writes a summary.
 const existing=localStorage.getItem(key)!==null||localStorage.getItem(key+':profile')!==null||journal(key).some(op=>op.type==='profile');
 let timezone='Etc/UTC',timezoneSource:ProfileSetup['timezoneSource']=existing?'existing':'fallback';if(!existing){try{const candidate=new Intl.DateTimeFormat().resolvedOptions().timeZone;new Intl.DateTimeFormat('en',{timeZone:candidate});timezone=candidate;timezoneSource='device';}catch{/* visible UTC fallback */}}
 const value:ProfileSetup={version:1,state:existing?'existing':'suggested',timezone,timezoneSource};if(!existing)localStorage.setItem(key+':setup',JSON.stringify(value));return value;
}
function openAudioDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open('lantern-audio',1);r.onupgradeneeded=()=>r.result.createObjectStore('audio');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function putAudio(key:string,blob:Blob){
 const db=await openAudioDB();
 return new Promise<void>((resolve,reject)=>{
  let settled=false;
  const finish=(ok:boolean,error?:unknown)=>{
   if(settled)return;settled=true;
   try{db.close();}catch(closeError){reject(closeError);return;}
   if(ok)resolve();else reject(error||Error('本机音频事务未完成，请保留录音后重试'));
  };
  try{
   const tx=db.transaction('audio','readwrite');
   tx.oncomplete=()=>finish(true);tx.onerror=()=>finish(false,tx.error);tx.onabort=()=>finish(false,tx.error);
   tx.objectStore('audio').put(blob,key);
  }catch(error){finish(false,error);}
 });
}
export async function getAudio(key:string):Promise<Blob|undefined>{const db=await openAudioDB();return new Promise((resolve,reject)=>{const tx=db.transaction('audio');const r=tx.objectStore('audio').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
// Each operation has its own storage key. Concurrent tabs cannot overwrite another
// operation, even if their summary snapshots race. Acknowledgements are separate.
function journal(key:string):Op[]{const result:Op[]=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(key+':op:')){try{result.push(JSON.parse(localStorage.getItem(k)||''));}catch{}}}return result;}
// Fixed legacy events have a single canonical payload, independent of property
// insertion order. Read bridges return the complete record, never just an ID.
function immutablePayload(type:'attempt'|'checkin',value:unknown):string{
 if(!value||typeof value!=='object')throw Error('学习事件格式无效');
 if(type==='attempt'){
  const a=value as Attempt;
  if(typeof a.id!=='string'||!a.id||typeof a.qid!=='string'||!a.qid||!Number.isInteger(a.choice)||a.choice<0||a.choice>3||typeof a.correct!=='boolean'||typeof a.createdAt!=='string'||!Number.isFinite(Date.parse(a.createdAt))||!Number.isInteger(a.seconds)||a.seconds<0||a.seconds>7200||!['first','review'].includes(a.mode))throw Error('答题事件格式无效');
  return JSON.stringify({id:a.id,qid:a.qid,choice:a.choice,correct:a.correct,createdAt:a.createdAt,seconds:a.seconds,mode:a.mode});
 }
 const c=value as Checkin;
 if(typeof c.id!=='string'||!c.id||typeof c.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(c.date)||!Number.isInteger(c.minutes)||c.minutes<1||c.minutes>240||!['轻','刚好','重'].includes(c.load)||typeof c.note!=='string'||c.note.length>1000||typeof c.createdAt!=='string'||!Number.isFinite(Date.parse(c.createdAt)))throw Error('打卡事件格式无效');
 return JSON.stringify({id:c.id,date:c.date,minutes:c.minutes,load:c.load,note:c.note,createdAt:c.createdAt});
}
function readImmutableRecord(key:string,owner:string|null,type:'attempt',id:string):Attempt|undefined;
function readImmutableRecord(key:string,owner:string|null,type:'checkin',id:string):Checkin|undefined;
function readImmutableRecord(key:string,owner:string|null,type:'attempt'|'checkin',id:string):Attempt|Checkin|undefined{
 // Validate the main snapshot and future-schema guard before examining journals.
 const saved=readPrimarySnapshot(key);
 const matches:Array<Attempt|Checkin>=(type==='attempt'?saved.attempts:saved.checkins).filter(item=>item.id===id);
 for(let i=0;i<localStorage.length;i++){
  const name=localStorage.key(i);if(!name?.startsWith(key+':op:'))continue;
  // A malformed journal is uncertain, so a bridge cannot confirm an event by
  // silently ignoring those bytes. Existing non-bridge readers stay compatible.
  const op=JSON.parse(localStorage.getItem(name)||'null') as Op|null;
  if(!op||typeof op!=='object')throw Error('学习事件日志损坏，原始记录已保留');
  if(op.owner===owner&&op.type===type&&(op.data as Attempt|Checkin)?.id===id)matches.push(op.data as Attempt|Checkin);
 }
 let payload:string|undefined;
 for(const item of matches){const next=immutablePayload(type,item);if(payload!==undefined&&payload!==next)throw Error('同一学习事件标识存在不同内容，已停止确认');payload=next;}
 return payload===undefined?undefined:JSON.parse(payload);
}
function readPrimarySnapshot(key:string):StudyData{
 // Missing storage is a new learner. Invalid bytes/envelopes are never an empty
 // learner: leave the original key untouched and let the hook block all writes.
 const requiredBytes=localStorage.getItem(key+':required-schema');
 if(requiredBytes!==null)migrateStudyData(JSON.parse(requiredBytes));
 const bytes=localStorage.getItem(key);let raw:unknown;
 if(bytes!==null){
  const snapshot=JSON.parse(bytes);
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||!snapshot.data||typeof snapshot.data!=='object'||Array.isArray(snapshot.data))throw Error('学习记录快照损坏，原始记录已保留');
  raw=snapshot.data;
 }
 return migrateStudyData(raw);
}
function readSnapshot(key:string):StudyData{
 const parse=(name:string)=>{try{return JSON.parse(localStorage.getItem(name)||'null');}catch{return null;}};
 const d=readPrimarySnapshot(key);
 for(const op of journal(key)){
  // Acknowledged operations also repair a summary that lost a cross-tab race.
  if(op?.type==='questionMark'&&validQuestionMark(op.data)){d.questionMarks=mergeMutableRecords([...d.questionMarks,op.data]);continue;}
  if(op?.type==='resourceTask'&&validResourceTask(op.data)){d.resourceTasks=mergeMutableRecords([...d.resourceTasks,op.data]);continue;}
  if(!op?.data||typeof (op.data as Attempt).id!=='string')continue;
  if(op.type==='attempt'&&!d.attempts.some(a=>a.id===(op.data as Attempt).id))d.attempts=uniqueById([...d.attempts,op.data as Attempt]);
  if(op.type==='checkin'&&!d.checkins.some(c=>c.id===(op.data as Checkin).id))d.checkins=uniqueById([...d.checkins,op.data as Checkin]);
 }
 const profileBytes=localStorage.getItem(key+':profile');
 if(profileBytes!==null){
  try{const profile=JSON.parse(profileBytes);if(!profile||typeof profile.name!=='string'||!profile.name.trim()||typeof profile.timezone!=='string')throw Error('invalid profile');new Intl.DateTimeFormat('en',{timeZone:profile.timezone});d.profile={...d.profile,...profile};}
  catch{const bytes=localStorage.getItem(key);const primary=bytes===null?null:JSON.parse(bytes)?.data?.profile;if(!primary||typeof primary.name!=='string'||typeof primary.timezone!=='string')throw Error('学习偏好无法读取，原始记录已保留');new Intl.DateTimeFormat('en',{timeZone:primary.timezone});}
 }
 const setup=storedSetup(key);if(setup&&(setup.state==='suggested'||setup.state==='skipped')&&!d.profile.onboarded)d.profile={...d.profile,timezone:setup.timezone};
 for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(key+':recording:')){const rec=parse(k);if(rec&&typeof rec.id==='string')d.recordings=uniqueById([...d.recordings,rec]);}}
 return d;
}
export type SyncIssue={id:string;kind:'op'|'recording'|'session';status:'waiting'|'blocked'|'auth'|'missing';attempts:number;nextRetryAt:number;reason:string;httpStatus?:number};
function syncIssues(key:string):SyncIssue[]{const result:SyncIssue[]=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(key+':sync:')){try{const item=JSON.parse(localStorage.getItem(k)||'');const complete=item.kind==='op'?localStorage.getItem(key+':ack:'+item.id):item.kind==='recording'?JSON.parse(localStorage.getItem(key+':recording:'+item.id)||'null')?.uploaded:false;if(!complete)result.push(item);}catch{}}}return result;}
export function useStudy(owner:string|null){
 const key='lantern-v1-'+(owner||'device');const generation=useRef(0);const activeKey=useRef(key);const renderKey=useRef(key);renderKey.current=key;const syncing=useRef(false);const dirty=useRef(false);const readOnly=useRef(false);const remoteReadOnly=useRef(false);const retryTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [data,setData]=useState<StudyData>(EMPTY_DATA);const current=useRef(data);const [ready,setReady]=useState(false);const [sync,setSync]=useState<'loading'|'synced'|'local'|'pending'|'blocked'>('loading');const [issues,setIssues]=useState<SyncIssue[]>([]);
 const [remoteRead,setRemoteRead]=useState<{key:string;state:'unverified'|'confirmed'|'failed'}>({key,state:'unverified'});
 const requestControllers=useRef(new Set<AbortController>());
 const [profileSetup,setProfileSetup]=useState<ProfileSetup|null>(null);
 const blockReads=useCallback(()=>{
  readOnly.current=true;generation.current++;syncing.current=false;dirty.current=false;for(const controller of requestControllers.current)controller.abort();requestControllers.current.clear();
  if(retryTimer.current){clearTimeout(retryTimer.current);retryTimer.current=null;}
  setSync('blocked');toast.error('学习记录无法读取或版本不受支持，已停止写入并保留原始记录；请保留记录后重试');
 },[]);
 const persist=useCallback((d:StudyData):boolean=>{
  if(activeKey.current!==key||renderKey.current!==key||readOnly.current)return false;
  let stored:StudyData;try{stored=readSnapshot(key);}catch{blockReads();return false;}
  const next=mergeData(stored,d);
  try{localStorage.setItem(key,JSON.stringify({data:next}));}catch{setSync('blocked');toast.error('本机存储空间不足，保存未完成；请保留记录后重试');return false;}
  current.current=next;setData(next);return true;
 },[key,blockReads]);
 const syncNow=useCallback(async function runSync(){
  if(activeKey.current!==key||renderKey.current!==key||remoteReadOnly.current)return;
  try{
   const saved=readSnapshot(key);
   // Recovery only revalidates externally repaired bytes; it never deletes or
   // replaces a bad snapshot. Unsupported schema guards must still pass here.
   if(readOnly.current){readOnly.current=false;current.current=saved;setData(saved);setIssues(syncIssues(key));}
  }catch{blockReads();return;}
  if(syncing.current){dirty.current=true;return;}
  const gen=generation.current;const valid=()=>gen===generation.current&&activeKey.current===key&&renderKey.current===key;
  if(retryTimer.current){clearTimeout(retryTimer.current);retryTimer.current=null;}
  if(!owner){setSync('local');return;}
  const stateKey=(kind:SyncIssue['kind'],id:string)=>key+':sync:'+kind+':'+id;
  const state=(kind:SyncIssue['kind'],id:string)=>{try{return JSON.parse(localStorage.getItem(stateKey(kind,id))||'null') as SyncIssue|null;}catch{return null;}};
  const eligible=(kind:SyncIssue['kind'],id:string)=>{const s=state(kind,id);return !s||(s.status==='waiting'&&s.nextRetryAt<=Date.now());};
  const clear=(kind:SyncIssue['kind'],id:string)=>localStorage.removeItem(stateKey(kind,id));
  const failure=(kind:SyncIssue['kind'],id:string,status:number,reason?:string,retryAfter?:string|null)=>{
   if(kind==='session')setRemoteRead({key,state:'failed'});
   readSnapshot(key);
   if((kind==='op'&&localStorage.getItem(key+':ack:'+id))||(kind==='recording'&&readSnapshot(key).recordings.some(r=>r.id===id&&r.uploaded))){clear(kind,id);return;}
   const attempts=(state(kind,id)?.attempts||0)+1;
   const auth=[401,403,409].includes(status);const retryable=status===0||[408,425,429].includes(status)||status>=500;
   const retryDate=retryAfter?(Number.isFinite(Number(retryAfter))?Date.now()+Number(retryAfter)*1000:Date.parse(retryAfter)):0;
   const nextRetryAt=Math.max(Date.now()+(attempts===1?5000:30000),Number.isFinite(retryDate)?retryDate:0);
   const item:SyncIssue={id,kind,attempts,status:auth?'auth':reason?(kind==='recording'?'missing':'blocked'):retryable&&attempts<3?'waiting':'blocked',nextRetryAt,httpStatus:status,
    reason:reason||(status===401?'登录已失效，账号同步暂停；本机已保存记录保留，请恢复真实登录':status===403?'当前账号无权访问此服务；本机记录保留，请核对访问权限':status===409?'账号身份已变化，旧账号同步已暂停；请核对账号，不会转入访客记录':status===413?'内容超过上传大小限制':status===400||status===422?'这条记录的格式未被服务器接受':status===415?'录音格式未被服务器接受':retryable?(attempts<3?'网络或服务暂不可用，将稍后重试':'已尝试3次，请稍后手动重试'):'服务器拒绝了这条记录，请检查后重试')};
   localStorage.setItem(stateKey(kind,id),JSON.stringify(item));
   return item;
  };
  const pending=()=>journal(key).filter(op=>op.owner===owner&&!localStorage.getItem(key+':ack:'+op.id));
  const updateStatus=()=>{const list=syncIssues(key);setIssues(list);setSync(list.some(x=>x.status!=='waiting')?'blocked':pending().length||current.current.recordings.some(r=>!r.uploaded)?'pending':'synced');};
  if(!navigator.onLine){setIssues(syncIssues(key));setSync('local');return;}
  if(!eligible('session','account')){updateStatus();const item=state('session','account');if(item?.status==='waiting')retryTimer.current=setTimeout(()=>void runSync(),Math.min(2147483647,Math.max(100,item.nextRetryAt-Date.now())));return;}
  syncing.current=true;setSync('loading');let budget=30;let stopped=false;let storageFailed=false;
  const persistForSync=(d:StudyData)=>{const saved=persist(d);if(!saved)storageFailed=true;return saved;};
  // A hung connection must not hold the queue forever. Abort only this request.
  const request=async(url:string,init?:RequestInit,readBody=false)=>{const controller=new AbortController();requestControllers.current.add(controller);const timer=setTimeout(()=>controller.abort(),25000);try{const response=await fetch(url,{...init,signal:controller.signal});const payload=readBody&&response.ok?await response.json():null;return {response,payload};}finally{clearTimeout(timer);requestControllers.current.delete(controller);}};
  try{
   for(let round=0;round<3;round++){
    dirty.current=false;
    const waitingForCheckin:Op[]=[];
    for(const op of pending()){
     // A task may link to a checkin restored or created in the same offline batch.
     // Wait for its acknowledgement instead of turning a temporary upload failure
     // into a permanently rejected dependent task.
     if(op.type==='resourceTask'&&pending().some(parent=>parent.type==='checkin'&&(parent.data as Checkin).id===(op.data as ResourceTask).checkinId)){waitingForCheckin.push(op);continue;}
     if(!valid())return;if(!eligible('op',op.id))continue;if(budget--<=0){dirty.current=true;break;}
     const outgoing=op.type==='profile'?{...op,data:readSnapshot(key).profile}:op.type==='theme'?{...op,data:{theme:readSnapshot(key).profile.theme}}:op;
     let r:Response;try{r=(await request('/api/study',{method:'POST',headers:{'Content-Type':'application/json','X-Lantern-Owner':owner},body:JSON.stringify(outgoing)})).response;}catch{if(!valid())return;failure('op',op.id,0);continue;}
     if(!valid())return;readSnapshot(key);if(!r.ok){
      if(r.status===409&&r.headers?.get('X-Lantern-Conflict')==='event-payload'&&(op.type==='attempt'||op.type==='checkin')){failure('op',op.id,422,'同一事件标识的内容与云端不同，请保留备份后检查；该记录未同步');continue;}
      if([401,403,409].includes(r.status)){failure('session','account',r.status);stopped=true;break;}failure('op',op.id,r.status,undefined,r.headers?.get('Retry-After'));continue;
     }
     if(op.type==='theme'){
      const latest=readSnapshot(key).profile.theme;
      if((outgoing.data as {theme:Theme}).theme!==latest){
       // Another tab may have acknowledged this operation while our older
       // request was still in flight. Reassert the newest durable choice.
       const repair:Op={id:createId(),owner,type:'theme',data:{theme:latest}};
       localStorage.setItem(key+':op:'+repair.id,JSON.stringify(repair));dirty.current=true;
      }
     }
     localStorage.setItem(key+':ack:'+op.id,'1');clear('op',op.id);
    }
    if(waitingForCheckin.some(op=>!pending().some(parent=>parent.type==='checkin'&&(parent.data as Checkin).id===(op.data as ResourceTask).checkinId)))dirty.current=true;
    if(stopped||!valid())break;
    if(!persistForSync(mergeData(current.current,readSnapshot(key))))return;
    for(const rec of current.current.recordings.filter(x=>!x.uploaded)){
     if(!valid())return;if(!eligible('recording',rec.id))continue;if(budget--<=0){dirty.current=true;break;}
     let blob:Blob|undefined;try{blob=await getAudio(key+':'+rec.id);}catch{if(!valid())return;failure('recording',rec.id,0,'本机音频读取失败，请重试');continue;}
     if(!valid())return;readSnapshot(key);if(!blob){failure('recording',rec.id,0,'找不到本机音频，云端副本尚未确认');continue;}
     const form=new FormData();form.append('audio',blob,'recording.'+(blob.type.includes('mp4')?'m4a':'webm'));form.append('meta',JSON.stringify(rec));
     let r:Response;try{r=(await request('/api/recordings',{method:'POST',headers:{'X-Lantern-Owner':owner},body:form})).response;}catch{if(!valid())return;failure('recording',rec.id,0);continue;}
     if(!valid())return;readSnapshot(key);if(!r.ok){if([401,403,409].includes(r.status)){failure('session','account',r.status);stopped=true;break;}failure('recording',rec.id,r.status,undefined,r.headers?.get('Retry-After'));continue;}
     localStorage.setItem(key+':recording:'+rec.id,JSON.stringify({...rec,uploaded:true}));clear('recording',rec.id);if(!persistForSync({...current.current,recordings:current.current.recordings.map(x=>x.id===rec.id?{...x,uploaded:true}:x)}))return;
    }
    if(stopped||!valid())break;
    const profileBeforeRead=readSnapshot(key).profile;
    const {response:r,payload}=await request('/api/study',{cache:'no-store'},true);if(!valid())return;readSnapshot(key);
    if(!r.ok){failure('session','account',r.status,undefined,r.headers?.get('Retry-After'));stopped=true;break;}
    const remote=payload as StudyData & {owner:string;hasProfile:boolean;profileOrigin?:'theme-only'|'saved'|'missing'};if(!valid())return;
    if(remote.owner!==owner){failure('session','account',409);stopped=true;break;}
    try{migrateStudyData(remote);}catch{
     remoteReadOnly.current=true;readOnly.current=true;syncing.current=false;setSync('blocked');setIssues([{id:'schema',kind:'session',status:'blocked',attempts:0,nextRetryAt:0,reason:'云端学习记录版本较新，请更新应用后继续'}]);
     try{localStorage.setItem(key+':required-schema',JSON.stringify({schemaVersion:remote.schemaVersion}));}catch{toast.error('无法保存版本保护状态，请先更新应用再重新打开');}
     toast.error('云端学习记录版本较新，请更新应用；本机记录已保留');return;
    }
    clear('session','account');setRemoteRead({key,state:'confirmed'});
    // A stored remote profile is existing configuration, even with zero attempts. Never infer newness by values or history.
    if(remote.hasProfile&&remote.profileOrigin!=='theme-only'){const setup=storedSetup(key);if(setup&&(setup.state==='suggested'||setup.state==='skipped')){const value:ProfileSetup={...setup,state:remote.profile.onboarded?'confirmed':'existing',timezone:remote.profile.timezone};localStorage.setItem(key+':setup',JSON.stringify(value));setProfileSetup(value);}}
    // A remote acknowledgement repairs stale per-recording metadata as well as the snapshot.
    for(const rec of remote.recordings.filter(r=>r.uploaded)){localStorage.setItem(key+':recording:'+rec.id,JSON.stringify(rec));clear('recording',rec.id);}
    const local=readSnapshot(key);const queued=pending();
    const settingsChanged=(Object.keys(local.profile) as Array<keyof Profile>).some(field=>field!=='theme'&&local.profile[field]!==profileBeforeRead[field]);
    const merged=mergeData(local,remote);
    // Full settings operations retain their established behavior. A theme-only
    // choice must merge into cloud settings, especially before the first GET.
    if(settingsChanged||queued.some(x=>x.type==='profile')||!remote.hasProfile)merged.profile=local.profile;
    else if(local.profile.theme!==profileBeforeRead.theme||queued.some(x=>x.type==='theme'))merged.profile={...remote.profile,theme:local.profile.theme};
    const setup=storedSetup(key);if(remote.profileOrigin==='theme-only'&&setup&&['suggested','skipped'].includes(setup.state))merged.profile={...local.profile,theme:local.profile.theme!==profileBeforeRead.theme||queued.some(x=>x.type==='theme')?local.profile.theme:remote.profile.theme};
    localStorage.setItem(key+':profile',JSON.stringify(merged.profile));if(!persistForSync(merged))return;
    if(!dirty.current||budget<=0)break;
   }
  }catch{if(valid()){
   try{readSnapshot(key);}catch{blockReads();return;}
   try{failure('session','account',0);}catch{storageFailed=true;setSync('blocked');toast.error('本机存储不足，同步未完成，请导出学习记录');}
  }}
  finally{
   if(valid()&&!readOnly.current){
    syncing.current=false;
    if(!storageFailed){
     updateStatus();const list=syncIssues(key);const session=state('session','account');
     const next=session?(session.status==='waiting'?session.nextRetryAt:Infinity):Math.min(...list.filter(x=>x.status==='waiting').map(x=>x.nextRetryAt),dirty.current?Date.now()+100:Infinity);
     if(Number.isFinite(next)&&navigator.onLine)retryTimer.current=setTimeout(()=>void runSync(),Math.min(2147483647,Math.max(100,next-Date.now())));
    }
   }
  }
 },[owner,key,persist,blockReads]);
 useEffect(()=>{
  generation.current++;activeKey.current=key;syncing.current=false;dirty.current=false;readOnly.current=false;remoteReadOnly.current=false;setReady(false);setRemoteRead({key,state:'unverified'});
  current.current=structuredClone(EMPTY_DATA);setData(current.current);
  const load=()=>{if(remoteReadOnly.current)return false;try{readPrimarySnapshot(key);const setup=initializeSetup(key);setProfileSetup(setup);const saved=readSnapshot(key);readOnly.current=false;current.current=saved;setData(saved);setIssues(syncIssues(key));return true;}catch{blockReads();return false;}};
  const loaded=load();setReady(true);if(loaded)void syncNow();
  const online=()=>void syncNow();const changed=(e:StorageEvent)=>{if(e.key?.startsWith(key)){const wasBlocked=readOnly.current;if(!load())return;if(wasBlocked||e.key.startsWith(key+':op:')||e.key.startsWith(key+':recording:'))void syncNow();}};
  window.addEventListener('online',online);window.addEventListener('focus',online);window.addEventListener('storage',changed);
  return()=>{generation.current++;dirty.current=false;for(const controller of requestControllers.current)controller.abort();requestControllers.current.clear();if(retryTimer.current)clearTimeout(retryTimer.current);retryTimer.current=null;window.removeEventListener('online',online);window.removeEventListener('focus',online);window.removeEventListener('storage',changed);};
 },[key,syncNow,persist,blockReads]);
 const retryIssue=(issue:SyncIssue)=>{if(activeKey.current!==key||renderKey.current!==key)return;if(issue.status==='auth'){toast.error('请先通过真实账号入口恢复身份或权限，本机记录保留；重发同步不能恢复登录');return;}if(readOnly.current){void syncNow();return;}if(!editableSnapshot())return;try{localStorage.removeItem(key+':sync:'+issue.kind+':'+issue.id);setIssues(syncIssues(key));void syncNow();}catch{toast.error('本机存储不可用，请保留记录后重试');}};
 // This is an explicit probe of the existing trusted Sites session, not a login flow.
 const recheckSession=async()=>{
  if(!owner||activeKey.current!==key||renderKey.current!==key||readOnly.current||remoteReadOnly.current)return false;
  const gen=generation.current,valid=()=>gen===generation.current&&activeKey.current===key&&renderKey.current===key;
  const controller=new AbortController();requestControllers.current.add(controller);const timeout=setTimeout(()=>controller.abort(),25000);
  try{
   const response=await fetch('/api/study',{cache:'no-store',signal:controller.signal});
   if(!valid())return false;
   if(!response.ok){toast.error(response.status===401?'现有站点登录仍未恢复；本机记录保留':response.status===403?'现有站点权限仍不可用；本机记录保留':'暂未核实原会话，请稍后重试');return false;}
   const remote=await response.json() as {owner?:string};if(!valid())return false;
   if(remote.owner!==owner){toast.error('当前服务器身份与原记录不一致；未恢复同步');return false;}
   migrateStudyData(remote);readSnapshot(key);
   localStorage.removeItem(key+':sync:session:account');setIssues(syncIssues(key));
   // Only a positive same-owner read permits the original queue to continue.
   void syncNow();return true;
  }catch{if(valid())toast.error('会话核对未完成；记录和原同步队列保留');return false;}
  finally{clearTimeout(timeout);requestControllers.current.delete(controller);}
 };
 const enqueue=(type:Op['type'],value:Op['data'],d:StudyData):boolean=>{if(activeKey.current!==key||renderKey.current!==key||readOnly.current||!editableSnapshot())return false;const op:Op={id:createId(),owner,type,data:value};try{localStorage.setItem(key+':op:'+op.id,JSON.stringify(op));if(type==='profile'||type==='theme')localStorage.setItem(key+':profile',JSON.stringify(d.profile));}catch{setSync('blocked');toast.error('本机存储不可用，保存未完成；请保留记录后重试');return false;}if(!persist(d))return false;setSync('pending');void syncNow();return true;};
 const saveProfile=(p:Profile)=>{if(p.examDate!==''&&!validStudyDate(p.examDate)){toast.error('考试日期无效，偏好未保存；原记录未修改。');return false;}const saved=enqueue('profile',p,{...current.current,profile:p});if(saved){const setup:ProfileSetup={version:1,state:'confirmed',timezone:p.timezone,timezoneSource:'user'};try{localStorage.setItem(key+':setup',JSON.stringify(setup));setProfileSetup(setup);}catch{/* profile itself is already confirmed and durable */}}return saved;};
 const skipProfileSetup=()=>{if(activeKey.current!==key||renderKey.current!==key||readOnly.current||!editableSnapshot())return false;try{const prior=storedSetup(key);if(!prior||!['suggested','skipped'].includes(prior.state))return false;const value:ProfileSetup={...prior,state:'skipped'};localStorage.setItem(key+':setup',JSON.stringify(value));setProfileSetup(value);return true;}catch{return false;}};
 const saveTheme=(theme:Theme)=>{
  if(activeKey.current!==key||renderKey.current!==key||readOnly.current)return false;
  // Another tab may have saved settings before its storage event reaches us.
  const latest=editableSnapshot();if(!latest)return false;
  return enqueue('theme',{theme},{...latest,profile:{...latest.profile,theme}});
 };
 const readAttempt=(id:string):Attempt|undefined=>{
  if(activeKey.current!==key||renderKey.current!==key||readOnly.current)throw Error('当前账号或学习记录不可读取');
  try{return readImmutableRecord(key,owner,'attempt',id);}catch(error){blockReads();throw error;}
 };
 const readCheckin=(id:string):Checkin|undefined=>{
  if(activeKey.current!==key||renderKey.current!==key||readOnly.current)throw Error('当前账号或学习记录不可读取');
  try{return readImmutableRecord(key,owner,'checkin',id);}catch(error){blockReads();throw error;}
 };
 const addAttempt=(a:Attempt):boolean=>{
  if(activeKey.current!==key||renderKey.current!==key||readOnly.current)return false;
  let payload:string;try{payload=immutablePayload('attempt',a);}catch{toast.error('答题事件格式无效，未保存');return false;}
  try{
   const prior=readAttempt(a.id);
   if(prior){if(immutablePayload('attempt',prior)===payload)return true;toast.error('答题事件标识已用于不同内容，请保留记录后重试');return false;}
   const latest=editableSnapshot();if(!latest)return false;
   return enqueue('attempt',JSON.parse(payload),{...latest,attempts:[...latest.attempts,JSON.parse(payload)]});
  }catch{return false;}
 };
 const addCheckin=(c:Checkin):boolean=>{
  if(activeKey.current!==key||renderKey.current!==key||readOnly.current)return false;
  let payload:string;try{payload=immutablePayload('checkin',c);}catch{toast.error('打卡事件格式无效，未保存');return false;}
  try{
   const prior=readCheckin(c.id);
   if(prior){if(immutablePayload('checkin',prior)===payload)return true;toast.error('打卡事件标识已用于不同内容，请保留记录后重试');return false;}
   // Confirm an existing immutable fact unchanged; only new writes require a valid calendar date.
   if(!validStudyDate(c.date)){toast.error('学习日期无效，记录未保存；原记录未修改。');return false;}
   const latest=editableSnapshot();if(!latest)return false;
   return enqueue('checkin',JSON.parse(payload),{...latest,checkins:[...latest.checkins,JSON.parse(payload)]});
  }catch{return false;}
 };
 const editableSnapshot=()=>{try{return readSnapshot(key);}catch{blockReads();return null;}};
 const saveQuestionMark=(value:Omit<QuestionMark,'revision'|'mutationId'|'updatedAt'>):boolean=>{
  if(activeKey.current!==key||renderKey.current!==key||readOnly.current)return false;
  const latest=editableSnapshot();if(!latest)return false;const prior=latest.questionMarks.find(mark=>mark.qid===value.qid);
  const mark:QuestionMark={...value,revision:(prior?.revision||0)+1,mutationId:createId(),updatedAt:new Date().toISOString()};
  if(!validQuestionMark(mark))return false;
  return enqueue('questionMark',mark,{...latest,questionMarks:mergeMutableRecords([...latest.questionMarks,mark])});
 };
 const saveResourceTask=(value:Omit<ResourceTask,'revision'|'mutationId'|'updatedAt'>):boolean=>{
  if(activeKey.current!==key||renderKey.current!==key||readOnly.current)return false;
  const latest=editableSnapshot();if(!latest)return false;const prior=latest.resourceTasks.find(task=>task.id===value.id);
  const task:ResourceTask={...value,revision:(prior?.revision||0)+1,mutationId:createId(),updatedAt:new Date().toISOString()};
  if(!validResourceTask(task))return false;
  return enqueue('resourceTask',task,{...latest,resourceTasks:mergeMutableRecords([...latest.resourceTasks,task])});
 };
 const restoreBackup=(value:unknown,restoreProfile=false):boolean=>{
  if(activeKey.current!==key||renderKey.current!==key||readOnly.current)return false;
  const before=editableSnapshot();if(!before)return false;
  try{
   const restored=restoreStudyBackup(before,value,restoreProfile);
   const pendingRestore:Array<[Op['type'],Op['data']]>=[];
   for(const item of restored.attempts)if(!before.attempts.some(old=>old.id===item.id))pendingRestore.push(['attempt',item]);
   for(const item of restored.checkins)if(!before.checkins.some(old=>old.id===item.id))pendingRestore.push(['checkin',item]);
   for(const item of restored.questionMarks){const old=before.questionMarks.find(old=>old.qid===item.qid);if(!old||compareMutableRecords(item,old)>0)pendingRestore.push(['questionMark',item]);}
   for(const item of restored.resourceTasks){const old=before.resourceTasks.find(old=>old.id===item.id);if(!old||compareMutableRecords(item,old)>0)pendingRestore.push(['resourceTask',item]);}
   if(restoreProfile)pendingRestore.push(['profile',restored.profile]);
   // Journal each record before replacing the summary; partial restores can retry.
   for(const [type,item] of pendingRestore){const op:Op={id:createId(),owner,type,data:item};localStorage.setItem(key+':op:'+op.id,JSON.stringify(op));}
   for(const item of restored.recordings)if(!before.recordings.some(old=>old.id===item.id))localStorage.setItem(key+':recording:'+item.id,JSON.stringify(item));
   if(restoreProfile){const setup:ProfileSetup={version:1,state:restored.profile.onboarded?'confirmed':'existing',timezone:restored.profile.timezone,timezoneSource:'existing'};localStorage.setItem(key+':setup',JSON.stringify(setup));localStorage.setItem(key+':profile',JSON.stringify(restored.profile));setProfileSetup(setup);}
   if(!persist(restored))return false;setSync('pending');void syncNow();return true;
  }catch{toast.error('恢复未完成，请保留备份后重试；已保存记录不会丢失');return false;}
 };
 const addRecording=async(r:Recording,blob:Blob)=>{
  if(activeKey.current!==key||renderKey.current!==key||readOnly.current||!editableSnapshot())throw Error('当前学习记录不可写入');
  const gen=generation.current;await putAudio(key+':'+r.id,blob);
  if(gen!==generation.current||activeKey.current!==key||renderKey.current!==key||readOnly.current)throw Error('账号或记录版本已变化，请保留录音后重试');
  const latest=editableSnapshot();if(!latest)throw Error('当前学习记录不可写入');
  localStorage.setItem(key+':recording:'+r.id,JSON.stringify(r));if(!persist({...latest,recordings:uniqueById([...latest.recordings,r])}))throw Error('录音保存未完成，请保留录音后重试');setSync('pending');void syncNow();
 };
 const recordingUrl=async(r:Recording)=>{const blob=await getAudio(key+':'+r.id);if(blob)return URL.createObjectURL(blob);if(owner&&r.uploaded)return '/api/recordings?id='+encodeURIComponent(r.id);throw Error('找不到这段本机录音，也没有已确认的云端副本');};
 return {data,ready,recordsReadable:ready&&activeKey.current===key&&!readOnly.current,remoteReadState:!owner?'not-applicable':remoteRead.key===key?remoteRead.state:'unverified',profileSetup:profileSetup?.state??'unknown',timezoneSource:profileSetup?.timezoneSource??'existing',skipProfileSetup,sync,issues,syncNow,recheckSession,retryIssue,saveProfile,saveTheme,addAttempt,addCheckin,readAttempt,readCheckin,saveQuestionMark,saveResourceTask,restoreBackup,addRecording,recordingUrl};
}
