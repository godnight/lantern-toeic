'use client';
import {stopLessonAudio} from '@/lib/lesson-audio';

import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,CheckCircle2,Download,Headphones,Mic,Play,RotateCcw,Square} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Checkbox} from '@/components/ui/checkbox';
import {toast} from 'sonner';
import {createId,type Recording,type Speaking} from '@/lib/study-model';
import {isNativeForeground,registerNativeBack,subscribeNativeState} from '@/lib/native-host';
import {SpeechPlayer} from './practice';
import type {SpeakingRecovery} from '@/lib/speaking-recovery';
import {useDialogViewport} from '@/lib/use-dialog-viewport';

type SpeakingPhase='ready'|'prep'|'recording'|'processing'|'done';
type SpeakingRoomProps={nativeMode?:boolean;timezone?:string;prompt:Speaking;onClose:()=>void;onSave:(recording:Recording,blob:Blob)=>Promise<void>;onFinish:(minutes:number)=>void;recovery?:SpeakingRecovery;onRetain?:(clip:SpeakingRecovery)=>void;onRelease?:(id:string)=>void};
const TASK_LABELS:Record<string,{label:string;description:string}>={
 'read-aloud':{label:'朗读',description:'读清通知，找到长句中的停顿。'},
 'describe-picture':{label:'图片描述',description:'先说场景，再描述人物与动作。'},
 'respond':{label:'简短问答',description:'用简单完整的句子回答信息点。'},
 'use-information':{label:'资料回答',description:'先阅读材料，再定位问题所需信息。'},
 'express-opinion':{label:'表达观点',description:'明确选择，用具体理由支持观点。'},
};
const clockText=(seconds:number)=>`${String(Math.floor(Math.max(0,seconds)/60)).padStart(2,'0')}:${String(Math.max(0,seconds)%60).padStart(2,'0')}`;
function recordingTime(iso:string,timezone?:string){
 try{return new Intl.DateTimeFormat('zh-CN',{timeZone:timezone,month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));}catch{return '发生时间暂不可读';}
}

/** Existing prompts remain separate tasks; no complete-test or AI-score claim. */
export function SpeakingTaskCatalog({prompts,onOpen,disabled=false}:{prompts:Speaking[];onOpen:(prompt:Speaking)=>void;disabled?:boolean}){
 return <section className="speaking-catalog" aria-label="口语专项目录">
  <div className="speaking-catalog-intro"><h2>选一项，开口练一次</h2><p>{prompts.length} 类原创专项 · 录音、回听与自评，不换算正式成绩。</p></div>
  <div className="speaking-task-grid">{prompts.map((prompt,index)=><article className="speaking-task" key={prompt.id}>
   <p className="speaking-task-kind">{String(index+1).padStart(2,'0')} · {TASK_LABELS[prompt.type]?.label||'口语专项'}</p><h3>{prompt.title}</h3><p>{TASK_LABELS[prompt.type]?.description||prompt.prompt}</p>
   <div className="speaking-task-times"><span>准备 <b>{prompt.prepSeconds} 秒</b></span><span>回答 <b>{prompt.answerSeconds} 秒</b></span></div>
   <button type="button" className="button secondary" disabled={disabled} onClick={()=>onOpen(prompt)} aria-label={`开始${prompt.title}`}>开始练习<ArrowRight size={17}/></button>
  </article>)}</div>
  <p className="speaking-catalog-note">简短问答和资料回答保留单题专项，完整三题组有不同的考试规则。当前不提供 AI 自动评分。</p>
 </section>;
}

