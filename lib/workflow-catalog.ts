import core from '../content/vocabulary.json';
import expansion from '../content/vocabulary-expansion.json';
import questions from '../content/questions.json';
import {searchText, type Word} from './vocabulary-model';

export type WorkflowBookId = 'scene' | 'expressions';
// Reuse the existing IDs verbatim. Text normalization is only used to reproduce
// the authored question-expression catalog, never to merge learning identities.
export const SCENE_WORDS: Word[] = [...core as Word[], ...expansion.map(word => ({...word, example:'', translation:'', collocation:'', source:'lantern-expansion' as const}))];
export const EXPRESSION_WORDS: Word[] = [];
for (const question of questions) for (const word of question.vocabulary || []) {
  if (!(core as Word[]).some(row => searchText(row.word) === searchText(word.word)) && !EXPRESSION_WORDS.some(row => searchText(row.word) === searchText(word.word))) {
    EXPRESSION_WORDS.push({id:'qv-'+word.word.toLowerCase().replace(/[^a-z0-9]+/g,'-'), word:word.word, pos:'词汇与表达', meaning:word.meaning, category:'questions', example:word.example, translation:'', collocation:''});
  }
}
export const WORKFLOW_BOOKS = [
  {id:'scene' as const, name:'托业场景词', capacity:SCENE_WORDS.length},
  {id:'expressions' as const, name:'题内表达', capacity:EXPRESSION_WORDS.length},
];
export function getWorkflowCatalog(bookId:WorkflowBookId = 'scene'): Word[] {
  return bookId === 'scene' ? SCENE_WORDS : EXPRESSION_WORDS;
}
export const WORKFLOW_WORDS: Word[] = [...SCENE_WORDS, ...EXPRESSION_WORDS];
