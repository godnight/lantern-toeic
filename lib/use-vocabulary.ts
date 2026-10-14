'use client';
import {useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {vocabularyId,parseVocabularyBackup,readVocabulary,writeVocabulary,vocabularyKey,vocabularyState,validVocabularyEvent,type VocabularyEvent} from './vocabulary-model';
export function useVocabulary(owner:string|null){
 const key=vocabularyKey(owner),active=useRef(key);active.current=key;const mounted=useRef(false);const syncControl=useRef({key,blocked:false,failures:0,message:''});if(syncControl.current.key!==key)syncControl.current={key,blocked:false,failures:0,message:''};
 const [snapshot,setSnapshot]=useState<{key:string;events:VocabularyEvent[];ready:boolean;error:string}>({key,events:[],ready:false,error:''});
 const [sync,setSync]=useState(owner?'等待同步':'本机保存');const [retry,setRetry]=useState(0);
 const current=snapshot.key===key?snapshot:{key,events:[],ready:false,error:''};
 function refresh(){if(active.current!==key)return;try{setSnapshot({key,events:readVocabulary(localStorage,key),ready:true,error:''});}catch{setSnapshot({key,events:[],ready:true,error:'词库记录暂时无法读取，已停止写入。请保留浏览器数据与备份，稍后重试。'});}}
 useEffect(()=>{mounted.current=true;refresh();const listener=(e:StorageEvent)=>{if(!e.key||e.key.startsWith(key)){refresh();setRetry(n=>n+1);}};const localChanged=(e:Event)=>{if((e as CustomEvent<string>).detail===key){refresh();setRetry(n=>n+1);}};window.addEventListener('storage',listener);window.addEventListener('lantern-vocabulary-changed',localChanged);return()=>{mounted.current=false;window.removeEventListener('storage',listener);window.removeEventListener('lantern-vocabulary-changed',localChanged);};},[key]);
 useEffect(()=>{
  if(!owner||!current.ready||current.error){setSync(owner?'同步需处理':'本机保存');return;}
  let cancelled=false,busy=false;const control=syncControl.current;let request:AbortController|undefined;
  const run=async()=>{if(busy||control.blocked){if(control.blocked)setSync(control.message);return;}busy=true;const controller=new AbortController();request=controller;const deadline=setTimeout(()=>controller.abort(),25000);setSync('词库同步中');try{
   const check=async(response:Response)=>{if(response.ok)return;if([400,401,403,409,413].includes(response.status)){control.blocked=true;throw Error(response.status===401?'登录已失效，请刷新登录后重试':response.status===409?'账号或记录冲突，请保留备份后重试':'词库同步被拒绝，请保留备份后重试');}throw Error('temporary');};
   const response=await fetch('/api/vocabulary',{cache:'no-store',signal:controller.signal});await check(response);const remote=await response.json() as {owner?:string;events?:unknown};
   if(cancelled||active.current!==key)return;if(remote.owner!==owner){control.blocked=true;throw Error('账号已切换，请刷新后重试');}
   let merged;try{merged=writeVocabulary(localStorage,key,parseVocabularyBackup(remote).events);}catch{control.blocked=true;throw Error('词库记录无法合并，请保留备份后重试');}refresh();
   const remoteIds=new Set(parseVocabularyBackup(remote).events.map(e=>e.id));const pending=merged.filter(e=>!remoteIds.has(e.id));
   for(let start=0;start<pending.length;start+=25){if(cancelled||active.current!==key)return;const result=await fetch('/api/vocabulary',{method:'POST',headers:{'content-type':'application/json','x-lantern-owner':owner},body:JSON.stringify({kind:'lantern-vocabulary',schemaVersion:1,events:pending.slice(start,start+25)}),signal:controller.signal});await check(result);}
   control.failures=0;if(!cancelled&&active.current===key)setSync('词库已同步');
  }catch(error){if(!cancelled&&active.current===key){control.failures++;if(control.failures>=3)control.blocked=true;control.message=control.blocked?(error instanceof Error&&error.message!=='temporary'&&error.name!=='AbortError'?error.message:'本机已保存 · 请手动重试同步'):'本机已保存 · 等待同步';setSync(control.message);}}finally{clearTimeout(deadline);busy=false;}};
  void run();const online=()=>void run();window.addEventListener('online',online);const timer=setInterval(online,60000);
  return()=>{cancelled=true;request?.abort();window.removeEventListener('online',online);clearInterval(timer);};
 },[key,current.ready,current.error,retry]);
 function save(events:VocabularyEvent[]){if(!mounted.current||active.current!==key||!current.ready||current.error)return false;try{const next=writeVocabulary(localStorage,key,events);setSnapshot({key,events:next,ready:true,error:''});setRetry(n=>n+1);try{if(typeof CustomEvent!=='undefined'&&typeof window.dispatchEvent==='function')window.dispatchEvent(new CustomEvent('lantern-vocabulary-changed',{detail:key}));}catch{/* An invalidation hint is not a learning event or durability acknowledgement. */}return true;}catch{toast.error('词库保存失败，当前卡片未跳过。请检查存储空间后重试。');return false;}}
 function mark(wordId:string,starred:boolean){try{const state=vocabularyState(readVocabulary(localStorage,key),wordId);return save([{id:vocabularyId(),wordId,createdAt:new Date().toISOString(),type:'mark',starred,revision:state.revision+1}]);}catch{toast.error('词库记录无法读取，未更改生词标记。');return false;}}
 function readEvent(id:string){if(!mounted.current||active.current!==key)throw Error('账号已切换');return readVocabulary(localStorage,key).find(event=>event.id===id);}
 function reviewEvent(event:VocabularyEvent & {type:'review'}){if(!validVocabularyEvent(event)||event.type!=='review')return false;const fixed={id:event.id,wordId:event.wordId,grade:event.grade,type:'review' as const,createdAt:event.createdAt};if(!save([fixed]))return false;try{const actual=readEvent(fixed.id);return !!actual&&actual.type==='review'&&actual.wordId===fixed.wordId&&actual.grade===fixed.grade&&new Date(actual.createdAt).toISOString()===new Date(fixed.createdAt).toISOString();}catch{return false;}}
 return {...current,sync,mark,readEvent,reviewEvent,review:(wordId:string,grade:'again'|'remembered',id:string)=>save([{id,wordId,grade,type:'review',createdAt:new Date().toISOString()}]),restore:(input:unknown)=>save(parseVocabularyBackup(input).events),backup:()=>{if(!mounted.current||active.current!==key)throw Error('账号已切换');return {kind:'lantern-vocabulary',schemaVersion:1,events:readVocabulary(localStorage,key)};},retry:()=>{syncControl.current={key,blocked:false,failures:0,message:''};refresh();setRetry(n=>n+1);}};
}
