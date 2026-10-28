'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {registerNativeBack} from '@/lib/native-host';
import {isSupportedStudyTimezone,studyTimezoneChoices} from '@/lib/study-format';
import {getWorkflowBook} from '@/lib/workflow-catalog';
import type {Profile} from '@/lib/study-model';
import type {VocabularyWorkflowController} from '@/lib/use-vocabulary-workflow';
import {VocabularyPlanEditor} from './vocabulary-plan';
import {PlanEditorActions,PlanExitPrompt,usePlanEditorExit,type PlanBackRef} from './plan-editor-state';
import './learning-plan.css';

export type LearningPlanPage='overview'|'word'|'goals';
function learningDays(weekdays:number[]){
  const days=[...new Set(weekdays)].sort((a,b)=>a-b),names='一二三四五六日',parts:string[]=[];
  if(!days.length)return '未安排新词日';
  if(days.length===7)return '每天';
  for(let i=0;i<days.length;){let end=i;while(end+1<days.length&&days[end+1]===days[end]+1)end++;parts.push(end-i>=2?`周${names[days[i]-1]}至${names[days[end]-1]}`:`周${days.slice(i,end+1).map(day=>names[day-1]).join('、')}`);i=end+1;}
  return parts.join('、');
}
export function LearningPlanOverview({workflow,profile,readable,savingScope,onWord,onGoals}:{workflow:VocabularyWorkflowController;profile:Profile;readable:boolean;savingScope:string;onWord:()=>void;onGoals:()=>void}){
  const projection=readable&&workflow.ready&&!workflow.error?workflow.projection:null,plan=projection?.plan;
  const status=!projection?'正在读取计划':!plan?'尚未设置':projection.counts.learned>=plan.goal?'总目标已覆盖':!projection.daily.isLearningDay?'今日休息，仍可复习或加练':projection.daily.newRemaining===0?'今日新词目标已完成':'';
  const bookName=plan?(plan.bookId==='general-base-1.2'?'通用基础':plan.bookId==='combined-with-supplement-1.2'?'托业备考':getWorkflowBook(plan.bookId).name):'';
  return <div className="lp-overview-grid">
    <section className="lp-overview-card"><h3>单词安排</h3>
      {(workflow.error||status)&&<p>{workflow.error||status}</p>}
      {plan&&projection&&<><p>{bookName} · 已学 {projection.counts.learned} / {plan.goal}</p><p>每天 {plan.dailyNew} 个新词 · {learningDays(plan.weekdays)}</p></>}
      <div className="lp-overview-actions"><p className="lp-scope">本机保存</p><button type="button" disabled={!readable||!projection} onClick={onWord}>{plan?'调整单词安排':'制定单词安排'}<ArrowRight size={18} aria-hidden="true"/></button>
      {workflow.error&&<button type="button" onClick={()=>void workflow.refresh()}>重新读取计划</button>}</div>
    </section>
    <section className="lp-overview-card"><h3>备考目标</h3>
      {readable?<><p>听读 {profile.lrGoal} · 口语 {profile.speakingGoal}</p><p>考期：{profile.examDate||'未设置'}</p><p>每天 {profile.dailyMinutes} 分钟 · 每周 {profile.weeklyTarget} 天</p></>:<p>正在读取备考目标</p>}
      <div className="lp-overview-actions"><p className="lp-scope">{savingScope}</p><button type="button" disabled={!readable} onClick={onGoals}>调整备考目标<ArrowRight size={18} aria-hidden="true"/></button></div>
    </section>
  </div>;
}