/** Parent owns recordingUrl/player; loading errors retain recording metadata. */
export function SpeakingRecordingHistory({recordings,timezone,nativeMode=false,onPlay}:{recordings:Recording[];timezone:string;nativeMode?:boolean;onPlay:(recording:Recording)=>Promise<void>}){
 const [loading,setLoading]=useState<string|null>(null);const [failed,setFailed]=useState<string|null>(null);
 const playingRequest=useRef(0);const mounted=useRef(true);const loadingNow=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;playingRequest.current++;};},[]);
 const play=async(recording:Recording)=>{
  if(loadingNow.current)return;
  loadingNow.current=true;const request=++playingRequest.current;setLoading(recording.id);setFailed(null);
  try{await onPlay(recording);}catch{if(mounted.current&&request===playingRequest.current)setFailed(recording.id);}finally{if(mounted.current&&request===playingRequest.current){loadingNow.current=false;setLoading(null);}}
 };
 return <section className="speaking-history" aria-labelledby="speaking-history-title">
  <div className="speaking-section-heading"><h2 id="speaking-history-title">我的口语录音</h2><span>{recordings.length} 段</span></div>
  {recordings.length?<div className="speaking-recording-list">{recordings.slice().reverse().map(recording=><article className="speaking-recording-item" key={recording.id}>
   <div className="speaking-recording-row"><span className="speaking-recording-icon" aria-hidden="true"><Headphones size={20}/></span><div><h3>{recording.title}</h3><p><time dateTime={recording.createdAt}>{recordingTime(recording.createdAt,timezone)}</time> · {recording.duration} 秒 · {nativeMode?'本机录音':recording.uploaded?'已同步':'本机录音'}</p></div><button type="button" className="button secondary" disabled={loading!==null} onClick={()=>void play(recording)} aria-label={`回听${recording.title}`}>{loading===recording.id?'读取中…':'回听'}<Play size={16}/></button></div>
   {failed===recording.id&&<div className="speaking-notice error" role="alert"><strong>这段录音暂时无法读取</strong><p>本机音频未能读取，也可能没有已确认的云端副本。原记录与练习时间保留。</p><button type="button" className="button secondary" disabled={loading!==null} onClick={()=>void play(recording)}>重新读取<RotateCcw size={16}/></button></div>}
  </article>)}</div>:<div className="speaking-history-empty"><Mic size={24} aria-hidden="true"/><h3>还没有录音</h3><p>先完成一次专项练习，留住自己的起点。</p></div>}
  {loading&&<p className="speaking-reading-status" role="status">正在读取这段录音，原记录保持。</p>}
 </section>;
}

