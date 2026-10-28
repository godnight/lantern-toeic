'use client';
import {useLearningAccess} from '@/lib/learning-access';
import {useState,useEffect,useRef} from 'react';
import type {ReactNode} from 'react';
import {canonicalHash} from '@/lib/domain-command';
import {initialPracticeTraining,practiceUnitId,materialHash,trainingText,type PracticeTraining,type TrainingWrite,type MaterialTraining,type TrainingAudio,type TrainingStep} from '@/lib/practice-training';
import type {PracticeResult} from '@/lib/practice-workflow';
import {usePracticeTraining} from './use-practice-training';
import {Play,Pause,ArrowRight,Check,RotateCcw,Volume2,BookOpen,CheckCircle2,Headphones,LoaderCircle} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Progress} from '@/components/ui/progress';
import {createId,PARTS,normalizeText,type Question,type Attempt} from '@/lib/study-model';
import {bundledLessonAudio,bundledLessonSource,stopLessonAudio,naturalLessonDescriptor,naturalAudioRegistry,subscribeProductLessonAudio,productLessonAudioState,retryProductLessonAudio} from '@/lib/lesson-audio';
import {getQuestionPrivateAudio} from '@/lib/question-audio-bindings-v040';
import {getReviewedListeningAudio as getListening50Audio} from '@/lib/question-audio-dispatch-v041';
import {createExplicitBundledPlayback} from '@/lib/explicit-bundled-playback';
import {registerNativeBack,subscribeNativeState} from '@/lib/native-host';
// Paused players remain mounted. Only the most recently started player owns the checkpoint.
let checkpointOwner:object|null=null;
export function SpeechPlayer({text,label='播放音频',trackId='question',checkpoint,onCheckpoint,audioKey,materialId,segmentId,voiceProfileId,contextHash,naturalOnly=false,mode='listening',className='',disabled=false}:{text:string;label?:string;sourceLabel?:string;trackId?:string;checkpoint?:TrainingAudio|null;onCheckpoint?:(value:TrainingAudio,urgent?:boolean)=>void;audioKey?:string;materialId?:string;segmentId?:string;voiceProfileId?:string;contextHash?:string;naturalOnly?:boolean;mode?:'listening'|'word'|'example';className?:string;disabled?:boolean}){
 const accountAccess=useLearningAccess();
 const compact=mode!=='listening',effectiveRate=(value:number)=>compact?1:value;
 const [,audioRevision]=useState(0);
 useEffect(()=>{const unsubscribe=subscribeProductLessonAudio(()=>audioRevision(value=>value+1));audioRevision(value=>value+1);return unsubscribe;},[]);
 const selector={assetKey:audioKey,materialId,segmentId,voiceProfileId,contextHash};
 const natural=naturalLessonDescriptor(text,selector),clip=naturalOnly?(natural?.url??null):bundledLessonAudio(text,selector),sourceId=(naturalOnly?natural?.sourceId:bundledLessonSource(text,selector))||'missing:'+canonicalHash(text+JSON.stringify(selector));
 const matching=checkpoint?.trackId===trackId&&checkpoint.sourceId===sourceId;
 const [playing,setPlaying]=useState(false),[preparing,setPreparing]=useState(false),[prepareError,setPrepareError]=useState(''),[rate,setRate]=useState(String(effectiveRate(matching?checkpoint.rate:1))),[position,setPosition]=useState(matching?checkpoint.positionSeconds:0),[completed,setCompleted]=useState(false);
 const audioHost=useRef<HTMLSpanElement|null>(null),playback=useRef<ReturnType<typeof createExplicitBundledPlayback>|null>(null),played=useRef(false),playingRef=useRef(false),offset=useRef(matching?checkpoint.positionSeconds:0),rateRef=useRef(Number(rate)),lastSaved=useRef(0),generation=useRef(0);
 const prepareController=useRef<(()=>Promise<ReturnType<typeof createExplicitBundledPlayback>|null>)|null>(null),prepareAbort=useRef<AbortController|null>(null);
 const replayNext=useRef(false);
 const callbacks=useRef(onCheckpoint);callbacks.current=onCheckpoint;
 const owner=useRef({}),playedSource=useRef(''),effectOwner=useRef<object|null>(null),effectSource=useRef(''),renderSource=useRef('');renderSource.current=sourceId+'|'+trackId+'|'+mode;
 const capture=(urgent=false)=>{if(!clip||!played.current||playedSource.current!==sourceId||checkpointOwner!==owner.current)return;const seconds=playback.current?.position()??offset.current;offset.current=seconds;setPosition(seconds);callbacks.current?.({trackId,sourceId,kind:'bundled',capability:'time',positionSeconds:Math.round(seconds*1000)/1000,rate:rateRef.current},urgent);};
 const captureRef=useRef(capture);captureRef.current=capture;
 const pause=(reload=false)=>{generation.current++;prepareAbort.current?.abort();setPreparing(false);playback.current?.pause(reload);playingRef.current=false;setPlaying(false);captureRef.current(true);};
 useEffect(()=>{if(!played.current&&matching){offset.current=checkpoint.positionSeconds;setPosition(checkpoint.positionSeconds);setRate(String(effectiveRate(checkpoint.rate)));rateRef.current=effectiveRate(checkpoint.rate);}},[checkpoint,matching,mode]);
 useEffect(()=>{if(disabled)pause();},[disabled]);
 useEffect(()=>{
  let retired=false,player:ReturnType<typeof createExplicitBundledPlayback>|null=null;
  let resource:Awaited<ReturnType<typeof naturalAudioRegistry.prepare>>|null=null,pending:Promise<ReturnType<typeof createExplicitBundledPlayback>|null>|null=null;
  const scope={};effectOwner.current=scope;
  const identity=sourceId+'|'+trackId+'|'+mode;
  if(effectSource.current!==identity){effectSource.current=identity;replayNext.current=false;setCompleted(false);playingRef.current=false;setPlaying(false);setPreparing(false);setPrepareError('');played.current=false;playedSource.current='';offset.current=matching?checkpoint!.positionSeconds:0;rateRef.current=effectiveRate(matching?checkpoint!.rate:1);setPosition(offset.current);setRate(String(rateRef.current));}
  const originalCheckpoint=callbacks.current;
  const captureOwn=(urgent=false)=>{
   if(!clip||retired||effectOwner.current!==scope||!played.current||playedSource.current!==sourceId||checkpointOwner!==owner.current)return;
   const seconds=player?.position()??offset.current;
   if(playback.current===player&&renderSource.current===identity){offset.current=seconds;setPosition(seconds);}
   const save=renderSource.current===identity?callbacks.current:originalCheckpoint;
   save?.({trackId,sourceId,kind:'bundled',capability:'time',positionSeconds:Math.round(seconds*1000)/1000,rate:rateRef.current},urgent);
  };
  const current=()=>!retired&&effectOwner.current===scope&&renderSource.current===identity&&playback.current===player;
  const changed=(value:boolean)=>{if(!current())return;playingRef.current=value;setPlaying(value);if(!value){if(player?.completed()){replayNext.current=true;setCompleted(true);}captureOwn(true);}};
  const construct=(url:string)=>createExplicitBundledPlayback(()=>{
   const host=audioHost.current;if(!host)throw new Error('Lesson audio host unavailable');
   const media=document.createElement('audio');media.src=url;media.preload='metadata';media.hidden=true;host.appendChild(media);return media;
  },changed,()=>{if(current())setPrepareError('暂时无法播放，请重试。');},()=>{
   if(!current())return;replayNext.current=false;setCompleted(false);checkpointOwner=owner.current;played.current=true;playedSource.current=sourceId;captureOwn(true);
  },seconds=>{if(!current())return;setPosition(seconds);if(Date.now()-lastSaved.current>=5000){lastSaved.current=Date.now();captureOwn();}});
  if(clip&&!natural)player=construct(clip);
  playback.current=player;
  const ensure=()=>{
   if(player)return Promise.resolve(player);
   if(!natural||!clip||!current())return Promise.resolve(null);
   if(pending)return pending;
   const abort=new AbortController();prepareAbort.current=abort;
   const request=naturalAudioRegistry.prepare(text,{...selector,signal:abort.signal}).then(prepared=>{
    if(!current()||abort.signal.aborted){prepared.release();return null;}
    resource=prepared;player=construct(prepared.url);playback.current=player;
    return player;
   });
   pending=request;void request.finally(()=>{if(pending===request)pending=null;}).catch(()=>{});
   return request;
  };
  prepareController.current=ensure;
  const stopOwn=(reload=false)=>{if(!current())return;generation.current++;prepareAbort.current?.abort();pending=null;setPreparing(false);player?.pause(reload);playingRef.current=false;setPlaying(false);captureOwn(true);};
  const stop=()=>stopOwn(),suspend=()=>stopOwn(true),visibility=()=>{if(document.visibilityState==='hidden')suspend();};
  window.addEventListener('lantern-stop-lesson-audio',stop);window.addEventListener('pagehide',suspend);document.addEventListener('visibilitychange',visibility);
  const unsubscribe=subscribeNativeState(active=>{if(!active)suspend();});
  return()=>{
   const owned=effectOwner.current===scope&&playback.current===player;captureOwn(true);retired=true;prepareAbort.current?.abort();player?.dispose();resource?.release();
   if(owned){effectOwner.current=null;playback.current=null;prepareController.current=null;generation.current++;if(checkpointOwner===owner.current)checkpointOwner=null;}
   window.removeEventListener('lantern-stop-lesson-audio',stop);window.removeEventListener('pagehide',suspend);document.removeEventListener('visibilitychange',visibility);unsubscribe();
  };
 },[text,clip,sourceId,trackId,mode]);
 const play=async(restart=false)=>{
  if(!accountAccess()||disabled)return;
  if(playingRef.current&&!restart){pause();return;}
  if(!clip){setPrepareError('这段音频尚未准备。');return;}
  const replay=restart||replayNext.current||(mode==='word'&&!played.current);
  stopLessonAudio();const token=++generation.current;setPrepareError('');setPreparing(true);
  try{
   const player=await prepareController.current?.();
   if(!accountAccess()||token!==generation.current)return;
   setPreparing(false);
   if(!player){setPrepareError('这段音频暂时不可用，请重试。');return;}
   rateRef.current=effectiveRate(rateRef.current);
   if(replay)player.play(rateRef.current,0);else player.resume(rateRef.current,offset.current);
  }catch{if(token!==generation.current)return;setPreparing(false);setPrepareError('暂时无法播放，请重试。');}
 };

 const availability=productLessonAudioState();
 const actionName=compact?(mode==='word'?'单词发音':'例句'):label;
 const actionLabel=preparing?'正在准备 '+actionName:playing?'暂停 '+actionName:completed?'再听一遍 '+actionName:position>0&&!(mode==='word'&&!played.current)?'继续 '+actionName:compact?'播放 '+actionName:label;
 return <div className={(compact?'speech-audio':'audio-player practice-audio-player speech-audio')+' speech-audio--'+mode+(className?' '+className:'')} data-audio-mode={mode} data-audio-state={preparing?'preparing':playing?'playing':completed?'completed':prepareError?'error':'idle'}>
  {clip&&<span ref={audioHost} hidden aria-hidden="true"/>}
  <button type="button" className={compact?'speech-audio-icon':'play-circle speech-audio-icon'} disabled={disabled||!clip||preparing}
   aria-label={actionLabel} aria-busy={preparing||undefined}
   title={playing?'暂停':completed?'再听一遍':'播放'} onClick={()=>void play()}>
   {preparing?<LoaderCircle size={20} className="speech-audio-loading"/>:playing?<Pause size={20}/>:completed?<RotateCcw size={20}/>:compact?<Volume2 size={22}/>:<Play size={20} fill="currentColor"/>}
  </button>
  <div className={compact?'speech-audio-feedback':'audio-meta'}>{!compact&&<b>{label}</b>}
   {preparing&&<small role="status">正在准备音频…</small>}
   {prepareError&&<small role="alert">{prepareError}</small>}
   {!clip&&<small role="status">{availability.phase==='error'?'音频暂时不可用，请重试。':'这段音频尚未准备。'}</small>}
   {!clip&&availability.phase==='error'&&<button type="button" className="text-button" onClick={()=>void retryProductLessonAudio()}>重试准备音频</button>}
   {checkpoint?.trackId===trackId&&!matching&&<small role="status">音频已更新，请从头播放。</small>}
  </div>
  {!compact&&<Select value={rate} onValueChange={v=>{pause();rateRef.current=Number(v);setRate(v);capture(true);}}>
   <SelectTrigger disabled={disabled||!clip||preparing} aria-label="语速" className="speed-select"><SelectValue/></SelectTrigger>
   <SelectContent>{['0.7','0.85','1','1.15'].map(r=><SelectItem key={r} value={r}>{r}×</SelectItem>)}</SelectContent>
  </Select>}
  {!compact&&clip&&position>0&&!playing&&!completed&&<button type="button" className="text-button practice-audio-restart" disabled={disabled||preparing} onClick={()=>void play(true)} aria-label={'从头播放 '+label}>从头再听</button>}
 </div>;
}

