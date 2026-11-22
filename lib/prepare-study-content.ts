import {prepareVocabularyCatalog} from './prepare-vocabulary-catalog';
import {prepareNaturalAudioCatalog} from './prepare-natural-audio-catalog';
import {prepareListening150Package} from './prepare-listening150-package';
import {runCooperativeSteps} from './cooperative-task';
import {preparationMark} from './preparation-timing';
import type {QuestionCatalogSnapshot} from './question-catalog-admission';
import type {LearningWordViews} from './learning-word-views-admission';
import type {extendPart1Catalog} from './extend-part1-catalog';

type ReadyQuestionCatalog=ReturnType<typeof extendPart1Catalog>;
let questions:ReadyQuestionCatalog|null=null,views:LearningWordViews|null=null;
let ready=false,pending:Promise<void>|null=null,failure:unknown=null;
let workflowPending:Promise<void>|null=null,workflowFailure:unknown=null;
export class StudyContentPendingError extends Error{constructor(){super('学习内容仍在核验。');}}
export function readPreparedQuestionCatalog(){if(!questions)throw new StudyContentPendingError();return questions;}
/** New question audio is visible only with the fully admitted, published catalogue. */
export function readPreparedPart1Audio(qid:string){return questions?.getReviewedPart1Audio(qid)??null;}
export function readPreparedLearningWordViews(){if(!views)throw new StudyContentPendingError();return views;}
export function installServerQuestionCatalog(create:()=>ReadyQuestionCatalog){
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
  // Only immutable source loading starts early. The package task itself waits
  // for the full locator; module consumers remain behind both admissions.
  const listening=questions?null:prepareListening150Package(retry);
  await prepareNaturalAudioCatalog(retry);
  if(!questions){
   preparationMark('question-catalog-start');
   await listening;
   const {questionCatalogSteps}=await import('./question-catalog-admission');
   const base:QuestionCatalogSnapshot=await runCooperativeSteps(questionCatalogSteps());
   // The extra pack binds to the frozen old 313. Neither the extended catalogue
   // nor its audio may escape if any image, question or exact track pin fails.
   const [{captureCompiledPart1TwelvePackage},{admitPart1TwelvePackageSteps},{extendPart1Catalog}]=await Promise.all([
    import('./listening-part1-12-package-admission'),import('./listening-part1-12-catalog'),import('./extend-part1-catalog')]);
   const source=captureCompiledPart1TwelvePackage();
   const accepted=await runCooperativeSteps(admitPart1TwelvePackageSteps(source.input,source.pins,base.BASE_QUESTIONS));
   questions=extendPart1Catalog(base,accepted,source.extensionPins);
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
