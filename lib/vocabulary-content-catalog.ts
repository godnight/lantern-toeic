import {searchText,type Word} from './vocabulary-model';
import {completeVocabularyCatalogSynchronously} from './vocabulary-content-admission';
import {readPreparedVocabularyCatalog,installServerVocabularyCatalog} from './prepare-vocabulary-catalog';
import {isPrivatePronunciationHold,isPrivateWordAudioBlocked,getWordAudioBindingForSnapshot,PRIVATE_AUDIO_LABEL} from './word-audio-bindings-v040';
export {isPrivatePronunciationHold,isPrivateWordAudioBlocked,PRIVATE_AUDIO_LABEL};
export type {CurrentTeachingEntry} from './prepare-vocabulary-catalog';
// Browser callers are loaded only after the shared preparation has succeeded.
// A missed gate throws pending; it must never silently start a synchronous scan.
const catalog=typeof window==='undefined'?installServerVocabularyCatalog(completeVocabularyCatalogSynchronously):readPreparedVocabularyCatalog();
export const {FULL4109_SOURCE_ENTRY_SHA256,FULL4109_CURRENT_MODE,FULL4109_CURRENT_LEARNING_ENTRIES,FULL4109_CURRENT_WORDS,FULL4109_CATALOG_STATUS,B02_PRIVATE_LEARNING_ENTRIES,LEGACY_PRIVATE_WORDS,B02_PRIVATE_WORDS,LEGACY_PRIVATE_PLAYABLE_WORD_IDS,B02_CONTENT_HOLDS}=catalog;
const byKey=new Map((FULL4109_CURRENT_MODE?FULL4109_CURRENT_WORDS:LEGACY_PRIVATE_WORDS).map(word=>[searchText(word.word),word]));
export function getPrivateCandidateLearningWord(word:Word):Word|null{return isPrivateWordAudioBlocked(word)?null:byKey.get(searchText(word.word))??null;}
export function getPrivateWordAudioLabel(word:Word):string|null{return getWordAudioBindingForSnapshot(word,'headword')&&getWordAudioBindingForSnapshot(word,'example')?PRIVATE_AUDIO_LABEL:null;}
