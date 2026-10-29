import compiled from '../content/natural-audio-catalog-v1.json';
import type {NaturalAudioCatalogIndex} from './natural-audio-catalog-index';
import type {NaturalAudioCatalogResult} from './prepare-natural-audio-catalog';
const NATURAL_AUDIO_CATALOG_MAX_BYTES=5*1024*1024;
const sha=/^[a-f0-9]{64}$/;
const validPath=(value:string)=>/^\/audio\/natural\/[a-z0-9-]+\/[a-zA-Z0-9._-]+\.json$/.test(value)&&!value.includes('..');
const integer=(n:unknown,min:number,max:number)=>Number.isSafeInteger(n)&&Number(n)>=min&&Number(n)<=max;
function* freezeSteps(value:unknown):Generator<void,void,void>{
 if(value&&typeof value==='object'){
  for(const child of Object.values(value)){yield;yield* freezeSteps(child);}
  Object.freeze(value);
 }
}
/** Capture before returning the first schedulable step. No later read can
 * observe mutation of the imported or caller-supplied object. */
export function naturalAudioCatalogSteps(input:unknown=compiled):Generator<void,Readonly<NaturalAudioCatalogIndex>,void>{
 const source=JSON.stringify(input);
 return validateSteps(source);
}
function* validateSteps(source:string):Generator<void,Readonly<NaturalAudioCatalogIndex>,void>{
 yield;
 if(new TextEncoder().encode(source).byteLength>NATURAL_AUDIO_CATALOG_MAX_BYTES)throw Error('自然音频定位索引超过5MiB。');
 yield;
 const value=JSON.parse(source) as NaturalAudioCatalogIndex;
 yield;
    if(value.schemaVersion!==1||!value.catalogId||!Array.isArray(value.packs)||value.packs.length>64||!value.packs.length||!value.routes||!value.bindings||!Array.isArray(value.wordExceptions))throw Error('自然音频定位索引格式不正确。');
    const seen=new Set<string>();
    for(const p of value.packs){
      yield;
      const base=p.packId===value.basePackId;
      if(seen.has(p.packId)||!/^v040-natural-[a-f0-9]{12}$/.test(p.packId)||!sha.test(p.manifestSha256)||p.packId!=='v040-natural-'+p.manifestSha256.slice(0,12)||!validPath(p.manifestPath)||!validPath(p.admissionPath)||!sha.test(p.manifestFileSha256)||!sha.test(p.admissionFileSha256)||!integer(p.manifestBytes,1,16*1024*1024)||!integer(p.admissionBytes,1,16*1024*1024)||!integer(p.clipCount,1,base?4096:512)||!integer(p.declaredBytes,1,base?64*1024*1024:16*1024*1024)||!integer(p.memberCount,1,base?4096:256))throw Error('自然音频分包描述超限或身份不正确。');
      seen.add(p.packId);
    }
    if(!seen.has(value.basePackId))throw Error('自然音频定位索引缺少原包。');
    for(const [key,rows]of Object.entries(value.routes)){
      yield;
      if(!key||key.length>256||!Array.isArray(rows)||!rows.length||rows.length>64)throw Error('自然音频定位键无效。');
      const identities=new Set<string>();
      for(const r of rows){
        yield;
        if(!Array.isArray(r)||(r.length!==7&&r.length!==8)||!integer(r[0],0,value.packs.length-1)||![r[1],r[2],r[3],r[4],r[5]].every(v=>typeof v==='string'&&sha.test(v))||typeof r[6]!=='string'||!r[6]||r[6].length>256||(r[7]!==undefined&&!/^natural:v040-(?:kokoro|natural)-[a-f0-9]{12}:[a-f0-9]{64}:[a-f0-9]{64}$/.test(r[7]))||r[7]!==undefined&&!r[7].endsWith(':'+r[4]+':'+r[3]))throw Error('自然音频定位行无效。');
        if(identities.has(r[1]))throw Error('自然音频定位角色重复。');identities.add(r[1]);
      }
    }
    if(value.blockedAssetSha256){
      if(!Array.isArray(value.blockedAssetSha256))throw Error('自然音频隔离哈希无效。');
      for(const hash of value.blockedAssetSha256){yield;if(!sha.test(hash))throw Error('自然音频隔离哈希无效。');}
    }
    if(value.blockedContexts){
      if(!Array.isArray(value.blockedContexts))throw Error('自然音频隔离语境无效。');
      for(const r of value.blockedContexts){yield;if(!Array.isArray(r)||r.length!==2||typeof r[0]!=='string'||!sha.test(r[1]))throw Error('自然音频隔离语境无效。');}
    }
    for(const [digest,ordinal]of Object.entries(value.bindings)){
      yield;if(!sha.test(digest)||!integer(ordinal,0,value.packs.length-1))throw Error('自然音频词卡资格无效。');
    }
    yield* freezeSteps(value);
    return value;
}
export function completeNaturalAudioCatalogSynchronously():NaturalAudioCatalogResult{
 try{
  const steps=naturalAudioCatalogSteps();let next=steps.next();while(!next.done)next=steps.next();
  return {index:next.value,error:null};
 }catch(error){return {index:null,error:error instanceof Error?error.message:'自然音频定位索引不可用。'};}
}
