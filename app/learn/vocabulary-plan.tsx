'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowRight,BookOpen,CalendarDays,Check,CheckCircle2,ChevronLeft,ChevronRight,Download,Plus,RefreshCw,Settings2,Upload} from 'lucide-react';
import type {Theme} from '@/lib/study-model';
import type {Word} from '@/lib/vocabulary-model';
import {CATEGORIES} from '@/lib/vocabulary-model';
import {getWorkflowCatalog,WORKFLOW_BOOKS,type WorkflowBookId} from '@/lib/workflow-catalog';
import type {VocabularyWorkflowController} from '@/lib/use-vocabulary-workflow';
import type {CandidateStatus,RawVocabularyRating,VocabularyPlanDraft,VocabularyProjection,VocabularyWorkflowResult} from '@/lib/vocabulary-workflow';
import {InteractiveExample,type ExampleLookup} from './interactive-example';
import {SpeechPlayer} from './practice';
import {ThemeScene} from './ui-theme';

type Workflow=VocabularyWorkflowController;
const WEEKDAYS=[1,2,3,4,5,6,7];
const DAY_NAMES=['日','一','二','三','四','五','六'];
const RATING_NAMES:Record<RawVocabularyRating,string>={known:'认识',fuzzy:'模糊',forgotten:'忘记'};
const successful=(result:VocabularyWorkflowResult)=>result.status==='applied'||result.status==='replayed';

/** Form validation uses the same stable catalog membership as the workflow. */
export function evaluatePlanDraft(draft:VocabularyPlanDraft,projection:VocabularyProjection) {
  const ids=new Set(getWorkflowCatalog(draft.bookId).map(word=>word.id));
  for(const candidate of projection.candidates)if(candidate.kind==='new')ids.add(candidate.word.id);
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
  const blocked=disabled||busy||!workflow.ready||!!workflow.error||!workflow.projection?.plan||presentation.disabled;
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
    {!workflow.projection?.plan&&workflow.ready&&!workflow.error&&<small>先保存一个单词计划，再安排此词。</small>}
    {message&&<p role="status">{message}</p>}
  </div>;
}

export function TodayVocabularyTask({workflow,onOpen,disabled=false,priority=false,theme}:{workflow:Workflow;onOpen:()=>void;disabled?:boolean;priority?:boolean;theme?:Theme}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const pending=useRef(false),scope=useRef(workflow.scopeKey);scope.current=workflow.scopeKey;
  useEffect(()=>{setMessage('');setBusy(false);pending.current=false;},[workflow.scopeKey]);
  const projection=workflow.projection,plan=projection?.plan;
  const open=async()=>{
    if(disabled||pending.current||!workflow.ready||workflow.error)return;
    if(!plan||workflow.activeSession?.status==='active'){onOpen();return;}
    const key=workflow.scopeKey;pending.current=true;setBusy(true);setMessage('');
    try{const result=await workflow.startGroup('auto');if(scope.current!==key)return;if(successful(result))onOpen();else setMessage(resultMessage(result,''));}
    catch(error){if(scope.current===key)setMessage(error instanceof Error?error.message:'词组尚未准备好，请重试。');}
    finally{if(scope.current===key){pending.current=false;setBusy(false);}}
  };
  return <section className={`phase2-today-vocabulary panel${priority?' workspace-vocabulary-priority workspace-priority':''}`} aria-label="今日单词任务">
    {priority&&<VocabularyPriorityArt theme={theme}/>}
    <div className="phase2-vocab-heading"><span className="phase2-vocab-eyebrow"><BookOpen size={16}/>单词计划</span><button type="button" className="text-button" disabled={disabled} onClick={onOpen}>查看计划<ArrowRight size={16}/></button></div>
    <WorkflowNotice workflow={workflow}/>
    {workflow.ready&&!workflow.error&&projection&&<>
      <h2>{!plan?'给新词留一点时间':!projection.daily.isLearningDay?'今天是单词休息日':projection.daily.goalCompleted?'今日目标已完成':'先温习，再认识新词'}</h2>
      {!plan?<p>按自己的节奏设置词书、总目标与每周学习日。</p>:<>
        <div className="phase2-today-counts"><span><b>{projection.daily.newRemaining}</b>待学新词</span><span><b>{projection.daily.reviewRemaining}</b>待复习</span><span><b>{projection.daily.newDone+projection.daily.reviewDone}</b>今日已完成</span></div>
        <p>{projection.daily.isLearningDay?'到期复习优先，每组最多 20 词。':'休息日不安排新词，到期复习和主动加练仍可进行。'}</p>
      </>}
      <button type="button" className="button primary" disabled={disabled||busy||!!plan&&!workflow.activeSession&&projection.daily.newRemaining+projection.daily.reviewRemaining===0} onClick={()=>void open()}>
        {busy?'正在准备词组…':!plan?'制定单词计划':workflow.activeSession?.status==='active'?'继续当前词组':'开始今日词组'}<ArrowRight size={17}/>
      </button>
      {message&&<p role="status">{message}</p>}
    </>}
  </section>;
}