type DurablePractice = {readError?:string;retryRead?:()=>void;revision?:number;training?:PracticeTraining;steps?:{choice:number|null;status:string}[];updateTraining?:(write:TrainingWrite)=>Promise<PracticeResult>;blocked?:string;cursor:number;choice:number|null;submitted:boolean;finished:boolean;correct:number;busy:boolean;submit:(choice:number,seconds:number)=>Promise<boolean>;next:()=>Promise<boolean>};
export default function Practice({queue,attempts,onAttempt,onClose,onFinish,onLookup,lookupActive=false,durable,renderExample,onContinue,onSpecialty,onWrong,onCustom}:{queue:Question[];attempts:Attempt[];onAttempt:(a:Attempt)=>boolean;onClose:()=>void;onFinish:(minutes:number)=>void;onLookup?:(term:string)=>void;lookupActive?:boolean;durable?:DurablePractice;renderExample?:(text:string)=>ReactNode;onContinue?:()=>void;onSpecialty?:()=>void;onWrong?:()=>void;onCustom?:()=>void}){
 const [localIndex,setIndex]=useState(0);const [localChoice,setChoice]=useState('');const [localSubmitted,setSubmitted]=useState(false);const [localCorrect,setCorrect]=useState(0);const [localFinished,setFinished]=useState(false);const [unsavedExit,setUnsavedExit]=useState(false);const [saveError,setSaveError]=useState(false);const [advanceError,setAdvanceError]=useState(false);const [exitOpen,setExitOpen]=useState(false);const [imageOpen,setImageOpen]=useState(false);const pending=useRef<Attempt|null>(null);const start=useRef(Date.now());const qStart=useRef(Date.now());
 const fallbackTraining=useRef(initialPracticeTraining(queue,durable?.cursor??0));
 const training=usePracticeTraining(durable?.training??fallbackTraining.current,durable?.updateTraining??(async()=>({status:'updated',sessionId:''})),durable?.revision??0,!durable?.readError&&!durable?.blocked);
 const view=durable?.training?training.draft.confirmed.viewIndex:(durable?.cursor??localIndex);
 const index=Math.min(view,queue.length-1),step=durable?.steps?.[index];
 const choice=step?.choice!==null&&step?.choice!==undefined?String(step.choice):durable&&index===durable.cursor&&durable.choice!==null?String(durable.choice):localChoice;
 const submitted=step?step.status==='applied':durable?.submitted??localSubmitted;
 const finished=durable?(durable.finished&&view>=queue.length):localFinished,correct=durable?.correct??localCorrect;
 const material=training.training.materials.find(item=>item.unitId===practiceUnitId(queue[index])&&item.materialHash===materialHash(queue[index]))!;
 const confirmedMaterial=training.draft.confirmed.materials.find(item=>item.unitId===material.unitId&&item.materialHash===material.materialHash)??material;
 const dictation=material.dictationDraft,dictationDone=material.checkedDraft!==null&&material.checkedDraft===dictation;
 const updateMaterial=(patch:Partial<MaterialTraining>,urgent=false)=>{const current=training.draft.value;training.edit({...current,materials:current.materials.map(item=>item.unitId===material.unitId&&item.materialHash===material.materialHash?{...item,...patch}:item)});if(urgent)void training.flush();};
 const checkpoint=(audio:TrainingAudio,urgent=false)=>{const current=training.draft.value.materials.find(item=>item.unitId===material.unitId&&item.materialHash===material.materialHash);updateMaterial({audio,...(audio.trackId.startsWith('sentence:')&&current?.listeningStatus==='pending'?{listeningStatus:'in-progress' as const}:{})},urgent);};
 const showQuestion=async(target:number)=>{if(durable?.readError)return;stopLessonAudio();if(!await training.flush()){setAdvanceError(true);return;}const current=training.draft.value;const question=queue[target];training.edit({...current,viewIndex:target,materials:current.materials.map(item=>question&&durable?.steps?.[target]?.status!=='applied'&&item.unitId===practiceUnitId(question)&&item.materialHash===materialHash(question)?{...item,step:'answer'}:item)});if(!await training.flush())setAdvanceError(true);};
 const closeSaved=async()=>{stopLessonAudio();if(!durable){onClose();return;}if(!await training.flush()){setUnsavedExit(true);setExitOpen(true);return;}onClose();};
 useEffect(()=>{setChoice('');setSaveError(false);setAdvanceError(false);qStart.current=Date.now();},[index]);
 useEffect(()=>{if(lookupActive)stopLessonAudio();},[lookupActive]);
 const lookupOpen=useRef(lookupActive);lookupOpen.current=lookupActive;
 const initialAttempts=useRef(new Set(attempts.map(a=>a.qid)));const q=queue[index];const listening50=q?getListening50Audio(q.id):null;const privateUnitAudio=listening50?.body||(q?getQuestionPrivateAudio(q.id):null);const hadAttempt=initialAttempts.current.has(q?.id);const transcript=q?.transcript||q?.audioText||'';const sentence=transcript.split(/(?<=[.!?])\s+/)[0]||'';
 const submit=()=>{if(lookupOpen.current||choice===''||submitted||durable?.busy||durable?.blocked||durable?.readError)return;const seconds=Math.min(7200,Math.round((Date.now()-qStart.current)/1000));if(durable){void durable.submit(Number(choice),seconds).then(ok=>setSaveError(!ok)).catch(()=>setSaveError(true));return;}const ok=Number(choice)===q.correctIndex;const a:Attempt=pending.current?.qid===q.id&&pending.current.choice===Number(choice)?pending.current:{id:createId(),qid:q.id,choice:Number(choice),correct:ok,createdAt:new Date().toISOString(),seconds,mode:hadAttempt?'review':'first'};pending.current=a;if(!onAttempt(a)){setSaveError(true);return;}pending.current=null;setSaveError(false);setSubmitted(true);if(ok)setCorrect(c=>c+1);};
 const next=()=>{if(lookupOpen.current||durable?.busy||durable?.blocked||durable?.readError||!submitted)return;if(!durable){stopLessonAudio();if(index===queue.length-1){setFinished(true);return;}setIndex(i=>i+1);setChoice('');setSubmitted(false);setSaveError(false);pending.current=null;qStart.current=Date.now();return;}void(async()=>{stopLessonAudio();if(!await training.flush()){setAdvanceError(true);return;}if(durable){if(index<durable.cursor){await showQuestion(index+1);return;}const ok=await durable.next();setAdvanceError(!ok);return;}if(index===queue.length-1){setFinished(true);return;}setIndex(i=>i+1);setChoice('');setSubmitted(false);setSaveError(false);pending.current=null;qStart.current=Date.now();})();};
 const continueSaved=(action:()=>void)=>{stopLessonAudio();void training.flush().then(ok=>{if(ok)action();else{setUnsavedExit(true);setExitOpen(true);}});};
 const requestClose=()=>{if(lookupOpen.current)return;stopLessonAudio();void training.flush();if(durable?.blocked){onClose();return;}if(imageOpen){setImageOpen(false);return;}if(finished){void closeSaved();return;}setExitOpen(true);};
 const browserBack=useRef(()=>{});browserBack.current=()=>{if(imageOpen){setImageOpen(false);return;}if(exitOpen){setExitOpen(false);return;}requestClose();};const historyLease=useRef({token:'',active:false,release:null as ReturnType<typeof setTimeout>|null});
 useEffect(()=>{
  if(!window.history?.pushState||!window.addEventListener)return;
  const lease=historyLease.current;if(lease.release!==null){clearTimeout(lease.release);lease.release=null;}if(!lease.token)lease.token=createId();lease.active=true;const token=lease.token;
  if(window.history.state?.lanternPracticeView!==token)window.history.pushState({...window.history.state,lanternPracticeView:token},'');
  const pop=(event:PopStateEvent)=>{if(lookupOpen.current)return;if(!lease.active||event.state?.lanternPracticeView===token)return;event.stopImmediatePropagation?.();window.history.pushState({...event.state,lanternPracticeView:token},'');browserBack.current();};
  window.addEventListener('popstate',pop,true);
  return()=>{lease.active=false;window.removeEventListener('popstate',pop,true);if(lease.release!==null)clearTimeout(lease.release);lease.release=setTimeout(()=>{lease.release=null;if(!lease.active&&window.history.state?.lanternPracticeView===token)window.history.back();},0);};
 },[]);
 useEffect(()=>registerNativeBack(()=>{if(lookupOpen.current)return false;if(imageOpen){setImageOpen(false);return true;}if(exitOpen){setExitOpen(false);return true;}requestClose();return true;},10),[imageOpen,exitOpen,finished,durable?.blocked]);
 if(!q)return null;
 return <><Dialog open onOpenChange={open=>{if(!open)requestClose();}}><DialogContent className="practice-dialog"><DialogHeader><DialogTitle>{finished?'本组练习完成':`Part ${q.part} · ${PARTS[q.part-1]}`}</DialogTitle><DialogDescription>{finished?'答题结果已记录。':`${index+1} / ${queue.length} · ${hadAttempt?'复练':'首次作答'}`}</DialogDescription></DialogHeader>
 {durable?.readError&&<section className="workspace-save-error" role="alert"><b>练习记录暂时无法读取</b><p>{durable.readError} 本页输入保留，新的作答与导航已暂停。</p><button type="button" className="button secondary" onClick={durable.retryRead}>重新读取，保留本页草稿</button></section>}
 {['error','unknown','conflict'].includes(training.draft.status)&&<div className="training-save-status" role="alert"><span>{training.draft.status==='conflict'?'另一处更新了练习进度，请选择要保留的内容。':training.draft.status==='unknown'?'保存结果尚未确认，当前内容已保留，请重试。':'暂时未能保存，当前内容已保留，请重试。'}</span><button type="button" className="text-button" onClick={()=>void training.flush(true)}>{training.draft.status==='conflict'?(training.draft.conflicts.length?'合并，冲突字段保留本页内容':'合并本页改动'):'重试保存'}</button></div>}
 {training.draft.status==='conflict'&&<section className="workspace-save-error" role="alert"><p>请核对后选择。合并会保留另一窗口未被本页修改的材料和字段。</p>{training.draft.conflicts.map(item=><div key={item.path}><b>{item.path}</b><p>本页：{JSON.stringify(item.local)}</p><p>另一窗口：{JSON.stringify(item.remote)}</p></div>)}<button type="button" className="button secondary" onClick={()=>training.draft.acceptRemote()}>放弃本页未保存改动，采用另一窗口内容</button></section>}
 {durable?.blocked?<section className="workspace-save-error" role="alert"><h2>这组记录还需要核对</h2><p>{durable.blocked}</p><p>当前组与原操作保留；核实前不显示解析或完成。</p><button className="button secondary" onClick={onClose}>保留此组并返回</button></section>:!finished?<><Progress aria-label="本组已提交题目" value={((durable?durable.cursor+(durable.steps?.[durable.cursor]?.status==='applied'?1:0):index+(submitted?1:0))/queue.length)*100} className="thin-progress"/>{durable?.steps&&<div className="training-question-nav" aria-label="查看已答题">{durable.steps.map((item,i)=>i<=durable.cursor&&<button type="button" className={'text-button'+(i===index?' active':'')} disabled={i>durable.cursor||durable.busy||!!durable.readError} key={i} onClick={()=>void showQuestion(i)} aria-current={i===index?'step':undefined}>{i+1}{item.status==='applied'?' · 已答':' · 待答'}</button>)}</div>}<div className={'question-scroll'+(q.passage||q.image?' practice-with-material':'')} key={q.id}><div className="practice-material"><div className="question-head"><span className="pill">{q.skill}</span><span className="muted small">{q.difficulty}</span></div>{q.image&&<button className="practice-image-button" onClick={()=>setImageOpen(true)} aria-label="放大本题配图"><img className="question-image" src={q.image} alt="本题配图，请根据图片与音频作答"/><span className="small muted">点击放大图片</span></button>}{q.passage&&<div className="passage" lang="en">{q.passage}</div>}{q.part<=4&&<SpeechPlayer key={practiceUnitId(q)} {...(privateUnitAudio?{text:privateUnitAudio.text,audioKey:privateUnitAudio.audioKey,materialId:privateUnitAudio.materialId,segmentId:privateUnitAudio.segmentId,voiceProfileId:privateUnitAudio.voiceProfileId,...(listening50?{contextHash:listening50.body.contextHash,naturalOnly:true}:{})}:{text:q.audioText||q.transcript||q.prompt,materialId:q.groupId||q.id,segmentId:'question'})} sourceLabel={privateUnitAudio?.label||'原创练习'} label={q.part>=3?"听材料":"听本题"} checkpoint={material.audio} onCheckpoint={checkpoint}/>}{listening50?.question&&<SpeechPlayer key={'prompt:'+q.id} {...listening50.question} naturalOnly trackId={'prompt:'+q.id} sourceLabel="本题问题 · 选项请阅读" label="听本题" checkpoint={material.audio} onCheckpoint={checkpoint}/>}</div><div className="practice-response"><h3 className="question-prompt" lang="en">{q.part===2&&!submitted?'Listen to the question and choose the best response.':q.prompt}</h3>
 <RadioGroup value={choice} onValueChange={value=>{if(lookupOpen.current||durable?.busy||(durable&&durable.choice!==null))return;setChoice(value);setSaveError(false);pending.current=null;}} disabled={submitted||lookupActive||!!durable?.busy||(!!durable&&durable.choice!==null)} className="answer-options" aria-label="选择答案">{q.options.map((option,i)=><label htmlFor={'answer-'+i} key={i} className={'answer-option '+(choice===String(i)?'selected ':'')+(submitted?(i===q.correctIndex?'correct':choice===String(i)?'incorrect':''):'')}><RadioGroupItem id={'answer-'+i} value={String(i)}/><span className="option-letter">{'ABCD'[i]}</span><span lang="en">{q.part<=2&&!submitted?'选项 '+ 'ABCD'[i]:option}</span>{submitted&&i===q.correctIndex&&<Check size={18}/>}</label>)}</RadioGroup>
 {saveError&&<div className="workspace-save-error" role="alert"><b>答案未保存 · 待保存 {'ABCD'[Number(choice)]}</b><p>当前选择已保留，重试成功后才显示解析或进入下一题。</p><button className="button secondary" onClick={submit}>重试保存答案</button></div>}
 {advanceError&&<p className="workspace-save-error" role="alert">下一步尚未保存。答案已保留，请重试“下一题”或“完成本组”。</p>}
 {submitted&&<div className="answer-feedback"><div className={'result-line '+(Number(choice)===q.correctIndex?'good':'bad')}>{Number(choice)===q.correctIndex?<CheckCircle2 size={19}/>:<RotateCcw size={19}/>}<b>{Number(choice)===q.correctIndex?'判断正确':'找到了一个值得巩固的地方'}</b><span>答案 {'ABCD'[q.correctIndex]}</span></div><p className="small muted">同材料训练 · {q.groupId?'本组共享材料':'本题材料'} · 听写{material.checkedDraft?'已核对':material.dictationSkipped?'稍后':'未完成'} / 回听{material.listeningStatus==='confirmed'?'已确认':material.listeningStatus==='skipped'?'稍后':'未完成'}</p><Tabs value={confirmedMaterial.step==='answer'?'explain':confirmedMaterial.step} onValueChange={value=>{if(durable?.readError)return;stopLessonAudio();updateMaterial({step:value as TrainingStep},true);}}><TabsList className="lesson-tabs training-steps"><TabsTrigger value="explain">答案解析</TabsTrigger>{transcript&&<>{!listening50&&<TabsTrigger value="dictation">第一句听写</TabsTrigger>}<TabsTrigger value="listen">{listening50?'整段回听':'逐句回听'}</TabsTrigger></>}<TabsTrigger value="vocab">词汇与表达</TabsTrigger></TabsList><TabsContent value="explain" className="tab-reading"><p>{q.explanation}</p><blockquote lang="en">{q.evidence}</blockquote>{q.translation&&<p className="muted">{q.translation}</p>}</TabsContent>{transcript&&<>{!listening50&&<TabsContent value="dictation" className="tab-reading"><div className="dictation"><h4>听写第一句</h4><SpeechPlayer text={sentence} materialId={q.groupId||q.id} segmentId="sentence:0" label="听第一句" trackId="sentence:0" checkpoint={material.audio} onCheckpoint={checkpoint}/><textarea aria-label="听写答案" maxLength={8000} value={dictation} onCompositionStart={()=>training.composition(true)} onCompositionEnd={()=>training.composition(false)} onBlur={()=>{if(!durable?.readError&&training.draft.status==='dirty')void training.flush();}} onChange={e=>updateMaterial({dictationDraft:e.target.value,checkedDraft:null,dictationSkipped:false})} placeholder="Type what you hear…"/><div className="button-row"><button className="button secondary" onClick={()=>{updateMaterial({checkedDraft:dictation,dictationSkipped:false});void training.flush();}} disabled={!dictation.trim()}>核对听写</button><button className="text-button" onClick={()=>{updateMaterial({dictationSkipped:true,checkedDraft:null,step:'listen'});void training.flush();}}>稍后听写，先回听</button></div>{dictationDone&&(training.draft.confirmed.materials.find(item=>item.unitId===material.unitId&&item.materialHash===material.materialHash)?.checkedDraft===dictation?<p className={normalizeText(dictation)===normalizeText(sentence)?'good':'muted'}>{normalizeText(dictation)===normalizeText(sentence)?'听写核对一致。':'对照原句：'+sentence}</p>:<p role="status">核对结果待保存，当前草稿保留。</p>)}</div></TabsContent>}<TabsContent value="listen" className="tab-reading"><p className="section-label">{listening50?'整段回听 · 材料与本题问题':'逐句回听 · 点一句，听一句'}</p><div className="transcript-lines">{listening50?<><SpeechPlayer {...listening50.body} naturalOnly label="听材料" checkpoint={material.audio} onCheckpoint={checkpoint}/>{listening50.question&&<SpeechPlayer {...listening50.question} naturalOnly label="听本题" trackId={'prompt:'+q.id} checkpoint={material.audio} onCheckpoint={checkpoint}/>}<p lang="en">{listening50.body.text}</p>{listening50.question&&<p lang="en">{listening50.question.text}</p>}</>:transcript.split(/(?<=[.!?])\s+/).filter(Boolean).map((line,i)=><SpeechPlayer key={i} text={line} materialId={q.groupId||q.id} segmentId={'sentence:'+i} label={line} trackId={'sentence:'+i} checkpoint={material.audio} onCheckpoint={checkpoint}/>)}</div><div className="button-row"><button className="button secondary" onClick={()=>{stopLessonAudio();updateMaterial({listeningStatus:'confirmed'},true);}}>确认已完成本次回听</button><button className="text-button" onClick={()=>{stopLessonAudio();updateMaterial({listeningStatus:'skipped'},true);}}>稍后回听</button></div></TabsContent></>}<TabsContent value="vocab" className="tab-reading">{q.vocabulary?.length?q.vocabulary.map(v=><div className="vocab-entry" key={v.word}><div><b lang="en">{v.word}</b><span>{v.meaning}</span></div><p lang="en">{renderExample?renderExample(v.example):v.example}</p>{onLookup&&<button type="button" className="text-button" aria-label={'查词 '+v.word} disabled={lookupActive} onClick={()=>{if(submitted&&!lookupOpen.current)onLookup(v.word);}}>查词<BookOpen size={16} aria-hidden="true"/></button>}</div>):<p>本题重点：{q.skill}。复习时先找出答案依据，再读完整句。</p>}</TabsContent></Tabs></div>}</div></div><div className="practice-footer"><button className="button primary" disabled={lookupActive||!!durable?.busy||!!durable?.readError||(!submitted&&choice==='')} onClick={submitted?next:submit}>{submitted?(index<(durable?.cursor??index)?'查看下一题':index===queue.length-1?'完成本组答题':'下一题'):'确认答案'}<ArrowRight size={17}/></button></div></>:<div className="session-complete"><CheckCircle2 size={42}/><h2>{correct}<small> / {queue.length} 题</small></h2><p>本组答题已记录。</p><p className="small muted">听写核对 {training.training.materials.filter(item=>item.checkedDraft!==null).length} / {training.training.materials.length} 段 · 回听确认 {training.training.materials.filter(item=>item.listeningStatus==='confirmed').length} / {training.training.materials.length} 段</p><div className="practice-continuation">{queue.filter((q,i)=>!q.groupId||queue.findIndex(other=>practiceUnitId(other)===practiceUnitId(q))===i).map(q=><button className="button secondary" key={q.id} onClick={()=>void showQuestion(queue.findIndex(other=>other.id===q.id))}>返回材料深练 · {q.title||q.id}</button>)}</div><button className="button primary" disabled={lookupActive||durable?.busy||!!durable?.readError} onClick={()=>{if(!lookupOpen.current){if(!durable){onFinish(Math.max(1,Math.round((Date.now()-start.current)/60000)));return;}void training.flush().then(ok=>{if(ok)onFinish(Math.max(1,Math.round((Date.now()-start.current)/60000)));});}}}>记录时间与收获<ArrowRight size={17}/></button><div className="practice-continuation">{onContinue&&<button className="button primary" disabled={lookupActive||durable?.busy||!!durable?.readError} onClick={()=>continueSaved(onContinue)}>继续一组</button>}{onSpecialty&&<button className="button secondary" disabled={lookupActive||durable?.busy||!!durable?.readError} onClick={()=>continueSaved(onSpecialty)}>换个专项</button>}{onWrong&&<button className="button secondary" disabled={lookupActive||durable?.busy||!!durable?.readError} onClick={()=>continueSaved(onWrong)}>练习错题</button>}{onCustom&&<button className="button secondary" disabled={lookupActive||durable?.busy||!!durable?.readError} onClick={()=>continueSaved(onCustom)}>自选题数</button>}</div><button className="text-button" disabled={lookupActive||durable?.busy||!!durable?.readError} onClick={()=>void closeSaved()}>先休息一下</button></div>}</DialogContent></Dialog><Dialog open={imageOpen} onOpenChange={setImageOpen}><DialogContent className="practice-image-dialog"><DialogHeader><DialogTitle>本题配图</DialogTitle><DialogDescription>图片放大仅辅助阅读，返回后保留当前选择。</DialogDescription></DialogHeader>{q.image&&<img src={q.image} alt="本题配图"/>}<button className="button secondary" onClick={()=>setImageOpen(false)}>返回题目</button></DialogContent></Dialog><Dialog open={exitOpen} onOpenChange={setExitOpen}><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>先结束这组练习？</DialogTitle><DialogDescription>已提交并保存的答案会保留；当前未保存选择不会记为已完成。下次练习仍保留最初的首答。</DialogDescription></DialogHeader><div className="button-row"><button className="button primary" onClick={()=>setExitOpen(false)}>继续练习</button><button className="button secondary" onClick={()=>void closeSaved()}>保存并返回</button></div>{unsavedExit&&<div className="workspace-save-error" role="alert"><p>本页仍有未确认保存的训练进度。已确认内容会保留；未确认操作也可能已经写入，返回后以实际存储读取为准。</p><button className="button secondary" onClick={()=>{training.draft.close();onClose();}}>不保存此次更改并返回</button></div>}</DialogContent></Dialog></>
}
