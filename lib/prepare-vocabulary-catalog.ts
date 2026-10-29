import type {Word} from './vocabulary-model';
import type historicalTable from '../content/vocabulary-v040-b02-private.json';
type HistoricalTable=typeof historicalTable;
export type CurrentTeachingEntry={memberId:string;contextHash:string;pairFingerprintSha256:string;word:Word;headwordBindingDigest:string;exampleBindingDigest:string;privatePracticeEligible:boolean;formalAllowed:boolean;publishAllowed:boolean;humanListeningPerformed:boolean;validatedLocale:unknown};
export type VocabularyCatalogSnapshot={
 FULL4109_SOURCE_ENTRY_SHA256:string;FULL4109_CURRENT_MODE:boolean;
 FULL4109_CURRENT_LEARNING_ENTRIES:CurrentTeachingEntry[];FULL4109_CURRENT_WORDS:Word[];
 FULL4109_CATALOG_STATUS:{configured:boolean;partitionValid:boolean;targetCount:number;acceptedCount:number;declaredAcceptedCount:number;heldCount:number;rejectedCount:number;sourceEntrySha256:string|null};
 B02_PRIVATE_LEARNING_ENTRIES:HistoricalTable['readyTeachingEntries'];LEGACY_PRIVATE_WORDS:Word[];B02_PRIVATE_WORDS:Word[];
 LEGACY_PRIVATE_PLAYABLE_WORD_IDS:readonly string[];B02_CONTENT_HOLDS:HistoricalTable['pendingTeachingEntries'];
};
let complete:VocabularyCatalogSnapshot|null=null;
let pending:Promise<VocabularyCatalogSnapshot>|null=null;
let failure:unknown=null;
let generation=0;
const yieldTask=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
const now=()=>typeof performance==='undefined'?Date.now():performance.now();
function catalogTaskQueue():{yield:()=>Promise<void>;close:()=>void}{
 // Message tasks avoid the repeated 4ms timer clamp while still letting input
 // and rendering run between bounded batches. Older engines keep timer fallback.
 try{
  if(typeof MessageChannel==='undefined')return {yield:yieldTask,close:()=>{}};
  const channel=new MessageChannel();let resume:(()=>void)|null=null;
  channel.port1.onmessage=()=>{const wake=resume;resume=null;wake?.();};
  return {yield:()=>new Promise<void>(resolve=>{resume=resolve;try{channel.port2.postMessage(0);}catch{resume=null;setTimeout(resolve,0);}}),
   close:()=>{resume=null;channel.port1.onmessage=null;channel.port1.close();channel.port2.close();}};
 }catch{return {yield:yieldTask,close:()=>{}};}
}
export class VocabularyCatalogPendingError extends Error{constructor(){super('词表仍在核验，暂不能读取统计或开始学习。');}}
export function readPreparedVocabularyCatalog():VocabularyCatalogSnapshot{
 if(!complete)throw new VocabularyCatalogPendingError();return complete;
}
/** Server/legacy pure fixtures use the exact same validator. Never a browser
 * fallback: missing the client readiness gate must remain visibly blocked. */
export function installServerVocabularyCatalog(create:()=>VocabularyCatalogSnapshot):VocabularyCatalogSnapshot{
 if(typeof window!=='undefined')return readPreparedVocabularyCatalog();
 if(!complete)complete=Object.freeze(create());return complete;
}
export async function runVocabularyCatalogSteps(steps:Generator<void,VocabularyCatalogSnapshot,void>,schedule?:()=>Promise<void>):Promise<VocabularyCatalogSnapshot>{
 const queue=schedule?{yield:schedule,close:()=>{}}:catalogTaskQueue();
 try{
  let next=steps.next();
  while(!next.done){
   const end=now()+4;let operations=0;
   do{next=steps.next();operations++;}while(!next.done&&operations<2048&&now()<end);
   if(!next.done)await queue.yield();
  }
  return next.value;
 }finally{queue.close();}
}
/** Immutable packaged content is process shared, never learner/owner state.
 * Consumers cancel their own callback; one unmount cannot cancel another wait.
 * No prefix, empty placeholder or unverified count is published as ready. */
export function prepareVocabularyCatalog(retry=false):Promise<VocabularyCatalogSnapshot>{
 if(complete)return Promise.resolve(complete);
 if(pending)return pending;
 if(failure&&!retry)return Promise.reject(failure);
 failure=null;const token=++generation;
 const task=(async()=>{
  // Allow the caller's preparation view to paint before loading heavy modules.
  await yieldTask();
  const {vocabularyCatalogSteps}=await import('./vocabulary-content-admission');
  const result=await runVocabularyCatalogSteps(vocabularyCatalogSteps());
  const status=result.FULL4109_CATALOG_STATUS;
  if(result.FULL4109_CURRENT_MODE&&(!status.configured||!status.partitionValid||status.rejectedCount!==0))throw Error('词表完整核验未通过，原有记录保留。');
  if(token!==generation)throw new VocabularyCatalogPendingError();
  complete=Object.freeze(result);return complete;
 })();
 pending=task;
 void task.then(()=>{if(token===generation)pending=null;},error=>{if(token===generation){pending=null;failure=error;}});
 return task;
}