export default function SpeakingRoom({prompt,onClose,onSave,onFinish,nativeMode=false,timezone,recovery,onRetain,onRelease}:SpeakingRoomProps){
 const dialogViewport=useDialogViewport();
 const [phase,setPhase]=useState<SpeakingPhase>(recovery?'done':'ready');const [seconds,setSeconds]=useState(prompt.prepSeconds);
 const [url,setUrl]=useState('');const [saved,setSaved]=useState(false);const [busy,setBusy]=useState(false);const [saving,setSaving]=useState(false);const [saveError,setSaveError]=useState(false);const [accessError,setAccessError]=useState('');const [self,setSelf]=useState<string[]>([]);const [discardOpen,setDiscardOpen]=useState(false);const [returnNotice,setReturnNotice]=useState('');
 const recorder=useRef<MediaRecorder|null>(null);const stream=useRef<MediaStream|null>(null);const chunks=useRef<Blob[]>([]);const started=useRef(0);const stoppedAt=useRef(0);const last=useRef<{meta:Recording;blob:Blob}|null>(null);const objectURL=useRef('');const mounted=useRef(true);const beginning=useRef(false);const requestGeneration=useRef(0);const deadline=useRef(0);const currentPhase=useRef(phase);const savingNow=useRef(false);const acquiring=useRef(false);const exitRequested=useRef(false);currentPhase.current=phase;
 const stopMeta=useRef<Recording|null>(null);
 const recordingMeta=()=>stopMeta.current||(stopMeta.current={id:createId(),promptId:prompt.id,title:prompt.title,duration:Math.max(0,Math.round(((stoppedAt.current||Date.now())-started.current)/1000)),createdAt:new Date(started.current).toISOString(),mime:recorder.current?.mimeType||'audio/webm',note:''});
 const releaseMicrophone=()=>stream.current?.getTracks().forEach(track=>track.stop());
 const changePhase=(next:SpeakingPhase)=>{currentPhase.current=next;setPhase(next);};
 useEffect(()=>{mounted.current=true;if(recovery){last.current={meta:recovery.meta,blob:recovery.blob};objectURL.current=URL.createObjectURL(recovery.blob);setUrl(objectURL.current);setSaveError(!recovery.saving);if(recovery.saving){savingNow.current=true;setSaving(true);void recovery.saving.then(()=>{if(mounted.current){setSaved(true);setSaveError(false);}},()=>{if(mounted.current)setSaveError(true);}).finally(()=>{if(mounted.current){savingNow.current=false;setSaving(false);}});}}return()=>{mounted.current=false;requestGeneration.current++;if(recorder.current&&['recording','processing'].includes(currentPhase.current)){if(!stoppedAt.current)stoppedAt.current=Date.now();onRetain?.({prompt,meta:recordingMeta(),blob:new Blob(chunks.current,{type:recorder.current.mimeType||'audio/webm'}),processing:true});if(recorder.current.state==='recording')recorder.current.stop();}releaseMicrophone();if(objectURL.current)URL.revokeObjectURL(objectURL.current);};},[]);
 const persist=async(meta:Recording,blob:Blob)=>{
  // A rapid second retry must not write/upload the same clip concurrently.
  if(savingNow.current)return;
  const generation=requestGeneration.current;savingNow.current=true;setSaving(true);setSaveError(false);setDiscardOpen(false);
  const valid=()=>mounted.current&&generation===requestGeneration.current&&last.current?.meta.id===meta.id;
  try{const saving=onSave(meta,blob);onRetain?.({prompt,meta,blob,saving});await saving;onRelease?.(meta.id);if(!valid())return;setSaved(true);setSaveError(false);if(exitRequested.current)setReturnNotice('录音已保存。再次点击“返回口语目录”即可离开。');toast.success('录音已保存');}
  catch{onRetain?.({prompt,meta,blob});if(!valid())return;setSaveError(true);if(exitRequested.current)setReturnNotice('录音尚未保存。请重试、下载保留，或明确放弃后离开。');toast.error('录音暂未保存，请重试或下载保留');}
  finally{if(valid()){savingNow.current=false;setSaving(false);}}
 };
 const stop=()=>{if(recorder.current?.state!=='recording')return;stoppedAt.current=Date.now();changePhase('processing');recorder.current.stop();releaseMicrophone();};
 const begin=()=>{
  stopLessonAudio();
  if(!stream.current||beginning.current||recorder.current?.state==='recording'||document.hidden||!isNativeForeground())return;
  beginning.current=true;
  try{
   const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));const recording=new MediaRecorder(stream.current,mime?{mimeType:mime}:undefined);recorder.current=recording;chunks.current=[];stoppedAt.current=0;stopMeta.current=null;
   recording.ondataavailable=event=>{if(event.data.size)chunks.current.push(event.data);};
   recording.onstop=async()=>{
    beginning.current=false;releaseMicrophone();const blob=new Blob(chunks.current,{type:recording.mimeType||'audio/webm'});
    const meta:Recording={...recordingMeta(),mime:blob.type};
    if(!mounted.current){if(blob.size)onRetain?.({prompt,meta,blob});else onRelease?.(meta.id);return;}
    if(!blob.size){setAccessError('没有收到录音，请检查麦克风后重新准备。');toast.error('没有收到录音，请检查麦克风');changePhase('ready');return;}
    if(objectURL.current)URL.revokeObjectURL(objectURL.current);objectURL.current=URL.createObjectURL(blob);setUrl(objectURL.current);changePhase('done');
    last.current={meta,blob};onRetain?.({prompt,meta,blob});await persist(meta,blob);
   };
   recording.onerror=()=>{
    toast.error('录音中断，请回听已录内容');
    if(recording.state==='recording')stop();
    else{
     // The browser may inactivate first, then queue dataavailable and stop.
     // Do not let a fresh attempt overwrite that clip before onstop arrives.
     if(!stoppedAt.current)stoppedAt.current=Date.now();
     releaseMicrophone();changePhase('processing');
    }
   };
   recording.start(250);started.current=Date.now();deadline.current=started.current+prompt.answerSeconds*1000;changePhase('recording');setSeconds(prompt.answerSeconds);
  }catch{beginning.current=false;releaseMicrophone();changePhase('ready');setAccessError('录音未能启动，请检查设备麦克风后重试。');toast.error('录音未能启动，请检查设备麦克风后重试');}
 };
 const start=async()=>{
  stopLessonAudio();
  if(acquiring.current||busy||savingNow.current||!['ready','done'].includes(currentPhase.current)||document.hidden||!isNativeForeground())return;
  // Downloading does not authorize replacing an unsaved Blob with a fresh clip.
  if(currentPhase.current==='done'&&!saved)return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){const message=nativeMode?'当前系统未提供录音能力，请更新系统后重试，或先使用网页版。':'当前浏览器不支持录音，请在支持录音的 Safari 或 Chrome 中打开。';setAccessError(message);toast.error(message);return;}
  acquiring.current=true;setBusy(true);setAccessError('');setReturnNotice('');exitRequested.current=false;const generation=++requestGeneration.current;
  try{
   const acquired=await navigator.mediaDevices.getUserMedia({audio:true});
   if(!mounted.current||generation!==requestGeneration.current||document.hidden||!isNativeForeground()){acquired.getTracks().forEach(track=>track.stop());return;}
   stream.current=acquired;beginning.current=false;setSelf([]);setSaved(false);setSaveError(false);deadline.current=Date.now()+prompt.prepSeconds*1000;changePhase('prep');setSeconds(prompt.prepSeconds);
  }catch{if(mounted.current&&generation===requestGeneration.current){const message=nativeMode?'请在手机设置中允许微光托业使用麦克风，再重新准备。':'请在浏览器设置中允许使用麦克风，再重新准备。';setAccessError(message);toast.error(message);}}
  finally{if(mounted.current&&generation===requestGeneration.current){acquiring.current=false;setBusy(false);}}
 };
 const cancelPrep=()=>{requestGeneration.current++;acquiring.current=false;releaseMicrophone();beginning.current=false;setBusy(false);changePhase('ready');setSeconds(prompt.prepSeconds);};
 useEffect(()=>{if(phase!=='prep'&&phase!=='recording')return;const timer=setInterval(()=>setSeconds(Math.max(0,Math.ceil((deadline.current-Date.now())/1000))),250);return()=>clearInterval(timer);},[phase]);
 useEffect(()=>{
  const pause=()=>{
   if(!document.hidden&&isNativeForeground())return;
   // Duplicate native/browser background events must preserve an in-flight save.
   if(acquiring.current||currentPhase.current==='ready'||currentPhase.current==='prep'){requestGeneration.current++;acquiring.current=false;setBusy(false);}
   if(recorder.current?.state==='recording'){stop();toast('已结束录音，回来后可回听');}
   else if(currentPhase.current==='prep'){releaseMicrophone();beginning.current=false;changePhase('ready');setSeconds(prompt.prepSeconds);toast('准备已暂停，回来后重新开始');}
  };
  document.addEventListener('visibilitychange',pause);const unsubscribe=subscribeNativeState(pause);return()=>{document.removeEventListener('visibilitychange',pause);unsubscribe();};
 },[prompt.prepSeconds]);
 const requestClose=()=>{
  if(discardOpen){setDiscardOpen(false);return;}
  if(recorder.current?.state==='recording'){exitRequested.current=true;stop();setReturnNotice('录音已结束，正在整理。保存完成后再次点击“返回口语目录”。');return;}
  if(currentPhase.current==='processing'||currentPhase.current==='recording'){exitRequested.current=true;setReturnNotice('正在整理录音，请稍候。保存完成后再次点击“返回口语目录”。');return;}
  if(currentPhase.current==='prep'||busy){cancelPrep();setReturnNotice('准备已取消。再次点击“返回口语目录”即可离开。');return;}
  if(currentPhase.current==='done'&&!saved){exitRequested.current=true;if(savingNow.current||!saveError){setReturnNotice('正在保存录音。保存完成后再次点击“返回口语目录”；失败时留在这里处理。');return;}setDiscardOpen(true);return;}
  onClose();
 };
 const browserBack=useRef(()=>{});browserBack.current=requestClose;
 const historyLease=useRef({token:'',active:false,release:null as ReturnType<typeof setTimeout>|null});
 useEffect(()=>{
  if(!window.history?.pushState||!window.addEventListener)return;
  const lease=historyLease.current;if(lease.release!==null){clearTimeout(lease.release);lease.release=null;}if(!lease.token)lease.token=createId();lease.active=true;const token=lease.token;
  if(window.history.state?.lanternSpeakingView!==token)window.history.pushState({...window.history.state,lanternSpeakingView:token},'');
  const pop=(event:PopStateEvent)=>{if(!lease.active||event.state?.lanternSpeakingView===token)return;event.stopImmediatePropagation?.();window.history.pushState({...event.state,lanternSpeakingView:token},'');browserBack.current();};
  window.addEventListener('popstate',pop,true);
  return()=>{lease.active=false;window.removeEventListener('popstate',pop,true);if(lease.release!==null)clearTimeout(lease.release);lease.release=setTimeout(()=>{lease.release=null;if(!lease.active&&window.history.state?.lanternSpeakingView===token)window.history.back();},0);};
 },[]);
 useEffect(()=>registerNativeBack(()=>{requestClose();return true;},100),[phase,busy,saved,saveError,discardOpen,onClose]);
 useEffect(()=>{
  const warnBeforeUnload=(event:BeforeUnloadEvent)=>{if(!busy&&!['prep','recording','processing'].includes(currentPhase.current)&&!(currentPhase.current==='done'&&!saved))return;event.preventDefault();event.returnValue='';};
  if(typeof window.addEventListener!=='function')return;
  window.addEventListener('beforeunload',warnBeforeUnload);return()=>window.removeEventListener('beforeunload',warnBeforeUnload);
 },[busy,saved]);
 useEffect(()=>{if(seconds>0)return;if(phase==='prep')begin();if(phase==='recording')stop();},[seconds,phase]);
 const taskLabel=TASK_LABELS[prompt.type]?.label||'口语专项';
 const phaseLabel=phase==='recording'?'正在录音':phase==='prep'?'准备中':phase==='processing'?'整理录音':phase==='done'?saving?'保存中':saved?'已保存':'待保存':'录音前';
 const downloadName=`speaking-recording.${last.current?.meta.mime.includes('mp4')?'m4a':'webm'}`;
 const retrySave=()=>last.current?persist(last.current.meta,last.current.blob):Promise.resolve();
 const download=<a href={url} download={downloadName} className="button secondary speaking-download"><Download size={17}/>下载保留录音</a>;
 return <>
  <Dialog open onOpenChange={open=>{if(!open)requestClose();}}><DialogContent className="speaking-room" positioning="inset" style={dialogViewport(1120,true)} showCloseButton={false} onEscapeKeyDown={event=>{event.preventDefault();requestClose();}} onPointerDownOutside={event=>event.preventDefault()}>
   <div className="speaking-room-toolbar"><button type="button" className="button secondary" onClick={requestClose}><ArrowLeft size={17}/>返回口语目录</button><span>原创口语专项</span></div>
   <DialogHeader><DialogTitle>{prompt.title}</DialogTitle><DialogDescription>准备、录音、回听，只改一个地方。练习与自评不换算正式成绩。</DialogDescription></DialogHeader>
   <div className="speaking-room-scroll">
    <ol className="speaking-steps" aria-label="口语练习步骤"><li aria-current={phase!=='done'?'step':undefined}>1 准备与录音</li><li aria-current={phase==='done'?'step':undefined}>2 回听与自评</li><li>3 记录收获</li></ol>
    {returnNotice&&<div className="speaking-notice speaking-return-notice" role="status">{returnNotice}</div>}
    <div className="speaking-room-layout"><section className="speaking-material" aria-labelledby="speaking-material-title">
     <div className="speaking-section-heading"><h2 id="speaking-material-title">{prompt.image?'题目图片':prompt.passage?'练习材料':'练习问题'}</h2><span>{taskLabel}</span></div>
     {prompt.image&&<figure className="speaking-photo"><img src={prompt.image} alt="口语练习办公室图片"/><figcaption>题目图片 · 原创练习素材</figcaption></figure>}
     <p className="speaking-prompt" lang="en">{prompt.prompt}</p>{prompt.passage&&<div className="speaking-passage" lang="en">{prompt.passage}</div>}
     <details className="speaking-guide"><summary>练习提示</summary><ul>{prompt.guide.map(guide=><li key={guide}>{guide}</li>)}</ul></details>
    </section><section className="speaking-controls" aria-labelledby="speaking-controls-title">
     <div className="speaking-section-heading"><h2 id="speaking-controls-title">{phase==='done'?'回听与自评':'准备与录音'}</h2><span>{phaseLabel}</span></div>
     {phase!=='done'&&<><div className={'speaking-countdown '+(phase==='recording'?'is-recording':'')} aria-live="off"><b>{phase==='processing'?'…':clockText(seconds)}</b><span>{phase==='recording'?'回答剩余':phase==='prep'?'准备剩余':phase==='processing'?'正在整理':'秒准备'}</span></div><div className="speaking-durations"><span>准备 <b>{prompt.prepSeconds} 秒</b></span><span>回答 <b>{prompt.answerSeconds} 秒</b></span></div></>}
     {accessError&&<div className="speaking-notice error" role="alert"><strong>麦克风或录音当前不可用</strong><p>{accessError}</p></div>}
     {phase==='ready'&&<><p className="speaking-secondary">点击后申请麦克风权限。准备结束会自动录音，也可以提前开始。</p><button type="button" className="button primary speaking-main-action" disabled={busy} onClick={start}><Mic size={18}/>{busy?'等待麦克风…':'开始准备'}</button></>}
     {phase==='prep'&&<><p className="speaking-secondary" role="status">准备倒计时结束后，自动开始录音。</p><div className="speaking-action-stack"><button type="button" className="button primary" onClick={begin}>准备好了，现在录音<Play size={17}/></button><button type="button" className="button secondary" onClick={cancelPrep}>取消准备</button></div></>}
     {phase==='recording'&&<><p className="speaking-recording-status" role="status"><i aria-hidden="true"/>正在录音</p><p className="speaking-secondary">时间到会自动结束，也可以提前停录。</p><button type="button" className="button primary speaking-main-action" onClick={stop}><Square size={16} fill="currentColor"/>结束录音</button></>}
     {phase==='processing'&&<div className="speaking-notice" role="status"><strong>正在整理已录内容</strong><p>整理完成后会尝试本机保存，请留在本页。</p></div>}
     {phase==='done'&&<>
      <audio controls src={url} className="speaking-audio" aria-label="回听本次录音"/>
      <div className={'speaking-notice '+(saveError?'error':saved?'success':'')} role={saveError?'alert':'status'}><strong>{saved?'录音已保存在本机':saveError?'录音尚未保存':'正在保存录音…'}</strong><p>{saved?(nativeMode?'保存在这台设备。':'本机副本已保留，联网后同步。'):saveError?'这段音频仍在当前页面，可回听、重试或下载保留。离开后可能无法找回。':'可以先回听。保存成功后，才能再录或记录收获。'}</p></div>
      {saveError&&<div className="speaking-action-stack"><button type="button" className="button primary" disabled={saving} onClick={retrySave}><RotateCcw size={17}/>重试保存</button>{download}<button type="button" className="button secondary speaking-danger" onClick={()=>setDiscardOpen(true)}>放弃并离开</button></div>}
      <dl className="speaking-recording-meta"><div><dt>练习开始</dt><dd>{last.current?recordingTime(last.current.meta.createdAt,timezone):'—'}</dd></div><div><dt>录音长度</dt><dd>{last.current?.meta.duration??0} 秒</dd></div></dl>
      <div className="speaking-reflect"><h3>回听，只改一个地方</h3><p className="speaking-secondary">按真实感受自评，不产生自动分数。</p><fieldset className="speaking-self-checks"><legend>这一次我留意了</legend>{prompt.guide.map((guide,index)=><label key={guide} htmlFor={`speaking-self-${index}`}><Checkbox id={`speaking-self-${index}`} checked={self.includes(guide)} onCheckedChange={checked=>setSelf(items=>checked?[...items,guide]:items.filter(item=>item!==guide))}/><span>{guide}</span></label>)}</fieldset>
       <details className="speaking-sample"><summary>看看一种表达方式</summary><p lang="en">{prompt.sampleAnswer}</p><SpeechPlayer text={prompt.sampleAnswer} label="听示范表达"/></details>
       <div className="speaking-final-actions"><button type="button" className="button secondary" disabled={!saved||busy} onClick={start}><RotateCcw size={17}/>{busy?'等待麦克风…':'再说一次'}</button><button type="button" className="button primary" disabled={!saved||busy} onClick={()=>{if(!busy)onFinish(Math.max(1,Math.ceil(((last.current?.meta.duration||0)+prompt.prepSeconds)/60)));}}><CheckCircle2 size={17}/>记录收获</button></div><p className="speaking-caption">自评只用于本轮回听；学习时间与手记在下一步单独确认。</p>
      </div>
     </>}
    </section></div>
   </div>
  </DialogContent></Dialog>
  <Dialog open={discardOpen} onOpenChange={setDiscardOpen}><DialogContent className="speaking-discard" positioning="inset" style={dialogViewport(480)} showCloseButton={false}>
   <DialogHeader><DialogTitle>放弃这段未保存录音？</DialogTitle><DialogDescription>录音还没有保存到学习记录。离开会释放当前页面的临时音频，之后可能无法找回。可以先重试，或下载并确认文件已保留。</DialogDescription></DialogHeader>
   <div className="speaking-action-stack"><button type="button" className="button primary" onClick={()=>setDiscardOpen(false)}>留在这里</button><button type="button" className="button secondary" disabled={saving} onClick={retrySave}>重试保存<RotateCcw size={17}/></button>{download}<button type="button" className="button secondary speaking-danger" onClick={()=>{if(last.current)onRelease?.(last.current.meta.id);setDiscardOpen(false);onClose();}}>确认放弃并离开</button></div><p className="speaking-caption">下载仅保留音频文件，不代表录音已保存到学习记录。</p>
  </DialogContent></Dialog>
 </>;
}
