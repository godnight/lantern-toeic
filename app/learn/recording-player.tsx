'use client';
import {useEffect,useRef,useState} from 'react';
import type {SyntheticEvent} from 'react';
import {subscribeNativeState} from '@/lib/native-host';
import {recordingMediaTrace} from '@/lib/recording-media-diagnostics';

type Phase='reading'|'ready'|'playing'|'paused'|'ended'|'unavailable'|'error';
type Lease={src:string;attempt:number;id:number;live:boolean;phase:Phase;retrying:boolean;timer:ReturnType<typeof setTimeout>|null;audio:HTMLAudioElement|null};
type View={lease:Lease;phase:Phase;message:string;code:number|null;retrying:boolean};
const mediaMessages:Record<number,string>={
 1:'播放已中断（媒体错误 1）。原录音保留，可重新读取。',
 2:'音频读取失败（媒体错误 2）。原录音保留，可重新读取。',
 3:'音频解码失败（媒体错误 3）。可能与文件内容或设备解码能力有关，原录音保留。',
 4:'当前播放器无法识别这个音频来源或格式（媒体错误 4）。原录音保留。'
};
const mediaMessage=(code:number|null)=>mediaMessages[code??0]||'音频加载或解码失败，未收到具体错误码。原录音保留，可重新读取。';

