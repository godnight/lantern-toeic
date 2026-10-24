import referenceData from '@/content/word-card-reference.json';
import {searchText,type Word} from '@/lib/vocabulary-model';

type ReferenceSource={label:string;url:string;license?:string;licenseUrl?:string;attribution?:string;wordUrlPattern?:string};
type ReferenceEntry={phonetics:string[];etymology?:string;phoneticSource?:string;etymologySource?:string;phoneticSourceUrl?:string;etymologySourceUrl?:string;partOfSpeech?:'noun';overrideWordIds?:string[]};
type ReferenceIndex={sources:Record<string,ReferenceSource>;entries:Record<string,ReferenceEntry>};
const references=referenceData as ReferenceIndex;
const phonetics=(values?:string[])=>Array.from(new Set((values||[]).map(value=>value.trim()).filter(Boolean)));
const nounPartOfSpeech=(value:string)=>/^(?:n\.?|noun|名词)$/i.test(value.normalize('NFKC').trim());

/** Display-only enrichment: never replace a saved word, its ID or audio binding. */
export function getWordCardReference(word:Word){
  const key=searchText(word.word),candidate=references.entries[key];
  const matchesScope=!candidate?.partOfSpeech||candidate.partOfSpeech==='noun'&&nounPartOfSpeech(word.pos);
  // The shipped CV card once inherited the verb's IPA. Correct only this known
  // sense in the view; without its reviewed noun reference, show no guessed IPA.
  const knownCv=key==='resume'&&word.id==='v-resume'&&nounPartOfSpeech(word.pos)&&/(?:简历|履历)/.test(word.meaning);
  const extra=knownCv?(candidate?.partOfSpeech==='noun'&&candidate.overrideWordIds?.includes(word.id)?candidate:undefined):matchesScope?candidate:undefined;
  const ownPhonetics=knownCv?[]:phonetics(word.phonetics),ownEtymology=knownCv?undefined:word.etymology?.trim();
  const displayedPhonetics=ownPhonetics.length?ownPhonetics:phonetics(extra?.phonetics);
  const etymology=ownEtymology||extra?.etymology?.trim()||'';
  const sourceKeys=new Set<string>();
  if(!ownPhonetics.length&&displayedPhonetics.length&&extra?.phoneticSource)sourceKeys.add(extra.phoneticSource);
  if(!ownEtymology&&etymology&&extra?.etymologySource)sourceKeys.add(extra.etymologySource);
  const sources=Array.from(sourceKeys).flatMap(id=>{
    const source=references.sources[id];
    const entryUrl=(id===extra?.phoneticSource?extra.phoneticSourceUrl:undefined)||(id===extra?.etymologySource?extra.etymologySourceUrl:undefined);
    return source?[{...source,id,href:entryUrl||source.wordUrlPattern?.replace('{word}',encodeURIComponent(word.word.trim()))||source.url}]:[];
  });
  return {phonetics:displayedPhonetics,etymology,sources};
}
