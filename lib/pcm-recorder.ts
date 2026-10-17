/** PCM capture avoids the ArkWeb MediaRecorder/Opus mux path. No microphone is
 * opened here: the caller supplies and owns its already-authorized stream. */
export class PcmRecorder {
 readonly mimeType='audio/wav';
 state:'inactive'|'recording'='inactive';
 ondataavailable:((event:{data:Blob})=>void)|null=null;
 onstop:(()=>void)|null=null;
 onerror:(()=>void)|null=null;
 durationSeconds=0;
 captureIssue='';
 private context:AudioContext;
 private source:MediaStreamAudioSourceNode;
 private processor:ScriptProcessorNode;
 private silent:GainNode;
 private parts:Uint8Array<ArrayBuffer>[]=[];
 private samples=0;
 private began=0;
 private started=false;
 private released=false;
 private limit:number;
 constructor(stream:MediaStream,maxSeconds=120){
  this.context=new AudioContext({sampleRate:48000});
  try{
   if(!Number.isFinite(this.context.sampleRate)||this.context.sampleRate<8000||this.context.sampleRate>96000)throw Error('Unsupported recording sample rate');
   this.limit=Math.min(5999978,Math.floor(this.context.sampleRate*Math.min(120,Math.max(1,maxSeconds))));
   this.source=this.context.createMediaStreamSource(stream);
   // ScriptProcessor is retained for the currently shipped ArkWeb host. It
   // avoids a blob worklet/module CSP dependency; missing callbacks are detected.
   this.processor=this.context.createScriptProcessor(2048,1,1);
   this.silent=this.context.createGain();this.silent.gain.value=0;
   this.processor.onaudioprocess=event=>{
    if(this.state!=='recording')return;
    const input=event.inputBuffer.getChannelData(0);
    const count=Math.min(input.length,this.limit-this.samples);
    if(count<=0){this.captureIssue='录音达到时长上限，已停止。';this.stop();return;}
    const bytes=new Uint8Array(count*2),view=new DataView(bytes.buffer);
    for(let i=0;i<count;i++){const value=Number.isFinite(input[i])?Math.max(-1,Math.min(1,input[i])):0;view.setInt16(i*2,Math.round(value*(value<0?32768:32767)),true);}
    this.parts.push(bytes);this.samples+=count;
    if(this.samples>=this.limit){this.captureIssue='录音达到时长上限，已停止。';this.stop();}
   };
  }catch(error){void this.context.close().catch(()=>{});throw error;}
 }
 start(_timeslice?:number){
  if(this.started)throw Error('A recording instance cannot be restarted');
  this.started=true;this.began=Date.now();this.state='recording';
  try{this.source.connect(this.processor);this.processor.connect(this.silent);this.silent.connect(this.context.destination);}
  catch(error){this.state='inactive';this.release();throw error;}
  void this.context.resume().catch(()=>{if(this.state==='recording'){this.captureIssue='录音输入未能启动，请重新准备。';this.onerror?.();if(this.state==='recording')this.stop();}});
 }
 private release(){
  if(this.released)return;this.released=true;this.processor.onaudioprocess=null;
  for(const node of [this.source,this.processor,this.silent]){try{node.disconnect();}catch{/* already disconnected */}}
  void this.context.close().catch(()=>{});
 }
 stop(){
  if(this.state!=='recording')return;
  this.state='inactive';this.durationSeconds=this.samples/this.context.sampleRate;
  const elapsed=(Date.now()-this.began)/1000;
  // A scheduling/device interruption must not turn a fraction of a second into
  // a successful multi-second recording. Keep the actual bytes for recovery.
  if(elapsed>=1&&this.durationSeconds<elapsed-Math.max(.5,elapsed*.15))this.captureIssue='录音输入中断，实际音频短于本次录制时间。请回听确认后重新录制。';
  this.release();
  const header=new ArrayBuffer(44),view=new DataView(header),ascii=(offset:number,text:string)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
  ascii(0,'RIFF');view.setUint32(4,36+this.samples*2,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,this.context.sampleRate,true);view.setUint32(28,this.context.sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,this.samples*2,true);
  // No frames is not a 44-byte "successful recording".
  const blob=this.samples?new Blob([header,...this.parts],{type:this.mimeType}):new Blob([],{type:this.mimeType});this.parts=[];
  queueMicrotask(()=>{try{this.ondataavailable?.({data:blob});}finally{this.onstop?.();}});
 }
}

export type RecordingCapture=MediaRecorder|PcmRecorder;
export function createRecordingCapture(stream:MediaStream,nativeMode:boolean,maxSeconds:number):RecordingCapture {
 if(nativeMode)return new PcmRecorder(stream,maxSeconds);
 const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
 return new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
}
export function captureDuration(recorder:RecordingCapture|null,elapsedSeconds:number){
 return recorder instanceof PcmRecorder?recorder.durationSeconds:elapsedSeconds;
}
export function captureWarning(recorder:RecordingCapture|null){return recorder instanceof PcmRecorder?recorder.captureIssue:'';}
