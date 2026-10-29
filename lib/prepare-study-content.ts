import {prepareVocabularyCatalog} from './prepare-vocabulary-catalog';
import {prepareNaturalAudioCatalog} from './prepare-natural-audio-catalog';
import {prepareListening150Package} from './prepare-listening150-package';
import {runCooperativeSteps} from './cooperative-task';
import {preparationMark} from './preparation-timing';
import type {QuestionCatalogSnapshot} from './question-catalog-admission';
import type {LearningWordViews} from './learning-word-views-admission';

let questions:QuestionCatalogSnapshot|null=null,views:LearningWordViews|null=null;
let ready=false,pending:Promise<void>|null=null,failure:unknown=null;
let workflowPending:Promise<void>|null=null,workflowFailure:unknown=null;
export class StudyContentPendingError extends Error{constructor(){super('学习内容仍在核验。');}}
export function readPreparedQuestionCatalog(){if(!questions)throw new StudyContentPendingError();return questions;}
export function readPreparedLearningWordViews(){if(!views)throw new StudyContentPendingError();return views;}
export function installServerQuestionCatalog(create:()=>QuestionCatalogSnapshot){
 if(typeof window!=='undefined')return readPreparedQuestionCatalog();
 return questions??=Object.freeze(create());
}
export function installServerLearningWordViews(create:()=>LearningWordViews){
 if(typeof window!=='undefined')return readPreparedLearningWordViews();
 return views??=Object.freeze(create());
}
/** Explicit legacy export needs the full workflow catalogue, not practice or
 * audio activation. It shares validated immutable data, never owner state. */
export function prepareWorkflowContent(retry=false):Promise<void>{
 if(views)return Promise.resolve();
 if(workflowPending)return workflowPending;
 if(workflowFailure&&!retry)return Promise.reject(workflowFailure);
 workflowFailure=null;
 const task=(async()=>{
  await prepareVocabularyCatalog(retry);
  preparationMark('learning-views-start');
  const {learningWordViewSteps}=await import('./learning-word-views-admission');
  views=Object.freeze(await runCooperativeSteps(learningWordViewSteps()));
  preparationMark('learning-views-ready');
 })();
 workflowPending=task;
 void task.then(()=>{workflowPending=null;},error=>{workflowPending=null;workflowFailure=error;});
 return task;
}
/** Independent compiled admissions overlap loading; all must finish before
 * workspace imports. Audio metadata can then overlap workspace loading. */
export function prepareStudyContent(retry=false):Promise<void>{
 if(ready)return Promise.resolve();
 if(pending)return pending;
 if(failure&&!retry)return Promise.reject(failure);
 failure=null;
 const questionTask=(async()=>{
  await prepareNaturalAudioCatalog(retry);
  if(!questions){
   preparationMark('question-catalog-start');
   await prepareListening150Package(retry);
   const {questionCatalogSteps}=await import('./question-catalog-admission');
   questions=Object.freeze(await runCooperativeSteps(questionCatalogSteps()));
   preparationMark('question-catalog-ready');
  }
 })();
 const task=Promise.all([questionTask,prepareWorkflowContent(retry)]).then(()=>{
  ready=true;preparationMark('required-content-ready');
  // The shared content task is requested behind the existing account gate.
  // Metadata has no owner data or automatic MP3 download. Explicit retry stays
  // with the original audio UI; workspace mounting cannot start a second try.
  void import('./lesson-audio').then(module=>module.prepareProductLessonAudio({allowLocalCandidate:true})).catch(()=>{});
 });
 pending=task;
 void task.then(()=>{pending=null;},error=>{pending=null;failure=error;});
 return task;
}