export function ProfilePlanEditor({profile,readable,saveProfile,onLeave,onSaved,backRef}:{profile:Profile;readable:boolean;saveProfile:(profile:Profile)=>boolean;onLeave:()=>void;onSaved:()=>void;backRef?:PlanBackRef}){
  const initial=useRef({...profile});
  const [draft,setDraft]=useState<Profile>(()=>({...profile})),[more,setMore]=useState(false),[message,setMessage]=useState(''),[zoneError,setZoneError]=useState(''),[attempted,setAttempted]=useState(false);
  const form=useRef<HTMLFormElement>(null),zone=useRef<HTMLInputElement>(null),zoneField=useRef<HTMLDivElement>(null),successful=useRef(false);
  const exit=usePlanEditorExit({dirty:JSON.stringify(draft)!==JSON.stringify(initial.current),attempted,pending:false,onLeave,backRef});
  const submit=()=>{
    if(!readable||exit.confirm||successful.current)return;
    setMessage('');setZoneError('');
    const invalid=form.current?.querySelector<HTMLInputElement>('input:invalid,select:invalid');
    if(invalid){if(invalid.closest('details'))setMore(true);if(invalid===zone.current)setZoneError('请输入学习时区。');else setMessage('请检查填写内容，其他输入已保留。');requestAnimationFrame(()=>{if(invalid.isConnected&&!invalid.matches(':disabled')){invalid.focus({preventScroll:true});invalid.reportValidity();if(invalid===zone.current)zoneField.current?.scrollIntoView({block:'center',behavior:'auto'});}});return;}
    if(!isSupportedStudyTimezone(draft.timezone)){setMore(true);setZoneError('请输入有效时区，例如 Asia/Shanghai。');requestAnimationFrame(()=>{const input=zone.current;if(input?.isConnected&&!input.matches(':disabled')){input.focus({preventScroll:true});zoneField.current?.scrollIntoView({block:'center',behavior:'auto'});}});return;}
    setAttempted(true);
    try{if(saveProfile({...draft,name:draft.name.trim(),onboarded:true})===true){successful.current=true;onSaved();return;}}catch{/* The boolean contract does not promise rollback on failure. */}
    setMessage('偏好尚未确认完整保存，填写内容已保留。已发操作不会因返回而撤销。');
  };
  const choices=(values:number[],value:number)=>values.includes(value)?values:[...values,value].sort((a,b)=>a-b);
  return <section className="lp-editor" aria-label="备考目标编辑器"><h2>备考目标</h2>
    <form ref={form} noValidate onSubmit={event=>{event.preventDefault();submit();}}>
      <fieldset disabled={!readable||exit.confirm}>
        <div className="form-grid"><label className="field">听读目标<input type="number" required min={10} max={990} step={5} value={draft.lrGoal} onChange={event=>setDraft({...draft,lrGoal:Number(event.target.value)})}/></label><label className="field">口语目标<input type="number" required min={0} max={200} step={10} value={draft.speakingGoal} onChange={event=>setDraft({...draft,speakingGoal:Number(event.target.value)})}/></label></div>
        <label className="field">听读考试日期<input type="date" value={draft.examDate} onChange={event=>setDraft({...draft,examDate:event.target.value})}/></label>
        <div className="form-grid"><label className="field">每天可用时间<select value={draft.dailyMinutes} onChange={event=>setDraft({...draft,dailyMinutes:Number(event.target.value)})}>{choices([5,15,25,45,60],draft.dailyMinutes).map(value=><option key={value} value={value}>{value} 分钟</option>)}</select></label><label className="field">每周启动目标<select value={draft.weeklyTarget} onChange={event=>setDraft({...draft,weeklyTarget:Number(event.target.value)})}>{choices([3,4,5,6,7],draft.weeklyTarget).map(value=><option key={value} value={value}>{value} 天</option>)}</select></label></div>
        <details className="lp-editor-more" open={more} onToggle={event=>setMore(event.currentTarget.open)}><summary>更多设置</summary>
          <label className="field">称呼<input required maxLength={40} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
          <div ref={zoneField} className="field lp-timezone-field"><label>学习时区<input ref={zone} required list="plan-study-timezones" aria-invalid={!!zoneError||undefined} aria-describedby={zoneError?'plan-study-timezone-error':undefined} value={draft.timezone} onChange={event=>{setDraft({...draft,timezone:event.target.value});setZoneError('');}}/></label>{zoneError&&<small id="plan-study-timezone-error" className="lp-field-error" role="alert">{zoneError}</small>}<datalist id="plan-study-timezones">{studyTimezoneChoices(draft.timezone).map(value=><option key={value} value={value}/>)}</datalist><small>沿用当前学习时区计算日期，不改写历史练习时间。</small></div>
        </details>
      </fieldset>
      {message&&<p className="lp-save-notice" role="alert">{message}</p>}
      <PlanEditorActions onBack={exit.request} backDisabled={exit.confirm} saveDisabled={!readable||exit.confirm} saveLabel="保存目标"/>
    </form>
    <PlanExitPrompt exit={exit}/>
  </section>;
}

