import {canonicalHash,canonicalJson} from './domain-command';
import type {Question} from './study-model';

export type TrainingStep='answer'|'explain'|'dictation'|'listen'|'vocab';
export type TrainingAudio={trackId:string;sourceId:string;kind:'bundled'|'tts';capability:'time'|'sentence';positionSeconds:number;rate:number};
export type MaterialTraining={unitId:string;materialHash:string;step:TrainingStep;dictationDraft:string;checkedDraft:string|null;dictationSkipped:boolean;listeningStatus:'pending'|'in-progress'|'confirmed'|'skipped';audio:TrainingAudio|null};
export type PracticeTraining={viewIndex:number;materials:MaterialTraining[]};
export type TrainingWrite={operationId:string;occurredAt:string;expectedHash:string;training:PracticeTraining};
export const practiceUnitId=(q:Question)=>q.groupId?`group:${q.part}:${q.groupId}`:`question:${q.id}`;
export const trainingHash=(value:PracticeTraining)=>canonicalHash(canonicalJson(value));
export type TrainingConflict={path:string;local:unknown;remote:unknown};
/** Three-way field merge: another material/field is never overwritten by a stale whole snapshot. */
export function mergePracticeTraining(base:PracticeTraining,local:PracticeTraining,remote:PracticeTraining){
 const conflicts:TrainingConflict[]=[],same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
 const choose=(path:string,b:unknown,l:unknown,r:unknown)=>{if(same(l,b))return structuredClone(r);if(!same(r,b)&&!same(l,r))conflicts.push({path,local:structuredClone(l),remote:structuredClone(r)});return structuredClone(l);};
 const training:PracticeTraining={viewIndex:choose('查看题号',base.viewIndex,local.viewIndex,remote.viewIndex) as number,materials:remote.materials.map(r=>{
  const b=base.materials.find(m=>m.unitId===r.unitId&&m.materialHash===r.materialHash),l=local.materials.find(m=>m.unitId===r.unitId&&m.materialHash===r.materialHash);if(!b||!l)return structuredClone(r);
  const value=structuredClone(r),labels:Record<string,string>={step:'训练步骤',listeningStatus:'回听状态',audio:'音频定位'};
  for(const key of ['step','listeningStatus','audio'] as const)(value as unknown as Record<string,unknown>)[key]=choose(r.unitId+' · '+labels[key],b[key],l[key],r[key]);
  const dictation=(m:MaterialTraining)=>({dictationDraft:m.dictationDraft,checkedDraft:m.checkedDraft,dictationSkipped:m.dictationSkipped});
  Object.assign(value,choose(r.unitId+' · 听写内容与核对状态',dictation(b),dictation(l),dictation(r)));
  return value;
 })};return {training,conflicts};
}
export const trainingText=(q:Question)=>q.transcript||q.audioText||'';
export function materialHash(q:Question){return canonicalHash(canonicalJson({rules:'sentence-v1/normalize-v1',unitId:practiceUnitId(q),transcript:trainingText(q),audioText:q.audioText||''}));}
export function initialPracticeTraining(queue:readonly Question[],cursor:number):PracticeTraining {
 const seen=new Set<string>();return {viewIndex:cursor,materials:queue.filter(q=>{const id=practiceUnitId(q)+':'+materialHash(q);if(seen.has(id))return false;seen.add(id);return true;}).map(q=>({unitId:practiceUnitId(q),materialHash:materialHash(q),step:'answer',dictationDraft:'',checkedDraft:null,dictationSkipped:false,listeningStatus:'pending',audio:null}))};
}
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function strict(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).some(k=>!keys.includes(k)))throw Error('practice-training-schema');}
/** Validate without normalizing: restored receipts must retain their original canonical bytes. */
export function validatePracticeTraining(value:unknown,unitIds:readonly string[],questionIds:readonly string[],cursor:number,applied:readonly boolean[],queue?:readonly Question[]):asserts value is PracticeTraining {
 if(!plain(value))throw Error('practice-training-corrupt');strict(value,['viewIndex','materials']);
 if(!Number.isInteger(value.viewIndex)||Number(value.viewIndex)<0||Number(value.viewIndex)>cursor||!Array.isArray(value.materials)||value.materials.length<unitIds.length||value.materials.length>questionIds.length)throw Error('practice-training-corrupt');
 if(queue&&value.materials.length!==initialPracticeTraining(queue,cursor).materials.length)throw Error('practice-training-corrupt');
 if(!unitIds.every(id=>(value.materials as unknown[]).some(item=>plain(item)&&item.unitId===id)))throw Error('practice-training-material-missing');
 const seenMaterials=new Set<string>();
 for(let i=0;i<value.materials.length;i++){
  const item=value.materials[i];if(!plain(item))throw Error('practice-training-corrupt');strict(item,['unitId','materialHash','step','dictationDraft','checkedDraft','dictationSkipped','listeningStatus','audio']);
  if(!unitIds.includes(String(item.unitId))||typeof item.materialHash!=='string'||!/^[a-f0-9]{64}$/.test(item.materialHash)||!['answer','explain','dictation','listen','vocab'].includes(String(item.step))||typeof item.dictationDraft!=='string'||item.dictationDraft.length>8000||(item.checkedDraft!==null&&(typeof item.checkedDraft!=='string'||!item.checkedDraft.trim()||item.checkedDraft!==item.dictationDraft))||typeof item.dictationSkipped!=='boolean'||item.checkedDraft!==null&&item.dictationSkipped||!['pending','in-progress','confirmed','skipped'].includes(String(item.listeningStatus)))throw Error('practice-training-corrupt');
  const key=String(item.unitId)+':'+String(item.materialHash);if(seenMaterials.has(key))throw Error('practice-training-duplicate');seenMaterials.add(key);
  if(queue){const source=queue.find(q=>practiceUnitId(q)===item.unitId&&materialHash(q)===item.materialHash);if(!source||materialHash(source)!==item.materialHash)throw Error('practice-training-material-changed');
   const unlocked=queue.some((q,index)=>practiceUnitId(q)===item.unitId&&materialHash(q)===item.materialHash&&applied[index]);
   if(!unlocked&&(item.step!=='answer'||item.dictationDraft!==''||item.checkedDraft!==null||item.dictationSkipped||item.listeningStatus!=='pending'))throw Error('practice-training-locked');
  }
  if(item.audio!==null){const a=item.audio;if(!plain(a))throw Error('practice-audio-corrupt');strict(a,['trackId','sourceId','kind','capability','positionSeconds','rate']);
   if(typeof a.trackId!=='string'||!(/^(question|sentence:\d{1,3}|prompt:[A-Za-z0-9_-]{1,120})$/).test(a.trackId)||typeof a.sourceId!=='string'||a.sourceId.length<1||a.sourceId.length>300||(a.kind==='tts'?!/^tts:[a-f0-9]{64}$/.test(a.sourceId):!(/^bundled:[a-f0-9]{20}\.mp3:([a-f0-9]{64}|[a-f0-9]{20}\.mp3)$/.test(a.sourceId)||/^natural:v040-(?:kokoro|natural)-[a-f0-9]{12}:[a-f0-9]{64}:[a-f0-9]{64}$/.test(a.sourceId)))||!['bundled','tts'].includes(String(a.kind))||a.capability!==(a.kind==='tts'?'sentence':'time')||typeof a.positionSeconds!=='number'||!Number.isFinite(a.positionSeconds)||a.positionSeconds<0||a.positionSeconds>21600||![0.7,0.85,1,1.15].includes(Number(a.rate))||a.kind==='tts'&&a.positionSeconds!==0)throw Error('practice-audio-corrupt');
   if(a.trackId.startsWith('prompt:')&&!queue)throw Error('practice-audio-track-unverified');
   if(queue){
    if(a.trackId.startsWith('prompt:')){
     const qid=a.trackId.slice(7),index=queue.findIndex(q=>q.id===qid&&practiceUnitId(q)===item.unitId&&materialHash(q)===item.materialHash);
     if(index<0||index>cursor||!questionIds.includes(qid))throw Error('practice-audio-track-missing');
    }else{
     if(a.trackId!=='question'&&!queue.some((q,index)=>practiceUnitId(q)===item.unitId&&materialHash(q)===item.materialHash&&applied[index]))throw Error('practice-training-audio-locked');
     const q=queue.find(q=>practiceUnitId(q)===item.unitId&&materialHash(q)===item.materialHash)!;const lines=trainingText(q).split(/(?<=[.!?])\s+/).filter(Boolean);
     if(a.trackId!=='question'&&Number(a.trackId.slice(9))>=lines.length)throw Error('practice-audio-track-missing');
    }
   }
  }
 }
 if(queue&&Number(value.viewIndex)<questionIds.length&&!applied[Number(value.viewIndex)]){const q=queue[Number(value.viewIndex)],item=value.materials.find(m=>m.unitId===practiceUnitId(q)&&m.materialHash===materialHash(q));if(item?.step!=='answer')throw Error('practice-training-locked');}
}
