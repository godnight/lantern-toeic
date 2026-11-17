'use client';
import {useEffect,useRef,useState} from 'react';
import {Volume2,Square,LoaderCircle} from 'lucide-react';
import type {Word} from '@/lib/vocabulary-model';
import {DictionarySpeechController,type DictionarySpeechState,type LocalSpeechEngine} from '@/lib/dictionary-pronunciation';
import {isNativeForeground,subscribeNativeState} from '@/lib/native-host';
import {naturalAudioRegistry,naturalLessonDescriptor,productLessonAudioState,retryProductLessonAudio,stopLessonAudio,subscribeProductLessonAudio} from '@/lib/lesson-audio';
import {getWordAudioBindingForSnapshot,isPrivateWordAudioBlocked,PRIVATE_AUDIO_LABEL} from '@/lib/word-audio-bindings-v040';
import {SpeechPlayer} from './practice';

const INITIAL:DictionarySpeechState={phase:'unavailable',available:false,reason:'unsupported',language:null};
const message=(state:DictionarySpeechState)=>state.phase==='queued'?'正在准备发音…':state.reason==='no-local-english-voice'?'设备未提供本地英语发音。':state.reason==='unsupported'?'此设备暂不支持系统发音。':state.reason==='invalid-headword'?'此词暂不能使用系统发音。':state.reason==='inactive'?'返回当前词条后可发音。':state.reason==='start-unconfirmed'?'未能播放，请检查设备英语语音。':state.reason==='stop-unconfirmed'?'未能停止，请先检查设备语音。':state.reason==='engine-error'?'发音失败，请重试。':'';

function LocalSystemPronunciation({text,disabled=false}:{text:string;disabled?:boolean}){
 const [state,setState]=useState<DictionarySpeechState>(INITIAL),controller=useRef<DictionarySpeechController|null>(null),blocked=useRef(disabled);blocked.current=disabled;
 useEffect(()=>{
  let alive=true;
  const engine:LocalSpeechEngine|null=typeof window.speechSynthesis?.getVoices==='function'&&typeof window.speechSynthesis?.speak==='function'&&typeof window.speechSynthesis?.cancel==='function'&&typeof window.SpeechSynthesisUtterance==='function'?window.speechSynthesis:null;
  const speech=new DictionarySpeechController({engine,createUtterance:value=>new SpeechSynthesisUtterance(value),isActive:()=>!blocked.current&&!document.hidden&&isNativeForeground(),stopOtherAudio:stopLessonAudio,changed:value=>{if(alive)setState(value);}});
  controller.current=speech;speech.refresh();
  const voices=()=>speech.refresh(),stop=()=>speech.stop(),visibility=()=>{if(document.hidden)stop();};
  window.speechSynthesis?.addEventListener?.('voiceschanged',voices);
  window.addEventListener('lantern-stop-lesson-audio',stop);window.addEventListener('pagehide',stop);document.addEventListener('visibilitychange',visibility);document.addEventListener('play',stop,true);
  const unsubscribeNative=subscribeNativeState(foreground=>{if(!foreground)stop();});
  return()=>{alive=false;controller.current=null;window.speechSynthesis?.removeEventListener?.('voiceschanged',voices);window.removeEventListener('lantern-stop-lesson-audio',stop);window.removeEventListener('pagehide',stop);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('play',stop,true);unsubscribeNative();speech.dispose();};
 },[text]);
 useEffect(()=>{if(disabled)controller.current?.stop();},[disabled]);
 const active=state.phase==='queued'||state.phase==='speaking';
 return <div className="dictionary-system-pronunciation speech-audio speech-audio--word" data-dictionary-pronunciation="system-local">
  <button type="button" className="speech-audio-icon" title="设备系统发音" disabled={disabled||!state.available} onClick={()=>active?controller.current?.stop():controller.current?.start(text)} aria-label={active?'停止设备系统发音':'用设备系统发音'} aria-busy={state.phase==='queued'||undefined}>{state.phase==='queued'?<LoaderCircle size={20} className="speech-audio-loading"/>:active?<Square size={18}/>:<Volume2 size={22}/>}</button>
  {message(state)&&<small className="speech-audio-feedback" role={state.phase==='error'?'alert':'status'}>{message(state)}</small>}
 </div>;
}

/** This optional dictionary-only path never alters a teaching/speaking player. */
export function DictionaryPronunciation({word,disabled=false}:{word:Word;disabled?:boolean}){
 const [,revision]=useState(0);
 useEffect(()=>subscribeProductLessonAudio(()=>revision(value=>value+1)),[]);
 const binding=getWordAudioBindingForSnapshot(word,'headword'),selector={assetKey:binding?.audioKey,materialId:binding?.materialId??word.id,segmentId:binding?.segmentId??'headword',voiceProfileId:binding?.voiceProfileId};
 const natural=naturalLessonDescriptor(word.word,selector),availability=productLessonAudioState();
 if(isPrivateWordAudioBlocked(word)||!natural&&naturalAudioRegistry.isBlocked(word.word))return <small className="speech-audio-feedback" data-dictionary-pronunciation="held" role="status">此词发音暂不可用。</small>;
 if(natural)return <div className="dictionary-word-audio" data-dictionary-pronunciation="natural"><SpeechPlayer key={word.id} text={word.word} {...(binding??{materialId:word.id,segmentId:'headword'})} label="单词发音" mode="word" disabled={disabled} sourceLabel={binding?PRIVATE_AUDIO_LABEL:'词典自然音'}/></div>;
 if(availability.phase==='idle'||availability.phase==='preparing')return <span className="speech-audio speech-audio--word" data-dictionary-pronunciation="preparing"><button type="button" className="speech-audio-icon" disabled aria-label="正在准备单词发音" aria-busy="true"><LoaderCircle size={20} className="speech-audio-loading"/></button><small className="speech-audio-feedback" role="status">正在准备发音…</small></span>;
 if(availability.phase==='error')return <span className="speech-audio speech-audio--word" data-dictionary-pronunciation="resource-error"><button type="button" className="speech-audio-icon" disabled={disabled} aria-label="重试准备单词发音" onClick={()=>void retryProductLessonAudio()}><Volume2 size={22}/></button><small className="speech-audio-feedback" role="alert">准备失败，请重试。</small></span>;
 return <LocalSystemPronunciation key={word.id+':'+word.word} text={word.word} disabled={disabled}/>;
}