/** The parent owns this URL. Media state never releases or replaces its bytes. */
export function RecordingPlayer({src,autoPlay=false,className,label='回听录音',onRetry,downloadName}:{src:string;autoPlay?:boolean;className?:string;label?:string;onRetry?:()=>Promise<void>|void;downloadName?:string}){
 const audioRef=useRef<HTMLAudioElement|null>(null),sequence=useRef(0),owner=useRef<Lease|null>(null);
 const [attempt,setAttempt]=useState(0);
 if(!owner.current||owner.current.src!==src||owner.current.attempt!==attempt)owner.current={src,attempt,id:++sequence.current,live:true,phase:'reading',retrying:false,timer:null,audio:null};
 const lease=owner.current;
 const initial=():View=>({lease,phase:'reading',message:'正在读取录音音频信息…',code:null,retrying:false});
 const [state,setState]=useState<View>(initial),view=state.lease===lease?state:initial();
 const valid=()=>owner.current===lease&&lease.live;
 const update=(phase:Phase,message:string,code:number|null=null)=>{
  if(!valid())return;lease.phase=phase;
  setState(previous=>valid()?{lease,phase,message,code,retrying:lease.retrying}:previous);
 };
 const clearWait=()=>{if(lease.timer!==null){clearTimeout(lease.timer);lease.timer=null;}};
 const wait=()=>{
  clearWait();lease.timer=setTimeout(()=>{
   lease.timer=null;if(valid()&&lease.phase==='reading'){recordingMediaTrace('timeout',src,lease.audio);update('unavailable','暂未读取到可播放的音频信息，原因尚未确定。原录音保留，可重新读取。');}
  },10000);
 };
 const current=(event:SyntheticEvent<HTMLAudioElement>)=>valid()&&event.currentTarget===audioRef.current?event.currentTarget:null;
 useEffect(()=>{
  lease.live=true;lease.audio=audioRef.current;recordingMediaTrace('reading',src,lease.audio);wait();
  const globalStop=()=>{if(valid())recordingMediaTrace('global-stop',src,lease.audio);};
  const background=()=>{if(valid())recordingMediaTrace('native-background',src,lease.audio);};
  window.addEventListener('lantern-stop-lesson-audio',globalStop);window.addEventListener('pagehide',background);
  const unsubscribe=subscribeNativeState(active=>{if(!active)background();});
  return()=>{
   lease.live=false;clearWait();const audio=lease.audio;unsubscribe();window.removeEventListener('lantern-stop-lesson-audio',globalStop);window.removeEventListener('pagehide',background);
   // StrictMode immediately sets this same lease up again. Stop only a genuinely
   // retired element, and never read a later audioRef when releasing the old one.
   void Promise.resolve().then(()=>{if(!lease.live){recordingMediaTrace('retired',src,audio);audio?.pause();}});
  };
 },[lease]);
 const metadata=(event:SyntheticEvent<HTMLAudioElement>)=>{
  const audio=current(event);if(!audio)return;
  recordingMediaTrace(event.type,src,audio);
  if(audio.error){failure(event);return;}
  if(lease.phase==='error')return;
  if(audio.readyState<1)return;
  clearWait();
  if(Number.isFinite(audio.duration)&&audio.duration===0){update('unavailable','当前读取到的音频时长为 0，暂时无法播放。原录音保留，可重新读取。');return;}
  const known=Number.isFinite(audio.duration)&&audio.duration>0;
  update(!audio.paused?'playing':'ready',known?'音频信息已读取，可使用播放器回听。':'音频信息已读取，时长暂不可读；可使用播放器尝试播放。');
 };
 const failure=(event:SyntheticEvent<HTMLAudioElement>)=>{
  const audio=current(event);if(!audio)return;clearWait();
  recordingMediaTrace('error',src,audio);
  if(lease.phase==='error')return;
  const raw=audio.error?.code,code=typeof raw==='number'&&Number.isInteger(raw)&&raw>0?raw:null;
  update('error',mediaMessage(code),code);
 };
 const playing=(event:SyntheticEvent<HTMLAudioElement>)=>{const audio=current(event);if(!audio)return;recordingMediaTrace('playing',src,audio);if(audio.error||lease.phase==='error')return;clearWait();if(audio.readyState>=1&&Number.isFinite(audio.duration)&&audio.duration===0){update('unavailable','当前读取到的音频时长为 0，暂时无法播放。原录音保留，可重新读取。');return;}update('playing','正在回听录音。');};
 const paused=(event:SyntheticEvent<HTMLAudioElement>)=>{
  const audio=current(event);if(!audio)return;
  recordingMediaTrace('pause',src,audio);
  if(['error','unavailable'].includes(lease.phase))return;
  if(audio.ended){ended(event);return;}update('paused','回听已暂停，原录音保留。');
 };
 const ended=(event:SyntheticEvent<HTMLAudioElement>)=>{
  const audio=current(event);if(!audio)return;clearWait();
  recordingMediaTrace('ended',src,audio);
  if(lease.phase==='error')return;
  if(audio.duration===0&&audio.currentTime===0){update('unavailable','当前没有可播放的音频时长，原录音保留，可重新读取。');return;}
  update('ended','本次回听已结束。');
 };
 const waiting=(event:SyntheticEvent<HTMLAudioElement>)=>{const audio=current(event);if(!audio)return;recordingMediaTrace(event.type,src,audio);if(['error','unavailable'].includes(lease.phase))return;update('reading','正在等待录音音频，原文件保留…');wait();};
 const observe=(event:SyntheticEvent<HTMLAudioElement>)=>{const audio=current(event);if(audio)recordingMediaTrace(event.type,src,audio);};
 const retry=()=>{
  if(!valid()||lease.retrying)return;
  lease.retrying=true;recordingMediaTrace('retry',src,lease.audio);update('reading','正在重新读取录音…');wait();
  if(!onRetry){setAttempt(value=>value+1);return;}
  void Promise.resolve().then(()=>valid()?onRetry():undefined).catch(()=>{
   if(valid())update('error','未能重新读取音频，原录音和练习时间保留。');
  }).finally(()=>{
   if(valid()){lease.retrying=false;setState(previous=>valid()?{...previous,retrying:false}:previous);}
  });
 };
 const issue=view.phase==='error'||view.phase==='unavailable';
 return <div className="recording-playback">
  <audio key={lease.id} ref={audioRef} controls autoPlay={autoPlay} src={src} className={className} aria-label={label}
   onLoadStart={observe} onPlay={observe} onTimeUpdate={observe} onLoadedMetadata={metadata} onDurationChange={metadata} onCanPlay={metadata} onPlaying={playing} onPause={paused} onEnded={ended} onError={failure} onWaiting={waiting} onStalled={waiting}/>
  <p className="small muted" role="status">{issue?'原录音与练习时间保留。':view.message}</p>
  {downloadName&&<a href={src} download={downloadName} className="button secondary">下载原始录音</a>}
  {issue&&<div className="workspace-save-error" role="alert"><b>录音音频暂时无法播放</b><p>{view.message}</p><button type="button" className="button secondary" disabled={view.retrying} onClick={retry}>{view.retrying?'读取中…':'重新读取音频'}</button></div>}
 </div>;
}
