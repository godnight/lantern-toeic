'use client';

import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {ArrowRight,BookOpen,CalendarDays,Check,CheckCircle2,ChevronLeft,ChevronRight,Download,Plus,RefreshCw,Settings2,Upload} from 'lucide-react';
import type {Theme} from '@/lib/study-model';
import type {Word} from '@/lib/vocabulary-model';
import {getWorkflowBook,getCandidateLearningWord,CANDIDATE_CONTENT_PENDING,type WorkflowBookId} from '@/lib/workflow-catalog';
import type {VocabularyWorkflowController} from '@/lib/use-vocabulary-workflow';
import {vocabularyPlanMembers,type CandidateStatus,type RawVocabularyRating,type VocabularyPlanDraft,type VocabularyProjection,type VocabularyWorkflowResult} from '@/lib/vocabulary-workflow';
import {InteractiveExample,type ExampleLookup} from './interactive-example';
import {SpeechPlayer} from './practice';
import {getWordAudioBindingForSnapshot,isPrivateWordAudioBlocked,PRIVATE_AUDIO_LABEL} from '@/lib/word-audio-bindings-v040';
import {naturalAudioRegistry,subscribeProductLessonAudio,productLessonAudioState} from '@/lib/lesson-audio';
import {ThemeScene} from './ui-theme';
import {getWordCardReference} from './word-card-reference';
import {PLAN_SAVE_WAIT_MS,PlanEditorActions,PlanExitPrompt,usePlanEditorExit,type PlanBackRef} from './plan-editor-state';
import './v041-vocabulary.css';

type Workflow=VocabularyWorkflowController;
const WEEKDAYS=[1,2,3,4,5,6,7];
const DAY_NAMES=['日','一','二','三','四','五','六'];
const RATING_NAMES:Record<RawVocabularyRating,string>={known:'认识',fuzzy:'模糊',forgotten:'忘记'};
const PLAN_CHOICES=[{id:'general-base-1.2',label:'通用基础'},{id:'combined-with-supplement-1.2',label:'托业备考'}] as const;
const planName=(id:WorkflowBookId)=>PLAN_CHOICES.find(book=>book.id===id)?.label||'当前词本';
const newPlanDraft=():VocabularyPlanDraft=>({bookId:'general-base-1.2',goal:getWorkflowBook('general-base-1.2').capacity,dailyNew:15,weekdays:[1,2,3,4,5]});
const successful=(result:VocabularyWorkflowResult)=>result.status==='applied'||result.status==='replayed';

/** Form validation uses the same stable catalog membership as the workflow. */
export function evaluatePlanDraft(draft:VocabularyPlanDraft,projection:VocabularyProjection) {
  const ids=new Set(vocabularyPlanMembers(draft.bookId,projection.candidates).map(word=>word.id));
  const learned=projection.learnedWordIds.filter(id=>ids.has(id)).length;
  const capacity=ids.size;
  const goalValid=Number.isSafeInteger(draft.goal)&&draft.goal>=learned&&draft.goal<=capacity;
  const dailyValid=Number.isSafeInteger(draft.dailyNew)&&draft.dailyNew>=1&&draft.dailyNew<=1000;
  const daysValid=draft.weekdays.length>0;
  const remaining=Math.max(0,draft.goal-learned);
  let title='',detail='',finish:string|null=null;
  if(!goalValid){title='请先修正总覆盖目标';detail=`请输入 ${learned} 至 ${capacity} 之间的整数。`;}
  else if(!dailyValid){title='请先修正每日新词量';detail='每日新词量须为 1 至 1000 之间的整数。';}
  else if(remaining===0){title='总目标已覆盖';detail='已学记录保留；到期复习与主动加练仍可继续。';}
  else if(!daysValid){title='至少选择一个学习日';detail='休息日不安排新词，到期复习仍可进行。';}
  else {
    const date=new Date(projection.daily.window.localDate+'T12:00:00.000Z');
    let left=remaining;
    // A real date window and a bounded catalog make this a finite display estimate.
    for(let offset=0;offset<366000;offset++){
      if(draft.weekdays.includes(date.getUTCDay()||7))left-=Math.max(0,draft.dailyNew-(offset===0?projection.daily.newDone:0));
      if(left<=0){finish=date.toISOString().slice(0,10);break;}
      date.setUTCDate(date.getUTCDate()+1);
    }
    title=finish?`预计 ${finish} 覆盖新词`:'按所选学习日逐步安排';
    detail=`剩余 ${remaining} 个 · 每周 ${draft.dailyNew*draft.weekdays.length} 个新词。到期复习另计，漏学不自动补债。`;
  }
  return {learned,capacity,remaining,valid:goalValid&&dailyValid&&(daysValid||remaining===0),title,detail,finish};
}

