'use client';
import {useLearningAccess} from './learning-access';
import type {TrainingWrite} from './practice-training';
import {useEffect,useRef,useState} from 'react';
import {workflowScopeKey,type WorkflowScope} from './learning-domain-repository';
import {createPracticeWorkflow,practiceCatalogVersion,type PracticeLegacy,type PracticeProjection,type PracticeResult,type PracticeSession,type PracticeSettlementDraft,type PracticeStartOptions,type PracticeRestartOptions,type PracticeWorkflow} from './practice-workflow';
import {createId,type Attempt,type Question} from './study-model';

export type PracticeWorkflowHookOptions={owner:string|null;nativeMode:boolean;ready:boolean;timezone:string;questions:readonly Question[];compatibleQuestionCatalogs?:readonly (readonly Question[])[];attempts?:readonly Attempt[];legacy:PracticeLegacy};
export type PracticeWorkflowController={
 scopeKey:string;ready:boolean;error:string;busy:boolean;session:PracticeSession|null;sessions:PracticeSession[];pendingSettlements:PracticeSession[];
 start:(queue:readonly Question[],options:PracticeStartOptions)=>Promise<PracticeResult>;
 resume:(id:string)=>Promise<PracticeResult>;submit:(choice:number,seconds:number,expectedCursor?:number)=>Promise<PracticeResult>;next:(expectedCursor?:number)=>Promise<PracticeResult>;
 closeView:(expectedId?:string)=>Promise<PracticeResult>;restart:(id:string,options:PracticeRestartOptions)=>Promise<PracticeResult>;leave:(id?:string)=>Promise<PracticeResult>;
 updateTraining:(write:TrainingWrite)=>Promise<PracticeResult>;
 updateSettlementDraft:(id:string,draft:PracticeSettlementDraft)=>Promise<PracticeResult>;settle:(id:string,draft?:PracticeSettlementDraft)=>Promise<PracticeResult>;refresh:()=>Promise<void>;
};
type Snapshot={key:string;ready:boolean;error:string;projection:PracticeProjection|null};
export function usePracticeWorkflow(options:PracticeWorkflowHookOptions):PracticeWorkflowController {
 const accountAccess=useLearningAccess(options.owner),canRead=useLearningAccess(options.owner,true);
 const scope:WorkflowScope=options.nativeMode?(options.owner?{kind:'harmony-owner',ownerId:options.owner}:{kind:'harmony-device',partition:'existing-device'}):options.owner===null?{kind:'web-local',partition:'existing-device'}:{kind:'web-owner',ownerId:options.owner};
 const key=workflowScopeKey(scope),catalogVersion=practiceCatalogVersion(options.questions),compatibleCatalogVersions=(options.compatibleQuestionCatalogs??[]).map(practiceCatalogVersion).join('|'),latest=useRef(options);latest.current=options;
 const activeKey=useRef(key);activeKey.current=key;
 const generation=useRef(0),requestId=useRef(0),operationCount=useRef(0),operationTail=useRef<Promise<void>>(Promise.resolve()),readable=useRef(false);
 const service=useRef<{key:string;generation:number;value:PracticeWorkflow}|null>(null),notify=useRef<(()=>void)|null>(null);
 const [snapshot,setSnapshot]=useState<Snapshot>({key,ready:false,error:'',projection:null}),[visible,setVisible]=useState<{key:string;id:string|null}>({key,id:null}),[busy,setBusy]=useState(false),[initializationAttempt,setInitializationAttempt]=useState(0);
 const visibleRef=useRef(visible);visibleRef.current=visible;
 const creations=useRef(new Map<string,{requestId:string;promise?:Promise<PracticeResult>}>());
 const current=snapshot.key===key&&canRead()?snapshot:{key,ready:false,error:'',projection:null};
 const session=(visible.key===key&&visible.id?current.projection?.sessions.find(item=>item.id===visible.id):null)??null;
 async function refreshSnapshot(){
  const instance=service.current;if(!accountAccess()||!instance||instance.key!==activeKey.current||!latest.current.ready)return;
  const request=++requestId.current;
  try{const projection=await instance.value.readProjection();if(!accountAccess()||service.current!==instance||instance.key!==activeKey.current||request!==requestId.current||!latest.current.ready)return;readable.current=true;setSnapshot({key:instance.key,ready:true,error:'',projection});}
  catch(error){if(!accountAccess()||service.current!==instance||instance.key!==activeKey.current||request!==requestId.current)return;readable.current=false;setSnapshot(previous=>({key:instance.key,ready:false,error:error instanceof Error?error.message:'练习会话读取失败，原记录保留。',projection:previous.key===instance.key?previous.projection:null}));}
 }
 useEffect(()=>{
  const id=++generation.current;let cancelled=false;readable.current=false;
  if(!accountAccess()||!options.ready){service.current=null;setSnapshot(previous=>({key,ready:false,error:'',projection:previous.key===key?previous.projection:null}));return;}
  const stillCurrent=()=>accountAccess()&&!cancelled&&generation.current===id&&activeKey.current===key&&latest.current.ready;
  setSnapshot(previous=>({key,ready:false,error:'',projection:previous.key===key?previous.projection:null}));
  void createPracticeWorkflow({scope,questions:options.questions,compatibleQuestionCatalogs:options.compatibleQuestionCatalogs,timezone:options.timezone,isCurrent:stillCurrent,seenQuestionIds:()=>latest.current.attempts?.map(attempt=>attempt.qid)??[],legacy:{
   addAttempt:attempt=>{if(!stillCurrent())throw Error('scope-changed');return latest.current.legacy.addAttempt(attempt);},
   addCheckin:checkin=>{if(!stillCurrent())throw Error('scope-changed');return latest.current.legacy.addCheckin(checkin);},
   readAttempt:attemptId=>{if(!stillCurrent())throw Error('scope-changed');return latest.current.legacy.readAttempt(attemptId);},
   readCheckin:checkinId=>{if(!stillCurrent())throw Error('scope-changed');return latest.current.legacy.readCheckin(checkinId);},
  }}).then(value=>{if(!stillCurrent()){value.close();return;}service.current={key,generation:id,value};void refreshSnapshot();}).catch(error=>{if(stillCurrent())setSnapshot(previous=>({key,ready:false,error:error instanceof Error?error.message:'练习会话尚未就绪。',projection:previous.key===key?previous.projection:null}));});
  return()=>{cancelled=true;const instance=service.current;if(instance?.generation===id){instance.value.close();service.current=null;}};
  // Each callback checks current identity again before touching the legacy journal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,options.ready,catalogVersion,compatibleCatalogVersions,options.timezone,initializationAttempt]);
 useEffect(()=>{void refreshSnapshot();},[options.attempts]);
 useEffect(()=>{
  let channel:BroadcastChannel|undefined;
  try{if(typeof BroadcastChannel!=='undefined'){channel=new BroadcastChannel('lantern-workflow-v1');channel.onmessage=event=>{if(event.data===key)void refreshSnapshot();};}}catch{/* Only an invalidation hint; IDB remains mandatory. */}
  notify.current=()=>channel?.postMessage(key);
  const invalidate=()=>void refreshSnapshot();window.addEventListener('focus',invalidate);window.addEventListener('storage',invalidate);
  return()=>{notify.current=null;channel?.close();window.removeEventListener('focus',invalidate);window.removeEventListener('storage',invalidate);};
 },[key]);
 async function run(action:(value:PracticeWorkflow)=>Promise<PracticeResult>,show=false):Promise<PracticeResult>{
  const instance=service.current;if(!accountAccess()||!instance||instance.key!==key||!current.ready)return {status:'blocked',reason:current.error||'练习持久记录尚未就绪。'};
  operationCount.current++;setBusy(true);
  const task=operationTail.current.then(async():Promise<PracticeResult>=>{
   if(!accountAccess()||service.current!==instance||activeKey.current!==key||!latest.current.ready)return {status:'blocked',reason:'scope-changed'};
   if(!readable.current)return {status:'blocked',reason:'practice-read-unavailable'};
   try{
    const result=await action(instance.value);
    if(!accountAccess()||service.current!==instance||activeKey.current!==key||!latest.current.ready)return {status:'blocked',reason:'scope-changed'};
    if(show&&'sessionId'in result&&result.sessionId&&(result.status==='started'||result.status==='restored'||result.status==='replayed'))setVisible({key,id:result.sessionId});
    notify.current?.();await refreshSnapshot();return result;
   }catch(error){await refreshSnapshot();return {status:'blocked',reason:error instanceof Error?error.message:'练习操作未完成，原记录保留。'};}
  });
  operationTail.current=task.then(()=>{},()=>{});
  try{return await task;}finally{operationCount.current--;if(operationCount.current===0)setBusy(false);}
 }
 // Public retry explicitly replaces the failed/open service. Broadcast and ordinary invalidation
 // only read the current instance, so unavailable storage cannot cause an automatic reopen loop.
 async function refresh(){
  if(!accountAccess())return;
  if(!accountAccess()||!latest.current.ready||activeKey.current!==key)return;
  generation.current++;requestId.current++;readable.current=false;service.current?.value.close();service.current=null;
  setSnapshot(previous=>({key,ready:false,error:'',projection:previous.key===key?previous.projection:null}));setInitializationAttempt(attempt=>attempt+1);
 }
 async function start(queue:readonly Question[],startOptions:PracticeStartOptions):Promise<PracticeResult>{
  const signature=JSON.stringify([key,generation.current,startOptions.task??null,startOptions.mode??'resume-or-create',startOptions.chainId??null,queue.map(q=>q.id)]);
  let intent=creations.current.get(signature);if(intent?.promise)return intent.promise;
  if(!intent){intent={requestId:startOptions.requestId??createId()};creations.current.set(signature,intent);}
  const frozen=intent,promise=run(value=>value.start(queue,{...startOptions,requestId:frozen.requestId}),true);frozen.promise=promise;
  const result=await promise;
  if(['started','restored','replayed'].includes(result.status))creations.current.delete(signature);else frozen.promise=undefined;
  return result;
 }
 const renderedService=service.current;
 const noSession=():PracticeResult=>({status:'blocked',reason:'practice-session-not-visible'});
 return {
  scopeKey:key,ready:current.ready&&options.ready,error:current.error,busy,session,sessions:current.projection?.sessions??[],pendingSettlements:current.projection?.pendingSettlements??[],
  start,restart:(id,options)=>run(value=>value.restart(id,options),true),resume:id=>run(value=>value.resume(id),true),
  submit:(choice,seconds,cursor=session?.cursor)=>session&&cursor!==undefined?run(value=>value.submit(session.id,choice,seconds,cursor)):Promise.resolve(noSession()),
  next:(cursor=session?.cursor)=>session&&cursor!==undefined?run(value=>value.next(session.id,cursor)):Promise.resolve(noSession()),
  closeView:async(expectedId=session?.id)=>{if(!accountAccess()||service.current!==renderedService||activeKey.current!==key||visibleRef.current.key!==key||visibleRef.current.id!==expectedId)return {status:'blocked',reason:'scope-changed'};const id=expectedId??'';setVisible({key,id:null});return {status:'closed',sessionId:id};},
  leave:(id=session?.id)=>id?run(value=>value.leave(id)):Promise.resolve(noSession()),
  updateTraining:write=>session?run(value=>value.updateTraining(session.id,write)):Promise.resolve(noSession()),
  updateSettlementDraft:(id,draft)=>run(value=>value.updateSettlementDraft(id,draft)),settle:(id,draft)=>run(value=>value.settle(id,draft)),refresh,
 };
}
