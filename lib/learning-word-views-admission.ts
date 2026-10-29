import coreData from '../content/vocabulary.json';
import expansion from '../content/vocabulary-expansion.json';
import questions from '../content/questions.json';
import reusable from '../content/wordlists/legacy-reusable-ids.json';
import {B02_PRIVATE_WORDS,LEGACY_PRIVATE_WORDS,FULL4109_CURRENT_MODE,FULL4109_CURRENT_WORDS,LEGACY_PRIVATE_PLAYABLE_WORD_IDS,isPrivateWordAudioBlocked} from './vocabulary-content-catalog';
import {searchText,type Word} from './vocabulary-model';
import {MEMBER_WORDBOOKS,belongsToWordbook,type MemberWordbookId} from './wordbook-membership';
import type {WorkflowBookId} from './workflow-catalog';
type WorkflowBook={id:WorkflowBookId;name:string;capacity:number;memberCount:number;pendingCount:number;imported:boolean;legacyPracticeCount?:number;privateCandidateCount?:number};

/** The two historical orders are distinct: workflow is core/extra/expressions;
 * lookup is core/expressions/extra. Sets accelerate membership only. */
export function* learningWordViewSteps(){
 const core=coreData as Word[],coreKeys=new Set<string>(),expressionKeys=new Set<string>();
 for(const word of core){yield;coreKeys.add(searchText(word.word));}
 const EXPRESSION_WORDS:Word[]=[];
 for(const question of questions)for(const word of question.vocabulary||[]){
  yield;const key=searchText(word.word);
  if(!coreKeys.has(key)&&!expressionKeys.has(key)){
   expressionKeys.add(key);
   EXPRESSION_WORDS.push({id:'qv-'+word.word.toLowerCase().replace(/[^a-z0-9]+/g,'-'),word:word.word,pos:'词汇与表达',meaning:word.meaning,category:'questions',example:word.example,translation:'',collocation:''});
  }
 }
 const extraWords:Word[]=[];
 for(const word of expansion){yield;extraWords.push({...word,example:'',translation:'',collocation:'',source:'lantern-expansion'});}
 const SCENE_WORDS:Word[]=[...core,...extraWords],legacyWorkflowWords=[...SCENE_WORDS,...EXPRESSION_WORDS];
 const legacyIds=new Set(legacyWorkflowWords.map(word=>word.id)),historyWords=[...legacyWorkflowWords];
 for(const word of LEGACY_PRIVATE_WORDS){yield;if(!legacyIds.has(word.id))historyWords.push(word);}
 const historyIds=new Set(historyWords.map(word=>word.id)),WORKFLOW_WORDS:Word[]=[...historyWords];
 for(const word of FULL4109_CURRENT_WORDS){yield;if(!historyIds.has(word.id))WORKFLOW_WORDS.push(word);}
 const legacyLearningWords=[...core,...EXPRESSION_WORDS,...extraWords],learningIds=new Set(legacyLearningWords.map(word=>word.id)),learningWords=[...legacyLearningWords];
 for(const word of B02_PRIVATE_WORDS){yield;if(!learningIds.has(word.id))learningWords.push(word);}
 const reusableIds=new Set(reusable.wordIds),playableIds=new Set(LEGACY_PRIVATE_PLAYABLE_WORD_IDS),reusableWords:Word[]=[];
 for(const word of core){
  yield;
  if(playableIds.has(word.id)&&!isPrivateWordAudioBlocked(word)&&reusableIds.has(word.id)&&[word.pos,word.meaning,word.example,word.translation].every(value=>!!value.trim()))reusableWords.push(word);
 }
 const importedLearningWords=FULL4109_CURRENT_MODE?FULL4109_CURRENT_WORDS:[...new Map([...reusableWords,...B02_PRIVATE_WORDS].map(word=>[word.id,word])).values()];
 const importedCatalogs=new Map<MemberWordbookId,Word[]>();
 const privateWordIds=new Set(B02_PRIVATE_WORDS.map(word=>word.id));
 const WORKFLOW_BOOKS:WorkflowBook[]=[
  {id:'scene',name:'托业场景词',capacity:SCENE_WORDS.length,memberCount:SCENE_WORDS.length,pendingCount:0,imported:false},
  {id:'expressions',name:'题内表达',capacity:EXPRESSION_WORDS.length,memberCount:EXPRESSION_WORDS.length,pendingCount:0,imported:false},
 ];
 for(const book of MEMBER_WORDBOOKS){
  const rows:Word[]=[];let privateCount=0;
  for(const word of importedLearningWords){yield;if(belongsToWordbook(word.word,book.id)){rows.push(word);if(privateWordIds.has(word.id))privateCount++;}}
  importedCatalogs.set(book.id,rows);
  WORKFLOW_BOOKS.push({id:book.id,name:book.title,capacity:rows.length,memberCount:book.count,pendingCount:book.count-rows.length,imported:true,privateCandidateCount:privateCount,legacyPracticeCount:rows.length-privateCount});
 }
 return {SCENE_WORDS,EXPRESSION_WORDS,WORKFLOW_WORDS,WORKFLOW_BOOKS,importedCatalogs,reusableWords,learningWords,core,extraWords,questionWords:EXPRESSION_WORDS};
}
export function completeLearningWordViewsSynchronously(){
 const steps=learningWordViewSteps();let next=steps.next();while(!next.done)next=steps.next();return next.value;
}
export type LearningWordViews=ReturnType<typeof completeLearningWordViewsSynchronously>;
