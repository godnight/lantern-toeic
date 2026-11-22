import {Sha256} from './exam-stream/sha256.mjs';
import {canonicalJson} from './domain-command';

/** Unwired prototype: production must supply a pinned signing-key verifier, a
 * domain-specific catalogue admission, an atomic store and a bounded fetcher.
 * A hash accompanying a download is not a source of trust. */
export type RemotePracticeAsset = Readonly<{
  path:string; kind:'catalog'|'image'|'audio'; mime:string; bytes:number; sha256:string;
}>;
export type RemotePracticeManifest = Readonly<{
  schemaVersion:1; kind:'practice-catalog'; version:string; revision:number;
  minAppVersion:string; assets:readonly RemotePracticeAsset[];
}>;
export type RemotePracticeHead = Readonly<{version:string;revision:number;manifestSha256:string}>;
export type RemotePracticeWatermark = Readonly<
  {kind:'installed';head:RemotePracticeHead}|
  {kind:'first-install';proof:string}
>;
export type RemotePracticeSecurityState = Readonly<{active:RemotePracticeHead|null;watermark:RemotePracticeWatermark|null}>;
export type RemotePracticeEnvelope = Readonly<{manifest:Uint8Array;signature:Uint8Array}>;
export type RemotePracticeStage = {
  write:(path:string,chunk:Uint8Array)=>Promise<void>;
  /** Seal this private stage against any further writes, including by other
   * update attempts, until commit/discard. Reject if exclusive seal fails. */
  finishWrites:()=>Promise<void>;
  read:(path:string)=>AsyncIterable<Uint8Array>;
  /** In one durable transaction: compare active AND the high-water mark to
   * expectedState, reject an existing version with a different manifest,
   * ensure complete staged data, then publish this immutable version, active
   * pointer AND its high-water mark. A first-install state must be consumed.
   * Resolve only on commit; reject only on abort, with the old head intact.
   * This contract does not imply atomicity across IDB and CacheStorage. */
  commit:(envelope:RemotePracticeEnvelope,head:RemotePracticeHead,expectedState:RemotePracticeSecurityState,signal?:AbortSignal)=>Promise<void>;
  discard:()=>Promise<void>;
};
export type RemotePracticeStore = {
  /** Return one atomic snapshot. The high-water mark MUST come from an
   * independently rollback-resistant authority. Plain evictable IDB is not
   * sufficient. Missing/corrupt state is returned as watermark:null, never
   * inferred to be a first install merely because the database is empty. */
  securityState:()=>Promise<RemotePracticeSecurityState>;
  /** Returns a private stage, or rejects without changing any active version. */
  begin:(version:string,manifestSha256:string)=>Promise<RemotePracticeStage>;
  envelope:(version:string)=>Promise<RemotePracticeEnvelope|null>;
  read:(version:string,path:string)=>AsyncIterable<Uint8Array>;
};
export type RemotePracticeVerifier = (manifest:Uint8Array,signature:Uint8Array)=>Promise<boolean>;
export type RemotePracticeDependencies = {
  verify:RemotePracticeVerifier;
  /** A shipped, independently trusted lower bound, never taken from the
   * downloaded manifest or a server response accompanying the package. */
  trustedMinimumRevision:number;
  /** Required only for initial provisioning. Must reject replay and establish
   * genuine first installation using a trusted authority outside evictable
   * app storage; mere absence of local data cannot authorize provisioning.
   * No such production verifier is implemented by this prototype. */
  verifyFirstInstall:(proof:string)=>Promise<boolean>;
  fetch:(asset:RemotePracticeAsset,signal?:AbortSignal)=>AsyncIterable<Uint8Array>;
  /** Must validate the staged JSON question model, identities, grouping,
   * licensing and exact media references before activation. */
  admit:(manifest:RemotePracticeManifest,stage:Pick<RemotePracticeStage,'read'>)=>Promise<boolean>;
  store:RemotePracticeStore;
  appVersion:string;
  signal?:AbortSignal;
};

