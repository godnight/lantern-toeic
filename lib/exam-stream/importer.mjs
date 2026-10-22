import { AssetReference, parseStreamingJson } from './stream-json.mjs';
import { Sha256 } from './sha256.mjs';
const MiB=1024**2, encoder=new TextEncoder();
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const encodeSmall=text=>encoder.encode(text);
const b64=bytes=>{let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text);};
function magic(mime,bytes){const ascii=(start,text)=>[...text].every((c,i)=>bytes[start+i]===c.charCodeAt(0));return mime==='image/png'?[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/webp'?ascii(0,'RIFF')&&ascii(8,'WEBP'):mime==='audio/wav'?ascii(0,'RIFF')&&ascii(8,'WAVE'):mime==='audio/mpeg'&&(ascii(0,'ID3')||(bytes[0]===255&&(bytes[1]&224)===224));}
function prepareMetadata(raw,model){
  const refs=new Map();let total=0;
  if(!object(raw))return {canonical:model.parseExamPackage(raw),refs};
  const assets=Array.isArray(raw.assets)?raw.assets.map(asset=>{
    if(!object(asset)||!(asset.base64 instanceof AssetReference))return asset;
    const ref=asset.base64;
    if(ref.error)throw new Error(ref.error);
    const limit=typeof asset.mime==='string'&&asset.mime.startsWith('image/')?model.EXAM_LIMITS.imageBytes:model.EXAM_LIMITS.assetBytes;
    if(ref.bytes>limit)throw new Error('Decoded asset exceeds original schema limit');
    total+=ref.bytes;if(total>model.EXAM_LIMITS.decodedBytes)throw new Error('Combined decoded assets exceed original 64 MiB limit');
    if(!magic(asset.mime,ref.head))throw new Error('Asset MIME/header mismatch');
    refs.set(asset.id,ref);
    return {...asset,base64:b64(ref.head)};
  }):raw.assets;
  const canonical=model.parseExamPackage({...raw,assets});
  return {canonical,refs,decodedBytes:total};
}

/** Re-encode from durable binary chunks; keep at most two carry bytes. */
export async function* assetBase64Chunks(stage,ref){
  let carry=new Uint8Array(0);
  for await(const chunk of stage.read(ref.id)){
    const all=new Uint8Array(carry.length+chunk.length);all.set(carry);all.set(chunk,carry.length);
    const end=all.length-all.length%3;
    // Separate bounded slices avoid oversized argument spreads and giant binary strings.
    for(let at=0;at<end;at+=48*1024)yield encodeSmall(b64(all.subarray(at,Math.min(end,at+48*1024))));
    carry=all.slice(end);
  }
  if(carry.length)yield encodeSmall(b64(carry));
}

/** JSON.stringify-compatible order for the already normalized schema object. */
async function* serialize(value,path,resolveAsset){
  const ref=resolveAsset(path);
  if(ref){yield encodeSmall('"');yield* assetBase64Chunks(ref.stage,ref.ref);yield encodeSmall('"');return;}
  if(Array.isArray(value)){yield encodeSmall('[');for(let i=0;i<value.length;i++){if(i)yield encodeSmall(',');yield* serialize(value[i],[...path,i],resolveAsset);}yield encodeSmall(']');return;}
  if(object(value)){yield encodeSmall('{');let first=true;for(const key of Object.keys(value)){if(value[key]===undefined)continue;if(!first)yield encodeSmall(',');first=false;yield encodeSmall(JSON.stringify(key)+':');yield* serialize(value[key],[...path,key],resolveAsset);}yield encodeSmall('}');return;}
  yield encodeSmall(JSON.stringify(value));
}
export function packageChunks(prepared,stage){return serialize(prepared.canonical,[],path=>path.length===3&&path[0]==='assets'&&path[2]==='base64'?{stage,ref:prepared.refs.get(prepared.canonical.assets[path[1]].id)}:undefined);}
export function backupChunks(prepared,stage){const value={kind:'lantern-exam-backup',schemaVersion:1,ownerId:prepared.ownerId,packages:prepared.packages.map(p=>p.canonical),attempts:prepared.attempts};return serialize(value,[],path=>path.length===5&&path[0]==='packages'&&path[2]==='assets'&&path[4]==='base64'?{stage,ref:prepared.packages[path[1]].refs.get(prepared.packages[path[1]].canonical.assets[path[3]].id)}:undefined);}
async function digestChunks(chunks,maxBytes,hashFactory){const hash=hashFactory();let bytes=0;for await(const chunk of chunks){bytes+=chunk.length;if(bytes>maxBytes)throw new Error('Normalized JSON exceeds original size limit');hash.update(chunk);}return {bytes,sha256:hash.hex()};}
function enforceHistory(rows){
  if(rows.filter(a=>a.status!=='submitted').length>1)throw new Error('More than one unfinished attempt');
  const groups=new Map();for(const a of rows){const list=groups.get(a.examId)??[];list.push(a);groups.set(a.examId,list);}
  for(const list of groups.values()){list.sort((a,b)=>a.ordinal-b.ordinal);list.forEach((a,i)=>{if(a.ordinal!==i+1||(i&&a.startedAt<list[i-1].startedAt))throw new Error('Noncontinuous attempt history');});}
}
function schemaKeyGuard(mode){
  const examKeys=['kind','schemaVersion','id','version','title','source','listeningAudioId','assets','groups','questions','scoreRanges','listeningDurationMs','format'];
  return (path,key)=>{
    const local=mode==='backup'&&path[0]==='packages'&&Number.isInteger(path[1])?path.slice(2):mode==='package'?path:undefined;
    let allowed;
    if(path.length===0&&mode==='backup')allowed=['kind','schemaVersion','ownerId','packages','attempts'];
    else if(local?.length===0)allowed=examKeys;
    else if(local?.length===1&&local[0]==='source')allowed=['classification','title','publisher','reference','rightsStatement'];
    else if(local?.length===2&&Number.isInteger(local[1]))allowed=local[0]==='assets'?['id','mime','base64']:local[0]==='questions'?['number','part','groupId','prompt','choices','answer','explanation']:local[0]==='groups'?['id','part','questionNumbers','passages','imageIds']:undefined;
    if(allowed&&!allowed.includes(key))throw new Error('Unsupported schema field: '+key);
  };
}

/** No activation until all bytes, binary headers, canonical schema and attempts validate.
 * stage.activate must atomically mark visibility with the integrator's catalog/history writes.
 */
export async function importStreaming(file,{stage,model,ownerId,mode='package',now=Date.now(),signal,hashFactory=()=>new Sha256(),activate=false,activation}={}){
  if(!stage||!model)throw new Error('Stage adapter and original model required');model.assertOwner(ownerId);
  const maxBytes=mode==='backup'?model.EXAM_LIMITS.backupBytes:model.EXAM_LIMITS.importBytes;
  try{
    const parsed=await parseStreamingJson(file,stage,{maxBytes,signal,hashFactory,guardKey:schemaKeyGuard(mode)});
    let prepared;
    if(mode==='package'){
      prepared=prepareMetadata(parsed.value,model);
      const digest=await digestChunks(packageChunks(prepared,stage),maxBytes,hashFactory);
      Object.assign(prepared,{kind:'package',key:model.examKey(prepared.canonical),bytes:digest.bytes,fingerprint:'sha256:'+digest.sha256});
    }else if(mode==='backup'){
      const raw=parsed.value;
      if(!object(raw)||raw.kind!=='lantern-exam-backup'||raw.schemaVersion!==1||raw.ownerId!==ownerId||Object.keys(raw).some(k=>!['kind','schemaVersion','ownerId','packages','attempts'].includes(k))||!Array.isArray(raw.packages)||raw.packages.length>model.EXAM_LIMITS.packages||!Array.isArray(raw.attempts)||raw.attempts.length>model.EXAM_LIMITS.attempts)throw new Error('Invalid or cross-owner backup');
      const packages=[],keys=new Set();
      for(const item of raw.packages){const p=prepareMetadata(item,model),key=model.examKey(p.canonical);if(keys.has(key))throw new Error('Duplicate backup package');keys.add(key);const digest=await digestChunks(packageChunks(p,stage),model.EXAM_LIMITS.importBytes,hashFactory);Object.assign(p,{key,bytes:digest.bytes,fingerprint:'sha256:'+digest.sha256});packages.push(p);}
      const ids=new Set(),attempts=[];
      for(const value of raw.attempts){const match=packages.find(p=>p.canonical.id===value?.examId&&p.canonical.version===value?.examVersion);if(!match)throw new Error('Backup missing attempt package');const a=model.advanceAttempt(model.validateAttempt(value,match.canonical,ownerId,match.fingerprint,now),now);if(ids.has(a.id))throw new Error('Duplicate attempt id');ids.add(a.id);attempts.push(a);}
      enforceHistory(attempts);prepared={kind:'backup',ownerId,packages,attempts};
      prepared.bytes=(await digestChunks(backupChunks(prepared,stage),maxBytes,hashFactory)).bytes;
    }else throw new Error('Unsupported import mode');
    if(signal?.aborted)throw signal.reason??new Error('Cancelled');
    // Do not publish placeholder canonical as an ExamPackage. Catalog consumers use definition.
    const publicPackage=p=>{const {assets,...definition}=p.canonical;return {key:p.key,definition,fingerprint:p.fingerprint,bytes:p.bytes,assets:assets.map(a=>({id:a.id,mime:a.mime,spoolId:p.refs.get(a.id).id,bytes:p.refs.get(a.id).bytes}))};};
    const manifest={kind:prepared.kind,ownerId,rawSha256:parsed.rawSha256,packages:(prepared.kind==='package'?[prepared]:prepared.packages).map(publicPackage),attempts:prepared.kind==='backup'?prepared.attempts:[]};
    // Last-wins JSON may have decoded superseded assets. Never publish or retain them.
    await stage.retain(manifest.packages.flatMap(p=>p.assets.map(a=>a.spoolId)));
    if(signal?.aborted)throw signal.reason??new Error('Cancelled');
    if(activate)await stage.activate(manifest,{...activation,signal});
    return {prepared,manifest,rawSha256:parsed.rawSha256,inputBytes:parsed.bytes,stats:parsed.stats};
  }catch(error){await stage.discard().catch(()=>{});throw error;}
}

/** Backpressure is owned by writer. No final Blob/whole JSON is constructed here. */
export async function writeLegacyJson(prepared,stage,writer){
  const chunks=prepared.kind==='backup'?backupChunks(prepared,stage):packageChunks(prepared,stage);
  try{for await(const chunk of chunks)await writer.write(chunk);await writer.close?.();}
  catch(error){await writer.abort?.(error);throw error;}
}

/** Reopen an active manifest after a page restart without rebuilding base64 strings. */
export async function restorePrepared(manifest,stage,model,{verify=true,hashFactory=()=>new Sha256()}={}){
  const headers={'image/png':[137,80,78,71,13,10,26,10],'image/jpeg':[255,216,255],'image/webp':[82,73,70,70,0,0,0,0,87,69,66,80],'audio/wav':[82,73,70,70,0,0,0,0,87,65,86,69],'audio/mpeg':[73,68,51]};
  model.assertOwner(manifest.ownerId);const packages=[];
  for(const p of manifest.packages){
    const canonical=model.parseExamPackage({...p.definition,assets:p.assets.map(a=>({id:a.id,mime:a.mime,base64:b64(headers[a.mime]??[])}))}),refs=new Map(p.assets.map(a=>[a.id,new AssetReference({id:a.spoolId,bytes:a.bytes})]));
    const prepared={canonical,refs,key:p.key,fingerprint:p.fingerprint,bytes:p.bytes};
    if(verify){const digest=await digestChunks(packageChunks(prepared,stage),model.EXAM_LIMITS.importBytes,hashFactory);if('sha256:'+digest.sha256!==p.fingerprint||digest.bytes!==p.bytes)throw new Error('Stored package fingerprint mismatch');}
    packages.push(prepared);
  }
  if(manifest.kind==='package'){if(packages.length!==1||manifest.attempts.length)throw new Error('Invalid stored package manifest');return {...packages[0],kind:'package'};}
  if(manifest.kind!=='backup')throw new Error('Invalid stored import kind');
  return {kind:'backup',ownerId:manifest.ownerId,packages,attempts:manifest.attempts};
}
