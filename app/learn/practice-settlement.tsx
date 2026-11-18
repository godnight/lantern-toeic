'use client';
import {useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {registerNativeBack} from '@/lib/native-host';
import {createId,type Checkin} from '@/lib/study-model';

type Draft=Pick<Checkin,'minutes'|'load'|'note'>;
type Result={status:string;reason?:string};
type Props={session:{id:string;startedAt:string;settlement:{status:string;draft:Draft;payload:Checkin|null}};updateDraft:(id:string,draft:Draft)=>Promise<Result>;settle:(id:string,draft:Draft)=>Promise<Result>;onClose:()=>void};
const saved=(result:Result)=>['applied','replayed','updated'].includes(result.status);

/** A session owns one fixed Checkin. Closing saves the draft, never the minutes. */
export default function PracticeSettlement({session,updateDraft,settle,onClose}:Props){
 const initial=session.settlement.payload??session.settlement.draft;
 const [minutes,setMinutes]=useState(String(initial.minutes));const [load,setLoad]=useState(initial.load);const [note,setNote]=useState(initial.note);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const pending=useRef(false),alive=useRef(true);const frozen=session.settlement.status!=='draft';
 const draft=():Draft=>({minutes:Number(minutes),load,note});
 const valid=()=>Number.isInteger(Number(minutes))&&Number(minutes)>=1&&Number(minutes)<=240;
 const closeRef=useRef(()=>{});
 async function close(){
  if(pending.current)return;
  if(frozen){onClose();return;}
  if(!valid()){setError('请填写1至240的整数分钟；草稿尚未保存。');return;}
  pending.current=true;setBusy(true);setError('');
  try{const result=await updateDraft(session.id,draft());if(!alive.current)return;if(saved(result))onClose();else setError(result.reason||'草稿未保存，请保留此窗口重试。');}
  catch{if(alive.current)setError('草稿未保存，请保留此窗口重试。');}
  finally{pending.current=false;if(alive.current)setBusy(false);}
 }
 closeRef.current=()=>void close();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>registerNativeBack(()=>{closeRef.current();return true;},35),[]);
 const lease=useRef({token:'',active:false,release:null as ReturnType<typeof setTimeout>|null});
 useEffect(()=>{
  if(!window.history?.pushState)return;const state=lease.current;
  if(state.release!==null){clearTimeout(state.release);state.release=null;}if(!state.token)state.token=createId();state.active=true;
  if(window.history.state?.lanternPracticeSettlement!==state.token){
   const {lanternPracticeView,...base}=window.history.state||{};
   // The completed Practice is unmounted in this transition. Transfer its
   // history entry so its delayed cleanup cannot consume this new dialog.
   if(lanternPracticeView)window.history.replaceState({...base,lanternPracticeSettlement:state.token},'');
   else window.history.pushState({...base,lanternPracticeSettlement:state.token},'');
  }
  const pop=(event:PopStateEvent)=>{if(!state.active||event.state?.lanternPracticeSettlement===state.token)return;event.stopImmediatePropagation?.();window.history.pushState({...event.state,lanternPracticeSettlement:state.token},'');closeRef.current();};
  window.addEventListener('popstate',pop,true);
  return()=>{state.active=false;window.removeEventListener('popstate',pop,true);state.release=setTimeout(()=>{state.release=null;if(!state.active&&window.history.state?.lanternPracticeSettlement===state.token)window.history.back();},0);};
 },[]);
 const counted=session.settlement.status==='applied';
 return <Dialog open onOpenChange={open=>{if(!open)void close();}}><DialogContent className="settings-dialog" onEscapeKeyDown={event=>{event.preventDefault();void close();}} onPointerDownOutside={event=>event.preventDefault()}><DialogHeader><DialogTitle>{counted?'这组时间已记下':'确认这一组的实际用时'}</DialogTitle><DialogDescription>每组只记一次。题目作答已单独保存；分钟不会与逐题秒数或词卡次数相加。关闭保存草稿，稍后仍可确认。</DialogDescription></DialogHeader><form onSubmit={async event=>{
  event.preventDefault();if(pending.current||counted||!valid())return;pending.current=true;setBusy(true);setError('');
  try{const result=await settle(session.id,draft());if(!alive.current)return;if(saved(result))onClose();else setError(result.reason||'尚未确认记时；原分钟、时间和记录标识已保留，重试会核对同一条记录。');}
  catch{if(alive.current)setError('尚未确认记时；请重试同一条记录。');}finally{pending.current=false;if(alive.current)setBusy(false);}
 }}><p className="small muted">本组开始于 {new Date(session.startedAt).toLocaleString()}。初始分钟仅为候选，请按实际用时修改。</p><label className="field">实际学习分钟<input required type="number" min="1" max="240" value={minutes} disabled={busy||frozen} onChange={event=>setMinutes(event.target.value)}/></label><label className="field">今天的负荷<select value={load} disabled={busy||frozen} onChange={event=>setLoad(event.target.value as Checkin['load'])}>{['轻','刚好','重'].map(value=><option key={value}>{value}</option>)}</select></label><label className="field">一个收获或卡点<textarea value={note} disabled={busy||frozen} maxLength={1000} onChange={event=>setNote(event.target.value)}/></label>{error&&<p className="workspace-save-error" role="alert">{error}</p>}<div className="button-row"><button type="submit" className="button primary" disabled={busy||counted||!valid()}>{busy?'正在核对保存…':frozen?'重试确认同一条记录':'确认并记下时间'}</button><button type="button" className="button secondary" disabled={busy} onClick={()=>void close()}>稍后确认</button></div></form></DialogContent></Dialog>;
}