const MAX_MANIFEST_BYTES=256*1024,MAX_SIGNATURE_BYTES=4096;
const MAX_ASSETS=2048,MAX_ASSET_BYTES=16*1024*1024,MAX_TOTAL_BYTES=192*1024*1024;
const MAX_CHUNK_BYTES=1024*1024;
const formats:Record<RemotePracticeAsset['kind'],Readonly<Record<string,string>>>=Object.freeze({
  catalog:Object.freeze({json:'application/json'}),
  image:Object.freeze({png:'image/png',jpg:'image/jpeg',webp:'image/webp'}),
  audio:Object.freeze({mp3:'audio/mpeg'}),
});
function fail(code:string):never {throw new Error('remote-practice-'+code);}
function plain(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function keys(value:Record<string,unknown>,expected:string):boolean{return Object.keys(value).sort().join(',')===expected;}
function semver(value:unknown):value is string{return typeof value==='string'&&/^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/.test(value);}
function versionAtLeast(current:string,minimum:string):boolean {
  const a=current.split('.').map(Number),b=minimum.split('.').map(Number);
  for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return true;
}
function abort(signal?:AbortSignal):void {if(signal?.aborted)fail('cancelled');}
function snapshot(envelope:RemotePracticeEnvelope):RemotePracticeEnvelope {
  if(!(envelope.manifest instanceof Uint8Array)||envelope.manifest.byteLength<1||envelope.manifest.byteLength>MAX_MANIFEST_BYTES||
    !(envelope.signature instanceof Uint8Array)||envelope.signature.byteLength<1||envelope.signature.byteLength>MAX_SIGNATURE_BYTES)fail('envelope');
  return {manifest:Uint8Array.from(envelope.manifest),signature:Uint8Array.from(envelope.signature)};
}
function digest(bytes:Uint8Array):string{return new Sha256().update(bytes).hex();}
function validHead(head:RemotePracticeHead|null):void {
  if(head===null)return;
  if(!plain(head)||!keys(head,'manifestSha256,revision,version')||typeof head.version!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(head.version)||
    !Number.isSafeInteger(head.revision)||head.revision<1||typeof head.manifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(head.manifestSha256))fail('stored-head');
}
function sameHead(a:RemotePracticeHead,b:RemotePracticeHead):boolean {
  return a.revision===b.revision&&a.version===b.version&&a.manifestSha256===b.manifestSha256;
}
function snapshotSecurityState(state:RemotePracticeSecurityState):RemotePracticeSecurityState {
  if(!plain(state)||!keys(state,'active,watermark'))fail('security-state');
  validHead(state.active);
  const active=state.active?Object.freeze({...state.active}):null;
  const watermark=state.watermark;
  if(watermark===null)fail('watermark-unavailable');
  if(!plain(watermark)||typeof watermark.kind!=='string')fail('security-state');
  if(watermark.kind==='installed'){
    if(!keys(watermark,'head,kind')||!watermark.head)fail('security-state');
    validHead(watermark.head);
    const head=Object.freeze({...watermark.head});
    if(active&&!sameHead(active,head))fail('security-state');
    return Object.freeze({active,watermark:Object.freeze({kind:'installed' as const,head})});
  }
  if(watermark.kind==='first-install'){
    if(!keys(watermark,'kind,proof')||active!==null||typeof watermark.proof!=='string'||!watermark.proof||watermark.proof.length>4096)fail('security-state');
    return Object.freeze({active:null,watermark:Object.freeze({kind:'first-install' as const,proof:watermark.proof})});
  }
  return fail('security-state');
}
async function verifyEnvelope(envelope:RemotePracticeEnvelope,verify:RemotePracticeVerifier,appVersion:string):Promise<{manifest:RemotePracticeManifest;sha256:string;envelope:RemotePracticeEnvelope}>{
  const saved=snapshot(envelope);
  // A verifier cannot mutate the bytes subsequently parsed and persisted.
  if(await verify(saved.manifest.slice(),saved.signature.slice())!==true)fail('untrusted-manifest');
  if(!semver(appVersion))fail('app-version');
  let raw:string,value:unknown;
  try {raw=new TextDecoder('utf-8',{fatal:true}).decode(saved.manifest);value=JSON.parse(raw);}catch{fail('manifest-json');}
  // Canonical form rejects duplicate keys, ambiguous encodings and extra whitespace.
  if(canonicalJson(value)!==raw)fail('manifest-canonical');
  if(!plain(value)||!keys(value,'assets,kind,minAppVersion,revision,schemaVersion,version')||value.schemaVersion!==1||value.kind!=='practice-catalog'||
    typeof value.version!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.version)||!Number.isSafeInteger(value.revision)||Number(value.revision)<1||
    !semver(value.minAppVersion)||!versionAtLeast(appVersion,value.minAppVersion)||!Array.isArray(value.assets)||value.assets.length<1||value.assets.length>MAX_ASSETS)fail('manifest-shape');
  let total=0,catalogs=0;const paths=new Set<string>(),assets:RemotePracticeAsset[]=[];
  for(const item of value.assets){
    if(!plain(item)||!keys(item,'bytes,kind,mime,path,sha256')||typeof item.path!=='string'||
      !/^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:json|png|jpg|webp|mp3)$/.test(item.path)||item.path.length>240||
      paths.has(item.path)||typeof item.kind!=='string'||!Object.hasOwn(formats,item.kind)||
      typeof item.mime!=='string'||!Number.isSafeInteger(item.bytes)||Number(item.bytes)<1||Number(item.bytes)>MAX_ASSET_BYTES||
      typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256))fail('asset-shape');
    const kind=item.kind as RemotePracticeAsset['kind'],ext=item.path.split('.').at(-1)!;
    if(formats[kind][ext]!==item.mime)fail('asset-format');
    paths.add(item.path);if(kind==='catalog')catalogs++;total+=Number(item.bytes);
    if(total>MAX_TOTAL_BYTES)fail('manifest-size');
    assets.push(Object.freeze({path:item.path,kind,mime:item.mime,bytes:Number(item.bytes),sha256:item.sha256}));
  }
  if(catalogs!==1)fail('catalog-count');
  const manifest=Object.freeze({schemaVersion:1 as const,kind:'practice-catalog' as const,version:value.version,
    revision:Number(value.revision),minAppVersion:value.minAppVersion,assets:Object.freeze(assets)});
  return {manifest,sha256:digest(saved.manifest),envelope:saved};
}

