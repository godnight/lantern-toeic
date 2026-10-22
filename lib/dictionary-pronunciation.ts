/** Optional, explicit dictionary headword speech. Never a natural-audio fallback
 * for teaching, speaking demonstrations, held pronunciations or recordings. */
export type LocalSpeechVoice=Pick<SpeechSynthesisVoice,'voiceURI'|'name'|'lang'|'localService'|'default'>;
export type LocalSpeechEngine=Pick<SpeechSynthesis,'getVoices'|'speak'|'cancel'>;
export type DictionarySpeechState=Readonly<{
 phase:'unavailable'|'ready'|'queued'|'speaking'|'ended'|'stopped'|'error';
 available:boolean;
 reason:'unsupported'|'no-local-english-voice'|'invalid-headword'|'inactive'|'engine-error'|'start-unconfirmed'|'stop-unconfirmed'|null;
 language:string|null;
}>;
export type DictionarySpeechEnvironment={
 engine:LocalSpeechEngine|null;
 createUtterance:(text:string)=>SpeechSynthesisUtterance;
 isActive:()=>boolean;
 stopOtherAudio:()=>void;
 changed:(state:DictionarySpeechState)=>void;
 setTimer?:(callback:()=>void,milliseconds:number)=>unknown;
 clearTimer?:(timer:unknown)=>void;
};

/** Do not accept a remote/default voice merely because it speaks English. */
export function selectLocalEnglishVoice(voices:readonly LocalSpeechVoice[]):LocalSpeechVoice|null{
 return voices.filter(voice=>voice.localService===true&&typeof voice.lang==='string'&&/^en(?:[-_]|$)/i.test(voice.lang))
  .slice().sort((a,b)=>Number(b.default)-Number(a.default)||a.lang.localeCompare(b.lang)||a.voiceURI.localeCompare(b.voiceURI))[0]??null;
}
export function validDictionaryHeadword(text:string):boolean{
 return typeof text==='string'&&text===text.trim()&&text.length>0&&text.length<=256&&/[A-Za-z]/.test(text)&&!/[\u0000-\u001f\u007f<>]/.test(text);
}

/** This controller owns at most one utterance. Construction/import never speaks.
 * A queued call is not reported as playing until the engine sends onstart. */
export class DictionarySpeechController{
 private state:DictionarySpeechState={phase:'unavailable',available:false,reason:'unsupported',language:null};
 private current:SpeechSynthesisUtterance|null=null;
 private sequence=0;
 private disposed=false;
 private startTimer:unknown=null;
 constructor(private environment:DictionarySpeechEnvironment){}
 getSnapshot=()=>this.state;
 private update(next:DictionarySpeechState){if(this.disposed)return;this.state=Object.freeze(next);this.environment.changed(this.state);}
 private clearStartTimer(){if(this.startTimer!==null){(this.environment.clearTimer??(timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)))(this.startTimer);this.startTimer=null;}}
 private voices():LocalSpeechVoice[]{try{return this.environment.engine?.getVoices()??[];}catch{return [];}}
 refresh(){
  if(this.disposed)return this.state;
  const voice=selectLocalEnglishVoice(this.voices());
  if(!this.environment.engine){this.update({phase:'unavailable',available:false,reason:'unsupported',language:null});return this.state;}
  if(!voice){if(!this.cancelCurrent())return this.state;this.update({phase:'unavailable',available:false,reason:'no-local-english-voice',language:null});return this.state;}
  if(this.current)return this.state;
  this.update({phase:'ready',available:true,reason:null,language:voice.lang});return this.state;
 }
 private cancelCurrent(){
  const current=this.current;this.clearStartTimer();
  if(current){try{this.environment.engine?.cancel();}catch{this.update({...this.state,phase:'error',available:false,reason:'stop-unconfirmed'});return false;}}
  this.sequence++;this.current=null;
  if(current){current.onstart=null;current.onend=null;current.onerror=null;}
  return true;
 }
 start(text:string):boolean{
  if(this.disposed||this.current)return false;
  if(!validDictionaryHeadword(text)){this.update({...this.state,phase:'error',reason:'invalid-headword'});return false;}
  if(!this.environment.isActive()){this.update({...this.state,phase:'error',reason:'inactive'});return false;}
  const engine=this.environment.engine,voice=selectLocalEnglishVoice(this.voices());
  if(!engine||!voice){this.refresh();return false;}
  try{
   // Dispatch the shared stop boundary before owning a new utterance. Its event
   // listener is allowed to cancel this controller's previous idle state.
   this.environment.stopOtherAudio();
   if(!this.environment.isActive()){this.update({...this.state,phase:'error',reason:'inactive'});return false;}
   const utterance=this.environment.createUtterance(text),token=++this.sequence;
   utterance.voice=voice as SpeechSynthesisVoice;utterance.lang=voice.lang;utterance.rate=1;utterance.pitch=1;utterance.volume=1;
   this.current=utterance;
   let started=false;
   const valid=()=>!this.disposed&&this.sequence===token&&this.current===utterance;
   const finish=(reason:DictionarySpeechState['reason'])=>{
    if(!valid())return;this.clearStartTimer();this.current=null;this.sequence++;
    utterance.onstart=null;utterance.onend=null;utterance.onerror=null;
    this.update({phase:reason?'error':'ended',available:true,reason,language:voice.lang});
   };
   utterance.onstart=()=>{if(!valid())return;if(!this.environment.isActive()){this.stop();return;}started=true;this.clearStartTimer();this.update({phase:'speaking',available:true,reason:null,language:voice.lang});};
   utterance.onend=()=>finish(started?null:'start-unconfirmed');
   utterance.onerror=()=>finish('engine-error');
   this.update({phase:'queued',available:true,reason:null,language:voice.lang});
   this.startTimer=(this.environment.setTimer??setTimeout)(()=>{if(!valid()||!this.cancelCurrent())return;this.update({phase:'error',available:true,reason:'start-unconfirmed',language:voice.lang});},2000);
   engine.speak(utterance);
   return true;
  }catch{
   if(this.cancelCurrent())this.update({phase:'error',available:true,reason:'engine-error',language:voice.lang});return false;
  }
 }
 stop(){if(this.disposed)return;const active=!!this.current;if(this.cancelCurrent()&&active)this.update({...this.state,phase:'stopped',reason:null});}
 dispose(){if(this.disposed)return;this.cancelCurrent();this.disposed=true;const current=this.current;this.current=null;this.sequence++;if(current){current.onstart=null;current.onend=null;current.onerror=null;}}
}
