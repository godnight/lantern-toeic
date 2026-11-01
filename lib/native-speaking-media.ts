/** Separate, bounded media protocol. No auth token, JS owner or filesystem path. */
export const NATIVE_MEDIA_CHUNK_BYTES=65536;
export const NATIVE_MEDIA_METADATA_BYTES=1024;
export const NATIVE_MEDIA_FRAME_BYTES=4+NATIVE_MEDIA_METADATA_BYTES+NATIVE_MEDIA_CHUNK_BYTES;
export const NATIVE_MEDIA_MAX_BYTES=12000000;
export const NATIVE_MEDIA_MAX_CHUNKS=200;
export const NATIVE_MEDIA_MAX_MS=120000;
const CONTROL_BYTES=4096;
const states=['IDLE','STARTED','FINALIZING','READY','READING','ACKED','FAILED','CANCELLED','EXPIRED','UNKNOWN_CAPTURE'] as const;
const codes=['UNSUPPORTED','PERMISSION_DENIED','BUSY','START_FAILED','WRITE_FAILED','FINALIZE_FAILED','READ_FAILED','CANCELLED','STALE_GENERATION','SIZE_LIMIT','EMPTY_RECORDING','INTERRUPTED'] as const;
export type NativeMediaErrorCode=typeof codes[number];
export class NativeMediaError extends Error {
 constructor(readonly code:NativeMediaErrorCode,readonly unknownResult=false){super(code);}
}
export type NativeMediaReply={version:1;id:string;captureId?:string;generation?:number;state:typeof states[number];revision:number;
 nextChunkIndex?:number;totalChunks?:number;totalBytes?:number;sha256?:string;mime?:'audio/mp4';durationMs?:number;
 errorCode?:NativeMediaErrorCode;result?:'ALREADY_ACCEPTED'|'CONFLICT'|'TOO_LATE';index?:number};
export type NativeMediaMessage={reply:NativeMediaReply;bytes?:Uint8Array<ArrayBuffer>};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const integer=(v:unknown,min:number,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const failure=()=>new NativeMediaError('READ_FAILED');
const keys=['version','id','captureId','generation','state','revision','nextChunkIndex','totalChunks','totalBytes','sha256','mime','durationMs','errorCode','result','index'];
function parseReply(raw:unknown):NativeMediaReply {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw failure();
 const value=raw as Record<string,unknown>;
 if(Object.keys(value).some(key=>!keys.includes(key))||value.version!==1||!uuid(value.id)||
  !states.includes(value.state as NativeMediaReply['state'])||!integer(value.revision,0))throw failure();
 if(value.captureId!==undefined||value.generation!==undefined){if(!uuid(value.captureId)||!integer(value.generation,1))throw failure();}
 if(value.errorCode!==undefined&&!codes.includes(value.errorCode as NativeMediaErrorCode))throw failure();
 if(value.result!==undefined&&!['ALREADY_ACCEPTED','CONFLICT','TOO_LATE'].includes(value.result as string))throw failure();
 const media=['READY','READING'].includes(value.state as string);
 if(media){
  if(!uuid(value.captureId)||!integer(value.generation,1)||!integer(value.totalBytes,1,NATIVE_MEDIA_MAX_BYTES)||
   !integer(value.totalChunks,1,NATIVE_MEDIA_MAX_CHUNKS)||value.totalChunks!==Math.ceil(value.totalBytes/NATIVE_MEDIA_CHUNK_BYTES)||
   !integer(value.nextChunkIndex,0,value.totalChunks)||value.mime!=='audio/mp4'||typeof value.sha256!=='string'||
   !/^[0-9a-f]{64}$/.test(value.sha256)||typeof value.durationMs!=='number'||!Number.isFinite(value.durationMs)||
   value.durationMs<1||value.durationMs>NATIVE_MEDIA_MAX_MS)throw failure();
 }else if(['nextChunkIndex','totalChunks','totalBytes','sha256','mime','durationMs','index'].some(key=>value[key]!==undefined))throw failure();
 if(value.index!==undefined&&!integer(value.index,0,(value.totalChunks as number)-1))throw failure();
 return value as NativeMediaReply;
}
export function decodeNativeMediaMessage(data:unknown):NativeMediaMessage {
 if(typeof data==='string'){
  if(data.length>CONTROL_BYTES||new TextEncoder().encode(data).byteLength>CONTROL_BYTES)throw failure();
  let value:unknown;try{value=JSON.parse(data);}catch{throw failure();}
  const reply=parseReply(value);if(reply.index!==undefined)throw failure();return {reply};
 }
 if(!(data instanceof ArrayBuffer)||data.byteLength<6||data.byteLength>NATIVE_MEDIA_FRAME_BYTES)throw failure();
 const length=new DataView(data).getUint32(0,true),size=data.byteLength-4-length;
 if(length<1||length>NATIVE_MEDIA_METADATA_BYTES||size<1||size>NATIVE_MEDIA_CHUNK_BYTES)throw failure();
 let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(data,4,length)));}catch{throw failure();}
 const reply=parseReply(value);
 if(reply.state!=='READING'||reply.index===undefined||size!==Math.min(NATIVE_MEDIA_CHUNK_BYTES,reply.totalBytes!-reply.index*NATIVE_MEDIA_CHUNK_BYTES))throw failure();
 return {reply,bytes:new Uint8Array(data,4+length,size)};
}