async function checkedStream(chunks:AsyncIterable<Uint8Array>,asset:RemotePracticeAsset,consume:(chunk:Uint8Array)=>Promise<void>,signal?:AbortSignal):Promise<void> {
  const hash=new Sha256();let total=0;
  for await(const source of chunks){
    abort(signal);
    if(!(source instanceof Uint8Array)||source.byteLength<1||source.byteLength>MAX_CHUNK_BYTES)fail('chunk');
    const chunk=Uint8Array.from(source);total+=chunk.length;
    if(total>asset.bytes)fail('asset-size');
    hash.update(chunk);await consume(chunk);
  }
  abort(signal);if(total!==asset.bytes)fail('asset-size');
  if(hash.hex()!==asset.sha256)fail('asset-hash');
}

/** Never modifies the active version until every staged object and the domain
 * catalogue have been re-read and validated. No production storage is wired. */
export async function stageAndActivateRemotePractice(input:RemotePracticeEnvelope,deps:RemotePracticeDependencies):Promise<RemotePracticeHead>{
  abort(deps.signal);
  if(!Number.isSafeInteger(deps.trustedMinimumRevision)||deps.trustedMinimumRevision<1)fail('trusted-revision-floor');
  const verified=await verifyEnvelope(input,deps.verify,deps.appVersion);abort(deps.signal);
  if(verified.manifest.revision<deps.trustedMinimumRevision)fail('revision-below-floor');
  const previous=snapshotSecurityState(await deps.store.securityState()),watermark=previous.watermark!;
  if(watermark.kind==='first-install'){
    if(await deps.verifyFirstInstall(watermark.proof)!==true)fail('first-install-unverified');
    abort(deps.signal);
  }else{
    const prior=watermark.head;
    if(verified.manifest.revision<prior.revision)fail('revision-rollback');
    if(verified.manifest.revision===prior.revision&&(verified.manifest.version!==prior.version||verified.sha256!==prior.manifestSha256))fail('revision-conflict');
  }
  const head=Object.freeze({version:verified.manifest.version,revision:verified.manifest.revision,manifestSha256:verified.sha256});
  const stage=await deps.store.begin(head.version,head.manifestSha256);let committed=false;
  try{
    for(const asset of verified.manifest.assets){
      abort(deps.signal);
      await checkedStream(deps.fetch(asset,deps.signal),asset,chunk=>stage.write(asset.path,chunk),deps.signal);
    }
    await stage.finishWrites();abort(deps.signal);
    for(const asset of verified.manifest.assets){
      // The store can fail or truncate independently of a successful download;
      // exclusive sealed staging prevents modification after this check.
      await checkedStream(stage.read(asset.path),asset,async()=>{},deps.signal);
    }
    abort(deps.signal);
    if(await deps.admit(verified.manifest,{read:stage.read.bind(stage)})!==true)fail('catalog-not-admitted');
    abort(deps.signal);await stage.commit(verified.envelope,head,previous,deps.signal);committed=true;
    return head;
  } finally {if(!committed)await stage.discard();}
}

/** A session supplies its persisted version and manifest hash; this never consults active.
 * Readback checks the trusted manifest again and returns bytes only after
 * complete size/hash verification; missing or evicted media fails closed. */
export async function readRemotePracticeAsset(head:RemotePracticeHead,path:string,deps:{store:RemotePracticeStore;verify:RemotePracticeVerifier;appVersion:string;signal?:AbortSignal}):Promise<Uint8Array>{
  abort(deps.signal);
  if(!head)fail('stored-head');
  validHead(head);
  const sessionHead=Object.freeze({...head});
  const envelope=await deps.store.envelope(sessionHead.version);if(!envelope)fail('version-missing');
  const {manifest,sha256}=await verifyEnvelope(envelope,deps.verify,deps.appVersion);
  if(manifest.version!==sessionHead.version||manifest.revision!==sessionHead.revision||sha256!==sessionHead.manifestSha256)fail('version-mismatch');
  const asset=manifest.assets.find(row=>row.path===path);if(!asset)fail('asset-missing');
  const chunks:Uint8Array[]=[];let length=0;
  await checkedStream(deps.store.read(sessionHead.version,path),asset,async chunk=>{chunks.push(chunk);length+=chunk.length;},deps.signal);
  const out=new Uint8Array(length);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;
}
