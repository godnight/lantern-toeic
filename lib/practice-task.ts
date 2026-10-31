import {canonicalHash,canonicalJson} from './domain-command';
import type {Question} from './study-model';

export type PracticeTaskOrigin={kind:'listening'|'reading'|'material'|'custom'|'wrong'|'review'|'question'|'combined'|'daily'|'continue';collection?:string;part?:number;count?:number;unitId?:string;chainId?:string;day?:string};
export type PracticeTask={key:string;label:string;origin:PracticeTaskOrigin};
export function validatePracticeTaskOrigin(value:unknown):asserts value is PracticeTaskOrigin{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('practice-task-invalid');
 const v=value as Record<string,unknown>,fields:Record<string,string[]>={listening:['collection','part'],reading:['part'],material:['collection','unitId'],custom:['part','count'],wrong:['collection','part','count'],review:['part','count'],question:['unitId'],combined:['collection'],daily:['collection','day'],continue:['chainId','count']};
 if(typeof v.kind!=='string'||!Object.hasOwn(fields,v.kind)||Object.keys(v).some(key=>key!=='kind'&&!fields[v.kind as string].includes(key)))throw Error('practice-task-invalid');
 for(const field of ['collection','unitId','chainId','day'])if(field in v&&(typeof v[field]!=='string'||!v[field]||v[field].length>200||/[\u0000-\u001f]/.test(v[field] as string)))throw Error('practice-task-invalid');
 if('part'in v&&(!Number.isInteger(v.part)||Number(v.part)<1||Number(v.part)>7)||'count'in v&&(!Number.isInteger(v.count)||Number(v.count)<1||Number(v.count)>200))throw Error('practice-task-invalid');
 if((v.kind==='listening'&&(!v.collection||!v.part))||(v.kind==='reading'&&!v.part)||(v.kind==='material'&&(!v.collection||!v.unitId))||(['custom','wrong','review','continue'].includes(v.kind)&&!v.count)||(v.kind==='question'&&!v.unitId)||(v.kind==='continue'&&!v.chainId)||(v.kind==='wrong'&&!v.collection)||(v.kind==='daily'&&(!v.day||!v.collection))||(v.kind==='combined'&&!v.collection))throw Error('practice-task-invalid');
}
export function practiceTaskOriginKey(origin:PracticeTaskOrigin){validatePracticeTaskOrigin(origin);return canonicalHash(canonicalJson(origin));}
export function makePracticeTask(origin:PracticeTaskOrigin,label:string,catalogVersion:string,unitIds:readonly string[],questionIds:readonly string[]):PracticeTask{
 validatePracticeTaskOrigin(origin);
 if(typeof label!=='string'||!label.trim()||label.length>160||/[\u0000-\u001f]/.test(label))throw Error('practice-task-invalid');
 return {key:'practice-task-v1:'+canonicalHash(canonicalJson({origin,catalogVersion,unitIds,questionIds})),label,origin:JSON.parse(canonicalJson(origin))};
}
export function validatePracticeTask(value:unknown,catalogVersion:string,unitIds:readonly string[],questionIds:readonly string[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='key,label,origin')throw Error('practice-task-invalid');
 const task=value as PracticeTask,expected=makePracticeTask(task.origin,task.label,catalogVersion,unitIds,questionIds);
 if(task.key!==expected.key)throw Error('practice-task-reference');
}
export const practiceSavedCount=(session:{steps:readonly {status:string}[]})=>session.steps.filter(step=>step.status==='applied').length;
export function practiceTaskLabel(session:{task?:PracticeTask;status:string;queue:readonly Question[]}){return session.task?.label??(session.status==='active'?'旧未完成任务':'旧练习记录');}
export function sortPracticeSessions<T extends {id:string;activityAt?:string;startedAt:string}>(sessions:readonly T[]){return [...sessions].sort((a,b)=>(b.activityAt??b.startedAt).localeCompare(a.activityAt??a.startedAt)||a.id.localeCompare(b.id));}