/** One presentation editor for every plan entry; the workflow remains authoritative. */
export function VocabularyPlanEditor({workflow,onLeave,onSaved,backRef,onPendingChange,enabled=true}:{workflow:Workflow;onLeave:()=>void;onSaved:()=>void;backRef?:PlanBackRef;onPendingChange?:(pending:boolean)=>void;enabled?:boolean}){
  const projection=workflow.projection;
  const initial=useRef<VocabularyPlanDraft>(projection?.plan?{bookId:projection.plan.bookId,goal:projection.plan.goal,dailyNew:projection.plan.dailyNew,weekdays:[...projection.plan.weekdays]}:newPlanDraft());
  const [draft,setDraft]=useState<VocabularyPlanDraft>(()=>({...initial.current,weekdays:[...initial.current.weekdays]}));
  const revision=useRef(projection?.plan?.revision??null);
  const [phase,setPhase]=useState<'idle'|'waiting'|'review'|'failed'>('idle'),[attempted,setAttempted]=useState(false),[message,setMessage]=useState(''),[readback,setReadback]=useState(false),[resultId,setResultId]=useState('');
  const alive=useRef(true),generation=useRef(0),inFlight=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null),scope=useRef(workflow.scopeKey);
  scope.current=workflow.scopeKey;
  const form=useRef<HTMLFormElement>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;if(timer.current)clearTimeout(timer.current);};},[]);
  useEffect(()=>{onPendingChange?.(phase==='waiting');return()=>onPendingChange?.(false);},[phase,onPendingChange]);
  const ready=enabled&&workflow.ready&&!workflow.error&&!!projection;
  const dirty=JSON.stringify(draft)!==JSON.stringify(initial.current);
  const exit=usePlanEditorExit({dirty,attempted,pending:phase==='waiting',onLeave,backRef});
  const estimate=projection?evaluatePlanDraft(draft,projection):null;
  const begin=()=>{
    const id=++generation.current,key=workflow.scopeKey;
    inFlight.current=true;setPhase('waiting');setReadback(false);
    timer.current=setTimeout(()=>{if(!alive.current||generation.current!==id||scope.current!==key)return;generation.current++;inFlight.current=false;timer.current=null;setPhase('review');setMessage('等待已超过15秒，保存结果尚未确认。请重新读取核对；离开不会撤销已发操作。');},PLAN_SAVE_WAIT_MS);
    return {valid:()=>alive.current&&generation.current===id&&scope.current===key,finish:()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;inFlight.current=false;}};
  };
  const submit=async()=>{
    if(!ready||inFlight.current||phase==='review'||exit.confirm)return;
    if(!estimate?.valid){setMessage(estimate?`${estimate.title}：${estimate.detail}`:'计划暂不可读取。');form.current?.querySelector<HTMLInputElement>('input:invalid')?.focus();return;}
    setAttempted(true);setMessage('');setResultId('');const attempt=begin();
    try{
      const result=await workflow.savePlan({...draft,weekdays:[...draft.weekdays]},revision.current);
      if(!attempt.valid())return;attempt.finish();
      if(successful(result)){setPhase('idle');onSaved();return;}
      setResultId(result.id??'');
      const needsRead=['unknown','pending','conflict'].includes(result.status);
      setPhase(needsRead?'review':'failed');
      setMessage(result.reason||(needsRead?'保存结果需要核对，请先重新读取当前计划。':'计划未获保存确认，填写内容已保留。'));
    }catch(error){if(attempt.valid()){attempt.finish();setPhase('review');setMessage(error instanceof Error?error.message:'保存结果尚未确认，请先重新读取核对。');}}
  };
  const refresh=async()=>{
    if(inFlight.current||!enabled||exit.confirm)return;setMessage('正在重新读取当前计划…');const attempt=begin();
    try{await workflow.refresh();if(!attempt.valid())return;attempt.finish();setPhase('review');setReadback(true);setMessage('请核对当前读回的计划；未能读取时可再次尝试。读回不代表原保存命令已确认。');}
    catch(error){if(attempt.valid()){attempt.finish();setPhase('review');setMessage(error instanceof Error?error.message:'暂时无法读回，草稿仍保留。');}}
  };
  const locked=!ready||phase==='waiting'||phase==='review'||exit.confirm;
  return <section className="lp-editor phase2-plan-editor" aria-label="单词安排编辑器">
    <h2>{projection?.plan?'调整单词安排':'制定单词计划'}</h2>
    {!ready&&<p role="alert">{workflow.error||'正在读取计划，暂不能保存。'}</p>}
    <form ref={form} noValidate aria-busy={phase==='waiting'} onSubmit={event=>{event.preventDefault();void submit();}}>
      <fieldset disabled={locked}>
        <fieldset className="v041-plan-books"><legend>词本</legend><div>{PLAN_CHOICES.map(book=><label key={book.id}><input type="radio" name="v041-plan-book" value={book.id} checked={draft.bookId===book.id} onChange={()=>{if(!projection)return;const next={...draft,bookId:book.id};setDraft({...next,goal:evaluatePlanDraft({...next,goal:0},projection).capacity});}}/><span>{book.label}</span></label>)}</div>{!PLAN_CHOICES.some(book=>book.id===draft.bookId)&&<p role="status">保留当前词本</p>}</fieldset>
        <div className="form-grid"><label className="field">总覆盖目标<input type="number" required min={estimate?.learned??0} max={estimate?.capacity??0} step={1} value={Number.isFinite(draft.goal)?draft.goal:''} onChange={event=>setDraft({...draft,goal:event.target.value===''?NaN:Number(event.target.value)})}/><small>已学 {estimate?.learned??0} · 可学 {estimate?.capacity??0}</small></label><label className="field">每日新词<input type="number" required min={1} max={1000} step={1} value={Number.isFinite(draft.dailyNew)?draft.dailyNew:''} onChange={event=>setDraft({...draft,dailyNew:event.target.value===''?NaN:Number(event.target.value)})}/><small>个新词/学习日，复习另计。</small></label></div>
        <fieldset className="phase2-weekday-field"><legend>每周学习日</legend><div className="phase2-weekday-picker">{WEEKDAYS.map(day=><label key={day}><input type="checkbox" checked={draft.weekdays.includes(day)} onChange={event=>setDraft({...draft,weekdays:event.target.checked?[...draft.weekdays,day]:draft.weekdays.filter(value=>value!==day)})}/><span>周{DAY_NAMES[day%7]}</span></label>)}</div></fieldset>
        {estimate&&<div className="phase2-plan-estimate" role="status"><b>{estimate.title}</b><p>{estimate.detail}</p></div>}
        <p className="phase2-vocab-note">保存后更新计划和预计安排；当前词组和已学记录保留，下一组采用新设置。</p>
      </fieldset>
    {message&&<div className="lp-save-notice" role="status"><p>{message}</p>{resultId&&<small>核对标识：{resultId}</small>}
      {phase==='review'&&<><button type="button" className="button secondary" disabled={!enabled||exit.confirm} onClick={()=>void refresh()}>重新读取核对</button>{readback&&ready&&projection&&<><p>当前读回：{projection.plan?`${planName(projection.plan.bookId)} · 目标 ${projection.plan.goal} · 每日 ${projection.plan.dailyNew} 个新词`:'尚无已保存计划'}</p><button type="button" className="button secondary" disabled={!ready||exit.confirm} onClick={()=>{if(!ready)return;generation.current++;revision.current=workflow.projection?.plan?.revision??null;setPhase('idle');setReadback(false);setMessage('已采用当前版本继续编辑；再次保存将发起一次新的修改。');}}>已核对，继续修改</button></>}</>}
    </div>}
      <PlanEditorActions onBack={exit.request} backDisabled={phase==='waiting'||exit.confirm} saveDisabled={locked||!estimate?.valid} saveLabel={phase==='waiting'?'保存中…':'保存计划'}/>
    </form>
    <PlanExitPrompt exit={exit}/>
  </section>;
}

