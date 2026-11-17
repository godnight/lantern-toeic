import {mergePracticeTraining,trainingHash,type PracticeTraining,type TrainingWrite} from './practice-training';
import {createId} from './study-model';
import type {PracticeResult} from './practice-workflow';

type SaveState='saved'|'dirty'|'saving'|'error'|'unknown'|'conflict';
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
/** One writer per mounted session. An uncertain operation keeps its exact ID/payload on retry. */
export class PracticeTrainingDraft {
 value:PracticeTraining;confirmed:PracticeTraining;remote:PracticeTraining;status:SaveState='saved';reason='';
 private pending:TrainingWrite|null=null;private inFlight:Promise<boolean>|null=null;private closed=false;private confirmedRevision:number;private remoteRevision:number;
 private listeners=new Set<()=>void>();
 constructor(initial:PracticeTraining,private write:(value:TrainingWrite)=>Promise<PracticeResult>,private id=()=>createId(),private now=()=>new Date().toISOString(),revision=0,private canSave=()=>true) {this.value=copy(initial);this.confirmed=copy(initial);this.remote=copy(initial);this.confirmedRevision=revision;this.remoteRevision=revision;}
 get dirty(){return trainingHash(this.value)!==trainingHash(this.confirmed)||this.pending!==null;}
 get conflicts(){return mergePracticeTraining(this.confirmed,this.value,this.remote).conflicts;}
 subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 private notify(){if(!this.closed)for(const listener of this.listeners)listener();}
 edit(value:PracticeTraining){if(this.closed)return;this.value=copy(value);if(!['error','unknown','conflict'].includes(this.status))this.status=this.dirty?'dirty':'saved';this.notify();}
 sync(value:PracticeTraining,revision=0){if(revision<this.remoteRevision)return;const changed=trainingHash(value)!==trainingHash(this.remote)||revision!==this.remoteRevision;this.remote=copy(value);this.remoteRevision=revision;if(!this.dirty&&!this.inFlight){this.confirmed=copy(value);this.confirmedRevision=revision;this.value=copy(value);this.status='saved';if(changed)this.notify();}else if(changed&&this.status==='conflict')this.notify();}
 acceptRemote(){if(this.status!=='conflict'||this.inFlight)return;this.value=copy(this.remote);this.confirmed=copy(this.remote);this.confirmedRevision=this.remoteRevision;this.pending=null;this.status='saved';this.reason='';this.notify();}
 close(){this.closed=true;this.listeners.clear();}
 async flush(retryConflict=false,drain=true):Promise<boolean>{
  if(this.closed||!this.canSave())return false;
  if(this.status==='conflict'&&!retryConflict)return false;
  if(retryConflict&&this.status==='conflict'){this.value=mergePracticeTraining(this.confirmed,this.value,this.remote).training;this.confirmed=copy(this.remote);this.confirmedRevision=this.remoteRevision;this.pending=null;this.status=this.dirty?'dirty':'saved';this.reason='';this.notify();}
  if(!this.inFlight){if(!this.dirty)return true;this.inFlight=this.saveOnce().finally(()=>{this.inFlight=null;});}
  const ok=await this.inFlight;if(!ok||this.closed)return false;
  return drain&&this.dirty?this.flush(false,true):true;
 }
 private async saveOnce():Promise<boolean>{
  if(!this.pending)this.pending={operationId:this.id(),occurredAt:this.now(),expectedHash:trainingHash(this.confirmed),training:copy(this.value)};
  const operation=this.pending;this.status='saving';this.reason='';this.notify();
  let result:PracticeResult;
  try{result=await this.write(copy(operation));}catch(error){result={status:'unknown',sessionId:'',reason:error instanceof Error?error.message:'保存回应未确认'};}
  if(this.closed)return false;
  if(result.status==='updated'||result.status==='replayed'||result.status==='applied'){
   const revision=result.revision??this.confirmedRevision+1;
   this.confirmed=copy(operation.training);this.confirmedRevision=revision;this.pending=null;
   const savedHash=trainingHash(operation.training);
   if(this.remoteRevision>revision){
    if(trainingHash(this.value)===savedHash){this.confirmed=copy(this.remote);this.confirmedRevision=this.remoteRevision;this.value=copy(this.remote);this.status='saved';}
    else{this.status='conflict';this.reason='training-newer-remote';this.notify();return false;}
   }else{this.remote=copy(operation.training);this.remoteRevision=revision;this.status=this.dirty?'dirty':'saved';}
   this.notify();return true;
  }
  this.status=result.status==='unknown'?'unknown':result.status==='conflict'?'conflict':'error';this.reason='reason'in result?result.reason:'保存未确认';this.notify();return false;
 }
}
