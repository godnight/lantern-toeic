'use client';
import {useState,useEffect,useRef,useCallback} from 'react';
import {toast} from 'sonner';
import {createId,EMPTY_DATA,mergeData,uniqueById,type StudyData,type Profile,type Attempt,type Checkin,type Recording} from './study-model';
type Op={id:string;owner:string|null;type:'profile'|'attempt'|'checkin';data:Profile|Attempt|Checkin};
function openAudioDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open('lantern-audio',1);r.onupgradeneeded=()=>r.result.createObjectStore('audio');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function putAudio(key:string,blob:Blob){const db=await openAudioDB();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('audio','readwrite');tx.objectStore('audio').put(blob,key);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
export async function getAudio(key:string):Promise<Blob|undefined>{const db=await openAudioDB();return new Promise((resolve,reject)=>{const tx=db.transaction('audio');const r=tx.objectStore('audio').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
// Each operation has its own storage key. Concurrent tabs cannot overwrite another
// operation, even if their summary snapshots race. Acknowledgements are separate.
function journal(key:string):Op[]{const result:Op[]=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(key+':op:')){try{result.push(JSON.parse(localStorage.getItem(k)||''));}catch{}}}return result;}
function readSnapshot(key:string):StudyData{
 const parse=(name:string)=>{try{return JSON.parse(localStorage.getItem(name)||'null');}catch{return null;}};
 const raw=parse(key)?.data;const d:StudyData=structuredClone(EMPTY_DATA);
 if(raw){if(raw.profile&&typeof raw.profile.name==='string')d.profile={...d.profile,...raw.profile};for(const name of ['attempts','checkins','recordings'] as const)if(Array.isArray(raw[name]))(d[name] as Array<{id:string}>)=raw[name].filter((x:{id?:unknown})=>x&&typeof x.id==='string');}
 for(const op of journal(key)){
  if(!op?.data||typeof (op.data as Attempt).id!=='string')continue;
  if(op.type==='attempt'&&!d.attempts.some(a=>a.id===(op.data as Attempt).id))d.attempts=uniqueById([...d.attempts,op.data as Attempt]);
  if(op.type==='checkin'&&!d.checkins.some(c=>c.id===(op.data as Checkin).id))d.checkins=uniqueById([...d.checkins,op.data as Checkin]);
 }
 const profile=parse(key+':profile');if(profile&&typeof profile.name==='string')d.profile={...d.profile,...profile};
 for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(key+':recording:')){const rec=parse(k);if(rec&&typeof rec.id==='string')d.recordings=uniqueById([...d.recordings,rec]);}}
 return d;
}
export type SyncIssue={id:string;kind:'op'|'recording'|'session';status:'waiting'|'blocked'|'auth'|'missing';attempts:number;nextRetryAt:number;reason:string};
function syncIssues(key:string):SyncIssue[]{const result:SyncIssue[]=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(key+':sync:')){try{const item=JSON.parse(localStorage.getItem(k)||'');const complete=item.kind==='op'?localStorage.getItem(key+':ack:'+item.id):item.kind==='recording'?JSON.parse(localStorage.getItem(key+':recording:'+item.id)||'null')?.uploaded:false;if(!complete)result.push(item);}catch{}}}return result;}
export function useStudy(owner:string|null){
 const key='lantern-v1-'+(owner||'device');const generation=useRef(0);const activeKey=useRef(key);const syncing=useRef(false);const dirty=useRef(false);const retryTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [data,setData]=useState<StudyData>(EMPTY_DATA);const current=useRef(data);const [ready,setReady]=useState(false);const [sync,setSync]=useState<'loading'|'synced'|'local'|'pending'|'blocked'>('loading');const [issues,setIssues]=useState<SyncIssue[]>([]);
 const persist=useCallback((d:StudyData)=>{if(activeKey.current!==key)return;const stored=readSnapshot(key);const next=mergeData(stored,d);current.current=next;setData(next);try{localStorage.setItem(key,JSON.stringify({data:next}));}catch{toast.error('本机存储空间不足，请导出学习记录');}},[key]);
 const syncNow=useCallback(async function runSync(){
  if(activeKey.current!==key)return;if(syncing.current){dirty.current=true;return;}
  const gen=generation.current;const valid=()=>gen===generation.current&&activeKey.current===key;
  if(retryTimer.current){clearTimeout(retryTimer.current);retryTimer.current=null;}
  if(!owner){setSync('local');return;}
  const stateKey=(kind:SyncIssue['kind'],id:string)=>key+':sync:'+kind+':'+id;
  const state=(kind:SyncIssue['kind'],id:string)=>{try{return JSON.parse(localStorage.getItem(stateKey(kind,id))||'null') as SyncIssue|null;}catch{return null;}};
  const eligible=(kind:SyncIssue['kind'],id:string)=>{const s=state(kind,id);return !s||(s.status==='waiting'&&s.nextRetryAt<=Date.now());};
  const clear=(kind:SyncIssue['kind'],id:string)=>localStorage.removeItem(stateKey(kind,id));
  const failure=(kind:SyncIssue['kind'],id:string,status:number,reason?:string,retryAfter?:string|null)=>{
   if((kind==='op'&&localStorage.getItem(key+':ack:'+id))||(kind==='recording'&&readSnapshot(key).recordings.some(r=>r.id===id&&r.uploaded))){clear(kind,id);return;}
   const attempts=(state(kind,id)?.attempts||0)+1;
   const auth=[401,403,409].includes(status);const retryable=status===0||[408,425,429].includes(status)||status>=500;
   const retryDate=retryAfter?(Number.isFinite(Number(retryAfter))?Date.now()+Number(retryAfter)*1000:Date.parse(retryAfter)):0;
   const nextRetryAt=Math.max(Date.now()+(attempts===1?5000:30000),Number.isFinite(retryDate)?retryDate:0);
   const item:SyncIssue={id,kind,attempts,status:auth?'auth':reason?'missing':retryable&&attempts<3?'waiting':'blocked',nextRetryAt,
    reason:reason||(auth?'登录或账号状态已变化，请重新登录或刷新':status===413?'内容超过上传大小限制':status===400||status===422?'这条记录的格式未被服务器接受':status===415?'录音格式未被服务器接受':retryable?(attempts<3?'网络或服务暂不可用，将稍后重试':'已尝试3次，请稍后手动重试'):'服务器拒绝了这条记录，请检查后重试')};
   localStorage.setItem(stateKey(kind,id),JSON.stringify(item));
   return item;
  };
  const pending=()=>journal(key).filter(op=>op.owner===owner&&!localStorage.getItem(key+':ack:'+op.id));
  const updateStatus=()=>{const list=syncIssues(key);setIssues(list);setSync(list.some(x=>x.status!=='waiting')?'blocked':pending().length||current.current.recordings.some(r=>!r.uploaded)?'pending':'synced');};
  if(!navigator.onLine){setIssues(syncIssues(key));setSync('local');return;}
  if(!eligible('session','account')){updateStatus();const item=state('session','account');if(item?.status==='waiting')retryTimer.current=setTimeout(()=>void runSync(),Math.min(2147483647,Math.max(100,item.nextRetryAt-Date.now())));return;}
  syncing.current=true;setSync('loading');let budget=30;let stopped=false;
  // A hung connection must not hold the queue forever. Abort only this request.
  const request=async(url:string,init?:RequestInit,readBody=false)=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),25000);try{const response=await fetch(url,{...init,signal:controller.signal});const payload=readBody&&response.ok?await response.json():null;return {response,payload};}finally{clearTimeout(timer);}};
  try{
   for(let round=0;round<3;round++){
    dirty.current=false;
    for(const op of pending()){
     if(!valid())return;if(!eligible('op',op.id))continue;if(budget--<=0){dirty.current=true;break;}
     let r:Response;try{r=(await request('/api/study',{method:'POST',headers:{'Content-Type':'application/json','X-Lantern-Owner':owner},body:JSON.stringify(op.type==='profile'?{...op,data:readSnapshot(key).profile}:op)})).response;}catch{if(!valid())return;failure('op',op.id,0);continue;}
     if(!valid())return;if(!r.ok){if([401,403,409].includes(r.status)){failure('session','account',r.status);stopped=true;break;}failure('op',op.id,r.status,undefined,r.headers?.get('Retry-After'));continue;}
     localStorage.setItem(key+':ack:'+op.id,'1');clear('op',op.id);
    }
    if(stopped||!valid())break;
    persist(mergeData(current.current,readSnapshot(key)));
    for(const rec of current.current.recordings.filter(x=>!x.uploaded)){
     if(!valid())return;if(!eligible('recording',rec.id))continue;if(budget--<=0){dirty.current=true;break;}
     let blob:Blob|undefined;try{blob=await getAudio(key+':'+rec.id);}catch{if(!valid())return;failure('recording',rec.id,0,'本机音频读取失败，请重试');continue;}
     if(!valid())return;if(!blob){failure('recording',rec.id,0,'找不到本机音频，云端副本尚未确认');continue;}
     const form=new FormData();form.append('audio',blob,'recording.'+(blob.type.includes('mp4')?'m4a':'webm'));form.append('meta',JSON.stringify(rec));
     let r:Response;try{r=(await request('/api/recordings',{method:'POST',headers:{'X-Lantern-Owner':owner},body:form})).response;}catch{if(!valid())return;failure('recording',rec.id,0);continue;}
     if(!valid())return;if(!r.ok){if([401,403,409].includes(r.status)){failure('session','account',r.status);stopped=true;break;}failure('recording',rec.id,r.status,undefined,r.headers?.get('Retry-After'));continue;}
     localStorage.setItem(key+':recording:'+rec.id,JSON.stringify({...rec,uploaded:true}));clear('recording',rec.id);persist({...current.current,recordings:current.current.recordings.map(x=>x.id===rec.id?{...x,uploaded:true}:x)});
    }
    if(stopped||!valid())break;
    const profileBeforeRead=localStorage.getItem(key+':profile');
    const {response:r,payload}=await request('/api/study',{cache:'no-store'},true);if(!valid())return;
    if(!r.ok){failure('session','account',r.status,undefined,r.headers?.get('Retry-After'));stopped=true;break;}
    const remote=payload as StudyData & {owner:string;hasProfile:boolean};if(!valid())return;
    if(remote.owner!==owner){failure('session','account',409);stopped=true;break;}
    clear('session','account');
    // A remote acknowledgement repairs stale per-recording metadata as well as the snapshot.
    for(const rec of remote.recordings.filter(r=>r.uploaded)){localStorage.setItem(key+':recording:'+rec.id,JSON.stringify(rec));clear('recording',rec.id);}
    const local=readSnapshot(key);const profileChanged=profileBeforeRead!==localStorage.getItem(key+':profile');
    const merged=mergeData(local,remote);
    if(profileChanged||pending().some(x=>x.type==='profile')||!remote.hasProfile)merged.profile=local.profile;else localStorage.setItem(key+':profile',JSON.stringify(remote.profile));persist(merged);
    if(!dirty.current||budget<=0)break;
   }
  }catch{if(valid()){try{failure('session','account',0);}catch{toast.error('本机存储不足，同步未完成，请导出学习记录');}}}
  finally{
   if(valid()){
    syncing.current=false;updateStatus();
    const list=syncIssues(key);const session=state('session','account');
    const next=session?(session.status==='waiting'?session.nextRetryAt:Infinity):Math.min(...list.filter(x=>x.status==='waiting').map(x=>x.nextRetryAt),dirty.current?Date.now()+100:Infinity);
    if(Number.isFinite(next)&&navigator.onLine)retryTimer.current=setTimeout(()=>void runSync(),Math.min(2147483647,Math.max(100,next-Date.now())));
   }
  }
 },[owner,key,persist]);
 useEffect(()=>{
  generation.current++;activeKey.current=key;syncing.current=false;dirty.current=false;setReady(false);const saved=readSnapshot(key);current.current=saved;setData(saved);setIssues(syncIssues(key));setReady(true);void syncNow();
  const online=()=>void syncNow();const changed=(e:StorageEvent)=>{if(e.key?.startsWith(key)){const latest=readSnapshot(key);current.current=latest;setData(latest);setIssues(syncIssues(key));if(e.key.startsWith(key+':op:')||e.key.startsWith(key+':recording:'))void syncNow();}};
  window.addEventListener('online',online);window.addEventListener('focus',online);window.addEventListener('storage',changed);
  return()=>{generation.current++;dirty.current=false;if(retryTimer.current)clearTimeout(retryTimer.current);retryTimer.current=null;window.removeEventListener('online',online);window.removeEventListener('focus',online);window.removeEventListener('storage',changed);};
 },[key,syncNow,persist]);
 const retryIssue=(issue:SyncIssue)=>{if(activeKey.current!==key)return;try{localStorage.removeItem(key+':sync:'+issue.kind+':'+issue.id);setIssues(syncIssues(key));void syncNow();}catch{toast.error('本机存储不可用，请保留记录后重试');}};
 const enqueue=(type:Op['type'],value:Op['data'],d:StudyData):boolean=>{if(activeKey.current!==key)return false;const op:Op={id:createId(),owner,type,data:value};try{localStorage.setItem(key+':op:'+op.id,JSON.stringify(op));if(type==='profile')localStorage.setItem(key+':profile',JSON.stringify(value));}catch{toast.error('本机存储不足，记录尚未保存');return false;}persist(d);setSync('pending');void syncNow();return true;};
 const saveProfile=(p:Profile)=>enqueue('profile',p,{...current.current,profile:p});
 const addAttempt=(a:Attempt)=>enqueue('attempt',a,{...current.current,attempts:uniqueById([...current.current.attempts,a])});
 const addCheckin=(c:Checkin)=>enqueue('checkin',c,{...current.current,checkins:uniqueById([...current.current.checkins,c])});
 const addRecording=async(r:Recording,blob:Blob)=>{const gen=generation.current;await putAudio(key+':'+r.id,blob);localStorage.setItem(key+':recording:'+r.id,JSON.stringify(r));if(gen!==generation.current||activeKey.current!==key)return;persist({...current.current,recordings:[...current.current.recordings,r]});setSync('pending');void syncNow();};
 const recordingUrl=async(r:Recording)=>{const blob=await getAudio(key+':'+r.id);if(blob)return URL.createObjectURL(blob);if(owner&&r.uploaded)return '/api/recordings?id='+encodeURIComponent(r.id);throw Error('找不到这段本机录音，也没有已确认的云端副本');};
 return {data,ready,sync,issues,syncNow,retryIssue,saveProfile,addAttempt,addCheckin,addRecording,recordingUrl};
}