type NativeProxy={open:(raw:string)=>string;detach:(raw:string)=>void};
declare global {interface Window {LanternSpeakingHost?:NativeProxy;}}
export type NativeMediaConnection={port:MessagePort;detach:(captureId:string,generation:number)=>void};
export type NativeMediaConnector=(current:()=>boolean)=>Promise<NativeMediaConnection>;
/** Accept only a nonce-matched native handoff at the packaged top document.
 * ArkWeb's actual port event shape/capacity still requires device acceptance. */
export const connectNativeSpeakingMedia:NativeMediaConnector=current=>new Promise((resolve,reject)=>{
 if(typeof window==='undefined'||window.top!==window||window.location.origin!=='https://lantern.local'||
  window.location.pathname!=='/'||!window.LanternSpeakingHost||!current()){reject(new NativeMediaError('UNSUPPORTED'));return;}
 const proxy=window.LanternSpeakingHost,nonce=crypto.randomUUID(),label='LANTERN_SPEAKING_PORT_V1:'+nonce;
 let settled=false;
 const finish=(error?:NativeMediaError,port?:MessagePort)=>{
  if(settled){port?.close();return;}settled=true;clearTimeout(timer);window.removeEventListener('message',receive);
  if(error||!port){port?.close();reject(error||new NativeMediaError('UNSUPPORTED'));}
  else resolve({port,detach:(captureId,generation)=>{try{proxy.detach(JSON.stringify({captureId,generation}));}catch{/* Native expiry/lifecycle still owns cleanup. */}}});
 };
 const receive=(event:MessageEvent)=>{
  if(event.data!==label)return;
  const port=event.ports?.[0];
  // A frame-originated/forwarded port is rejected. Empty origin is permitted
  // only for a native source-null handoff, never used as an owner proof.
  if(event.source!==null||!['','https://lantern.local'].includes(event.origin)||event.ports.length!==1||!current()){
   for(const item of event.ports||[])item.close();finish(new NativeMediaError('UNSUPPORTED'));return;
  }
  finish(undefined,port);
 };
 const timer=setTimeout(()=>finish(new NativeMediaError('UNSUPPORTED')),15000);
 window.addEventListener('message',receive);
 try{const result=proxy.open(JSON.stringify({version:1,nonce}));if(result!=='OFFERED')finish(new NativeMediaError(result==='BUSY'?'BUSY':'UNSUPPORTED'));}
 catch{finish(new NativeMediaError('UNSUPPORTED'));}
});

