import {runCooperativeSteps} from './cooperative-task';
import {prepareNaturalAudioCatalog} from './prepare-natural-audio-catalog';
import {preparationMark} from './preparation-timing';
import type {Listening150Admission} from './listening150-catalog';
let complete:Listening150Admission|null=null;
let pending:Promise<Listening150Admission>|null=null,failure:unknown=null;
export class Listening150PendingError extends Error{constructor(){super('听力题集仍在核验。');}}
export function readPreparedListening150Package(){if(!complete)throw new Listening150PendingError();return complete;}
export function installServerListening150Package(create:()=>Listening150Admission){
 if(typeof window!=='undefined')return readPreparedListening150Package();
 return complete??=create();
}
/** The complete source-r3 package and compiled routes remain the authority.
 * An in-progress or failed package is never exposed as an old/empty catalogue. */
export function prepareListening150Package(retry=false):Promise<Listening150Admission>{
 if(complete)return Promise.resolve(complete);
 if(pending)return pending;
 if(failure&&!retry)return Promise.reject(failure);
 failure=null;
 const task=(async()=>{
  await prepareNaturalAudioCatalog(retry);
  preparationMark('listening150-start');
  const {listening150PackageSteps}=await import('./listening150-package-admission');
  const result=await runCooperativeSteps(listening150PackageSteps());
  complete=result;preparationMark('listening150-ready');return result;
 })();
 pending=task;
 void task.then(()=>{pending=null;},error=>{pending=null;failure=error;});
 return task;
}
