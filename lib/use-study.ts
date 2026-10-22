'use client';
import {useState,useEffect,useRef,useCallback} from 'react';
import {toast} from 'sonner';
import {createId,EMPTY_DATA,migrateStudyData,mergeData,mergeMutableRecords,validQuestionMark,validResourceTask,validStudyDate,compareMutableRecords,uniqueById,type StudyData,type Profile,type Theme,type Attempt,type Checkin,type Recording,type QuestionMark,type ResourceTask} from './study-model';
import {restoreStudyBackup} from './study-backup';
import {fetchStudySyncPages,applyStudySyncPage,studySyncStateFromSnapshot,StudySyncError,StudySyncSchemaError,type StudySyncState,type StudySyncPage} from './study-sync';
import {RemoteRecordingCache,createSameOriginRecordingLoader} from './remote-recording-cache';
import {createIndexedDbRecordingStore} from './indexeddb-recording-store';
import {readStudyCheckpoints,readStableStudyJournal,replayStudyOperations,compactStudyJournal} from './study-journal';
type Op={id:string;owner:string|null;type:'profile'|'theme'|'attempt'|'checkin'|'questionMark'|'resourceTask';data:Profile|{theme:Theme}|Attempt|Checkin|QuestionMark|ResourceTask};
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
 // Fence the complete snapshot/checkpoint/loose-op bridge. The selected snapshot
 // projection is authoritative; validation below must never return a stale op.
 for(let retry=0;retry<4;retry++){
  const epoch=localStorage.getItem(key+':checkpoint-epoch');
  const saved=readSnapshot(key,owner);
  const selected=(type==='attempt'?saved.attempts:saved.checkins).find(item=>item.id===id);
  const payload=selected===undefined?undefined:immutablePayload(type,selected);
  for(let i=0;i<localStorage.length;i++){
   const name=localStorage.key(i);if(!name?.startsWith(key+':op:'))continue;
   const op=JSON.parse(localStorage.getItem(name)||'null') as Op|null;
   if(!op||typeof op!=='object')throw Error('学习事件日志损坏，原始记录已保留');
   if(op.owner!==owner||op.type!==type||(op.data as Attempt|Checkin)?.id!==id)continue;
   const next=immutablePayload(type,op.data);
   // Only acknowledged cloud attempts may differ in server-assigned correct/mode.
   // Pending/local events still require the complete immutable local payload.
   const acknowledgedProjection=type==='attempt'&&owner!==null&&localStorage.getItem(key+':ack:'+op.id)==='1';
   const submitted=(bytes:string)=>{const a=JSON.parse(bytes) as Attempt;return JSON.stringify({id:a.id,qid:a.qid,choice:a.choice,createdAt:a.createdAt,seconds:a.seconds});};
   if(payload===undefined||(acknowledgedProjection?submitted(payload)!==submitted(next):payload!==next))throw Error('同一学习事件标识存在不同内容，已停止确认');
  }
  if(localStorage.getItem(key+':checkpoint-epoch')===epoch)return payload===undefined?undefined:JSON.parse(payload);
 }
 throw Error('学习数据正在整理，请稍后重试，原始记录保留');
}
function readPrimarySnapshot(key:string,primaryBytes?:string|null):StudyData{
 // Missing storage is a new learner. Invalid bytes/envelopes are never an empty
 // learner: leave the original key untouched and let the hook block all writes.
 const requiredBytes=localStorage.getItem(key+':required-schema');
 if(requiredBytes!==null)migrateStudyData(JSON.parse(requiredBytes));
 const bytes=primaryBytes===undefined?localStorage.getItem(key):primaryBytes;let raw:unknown;
 if(bytes!==null){
  const snapshot=JSON.parse(bytes);
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||!snapshot.data||typeof snapshot.data!=='object'||Array.isArray(snapshot.data))throw Error('学习记录快照损坏，原始记录已保留');
  raw=snapshot.data;
 }
 return migrateStudyData(raw);
}
function readSnapshot(key:string,owner:string|null,primaryBytes?:string|null):StudyData{
 return readStableStudyJournal(localStorage,key,()=>{
  const parse=(name:string)=>{try{return JSON.parse(localStorage.getItem(name)||'null');}catch{return null;}};
  let d=readStudyCheckpoints(localStorage,key,owner,readPrimarySnapshot(key,primaryBytes));
  d=replayStudyOperations(d,journal(key),owner);
  const profile=parse(key+':profile');if(profile&&typeof profile.name==='string')d.profile={...d.profile,...profile};
  for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(key+':recording:')){const rec=parse(k);if(rec&&typeof rec.id==='string')d.recordings=uniqueById([...d.recordings,rec]);}}
  return d;
 });
}
export type SyncIssue={id:string;kind:'op'|'recording'|'session';status:'waiting'|'blocked'|'auth'|'missing';attempts:number;nextRetryAt:number;reason:string};
function syncIssues(key:string):SyncIssue[]{const result:SyncIssue[]=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(key+':sync:')){try{const item=JSON.parse(localStorage.getItem(k)||'');const complete=item.kind==='op'?localStorage.getItem(key+':ack:'+item.id):item.kind==='recording'?JSON.parse(localStorage.getItem(key+':recording:'+item.id)||'null')?.uploaded:false;if(!complete)result.push(item);}catch{}}}return result;}
export function useStudy(owner:string|null,remoteEnabled=true){
 const key='lantern-v1-'+(owner||'device');const generation=useRef(0);const activeKey=useRef(key);const syncing=useRef(false);const dirty=useRef(false);const readOnly=useRef(false);const remoteReadOnly=useRef(false);const retryTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const remoteAudioCache=useRef<RemoteRecordingCache|null>(null);
 if(!remoteAudioCache.current){
  const unavailable={get:async()=>undefined,touch:async()=>{},put:async()=>{throw Error('缓存存储不可用');}};
  remoteAudioCache.current=new RemoteRecordingCache({store:typeof indexedDB==='undefined'?unavailable:createIndexedDbRecordingStore(indexedDB),load:createSameOriginRecordingLoader(fetch)});
 }
 const compacting=useRef<string|null>(null);
 const [data,setData]=useState<StudyData>(EMPTY_DATA);const current=useRef(data);const [ready,setReady]=useState(false);const [sync,setSync]=useState<'loading'|'synced'|'local'|'pending'|'blocked'>('loading');const [issues,setIssues]=useState<SyncIssue[]>([]);
 const blockReads=useCallback(()=>{
  readOnly.current=true;generation.current++;syncing.current=false;dirty.current=false;
  if(retryTimer.current){clearTimeout(retryTimer.current);retryTimer.current=null;}
  setSync('blocked');toast.error('学习记录无法读取或版本不受支持，已停止写入并保留原始记录；请保留记录后重试');
 },[]);
 const scheduleJournalCompaction=useCallback(()=>{
  if(activeKey.current!==key||readOnly.current||compacting.current===key)return;
  const locks=typeof navigator!=='undefined'?navigator.locks:undefined;
  if(!locks)return; // No unsafe cross-tab deletion fallback on older WebViews.
  compacting.current=key;
  void compactStudyJournal({storage:localStorage,key,owner,readSnapshot:()=>readSnapshot(key,owner),
   createId,withLock:async(name,work)=>await locks.request(name,()=>work())})
   .catch(()=>{/* The existing facts/logs remain authoritative on quota or contention. */})
   .finally(()=>{if(compacting.current===key)compacting.current=null;});
 },[key,owner]);
 const persist=useCallback((d:StudyData,nextSyncState?:StudySyncState):boolean=>{
  if(activeKey.current!==key||readOnly.current)return false;
  let stored:StudyData;let primaryBytes:string|null;try{primaryBytes=localStorage.getItem(key);stored=readSnapshot(key,owner,primaryBytes);}catch{blockReads();return false;}
  const next=mergeData(stored,d);
  // Ordinary stale-tab writes cannot roll back server-assigned projections.
  // Explicit page commits carry their data+progress together and may update them.
  if(nextSyncState===undefined){const priorAttempts=new Map(stored.attempts.map(item=>[item.id,item]));next.attempts=next.attempts.map(item=>priorAttempts.get(item.id)??item);}
  const studySync=nextSyncState??studySyncStateFromSnapshot(primaryBytes,owner);
  try{localStorage.setItem(key,JSON.stringify({data:next,studySync}));}catch{setSync('blocked');toast.error('本机存储空间不足，保存未完成；请保留记录后重试');return false;}
  current.current=next;setData(next);scheduleJournalCompaction();return true;
 },[key,owner,blockReads,scheduleJournalCompaction]);
 const syncNow=useCallback(async function runSync(){
  if(activeKey.current!==key||remoteReadOnly.current)return;
  try{
   const saved=readSnapshot(key,owner);
   // Recovery only revalidates externally repaired bytes; it never deletes or
   // replaces a bad snapshot. Unsupported schema guards must still pass here.
   if(readOnly.current){readOnly.current=false;current.current=saved;setData(saved);setIssues(syncIssues(key));}
  }catch{blockReads();return;}
  if(syncing.current){dirty.current=true;return;}
  const gen=generation.current;const valid=()=>gen===generation.current&&activeKey.current===key;
  if(retryTimer.current){clearTimeout(retryTimer.current);retryTimer.current=null;}
  scheduleJournalCompaction();
  if(!owner||!remoteEnabled){setSync('local');return;}
  const stateKey=(kind:SyncIssue['kind'],id:string)=>key+':sync:'+kind+':'+id;
  const state=(kind:SyncIssue['kind'],id:string)=>{try{return JSON.parse(localStorage.getItem(stateKey(kind,id))||'null') as SyncIssue|null;}catch{return null;}};
  const eligible=(kind:SyncIssue['kind'],id:string)=>{const s=state(kind,id);return !s||(s.status==='waiting'&&s.nextRetryAt<=Date.now());};
  const clear=(kind:SyncIssue['kind'],id:string)=>localStorage.removeItem(stateKey(kind,id));
  const failure=(kind:SyncIssue['kind'],id:string,status:number,reason?:string,retryAfter?:string|null)=>{
   readSnapshot(key,owner);
   if((kind==='op'&&(localStorage.getItem(key+':ack:'+id)||localStorage.getItem(key+':op:'+id)===null))||(kind==='recording'&&readSnapshot(key,owner).recordings.some(r=>r.id===id&&r.uploaded))){clear(kind,id);return;}
   const attempts=(state(kind,id)?.attempts||0)+1;
   const auth=[401,403,409].includes(status);const retryable=status===0||[408,425,429].includes(status)||status>=500;
   const retryDate=retryAfter?(Number.isFinite(Number(retryAfter))?Date.now()+Number(retryAfter)*1000:Date.parse(retryAfter)):0;
   const nextRetryAt=Math.max(Date.now()+(attempts===1?5000:30000),Number.isFinite(retryDate)?retryDate:0);
   const item:SyncIssue={id,kind,attempts,status:auth?'auth':reason?(kind==='recording'?'missing':'blocked'):retryable&&attempts<3?'waiting':'blocked',nextRetryAt,
    reason:reason||(auth?'登录或账号状态已变化，请重新登录或刷新':status===413?'内容超过上传大小限制':status===400||status===422?'这条记录的格式未被服务器接受':status===415?'录音格式未被服务器接受':retryable?(attempts<3?'网络或服务暂不可用，将稍后重试':'已尝试3次，请稍后手动重试'):'服务器拒绝了这条记录，请检查后重试')};
   localStorage.setItem(stateKey(kind,id),JSON.stringify(item));
   return item;
  };
  const pending=()=>journal(key).filter(op=>op.owner===owner&&!localStorage.getItem(key+':ack:'+op.id));
  const updateStatus=()=>{const list=syncIssues(key);setIssues(list);setSync(list.some(x=>x.status!=='waiting')?'blocked':pending().length||current.current.recordings.some(r=>!r.uploaded)?'pending':'synced');};
  if(!navigator.onLine){setIssues(syncIssues(key));setSync('local');return;}
  if(!eligible('session','account')){updateStatus();const item=state('session','account');if(item?.status==='waiting')retryTimer.current=setTimeout(()=>void runSync(),Math.min(2147483647,Math.max(100,item.nextRetryAt-Date.now())));return;}
  syncing.current=true;setSync('loading');let resets=0;let budget=30;let stopped=false;let storageFailed=false;
  const persistForSync=(d:StudyData,nextState?:StudySyncState)=>{const saved=persist(d,nextState);if(!saved)storageFailed=true;return saved;};
  // A hung connection must not hold the queue forever. Abort only this request.
  const request=async(url:string,init?:RequestInit,readBody=false)=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),25000);try{const response=await fetch(url,{...init,signal:controller.signal});const payload=readBody&&typeof response.json==='function'?(response.ok?await response.json():await response.json().catch(()=>null)):null;return {response,payload};}finally{clearTimeout(timer);}};
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
     const outgoing=op.type==='profile'?{...op,data:readSnapshot(key,owner).profile}:op.type==='theme'?{...op,data:{theme:readSnapshot(key,owner).profile.theme}}:op;
     let r:Response;try{r=(await request('/api/study',{method:'POST',headers:{'Content-Type':'application/json','X-Lantern-Owner':owner},body:JSON.stringify(outgoing)})).response;}catch{if(!valid())return;failure('op',op.id,0);continue;}
     if(!valid())return;readSnapshot(key,owner);if(!r.ok){
      if(r.status===409&&r.headers?.get('X-Lantern-Conflict')==='event-payload'&&(op.type==='attempt'||op.type==='checkin')){failure('op',op.id,422,'同一事件标识的内容与云端不同，请保留备份后检查；该记录未同步');continue;}
      if([401,403,409].includes(r.status)){failure('session','account',r.status);stopped=true;break;}failure('op',op.id,r.status,undefined,r.headers?.get('Retry-After'));continue;
     }
     if(op.type==='theme'){
      const latest=readSnapshot(key,owner).profile.theme;
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
    if(!persistForSync(mergeData(current.current,readSnapshot(key,owner))))return;
    for(const rec of current.current.recordings.filter(x=>!x.uploaded)){
     if(!valid())return;if(!eligible('recording',rec.id))continue;if(budget--<=0){dirty.current=true;break;}
     let blob:Blob|undefined;try{blob=await getAudio(key+':'+rec.id);}catch{if(!valid())return;failure('recording',rec.id,0,'本机音频读取失败，请重试');continue;}
     if(!valid())return;readSnapshot(key,owner);if(!blob){failure('recording',rec.id,0,'找不到本机音频，云端副本尚未确认');continue;}
     const form=new FormData();form.append('audio',blob,'recording.'+(blob.type.includes('mp4')?'m4a':'webm'));form.append('meta',JSON.stringify(rec));
     let r:Response;try{r=(await request('/api/recordings',{method:'POST',headers:{'X-Lantern-Owner':owner},body:form})).response;}catch{if(!valid())return;failure('recording',rec.id,0);continue;}
     if(!valid())return;readSnapshot(key,owner);if(!r.ok){if([401,403,409].includes(r.status)){failure('session','account',r.status);stopped=true;break;}failure('recording',rec.id,r.status,undefined,r.headers?.get('Retry-After'));continue;}
     localStorage.setItem(key+':recording:'+rec.id,JSON.stringify({...rec,uploaded:true}));clear('recording',rec.id);if(!persistForSync({...current.current,recordings:current.current.recordings.map(x=>x.id===rec.id?{...x,uploaded:true}:x)}))return;
    }
    if(stopped||!valid())break;
    // Capture data and its progress from the same primary bytes. Keeping this
    // run's baseline also protects already committed earlier pages from a
    // concurrent tab overwriting the summary with an older snapshot.
    const syncStartBytes=localStorage.getItem(key);
    let syncBase=mergeData(current.current,readSnapshot(key,owner,syncStartBytes));
    const profileBeforeRead=syncBase.profile;
    const startState=studySyncStateFromSnapshot(syncStartBytes,owner);
    const mergeRemotePage=(page:StudySyncPage,nextState:StudySyncState)=>{
     if(!valid())return false;
     const latest=readSnapshot(key,owner);const local=mergeData(latest,syncBase);local.profile=latest.profile;const queued=pending();
     const settingsChanged=(Object.keys(local.profile) as Array<keyof Profile>).some(field=>field!=='theme'&&local.profile[field]!==profileBeforeRead[field]);
     const merged=applyStudySyncPage(local,page);
     if(settingsChanged||queued.some(x=>x.type==='profile')||!page.hasProfile)merged.profile=local.profile;
     else if(local.profile.theme!==profileBeforeRead.theme||queued.some(x=>x.type==='theme'))merged.profile={...merged.profile,theme:local.profile.theme};
     for(const change of page.changes)if(change.kind==='recording'){const rec={...change.data as Recording,uploaded:true};localStorage.setItem(key+':recording:'+rec.id,JSON.stringify(rec));clear('recording',rec.id);}
     localStorage.setItem(key+':profile',JSON.stringify(merged.profile));
     if(!persistForSync(merged,nextState))return false;
     syncBase=current.current;return true;
    };
    let pageResult:Awaited<ReturnType<typeof fetchStudySyncPages>>;
    try{
     pageResult=await fetchStudySyncPages({owner,state:startState,isCurrent:valid,request:url=>request(url,{cache:'no-store'},true),commitPage:mergeRemotePage,maxPages:20});
    }catch(error){
     if(!valid())return;
     if(error instanceof StudySyncSchemaError){
      remoteReadOnly.current=true;readOnly.current=true;syncing.current=false;setSync('blocked');setIssues([{id:'schema',kind:'session',status:'blocked',attempts:0,nextRetryAt:0,reason:'云端学习记录版本较新，请更新应用后继续'}]);
      try{localStorage.setItem(key+':required-schema',JSON.stringify({schemaVersion:error.schemaVersion===undefined?'unsupported':error.schemaVersion}));}catch{toast.error('无法保存版本保护状态，请先更新应用再重新打开');}
      toast.error('云端学习记录版本较新，请更新应用；本机记录已保留');return;
     }
     if(error instanceof StudySyncError&&error.resetRequired){
      if(resets++>=1){failure('session','account',409,'同步状态暂不稳定，请稍后重试；本机记录保留');stopped=true;break;}
      // Reset progress only. Preserve every local fact, then replay a fresh
      // baseline on the next bounded sync pass; never repair by clearing data.
      if(!persistForSync(mergeData(current.current,readSnapshot(key,owner)),{checkpoint:null,continuation:null}))return;
      dirty.current=true;clear('session','account');continue;
     }
     if(error instanceof StudySyncError&&error.status){failure('session','account',error.status);stopped=true;break;}
     throw error;
    }
    if(!valid())return;readSnapshot(key,owner);clear('session','account');
    if(pageResult.legacy){
     const remote=pageResult.legacy;
     // The helper validates identity/schema before returning this compatibility
     // path. It does not acknowledge pages or manufacture a checkpoint.
     const latest=readSnapshot(key,owner);const local=mergeData(latest,syncBase);local.profile=latest.profile;const queued=pending();
     const settingsChanged=(Object.keys(local.profile) as Array<keyof Profile>).some(field=>field!=='theme'&&local.profile[field]!==profileBeforeRead[field]);
     const merged=mergeData(local,remote);
     if(settingsChanged||queued.some(x=>x.type==='profile')||!remote.hasProfile)merged.profile=local.profile;
     else if(local.profile.theme!==profileBeforeRead.theme||queued.some(x=>x.type==='theme'))merged.profile={...remote.profile,theme:local.profile.theme};
     for(const rec of remote.recordings.filter(r=>r.uploaded)){localStorage.setItem(key+':recording:'+rec.id,JSON.stringify(rec));clear('recording',rec.id);}
     localStorage.setItem(key+':profile',JSON.stringify(merged.profile));if(!persistForSync(merged,{checkpoint:null,continuation:null}))return;
    }
    if(!pageResult.complete)dirty.current=true;
    if(!dirty.current||budget<=0)break;
   }
  }catch{if(valid()){
   try{readSnapshot(key,owner);}catch{blockReads();return;}
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
 },[owner,key,persist,blockReads,scheduleJournalCompaction,remoteEnabled]);
 useEffect(()=>{
  generation.current++;activeKey.current=key;remoteAudioCache.current?.setOwner(remoteEnabled?owner:null);syncing.current=false;dirty.current=false;readOnly.current=false;remoteReadOnly.current=false;setReady(false);
  current.current=structuredClone(EMPTY_DATA);setData(current.current);
  const load=()=>{if(remoteReadOnly.current)return false;try{const saved=readSnapshot(key,owner);readOnly.current=false;current.current=saved;setData(saved);setIssues(syncIssues(key));return true;}catch{blockReads();return false;}};
  const loaded=load();setReady(true);if(loaded)void syncNow();
  const online=()=>void syncNow();const changed=(e:StorageEvent)=>{if(e.newValue===null&&(e.key?.startsWith(key+':op:')||e.key?.startsWith(key+':ack:')||e.key?.startsWith(key+':checkpoint:')||e.key?.startsWith(key+':sync:op:')))return;if(e.key?.startsWith(key)){const wasBlocked=readOnly.current;if(!load())return;if(wasBlocked||e.key.startsWith(key+':op:')||e.key.startsWith(key+':recording:'))void syncNow();}};
  window.addEventListener('online',online);window.addEventListener('focus',online);window.addEventListener('storage',changed);
  return()=>{generation.current++;remoteAudioCache.current?.setOwner(null);dirty.current=false;if(retryTimer.current)clearTimeout(retryTimer.current);retryTimer.current=null;window.removeEventListener('online',online);window.removeEventListener('focus',online);window.removeEventListener('storage',changed);};
 },[key,syncNow,persist,blockReads]);
 const retryIssue=(issue:SyncIssue)=>{if(activeKey.current!==key)return;if(readOnly.current){void syncNow();return;}if(!editableSnapshot())return;try{localStorage.removeItem(key+':sync:'+issue.kind+':'+issue.id);setIssues(syncIssues(key));void syncNow();}catch{toast.error('本机存储不可用，请保留记录后重试');}};
 const enqueue=(type:Op['type'],value:Op['data'],d:StudyData):boolean=>{if(activeKey.current!==key||readOnly.current||!editableSnapshot())return false;const op:Op={id:createId(),owner,type,data:value};try{localStorage.setItem(key+':op:'+op.id,JSON.stringify(op));if(type==='profile'||type==='theme')localStorage.setItem(key+':profile',JSON.stringify(d.profile));}catch{setSync('blocked');toast.error('本机存储不可用，保存未完成；请保留记录后重试');return false;}if(!persist(d))return false;setSync('pending');void syncNow();return true;};
 const saveProfile=(p:Profile)=>{if(p.examDate!==''&&!validStudyDate(p.examDate)){toast.error('考试日期无效，偏好未保存；原记录未修改。');return false;}return enqueue('profile',p,{...current.current,profile:p});};
 const saveTheme=(theme:Theme)=>{
  if(activeKey.current!==key||readOnly.current)return false;
  // Another tab may have saved settings before its storage event reaches us.
  const latest=editableSnapshot();if(!latest)return false;
  return enqueue('theme',{theme},{...latest,profile:{...latest.profile,theme}});
 };
 const readAttempt=(id:string):Attempt|undefined=>{
  if(activeKey.current!==key)throw Error('当前账号或学习记录不可读取');
  if(readOnly.current){readSnapshot(key,owner);throw Error('当前学习记录不可读取，请先重新读取');}
  try{return readImmutableRecord(key,owner,'attempt',id);}catch(error){blockReads();throw error;}
 };
 const readCheckin=(id:string):Checkin|undefined=>{
  if(activeKey.current!==key)throw Error('当前账号或学习记录不可读取');
  if(readOnly.current){readSnapshot(key,owner);throw Error('当前学习记录不可读取，请先重新读取');}
  try{return readImmutableRecord(key,owner,'checkin',id);}catch(error){blockReads();throw error;}
 };
 const addAttempt=(a:Attempt):boolean=>{
  if(activeKey.current!==key||readOnly.current)return false;
  let payload:string;try{payload=immutablePayload('attempt',a);}catch{toast.error('答题事件格式无效，未保存');return false;}
  try{
   const prior=readAttempt(a.id);
   if(prior){if(immutablePayload('attempt',prior)===payload)return true;toast.error('答题事件标识已用于不同内容，请保留记录后重试');return false;}
   const latest=editableSnapshot();if(!latest)return false;
   return enqueue('attempt',JSON.parse(payload),{...latest,attempts:[...latest.attempts,JSON.parse(payload)]});
  }catch{return false;}
 };
 const addCheckin=(c:Checkin):boolean=>{
  if(activeKey.current!==key||readOnly.current)return false;
  let payload:string;try{payload=immutablePayload('checkin',c);}catch{toast.error('打卡事件格式无效，未保存');return false;}
  try{
   const prior=readCheckin(c.id);
   if(prior){if(immutablePayload('checkin',prior)===payload)return true;toast.error('打卡事件标识已用于不同内容，请保留记录后重试');return false;}
   // Retain immutable historical facts; validate the calendar before new writes.
   if(!validStudyDate(c.date)){toast.error('学习日期无效，记录未保存；原记录未修改。');return false;}
   const latest=editableSnapshot();if(!latest)return false;
   return enqueue('checkin',JSON.parse(payload),{...latest,checkins:[...latest.checkins,JSON.parse(payload)]});
  }catch{return false;}
 };
 const editableSnapshot=()=>{try{return readSnapshot(key,owner);}catch{blockReads();return null;}};
 const saveQuestionMark=(value:Omit<QuestionMark,'revision'|'mutationId'|'updatedAt'>):boolean=>{
  if(activeKey.current!==key||readOnly.current)return false;
  const latest=editableSnapshot();if(!latest)return false;const prior=latest.questionMarks.find(mark=>mark.qid===value.qid);
  const mark:QuestionMark={...value,revision:(prior?.revision||0)+1,mutationId:createId(),updatedAt:new Date().toISOString()};
  if(!validQuestionMark(mark))return false;
  return enqueue('questionMark',mark,{...latest,questionMarks:mergeMutableRecords([...latest.questionMarks,mark])});
 };
 const saveResourceTask=(value:Omit<ResourceTask,'revision'|'mutationId'|'updatedAt'>):boolean=>{
  if(activeKey.current!==key||readOnly.current)return false;
  const latest=editableSnapshot();if(!latest)return false;const prior=latest.resourceTasks.find(task=>task.id===value.id);
  const task:ResourceTask={...value,revision:(prior?.revision||0)+1,mutationId:createId(),updatedAt:new Date().toISOString()};
  if(!validResourceTask(task))return false;
  return enqueue('resourceTask',task,{...latest,resourceTasks:mergeMutableRecords([...latest.resourceTasks,task])});
 };
 const restoreBackup=(value:unknown,restoreProfile=false):boolean=>{
  if(activeKey.current!==key||readOnly.current)return false;
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
   if(restoreProfile)localStorage.setItem(key+':profile',JSON.stringify(restored.profile));
   if(!persist(restored,{checkpoint:null,continuation:null}))return false;setSync('pending');void syncNow();return true;
  }catch{toast.error('恢复未完成，请保留备份后重试；已保存记录不会丢失');return false;}
 };
 const addRecording=async(r:Recording,blob:Blob)=>{
  if(activeKey.current!==key||readOnly.current||!editableSnapshot())throw Error('当前学习记录不可写入');
  const gen=generation.current;await putAudio(key+':'+r.id,blob);
  if(gen!==generation.current||activeKey.current!==key||readOnly.current)throw Error('账号或记录版本已变化，请保留录音后重试');
  const latest=editableSnapshot();if(!latest)throw Error('当前学习记录不可写入');
  localStorage.setItem(key+':recording:'+r.id,JSON.stringify(r));if(!persist({...latest,recordings:uniqueById([...latest.recordings,r])}))throw Error('录音保存未完成，请保留录音后重试');setSync('pending');void syncNow();
 };
 const recordingUrl=async(r:Recording,options:{signal?:AbortSignal}={})=>{
  const gen=generation.current;
  const valid=()=>gen===generation.current&&activeKey.current===key&&!readOnly.current&&!options.signal?.aborted;
  if(!valid())throw Error('账号或记录范围已变化，回听已取消');
  let blob:Blob|undefined;
  try{blob=await getAudio(key+':'+r.id);}catch(error){if(!owner||!remoteEnabled||!r.uploaded)throw error;}
  if(!valid())throw Error('账号或记录范围已变化，回听已取消');
  if(blob)return URL.createObjectURL(blob); // Originals remain authoritative.
  if(!owner||!remoteEnabled||!r.uploaded)throw Error('找不到这段本机录音，当前范围没有可读取的云端副本');
  const cache=remoteAudioCache.current;if(!cache)throw Error('录音缓存尚未准备完成，请稍后重试');
  const controller=new AbortController(),cancel=()=>controller.abort();
  options.signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,25000);
  try{
   const result=await cache.get({id:r.id,mime:r.mime,revision:r.createdAt},{signal:controller.signal});
   if(!valid())throw Error('账号或记录范围已变化，回听已取消');
   return URL.createObjectURL(result.blob);
  }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
 };
 return {data,ready,recordsReadable:ready&&activeKey.current===key&&!readOnly.current,sync,issues,syncNow,retryIssue,saveProfile,saveTheme,addAttempt,addCheckin,readAttempt,readCheckin,saveQuestionMark,saveResourceTask,restoreBackup,addRecording,recordingUrl};
}
