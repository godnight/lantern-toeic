import index from '@/content/dictionary-legacy-ids.json';
import {mergeVocabularyEvents,type VocabularyEvent} from './vocabulary-model';

// Proven identity aliases only. This index contains no definitions or audio data.
const aliases=new Map<string,string>();
const canonicalIds=new Set<string>();
if(index.schemaVersion!==1||Object.keys(index).some(key=>!['schemaVersion','aliases'].includes(key)))throw Error('词典历史标识索引不支持。');
for(const [legacy,canonical] of Object.entries(index.aliases)){
 if(!/^dict-[a-f0-9]{20}$/.test(legacy)||!/^v041-word-[a-f0-9]{20}$/.test(canonical)||legacy.slice(5)!==canonical.slice(10)||canonicalIds.has(canonical))throw Error('词典历史标识索引冲突。');
 aliases.set(legacy,canonical);canonicalIds.add(canonical);
}
if(aliases.size!==1346)throw Error('词典历史标识索引不完整。');
export const DICTIONARY_LEGACY_ALIAS_COUNT=aliases.size;
export function canonicalVocabularyWordId(wordId:string):string{return aliases.get(wordId)??wordId;}

/** Derived view only. Keep event IDs and source facts intact, including backups. */
export function projectDictionaryVocabularyEvents(events:readonly VocabularyEvent[]):VocabularyEvent[]{
 // Resolve immutable event-ID conflicts before projection; aliasing must never
 // make two originally different facts look like the same imported event.
 return mergeVocabularyEvents([],[...events]).map(event=>{
  const wordId=canonicalVocabularyWordId(event.wordId);
  return wordId===event.wordId?event:{...event,wordId};
 });
}
export function nextVocabularyMarkRevision(events:readonly VocabularyEvent[],wordId:string):number{
 const canonical=canonicalVocabularyWordId(wordId);let revision=0;
 for(const event of events)if(event.type==='mark'&&canonicalVocabularyWordId(event.wordId)===canonical)revision=Math.max(revision,event.revision);
 if(!Number.isSafeInteger(revision+1))throw Error('词库标记版本超出支持范围，原记录未改动。');
 return revision+1;
}
