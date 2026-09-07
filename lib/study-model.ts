export type Theme = 'hollow' | 'silk' | 'paper';
export type Profile = { name: string; lrGoal: number; speakingGoal: number; examDate: string; dailyMinutes: number; timezone: string; theme: Theme; weeklyTarget: number; onboarded: boolean };
export type Question = { id: string; part: number; title: string; groupId?: string; prompt: string; options: string[]; correctIndex: number; explanation: string; evidence: string; skill: string; difficulty: string; passage?: string; transcript?: string; audioText?: string; translation?: string; vocabulary?: {word:string;meaning:string;example:string}[]; image?: string };
export type Speaking = { id: string; type: string; title: string; prompt: string; prepSeconds: number; answerSeconds: number; guide: string[]; sampleAnswer: string; passage?: string; image?: string };
export type Attempt = {id:string;qid:string;choice:number;correct:boolean;createdAt:string;seconds:number;mode:'first'|'review'};
export type Checkin = {id:string;date:string;minutes:number;load:'轻'|'刚好'|'重';note:string;createdAt:string};
export type Recording = {id:string;promptId:string;title:string;createdAt:string;duration:number;mime:string;uploaded?:boolean;note?:string};
export type StudyData = {profile:Profile;attempts:Attempt[];checkins:Checkin[];recordings:Recording[]};
export const DEFAULT_PROFILE:Profile={name:'学习者',lrGoal:650,speakingGoal:130,examDate:'2026-12-20',dailyMinutes:25,timezone:'Asia/Shanghai',theme:'hollow',weeklyTarget:4,onboarded:false};
export const EMPTY_DATA:StudyData={profile:DEFAULT_PROFILE,attempts:[],checkins:[],recordings:[]};
export const PARTS=['照片描述','应答问题','简短对话','简短独白','短句填空','长文填空','阅读理解'];
export function dayKey(date:Date|string=new Date(),timezone='Asia/Shanghai'){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));}
export function dayOffset(day:string,offset:number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
export function daysUntil(exam:string,today:string){if(!exam)return null;return Math.ceil((Date.parse(exam+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000);}
export function uniqueById<T extends {id:string}>(items:T[]):T[]{return [...new Map(items.map(x=>[x.id,x])).values()];}
export function mergeData(local:StudyData,remote:StudyData):StudyData{return {profile:remote.profile,attempts:uniqueById([...local.attempts,...remote.attempts]).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),checkins:uniqueById([...local.checkins,...remote.checkins]),recordings:uniqueById([...local.recordings,...remote.recordings])};}
export function firstAttempts(attempts:Attempt[]){const seen=new Set<string>();return [...attempts].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).filter(a=>{if(seen.has(a.qid))return false;seen.add(a.qid);return true;});}
export function reviewSchedule(attempts:Attempt[],now=Date.now()){
 const grouped=new Map<string,Attempt[]>();for(const a of attempts){const arr=grouped.get(a.qid)||[];arr.push(a);grouped.set(a.qid,arr);}
 return [...grouped.entries()].map(([qid,arr])=>{
  arr.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));let streak=0;let due=0;let wrong=false;
  for(const a of arr){const at=Date.parse(a.createdAt);if(!a.correct){streak=0;wrong=true;due=at+86400000;}else{wrong=false;if(due===0||at>=due){streak++;const days=[1,1,3,7,14,30][Math.min(streak,5)];due=at+days*86400000;}}}
  return {qid,due,streak,wrong,isDue:due<=now};
 }).sort((a,b)=>Number(b.wrong)-Number(a.wrong)||a.due-b.due);
}
export function chooseQuestions(questions:Question[],attempts:Attempt[],part:number|undefined,count:number){
 const pool=questions.filter(q=>!part||q.part===part);const byId=new Map(reviewSchedule(attempts).map(x=>[x.qid,x]));return [...pool].sort((a,b)=>{
 const rank=(q:Question)=>{const h=byId.get(q.id);return !h?1:h.wrong||h.isDue?0:2;};return rank(a)-rank(b)||(byId.get(a.id)?.due||0)-(byId.get(b.id)?.due||0);
 }).slice(0,count);
}
export function getWeek(data:StudyData,today=dayKey(new Date(),data.profile.timezone)){
 const days=Array.from({length:7},(_,i)=>dayOffset(today,i-6));return days.map(date=>({date,minutes:data.checkins.filter(c=>c.date===date).reduce((n,c)=>n+c.minutes,0),started:data.checkins.some(c=>c.date===date)||data.attempts.some(a=>dayKey(a.createdAt,data.profile.timezone)===date)||data.recordings.some(r=>dayKey(r.createdAt,data.profile.timezone)===date)}));
}
export function normalizeText(text:string){return text.toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();}
