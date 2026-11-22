import {canonicalHash,canonicalJson} from './domain-command';
import {practiceUnits} from './practice-selection';
import {validatePracticeTaskOrigin,type PracticeTaskOrigin} from './practice-task';
import type {Question} from './study-model';

export type PracticeBatchGroup={index:number;questionIds:string[];unitIds:string[]};
export type PracticeBatchPlan={kind:'practice-batch-plan';schemaVersion:1;id:string;scopeKey:string;catalogVersion:string;origin:PracticeTaskOrigin;groups:PracticeBatchGroup[];integrityError?:string};
export function practiceBatchPlanId(origin:PracticeTaskOrigin){validatePracticeTaskOrigin(origin);if(origin.batchId!==undefined||origin.batchIndex!==undefined||!['listening','wrong'].includes(origin.kind))throw Error('practice-batch-origin-invalid');return 'practice-batch:'+canonicalHash(canonicalJson(origin));}
export function partitionPracticeBatch(questions:readonly Question[]):PracticeBatchGroup[]{
 if(!questions.length||new Set(questions.map(q=>q.id)).size!==questions.length)throw Error('practice-batch-invalid');
 const result:PracticeBatchGroup[]=[];let current:PracticeBatchGroup={index:1,questionIds:[],unitIds:[]};
 for(const unit of practiceUnits(questions)){
  if(unit.questions.length>200)throw Error('practice-batch-unit-too-large');
  if(current.questionIds.length+unit.questions.length>200){result.push(current);current={index:result.length+1,questionIds:[],unitIds:[]};}
  current.unitIds.push(unit.id);current.questionIds.push(...unit.questions.map(q=>q.id));
 }
 if(current.questionIds.length)result.push(current);
 if(result.flatMap(group=>group.questionIds).join('\0')!==questions.map(q=>q.id).join('\0'))throw Error('practice-batch-order-invalid');
 return result;
}