type Pending={resolve:(message:NativeMediaMessage)=>void;reject:(error:NativeMediaError)=>void;timer:ReturnType<typeof setTimeout>};
export class NativeMediaChannel {
 private connection:NativeMediaConnection;
 private pending=new Map<string,Pending>();
 private closed=false;
 private revision=0;
 constructor(connection:NativeMediaConnection,readonly captureId:string,readonly generation:number,private current:()=>boolean){
  this.connection=connection;
  connection.port.onmessage=event=>{
   if(this.closed||!this.current()){this.close();return;}
   let message:NativeMediaMessage;try{message=decodeNativeMediaMessage(event.data);}catch{this.close(new NativeMediaError('READ_FAILED'));return;}
   const {reply}=message,waiting=this.pending.get(reply.id);if(!waiting)return;
   if(reply.captureId!==this.captureId||reply.generation!==this.generation||reply.revision<this.revision){this.close(new NativeMediaError('STALE_GENERATION'));return;}
   clearTimeout(waiting.timer);this.pending.delete(reply.id);this.revision=reply.revision;
   if(reply.errorCode)waiting.reject(new NativeMediaError(reply.errorCode));else waiting.resolve(message);
  };
  connection.port.onmessageerror=()=>this.close(new NativeMediaError('UNSUPPORTED'));
  connection.port.start();
 }
 request(action:'start'|'stop'|'cancel'|'query'|'readChunk'|'ack',extra:Record<string,unknown>={},timeoutMs=15000):Promise<NativeMediaMessage>{
  if(this.closed||!this.current())return Promise.reject(new NativeMediaError('STALE_GENERATION'));
  if(this.pending.size>=2)return Promise.reject(new NativeMediaError('BUSY'));
  const id=crypto.randomUUID(),raw=JSON.stringify({...extra,version:1,id,action,captureId:this.captureId,generation:this.generation});
  if(new TextEncoder().encode(raw).byteLength>CONTROL_BYTES)return Promise.reject(failure());
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new NativeMediaError('READ_FAILED',true));},timeoutMs);
   this.pending.set(id,{resolve,reject,timer});
   try{this.connection.port.postMessage(raw);}catch{clearTimeout(timer);this.pending.delete(id);reject(new NativeMediaError('UNSUPPORTED'));}
  });
 }
 detach():void{this.close();}
 close(error=new NativeMediaError('STALE_GENERATION')):void{
  if(this.closed)return;this.closed=true;
  try{this.connection.detach(this.captureId,this.generation);}catch{/* Native lifecycle/expiry still owns cleanup. */}
  this.pending.forEach(p=>{clearTimeout(p.timer);p.reject(error);});this.pending.clear();
  this.connection.port.onmessage=null;this.connection.port.onmessageerror=null;this.connection.port.close();
 }
}

export function nativeMediaMessage(error:unknown):string{
 const code=error instanceof NativeMediaError?error.code:'READ_FAILED';
 return {UNSUPPORTED:'本机原生 AAC 录音暂不可用，请保留原录音或明确切回原 WAV 方案。',
  PERMISSION_DENIED:'麦克风尚未获准，请先通过录音准备申请权限。',BUSY:'上一段原生录音尚未收尾，请先完成或退出该段。',
  START_FAILED:'原生录音未能启动，请检查麦克风后重试。',WRITE_FAILED:'原生录音临时文件未能安全保存或清理。',
  FINALIZE_FAILED:'原生录音整理未完成，请保留当前结果并重试查询。',READ_FAILED:'原生录音读取或完整性校验未完成，未保存不完整音频。',
  CANCELLED:'本段原生录音已取消。',STALE_GENERATION:'页面或账号已变化，本段原生录音已失效。',
  SIZE_LIMIT:'录音超过本机时长或大小限制。',EMPTY_RECORDING:'没有收到有效原生录音，请检查麦克风后重新准备。',
  INTERRUPTED:'原生录音因系统或输入设备变化中断，本段未保存。'}[code];
}
