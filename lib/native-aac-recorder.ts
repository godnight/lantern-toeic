import {NativeMediaChannel,NativeMediaError,connectNativeSpeakingMedia,nativeMediaMessage,
 NATIVE_MEDIA_CHUNK_BYTES,NATIVE_MEDIA_MAX_BYTES,NATIVE_MEDIA_MAX_MS,type NativeMediaReply,type NativeMediaConnector} from './native-speaking-media';

const ready=(reply:NativeMediaReply)=>reply.state==='READY'||reply.state==='READING';
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
/** AVRecorder byte adapter only. No microphone request, persistence or upload.
 * The caller owns the visible permission gesture and durable local-save result. */
export class NativeAacRecorder {
 readonly mimeType='audio/mp4';
 readonly captureImplementation='harmony-avrecorder-aac' as const;
 state:'inactive'|'recording'='inactive';
 ondataavailable:((event:{data:Blob})=>void)|null=null;
 onstop:(()=>void)|null=null;
 onerror:(()=>void)|null=null;
 onstatus:((message:string)=>void)|null=null;
 onpending:((message:string)=>void)|null=null;
 durationSeconds=0;
 captureIssue='';
 private channel:NativeMediaChannel|null=null;
 private started=false;
 private detached=false;
 private ending=false;
 private hash='';
 private length=0;
 private confirmedSave=false;
 private acknowledged=false;
 private emitted=false;
 private assembling:Uint8Array<ArrayBuffer>|null=null;
 private assemblyIdentity='';
 private nextReadIndex=0;
 private retrying=false;
 constructor(private maxSeconds:number,private generation:number,private current:()=>boolean,private connect:NativeMediaConnector=connectNativeSpeakingMedia){}
 private live=()=>!this.detached&&this.current();
 private assertCurrent(){if(!this.live())throw new NativeMediaError('STALE_GENERATION');}
 async start(_timeslice?:number):Promise<void>{
  if(this.started)throw new NativeMediaError('BUSY');this.started=true;this.assertCurrent();
  const connection=await this.connect(this.live);
  if(!this.live()){connection.port.close();throw new NativeMediaError('STALE_GENERATION');}
  this.channel=new NativeMediaChannel(connection,crypto.randomUUID(),this.generation,this.live);
  const maxDurationMs=Math.min(NATIVE_MEDIA_MAX_MS,Math.max(1,Math.round(this.maxSeconds*1000)));
  let reply:NativeMediaReply;
  try{reply=(await this.channel.request('start',{maxDurationMs})).reply;}
  catch(error){
   // A lost start reply is queried, never replayed or replaced by another start.
   if(!(error instanceof NativeMediaError)||!error.unknownResult)throw error;
   this.onstatus?.('原生录音启动结果尚未确认，正在查询本段录音。');
   try{reply=(await this.channel.request('query')).reply;}
   catch(queryError){this.ending=true;this.fail(queryError);return;}
  }
  this.assertCurrent();
  if(reply.state==='STARTED'&&!reply.errorCode){this.state='recording';return;}
  if(ready(reply)||reply.state==='FINALIZING'){this.ending=true;void this.finishFrom(reply);return;}
  throw new NativeMediaError(reply.errorCode||'START_FAILED');
 }
 stop():void{
  if(this.state!=='recording'||this.ending)return;
  this.state='inactive';this.ending=true;
  void this.stopAndRead();
 }
 private async stopAndRead():Promise<void>{
  try{
   this.assertCurrent();const channel=this.channel;if(!channel)throw new NativeMediaError('UNSUPPORTED');
   let reply:NativeMediaReply;
   try{reply=(await channel.request('stop')).reply;}
   catch(error){if(!(error instanceof NativeMediaError)||!error.unknownResult)throw error;reply=(await channel.request('query')).reply;}
   await this.readFinalized(reply);
  }catch(error){this.fail(error);}
 }
 private async finishFrom(reply:NativeMediaReply):Promise<void>{try{await this.readFinalized(reply);}catch(error){this.fail(error);}}
 private async readFinalized(initial:NativeMediaReply):Promise<void>{
  const channel=this.channel;if(!channel)throw new NativeMediaError('UNSUPPORTED');
  let reply=initial;
  const absoluteDeadline=Date.now()+600000;
  if(reply.state==='FINALIZING')this.onstatus?.('原生录音仍在整理，正在查询同一段结果。');
  while(reply.state==='FINALIZING'){
   this.assertCurrent();if(Date.now()>=absoluteDeadline)throw new NativeMediaError('FINALIZE_FAILED',true);
   await pause(500);reply=(await channel.request('query')).reply;
  }
  this.assertCurrent();
  if(!ready(reply))throw new NativeMediaError(reply.errorCode||'FINALIZE_FAILED',reply.state==='STARTED');
  const total=reply.totalBytes!,chunks=reply.totalChunks!,hash=reply.sha256!;
  if(total<1||total>NATIVE_MEDIA_MAX_BYTES)throw new NativeMediaError('SIZE_LIMIT');
  const identity=JSON.stringify([total,chunks,hash,reply.durationMs]);
  if(this.assemblyIdentity&&this.assemblyIdentity!==identity)throw new NativeMediaError('READ_FAILED');
  if(!this.assembling){this.assembling=new Uint8Array(total);this.assemblyIdentity=identity;}
  const all=this.assembling;let offset=this.nextReadIndex*NATIVE_MEDIA_CHUNK_BYTES;
  for(let index=this.nextReadIndex;index<chunks;index++){
   this.assertCurrent();
   let message;
   try{message=await channel.request('readChunk',{index});}
   catch(error){
    if(!(error instanceof NativeMediaError)||!error.unknownResult)throw error;
    const snapshot=(await channel.request('query')).reply;
    if(!ready(snapshot)||snapshot.totalBytes!==total||snapshot.totalChunks!==chunks||snapshot.sha256!==hash)throw new NativeMediaError('READ_FAILED');
    // Exactly the already requested index, never an implicit next block.
    message=await channel.request('readChunk',{index});
   }
   this.assertCurrent();
   const {reply:part,bytes}=message;
   if(!bytes||part.index!==index||part.totalBytes!==total||part.totalChunks!==chunks||part.sha256!==hash||
    part.mime!=='audio/mp4'||bytes.byteLength!==Math.min(NATIVE_MEDIA_CHUNK_BYTES,total-offset))throw new NativeMediaError('READ_FAILED');
   all.set(bytes,offset);offset+=bytes.byteLength;this.nextReadIndex=index+1;
  }
  if(offset!==total||total<16||new DataView(all.buffer).getUint32(4,false)!==0x66747970)throw new NativeMediaError('READ_FAILED');
  const digest=await crypto.subtle.digest('SHA-256',all.buffer);this.assertCurrent();
  const actual=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  if(actual!==hash)throw new NativeMediaError('READ_FAILED');
  this.hash=hash;this.length=total;this.durationSeconds=reply.durationMs!/1000;
  const blob=new Blob([all],{type:'audio/mp4'});this.assertCurrent();
  if(this.emitted)throw new NativeMediaError('READ_FAILED');this.emitted=true;
  this.assembling=null;this.ondataavailable?.({data:blob});this.onstop?.();
 }
 async retryResult():Promise<void>{
  if(this.retrying||this.emitted)return;this.retrying=true;
  try{
   this.assertCurrent();const channel=this.channel;if(!channel)throw new NativeMediaError('UNSUPPORTED');
   let reply=(await channel.request('query')).reply;
   // This is an explicit user retry. A still-STARTED capture has not accepted
   // stop yet; stop is never automatically replayed after an unknown response.
   if(reply.state==='STARTED')reply=(await channel.request('stop')).reply;
   await this.readFinalized(reply);
  }catch(error){this.fail(error);}finally{this.retrying=false;}
 }
 /** Called only after the existing owner-scoped addRecording has fulfilled. */
 async confirmSaved():Promise<void>{
  this.assertCurrent();if(this.acknowledged)return;if(!this.emitted||!this.hash||!this.length)throw new NativeMediaError('READ_FAILED');
  this.confirmedSave=true;const channel=this.channel;if(!channel)throw new NativeMediaError('UNSUPPORTED');
  let reply:NativeMediaReply;
  try{reply=(await channel.request('ack',{blobSha256:this.hash,byteLength:this.length})).reply;}
  catch(error){
   if(!(error instanceof NativeMediaError)||!error.unknownResult)throw error;
   reply=(await channel.request('query')).reply;
   if(reply.state==='READING'&&this.confirmedSave)reply=(await channel.request('ack',{blobSha256:this.hash,byteLength:this.length})).reply;
  }
  if(reply.state!=='ACKED')throw new NativeMediaError(reply.errorCode||'WRITE_FAILED',true);
  this.acknowledged=true;channel.close();
 }
 detach():void{this.detached=true;this.state='inactive';this.channel?.detach();}
 private fail(error:unknown):void{
  if(!this.live())return;
  if(error instanceof NativeMediaError&&error.unknownResult){
   this.state='inactive';
   this.onpending?.('原生录音结果尚未确认，原片保留。请查询并继续保存，或明确退出本段。');
   return;
  }
  this.state='inactive';this.captureIssue=nativeMediaMessage(error);this.onstatus?.(this.captureIssue);
  this.channel?.detach();
  // No partial bytes are emitted. The component's existing empty-result path
  // remains responsible for visible recovery, without creating a saved record.
  this.onerror?.();this.onstop?.();
 }
}
