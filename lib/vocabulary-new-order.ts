import type {Word} from './vocabulary-model';
// Project policy only: no claim of word-frequency or difficulty ranking.
export const VOCABULARY_NEW_ORDER='stable-mix-v1';
function score(text:string){let value=2166136261;for(let i=0;i<text.length;i++){value^=text.charCodeAt(i);value=Math.imul(value,16777619);}value^=value>>>16;value=Math.imul(value,0x7feb352d);value^=value>>>15;value=Math.imul(value,0x846ca68b);return (value^(value>>>16))>>>0;}
/** A full permutation independent of input order, clock, quota and plan revision. */
export function stableNewVocabularyOrder(words:readonly Word[],bookId:string):Word[]{
 return words.map(word=>({word,key:score(VOCABULARY_NEW_ORDER+'\0'+bookId+'\0'+word.id)})).sort((a,b)=>a.key-b.key||(a.word.id<b.word.id?-1:a.word.id>b.word.id?1:0)).map(row=>row.word);
}
