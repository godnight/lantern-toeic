import {SCENE_WORDS,EXPRESSION_WORDS,WORKFLOW_WORDS,WORKFLOW_BOOKS,importedCatalogs,reusableWords} from './learning-word-views';
export {SCENE_WORDS,EXPRESSION_WORDS,WORKFLOW_WORDS,WORKFLOW_BOOKS} from './learning-word-views';
import {FULL4109_CURRENT_MODE,getPrivateCandidateLearningWord,isPrivateWordAudioBlocked} from './vocabulary-content-catalog';
import {searchText, type Word} from './vocabulary-model';
import {isMemberWordbookId,type MemberWordbookId} from './wordbook-membership';

export type WorkflowBookId = 'scene' | 'expressions' | MemberWordbookId;
const existingByKey=new Map(WORKFLOW_WORDS.map(word=>[searchText(word.word),word]));
const reusableById=new Map(reusableWords.map(word=>[word.id,word]));
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
