import core from '../content/vocabulary.json';
import expansion from '../content/vocabulary-expansion.json';
import questions from '../content/questions.json';
import reusable from '../content/wordlists/legacy-reusable-ids.json';
import {B02_PRIVATE_WORDS,LEGACY_PRIVATE_WORDS,FULL4109_CURRENT_MODE,FULL4109_CURRENT_WORDS,LEGACY_PRIVATE_PLAYABLE_WORD_IDS,getPrivateCandidateLearningWord,isPrivateWordAudioBlocked} from './vocabulary-content-catalog';
import {searchText, type Word} from './vocabulary-model';
import {MEMBER_WORDBOOKS,belongsToWordbook,isMemberWordbookId,type MemberWordbookId} from './wordbook-membership';

export type WorkflowBookId = 'scene' | 'expressions' | MemberWordbookId;
// Preserve every existing identity and both legacy catalog meanings verbatim.
export const SCENE_WORDS: Word[] = [...core as Word[], ...expansion.map(word => ({...word, example:'', translation:'', collocation:'', source:'lantern-expansion' as const}))];
export const EXPRESSION_WORDS: Word[] = [];
for (const question of questions) for (const word of question.vocabulary || []) {
  if (!(core as Word[]).some(row => searchText(row.word) === searchText(word.word)) && !EXPRESSION_WORDS.some(row => searchText(row.word) === searchText(word.word))) {
    EXPRESSION_WORDS.push({id:'qv-'+word.word.toLowerCase().replace(/[^a-z0-9]+/g,'-'), word:word.word, pos:'词汇与表达', meaning:word.meaning, category:'questions', example:word.example, translation:'', collocation:''});
  }
}
const legacyWorkflowWords=[...SCENE_WORDS,...EXPRESSION_WORDS];
// Current catalogs choose the reviewed snapshot. Historical identities and
// meanings stay available to persisted facts, sessions and receipts verbatim.
const historyWords=[...legacyWorkflowWords,...LEGACY_PRIVATE_WORDS.filter(word=>!legacyWorkflowWords.some(old=>old.id===word.id))];
const historyIds=new Set(historyWords.map(word=>word.id));
export const WORKFLOW_WORDS:Word[]=[...historyWords,...FULL4109_CURRENT_WORDS.filter(word=>!historyIds.has(word.id))];
const existingByKey=new Map(WORKFLOW_WORDS.map(word=>[searchText(word.word),word]));
const reusableIds=new Set(reusable.wordIds);
const reusableWords=(core as Word[]).filter(word=>LEGACY_PRIVATE_PLAYABLE_WORD_IDS.includes(word.id)&&!isPrivateWordAudioBlocked(word)&&reusableIds.has(word.id)&&[word.pos,word.meaning,word.example,word.translation].every(value=>!!value.trim()));
const reusableById=new Map(reusableWords.map(word=>[word.id,word]));
const importedLearningWords=FULL4109_CURRENT_MODE?FULL4109_CURRENT_WORDS:[...new Map([...reusableWords,...B02_PRIVATE_WORDS].map(word=>[word.id,word])).values()];
const importedCatalogs=new Map(MEMBER_WORDBOOKS.map(book=>[book.id,importedLearningWords.filter(word=>belongsToWordbook(word.word,book.id))]));
const privateWordIds=new Set(B02_PRIVATE_WORDS.map(word=>word.id));
export const WORKFLOW_BOOKS: {id:WorkflowBookId;name:string;capacity:number;memberCount:number;pendingCount:number;imported:boolean;legacyPracticeCount?:number;privateCandidateCount?:number}[] = [
  {id:'scene', name:'托业场景词', capacity:SCENE_WORDS.length,memberCount:SCENE_WORDS.length,pendingCount:0,imported:false},
  {id:'expressions', name:'题内表达', capacity:EXPRESSION_WORDS.length,memberCount:EXPRESSION_WORDS.length,pendingCount:0,imported:false},
  ...MEMBER_WORDBOOKS.map(book=>({id:book.id,name:book.title,capacity:importedCatalogs.get(book.id)!.length,memberCount:book.count,pendingCount:book.count-importedCatalogs.get(book.id)!.length,imported:true,privateCandidateCount:importedCatalogs.get(book.id)!.filter(word=>privateWordIds.has(word.id)).length,legacyPracticeCount:importedCatalogs.get(book.id)!.filter(word=>!privateWordIds.has(word.id)).length})),
];
export function isWorkflowBookId(value:unknown):value is WorkflowBookId{return value==='scene'||value==='expressions'||isMemberWordbookId(value);}
export function getWorkflowBook(id:WorkflowBookId){const book=WORKFLOW_BOOKS.find(book=>book.id===id);if(!book)throw Error('不支持的词书，原计划保留。');return book;}
export function getWorkflowCatalog(bookId:WorkflowBookId = 'scene'): Word[] {
  if(bookId==='scene')return SCENE_WORDS;
  if(bookId==='expressions')return EXPRESSION_WORDS;
  const words=isMemberWordbookId(bookId)?importedCatalogs.get(bookId):undefined;
  if(!words)throw Error('不支持的词书，原计划保留。');
  return words;
}
/** New candidate admission reuses the shipped teaching identity; membership alone is insufficient. */
export function getCandidateLearningWord(word:Word):Word|null {
  if(isPrivateWordAudioBlocked(word))return null;
  const reviewed=getPrivateCandidateLearningWord(word);if(reviewed)return reviewed;
  // Current member/context admission is exhaustive. Old reusable playback is
  // historical capability, never a substitute for a held current teaching pair.
  if(FULL4109_CURRENT_MODE)return null;
  const canonical=existingByKey.get(searchText(word.word));
  return canonical?reusableById.get(canonical.id)??null:null;
}
export const CANDIDATE_CONTENT_PENDING='此词仍可查阅和收藏；完整教学内容或离线发音待补，暂不加入新学计划。';
