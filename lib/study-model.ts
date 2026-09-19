export type Theme = 'hollow' | 'silk' | 'paper';
// randomUUID is restricted to secure contexts in some browsers; getRandomValues
// still provides cryptographic randomness in local HTTP development previews.
export function createId():string {
 if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
 const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export type Profile = { name: string; lrGoal: number; speakingGoal: number; examDate: string; dailyMinutes: number; timezone: string; theme: Theme; weeklyTarget: number; onboarded: boolean };
export type Question = { id: string; part: number; title: string; groupId?: string; prompt: string; options: string[]; correctIndex: number; explanation: string; evidence: string; skill: string; difficulty: string; passage?: string; transcript?: string; audioText?: string; translation?: string; vocabulary?: {word:string;meaning:string;example:string}[]; image?: string };
export type Speaking = { id: string; type: string; title: string; prompt: string; prepSeconds: number; answerSeconds: number; guide: string[]; sampleAnswer: string; passage?: string; image?: string };
export type Attempt = {id:string;qid:string;choice:number;correct:boolean;createdAt:string;seconds:number;mode:'first'|'review'};
export type Checkin = {id:string;date:string;minutes:number;load:'轻'|'刚好'|'重';note:string;createdAt:string};
export type Recording = {id:string;promptId:string;title:string;createdAt:string;duration:number;mime:string;uploaded?:boolean;note?:string};
export const DATA_SCHEMA_VERSION = 2;
export const WRONG_REASONS = ['listening','vocabulary','grammar','evidence','timing'] as const;
export type WrongReason = typeof WRONG_REASONS[number];
export type MutableStudyRecord = {revision:number;mutationId:string;updatedAt:string};
export type QuestionMark = MutableStudyRecord & {qid:string;flagged:boolean;reason:WrongReason|null;note:string};
export type ResourceTask = MutableStudyRecord & {id:string;resourceId:string;plannedDate:string;status:'planned'|'in_progress'|'completed'|'cancelled';minutes:number;checkinId:string|null};
export type StudyData = {schemaVersion:2;profile:Profile;attempts:Attempt[];checkins:Checkin[];recordings:Recording[];questionMarks:QuestionMark[];resourceTasks:ResourceTask[]};
export const DEFAULT_PROFILE:Profile={name:'学习者',lrGoal:650,speakingGoal:130,examDate:'2026-12-20',dailyMinutes:25,timezone:'Asia/Shanghai',theme:'hollow',weeklyTarget:4,onboarded:false};
export const EMPTY_DATA:StudyData={schemaVersion:DATA_SCHEMA_VERSION,profile:DEFAULT_PROFILE,attempts:[],checkins:[],recordings:[],questionMarks:[],resourceTasks:[]};
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validStudyDate(value:unknown):value is string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function validMutable(value:unknown):value is MutableStudyRecord {
 if(!value||typeof value!=='object')return false;
 const v=value as MutableStudyRecord;
 return Number.isSafeInteger(v.revision)&&v.revision>=1&&v.revision<=2147483647&&typeof v.mutationId==='string'&&uuidPattern.test(v.mutationId)&&typeof v.updatedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v.updatedAt)&&Number.isFinite(Date.parse(v.updatedAt));
}
export function validQuestionMark(value:unknown):value is QuestionMark {
 if(!validMutable(value))return false;const v=value as QuestionMark;
 if(Object.keys(v).some(key=>!['qid','flagged','reason','note','revision','mutationId','updatedAt'].includes(key)))return false;
 return typeof v.qid==='string'&&v.qid.length>0&&v.qid.length<=100&&typeof v.flagged==='boolean'&&(v.reason===null||WRONG_REASONS.includes(v.reason))&&typeof v.note==='string'&&v.note.length<=300;
}
export function validResourceTask(value:unknown):value is ResourceTask {
 if(!validMutable(value))return false;const v=value as ResourceTask;
 if(Object.keys(v).some(key=>!['id','resourceId','plannedDate','status','minutes','checkinId','revision','mutationId','updatedAt'].includes(key)))return false;
 return typeof v.id==='string'&&uuidPattern.test(v.id)&&typeof v.resourceId==='string'&&v.resourceId.length>0&&v.resourceId.length<=150&&validStudyDate(v.plannedDate)&&['planned','in_progress','completed','cancelled'].includes(v.status)&&Number.isInteger(v.minutes)&&v.minutes>=0&&v.minutes<=240&&(v.checkinId===null||(typeof v.checkinId==='string'&&uuidPattern.test(v.checkinId)));
}
export function mutableRecordCancelled(record:QuestionMark|ResourceTask){return 'flagged' in record?!record.flagged:record.status==='cancelled';}
// Use one canonical byte order in browser merges and SQLite's BINARY comparison.
// The final payload tie-break also converges if a malformed client reuses a mutation ID.
export function serializeMutableRecord(record:QuestionMark|ResourceTask):string {
 const fields='qid' in record?{qid:record.qid,flagged:record.flagged,reason:record.reason,note:record.note}:{id:record.id,resourceId:record.resourceId,plannedDate:record.plannedDate,status:record.status,minutes:record.minutes,checkinId:record.checkinId};
 return JSON.stringify({...fields,revision:record.revision,mutationId:record.mutationId,updatedAt:record.updatedAt}).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
}
const compareText=(a:string,b:string)=>a===b?0:a>b?1:-1;
export function compareMutableRecords(a:QuestionMark|ResourceTask,b:QuestionMark|ResourceTask):number {
 return a.revision-b.revision||Number(mutableRecordCancelled(a))-Number(mutableRecordCancelled(b))||compareText(a.mutationId,b.mutationId)||compareText(serializeMutableRecord(a),serializeMutableRecord(b));
}
export function mergeMutableRecords<T extends QuestionMark|ResourceTask>(items:T[]):T[] {
 const result=new Map<string,T>();
 for(const record of items){const key='qid' in record?record.qid:record.id;const prior=result.get(key);if(!prior||compareMutableRecords(record,prior)>0)result.set(key,record);}
 return [...result.entries()].sort(([a],[b])=>compareText(a,b)).map(([,record])=>record);
}
export function migrateStudyData(value:unknown):StudyData {
 const raw=value&&typeof value==='object'?value as Partial<StudyData>:{};
 const version=(value as {schemaVersion?:unknown}|null)?.schemaVersion;
 if(version!==undefined&&version!==1&&version!==DATA_SCHEMA_VERSION)throw Error('学习记录版本不受支持，请更新应用后再打开');
 const result=structuredClone(EMPTY_DATA);
 if(raw.profile&&typeof raw.profile.name==='string')result.profile={...result.profile,...raw.profile};
 for(const key of ['attempts','checkins','recordings'] as const){const items=raw[key];if(Array.isArray(items))(result[key] as Array<{id:string}>)=items.filter(item=>item&&typeof item.id==='string');}
 if(Array.isArray(raw.questionMarks))result.questionMarks=mergeMutableRecords(raw.questionMarks.filter(validQuestionMark));
 if(Array.isArray(raw.resourceTasks))result.resourceTasks=mergeMutableRecords(raw.resourceTasks.filter(validResourceTask));
 return result;
}
export const PARTS=['照片描述','应答问题','简短对话','简短独白','短句填空','长文填空','阅读理解'];
export function dayKey(date:Date|string=new Date(),timezone='Asia/Shanghai'){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));}
export function dayOffset(day:string,offset:number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
export function daysUntil(exam:string,today:string){if(!exam)return null;return Math.ceil((Date.parse(exam+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000);}
export function uniqueById<T extends {id:string}>(items:T[]):T[]{return [...new Map(items.map(x=>[x.id,x])).values()];}
export function mergeData(local:StudyData,remote:StudyData):StudyData{local=migrateStudyData(local);remote=migrateStudyData(remote);return {schemaVersion:DATA_SCHEMA_VERSION,profile:remote.profile,attempts:uniqueById([...local.attempts,...remote.attempts]).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),checkins:uniqueById([...local.checkins,...remote.checkins]),recordings:uniqueById([...local.recordings,...remote.recordings]),questionMarks:mergeMutableRecords([...local.questionMarks,...remote.questionMarks]),resourceTasks:mergeMutableRecords([...local.resourceTasks,...remote.resourceTasks])};}
export function firstAttempts(attempts:Attempt[]){const seen=new Set<string>();return [...attempts].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).filter(a=>{if(seen.has(a.qid))return false;seen.add(a.qid);return true;});}
// Use the user's local day and only earlier history: answering today's task
// must not replace that task, including after a restart later the same day.
export function dailyPlan(data:StudyData,questions:Question[],prompts:Speaking[],today=dayKey(new Date(),data.profile.timezone)){
 const timezone=data.profile.timezone;
 const parts=new Map(questions.map(q=>[q.id,q.part]));
 const history=firstAttempts(data.attempts.filter(a=>dayKey(a.createdAt,timezone)<today));
 const stats=PARTS.map((_,i)=>{const attempts=history.filter(a=>parts.get(a.qid)===i+1);return {part:i+1,total:attempts.length,rate:attempts.length?attempts.filter(a=>a.correct).length/attempts.length:1};});
 const seed=Math.floor(Date.parse(today+'T00:00:00Z')/86400000);
 const pick=(listening:boolean)=>{const group=stats.filter(s=>listening?s.part<=4:s.part>4);const weakest=group.filter(s=>s.total>0).sort((a,b)=>a.rate-b.rate)[0];return weakest&&weakest.rate<.7?weakest.part:group.find(s=>s.total===0)?.part||group[((seed%group.length)+group.length)%group.length].part;};
 const listeningPart=pick(true),readingPart=pick(false);
 const priorRecordings=data.recordings.filter(r=>dayKey(r.createdAt,timezone)<today);
 const oral=prompts[priorRecordings.length%prompts.length];
 const attempts=data.attempts.filter(a=>dayKey(a.createdAt,timezone)===today);
 const checkedTasks=[attempts.some(a=>parts.get(a.qid)===listeningPart),attempts.some(a=>parts.get(a.qid)===readingPart),!!oral&&data.recordings.some(r=>dayKey(r.createdAt,timezone)===today&&r.promptId===oral.id)];
 return {listeningPart,readingPart,oral,checkedTasks};
}
export function reviewSchedule(attempts:Attempt[],now=Date.now()){
 const grouped=new Map<string,Attempt[]>();for(const a of attempts){const arr=grouped.get(a.qid)||[];arr.push(a);grouped.set(a.qid,arr);}
 return [...grouped.entries()].map(([qid,arr])=>{
  arr.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));let streak=0;let due=0;let wrong=false;
  for(const a of arr){const at=Date.parse(a.createdAt);if(!a.correct){streak=0;wrong=true;due=at+86400000;}else{wrong=false;if(due===0||at>=due){streak++;const days=[1,1,3,7,14,30][Math.min(streak,5)];due=at+days*86400000;}}}
  return {qid,due,streak,wrong,isDue:due<=now};
 }).sort((a,b)=>Number(b.wrong)-Number(a.wrong)||a.due-b.due);
}
export function chooseQuestions(questions:Question[],attempts:Attempt[],part:number|undefined,count:number){
 if(!Number.isFinite(count)||count<=0)return [];
 const pool=questions.filter(q=>!part||q.part===part);const byId=new Map(reviewSchedule(attempts).map(x=>[x.qid,x]));const ranked=[...pool].sort((a,b)=>{
 const rank=(q:Question)=>{const h=byId.get(q.id);return !h?1:h.wrong||h.isDue?0:2;};return rank(a)-rank(b)||(byId.get(a.id)?.due||0)-(byId.get(b.id)?.due||0);
 });
 // The count is a target, not permission to split a shared conversation/passage.
 // Keep the source order within a group even when a later item is due first.
 const result:Question[]=[];const seen=new Set<string>();
 for(const candidate of ranked){
  if(seen.has(candidate.id))continue;
  const unit=candidate.groupId?pool.filter(q=>q.part===candidate.part&&q.groupId===candidate.groupId):[candidate];
  for(const q of unit){if(!seen.has(q.id)){result.push(q);seen.add(q.id);}}
  if(result.length>=count)break;
 }
 return result;
}
export function expandQuestionGroups(questions:Question[],ids:Set<string>):Question[]{
 const selected=questions.filter(q=>ids.has(q.id));const groups=new Set(selected.filter(q=>q.groupId).map(q=>q.part+':'+q.groupId));
 return questions.filter(q=>ids.has(q.id)||(q.groupId&&groups.has(q.part+':'+q.groupId)));
}
export function getWeek(data:StudyData,today=dayKey(new Date(),data.profile.timezone)){
 const days=Array.from({length:7},(_,i)=>dayOffset(today,i-6));return days.map(date=>({date,minutes:data.checkins.filter(c=>c.date===date).reduce((n,c)=>n+c.minutes,0),started:data.checkins.some(c=>c.date===date)||data.attempts.some(a=>dayKey(a.createdAt,data.profile.timezone)===date)||data.recordings.some(r=>dayKey(r.createdAt,data.profile.timezone)===date)}));
}
export function normalizeText(text:string){return text.toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();}
