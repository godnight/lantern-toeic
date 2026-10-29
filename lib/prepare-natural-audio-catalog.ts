import {runCooperativeSteps} from './cooperative-task';
import type {NaturalAudioCatalogIndex} from './natural-audio-catalog-index';

export type NaturalAudioCatalogResult={index:Readonly<NaturalAudioCatalogIndex>|null;error:string|null};
let complete:NaturalAudioCatalogResult|null=null;
let pending:Promise<NaturalAudioCatalogResult>|null=null;
let failure:unknown=null;
export class NaturalAudioCatalogPendingError extends Error{constructor(){super('自然音频目录仍在核验。');}}
export function readPreparedNaturalAudioCatalog():NaturalAudioCatalogResult{
 if(!complete)throw new NaturalAudioCatalogPendingError();return complete;
}
export function installServerNaturalAudioCatalog(create:()=>NaturalAudioCatalogResult):NaturalAudioCatalogResult{
 if(typeof window!=='undefined')return readPreparedNaturalAudioCatalog();
 return complete??=Object.freeze(create());
}
/** Only a completely checked, detached locator is visible to synchronous
 * consumers. Pending is never an empty directory or an absent resource. */
export function prepareNaturalAudioCatalog(retry=false):Promise<NaturalAudioCatalogResult>{
 if(complete)return Promise.resolve(complete);
 if(pending)return pending;
 if(failure&&!retry)return Promise.reject(failure);
 failure=null;
 const task=(async()=>{
  const {naturalAudioCatalogSteps}=await import('./natural-audio-catalog-admission');
  const index=await runCooperativeSteps(naturalAudioCatalogSteps());
  return complete=Object.freeze({index,error:null});
 })();
 pending=task;
 void task.then(()=>{pending=null;},error=>{pending=null;failure=error;});
 return task;
}
