import {compiledNaturalAudioAdmission,compiledNaturalAudioRows} from './natural-audio-admission';
import {compiledListening50PronunciationException} from './listening50-pronunciation-exception';
/** Verified, immutable offline media for a private local candidate.
 * Content review, acoustic review and publication approval remain separate.
 */
export type NaturalAudioReference = {materialId:string;segmentId:string;kind:string;contentReview:string;contextHash?:string;contentReleaseEligible?:boolean;activationAssetKey?:string};
export type NaturalAudioSelector={assetKey?:string;voiceProfileId?:string;materialId?:string;segmentId?:string;contextHash?:string;sense?:'ordinary'|'cv-noun';masterWavSha256?:string};
export type NaturalAudioEngine='kokoro'|'qwen'|'mixed';
export type NaturalAudioEncodingObservation={version:1;mode:'CBR'|'VBR';mpegVersion:2;layer:3;sampleRateHz:24000;channels:1;byteLength:number;frameCount:number;frameBitratesKbps:number[]};
export type NaturalAudioProvenance={segments:{requestId:string;materialId:string;segmentId:string;contextHash:string;contentVersion:string|null;engine:'kokoro'|'qwen';modelRevision:string;voiceProfileId:string;masterWavSha256:string;[key:string]:unknown}[];[key:string]:unknown};
export type NaturalAudioClip = {
  id:string;text:string;textSha256:string;cacheKey:string;sha256:string;bytes:number;
  durationSeconds:number;codec:'mp3';sampleRateHz:24000;channels:1;bitrateKbps:64|null;sourceWavSha256:string;
  bitrateMode?:'CBR'|'VBR';encodingObservation?:NaturalAudioEncodingObservation;encodingObservationSha256?:string;
  voiceProfileId:string;locale:string;references:NaturalAudioReference[];
  qualityStatus:'TECHNICAL_CANDIDATE';humanAccepted:false;publishAllowed:false;
  engine?:NaturalAudioEngine;provenance?:NaturalAudioProvenance;provenanceSha256?:string;legacySourceId?:string;
};
export type NaturalAudioManifest = {
  schemaVersion:1|2;packId:string;manifestSha256:string;status:'PRIVATE_LOCAL_CANDIDATE';
  engine:'kokoro'|'mixed';engineIdentity:Record<string,unknown>;generationConfig:Record<string,unknown>;
  voiceProfileId:string;locale:string;accentValidated:false;humanAccepted:false;publishAllowed:false;
  clips:NaturalAudioClip[];excluded:{textSha256:string;reason:string;text?:string}[];knownAssetSha256Hold:string[];
  sourceFiles:{path:string;sha256:string}[];
};
export type NaturalAudioState = Readonly<{phase:'idle'|'preparing'|'ready'|'error';packId:string|null;activePackId:string|null;verified:number;total:number;message:string}>;
type Fetcher=(input:string,init?:RequestInit)=>Promise<Response>;
type ActivateOptions={allowLocalCandidate?:boolean;fetcher?:Fetcher;cacheStorage?:CacheStorage|null;signal?:AbortSignal};
type PrepareOptions=NaturalAudioSelector&{fetcher?:Fetcher;cacheStorage?:CacheStorage|null;signal?:AbortSignal;createObjectURL?:(blob:Blob)=>string;revokeObjectURL?:(url:string)=>void};
export type NaturalAudioResource=NaturalAudioResolution&{release:()=>void;cacheHit:boolean;persisted:boolean;cacheWarning:string|null};
export type NaturalAudioResolution={url:string;sourceId:string;packId:string;clip:NaturalAudioClip;label:string};
const HEX=/^[a-f0-9]{64}$/;
// Cross-spelling CV pronunciation HOLD: a changed hash/profile must not bypass it.
const holdText=(text:string)=>text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
const semanticPronunciationHold=(text:string)=>/\b(?:cupboard|resume)\b/i.test(holdText(text))||/^\s*use\s*$/i.test(holdText(text));
const cvNounHoldOnly=(text:string)=>/\bresume\b/i.test(holdText(text))&&!/\bcupboard\b/i.test(holdText(text))&&!/^\s*use\s*$/i.test(holdText(text));
const MAX_CLIP_BYTES=8*1024*1024,MAX_PACK_BYTES=64*1024*1024;
const cacheName=(id:string)=>'lantern-natural-audio-v1-'+id;
const clipUrl=(id:string,sha:string)=>'/audio/natural/'+id+'/'+sha+'.mp3';
const stable=(value:unknown):string=>{
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable((value as Record<string,unknown>)[key])).join(',')+'}';
};
export async function naturalAudioSha256(bytes:Uint8Array):Promise<string>{
  if(!globalThis.crypto?.subtle)throw Error('当前环境无法校验离线音频，原音频保留。');
  const input=new Uint8Array(bytes.length);input.set(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',input))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
const freezeManifest=<T>(value:T):T=>{if(value&&typeof value==='object'){Object.values(value).forEach(freezeManifest);Object.freeze(value);}return value;};
function isCvClipAdmitted(pack:NaturalAudioManifest,clip:NaturalAudioClip){
  return pack.schemaVersion===2&&cvNounHoldOnly(clip.text)&&clip.references.every(ref=>compiledNaturalAudioAdmission(pack.packId,pack.manifestSha256,clip,ref)?.sense==='cv-noun');
}
function validateProvenance(clip:NaturalAudioClip){
  const rows=clip.provenance?.segments;
  if(!['kokoro','qwen','mixed'].includes(String(clip.engine))||!HEX.test(clip.provenanceSha256??'')||!rows||!Array.isArray(rows)||!rows.length||rows.length>1000)throw Error('自然音频实际引擎或来源无效。');
  for(const row of rows)if(!row||!['kokoro','qwen'].includes(row.engine)||typeof row.requestId!=='string'||!row.requestId||typeof row.materialId!=='string'||!row.materialId||typeof row.segmentId!=='string'||!row.segmentId||!HEX.test(row.contextHash)||row.contentVersion!==null&&(typeof row.contentVersion!=='string'||!row.contentVersion)||!/^[a-f0-9]{40}$/.test(row.modelRevision)||typeof row.voiceProfileId!=='string'||!row.voiceProfileId||!HEX.test(row.masterWavSha256))throw Error('自然音频实际引擎或来源无效。');
  const engines=[...new Set(rows.map(row=>row.engine))];
  if(clip.engine!==(engines.length===1?engines[0]:'mixed'))throw Error('自然音频实际引擎与来源不一致。');
}
const MPEG2_LAYER3_BITRATES=[8,16,24,32,40,48,56,64,80,96,112,128,144,160];
const ENCODING_KEYS=['version','mode','mpegVersion','layer','sampleRateHz','channels','byteLength','frameCount','frameBitratesKbps'].sort();
async function validateEncodingObservation(clip:NaturalAudioClip,schemaVersion:1|2){
  const present=['bitrateMode','encodingObservation','encodingObservationSha256'].some(key=>Object.prototype.hasOwnProperty.call(clip,key));
  if(!present){if(clip.bitrateKbps!==64)throw Error('自然音频编码声明无效。');return;}
  const proof=clip.encodingObservation;
  if(schemaVersion!==2||!proof||typeof proof!=='object'||Array.isArray(proof)||Object.keys(proof).sort().join(',')!==ENCODING_KEYS.join(',')||proof.version!==1||!['CBR','VBR'].includes(proof.mode)||proof.mpegVersion!==2||proof.layer!==3||proof.sampleRateHz!==24000||proof.channels!==1||proof.byteLength!==clip.bytes||!Number.isSafeInteger(proof.frameCount)||proof.frameCount<1||proof.frameCount>Math.floor(clip.bytes/24)||!Array.isArray(proof.frameBitratesKbps)||!proof.frameBitratesKbps.length||proof.frameBitratesKbps.length>14||proof.frameBitratesKbps.some((rate,index,rates)=>!MPEG2_LAYER3_BITRATES.includes(rate)||(index>0&&rate<=rates[index-1]))||clip.bitrateMode!==proof.mode||!HEX.test(clip.encodingObservationSha256??''))throw Error('自然音频编码观察无效。');
  if(proof.mode==='CBR'?(clip.bitrateKbps!==64||proof.frameBitratesKbps.length!==1||proof.frameBitratesKbps[0]!==64):(clip.bitrateKbps!==null||proof.frameBitratesKbps.length<2))throw Error('自然音频码率与实际观察不一致。');
  if(await naturalAudioSha256(new TextEncoder().encode(stable(proof)))!==clip.encodingObservationSha256)throw Error('自然音频编码观察摘要不一致。');
}
export async function validateNaturalAudioManifest(input:unknown,allowLocalCandidate=false):Promise<NaturalAudioManifest>{
  if(!allowLocalCandidate)throw Error('此音频包仅限已授权的本地候选，未获公开发布批准。');
  // Detach mutable caller objects before the first await.
  const pack=JSON.parse(JSON.stringify(input)) as NaturalAudioManifest;
  const versionValid=pack&&(pack.schemaVersion===1&&pack.engine==='kokoro'&&pack.packId==='v040-kokoro-'+pack.manifestSha256?.slice(0,12)||pack.schemaVersion===2&&pack.engine==='mixed'&&pack.packId==='v040-natural-'+pack.manifestSha256?.slice(0,12));
  if(!versionValid||pack.status!=='PRIVATE_LOCAL_CANDIDATE'||pack.publishAllowed!==false||pack.humanAccepted!==false||pack.accentValidated!==false||!HEX.test(pack.manifestSha256)||!Array.isArray(pack.clips)||!pack.clips.length||pack.clips.length>4096||!Array.isArray(pack.excluded)||!Array.isArray(pack.knownAssetSha256Hold)||!pack.knownAssetSha256Hold.every(hash=>HEX.test(hash))||!Array.isArray(pack.sourceFiles)||!pack.sourceFiles.every(row=>row&&typeof row.path==='string'&&HEX.test(row.sha256)))throw Error('自然音频包身份或状态无效。');
  const {packId:_,manifestSha256:__,...payload}=pack;
  if(await naturalAudioSha256(new TextEncoder().encode(stable(payload)))!==pack.manifestSha256)throw Error('自然音频清单校验失败，原音频保留。');
  if(pack.schemaVersion===2&&!compiledNaturalAudioRows(pack.packId,pack.manifestSha256).length)throw Error('自然音频缺少编译期精确准入表。');
  const ids=new Set<string>(),blocked=new Set(pack.knownAssetSha256Hold);let total=0;
  for(const clip of pack.clips){
    if(pack.schemaVersion===1&&['engine','provenance','provenanceSha256','legacySourceId'].some(key=>Object.prototype.hasOwnProperty.call(clip,key)))throw Error('旧版Kokoro音频包不能携带新版引擎或来源声明。');
    if(!clip||typeof clip.id!=='string'||!/^natural-[a-f0-9]{64}$/.test(clip.id)||clip.id!=='natural-'+clip.cacheKey||typeof clip.text!=='string'||!clip.text.trim()||clip.text.length>12000||!HEX.test(clip.textSha256)||!HEX.test(clip.sha256)||!HEX.test(clip.cacheKey)||clip.codec!=='mp3'||clip.sampleRateHz!==24000||clip.channels!==1||!HEX.test(clip.sourceWavSha256)||!Number.isSafeInteger(clip.bytes)||clip.bytes<64||clip.bytes>MAX_CLIP_BYTES||!Number.isFinite(clip.durationSeconds)||clip.durationSeconds<=0||clip.durationSeconds>600||typeof clip.voiceProfileId!=='string'||!clip.voiceProfileId||clip.voiceProfileId.length>160||!['en-US','en-GB'].includes(clip.locale)||clip.qualityStatus!=='TECHNICAL_CANDIDATE'||clip.humanAccepted!==false||clip.publishAllowed!==false||blocked.has(clip.sha256)||blocked.has(clip.sourceWavSha256)||!Array.isArray(clip.references)||!clip.references.length||clip.references.length>1000||!clip.references.every(ref=>ref&&typeof ref.materialId==='string'&&ref.materialId.length>0&&ref.materialId.length<=200&&typeof ref.segmentId==='string'&&ref.segmentId.length>0&&ref.segmentId.length<=100&&typeof ref.kind==='string'&&typeof ref.contentReview==='string'&&(ref.activationAssetKey===undefined||HEX.test(ref.activationAssetKey))))throw Error('自然音频条目无效或仍在疑点保留名单中。');
    await validateEncodingObservation(clip,pack.schemaVersion);
    if(pack.schemaVersion===2){
      validateProvenance(clip);
      if(await naturalAudioSha256(new TextEncoder().encode(stable(clip.provenance)))!==clip.provenanceSha256)throw Error('自然音频来源摘要不一致。');
      if(!clip.references.every(ref=>HEX.test(ref.contextHash??'')&&compiledNaturalAudioAdmission(pack.packId,pack.manifestSha256,clip,ref)))throw Error('自然音频条目未获编译期精确准入。');
      if(clip.legacySourceId!==undefined&&(!/^natural:v040-(?:kokoro|natural)-[a-f0-9]{12}:[a-f0-9]{64}:[a-f0-9]{64}$/.test(clip.legacySourceId)||!clip.legacySourceId.endsWith(':'+clip.cacheKey+':'+clip.sha256)))throw Error('自然音频旧定位身份无效。');
    }
    if(semanticPronunciationHold(clip.text)&&!isCvClipAdmitted(pack,clip)&&!clip.references.every(ref=>compiledListening50PronunciationException(pack,clip,ref)))throw Error('自然音频条目无效或仍在疑点保留名单中。');
    if(ids.has(clip.id))throw Error('自然音频包包含重复音频身份。');
    ids.add(clip.id);total+=clip.bytes;
    if(total>MAX_PACK_BYTES)throw Error('自然音频包超过本机校验容量。');
    if(await naturalAudioSha256(new TextEncoder().encode(clip.text))!==clip.textSha256)throw Error('自然音频文本与清单身份不一致。');
    if(pack.excluded.some(row=>row.textSha256===clip.textSha256)&&!(pack.schemaVersion===2&&clip.references.every(ref=>compiledNaturalAudioAdmission(pack.packId,pack.manifestSha256,clip,ref))))throw Error('疑点文本不得因更换音频文件而重新激活。');
  }
  return freezeManifest(pack);
}
async function readBounded(response:Response,expectedBytes:number):Promise<Uint8Array>{
  if(!response.ok||response.type==='opaque')throw Error('自然音频下载失败，原音频保留。');
  const length=response.headers.get('content-length');
  if(length!==null&&Number(length)!==expectedBytes)throw Error('自然音频字节长度不一致。');
  if(!response.body){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==expectedBytes)throw Error('自然音频文件不完整。');return bytes;}
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let count=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>expectedBytes||count>MAX_CLIP_BYTES){await reader.cancel();throw Error('自然音频文件超出声明长度。');}parts.push(value);}}
  finally{reader.releaseLock();}
  if(count!==expectedBytes)throw Error('自然音频文件不完整。');
  const bytes=new Uint8Array(count);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