/** Calendar arithmetic uses the workflow's local date, never the browser's zone. */
export function planCalendarWeek(projection:VocabularyProjection,weekOffset=0){
  const today=projection.daily.window.localDate,anchor=new Date(today+'T12:00:00.000Z');
  const monday=new Date(anchor);monday.setUTCDate(monday.getUTCDate()+1-(monday.getUTCDay()||7)+weekOffset*7);
  const days=Array.from({length:7},(_,index)=>{const date=new Date(monday);date.setUTCDate(date.getUTCDate()+index);const localDate=date.toISOString().slice(0,10),weekday=date.getUTCDay()||7;return {localDate,weekday,isToday:localDate===today,isLearningDay:!!projection.plan?.weekdays.includes(weekday),estimatedNew:localDate<today?null:0 as number|null};});
  if(projection.plan){
    const estimate=evaluatePlanDraft(projection.plan,projection),end=days[6].localDate,date=new Date(anchor);
    let remaining=estimate.remaining;
    for(let offset=0;estimate.valid&&remaining>0&&offset<366000;offset++){
      const localDate=date.toISOString().slice(0,10);if(localDate>end)break;
      const count=projection.plan.weekdays.includes(date.getUTCDay()||7)?Math.min(remaining,Math.max(0,projection.plan.dailyNew-(offset===0?projection.daily.newDone:0))):0;
      const day=days.find(day=>day.localDate===localDate);if(day)day.estimatedNew=count;
      remaining-=count;date.setUTCDate(date.getUTCDate()+1);
    }
  }
  return days;
}

const calendarDate=(value:string)=>`${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日`;

function VocabularyPriorityArt({theme}:{theme?:Theme}){
  return <div className="phase2-vocabulary-priority-art" aria-hidden="true">{theme==='hollow'?<img src="/phase2-theme/knight-icon-256.png" width="180" height="180" alt=""/>:<svg viewBox="0 0 170 200" focusable="false"><ellipse cx="95" cy="179" rx="58" ry="9" fill="#d3ab89" opacity=".3"/><path d="M73 56c-27-38-58-9-30 9 17 10 27 4 30-9" fill="#8a986a"/><path d="M77 64c18-45 48-27 37-6-7 14-25 15-37 6" fill="#c0cb96"/><path d="m79 64 7 58" stroke="#6e7852" strokeWidth="3" fill="none"/><path d="M64 100h40l-6 38H70Z" fill="#d39872"/><rect x="27" y="137" width="103" height="20" rx="5" fill="#788c72"/><rect x="37" y="132" width="88" height="9" rx="4" fill="#f9f3e2"/><rect x="31" y="159" width="112" height="18" rx="4" fill="#efe4cf"/><path d="M46 160v16m84-16v16" stroke="#cbb68e"/><circle cx="130" cy="74" r="27" fill="#edd1a4"/><path d="M118 75h24m-12-12v24" stroke="#c4a77b" strokeWidth="2"/></svg>}</div>;
}

export function candidatePresentation(status:CandidateStatus){
  switch(status){
    case 'available-new':return {label:'加入新学候选',kind:'new' as const,disabled:false};
    case 'available-review':return {label:'加入今日复习',kind:'manual-review' as const,disabled:false};
    case 'already-present':return {label:'已加入新学候选',kind:'new' as const,disabled:true};
    case 'already-review':return {label:'已加入今日复习',kind:'manual-review' as const,disabled:true};
    case 'today-reviewed':return {label:'今日已复习',kind:'manual-review' as const,disabled:true};
  }
}

function resultMessage(result:VocabularyWorkflowResult,success:string){
  if(successful(result))return success;
  if(result.reason)return result.reason;
  switch(result.status){
    case 'already-present':return '此词已在新学候选中，未重复加入。';
    case 'already-review':return '此词已在今日复习中，未重复加入。';
    case 'today-reviewed':return '此词今日已复习，未重复安排。';
    case 'stage-changed':return '此词的学习状态已变化，请按更新后的按钮重新选择。';
    case 'pending':case 'unknown':return '保存结果尚未确认，请保留当前页面后重试原操作。';
    case 'empty':return '目前没有可开始的词组。';
    default:return '操作尚未保存，请重试。';
  }
}

function WorkflowNotice({workflow}:{workflow:Workflow}){
  if(workflow.ready&&!workflow.error)return null;
  return <div className="phase2-vocab-alert" role={workflow.error?'alert':'status'}>
    <b>{workflow.error?'单词计划暂时不可用':'正在读取单词计划与学习记录'}</b>
    <p>{workflow.error||'读取完成后再显示任务与进度。'}</p>
    {workflow.error&&<button type="button" className="text-button" onClick={()=>void workflow.refresh()}><RefreshCw size={15}/>重新读取</button>}
  </div>;
}

export function CandidateAction({workflow,word,disabled=false}:{workflow:Workflow;word:Word;disabled?:boolean}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const pending=useRef(false),scope=useRef(workflow.scopeKey);scope.current=workflow.scopeKey;
  useEffect(()=>{setMessage('');setBusy(false);pending.current=false;},[workflow.scopeKey,word.id]);
  const presentation=candidatePresentation(workflow.candidateStatus(word));
  const contentBlocked=presentation.kind==='new'&&!getCandidateLearningWord(word);
  const blocked=disabled||busy||!workflow.ready||!!workflow.error||!workflow.projection?.plan||presentation.disabled||contentBlocked;
  const add=async()=>{
    if(blocked||pending.current)return;
    const key=workflow.scopeKey;pending.current=true;setBusy(true);setMessage('');
    try{
      const result=await workflow.addCandidate(word,presentation.kind);
      if(scope.current===key)setMessage(resultMessage(result,presentation.kind==='new'?'已加入新学候选；尚未计入已学。':'已加入今日复习；尚未计入已复习。'));
    }catch(error){if(scope.current===key)setMessage(error instanceof Error?error.message:'候选尚未保存，请重试。');}
    finally{if(scope.current===key){pending.current=false;setBusy(false);}}
  };
  return <div className="phase2-candidate-action">
    <button type="button" className="button secondary" disabled={blocked} onClick={()=>void add()} aria-label={`${presentation.label}：${word.word}`}>
      {presentation.disabled?<Check size={16}/>:<Plus size={16}/>} {busy?'正在保存…':presentation.label}
    </button>
    {contentBlocked&&<small>{CANDIDATE_CONTENT_PENDING}</small>}
    {!workflow.projection?.plan&&workflow.ready&&!workflow.error&&<small>先保存一个单词计划，再安排此词。</small>}
    {message&&<p role="status">{message}</p>}
  </div>;
}

