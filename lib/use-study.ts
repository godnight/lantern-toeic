'use client';
import {useState,useEffect,useRef,useCallback} from 'react';
import {toast} from 'sonner';
import {EMPTY_DATA,mergeData,uniqueById,type StudyData,type Profile,type Attempt,type Checkin,type Recording} from './study-model';
type Op={id:string;owner:string|null;type:'profile'|'attempt'|'checkin';data:Profile|Attempt|Checkin};
function openAudioDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open('lantern-audio',1);r.onupgradeneeded=()=>r.result.createObjectStore('audio');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function putAudio(key:string,blob:Blob){const db=await openAudioDB();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('audio','readwrite');tx.objectStore('audio').put(blob,key);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
export async function getAudio(key:string):Promise<Blob|undefined>{const db=await openAudioDB();return new Promise((resolve,reject)=>{const tx=db.transaction('audio');const r=tx.objectStore('audio').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
// Each operation has its own storage key. Concurrent tabs cannot overwrite another
// operation, even if their summary snapshots race. Acknowledgements are separate.
function journal(key:string):Op[]{const result:Op[]=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(key+':op:')){try{result.push(JSON.parse(localStorage.getItem(k)||''));}catch{}}}return result;}
function readSnapshot(key:string):StudyData{try{const raw=JSON.parse(localStorage.getItem(key)||'null');const d:StudyData=raw?.data?.profile&&Array.isArray(raw.data.attempts)?{...EMPTY_DATA,...raw.data}:structuredClone(EMPTY_DATA);for(const op of journal(key)){if(op.type==='attempt'&&!d.attempts.some(a=>a.id===(op.data as Attempt).id))d.attempts=uniqueById([...d.attempts,op.data as Attempt]);if(op.type==='checkin'&&!d.checkins.some(c=>c.id===(op.data as Checkin).id))d.checkins=uniqueById([...d.checkins,op.data as Checkin]);}const p=localStorage.getItem(key+':profile');if(p)d.profile=JSON.parse(p);for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(key+':recording:'))d.recordings=uniqueById([...d.recordings,JSON.parse(localStorage.getItem(k)||'{}')]);}return d;}catch{return structuredClone(EMPTY_DATA);}}
export function useStudy(owner:string|null){
 const key='lantern-v1-'+(owner||'device');const generation=useRef(0);const activeKey=useRef(key);const syncing=useRef(false);
 const [data,setData]=useState<StudyData>(EMPTY_DATA);const current=useRef(data);const [ready,setReady]=useState(false);const [sync,setSync]=useState<'loading'|'synced'|'local'|'pending'>('loading');
 const persist=useCallback((d:StudyData)=>{if(activeKey.current!==key)return;const stored=readSnapshot(key);const next=mergeData(stored,d);current.current=next;setData(next);try{localStorage.setItem(key,JSON.stringify({data:next}));}catch{toast.error('本机存储空间不足，请导出学习记录');}},[key]);
 const syncNow=useCallback(async()=>{
  if(activeKey.current!==key||syncing.current)return;const gen=generation.current;const valid=()=>gen===generation.current&&activeKey.current===key;syncing.current=true;
  if(!owner){setSync('local');syncing.current=false;return;}setSync('loading');
  try{
   // Load fresh cross-tab state before each pass. Owner verification on the server
   // also prevents a request from crossing a browser account switch.
   for(const op of journal(key).filter(op=>op.owner===owner&&!localStorage.getItem(key+':ack:'+op.id))){
    if(!valid())return;const r=await fetch('/api/study',{method:'POST',headers:{'Content-Type':'application/json','X-Lantern-Owner':owner},body:JSON.stringify(op)});if(!valid())return;if(!r.ok)throw Error('sync');localStorage.setItem(key+':ack:'+op.id,'1');
   }
   const latest=readSnapshot(key);if(!valid())return;persist(mergeData(current.current,latest));
   for(const rec of current.current.recordings.filter(x=>!x.uploaded)){
    const blob=await getAudio(key+':'+rec.id);if(!valid())return;if(!blob)continue;const form=new FormData();form.append('audio',blob,'recording.'+(blob.type.includes('mp4')?'m4a':'webm'));form.append('meta',JSON.stringify(rec));const r=await fetch('/api/recordings',{method:'POST',headers:{'X-Lantern-Owner':owner},body:form});if(!valid())return;if(!r.ok)throw Error('audio');localStorage.setItem(key+':recording:'+rec.id,JSON.stringify({...rec,uploaded:true}));persist({...current.current,recordings:current.current.recordings.map(x=>x.id===rec.id?{...x,uploaded:true}:x)});
   }
   const r=await fetch('/api/study',{cache:'no-store'});if(!valid())return;if(!r.ok)throw Error('fetch');const remote=await r.json() as StudyData & {owner:string;hasProfile:boolean};if(!valid())return;if(remote.owner!==owner)throw Error('owner');const pending=journal(key).filter(op=>!localStorage.getItem(key+':ack:'+op.id));const merged=mergeData(readSnapshot(key),remote);if(pending.some(x=>x.type==='profile')||!remote.hasProfile)merged.profile=current.current.profile;else localStorage.setItem(key+':profile',JSON.stringify(remote.profile));persist(merged);setSync(pending.length?'pending':'synced');
  }catch{if(valid())setSync(navigator.onLine?'pending':'local');}finally{if(valid())syncing.current=false;}
 },[owner,key,persist]);
 useEffect(()=>{generation.current++;activeKey.current=key;syncing.current=false;setReady(false);const saved=readSnapshot(key);current.current=saved;setData(saved);setReady(true);void syncNow();const online=()=>void syncNow();const changed=(e:StorageEvent)=>{if(e.key?.startsWith(key)){const latest=readSnapshot(key);current.current=latest;setData(latest);if(e.key.startsWith(key+':op:')||e.key.startsWith(key+':recording:'))void syncNow();}};window.addEventListener('online',online);window.addEventListener('focus',online);window.addEventListener('storage',changed);return()=>{generation.current++;window.removeEventListener('online',online);window.removeEventListener('focus',online);window.removeEventListener('storage',changed);};},[key,syncNow,persist]);
 const enqueue=(type:Op['type'],value:Op['data'],d:StudyData)=>{if(activeKey.current!==key)return;const op:Op={id:crypto.randomUUID(),owner,type,data:value};try{localStorage.setItem(key+':op:'+op.id,JSON.stringify(op));if(type==='profile')localStorage.setItem(key+':profile',JSON.stringify(value));}catch{toast.error('本机存储不足，记录尚未保存');return;}persist(d);setSync('pending');void syncNow();};
 const saveProfile=(p:Profile)=>enqueue('profile',p,{...current.current,profile:p});
 const addAttempt=(a:Attempt)=>enqueue('attempt',a,{...current.current,attempts:uniqueById([...current.current.attempts,a])});
 const addCheckin=(c:Checkin)=>enqueue('checkin',c,{...current.current,checkins:uniqueById([...current.current.checkins,c])});
 const addRecording=async(r:Recording,blob:Blob)=>{const gen=generation.current;await putAudio(key+':'+r.id,blob);localStorage.setItem(key+':recording:'+r.id,JSON.stringify(r));if(gen!==generation.current||activeKey.current!==key)return;persist({...current.current,recordings:[...current.current.recordings,r]});setSync('pending');void syncNow();};
 const recordingUrl=async(r:Recording)=>{const blob=await getAudio(key+':'+r.id);return blob?URL.createObjectURL(blob):'/api/recordings?id='+encodeURIComponent(r.id);};
 return {data,ready,sync,syncNow,saveProfile,addAttempt,addCheckin,addRecording,recordingUrl};
}
