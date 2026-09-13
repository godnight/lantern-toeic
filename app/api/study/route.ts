import {eq, and} from 'drizzle-orm';
import {z} from 'zod';
import {getDb} from '@/db';
import {profiles,attempts,checkins,recordings,questionMarks,resourceTasks} from '@/db/schema';
import {mutableStudyUpsert} from '@/db/mutable-study';
import {DEFAULT_PROFILE,DATA_SCHEMA_VERSION,validQuestionMark,validResourceTask} from '@/lib/study-model';
import {userId,safeMutation,privateJson} from '@/lib/server-auth';
import questions from '@/content/questions.json';
import {resources} from '@/content/resources-v2';
import examResources from '@/content/exams/catalogue.json';
const resourceIds=new Set([...resources.map(resource=>resource.id),...examResources.map(resource=>'exam-'+resource.id)]);
const id=z.string().uuid();
const stamp=z.string().datetime().refine(v=>Date.parse(v)<Date.now()+300000,'Invalid future timestamp');
const profile=z.object({name:z.string().trim().min(1).max(40),lrGoal:z.number().int().min(10).max(990),speakingGoal:z.number().int().min(0).max(200),examDate:z.string().refine(v=>v===''||(/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v)))),dailyMinutes:z.number().int().min(5).max(120),timezone:z.string().refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}}),theme:z.enum(['hollow','silk','paper']),weeklyTarget:z.number().int().min(1).max(7),onboarded:z.boolean()});
const attempt=z.object({id,qid:z.string().max(100),choice:z.number().int().min(0).max(3),createdAt:stamp,seconds:z.number().int().min(0).max(7200)});
const checkin=z.object({id,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),minutes:z.number().int().min(1).max(240),load:z.enum(['轻','刚好','重']),note:z.string().max(1000),createdAt:stamp});
export async function GET(){const uid=await userId();if(!uid)return privateJson({error:'请登录后同步',local:true},401);try{const db=getDb();const [p,a,c,r,m,t]=await Promise.all([db.select().from(profiles).where(eq(profiles.userId,uid)),db.select().from(attempts).where(eq(attempts.userId,uid)),db.select().from(checkins).where(eq(checkins.userId,uid)),db.select().from(recordings).where(eq(recordings.userId,uid)),db.select().from(questionMarks).where(eq(questionMarks.userId,uid)),db.select().from(resourceTasks).where(eq(resourceTasks.userId,uid))]);return privateJson({owner:uid,schemaVersion:DATA_SCHEMA_VERSION,profile:p[0]?JSON.parse(p[0].body):DEFAULT_PROFILE,hasProfile:!!p[0],attempts:a.map(({userId:_,...rest})=>rest),checkins:c.map(x=>JSON.parse(x.body)),recordings:r.map(x=>({...JSON.parse(x.body),uploaded:true})),questionMarks:m.map(x=>JSON.parse(x.body)),resourceTasks:t.map(x=>JSON.parse(x.body))});}catch{return privateJson({error:'同步暂时不可用，本机记录会保留'},503);}}
export async function POST(request:Request){const uid=await userId();if(!uid)return privateJson({error:'请登录后同步'},401);if(request.headers.get('x-lantern-owner')!==uid)return privateJson({error:'账号已切换，请刷新后重试'},409);if(!safeMutation(request))return privateJson({error:'请求来源不匹配'},403);try{
 if(Number(request.headers.get('content-length')||0)>200000)return privateJson({error:'请求过大'},413);
 const body=z.object({type:z.string(),data:z.unknown()}).parse(await request.json());const db=getDb();
 if(body.type==='profile'){const parsed=profile.parse(body.data);await db.insert(profiles).values({userId:uid,body:JSON.stringify(parsed),updatedAt:new Date().toISOString()}).onConflictDoUpdate({target:profiles.userId,set:{body:JSON.stringify(parsed),updatedAt:new Date().toISOString()}});return privateJson({ok:true});}
 if(body.type==='attempt'){
  const a=attempt.parse(body.data);const q=questions.find(q=>q.id===a.qid);if(!q||a.choice>=q.options.length)return privateJson({error:'题目或选项无效'},400);
  const prev=await db.select({id:attempts.id}).from(attempts).where(and(eq(attempts.userId,uid),eq(attempts.qid,a.qid))).limit(1);
  await db.insert(attempts).values({...a,userId:uid,correct:a.choice===q.correctIndex,mode:prev.length?'review':'first'}).onConflictDoNothing();
  const owned=await db.select({id:attempts.id}).from(attempts).where(and(eq(attempts.id,a.id),eq(attempts.userId,uid))).limit(1);
  return owned.length?privateJson({ok:true}):privateJson({error:'记录标识冲突，请保留备份并检查导入来源'},422);
 }
 if(body.type==='checkin'){
  const c=checkin.parse(body.data);await db.insert(checkins).values({id:c.id,userId:uid,body:JSON.stringify(c),createdAt:c.createdAt}).onConflictDoNothing();
  const owned=await db.select({id:checkins.id}).from(checkins).where(and(eq(checkins.id,c.id),eq(checkins.userId,uid))).limit(1);
  return owned.length?privateJson({ok:true}):privateJson({error:'记录标识冲突，请保留备份并检查导入来源'},422);
 }
 if(body.type==='questionMark'){
  const mark=body.data;if(!validQuestionMark(mark)||!questions.some(question=>question.id===mark.qid))return privateJson({error:'题目标记格式或题目无效'},400);
  stamp.parse(mark.updatedAt);await db.run(mutableStudyUpsert('questionMark',uid,mark));return privateJson({ok:true});
 }
 if(body.type==='resourceTask'){
  const task=body.data;if(!validResourceTask(task)||!resourceIds.has(task.resourceId))return privateJson({error:'资料任务格式或资料无效'},400);
  stamp.parse(task.updatedAt);
  if(task.checkinId){const linked=await db.select({id:checkins.id}).from(checkins).where(and(eq(checkins.id,task.checkinId),eq(checkins.userId,uid))).limit(1);if(!linked.length)return privateJson({error:'关联的学习记录无效或尚未同步'},400);}
  await db.run(mutableStudyUpsert('resourceTask',uid,task));return privateJson({ok:true});
 }
 return privateJson({error:'未知操作'},400);
 }catch(e){return privateJson({error:(e instanceof z.ZodError||e instanceof SyntaxError)?'记录格式无效':'同步暂时不可用'},(e instanceof z.ZodError||e instanceof SyntaxError)?400:503);}}
