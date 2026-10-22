import input from '../content/word-audio-bindings-v040.json';
import {canonicalHash,canonicalJson} from './domain-command';
import type {Word} from './vocabulary-model';
import {compiledBindingAdmission,compiledCvWordException,compiledIndexedBindingAdmission,naturalAudioBindingDigest} from './natural-audio-admission';

export const PRIVATE_AUDIO_LABEL='自然语音自动校验，未口音标定';
export const pronunciationHoldKey=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
export type WordAudioSelection={audioKey:string;materialId:string;segmentId:string;voiceProfileId:string;packId?:string;contextHash?:string};
export type WordAudioSnapshot=Pick<Word,'id'|'word'|'pos'|'meaning'|'example'|'translation'>;
export type WordAudioBinding={wordId:string;slot:'headword'|'example';textSha256:string;snapshotContextSha256:string;requestContextHash?:string;mp3Sha256?:string;packId?:string;audio:WordAudioSelection;privatePracticeEligible:boolean;formalAllowed:boolean;publishAllowed:boolean;humanListeningPerformed:boolean;validatedLocale:unknown};
type BindingTable={schemaVersion:number;packId:string;bindings:WordAudioBinding[];currentBindings?:WordAudioBinding[];globalPronunciationHoldKeys:string[]};
const data=input as unknown as BindingTable;
export const isPrivatePronunciationHold=(value:string)=>data.globalPronunciationHoldKeys.includes(pronunciationHoldKey(value));
export function wordAudioSnapshotContext(word:WordAudioSnapshot):string{return canonicalHash(canonicalJson({word:word.word,pos:word.pos,meaning:word.meaning,example:word.example,translation:word.translation}));}
const eligible=(row:WordAudioBinding)=>row.privatePracticeEligible===true&&row.formalAllowed===false&&row.publishAllowed===false&&row.humanListeningPerformed===false&&row.validatedLocale===null;
const key=(wordId:string,slot:string,textSha256:string,snapshotContextSha256:string)=>[wordId,slot,textSha256,snapshotContextSha256].join('\u0000');
function index(rows:WordAudioBinding[]):Map<string,WordAudioBinding[]>{const result=new Map<string,WordAudioBinding[]>();for(const row of rows){const id=key(row.wordId,row.slot,row.textSha256,row.snapshotContextSha256);const old=result.get(id);if(old)old.push(row);else result.set(id,[row]);}return result;}
const currentByKey=index(data.currentBindings??[]),legacyByKey=index(data.bindings);
function legacyBinding(wordId:string,slot:'headword'|'example',textSha256:string,snapshotContextSha256:string):{row:WordAudioBinding;packId:string;current:false}|null{
  const old=(legacyByKey.get(key(wordId,slot,textSha256,snapshotContextSha256))??[]).filter(eligible);
  if(old.length!==1)return null;
  if(data.packId.startsWith('v040-natural-')&&!compiledBindingAdmission(data.packId,old[0]))return null;
  return {row:old[0],packId:data.packId,current:false};
}
function binding(wordId:string,slot:'headword'|'example',textSha256:string,snapshotContextSha256:string):{row:WordAudioBinding;packId:string;current:boolean}|null{
  // An exact current key owns its choice. Invalid/duplicate current rows cannot
  // silently borrow an earlier audio context from the historical table.
  const id=key(wordId,slot,textSha256,snapshotContextSha256),current=currentByKey.get(id)??[];
  if(current.length){
    const row=current[0];
    return current.length===1&&eligible(row)&&typeof row.packId==='string'&&compiledIndexedBindingAdmission(row.packId,row)?{row,packId:row.packId,current:true}:null;
  }
  return legacyBinding(wordId,slot,textSha256,snapshotContextSha256);
}
/** Static compilation authority, independent of downloaded/resident shards. */
export function getCurrentWordAudioBindingForSnapshot(word:WordAudioSnapshot,slot:'headword'|'example'):WordAudioBinding|null{
  const chosen=binding(word.id,slot,canonicalHash(slot==='headword'?word.word:word.example),wordAudioSnapshotContext(word));
  if(!chosen?.current)return null;
  if(isPrivatePronunciationHold(word.word)&&(pronunciationHoldKey(word.word)!=='resume'||!compiledCvWordException(chosen.packId,chosen.row,word)))return null;
  return chosen.row;
}
export function getCurrentWordAudioBindingDigest(word:WordAudioSnapshot,slot:'headword'|'example'):string|null{
  const row=getCurrentWordAudioBindingForSnapshot(word,slot);return row?naturalAudioBindingDigest(row):null;
}
/** Explicit recovery of shipped selectors; current preferences never erase
 * the old context/profile/source route used by an existing playback receipt. */
export function getHistoricalWordAudioBindingForSnapshot(word:WordAudioSnapshot,slot:'headword'|'example'):WordAudioSelection|null{
  const chosen=legacyBinding(word.id,slot,canonicalHash(slot==='headword'?word.word:word.example),wordAudioSnapshotContext(word));if(!chosen)return null;
  if(isPrivatePronunciationHold(word.word)&&(pronunciationHoldKey(word.word)!=='resume'||!compiledCvWordException(chosen.packId,chosen.row,word)))return null;
  return {...chosen.row.audio,packId:chosen.packId,contextHash:chosen.row.requestContextHash};
}
/** Exact frozen text and sense context are mandatory; never persist selectors in old wordSnapshot rows. */
export function getWordAudioBinding(wordId:string,slot:'headword'|'example',textSha256:string,snapshotContextSha256:string):WordAudioSelection|null{
  const chosen=binding(wordId,slot,textSha256,snapshotContextSha256);if(!chosen)return null;
  return chosen.current?{...chosen.row.audio,packId:chosen.packId,contextHash:chosen.row.requestContextHash}:chosen.row.audio;
}
export function getWordAudioBindingForSnapshot(word:WordAudioSnapshot,slot:'headword'|'example'):WordAudioSelection|null{
  const chosen=binding(word.id,slot,canonicalHash(slot==='headword'?word.word:word.example),wordAudioSnapshotContext(word));if(!chosen)return null;
  if(isPrivatePronunciationHold(word.word)&&(pronunciationHoldKey(word.word)!=='resume'||!compiledCvWordException(chosen.packId,chosen.row,word)))return null;
  return chosen.current?{...chosen.row.audio,packId:chosen.packId,contextHash:chosen.row.requestContextHash}:chosen.row.audio;
}
/** Family HOLD remains default; CV exceptions bind both exact authored slots. */
export function isPrivateWordAudioBlocked(word:WordAudioSnapshot):boolean{
  return isPrivatePronunciationHold(word.word)&&!(getWordAudioBindingForSnapshot(word,'headword')&&getWordAudioBindingForSnapshot(word,'example'));
}
