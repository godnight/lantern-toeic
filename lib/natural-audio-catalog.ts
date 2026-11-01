import {canonicalHash} from './domain-command';
import {naturalAudioRegistry as originalNaturalAudioRegistry,NaturalAudioRegistry,naturalAudioSha256,type NaturalAudioManifest,type NaturalAudioSelector,type NaturalAudioResolution,type NaturalAudioResource,type NaturalAudioState} from './natural-audio';
import {compiledNaturalAudioIdentity,compiledNaturalAudioRows,registerCompiledNaturalAudioAdmission} from './natural-audio-admission';
import {compiledNaturalAudioCatalog,compiledNaturalAudioCatalogError,naturalAudioSelectorDigest,type NaturalAudioRouteTuple,type NaturalAudioPackDescriptor} from './natural-audio-catalog-index';
import {NaturalAudioCacheBudget} from './natural-audio-cache-budget';

type Fetcher=(input:string,init?:RequestInit)=>Promise<Response>;
type PrepareOptions=NaturalAudioSelector&{fetcher?:Fetcher;cacheStorage?:CacheStorage|null;signal?:AbortSignal;createObjectURL?:(blob:Blob)=>string;revokeObjectURL?:(url:string)=>void};
type MetadataDescriptor={url:string;sourceId:string;packId:string;label:string;metadataOnly:true};
export type CatalogAudioDescriptor=NaturalAudioResolution|MetadataDescriptor;
type Entry={descriptor:NaturalAudioPackDescriptor;registry:NaturalAudioRegistry;users:number;touch:number;controller:AbortController;loading:boolean;loaded:Promise<void>;unregister:()=>void;clips:Map<string,number>};
type Budget=Pick<NaturalAudioCacheBudget,'pinURLs'|'forRequest'|'outcome'>;
const cancelled=()=>Error('音频准备已取消或版本已变化。');
const checkSignal=(signal?:AbortSignal)=>{if(signal?.aborted)throw cancelled();};
const urlFor=(packId:string,sha:string)=>'/audio/natural/'+packId+'/'+sha+'.mp3';
function awaitSignal<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
  checkSignal(signal);if(!signal)return promise;
  return new Promise<T>((resolve,reject)=>{const abort=()=>{cleanup();reject(cancelled());};const cleanup=()=>signal.removeEventListener('abort',abort);signal.addEventListener('abort',abort,{once:true});promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});});
}
/** Slots cover headers AND body draining; no startup fan-out or unbounded response.text(). */
class FetchSlots{
  private count=0;private waiters=new Set<()=>void>();
  async run<T>(signal:AbortSignal|undefined,action:()=>Promise<T>):Promise<T>{
    for(;;){checkSignal(signal);if(this.count<2){this.count++;break;}
      await this.changed(signal);
    }
    try{return await action();}finally{this.count--;this.waiters.forEach(w=>w());}
  }
  private changed(signal?:AbortSignal){return new Promise<void>((resolve,reject)=>{const finish=()=>{cleanup();resolve();};const abort=()=>{cleanup();reject(cancelled());};const cleanup=()=>{this.waiters.delete(finish);signal?.removeEventListener('abort',abort);};this.waiters.add(finish);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});}
}
async function bounded(response:Response,limit:number,signal?:AbortSignal,exact=true):Promise<Uint8Array>{
  if(!response.ok||response.type==='opaque')throw Error('自然音频资源暂不可用。');
  const raw=response.headers.get('Content-Length');if(raw!==null&&(!/^\d+$/.test(raw)||Number(raw)>limit||exact&&Number(raw)!==limit)){await response.body?.cancel();throw Error('自然音频资源大小与冻结清单不一致。');}
  const reader=response.body?.getReader();if(!reader)throw Error('自然音频资源内容为空。');
  const chunks:Uint8Array[]=[];let size=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try{for(;;){checkSignal(signal);const next=await reader.read();checkSignal(signal);if(next.done)break;size+=next.value.byteLength;if(size>limit)throw Error('自然音频资源超过限定大小。');chunks.push(next.value);}if(exact&&size!==limit)throw Error('自然音频资源不完整。');const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
}

/** The imported root locator is authority. It cannot be replaced by activation input. */
export class NaturalAudioCatalogRegistry{
  private readonly base:NaturalAudioRegistry;private readonly budget:Budget;private readonly slots=new FetchSlots();
  private pending=new Set<AbortController>();private entries=new Map<string,Entry>();private waiters=new Set<()=>void>();private listeners=new Set<()=>void>();private sequence=0;private generation=0;
  private state:NaturalAudioState;private catalog=compiledNaturalAudioCatalog;private catalogError=compiledNaturalAudioCatalogError;
  private readonly blockedHashes=new Set(compiledNaturalAudioCatalog?.blockedAssetSha256??[]);
  private readonly blockedContexts=new Set((compiledNaturalAudioCatalog?.blockedContexts??[]).map(r=>r[0]+'\0'+r[1]));
  constructor(base:NaturalAudioRegistry=originalNaturalAudioRegistry,budget:Budget=new NaturalAudioCacheBudget()){
    this.base=base;this.budget=budget;this.state=base.getSnapshot();
    const identity=compiledNaturalAudioIdentity();if(this.catalog?.basePackId!==identity.packId){this.catalog=null;this.catalogError='定位索引与原音频包不一致，保留原音频。';}
    base.subscribe(()=>{this.state=Object.freeze({...base.getSnapshot(),message:this.catalogError?base.getSnapshot().message+' '+this.catalogError:base.getSnapshot().message});this.emit();});
  }
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  getSnapshot=()=>this.state;
  private emit(){this.listeners.forEach(fn=>fn());}
  inspect(){return{catalogId:this.catalog?.catalogId??null,catalogError:this.catalogError,residentPackIds:[...this.entries.keys()],leases:[...this.entries.values()].map(e=>({packId:e.descriptor.packId,users:e.users,loading:e.loading}))};}
  private blockedResolution(value:NaturalAudioResolution,options:NaturalAudioSelector):boolean{
    if(this.blockedHashes.has(value.clip.sha256)||this.blockedHashes.has(value.clip.sourceWavSha256))return true;
    return value.clip.references.some(ref=>(!options.materialId||ref.materialId===options.materialId)&&(!options.segmentId||ref.segmentId===options.segmentId)&&(!options.contextHash||ref.contextHash===options.contextHash)&&this.blockedContexts.has(ref.materialId+'\0'+(ref.contextHash??'')));
  }
  private route(text:string,options:NaturalAudioSelector):NaturalAudioRouteTuple|null{
    const index=this.catalog;if(!index||!options.assetKey||!options.materialId||!options.segmentId||!options.voiceProfileId)return null;
    const textHash=canonicalHash(text),rows=index.routes[options.assetKey]??[];
    const found=rows.filter(row=>row[2]===textHash&&(!options.contextHash||row[5]===options.contextHash)&&row[1]===naturalAudioSelectorDigest(textHash,options.assetKey!,options.materialId!,options.segmentId!,options.voiceProfileId!,row[5])&&!this.blockedHashes.has(row[3])&&!this.blockedContexts.has(options.materialId+'\0'+row[5]));
    return found.length===1?found[0]:null;
  }
  resolve(text:string,options:NaturalAudioSelector={}):CatalogAudioDescriptor|null{
    const route=this.route(text,options);
    if(route){const descriptor=this.catalog!.packs[route[0]],entry=this.entries.get(descriptor.packId);
      if(descriptor.packId===compiledNaturalAudioIdentity().packId||entry&&!entry.loading){const value=(descriptor.packId===compiledNaturalAudioIdentity().packId?this.base:entry!.registry).resolve(text,{...options,contextHash:route[5]});if(value)return this.blockedResolution(value,options)?null:value;}
      if(options.masterWavSha256||options.sense)return null;
      return{url:urlFor(descriptor.packId,route[3]),sourceId:route[7]??'natural:'+descriptor.packId+':'+route[4]+':'+route[3],packId:descriptor.packId,label:'自然语音',metadataOnly:true};
    }
    const value=this.base.resolve(text,options);return value&&!this.blockedResolution(value,options)?value:null;
  }
  hasText(text:string){const hash=canonicalHash(text);return this.base.hasText(text)||!!this.catalog&&Object.values(this.catalog.routes).some(rows=>rows.some(row=>row[2]===hash));}
  isBlocked(text:string){return this.base.isBlocked(text);}
  async activate(input:unknown,options:{allowLocalCandidate?:boolean;fetcher?:Fetcher;cacheStorage?:CacheStorage|null;signal?:AbortSignal}={}){
    // The old activation API can only update the original base manifest; it never supplies a locator or authority.
    if(!input||typeof input!=='object'||(input as {packId?:unknown}).packId!==compiledNaturalAudioIdentity().packId)return{status:'failed' as const,reason:'原音频包身份不一致。'};
    this.cancelPending();return this.base.activate(input,options);
  }
  cancelPending(){this.generation++;for(const request of this.pending)request.abort();for(const entry of this.entries.values())if(entry.loading)entry.controller.abort();this.wake();}
  private wake(){this.waiters.forEach(fn=>fn());}
  private async changed(signal?:AbortSignal){return new Promise<void>((resolve,reject)=>{const finish=()=>{cleanup();resolve();};const abort=()=>{cleanup();reject(cancelled());};const cleanup=()=>{this.waiters.delete(finish);signal?.removeEventListener('abort',abort);};this.waiters.add(finish);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});}
  private evict(entry:Entry){if(entry.users)throw Error('音频包仍在使用。');entry.controller.abort();entry.unregister();if(this.entries.get(entry.descriptor.packId)===entry)this.entries.delete(entry.descriptor.packId);this.wake();}
  private releaseEntry(entry:Entry){entry.users--;entry.touch=++this.sequence;if(!entry.users&&entry.loading)entry.controller.abort();this.wake();}
  private async acquire(descriptor:NaturalAudioPackDescriptor,fetcher:Fetcher,signal?:AbortSignal):Promise<Entry>{
    for(;;){checkSignal(signal);let entry=this.entries.get(descriptor.packId);
      if(entry&&!entry.controller.signal.aborted){entry.users++;entry.touch=++this.sequence;return entry;}
      if(entry){if(!entry.users){this.evict(entry);entry=undefined;}else{await this.changed(signal);continue;}}
      if(this.entries.size>=2){const victim=[...this.entries.values()].filter(e=>!e.users&&!e.loading).sort((a,b)=>a.touch-b.touch)[0];if(victim)this.evict(victim);else{await this.changed(signal);continue;}}
      const created:Entry={descriptor,registry:new NaturalAudioRegistry(),users:1,touch:++this.sequence,controller:new AbortController(),loading:true,loaded:Promise.resolve(),unregister:()=>{},clips:new Map()};
      this.entries.set(descriptor.packId,created);created.loaded=this.load(created,fetcher);void created.loaded.catch(()=>{});return created;
    }
  }
  private async fetchBytes(url:string,limit:number,fetcher:Fetcher,signal:AbortSignal|undefined,exact=true){return this.slots.run(signal,async()=>{checkSignal(signal);const response=await fetcher(url,{credentials:'same-origin',cache:'no-store',signal});return bounded(response,limit,signal,exact);});}
  private async load(entry:Entry,fetcher:Fetcher){
    const p=entry.descriptor,signal=entry.controller.signal;
    try{
      const [manifestBytes,ledgerBytes]=await Promise.all([this.fetchBytes(p.manifestPath,p.manifestBytes,fetcher,signal),this.fetchBytes(p.admissionPath,p.admissionBytes,fetcher,signal)]);
      checkSignal(signal);if(await naturalAudioSha256(manifestBytes)!==p.manifestFileSha256)throw Error('自然音频清单文件与冻结索引不一致。');checkSignal(signal);
      entry.unregister=registerCompiledNaturalAudioAdmission(p.packId,ledgerBytes);
      const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)) as NaturalAudioManifest;
      if(manifest.packId!==p.packId||manifest.manifestSha256!==p.manifestSha256||manifest.clips.length!==p.clipCount||manifest.clips.reduce((n,c)=>n+c.bytes,0)!==p.declaredBytes)throw Error('自然音频分包统计或身份不一致。');
      const activated=await entry.registry.activate(manifest,{allowLocalCandidate:true,signal});checkSignal(signal);
      if(activated.status!=='ready')throw Error(activated.reason??'自然音频分包未通过校验。');
      for(const clip of manifest.clips)entry.clips.set(urlFor(p.packId,clip.sha256),clip.bytes);
      entry.loading=false;this.wake();
    }catch(error){entry.unregister();entry.unregister=()=>{};entry.loading=false;entry.controller.abort();if(!entry.users)this.evict(entry);this.wake();throw error;}
  }
  private pairURLs(text:string,options:NaturalAudioSelector,resolved:CatalogAudioDescriptor):string[]{
    const row=this.route(text,options);if(row&&this.catalog){return[...new Set(Object.values(this.catalog.routes).flat().filter(other=>other[0]===row[0]&&other[6]===row[6]).map(other=>urlFor(this.catalog!.packs[other[0]].packId,other[3])))];}
    if('clip'in resolved){const refs=resolved.clip.references.filter(r=>(!options.materialId||r.materialId===options.materialId)&&(!options.contextHash||r.contextHash===options.contextHash));const identity=compiledNaturalAudioIdentity();const rows=compiledNaturalAudioRows(identity.packId,identity.manifestSha256);return[...new Set([resolved.url,...rows.filter(r=>refs.some(ref=>r.materialId===ref.materialId&&r.contextHash===ref.contextHash)).map(r=>urlFor(identity.packId,r.encodedSha256))])];}
    return[resolved.url];
  }
  /** Explicit lesson/offline reservation; no fetch is triggered by metadata lookup. */
  async pinSelectors(items:{text:string;selector?:NaturalAudioSelector}[],options:{signal?:AbortSignal;kind:'lesson'|'offline'}={kind:'lesson'}){
    const urls=items.flatMap(item=>{const resolved=this.resolve(item.text,item.selector);return resolved?this.pairURLs(item.text,item.selector??{},resolved):[];});
    return this.budget.pinURLs([...new Set(urls)],options);
  }
  async prepare(text:string,options:PrepareOptions={}):Promise<NaturalAudioResource>{
    const generation=this.generation,selected=this.resolve(text,options);if(!selected)throw Error('这段自然语音尚未准备。');checkSignal(options.signal);
    const request=new AbortController(),signal=request.signal,abort=()=>request.abort();options.signal?.addEventListener('abort',abort,{once:true});this.pending.add(request);if(options.signal?.aborted)request.abort();
    const fetcher=options.fetcher??((url,init)=>fetch(url,init)),route=this.route(text,options);let entry:Entry|null=null;let lease:Awaited<ReturnType<Budget['pinURLs']>>|null=null;let resource:NaturalAudioResource|null=null;let transferred=false;
    const current=()=>generation===this.generation&&!signal.aborted&&(!entry||this.entries.get(entry.descriptor.packId)===entry&&!entry.controller.signal.aborted);
    const check=()=>{if(!current())throw cancelled();};
    try{
      if(route&&this.catalog!.packs[route[0]].packId!==compiledNaturalAudioIdentity().packId){entry=await this.acquire(this.catalog!.packs[route[0]],fetcher,signal);await awaitSignal(entry.loaded,signal);check();}
      const registry=entry?.registry??this.base,resolved=registry.resolve(text,{...options,...(route?{contextHash:route[5]}:{})});
      if(!resolved||this.blockedResolution(resolved,options)||resolved.sourceId!==selected.sourceId)throw Error('自然音频角色、版本或准入发生变化。');
      lease=await this.budget.pinURLs(this.pairURLs(text,options,resolved),{signal,kind:'playback'});check();
      const storage=this.budget.forRequest({signal,isCurrent:current,declaredBytes:resolved.clip.bytes});
      const boundedFetcher:Fetcher=(url,init)=>{if(url!==resolved.url)throw Error('自然音频资源定位不一致。');return this.fetchBytes(url,resolved.clip.bytes,fetcher,init?.signal??undefined).then(bytes=>new Response(new Uint8Array(bytes),{headers:{'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}}));};
      resource=await registry.prepare(text,{...options,signal,...(route?{contextHash:route[5]}:{}),fetcher:boundedFetcher,cacheStorage:storage});check();
      const outcome=this.budget.outcome(storage),prepared=resource,heldLease=lease;let released=false;
      // Verified Blob resources are independent of a manifest registry. A mounted, paused
      // player may retain its Blob; keep its cache pin, not a metadata residency slot.
      if(entry){this.releaseEntry(entry);entry=null;}
      transferred=true;return{...prepared,...(outcome.kind==='uncertain'?{persisted:false,cacheWarning:'缓存写入结果未确认，本次已验证内存播放；离线状态待复核。'}:{}),release:()=>{if(released)return;released=true;prepared.release();heldLease.release();}};
    }finally{options.signal?.removeEventListener('abort',abort);this.pending.delete(request);if(!transferred){resource?.release();lease?.release();if(entry)this.releaseEntry(entry);}}
  }
}
export const naturalAudioCatalogRegistry=new NaturalAudioCatalogRegistry();