export function LearningPlanDialog({initial='overview',workflow,profile,readable,savingScope,saveProfile,onClose,onRestoreFocus,backRef}:{initial?:LearningPlanPage;workflow:VocabularyWorkflowController;profile:Profile;readable:boolean;savingScope:string;saveProfile:(profile:Profile)=>boolean;onClose:()=>void;onRestoreFocus:(event:{preventDefault:()=>void})=>void;backRef:PlanBackRef}){
  const [page,setPage]=useState<LearningPlanPage>(initial),[pending,setPending]=useState(false);
  const editorBack=useRef<(()=>void)|null>(null),content=useRef<HTMLDivElement>(null),editorTrigger=useRef('');
  const openEditor=(next:'word'|'goals')=>{editorTrigger.current=document.activeElement?.textContent?.trim()||'';setPage(next);};
  const leaveEditor=()=>{if(initial==='overview')setPage('overview');else onClose();};
  const back=()=>{if(page==='overview')onClose();else editorBack.current?.();};
  useEffect(()=>{backRef.current=back;return()=>{if(backRef.current===back)backRef.current=null;};});
  useEffect(()=>registerNativeBack(()=>{back();return true;},40));
  useEffect(()=>{const pane=content.current;if(!pane)return;pane.scrollTop=0;const trigger=page==='overview'?[...pane.querySelectorAll<HTMLButtonElement>('.lp-overview-card button')].find(button=>button.textContent?.trim()===editorTrigger.current):null;const target=trigger||pane.querySelector<HTMLElement>('.lp-dialog-header h2');if(target){if(!trigger)target.tabIndex=-1;target.focus({preventScroll:true});if(trigger)trigger.scrollIntoView({block:'nearest'});}},[page]);
  return <Dialog open onOpenChange={open=>{if(!open)back();}}><DialogContent ref={content} className="lp-dialog" showCloseButton={false} onCloseAutoFocus={onRestoreFocus} onEscapeKeyDown={event=>{event.preventDefault();back();}} onPointerDownOutside={event=>{event.preventDefault();back();}}>
    <header className="lp-dialog-header"><button type="button" className="lp-back" aria-label="返回" disabled={pending} onClick={back}><ArrowLeft size={20}/></button><div><DialogTitle>{page==='overview'?'学习计划':page==='word'?'单词安排':'备考目标'}</DialogTitle><DialogDescription className="sr-only">当前分区的计划与目标；保存状态以实际回执为准。</DialogDescription></div></header>
    {!readable&&<p role="alert">当前学习记录尚未可读，请保留记录并重新读取。</p>}
    {page==='overview'?<LearningPlanOverview workflow={workflow} profile={profile} readable={readable} savingScope={savingScope} onWord={()=>openEditor('word')} onGoals={()=>openEditor('goals')}/>:page==='word'?<VocabularyPlanEditor enabled={readable} workflow={workflow} onLeave={leaveEditor} onSaved={leaveEditor} backRef={editorBack} onPendingChange={setPending}/>:<ProfilePlanEditor profile={profile} readable={readable} saveProfile={saveProfile} onLeave={leaveEditor} onSaved={leaveEditor} backRef={editorBack}/>}
  </DialogContent></Dialog>;
}