export function TodayVocabularyTask({workflow,onOpen,onOpenStudy,onPlanOverview,disabled=false,priority=false,compact=false,theme}:{workflow:Workflow;onOpen:()=>void;onOpenStudy?:()=>void;onPlanOverview?:()=>void;disabled?:boolean;priority?:boolean;compact?:boolean;theme?:Theme}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const pending=useRef(false),scope=useRef(workflow.scopeKey);scope.current=workflow.scopeKey;
  useEffect(()=>{setMessage('');setBusy(false);pending.current=false;},[workflow.scopeKey]);
  const projection=workflow.projection,plan=projection?.plan;
  const active=workflow.activeSession?.status==='active'?workflow.activeSession:null;
  const saved=active?.queue.filter(step=>!!step.receipt).length??0;
  const open=async()=>{
    if(disabled||pending.current||!workflow.ready||workflow.error)return;
    if(!plan){onOpen();return;}
    if(workflow.activeSession?.status==='active'){(onOpenStudy||onOpen)();return;}
    const key=workflow.scopeKey;pending.current=true;setBusy(true);setMessage('');
    try{const result=await workflow.startGroup('auto');if(scope.current!==key)return;if(successful(result))(onOpenStudy||onOpen)();else setMessage(resultMessage(result,''));}
    catch(error){if(scope.current===key)setMessage(error instanceof Error?error.message:'词组尚未准备好，请重试。');}
    finally{if(scope.current===key){pending.current=false;setBusy(false);}}
  };
  return <section className={`phase2-today-vocabulary v041-today-vocabulary panel${priority?' workspace-vocabulary-priority workspace-priority':''}${compact?' v040-word-task':''}`} aria-label="今日单词任务">
    <WorkflowNotice workflow={workflow}/>
    {workflow.ready&&!workflow.error&&projection&&<>
      <div className="phase2-vocab-heading"><h2>{compact?'单词':active?'继续背词':!plan?'制定单词计划':projection.daily.goalCompleted?'今日目标已完成':'今日单词'}</h2>{onPlanOverview?<button type="button" className="text-button lp-plan-entry" disabled={disabled} onClick={onPlanOverview}>学习计划<ChevronRight size={16}/></button>:!compact&&plan&&<button type="button" className="text-button" disabled={disabled} onClick={onOpen}>查看计划<ArrowRight size={16}/></button>}</div>
      {active?<div className="v040-word-task-progress"><p>本组 {active.queue.length} 词 · 已保存 {saved} 词</p><progress aria-label="当前词组已保存词数" value={saved} max={Math.max(1,active.queue.length)}/></div>:plan&&<p className="v041-today-progress">新学 {projection.daily.newDone} / {projection.daily.newDone+projection.daily.newRemaining} · 复习 {projection.daily.reviewDone} / {projection.daily.reviewDone+projection.daily.reviewRemaining}</p>}
      <button type="button" className="button primary" disabled={disabled||busy||!!plan&&!workflow.activeSession&&projection.daily.newRemaining+projection.daily.reviewRemaining===0} onClick={()=>void open()}>
        {busy?'正在准备…':!plan?'制定单词计划':active?'继续背词':'开始背词'}<ArrowRight size={17}/>
      </button>
      {plan&&!projection.daily.isLearningDay&&<p>今日休息，仍可复习或加练。</p>}
      {message&&<p role="status">{message}</p>}
    </>}
  </section>;
}

