import {canonicalHash} from './domain-command';
import {compiledNaturalAudioCatalog,compiledNaturalAudioPack,compiledIndexedBindingAdmission,naturalAudioBindingDigest} from './natural-audio-catalog-index';
export {compiledIndexedBindingAdmission,naturalAudioBindingDigest} from './natural-audio-catalog-index';
import compiled from '../content/natural-audio-admission-v2.json';

export type NaturalAudioAdmission = {
  clipId:string;cacheKey:string;encodedSha256:string;masterWavSha256:string;
  materialId:string;segmentId:string;contextHash:string;voiceProfileId:string;
  sense:'ordinary'|'cv-noun';textSha256:string;activationAssetKey?:string;
  engine:'kokoro'|'qwen'|'mixed';provenanceSha256:string;legacySourceId?:string;encodingObservationSha256?:string;
};
export type CompiledWordAudioException = {
  wordId:string;slot:'headword'|'example';textSha256:string;snapshotContextSha256:string;
  pos:string;meaning:string;example:string;translation:string;admission:NaturalAudioAdmission;
};
export type AdmissionTable={schemaVersion:1;packId:string;manifestSha256:string;entries:NaturalAudioAdmission[];wordExceptions:CompiledWordAudioException[]};
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
// This module is part of the compiled candidate. A manifest cannot supply or
// replace the ledger that authorizes its context/profile/encoded/master tuple.
const table=freeze(JSON.parse(JSON.stringify(compiled))) as AdmissionTable;
const lazyTables=new Map<string,{table:AdmissionTable;refs:number}>();
/** Pins are read from the compiled locator; callers cannot supply authority hashes. */
export function registerCompiledNaturalAudioAdmission(packId:string,bytes:Uint8Array):()=>void{
  const descriptor=compiledNaturalAudioPack(packId);
  if(!descriptor||packId===table.packId||bytes.byteLength!==descriptor.admissionBytes||canonicalHash(new TextDecoder('utf-8',{fatal:true}).decode(bytes))!==descriptor.admissionFileSha256)throw Error('自然音频准入文件与编译索引不一致。');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as AdmissionTable;
  if(value.schemaVersion!==1||value.packId!==packId||value.manifestSha256!==descriptor.manifestSha256||!Array.isArray(value.entries)||value.entries.length>4096||!Array.isArray(value.wordExceptions))throw Error('自然音频准入身份不一致。');
  const existing=lazyTables.get(packId);
  if(existing)existing.refs++;else lazyTables.set(packId,{table:freeze(value),refs:1});
  let released=false;return()=>{if(released)return;released=true;const current=lazyTables.get(packId);if(current&&!--current.refs)lazyTables.delete(packId);};
}
export const compiledNaturalAudioIdentity=()=>({packId:table.packId,manifestSha256:table.manifestSha256});
export function compiledNaturalAudioRows(packId:string,manifestSha256:string):readonly NaturalAudioAdmission[]{
  if(table.schemaVersion===1&&table.packId===packId&&table.manifestSha256===manifestSha256)return table.entries;
  const lazy=lazyTables.get(packId)?.table;return lazy?.manifestSha256===manifestSha256?lazy.entries:[];
}
export type AdmissionClip={id:string;cacheKey:string;sha256:string;sourceWavSha256:string;textSha256:string;voiceProfileId:string;engine?:string;provenanceSha256?:string;legacySourceId?:string;encodingObservationSha256?:string};
export type AdmissionReference={materialId:string;segmentId:string;contextHash?:string;activationAssetKey?:string};
const sameOptional=(a:string|undefined,b:string|undefined)=>a===b;
export function matchesNaturalAudioAdmission(row:NaturalAudioAdmission,clip:AdmissionClip,ref:AdmissionReference):boolean{
  return row.clipId===clip.id&&row.cacheKey===clip.cacheKey&&row.encodedSha256===clip.sha256&&row.masterWavSha256===clip.sourceWavSha256&&row.textSha256===clip.textSha256&&row.voiceProfileId===clip.voiceProfileId&&row.engine===clip.engine&&row.provenanceSha256===clip.provenanceSha256&&sameOptional(row.legacySourceId,clip.legacySourceId)&&sameOptional(row.encodingObservationSha256,clip.encodingObservationSha256)&&row.materialId===ref.materialId&&row.segmentId===ref.segmentId&&row.contextHash===ref.contextHash&&(row.activationAssetKey??row.cacheKey)===(ref.activationAssetKey??clip.cacheKey);
}
const immutableRowsByClip=new WeakMap<readonly NaturalAudioAdmission[],Map<string,NaturalAudioAdmission[]>>();
export function compiledNaturalAudioAdmission(packId:string,manifestSha256:string,clip:AdmissionClip,ref:AdmissionReference):NaturalAudioAdmission|null{
  const compiled=compiledNaturalAudioRows(packId,manifestSha256);
  let byClip=immutableRowsByClip.get(compiled);
  if(!byClip){byClip=new Map();for(const row of compiled){const rows=byClip.get(row.clipId);if(rows)rows.push(row);else byClip.set(row.clipId,[row]);}immutableRowsByClip.set(compiled,byClip);}
  const rows=(byClip.get(clip.id)??[]).filter(row=>matchesNaturalAudioAdmission(row,clip,ref));
  return rows.length===1?rows[0]:null;
}
export type AdmissionWordBinding={wordId:string;slot:string;textSha256:string;snapshotContextSha256:string;requestContextHash?:string;mp3Sha256?:string;audio:{audioKey:string;materialId:string;segmentId:string;voiceProfileId:string}};
const immutableBindingRows=new WeakMap<AdmissionTable,Map<string,NaturalAudioAdmission[]>>();
const bindingRowKey=(materialId:string,segmentId:string,voiceProfileId:string,textSha256:string,contextHash:string|undefined,encodedSha256:string|undefined)=>JSON.stringify([materialId,segmentId,voiceProfileId,textSha256,contextHash,encodedSha256]);
function bindingCandidates(table:AdmissionTable,binding:AdmissionWordBinding):NaturalAudioAdmission[]{
 let index=immutableBindingRows.get(table);
 if(!index){
  index=new Map();for(const row of table.entries){const key=bindingRowKey(row.materialId,row.segmentId,row.voiceProfileId,row.textSha256,row.contextHash,row.encodedSha256),rows=index.get(key);if(rows)rows.push(row);else index.set(key,[row]);}
  immutableBindingRows.set(table,index);
 }
 const audio=binding.audio;return index.get(bindingRowKey(audio.materialId,audio.segmentId,audio.voiceProfileId,binding.textSha256,binding.requestContextHash,binding.mp3Sha256))??[];
}
export function compiledBindingAdmission(packId:string,binding:AdmissionWordBinding):NaturalAudioAdmission|null{
  const selected=table.packId===packId?table:lazyTables.get(packId)?.table;if(!selected)return null;
  const audio=binding.audio;
  // Candidate indexing never replaces the exact match or duplicate rejection.
  const rows=bindingCandidates(selected,binding).filter(row=>[row.cacheKey,row.activationAssetKey,row.clipId].includes(audio.audioKey)&&row.materialId===audio.materialId&&row.segmentId===audio.segmentId&&row.voiceProfileId===audio.voiceProfileId&&row.textSha256===binding.textSha256&&row.contextHash===binding.requestContextHash&&row.encodedSha256===binding.mp3Sha256);
  return rows.length===1?rows[0]:null;
}
export function compiledCvWordException(packId:string,binding:AdmissionWordBinding,word?:{pos:string;meaning:string;example:string;translation:string}):boolean{
  const index=compiledNaturalAudioCatalog;
  const indexed=!!index&&compiledIndexedBindingAdmission(packId,binding);
  const admitted=compiledBindingAdmission(packId,binding);
  const rows=(indexed?index!.wordExceptions:table.wordExceptions).filter(row=>row.wordId===binding.wordId&&row.slot===binding.slot&&row.textSha256===binding.textSha256&&row.snapshotContextSha256===binding.snapshotContextSha256&&row.admission.sense==='cv-noun'&&row.admission.contextHash===binding.requestContextHash&&row.admission.encodedSha256===binding.mp3Sha256&&row.admission.voiceProfileId===binding.audio.voiceProfileId&&row.admission.materialId===binding.audio.materialId&&row.admission.segmentId===binding.audio.segmentId&&[row.admission.clipId,row.admission.cacheKey,row.admission.activationAssetKey].includes(binding.audio.audioKey)&&(!word||(['pos','meaning','example','translation'] as const).every(key=>row[key]===word[key])));
  if(rows.length!==1)return false;
  return indexed||!!admitted&&admitted.sense==='cv-noun'&&Object.keys(rows[0].admission).length===Object.keys(admitted).length&&Object.entries(admitted).every(([key,value])=>(rows[0].admission as unknown as Record<string,unknown>)[key]===value);
}