export function VocabularyStudyCard({workflow,theme,onExampleLookup,overlayBlocked=false,onFinish}:{workflow:Workflow;theme:Theme;onExampleLookup?:ExampleLookup;overlayBlocked?:boolean;onFinish?:()=>void}){
  const session=workflow.activeSession,step=session?.currentStep;
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[selected,setSelected]=useState<RawVocabularyRating|null>(null);
  const pending=useRef(false),scope=useRef(workflow.scopeKey);scope.current=workflow.scopeKey;
  useEffect(()=>{setMessage('');setSelected(null);setBusy(false);pending.current=false;},[workflow.scopeKey,step?.id]);
  const fixedRating=workflow.pendingRating||selected;
  const blocked=overlayBlocked||!workflow.ready||!!workflow.error||!!session?.blockedReason||busy;
  const run=async(rating?:RawVocabularyRating)=>{
    if(blocked||pending.current||!step)return;
    if(rating&&fixedRating&&fixedRating!==rating)return;
    const key=workflow.scopeKey;pending.current=true;setBusy(true);setMessage('');
    if(rating)setSelected(rating);
    try{
      const result=rating?await workflow.submitRating(rating):await workflow.nextStep();
      if(scope.current===key)setMessage(resultMessage(result,rating?'反馈已保存。':''));
    }catch(error){if(scope.current===key)setMessage(error instanceof Error?error.message:'反馈尚未保存，请重试原操作。');}
    finally{if(scope.current===key){pending.current=false;setBusy(false);}}
  };
  if(!session)return null;
  if(session.status==='completed')return <section className="phase2-word-finished panel" aria-label="词组完成">
    <CheckCircle2 size={34}/><h2>这一组，稳稳地完成了</h2><p>本组 {session.queue.length} 词的反馈已保存；新学和复习分别记入对应日期。</p>
    <button type="button" className="button primary" disabled={overlayBlocked} onClick={onFinish}>回到单词计划<ArrowRight size={16}/></button>
    <ThemeScene theme={theme} scene="dirtmouth"/>
  </section>;
  if(!step)return <WorkflowNotice workflow={workflow}/>;
  const revealed=!!step.receipt;
  const intent=step.intent==='new'?'新词':step.intent==='reinforcement'?'巩固':step.intent==='manual-review'?'主动复习':'到期复习';
  return <section className="phase2-vocabulary-session" aria-label="单词学习">
    <div className="phase2-word-session-heading"><span>{intent} · {session.cursor+1} / {session.queue.length}</span><span>计入 {session.dayWindow.localDate} · {session.dayWindow.timezone}</span></div>
    {session.blockedReason&&<div className="phase2-vocab-alert" role="alert"><b>原词卡记录尚未确认</b><p>{session.blockedReason}</p><p>请先恢复独立的词库记录备份，再重新读取计划。此状态不计为整组完成，也不会补写学习事件。</p><button type="button" className="text-button" disabled={overlayBlocked||busy} onClick={()=>void workflow.refresh()}><RefreshCw size={15}/>重新核对词卡记录</button></div>}
    <article className="phase2-word-card panel" tabIndex={-1}>
      <fieldset disabled={blocked} className="phase2-word-fieldset">
        <legend className="sr-only">先回想，再反馈</legend>
        <p className="phase2-vocab-eyebrow">{CATEGORIES[step.word.category]||'补充词条'} · {intent}</p>
        <h2 className="phase2-current-word" lang="en">{step.word.word}</h2>
        {!!step.word.phonetics?.length&&<p className="word-phonetic" lang="en">{step.word.phonetics.join(' · ')}</p>}
        <SpeechPlayer key={step.id} text={step.word.word} label="听单词发音" sourceLabel="单词学习"/>
        <WorkflowNotice workflow={workflow}/>
        {!revealed?<>
          <p className="phase2-word-prompt">先在心里回想词义，再选择现在的熟悉程度。</p>
          <div className="phase2-rating-actions" role="group" aria-label="回想反馈">
            {(['known','fuzzy','forgotten'] as const).map(rating=><button key={rating} type="button" className={`button ${rating==='known'?'primary':'secondary'}`} disabled={blocked||!!fixedRating&&fixedRating!==rating} aria-pressed={fixedRating===rating} onClick={()=>void run(rating)}>{busy&&fixedRating===rating?'正在保存…':RATING_NAMES[rating]}</button>)}
          </div>
          {fixedRating&&<p className="phase2-fixed-feedback">待确认反馈：{RATING_NAMES[fixedRating]}。重试会沿用原反馈与记录标识。</p>}
        </>:<>
          <div className="phase2-feedback-saved" role="status"><CheckCircle2 size={17}/>已保存：{RATING_NAMES[step.receipt!.rawRating]}</div>
          <div className="phase2-word-meaning"><p><span className="word-pos">{step.word.pos}</span>{step.word.meaning}</p>
            {step.word.collocation&&<p lang="en">{step.word.collocation}</p>}
            {step.word.example&&<blockquote><InteractiveExample text={step.word.example} onLookup={onExampleLookup} disabled={overlayBlocked}/></blockquote>}
            {step.word.translation&&<p className="muted">{step.word.translation}</p>}
          </div>
          {step.word.example&&onExampleLookup&&<p className="example-lookup-hint">点例句中的英文词查词，关闭后继续当前词卡。</p>}
          <button type="button" className="button primary phase2-next-word" disabled={blocked} onClick={()=>void run()}>{session.cursor===session.queue.length-1?'完成这一组':'下一词'}<ArrowRight size={17}/></button>
        </>}
      </fieldset>
      {message&&<p className="phase2-vocab-message" role="status">{message}</p>}
      <p className="phase2-rating-policy">认识按“记住了”安排；模糊和忘记都按“还没记住”尽早再见，原始反馈分别保留。提前复习不会增加间隔。</p>
    </article>
  </section>;
}