export function VocabularyStudyCard({workflow,theme,onExampleLookup,overlayBlocked=false,onFinish}:{workflow:Workflow;theme:Theme;onExampleLookup?:ExampleLookup;overlayBlocked?:boolean;onFinish?:()=>void}){
  const session=workflow.activeSession;
  const [previousStep,setPreviousStep]=useState<string|null>(null);
  const viewingPrevious=!!session&&session.status==='active'&&session.cursor>0&&session.queue[session.cursor-1]?.id===previousStep;
  const step=viewingPrevious?session!.queue[session!.cursor-1]:session?.currentStep;
  useEffect(()=>setPreviousStep(null),[workflow.scopeKey,session?.id,session?.cursor]);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[selected,setSelected]=useState<RawVocabularyRating|null>(null);
  const contentRoot=useRef<HTMLDivElement>(null),wordHeading=useRef<HTMLHeadingElement>(null),previousWord=useRef<string|null>(null),focusedReceipt=useRef<string|null>(null);
  const targetKey=JSON.stringify([workflow.scopeKey,session?.id??null,step?.id??null]);
  const currentTarget=useRef(targetKey),attempt=useRef(0);currentTarget.current=targetKey;
  const pending=useRef(false),scope=useRef(workflow.scopeKey);scope.current=workflow.scopeKey;
  useEffect(()=>{++attempt.current;setMessage('');setSelected(null);setBusy(false);pending.current=false;},[targetKey]);
  useEffect(()=>{
    const wordKey=step?JSON.stringify([workflow.scopeKey,step.id]):null;
    if(contentRoot.current)contentRoot.current.scrollTop=0;
    if(previousWord.current&&wordKey&&previousWord.current!==wordKey&&!overlayBlocked){
      contentRoot.current?.closest<HTMLElement>('.phase2-word-card')?.scrollIntoView({block:'start',behavior:'instant'});
      wordHeading.current?.focus({preventScroll:true});
    }
    previousWord.current=wordKey;
    // Reading position changes only when the word/scope changes, not on save,
    // retry, audio status or the reveal of this same word.
  },[workflow.scopeKey,step?.id]);
  useEffect(()=>{
    if(!step?.receipt)return;
    const receiptKey=JSON.stringify([workflow.scopeKey,step.id,step.receipt.commandId]);
    if(focusedReceipt.current===receiptKey)return;
    focusedReceipt.current=receiptKey;
    if(!overlayBlocked)contentRoot.current?.focus({preventScroll:true});
  },[workflow.scopeKey,step?.id,step?.receipt?.commandId]);
  const fixedRating=workflow.pendingRating||selected;
  const blocked=overlayBlocked||!workflow.ready||!!workflow.error||!!session?.blockedReason||busy;
  const run=async(rating?:RawVocabularyRating)=>{
    if(blocked||pending.current||!step)return;
    if(rating&&fixedRating&&fixedRating!==rating)return;
    const key=workflow.scopeKey,request=++attempt.current,target=targetKey;
    const isCurrent=()=>scope.current===key&&currentTarget.current===target&&attempt.current===request;
    pending.current=true;setBusy(true);setMessage('');
    if(rating)setSelected(rating);
    try{
      const result=rating?await workflow.submitRating(rating):await workflow.nextStep();
      if(isCurrent())setMessage(resultMessage(result,''));
    }catch(error){if(isCurrent())setMessage(error instanceof Error?error.message:'反馈尚未保存，请重试原操作。');}
    finally{if(isCurrent()){pending.current=false;setBusy(false);}}
  };
  const correct=async()=>{
    if(blocked||pending.current||!session||!step?.receipt||step.receipt.rawRating!=='known'||step.correctedToForgotten)return;
    const key=workflow.scopeKey,request=++attempt.current,target=targetKey;
    const isCurrent=()=>scope.current===key&&currentTarget.current===target&&attempt.current===request;
    const fixed={sessionId:session.id,stepId:step.id,commandId:step.receipt.commandId,reviewId:step.receipt.legacyEventId};
    pending.current=true;setBusy(true);setMessage('');
    try{const result=await workflow.correctRating(fixed);if(isCurrent())setMessage(resultMessage(result,''));}
    catch(error){if(isCurrent())setMessage(error instanceof Error?error.message:'改判尚未确认，请重试。');}
    finally{if(isCurrent()){pending.current=false;setBusy(false);}}
  };
  if(!session)return null;
  if(session.status==='completed')return <section className="phase2-word-finished panel" aria-label="词组完成">
    <CheckCircle2 size={34}/><h2>本组完成</h2><p>已记录 {session.queue.length} 个词的反馈。</p>
    <button type="button" className="button primary" disabled={overlayBlocked} onClick={onFinish}>回到单词计划<ArrowRight size={16}/></button>
    <ThemeScene theme={theme} scene="dirtmouth"/>
  </section>;
  if(!step)return <WorkflowNotice workflow={workflow}/>;
  const revealed=!!step.receipt;
  const reference=getWordCardReference(step.word);
  const headwordAudio=getWordAudioBindingForSnapshot(step.word,'headword'),exampleAudio=getWordAudioBindingForSnapshot(step.word,'example'),audioHeld=isPrivateWordAudioBlocked(step.word);
  const intent=step.intent==='new'?'新词':step.intent==='reinforcement'?'巩固':step.intent==='manual-review'?'主动复习':'到期复习';
  return <section className="phase2-vocabulary-session" aria-label="单词学习">
    <div className="phase2-word-session-heading"><span>{viewingPrevious?'上一词 · ':''}{intent} · {viewingPrevious?session.cursor:session.cursor+1} / {session.queue.length}</span><span title={session.dayWindow.timezone}>{session.dayWindow.localDate}</span>{session.cursor>0&&<button type="button" className="text-button phase2-previous-word" disabled={blocked||viewingPrevious} onClick={()=>setPreviousStep(session.queue[session.cursor-1].id)}>上一词</button>}</div>
    {session.blockedReason&&<div className="phase2-vocab-alert" role="alert"><b>原词卡记录尚未确认</b><p>{session.blockedReason}</p><p>请先恢复独立的词库记录备份，再重新读取计划。此状态不计为整组完成，也不会补写学习事件。</p><button type="button" className="text-button" disabled={overlayBlocked||busy} onClick={()=>void workflow.refresh()}><RefreshCw size={15}/>重新核对词卡记录</button></div>}
    <article className="phase2-word-card panel v045-stable-word-card" tabIndex={-1}>
      <fieldset disabled={blocked} className="phase2-word-fieldset">
        <legend className="sr-only">先回想，再反馈</legend>
        <div className="phase2-word-layout">
          <div ref={contentRoot} className="phase2-word-content" role="region" aria-label="单词内容" tabIndex={0}>
          <header className="phase2-word-header">
            <div className="v041-word-heading"><h2 ref={wordHeading} tabIndex={-1} className="phase2-current-word" lang="en">{step.word.word}</h2>
            {audioHeld?<p className="word-footnote">此词发音待核对，原学习记录保留。</p>:<SpeechPlayer mode="word" key={step.id} text={step.word.word} {...(headwordAudio||{materialId:step.word.id,segmentId:'headword'})} label="听单词发音" sourceLabel={headwordAudio?PRIVATE_AUDIO_LABEL:'单词学习'}/>}</div>
            <p className="word-phonetic" lang={reference.phonetics.length?'en':undefined} aria-label="音标">{reference.phonetics.length?reference.phonetics.join(' · '):'暂无音标'}</p>
          </header>
          <div className="phase2-word-body">
            <WorkflowNotice workflow={workflow}/>
            {revealed?<div className="phase2-word-meaning"><p><span className="word-pos">{step.word.pos}</span>{step.word.meaning}</p>
              {step.word.collocation&&<p lang="en">{step.word.collocation}</p>}
              {step.word.example&&<div className={`phase2-word-example${audioHeld?' phase2-word-example--silent':''}`}><blockquote><InteractiveExample text={step.word.example} onLookup={onExampleLookup} disabled={overlayBlocked}/></blockquote>{!audioHeld&&<SpeechPlayer mode="example" key={step.id+'-example'} text={step.word.example} {...(exampleAudio||{materialId:step.word.id,segmentId:'example'})} label="听例句发音" sourceLabel={exampleAudio?PRIVATE_AUDIO_LABEL:'单词学习'}/>}</div>}
              {step.word.translation&&<p className="muted">{step.word.translation}</p>}
              {reference.etymology&&<section className="phase2-word-etymology" aria-label="词源与构词参考"><h3>词源与构词参考</h3><p>{reference.etymology}</p></section>}
            </div>:null}
            {message&&<p className="phase2-vocab-message" role="alert">{message}</p>}
          </div>
          </div>
          <footer className="phase2-word-controls">
            <div className="phase2-word-status" role="status" aria-live="polite" aria-atomic="true">
              {busy?<span>正在保存反馈…</span>:step.correctionPending?<span>改判待确认，请重试。</span>:revealed?<span className="phase2-feedback-saved"><CheckCircle2 size={17}/>{step.correctedToForgotten?'已改为：忘记':'已保存：'+RATING_NAMES[step.receipt!.rawRating]}</span>:fixedRating?<span className="phase2-fixed-feedback">待确认：{RATING_NAMES[fixedRating]}，请重试。</span>:null}
            </div>
            {!revealed?<div className="phase2-rating-actions" role="group" aria-label="回想反馈">
              {(['known','fuzzy','forgotten'] as const).map(rating=><button key={rating} type="button" className={`button ${rating==='known'?'primary':'secondary'}`} disabled={blocked||!!fixedRating&&fixedRating!==rating} aria-pressed={fixedRating===rating} aria-busy={busy&&fixedRating===rating} onClick={()=>void run(rating)}><span>{RATING_NAMES[rating]}</span></button>)}
            </div>:<div className="phase2-revealed-actions">{step.receipt!.rawRating==='known'&&!step.correctedToForgotten&&<button type="button" className="button secondary phase2-correct-rating" disabled={blocked} aria-busy={busy} onClick={()=>void correct()}>{step.correctionPending?'重试改判':'改为忘记'}</button>}{viewingPrevious?<button type="button" className="button primary phase2-next-word" disabled={blocked} onClick={()=>setPreviousStep(null)}>返回当前词<ArrowRight size={17}/></button>:<button type="button" className="button primary phase2-next-word" disabled={blocked||session.queue.some(row=>row.correctionPending)} aria-busy={busy} onClick={()=>void run()}>{session.cursor===session.queue.length-1?'完成这一组':'下一词'}<ArrowRight size={17}/></button>}</div>}
          </footer>
        </div>
      </fieldset>
    </article>
  </section>;
}

