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
  preparationMark('listening150-start');
  const input=import('./listening150-package-admission').then(module=>{const snapshot=module.captureCompiledListening150Package();preparationMark('listening150-input-ready');return snapshot;});
  const [snapshot]=await Promise.all([input,prepareNaturalAudioCatalog(retry)]);
  const {admitListening150PackageSteps}=await import('./listening150-catalog');
  preparationMark('listening150-validation-start');
  const result=await runCooperativeSteps(admitListening150PackageSteps(snapshot.input,snapshot.pins));
  complete=result;preparationMark('listening150-ready');return result;
 })();
 pending=task;
 void task.then(()=>{pending=null;},error=>{pending=null;failure=error;});
 return task;
}
