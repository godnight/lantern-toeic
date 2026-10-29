'use client';
import {useLearningAccess} from './learning-access';
import {useEffect,useRef,useState} from 'react';
import type {useVocabulary} from './use-vocabulary';
import {workflowScopeKey,type WorkflowBackup} from './learning-domain-repository';
import {createVocabularyWorkflow,type CandidateKind,type CandidateStatus,type RawVocabularyRating,type VocabularyPlanDraft,type VocabularyProjection,type VocabularySession,type VocabularyWorkflowResult,type VocabularyWorkflowScope} from './vocabulary-workflow';
import type {Word} from './vocabulary-model';
import type {Question} from './study-model';

type Legacy=Pick<ReturnType<typeof useVocabulary>,'events'|'ready'|'error'|'readEvent'|'reviewEvent'|'backup'>;
export type VocabularyWorkflowHookOptions={owner:string|null;nativeMode:boolean;identityReady?:boolean;timezone:string;words?:Word[];practiceQuestionCatalogs?:readonly (readonly Question[])[];legacy:Legacy};
export type VocabularyWorkflowController={
 scopeKey:string;ready:boolean;error:string;projection:VocabularyProjection|null;activeSession:VocabularySession|null;pendingRating:RawVocabularyRating|null;
 candidateStatus:(word:Word)=>CandidateStatus;
 savePlan:(draft:VocabularyPlanDraft,expectedRevision?:number|null)=>Promise<VocabularyWorkflowResult>;
 addCandidate:(word:Word,kind:CandidateKind,commandId?:string)=>Promise<VocabularyWorkflowResult>;
 startGroup:(intent?:'auto'|'daily'|'new'|'review'|'extra')=>Promise<VocabularyWorkflowResult>;
 submitRating:(rating:RawVocabularyRating)=>Promise<VocabularyWorkflowResult>;
 nextStep:()=>Promise<VocabularyWorkflowResult>;
 exportWorkflow:()=>Promise<WorkflowBackup>;restoreWorkflow:(input:unknown)=>Promise<VocabularyWorkflowResult>;refresh:()=>Promise<void>;
};
type Service=Awaited<ReturnType<typeof createVocabularyWorkflow>>;
type ServiceInstance={key:string;generation:number;value:Service};
type OperationReads={active:number;invalidations:number;covered:number};
export function useVocabularyWorkflow(options:VocabularyWorkflowHookOptions):VocabularyWorkflowController {
 const accountAccess=useLearningAccess(options.owner),canRead=useLearningAccess(options.owner,true);
 const scope:VocabularyWorkflowScope=options.nativeMode?(options.owner?{kind:'harmony-owner',ownerId:options.owner}:{kind:'harmony-device',partition:'existing-device'}):options.owner===null?{kind:'web-local',partition:'existing-device'}:{kind:'web-owner',ownerId:options.owner};
 const key=workflowScopeKey(scope),latest=useRef(options);latest.current=options;
 const activeKey=useRef(key);activeKey.current=key;
 const generation=useRef(0),service=useRef<ServiceInstance|null>(null),requestId=useRef(0),notify=useRef<(()=>void)|null>(null);
 const operationReads=useRef(new WeakMap<ServiceInstance,OperationReads>());
 const [snapshot,setSnapshot]=useState<{key:string;ready:boolean;error:string;projection:VocabularyProjection|null}>({key,ready:false,error:'',projection:null});
 const [openAttempt,setOpenAttempt]=useState(0);
 const current=snapshot.key===key&&canRead()?snapshot:{key,ready:false,error:'',projection:null};
 async function refreshSnapshot(instance=service.current,afterAction=false){
  if(!accountAccess()||!instance||service.current!==instance||instance.key!==activeKey.current)return;
  const reads=operationReads.current.get(instance);
  // A legacy invalidation can arrive between prepare and apply. Let the owning
  // operation finish, then perform the same complete, verified projection read.
  if(reads?.active&&!afterAction){reads.invalidations++;return;}
  const covered=reads?.invalidations??0,request=++requestId.current;
  try{const projection=await instance.value.readProjection(latest.current.timezone);if(!accountAccess()||service.current!==instance||activeKey.current!==instance.key||request!==requestId.current)return;setSnapshot({key:instance.key,ready:true,error:'',projection});}
  catch(error){if(!accountAccess()||service.current!==instance||request!==requestId.current)return;setSnapshot(previous=>({key:instance.key,ready:false,error:error instanceof Error?error.message:'本机工作流无法读取；原记录保留。',projection:previous.key===instance.key?previous.projection:null}));}
  finally{if(reads&&afterAction)reads.covered=Math.max(reads.covered,covered);}
 }
 useEffect(()=>{
  const id=++generation.current;let cancelled=false;
  if(!accountAccess()||options.identityReady===false||!options.legacy.ready||options.legacy.error){service.current=null;setSnapshot({key,ready:false,error:options.legacy.error||'',projection:null});return;}
  const stillCurrent=()=>accountAccess()&&!cancelled&&generation.current===id&&activeKey.current===key&&latest.current.identityReady!==false&&latest.current.legacy.ready&&!latest.current.legacy.error;
  setSnapshot({key,ready:false,error:'',projection:null});
  void createVocabularyWorkflow({scope,words:options.words,practiceQuestionCatalogs:options.practiceQuestionCatalogs,isCurrent:stillCurrent,legacy:{
   readEvents:()=>{if(!stillCurrent())throw Error('账号已切换');return latest.current.legacy.backup().events;},
   readEvent:eventId=>{if(!stillCurrent())throw Error('账号已切换');return latest.current.legacy.readEvent(eventId);},
   writeReview:event=>{if(!stillCurrent())throw Error('账号已切换');return latest.current.legacy.reviewEvent(event);},
  }}).then(value=>{if(!stillCurrent()){value.close();return;}service.current={key,generation:id,value};void refreshSnapshot();}).catch(error=>{if(stillCurrent())setSnapshot({key,ready:false,error:error instanceof Error?error.message:'本机工作流不可用。',projection:null});});
  return()=>{cancelled=true;const instance=service.current;if(instance?.generation===id){instance.value.close();service.current=null;}};
  // One service owns this scope; the legacy adapter reads the latest committed journal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,options.identityReady,options.legacy.ready,options.legacy.error,options.practiceQuestionCatalogs,openAttempt]);
 useEffect(()=>{void refreshSnapshot();},[options.legacy.events,options.timezone]);
 useEffect(()=>{
  let channel:BroadcastChannel|undefined;
  try{if(typeof BroadcastChannel!=='undefined'){channel=new BroadcastChannel('lantern-workflow-v1');channel.onmessage=event=>{if(event.data===key)void refreshSnapshot();};}}catch{/* IDB remains required; broadcast is only an invalidation hint. */}
  notify.current=()=>{channel?.postMessage(key);};
  const focus=()=>void refreshSnapshot(),storage=()=>void refreshSnapshot();
  window.addEventListener('focus',focus);window.addEventListener('storage',storage);const timer=setInterval(focus,60000);
  return()=>{notify.current=null;channel?.close();window.removeEventListener('focus',focus);window.removeEventListener('storage',storage);clearInterval(timer);};
 },[key]);
 async function run(action:(value:Service)=>Promise<VocabularyWorkflowResult>){
  const instance=service.current;
  if(!accountAccess()||!instance||instance.key!==key||!current.ready||current.error)return {status:'blocked' as const,reason:current.error||'请等待本机工作流读取完成。'};
  const reads=operationReads.current.get(instance)??{active:0,invalidations:0,covered:0};
  operationReads.current.set(instance,reads);reads.active++;++requestId.current;
  try{
   const result=await action(instance.value);
   if(!accountAccess()||service.current!==instance||activeKey.current!==key)return {status:'blocked' as const,reason:'账号已切换，原操作保留在原账号。'};
   notify.current?.();await refreshSnapshot(instance,true);return result;
  }catch(error){await refreshSnapshot(instance,true);return {status:'blocked' as const,reason:error instanceof Error?error.message:'工作流操作未完成。'};}
  finally{
   if(!--reads.active){
    operationReads.current.delete(instance);
    // A hint arriving during the final read is newer than that read. It must
    // still invalidate it, and an old owner's completion cannot read a new scope.
    if(reads.invalidations>reads.covered)void refreshSnapshot(instance);
   }
  }
 }
 async function refresh(){
  if(!accountAccess())return;
  // Only this explicit user action reopens an unavailable/closed IDB instance.
  // Timers, storage hints and legacy updates only read, so a failure cannot loop.
  if(current.error||!service.current){if(latest.current.identityReady!==false&&latest.current.legacy.ready&&!latest.current.legacy.error){++generation.current;service.current?.value.close();service.current=null;setSnapshot(previous=>({...previous,key,ready:false,error:''}));setOpenAttempt(value=>value+1);}return;}
  await refreshSnapshot();
 }
 return {
  scopeKey:key,ready:current.ready,error:current.error,projection:current.projection,activeSession:current.projection?.activeSession??null,pendingRating:current.projection?.activeSession?.currentStep?.pendingRating??null,
  candidateStatus:word=>canRead()&&service.current?.key===key?service.current.value.candidateStatus(word):'available-new',
  savePlan:(draft,revision=current.projection?.plan?.revision??null)=>run(value=>value.savePlan(draft,revision,latest.current.timezone)),
  addCandidate:(word,kind,commandId)=>run(value=>value.addCandidate(word,kind,commandId,latest.current.timezone)),
  startGroup:(intent='auto')=>run(value=>value.startGroup(intent==='auto'?'daily':intent,latest.current.timezone)),
  submitRating:rating=>{const session=current.projection?.activeSession,step=session?.currentStep;if(!session||!step)return Promise.resolve({status:'blocked',reason:'没有待反馈的可见词卡。'});const target={sessionId:session.id,stepId:step.id};return run(value=>value.submitRating(rating,latest.current.timezone,target));},
  nextStep:()=>{const session=current.projection?.activeSession,step=session?.currentStep;if(!session||!step)return Promise.resolve({status:'blocked',reason:'没有待切换的可见词卡。'});const target={sessionId:session.id,stepId:step.id};return run(value=>value.nextStep(latest.current.timezone,target));},
  exportWorkflow:async()=>{const instance=service.current;if(!accountAccess()||!instance||instance.key!==key||!current.ready||current.error)throw Error(current.error||'工作流尚未读入。');return instance.value.exportWorkflow();},
  restoreWorkflow:input=>run(value=>value.restoreWorkflow(input,latest.current.timezone)),refresh,
 };
}
