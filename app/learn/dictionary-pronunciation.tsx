'use client';
import {useEffect,useRef,useState} from 'react';
import {Play,Square} from 'lucide-react';
import type {Word} from '@/lib/vocabulary-model';
import {DictionarySpeechController,type DictionarySpeechState,type LocalSpeechEngine} from '@/lib/dictionary-pronunciation';
import {isNativeForeground,subscribeNativeState} from '@/lib/native-host';
import {naturalAudioRegistry,naturalLessonDescriptor,productLessonAudioState,retryProductLessonAudio,stopLessonAudio,subscribeProductLessonAudio} from '@/lib/lesson-audio';
import {getWordAudioBindingForSnapshot,isPrivateWordAudioBlocked,PRIVATE_AUDIO_LABEL} from '@/lib/word-audio-bindings-v040';
import {SpeechPlayer} from './practice';

const INITIAL:DictionarySpeechState={phase:'unavailable',available:false,reason:'unsupported',language:null};
const message=(state:DictionarySpeechState)=>state.phase==='queued'?'正在启动设备系统发音…':state.phase==='speaking'?'设备系统发音中':state.phase==='ended'?'设备系统发音已结束':state.phase==='stopped'?'设备系统发音已停止':state.reason==='no-local-english-voice'?'此设备未提供已安装的本地英语系统语音，当前词条暂不能发音。':state.reason==='unsupported'?'当前环境不支持设备本地系统发音，当前词条暂不能发音。':state.reason==='invalid-headword'?'当前词头不适合设备系统发音。':state.reason==='inactive'?'请返回当前词条后再发音。':state.reason==='start-unconfirmed'?'设备系统语音未能确认启动，请检查本机英语语音后重试。':state.reason==='stop-unconfirmed'?'设备系统语音未能确认停止，已暂停再次发音；请检查设备语音状态。':state.reason==='engine-error'?'设备系统语音未能播放，请检查本机英语语音后重试。':'仅使用此设备已安装的英语语音，不下载或调用在线语音。';

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
 return <div className="dictionary-system-pronunciation" data-dictionary-pronunciation="system-local">
  <p className="word-footnote">此词暂无已核自然音。设备系统发音是基本读音参考，不计为自然音覆盖。</p>
  <button type="button" className="button secondary" disabled={disabled||!state.available} onClick={()=>active?controller.current?.stop():controller.current?.start(text)} aria-label={active?'停止设备系统发音':'用设备系统发音'}>{active?<Square size={16}/>:<Play size={16}/>} {active?'停止设备系统发音':'用设备系统发音'}</button>
  <p className="word-footnote" role={state.phase==='error'?'alert':'status'}>{message(state)}</p>
 </div>;
}

/** This optional dictionary-only path never alters a teaching/speaking player. */
export function DictionaryPronunciation({word,disabled=false}:{word:Word;disabled?:boolean}){
 const [,revision]=useState(0);
 useEffect(()=>subscribeProductLessonAudio(()=>revision(value=>value+1)),[]);
 const binding=getWordAudioBindingForSnapshot(word,'headword'),selector={assetKey:binding?.audioKey,materialId:binding?.materialId??word.id,segmentId:binding?.segmentId??'headword',voiceProfileId:binding?.voiceProfileId};
 const natural=naturalLessonDescriptor(word.word,selector),availability=productLessonAudioState();
 if(isPrivateWordAudioBlocked(word)||!natural&&naturalAudioRegistry.isBlocked(word.word))return <p className="word-footnote" data-dictionary-pronunciation="held" role="status">此词发音待核对，当前不使用系统发音替代；原学习记录保留。</p>;
 if(natural)return <div data-dictionary-pronunciation="natural"><SpeechPlayer key={word.id} text={word.word} {...(binding??{materialId:word.id,segmentId:'headword'})} label="听单词发音" sourceLabel={binding?PRIVATE_AUDIO_LABEL:'词典自然音'}/></div>;
 if(availability.phase==='idle'||availability.phase==='preparing')return <p className="word-footnote" data-dictionary-pronunciation="preparing" role="status">正在核对自然音资源，尚未启动发音。</p>;
 if(availability.phase==='error')return <div data-dictionary-pronunciation="resource-error"><p className="word-footnote" role="alert">自然音资源核对失败，暂不启用系统替代。请先重试准备音频。</p><button type="button" className="text-button" disabled={disabled} onClick={()=>void retryProductLessonAudio()}>重试准备音频</button></div>;
 return <LocalSystemPronunciation key={word.id+':'+word.word} text={word.word} disabled={disabled}/>;
}
