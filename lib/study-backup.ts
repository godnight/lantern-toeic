import {z} from 'zod';
import {migrateStudyData,mergeData,validQuestionMark,validResourceTask,validStudyDate,type StudyData,type QuestionMark,type ResourceTask} from './study-model';

const id=z.string().uuid();
const stamp=z.string().datetime();
const profile=z.object({name:z.string().min(1).max(40),lrGoal:z.number().int().min(10).max(990),speakingGoal:z.number().int().min(0).max(200),examDate:z.string().refine(v=>v===''||validStudyDate(v)),dailyMinutes:z.number().int().min(5).max(120),timezone:z.string().refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}}),theme:z.enum(['hollow','silk','paper']),weeklyTarget:z.number().int().min(1).max(7),onboarded:z.boolean()});
const backup=z.object({
 schemaVersion:z.union([z.literal(1),z.literal(2)]).optional(),
 profile,
 attempts:z.array(z.object({id,qid:z.string().min(1).max(100),choice:z.number().int().min(0).max(3),correct:z.boolean(),createdAt:stamp,seconds:z.number().int().min(0).max(7200),mode:z.enum(['first','review'])})),
 checkins:z.array(z.object({id,date:z.string().refine(validStudyDate),minutes:z.number().int().min(1).max(240),load:z.enum(['轻','刚好','重']),note:z.string().max(1000),createdAt:stamp})),
 recordings:z.array(z.object({id,promptId:z.string().min(1).max(100),title:z.string().max(200),createdAt:stamp,duration:z.number().min(0).max(7200),mime:z.string().min(1).max(100),uploaded:z.boolean().optional(),note:z.string().max(1000).optional()})),
 questionMarks:z.array(z.custom<QuestionMark>(validQuestionMark)).default([]),
 resourceTasks:z.array(z.custom<ResourceTask>(validResourceTask)).default([])
});

export function createStudyBackup(data:StudyData,exportedAt=new Date().toISOString()){
 return {version:'2.0.0',exportedAt,audioIncluded:false,...migrateStudyData(data)};
}

export function parseStudyBackup(value:unknown):StudyData {
 const decoded=typeof value==='string'?JSON.parse(value):value;
 migrateStudyData(decoded);
 return migrateStudyData(backup.parse(decoded));
}

export function restoreStudyBackup(current:StudyData,value:unknown,restoreProfile=false):StudyData {
 const imported=parseStudyBackup(value);
 imported.recordings=imported.recordings.map(record=>({...record,uploaded:false}));
 // Existing immutable events and confirmed recordings win over an imported copy.
 const result=mergeData(imported,current);
 if(restoreProfile)result.profile=imported.profile;
 return result;
}
