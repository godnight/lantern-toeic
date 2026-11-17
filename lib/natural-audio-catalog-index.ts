import {completeNaturalAudioCatalogSynchronously} from './natural-audio-catalog-admission';
import {installServerNaturalAudioCatalog,readPreparedNaturalAudioCatalog} from './prepare-natural-audio-catalog';
import {canonicalHash,canonicalJson} from './domain-command';
import type {AdmissionWordBinding,CompiledWordAudioException} from './natural-audio-admission';

export type NaturalAudioPackDescriptor={
  packId:string;manifestSha256:string;manifestPath:string;manifestFileSha256:string;manifestBytes:number;
  admissionPath:string;admissionFileSha256:string;admissionBytes:number;clipCount:number;declaredBytes:number;memberCount:number;
};
/** No clip/provenance bodies are loaded by the locator. Multiple roles may share an asset key. */
export type NaturalAudioRouteTuple=[packOrdinal:number,selectorSha256:string,textSha256:string,encodedSha256:string,cacheKey:string,contextHash:string,pairKey:string,legacySourceId?:string];
export type NaturalAudioCatalogIndex={schemaVersion:1;catalogId:string;basePackId:string;packs:NaturalAudioPackDescriptor[];
  routes:Record<string,NaturalAudioRouteTuple[]>;bindings:Record<string,number>;wordExceptions:CompiledWordAudioException[];blockedAssetSha256?:string[];blockedContexts?:[string,string][]};
const immutableBindingDigests=new WeakMap<object,string>();
function frozenStringFields(value:object,keys:readonly string[]):boolean{
 return Object.isFrozen(value)&&keys.every(key=>{const field=Object.getOwnPropertyDescriptor(value,key);return !!field&&'value'in field&&typeof field.value==='string';});
}
function immutableBinding(binding:AdmissionWordBinding):boolean{
 const audio=Object.getOwnPropertyDescriptor(binding,'audio');
 return frozenStringFields(binding,['wordId','slot','textSha256','snapshotContextSha256','requestContextHash','mp3Sha256'])&&
  !!audio&&'value'in audio&&!!audio.value&&typeof audio.value==='object'&&frozenStringFields(audio.value,['audioKey','materialId','segmentId','voiceProfileId']);
}
export function naturalAudioBindingDigest(binding:AdmissionWordBinding):string{
  const known=immutableBindingDigests.get(binding);if(known!==undefined)return known;
  const digest=canonicalHash(canonicalJson({wordId:binding.wordId,slot:binding.slot,textSha256:binding.textSha256,snapshotContextSha256:binding.snapshotContextSha256,
    requestContextHash:binding.requestContextHash??null,mp3Sha256:binding.mp3Sha256??null,
    audio:{audioKey:binding.audio.audioKey,materialId:binding.audio.materialId,segmentId:binding.audio.segmentId,voiceProfileId:binding.audio.voiceProfileId}}));
  // Accessors, mutable rows and shallow-frozen rows always take the full path.
  if(immutableBinding(binding))immutableBindingDigests.set(binding,digest);
  return digest;
}
export function naturalAudioSelectorDigest(textSha256:string,assetKey:string,materialId:string,segmentId:string,voiceProfileId:string,contextHash:string):string{
  return canonicalHash(canonicalJson({assetKey,materialId,segmentId,voiceProfileId,contextHash,textSha256}));
}
// A missed browser preparation gate must fail visibly, never impersonate a
// missing route and fall through to a different audio source.
const compiledResult=typeof window==='undefined'?installServerNaturalAudioCatalog(completeNaturalAudioCatalogSynchronously):readPreparedNaturalAudioCatalog();
/** This is the only authority: imported at compilation, detached and immutable. */
export const compiledNaturalAudioCatalog=compiledResult.index;
export const compiledNaturalAudioCatalogError=compiledResult.error;
export const compiledNaturalAudioPack=(packId:string)=>compiledNaturalAudioCatalog?.packs.find(p=>p.packId===packId)??null;
export function compiledIndexedBindingAdmission(packId:string,binding:AdmissionWordBinding):boolean{
  const index=compiledNaturalAudioCatalog;if(!index)return false;
  try{const ordinal=index.bindings[naturalAudioBindingDigest(binding)];return ordinal!==undefined&&index.packs[ordinal]?.packId===packId;}catch{return false;}
}
