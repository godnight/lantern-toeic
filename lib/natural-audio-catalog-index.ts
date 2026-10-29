import compiled from '../content/natural-audio-catalog-v1.json';
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
const NATURAL_AUDIO_CATALOG_MAX_BYTES=5*1024*1024;
const sha=/^[a-f0-9]{64}$/;
const frozen=<T>(value:T):T=>{if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;};
const validPath=(value:string)=>/^\/audio\/natural\/[a-z0-9-]+\/[a-zA-Z0-9._-]+\.json$/.test(value)&&!value.includes('..');
const integer=(n:unknown,min:number,max:number)=>Number.isSafeInteger(n)&&Number(n)>=min&&Number(n)<=max;
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
function readCompiled():{index:Readonly<NaturalAudioCatalogIndex>|null;error:string|null}{
  try{
    const source=JSON.stringify(compiled);
    if(new TextEncoder().encode(source).byteLength>NATURAL_AUDIO_CATALOG_MAX_BYTES)throw Error('自然音频定位索引超过5MiB。');
    const value=JSON.parse(source) as NaturalAudioCatalogIndex;
    if(value.schemaVersion!==1||!value.catalogId||!Array.isArray(value.packs)||value.packs.length>64||!value.packs.length||!value.routes||!value.bindings||!Array.isArray(value.wordExceptions))throw Error('自然音频定位索引格式不正确。');
    const seen=new Set<string>();
    for(const p of value.packs){
      const base=p.packId===value.basePackId;
      if(seen.has(p.packId)||!/^v040-natural-[a-f0-9]{12}$/.test(p.packId)||!sha.test(p.manifestSha256)||p.packId!=='v040-natural-'+p.manifestSha256.slice(0,12)||!validPath(p.manifestPath)||!validPath(p.admissionPath)||!sha.test(p.manifestFileSha256)||!sha.test(p.admissionFileSha256)||!integer(p.manifestBytes,1,16*1024*1024)||!integer(p.admissionBytes,1,16*1024*1024)||!integer(p.clipCount,1,base?4096:512)||!integer(p.declaredBytes,1,base?64*1024*1024:16*1024*1024)||!integer(p.memberCount,1,base?4096:256))throw Error('自然音频分包描述超限或身份不正确。');
      seen.add(p.packId);
    }
    if(!seen.has(value.basePackId))throw Error('自然音频定位索引缺少原包。');
    for(const [key,rows]of Object.entries(value.routes)){
      if(!key||key.length>256||!Array.isArray(rows)||!rows.length||rows.length>64)throw Error('自然音频定位键无效。');
      const identities=new Set<string>();
      for(const r of rows){
        if(!Array.isArray(r)||(r.length!==7&&r.length!==8)||!integer(r[0],0,value.packs.length-1)||![r[1],r[2],r[3],r[4],r[5]].every(v=>typeof v==='string'&&sha.test(v))||typeof r[6]!=='string'||!r[6]||r[6].length>256||(r[7]!==undefined&&!/^natural:v040-(?:kokoro|natural)-[a-f0-9]{12}:[a-f0-9]{64}:[a-f0-9]{64}$/.test(r[7]))||r[7]!==undefined&&!r[7].endsWith(':'+r[4]+':'+r[3]))throw Error('自然音频定位行无效。');
        if(identities.has(r[1]))throw Error('自然音频定位角色重复。');identities.add(r[1]);
      }
    }
    if(value.blockedAssetSha256&&(!Array.isArray(value.blockedAssetSha256)||!value.blockedAssetSha256.every(v=>sha.test(v))))throw Error('自然音频隔离哈希无效。');
    if(value.blockedContexts&&(!Array.isArray(value.blockedContexts)||!value.blockedContexts.every(r=>Array.isArray(r)&&r.length===2&&typeof r[0]==='string'&&sha.test(r[1]))))throw Error('自然音频隔离语境无效。');
    for(const [digest,ordinal]of Object.entries(value.bindings))if(!sha.test(digest)||!integer(ordinal,0,value.packs.length-1))throw Error('自然音频词卡资格无效。');
    return{index:frozen(value),error:null};
  }catch(error){return{index:null,error:error instanceof Error?error.message:'自然音频定位索引不可用。'};}
}
const compiledResult=readCompiled();
/** This is the only authority: imported at compilation, detached and immutable. */
export const compiledNaturalAudioCatalog=compiledResult.index;
export const compiledNaturalAudioCatalogError=compiledResult.error;
export const compiledNaturalAudioPack=(packId:string)=>compiledNaturalAudioCatalog?.packs.find(p=>p.packId===packId)??null;
export function compiledIndexedBindingAdmission(packId:string,binding:AdmissionWordBinding):boolean{
  const index=compiledNaturalAudioCatalog;if(!index)return false;
  try{const ordinal=index.bindings[naturalAudioBindingDigest(binding)];return ordinal!==undefined&&index.packs[ordinal]?.packId===packId;}catch{return false;}
}
