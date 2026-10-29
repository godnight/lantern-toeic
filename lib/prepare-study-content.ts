import {prepareVocabularyCatalog} from './prepare-vocabulary-catalog';
import {runCooperativeSteps} from './cooperative-task';
import type {QuestionCatalogSnapshot} from './question-catalog-admission';
import type {LearningWordViews} from './learning-word-views-admission';

let questions:QuestionCatalogSnapshot|null=null,views:LearningWordViews|null=null;
let ready=false,pending:Promise<void>|null=null,failure:unknown=null;
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
/** Shared packaged teaching data contains no owner state. A consumer's access
 * remains checked by PreparedStudyContent before importing or mounting UI. */
export function prepareStudyContent(retry=false):Promise<void>{
 if(ready)return Promise.resolve();
 if(pending)return pending;
 if(failure&&!retry)return Promise.reject(failure);
 failure=null;
 const task=(async()=>{
  await prepareVocabularyCatalog(retry);
  if(!questions){
   const {questionCatalogSteps}=await import('./question-catalog-admission');
   questions=Object.freeze(await runCooperativeSteps(questionCatalogSteps()));
  }
  if(!views){
   const {learningWordViewSteps}=await import('./learning-word-views-admission');
   views=Object.freeze(await runCooperativeSteps(learningWordViewSteps()));
  }
  ready=true;
 })();
 pending=task;
 void task.then(()=>{pending=null;},error=>{pending=null;failure=error;});
 return task;
}