export function VocabularyPlan({workflow,theme,onExampleLookup,overlayBlocked=false,onOpenSearch}:{workflow:Workflow;theme:Theme;onExampleLookup?:ExampleLookup;overlayBlocked?:boolean;onOpenSearch?:()=>void}){
  const projection=workflow.projection,plan=projection?.plan;
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState<VocabularyPlanDraft>({bookId:'scene',goal:WORKFLOW_BOOKS[0].capacity,dailyNew:15,weekdays:[1,2,3,4,5]});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[completedHidden,setCompletedHidden]=useState('');
  const [planView,setPlanView]=useState<'week'|'day'>('week'),[weekOffset,setWeekOffset]=useState(0),[selectedDate,setSelectedDate]=useState<string|null>(null);
  const importInput=useRef<HTMLInputElement>(null),pending=useRef(false),scope=useRef(workflow.scopeKey),latest=useRef(workflow);scope.current=workflow.scopeKey;latest.current=workflow;
  useEffect(()=>{setEditing(false);setMessage('');setBusy(false);pending.current=false;setCompletedHidden('');},[workflow.scopeKey]);
  useEffect(()=>{setWeekOffset(0);setSelectedDate(null);},[workflow.scopeKey,projection?.daily.window.localDate]);
  const blocked=overlayBlocked||!workflow.ready||!!workflow.error||busy;
  const estimate=projection?evaluatePlanDraft(draft,projection):null;
  const savedEstimate=projection&&plan?evaluatePlanDraft(plan,projection):null;
  const calendar=projection&&plan?planCalendarWeek(projection,weekOffset):[];
  const selected=calendar.find(day=>day.localDate===(selectedDate||projection?.daily.window.localDate))||calendar[0];
  const changeWeek=(offset:number)=>{const next=weekOffset+offset;setWeekOffset(next);if(projection)setSelectedDate(planCalendarWeek(projection,next)[0].localDate);};
  const edit=()=>{if(blocked)return;setMessage('');setDraft(plan?{bookId:plan.bookId,goal:plan.goal,dailyNew:plan.dailyNew,weekdays:[...plan.weekdays]}:{bookId:'scene',goal:WORKFLOW_BOOKS[0].capacity,dailyNew:15,weekdays:[1,2,3,4,5]});setEditing(true);};
  const run=async(action:()=>Promise<VocabularyWorkflowResult>,success:string,after?:()=>void)=>{
    if(blocked||pending.current)return;const key=workflow.scopeKey;pending.current=true;setBusy(true);setMessage('');
    try{const result=await action();if(scope.current!==key)return;setMessage(resultMessage(result,success));if(successful(result))after?.();}
    catch(error){if(scope.current===key)setMessage(error instanceof Error?error.message:'操作未保存，请重试。');}
    finally{if(scope.current===key){pending.current=false;setBusy(false);}}
  };
  const download=async()=>{
    if(blocked||pending.current)return;const key=workflow.scopeKey;pending.current=true;setBusy(true);setMessage('');
    try{const backup=await workflow.exportWorkflow();if(scope.current!==key)return;const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='lantern-workflow-backup.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('单词计划与普通练习会话的工作流备份已生成；请另行导出词库记录与学习记录。');}
    catch(error){if(scope.current===key)setMessage(error instanceof Error?error.message:'备份未生成。');}
    finally{if(scope.current===key){pending.current=false;setBusy(false);}}
  };
  const restore=async(file:File|undefined)=>{
    if(!file||blocked||pending.current)return;
    const key=workflow.scopeKey;pending.current=true;setBusy(true);setMessage('');
    try{
      if(file.size>50*1024*1024)throw Error('工作流备份超过 50 MiB，请核对文件。');
      const input=JSON.parse(await file.text());
      if(scope.current!==key)return;
      if(!latest.current.ready||latest.current.error)throw Error(latest.current.error||'工作流读取状态已变化，请重新读取后恢复。');
      const result=await latest.current.restoreWorkflow(input);
      if(scope.current===key)setMessage(resultMessage(result,'当前空间的单词与普通练习工作流备份已合并。缺失原学习记录的引用不会计入完成；待确认操作不会自动执行。'));
    }catch(error){if(scope.current===key)setMessage(error instanceof Error?error.message:'备份恢复失败，原记录保留。');}
    finally{if(scope.current===key){pending.current=false;setBusy(false);}}
  };
  const showSession=workflow.activeSession&&(workflow.activeSession.status==='active'||completedHidden!==workflow.activeSession.id);
  return <div className="phase2-vocabulary-plan">
    <header className="phase2-plan-heading"><div><span className="phase2-vocab-eyebrow">VOCABULARY · 每天一点，慢慢熟悉</span><h1>我的单词计划</h1></div><button type="button" className="button secondary" disabled={blocked} onClick={edit}><Settings2 size={17}/>{plan?'调整计划':'建立计划'}</button></header>
    <WorkflowNotice workflow={workflow}/>
    {workflow.ready&&!workflow.error&&projection&&<>
      {editing&&<section className="phase2-plan-editor panel" aria-labelledby="phase2-plan-editor-title"><h2 id="phase2-plan-editor-title">{plan?'调整接下来的安排':'从适合自己的节奏开始'}</h2>
        <form onSubmit={event=>{event.preventDefault();if(estimate?.valid)void run(()=>workflow.savePlan(draft,plan?.revision??null),'单词计划已保存；已完成的学习记录保留。',()=>setEditing(false));}}>
          <fieldset disabled={blocked}><legend className="sr-only">单词计划设置</legend>
            <label className="phase2-plan-field">词书<select value={draft.bookId} onChange={event=>{const bookId=event.target.value as WorkflowBookId;const next={...draft,bookId};const view=evaluatePlanDraft({...next,goal:0},projection);setDraft({...next,goal:view.capacity});}}>{WORKFLOW_BOOKS.map(book=><option key={book.id} value={book.id}>{book.name} · {book.capacity} 词</option>)}</select></label>
            <div className="phase2-plan-number-fields"><label className="phase2-plan-field">总覆盖目标<input type="number" inputMode="numeric" step="1" min={estimate?.learned??0} max={estimate?.capacity} value={Number.isNaN(draft.goal)?'':draft.goal} aria-invalid={!!estimate&&!Number.isSafeInteger(draft.goal)||!!estimate&&(draft.goal<estimate.learned||draft.goal>estimate.capacity)} onChange={event=>setDraft({...draft,goal:event.target.value===''?NaN:Number(event.target.value)})}/><small>真实已学 {estimate?.learned} · 可选 {estimate?.capacity}</small></label><label className="phase2-plan-field">每日新词量<input type="number" inputMode="numeric" step="1" min="1" max="1000" value={Number.isNaN(draft.dailyNew)?'':draft.dailyNew} onChange={event=>setDraft({...draft,dailyNew:event.target.value===''?NaN:Number(event.target.value)})}/><small>只安排新词，到期复习另计。</small></label></div>
            <fieldset className="phase2-weekday-field"><legend>每周学习日</legend><div className="phase2-weekday-picker">{WEEKDAYS.map(day=><label key={day}><input type="checkbox" checked={draft.weekdays.includes(day)} onChange={event=>setDraft({...draft,weekdays:event.target.checked?[...draft.weekdays,day]:draft.weekdays.filter(value=>value!==day)})}/><span>周{DAY_NAMES[day%7]}</span></label>)}</div></fieldset>
            {estimate&&<div className="phase2-plan-estimate" role="status"><b>{estimate.title}</b><p>{estimate.detail}</p></div>}
            <p className="phase2-vocab-note">修改对今天下一个尚未开始的词组生效；当前词组、今日完成事实和历史记录保留。</p>
            <div className="button-row"><button type="button" className="button secondary" onClick={()=>setEditing(false)}>取消修改</button><button type="submit" className="button primary" disabled={blocked||!estimate?.valid}>{busy?'正在保存…':'保存计划'}<Check size={17}/></button></div>
          </fieldset>
        </form>
      </section>}
      {!plan?<section className="phase2-plan-cover panel"><BookOpen size={30}/><h2>词书、总目标、每周节奏，都由你决定。</h2><p>预填每天 15 个新词、周一至周五。保存后才开始安排；不会生成示例学习进度。</p><button type="button" className="button primary" disabled={blocked} onClick={edit}>建立我的计划<ArrowRight size={17}/></button></section>:<>
        <section className="phase2-plan-cover panel"><div className="phase2-vocab-heading"><span className="phase2-vocab-eyebrow"><BookOpen size={16}/>{WORKFLOW_BOOKS.find(book=>book.id===plan.bookId)?.name}</span><span className="phase2-local-badge">本机计划 · 未同步</span></div><h2>{projection.counts.remaining===0?'总目标已覆盖，温习让它更牢固。':'不赶路，把每个新词学扎实。'}</h2><div className="phase2-plan-stats"><span><b>{projection.counts.learned}</b>真实已学</span><span><b>{plan.goal}</b>总覆盖目标</span><span><b>{projection.counts.remaining}</b>还需认识</span></div><progress aria-label="总目标覆盖进度" value={Math.min(projection.counts.learned,plan.goal)} max={Math.max(1,plan.goal)}/><p><CalendarDays size={15}/>每周 {plan.weekdays.length} 天 · 每天 {plan.dailyNew} 个新词 · {plan.weekdays.length*plan.dailyNew} 个／周</p>{savedEstimate&&<div className="phase2-plan-estimate phase2-saved-estimate"><b>{savedEstimate.title}</b><p>{savedEstimate.detail}</p></div>}<p className="phase2-vocab-note">累计已学来自真实词卡记录；旧记录不猜算成今天的新学或复习。</p></section>
        {selected&&<section className="phase2-plan-calendar panel" aria-label="单词计划日历">
          <div className="phase2-vocab-heading"><h2>这周，慢慢积累</h2><div className="phase2-plan-view" role="group" aria-label="计划视图">{(['week','day'] as const).map(view=><button key={view} type="button" aria-pressed={planView===view} disabled={overlayBlocked} onClick={()=>setPlanView(view)}>{view==='week'?'周':'日'}</button>)}</div></div>
          <div className="phase2-calendar-range"><button type="button" className="text-button" aria-label="上一周" disabled={overlayBlocked} onClick={()=>changeWeek(-1)}><ChevronLeft size={18}/></button><b>{calendarDate(calendar[0].localDate)} — {calendarDate(calendar[6].localDate)}</b><button type="button" className="text-button" aria-label="下一周" disabled={overlayBlocked} onClick={()=>changeWeek(1)}><ChevronRight size={18}/></button></div>
          <div className="phase2-calendar-days">{calendar.map(day=><button key={day.localDate} type="button" className={day.isLearningDay?'':'is-rest'} disabled={overlayBlocked} aria-pressed={selected.localDate===day.localDate} aria-current={day.isToday?'date':undefined} aria-label={`${day.localDate}，周${DAY_NAMES[day.weekday%7]}，${day.isLearningDay?'学习日':'休息日'}${day.isToday?'，今天':''}`} onClick={()=>setSelectedDate(day.localDate)}><span>周{DAY_NAMES[day.weekday%7]}</span><b>{Number(day.localDate.slice(8,10))}</b><small>{day.isToday?'今日':day.isLearningDay?'·':'休'}</small></button>)}</div>
          <p className="phase2-calendar-zone">{projection.daily.window.timezone} · {calendar[0].localDate} 至 {calendar[6].localDate}</p>
          {planView==='week'&&<p className="phase2-calendar-summary">本周预计待新学 <b>{calendar.reduce((sum,day)=>sum+(day.estimatedNew??0),0)}</b> 个 · 复习另计</p>}
          <div className="phase2-calendar-detail" aria-live="polite"><h3>{selected.isToday?'今天':calendarDate(selected.localDate)}的安排</h3>{selected.isToday?<><div className="phase2-calendar-counts"><span><b>{projection.daily.newDone}</b>已新学</span><span><b>{projection.daily.reviewDone}</b>已复习</span><span><b>{projection.daily.newRemaining}</b>待新学</span></div><p>到期／主动复习另有 {projection.daily.reviewRemaining} 词待练，已复习不计入新词覆盖。</p></>:selected.localDate<projection.daily.window.localDate?<p>此视图未读取该日历史记录；已新学、已复习均未记录，不从当前计划反推。</p>:<><div className="phase2-calendar-counts"><span><b>{selected.estimatedNew}</b>预计新词</span><span><b>待排</b>到期复习</span><span><b>—</b>完成未发生</span></div><p>{selected.isLearningDay?'按保存计划估计新词配额；实际任务在当天安排。':'这是休息日，不安排新词；当天到期复习仍可进行。'}</p></>}</div>
          {(weekOffset!==0||!selected.isToday)&&<button type="button" className="text-button" disabled={overlayBlocked} onClick={()=>{setWeekOffset(0);setSelectedDate(null);}}>回到今天<CalendarDays size={15}/></button>}
        </section>}
        <TodayVocabularyTask workflow={workflow} disabled={blocked} onOpen={()=>setCompletedHidden('')}/>
        <div className="phase2-vocab-secondary-actions"><button type="button" className="button secondary" disabled={blocked||projection.daily.reviewRemaining===0} onClick={()=>void run(()=>workflow.startGroup('review'),'复习词组已准备好。',()=>setCompletedHidden(''))}>复习 · {projection.daily.reviewRemaining} 词</button><button type="button" className="text-button" disabled={blocked} onClick={()=>void run(()=>workflow.startGroup('extra'),'加练词组已准备好。',()=>setCompletedHidden(''))}>主动加练<Plus size={16}/></button>{onOpenSearch&&<button type="button" className="text-button" disabled={blocked} onClick={onOpenSearch}>去查词添加候选<ArrowRight size={16}/></button>}</div>
      </>}
      {showSession&&<VocabularyStudyCard workflow={workflow} theme={theme} onExampleLookup={onExampleLookup} overlayBlocked={overlayBlocked||busy} onFinish={()=>setCompletedHidden(workflow.activeSession?.id||'')}/>}
      {!showSession&&<ThemeScene theme={theme} scene="blue-lake"/>}
    </>}
    {message&&<p className="phase2-vocab-message" role="status">{message}</p>}
    <section className="phase2-workflow-backup panel"><h2>把计划留在自己手里</h2><p>单词计划、候选、词组与普通练习会话的流程进度保存在本机，暂不跨设备同步。词库反馈与普通学习记录沿用原有备份与同步范围。</p><div className="button-row"><button type="button" className="button secondary" disabled={blocked} onClick={()=>void download()}><Download size={16}/>导出工作流备份</button><button type="button" className="text-button" disabled={blocked} onClick={()=>importInput.current?.click()}><Upload size={16}/>恢复工作流备份</button></div><input ref={importInput} type="file" accept="application/json,.json" hidden disabled={blocked} aria-label="选择工作流备份" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';void restore(file);}}/><p className="phase2-vocab-note">此文件保存流程进度，不包含完整词库学习事件、普通练习成绩／时长记录或私人题包。恢复按同一账号／本机分区校验；缺失的旧记录不伪装成已完成。</p></section>
  </div>;
}
