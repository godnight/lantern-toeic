import data from '../content/vocabulary-v040-b02-private.json';
import currentInput from '../content/vocabulary-full4109-private.json';
import {searchText,type Word} from './vocabulary-model';
import {canonicalHash} from './domain-command';
import {membershipKey} from './wordbook-membership';
import {isPrivatePronunciationHold,isPrivateWordAudioBlocked,getWordAudioBindingForSnapshot,getCurrentWordAudioBindingForSnapshot,getCurrentWordAudioBindingDigest,getHistoricalWordAudioBindingForSnapshot,PRIVATE_AUDIO_LABEL} from './word-audio-bindings-v040';
import type {CurrentTeachingEntry,VocabularyCatalogSnapshot} from './prepare-vocabulary-catalog';

type CurrentTable={schemaVersion:number;status:string;sourceEntrySha256?:string;targetMemberIds?:string[];acceptedTeachingEntries?:CurrentTeachingEntry[];heldMemberIds?:string[]};
export const FULL4109_SOURCE_ENTRY_SHA256='1a6c66de2c532981e62b57cc4dab9710d2dca756db98723c4e3b78d1a03d001d';
/** One complete validator, driven synchronously only by server compatibility,
 * or cooperatively by the browser readiness boundary. Never publishes a prefix. */
function* freezeSteps(value:unknown):Generator<void,void,void>{
 if(!value||typeof value!=='object')return;
 for(const child of Object.values(value))yield* freezeSteps(child);
 Object.freeze(value);yield;
}
export function* vocabularyCatalogSteps():Generator<void,VocabularyCatalogSnapshot,void>{
 yield* freezeSteps(currentInput);yield* freezeSteps(data);
 const current=currentInput as unknown as CurrentTable;
 const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 const FULL4109_CURRENT_MODE=!(current.schemaVersion===0&&current.status==='DISABLED');
 const configured=current.schemaVersion===1&&current.status==='PRIVATE_CURRENT_SOURCE_CANDIDATE'&&current.sourceEntrySha256===FULL4109_SOURCE_ENTRY_SHA256&&Array.isArray(current.targetMemberIds)&&Array.isArray(current.acceptedTeachingEntries)&&Array.isArray(current.heldMemberIds);
 const targets=new Set(configured?current.targetMemberIds:[]),holds=new Set(configured?current.heldMemberIds:[]);
 const entries=configured?current.acceptedTeachingEntries!:[];
 const countByMember=new Map<string,number>(),countById=new Map<string,number>();
 for(const row of entries){countByMember.set(row.memberId,(countByMember.get(row.memberId)??0)+1);countById.set(row.word?.id,(countById.get(row.word?.id)??0)+1);yield;}
 let partitionValid=configured&&targets.size===current.targetMemberIds!.length&&holds.size===current.heldMemberIds!.length&&targets.size===entries.length+holds.size;
 for(const member of holds){if(!targets.has(member))partitionValid=false;yield;}
 for(const row of entries){if(!targets.has(row.memberId)||holds.has(row.memberId))partitionValid=false;yield;}
function admitted(row:CurrentTeachingEntry):boolean{
  if(!partitionValid||countByMember.get(row.memberId)!==1||countById.get(row.word?.id)!==1||row.privatePracticeEligible!==true||row.formalAllowed!==false||row.publishAllowed!==false||row.humanListeningPerformed!==false||row.validatedLocale!==null||!sha(row.contextHash)||!sha(row.pairFingerprintSha256)||!sha(row.headwordBindingDigest)||!sha(row.exampleBindingDigest))return false;
  const word=row.word;
  if(!word||typeof word.id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(word.id)||typeof word.word!=='string'||membershipKey(word.word)!==row.memberId||![word.word,word.pos,word.meaning,word.example,word.translation].every(value=>typeof value==='string'&&!!value.trim())||typeof word.category!=='string'||typeof word.collocation!=='string')return false;
  const head=getCurrentWordAudioBindingForSnapshot(word,'headword'),example=getCurrentWordAudioBindingForSnapshot(word,'example');
  // Each slot carries its own exact provenance. Mixed engine/profile origins
  // are permitted only when both independently compiled bindings match.
  return !!head&&!!example&&head.requestContextHash===row.contextHash&&example.requestContextHash===row.contextHash&&head.audio.materialId===row.memberId&&example.audio.materialId===row.memberId&&head.audio.segmentId==='headword'&&example.audio.segmentId==='example'&&head.textSha256===canonicalHash(word.word)&&example.textSha256===canonicalHash(word.example)&&getCurrentWordAudioBindingDigest(word,'headword')===row.headwordBindingDigest&&getCurrentWordAudioBindingDigest(word,'example')===row.exampleBindingDigest;
}

 const FULL4109_CURRENT_LEARNING_ENTRIES:CurrentTeachingEntry[]=[];
 for(const row of entries){if(admitted(row))FULL4109_CURRENT_LEARNING_ENTRIES.push(row);yield;}
 const FULL4109_CURRENT_WORDS:Word[]=FULL4109_CURRENT_LEARNING_ENTRIES.map(row=>row.word);
 const FULL4109_CATALOG_STATUS={configured:!!configured,partitionValid:!!partitionValid,targetCount:targets.size,acceptedCount:FULL4109_CURRENT_WORDS.length,declaredAcceptedCount:entries.length,heldCount:holds.size,rejectedCount:entries.length-FULL4109_CURRENT_WORDS.length,sourceEntrySha256:current.sourceEntrySha256??null};
 const B02_PRIVATE_LEARNING_ENTRIES:typeof data.readyTeachingEntries=[];
 for(const row of data.readyTeachingEntries){if(row.privatePracticeEligible&&row.formalAllowed===false&&row.publishAllowed===false&&row.humanListeningPerformed===false&&row.validatedLocale===null&&getHistoricalWordAudioBindingForSnapshot(row.word,'headword')&&getHistoricalWordAudioBindingForSnapshot(row.word,'example'))B02_PRIVATE_LEARNING_ENTRIES.push(row);yield;}
 const LEGACY_PRIVATE_WORDS:Word[]=B02_PRIVATE_LEARNING_ENTRIES.map(row=>row.word);
 const B02_PRIVATE_WORDS:Word[]=[...new Map([...LEGACY_PRIVATE_WORDS,...FULL4109_CURRENT_WORDS].map(word=>[word.id,word])).values()];
 return {FULL4109_SOURCE_ENTRY_SHA256,FULL4109_CURRENT_MODE,FULL4109_CURRENT_LEARNING_ENTRIES,FULL4109_CURRENT_WORDS,FULL4109_CATALOG_STATUS,B02_PRIVATE_LEARNING_ENTRIES,LEGACY_PRIVATE_WORDS,B02_PRIVATE_WORDS,LEGACY_PRIVATE_PLAYABLE_WORD_IDS:data.legacyPrivatePlaybackWordIds,B02_CONTENT_HOLDS:data.pendingTeachingEntries};
}
export function completeVocabularyCatalogSynchronously():VocabularyCatalogSnapshot{
 const steps=vocabularyCatalogSteps();let next=steps.next();while(!next.done)next=steps.next();return next.value;
}