export function VocabularyPlan({workflow,theme,onExampleLookup,overlayBlocked=false,onOpenSearch,onCancel,onEditPlan,entryView='study'}:{workflow:Workflow;theme:Theme;onExampleLookup?:ExampleLookup;overlayBlocked?:boolean;onOpenSearch?:()=>void;onCancel?:()=>void;onEditPlan?:()=>void;entryView?:'plan'|'study'}){
  const projection=workflow.projection,plan=projection?.plan;
  const [editing,setEditing]=useState(false);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[completedHidden,setCompletedHidden]=useState('');
  const [studyOpenRequest,setStudyOpenRequest]=useState(0);
  const [planView,setPlanView]=useState<'week'|'day'>('week'),[weekOffset,setWeekOffset]=useState(0),[selectedDate,setSelectedDate]=useState<string|null>(null);
  const planRoot=useRef<HTMLDivElement>(null),lastStudyOpen=useRef('');
  const pending=useRef(false),scope=useRef(workflow.scopeKey);scope.current=workflow.scopeKey;
  useEffect(()=>{setEditing(false);setMessage('');setBusy(false);pending.current=false;setCompletedHidden('');},[workflow.scopeKey]);
  useEffect(()=>{setWeekOffset(0);setSelectedDate(null);},[workflow.scopeKey,projection?.daily.window.localDate]);
  const blocked=overlayBlocked||!workflow.ready||!!workflow.error||busy;
  const activeSessionId=workflow.activeSession?.status==='active'?workflow.activeSession.id:null;
  const lessonAudioPhase=useSyncExternalStore(subscribeProductLessonAudio,productLessonAudioState,productLessonAudioState).phase;
  useEffect(()=>{
    const session=workflow.activeSession;
    if(session?.status!=='active')return;
    const abort=new AbortController();
    let lease:Awaited<ReturnType<typeof naturalAudioRegistry.pinSelectors>>|null=null;
    // A fixed group has at most 20 words. Protect its existing cached slots
    // without fetching audio, rewriting its snapshots, or reserving a whole book.
    const items=session.queue.flatMap(step=>(['headword','example'] as const).flatMap(slot=>{
      const audio=getWordAudioBindingForSnapshot(step.word,slot);
      return audio?[{text:slot==='headword'?step.word.word:step.word.example,selector:{assetKey:audio.audioKey,materialId:audio.materialId,segmentId:audio.segmentId,voiceProfileId:audio.voiceProfileId,contextHash:audio.contextHash}}]:[];
    }));
    void naturalAudioRegistry.pinSelectors(items,{kind:'lesson',signal:abort.signal}).then(value=>{
      if(abort.signal.aborted)value.release();else lease=value;
    }).catch(()=>{/* Unavailable safe persistence remains explicit on playback. */});
    return()=>{abort.abort();lease?.release();};
  },[workflow.scopeKey,activeSessionId,lessonAudioPhase]);
  const openPlan=()=>{planRoot.current?.focus({preventScroll:true});planRoot.current?.scrollIntoView({block:'start',behavior:'instant'});};
  const openStudy=()=>{setCompletedHidden('');setMessage('');setStudyOpenRequest(value=>value+1);};
  useEffect(()=>{if(entryView==='plan'&&studyOpenRequest===0&&!overlayBlocked&&!busy)openPlan();},[entryView,studyOpenRequest,overlayBlocked,busy]);
  useLayoutEffect(()=>{
    if(entryView==='plan'&&studyOpenRequest===0)return;
    if(!activeSessionId||overlayBlocked||busy)return;
    const token=JSON.stringify([workflow.scopeKey,activeSessionId,studyOpenRequest]);
    if(lastStudyOpen.current===token)return;
    const card=planRoot.current?.querySelector<HTMLElement>('.phase2-word-card');
    if(!card)return;
    lastStudyOpen.current=token;
    card.focus({preventScroll:true});
    card.scrollIntoView({block:'start',behavior:'instant'});
    // Position a newly committed group before its first paint. This one resume
    // positioning pass respects the actual fixed navigation,
    // including its safe-area padding. Long answers keep natural reading scroll.
    const controls=card.querySelector<HTMLElement>('.phase2-next-word,.phase2-rating-actions');
    if(controls){
      const viewport=window.visualViewport,viewportTop=viewport?.offsetTop??0;
      const viewportBottom=viewportTop+(viewport?.height??window.innerHeight);
      const navTop=[...document.querySelectorAll<HTMLElement>('.workspace-mobile-nav')]
        .filter(nav=>nav.getClientRects().length>0&&getComputedStyle(nav).position==='fixed')
        .map(nav=>nav.getBoundingClientRect()).filter(rect=>rect.bottom>viewportTop&&rect.top<viewportBottom)
        .reduce((bottom,rect)=>Math.min(bottom,rect.top),viewportBottom);
      const action=controls.getBoundingClientRect(),usableBottom=Math.min(viewportBottom,navTop)-8;
      // Correct a control already entering the viewport, not an unseen action
      // below a long answer. No ongoing listener can fight user scrolling.
      if(action.top<viewportBottom&&action.bottom>usableBottom)
        window.scrollBy({top:action.bottom-usableBottom,behavior:'instant'});
    }
  },[workflow.scopeKey,activeSessionId,studyOpenRequest,overlayBlocked,busy,entryView]);
  const savedEstimate=projection&&plan?evaluatePlanDraft(plan,projection):null;
  const calendar=projection&&plan?planCalendarWeek(projection,weekOffset):[];
  const selected=calendar.find(day=>day.localDate===(selectedDate||projection?.daily.window.localDate))||calendar[0];
  const changeWeek=(offset:number)=>{const next=weekOffset+offset;setWeekOffset(next);if(projection)setSelectedDate(planCalendarWeek(projection,next)[0].localDate);};
  const edit=()=>{if(blocked)return;if(onEditPlan){onEditPlan();return;}setMessage('');setEditing(true);};
  const run=async(action:()=>Promise<VocabularyWorkflowResult>,success:string,after?:()=>void)=>{
    if(blocked||pending.current)return;const key=workflow.scopeKey;pending.current=true;setBusy(true);setMessage('');
    try{const result=await action();if(scope.current!==key)return;setMessage(resultMessage(result,success));if(successful(result))after?.();}
    catch(error){if(scope.current===key)setMessage(error instanceof Error?error.message:'操作未保存，请重试。');}
    finally{if(scope.current===key){pending.current=false;setBusy(false);}}
  };
  const showSession=workflow.activeSession&&(workflow.activeSession.status==='active'||completedHidden!==workflow.activeSession.id);
  return <div ref={planRoot} tabIndex={-1} className="phase2-vocabulary-plan v041-vocabulary">
    <WorkflowNotice workflow={workflow}/>
    {workflow.ready&&!workflow.error&&projection&&<>
      {(editing||!plan)&&(onEditPlan?<section className="panel v041-vocabulary-setup"><h2>尚未设置单词安排</h2><button type="button" className="button primary" disabled={blocked} onClick={edit}>制定单词计划</button></section>:<VocabularyPlanEditor workflow={workflow} onLeave={()=>{if(plan)setEditing(false);else onCancel?.();}} onSaved={()=>setEditing(false)}/>)}
      {!editing&&plan&&<>
        {showSession?<VocabularyStudyCard workflow={workflow} theme={theme} onExampleLookup={onExampleLookup} overlayBlocked={overlayBlocked||busy} onFinish={()=>setCompletedHidden(workflow.activeSession?.id||'')}/>:<TodayVocabularyTask workflow={workflow} disabled={blocked} onOpen={openPlan} onOpenStudy={openStudy} compact/>}
        <section className="v041-current-plan panel" aria-label="当前单词计划"><div className="phase2-vocab-heading"><h2>{planName(plan.bookId)}</h2><button type="button" className="text-button" disabled={blocked} onClick={edit}><Settings2 size={16}/>调整</button></div><p>每天 {plan.dailyNew} 个新词 · 每周 {plan.weekdays.length} 天</p><progress aria-label="总目标覆盖进度" value={Math.min(projection.counts.learned,plan.goal)} max={Math.max(1,plan.goal)}/><p>已学 {projection.counts.learned} / {plan.goal}</p>{savedEstimate&&<small>{savedEstimate.title}</small>}
          <details className="v041-plan-details"><summary>查看安排</summary>
        {selected&&<section className="phase2-plan-calendar panel" aria-label="单词计划日历">
          <div className="phase2-vocab-heading"><h2>学习安排</h2><div className="phase2-plan-view" role="group" aria-label="计划视图">{(['week','day'] as const).map(view=><button key={view} type="button" aria-pressed={planView===view} disabled={overlayBlocked} onClick={()=>setPlanView(view)}>{view==='week'?'周':'日'}</button>)}</div></div>
          <div className="phase2-calendar-range"><button type="button" className="text-button" aria-label="上一周" disabled={overlayBlocked} onClick={()=>changeWeek(-1)}><ChevronLeft size={18}/></button><b>{calendarDate(calendar[0].localDate)} — {calendarDate(calendar[6].localDate)}</b><button type="button" className="text-button" aria-label="下一周" disabled={overlayBlocked} onClick={()=>changeWeek(1)}><ChevronRight size={18}/></button></div>
          <div className="phase2-calendar-days">{calendar.map(day=><button key={day.localDate} type="button" className={day.isLearningDay?'':'is-rest'} disabled={overlayBlocked} aria-pressed={selected.localDate===day.localDate} aria-current={day.isToday?'date':undefined} aria-label={`${day.localDate}，周${DAY_NAMES[day.weekday%7]}，${day.isLearningDay?'学习日':'休息日'}${day.isToday?'，今天':''}`} onClick={()=>setSelectedDate(day.localDate)}><span>周{DAY_NAMES[day.weekday%7]}</span><b>{Number(day.localDate.slice(8,10))}</b><small>{day.isToday?'今日':day.isLearningDay?'·':'休'}</small></button>)}</div>
          <p className="phase2-calendar-zone">{projection.daily.window.timezone} · {calendar[0].localDate} 至 {calendar[6].localDate}</p>
          {planView==='week'&&<p className="phase2-calendar-summary">本周预计待新学 <b>{calendar.reduce((sum,day)=>sum+(day.estimatedNew??0),0)}</b> 个 · 复习另计</p>}
          <div className="phase2-calendar-detail" aria-live="polite"><h3>{selected.isToday?'今天':calendarDate(selected.localDate)}的安排</h3>{selected.isToday?<><div className="phase2-calendar-counts"><span><b>{projection.daily.newDone}</b>已新学</span><span><b>{projection.daily.reviewDone}</b>已复习</span><span><b>{projection.daily.newRemaining}</b>待新学</span></div><p>到期／主动复习另有 {projection.daily.reviewRemaining} 词待练，已复习不计入新词覆盖。</p></>:selected.localDate<projection.daily.window.localDate?<p>此视图未读取该日历史记录；已新学、已复习均未记录，不从当前计划反推。</p>:<><div className="phase2-calendar-counts"><span><b>{selected.estimatedNew}</b>预计新词</span><span><b>待排</b>到期复习</span><span><b>—</b>完成未发生</span></div><p>{selected.isLearningDay?'按保存计划估计新词配额；实际任务在当天安排。':'这是休息日，不安排新词；当天到期复习仍可进行。'}</p></>}</div>
          {(weekOffset!==0||!selected.isToday)&&<button type="button" className="text-button" disabled={overlayBlocked} onClick={()=>{setWeekOffset(0);setSelectedDate(null);}}>回到今天<CalendarDays size={15}/></button>}
        </section>}
          </details>
        </section>
        <div className="phase2-vocab-secondary-actions"><button type="button" className="text-button" disabled={blocked||projection.daily.reviewRemaining===0} onClick={()=>void run(()=>workflow.startGroup('review'),'复习词组已准备好。',openStudy)}>复习 · {projection.daily.reviewRemaining}</button><button type="button" className="text-button" disabled={blocked} onClick={()=>void run(()=>workflow.startGroup('extra'),'加练词组已准备好。',openStudy)}>加练<Plus size={16}/></button>{onOpenSearch&&<button type="button" className="text-button" disabled={blocked} onClick={onOpenSearch}>全部词条<ArrowRight size={16}/></button>}</div>
      </>}
    </>}
    {message&&<p className="phase2-vocab-message" role="status">{message}</p>}
  </div>;
}