function validateMp3(bytes:Uint8Array){
  const id3=bytes[0]===0x49&&bytes[1]===0x44&&bytes[2]===0x33;
  const frame=bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0;
  if(bytes.length<64||(!id3&&!frame))throw Error('自然音频容器无效。');
}
/** Byte-derived observation, not an encoder's requested bitrate setting. */
export function observeNaturalAudioMp3Encoding(bytes:Uint8Array):NaturalAudioEncodingObservation{
  const invalid=()=>Error('自然音频逐帧编码校验失败。');
  if(bytes.length<64||bytes.length>MAX_CLIP_BYTES)throw invalid();
  let start=0,end=bytes.length;
  if(bytes[0]===0x49&&bytes[1]===0x44&&bytes[2]===0x33){
    if(bytes.length<10||![2,3,4].includes(bytes[3])||bytes[4]===0xff||bytes.slice(6,10).some(byte=>byte>0x7f))throw invalid();
    const version=bytes[3],flags=bytes[5],allowed=version===2?0xc0:version===3?0xe0:0xf0;
    if(flags&~allowed)throw invalid();
    const size=bytes[6]*2097152+bytes[7]*16384+bytes[8]*128+bytes[9],footer=version===4&&(flags&0x10)!==0;
    start=10+size+(footer?10:0);
    if(start>end)throw invalid();
    if(footer){const at=start-10;if(bytes[at]!==0x33||bytes[at+1]!==0x44||bytes[at+2]!==0x49||!bytes.slice(3,10).every((byte,index)=>bytes[at+3+index]===byte))throw invalid();}
  }
  if(end-start>=128&&bytes[end-128]===0x54&&bytes[end-127]===0x41&&bytes[end-126]===0x47)end-=128;
  let offset=start,frames=0;const rates=new Set<number>();
  while(offset<end){
    if(end-offset<4||bytes[offset]!==0xff||(bytes[offset+1]&0xe0)!==0xe0||((bytes[offset+1]>>3)&3)!==2||((bytes[offset+1]>>1)&3)!==1||((bytes[offset+2]>>2)&3)!==1||(bytes[offset+3]>>6)!==3||(bytes[offset+3]&3)===2)throw invalid();
    const rateIndex=bytes[offset+2]>>4;
    if(rateIndex===0||rateIndex===15)throw invalid();
    const rate=MPEG2_LAYER3_BITRATES[rateIndex-1],length=Math.floor(72000*rate/24000)+((bytes[offset+2]>>1)&1);
    if(length<4||offset+length>end)throw invalid();
    rates.add(rate);frames++;offset+=length;
  }
  if(offset!==end||frames===0)throw invalid();
  const frameBitratesKbps=[...rates].sort((a,b)=>a-b);
  return {version:1,mode:frameBitratesKbps.length===1?'CBR':'VBR',mpegVersion:2,layer:3,sampleRateHz:24000,channels:1,byteLength:bytes.length,frameCount:frames,frameBitratesKbps};
}
export class NaturalAudioRegistry{
  private generation=0;
  private active:NaturallyActive|null=null;
  private listeners=new Set<()=>void>();
  private verifiedSources=new Set<string>();
  private state:NaturalAudioState={phase:'idle',packId:null,activePackId:null,verified:0,total:0,message:'自然音频尚未准备。'};
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  getSnapshot=()=>this.state;
  private update(next:NaturalAudioState){this.state=Object.freeze(next);this.listeners.forEach(listener=>listener());}
  hasText(text:string){return !!this.active?.clips.has(text);}
  isBlocked(text:string){return !!this.active?.pack.excluded.some(row=>row.text===text)||semanticPronunciationHold(text);}
  resolve(text:string,options:NaturalAudioSelector={}):NaturalAudioResolution|null{
    const active=this.active;if(!active)return null;
    const semanticHeld=semanticPronunciationHold(text),explicit=!!(options.assetKey&&options.voiceProfileId&&options.materialId&&options.segmentId);
    if(semanticHeld&&!(explicit&&active.pack.schemaVersion===2))return null;
    if(active.pack.excluded.some(row=>row.text===text)&&!(explicit&&active.pack.schemaVersion===2))return null;
    let candidates=(active.clips.get(text)??[]).filter(clip=>{
      if(options.voiceProfileId&&clip.voiceProfileId!==options.voiceProfileId)return false;
      if(options.assetKey&&![clip.id,clip.cacheKey].includes(options.assetKey)&&!clip.references.some(ref=>ref.activationAssetKey===options.assetKey))return false;
      if((options.materialId||options.segmentId)&&!clip.references.some(ref=>(!options.materialId||ref.materialId===options.materialId)&&(!options.segmentId||ref.segmentId===options.segmentId)))return false;
      if(active.pack.schemaVersion===2&&!clip.references.some(ref=>{
        const admitted=compiledNaturalAudioAdmission(active.pack.packId,active.pack.manifestSha256,clip,ref);
        return admitted&&(!options.assetKey||[clip.id,clip.cacheKey,ref.activationAssetKey].includes(options.assetKey))&&(!options.materialId||ref.materialId===options.materialId)&&(!options.segmentId||ref.segmentId===options.segmentId)&&(!options.contextHash||admitted.contextHash===options.contextHash)&&(!options.sense||admitted.sense===options.sense)&&(!options.masterWavSha256||admitted.masterWavSha256===options.masterWavSha256)&&(!semanticHeld||admitted.sense==='cv-noun'&&cvNounHoldOnly(text)||compiledListening50PronunciationException(active.pack,clip,ref));
      }))return false;
      return true;
    });
    // Never overwrite a different role/voice/context by its plain display text.
    // An ambiguous call must supply the frozen asset or material+segment key.
    if(candidates.length>1&&!options.assetKey&&!options.voiceProfileId&&!options.materialId&&!options.segmentId){
      const existing=candidates.filter(clip=>clip.references.some(ref=>['existing-core','existing-listening','existing-listening-sentence'].includes(ref.kind)));
      if(existing.length===1)candidates=existing;
    }
    if(candidates.length!==1)return null;const clip=candidates[0];
    return {url:clipUrl(active.pack.packId,clip.sha256),sourceId:clip.legacySourceId??'natural:'+active.pack.packId+':'+clip.cacheKey+':'+clip.sha256,packId:active.pack.packId,clip,label:'自然语音'};
  }
  async prepare(text:string,options:PrepareOptions={}):Promise<NaturalAudioResource>{
    const active=this.active,resolved=this.resolve(text,options);
    if(!active||!resolved)throw Error('这段自然语音尚未准备。');
    const check=()=>{if(options.signal?.aborted||this.active!==active)throw Error('音频准备已取消或版本已变化。');};
    check();let cache:Cache|null=null,cacheWarning:string|null=null;
    const storage=options.cacheStorage===undefined?(typeof caches==='undefined'?null:caches):options.cacheStorage;
    if(storage)try{cache=await storage.open(cacheName(active.pack.packId));}catch{cacheWarning='音频缓存暂不可用，本次校验后仍可播放。';}
    check();let stored:Response|undefined;
    if(cache)try{stored=await cache.match(resolved.url);}catch{cacheWarning='音频缓存暂不可读，本次重新下载校验。';}
    check();
    let response:Response;
    try{response=stored??await (options.fetcher??((url,init)=>fetch(url,init)))(resolved.url,{cache:'no-store',credentials:'same-origin',signal:options.signal});}
    catch{check();throw Error('自然音频加载失败，请重试；原定位保留。');}
    const bytes=await readBounded(response,resolved.clip.bytes);check();validateMp3(bytes);
    if(await naturalAudioSha256(bytes)!==resolved.clip.sha256)throw Error('自然音频校验失败，原音频与学习定位保留。');
    check();
    if(resolved.clip.encodingObservation){
      const observed=observeNaturalAudioMp3Encoding(bytes);
      if(await naturalAudioSha256(new TextEncoder().encode(stable(observed)))!==resolved.clip.encodingObservationSha256)throw Error('自然音频文件与编码观察不一致。');
    }
    check();let persisted=!!stored;
    if(cache&&!stored)try{await cache.put(resolved.url,new Response(new Uint8Array(bytes),{headers:{'Content-Type':'audio/mpeg','Content-Length':String(bytes.length),'X-Lantern-Audio-Sha256':resolved.clip.sha256}}));persisted=true;}catch{cacheWarning='音频缓存空间不足，本次可播放；离线重听需重新准备。';}
    check();
    const make=options.createObjectURL??(blob=>URL.createObjectURL(blob)),revoke=options.revokeObjectURL??(url=>URL.revokeObjectURL(url));
    const url=make(new Blob([new Uint8Array(bytes)],{type:'audio/mpeg'}));let released=false;
    this.verifiedSources.add(resolved.sourceId);
    if(this.state.phase==='ready')this.update({...this.state,verified:this.verifiedSources.size});
    return {...resolved,url,cacheHit:!!stored,persisted,cacheWarning,release:()=>{if(!released){released=true;revoke(url);}}};
  }
  async activate(input:unknown,options:ActivateOptions={}):Promise<{status:'ready'|'failed'|'superseded';reason?:string}>{
    const token=++this.generation;let total=0,verified=0,id:string|null=null;
    const current=()=>token===this.generation&&!options.signal?.aborted;
    const assertCurrent=()=>{if(!current())throw Error('音频准备已取消或由新请求接替。');};
    this.update({phase:'preparing',packId:null,activePackId:this.active?.pack.packId??null,verified:0,total:0,message:'正在校验自然音频资源…'});
    try{
      const pack=await validateNaturalAudioManifest(input,options.allowLocalCandidate);assertCurrent();id=pack.packId;total=pack.clips.length;
      // Build/freeze verifies every immutable shipped file. Runtime activation
      // validates the small manifest only; no full-pack downloads at startup.
      // Each requested clip must pass a full byte/hash check before a Blob URL
      // is handed to the media element. A failed manifest keeps the old pack.
      const clips=new Map<string,NaturalAudioClip[]>();for(const clip of pack.clips)clips.set(clip.text,[...(clips.get(clip.text)??[]),clip]);
      this.active={pack,clips};
      this.verifiedSources.clear();
      this.update({phase:'ready',packId:id,activePackId:id,verified,total,message:'自然音频按需准备。'});
      return {status:'ready'};
    }catch(error){
      if(token!==this.generation)return {status:'superseded'};
      const reason=error instanceof Error?error.message:'自然音频暂时无法准备。';
      this.update({phase:'error',packId:id,activePackId:this.active?.pack.packId??null,verified,total,message:reason});
      return {status:'failed',reason};
    }
  }
}
type NaturallyActive={pack:NaturalAudioManifest;clips:Map<string,NaturalAudioClip[]>};
export const naturalAudioRegistry=new NaturalAudioRegistry();
