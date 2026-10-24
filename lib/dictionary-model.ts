import {projectDictionaryVocabularyEvents} from './dictionary-legacy-ids';
import {searchText, vocabularyState, type VocabularyEvent, type Word} from './vocabulary-model';

export type DictionaryEntry = {id:string;word:string;phonetics:string[];senses:{pos:string;meaning:string}[];etymology?:string;forms?:string[]};
export type DictionaryPayload = {schemaVersion:1;source:string;entries:DictionaryEntry[]};
const string = (value:unknown, max:number):value is string => typeof value === 'string' && value.length <= max;

export function parseDictionary(input:unknown):DictionaryPayload {
  const value=input as DictionaryPayload;
  if(!value || value.schemaVersion!==1 || !string(value.source,100) || !Array.isArray(value.entries) || value.entries.length>150000) throw Error('词典格式不支持。');
  const ids=new Set<string>(), words=new Set<string>();
  for(const row of value.entries){
    if(!row || !/^dict-[a-f0-9]{20}$/.test(row.id) || !string(row.word,120) || !row.word.trim() || !Array.isArray(row.phonetics) || row.phonetics.length>4 || !row.phonetics.every(p=>string(p,200)) || !Array.isArray(row.senses) || !row.senses.length || row.senses.length>8 || !row.senses.every(s=>s&&string(s.pos,80)&&string(s.meaning,2000)&&s.meaning.trim()) || (row.etymology!==undefined&&!string(row.etymology,1600)) || (row.forms!==undefined&&(!Array.isArray(row.forms)||row.forms.length>12||!row.forms.every(f=>string(f,120))))) throw Error('词典包含无效词条。');
    const key=searchText(row.word);
    if(ids.has(row.id)||words.has(key)) throw Error('词典包含重复词条。');
    ids.add(row.id);words.add(key);
  }
  return value;
}

// The authored words keep their IDs and learning definitions across dictionary updates.
export function mergeWordCatalog(base:Word[], dictionary:DictionaryEntry[]):Word[] {
  const byWord=new Map(dictionary.map(row=>[searchText(row.word),row]));
  const used=new Set<string>();
  const result=base.map(word=>{
    const key=searchText(word.word), extra=byWord.get(key);used.add(key);
    return extra?{...word,phonetics:extra.phonetics,senses:extra.senses,etymology:extra.etymology,forms:extra.forms}:word;
  });
  for(const row of dictionary){
    if(used.has(searchText(row.word)))continue;
    result.push({...row,meaning:row.senses[0].meaning,pos:row.senses[0].pos,category:'dictionary',example:'',translation:'',collocation:'',source:'wiktionary'});
  }
  return result;
}

export function indexDictionary(words:Word[]){
  return words.map(word=>({word,key:searchText(word.word),text:searchText([word.word,word.meaning,...(word.senses||[]).map(s=>s.meaning),...(word.forms||[])].join(' '))}));
}
export function findDictionary(index:ReturnType<typeof indexDictionary>, query:string):Word[]{
  const key=searchText(query);
  if(!key)return [];
  const terms=key.split(' ');
  const matches=index.filter(row=>terms.every(term=>row.text.includes(term)));
  const rank=(value:string)=>value===key?0:value.startsWith(key)?1:value.includes(key)?2:3;
  matches.sort((a,b)=>rank(a.key)-rank(b.key)||a.key.length-b.key.length||a.key.localeCompare(b.key,'en'));
  return matches.map(row=>row.word);
}

// Group once: a large dictionary must not scan every event for every headword.
export function vocabularyStates(events:VocabularyEvent[]){
  const groups=new Map<string,VocabularyEvent[]>();
  for(const event of projectDictionaryVocabularyEvents(events)){const group=groups.get(event.wordId)||[];group.push(event);groups.set(event.wordId,group);}
  return new Map([...groups].map(([id,rows])=>[id,vocabularyState(rows,id)]));
}
export const emptyVocabularyState={starred:false,revision:0,level:0,due:0,reviews:0};
