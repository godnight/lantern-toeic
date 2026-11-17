/* Actual UI components; synthetic profiles/workflow commands, no user data. */
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LearningPlanDialog} from '@/app/learn/learning-plan';
import {TodayVocabularyTask} from '@/app/learn/vocabulary-plan';
import {PersonalSettings} from '@/app/learn/personal-settings';
import {WorkspaceShell} from '@/app/learn/workspace-shell';
import {PublicInfoBoundary,PublicInfoLinks} from '@/app/learn/legal-pages';
import {useWorkspaceDialogHistory} from '@/lib/use-workspace-dialog-history';
import {getWorkflowCatalog} from '@/lib/workflow-catalog';
import {applyDocumentTheme} from '@/lib/ui-theme';
import '@/app/globals.css';
import '@/app/redesign.css';
import '@/app/v041-design-theme.css';
import '@/app/learn/v041-vocabulary.css';
import '@/app/learn/audio-redesign.css';
import '@/app/v041-app-redesign.css';
import '@/app/learn/legal-pages.css';

const query=new URLSearchParams(location.search),theme=query.get('theme')||'paper';
document.documentElement.style.fontSize=query.get('font')==='200'?'200%':'100%';
applyDocumentTheme(theme);
const words=getWorkflowCatalog('general-base-1.2');
function Fixture(){
  const [,render]=useState(0),back=useRef(null),trigger=useRef(null),scroll=useRef(0);
  const s=useRef({nav:'today',route:null,instance:0,scope:'fixture-a',mode:'applied',profileOk:true,calls:[],reads:0,pending:[],
    profile:{name:'原有称呼',lrGoal:650,speakingGoal:130,examDate:'',dailyMinutes:10,weeklyTarget:2,timezone:'Asia/Shanghai',theme,onboarded:false},
    projection:{plan:{bookId:'general-base-1.2',goal:80,dailyNew:15,weekdays:[1,2,3,4,5],revision:4},counts:{capacity:words.length,learned:2,remaining:78,reviewDue:0},candidates:[],learnedWordIds:words.slice(0,2).map(w=>w.id),daily:{window:{localDate:'2026-10-28'},newDone:0,newRemaining:15,reviewDone:0,reviewRemaining:0,isLearningDay:true}}});
  const state=s.current,update=()=>render(n=>n+1);
  const close=()=>{state.route=null;update();};
  const open=initial=>{trigger.current=document.activeElement;scroll.current=window.scrollY;state.route={id:++state.instance,initial};update();};
  const apply=(draft,result)=>{if(['applied','replayed'].includes(result.status))state.projection.plan={...draft,revision:(state.projection.plan?.revision||0)+1};update();return result;};
  const workflow={scopeKey:state.scope,ready:true,error:'',projection:state.projection,activeSession:null,
    savePlan:(draft,revision)=>{state.calls.push({draft,revision});if(state.mode==='hold')return new Promise(resolve=>state.pending.push(result=>resolve(apply(draft,result))));return Promise.resolve(apply(draft,{status:state.mode,id:'fixture-save'}));},
    refresh:async()=>{state.reads++;update();},startGroup:async()=>({status:'applied'})};
  useWorkspaceDialogHistory(state.route?'learning-plan':null,close,()=>{back.current?.();return false;});
  useEffect(()=>{window.__planQA={read:()=>({nav:state.nav,route:state.route,calls:structuredClone(state.calls),reads:state.reads,profile:structuredClone(state.profile),plan:structuredClone(state.projection.plan),pending:state.pending.length}),
    mode:value=>{state.mode=value;update();},noPlan:()=>{state.projection.plan=null;update();},covered:()=>{state.projection.plan.goal=2;state.projection.plan.weekdays=[];state.projection.counts.remaining=0;state.projection.daily.newRemaining=0;update();},
    profileOk:value=>{state.profileOk=value;update();},settle:result=>{const finish=state.pending.shift();finish?.(result);},switchScope:()=>{state.scope+='-next';state.route=null;update();},legacyGoals:()=>open('goals')};return()=>{delete window.__planQA;};});
  return <PublicInfoBoundary><WorkspaceShell nav={state.nav} theme={theme} name={state.profile.name} scope="组件验证 · 合成资料" syncLabel="本机保存" reviewCount={0} onSearch={()=>{}} onSync={()=>{}} onProfile={()=>{state.nav='profile';update();}} onNavigate={nav=>{state.nav=nav;update();}}>
    {state.nav==='today'?<TodayVocabularyTask compact workflow={workflow} onPlanOverview={()=>open('overview')} onOpen={()=>open('word')} onOpenStudy={()=>{state.nav='vocabulary';update();}}/>:state.nav==='profile'?<PersonalSettings name={state.profile.name} scope="合成验证分区" theme={theme} dailyNewLabel="每日15词" accountLabel="尚未开放" syncLabel="本机保存" onPlan={()=>open('overview')} onPreferences={()=>open('goals')} onThemes={()=>{}} onAccount={()=>{}} onBackups={()=>{}} onRecordings={()=>{}} onAbout={()=>{}} onSync={()=>{}}/>:<button onClick={()=>open('word')}>调整单词安排</button>}
    <PublicInfoLinks/>
  </WorkspaceShell>
  {state.route&&<LearningPlanDialog key={state.scope+state.route.id} initial={state.route.initial} workflow={workflow} profile={state.profile} readable savingScope="本机保存" saveProfile={profile=>{if(!state.profileOk)return false;state.profile=profile;update();return true;}} backRef={back} onClose={close} onRestoreFocus={event=>{event.preventDefault();requestAnimationFrame(()=>{window.scrollTo(0,scroll.current);if(trigger.current?.isConnected)trigger.current.focus({preventScroll:true});});}}/>}
  </PublicInfoBoundary>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