/** Management-only reuse of the original scope-checked workflow backup handlers. */
export function VocabularyWorkflowData({workflow}:{workflow:VocabularyWorkflowController}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const importInput=useRef<HTMLInputElement>(null),pending=useRef(false),scope=useRef(workflow.scopeKey),latest=useRef(workflow),mounted=useRef(true),generation=useRef(0);
  scope.current=workflow.scopeKey;latest.current=workflow;
  useEffect(()=>{generation.current++;setMessage('');setBusy(false);pending.current=false;},[workflow.scopeKey]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  const blocked=busy||!workflow.ready||!!workflow.error;
  const download=async()=>{
    if(blocked||pending.current)return;const key=workflow.scopeKey,token=generation.current;pending.current=true;setBusy(true);setMessage('');
    const current=()=>mounted.current&&scope.current===key&&generation.current===token;
    try{const backup=await workflow.exportWorkflow();if(!current())return;const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='lantern-workflow-backup.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('学习进度备份已生成，请确认文件已保存。');}
    catch(error){if(current())setMessage(error instanceof Error?error.message:'备份未生成。');}
    finally{if(current()){pending.current=false;setBusy(false);}}
  };
  const restore=async(file:File|undefined)=>{
    if(!file||blocked||pending.current)return;
    const key=workflow.scopeKey,token=generation.current;pending.current=true;setBusy(true);setMessage('');
    const current=()=>mounted.current&&scope.current===key&&generation.current===token;
    try{
      if(file.size>50*1024*1024)throw Error('工作流备份超过 50 MiB，请核对文件。');
      const input=JSON.parse(await file.text());
      if(!current())return;
      if(!latest.current.ready||latest.current.error)throw Error(latest.current.error||'工作流读取状态已变化，请重新读取后恢复。');
      const result=await latest.current.restoreWorkflow(input);
      if(current())setMessage(resultMessage(result,'当前空间的单词与普通练习工作流备份已合并。缺失原学习记录的引用不会计入完成；待确认操作不会自动执行。'));
    }catch(error){if(current())setMessage(error instanceof Error?error.message:'备份恢复失败，原记录保留。');}
    finally{if(current()){pending.current=false;setBusy(false);}}
  };
  return <section className="v041-vocabulary-data" aria-label="学习进度备份与恢复"><h2>学习进度</h2><p>单词计划、候选、词组与普通练习流程。恢复按当前分区校验并合并。</p><WorkflowNotice workflow={workflow}/><div className="button-row"><button type="button" className="button secondary" disabled={blocked} onClick={()=>void download()}><Download size={16}/>备份学习进度</button><button type="button" className="button secondary" disabled={blocked} onClick={()=>importInput.current?.click()}><Upload size={16}/>恢复学习进度</button></div><input ref={importInput} type="file" accept="application/json,.json" hidden disabled={blocked} aria-label="选择工作流备份" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';void restore(file);}}/><details><summary>备份范围</summary><p>各类资料需分别备份，单个文件不包含全部资料。</p><p>不包含完整词库学习事件、普通练习成绩／时长记录或私人题包。缺失旧学习记录的引用不计完成，待确认命令不会自动执行。</p></details>{message&&<p role="status">{message}</p>}</section>;
}
