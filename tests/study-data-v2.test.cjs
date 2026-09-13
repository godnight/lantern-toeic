const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const ts=require('typescript');
const orm=require('drizzle-orm');
const {drizzle}=require('drizzle-orm/sqlite-proxy');
const root=path.resolve(__dirname,'..');
function load(file,imports={}){
 const exports={};const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,require:name=>{if(!(name in imports))throw Error('Unexpected import '+name);return imports[name];},Date,Intl,Map,Set,structuredClone,Request,Response,Headers,crypto:{randomUUID}}, {filename:file});return exports;
}
const plain=value=>JSON.parse(JSON.stringify(value));
const model=load('lib/study-model.ts');
const backup=load('lib/study-backup.ts',{'./study-model':model,zod:require('zod')});
const schema=load('db/schema.ts',{'drizzle-orm/sqlite-core':require('drizzle-orm/sqlite-core')});
const statements=load('db/mutable-study.ts',{'drizzle-orm':orm,'./schema':schema,'../lib/study-model':model});
const questions=JSON.parse(fs.readFileSync(path.join(root,'content/questions.json'),'utf8'));
const resources=load('content/resources-v2.ts');
const exams=JSON.parse(fs.readFileSync(path.join(root,'content/exams/catalogue.json'),'utf8'));
const stamp='2026-01-01T10:00:00.000Z';
const mark=(overrides={})=>({qid:questions[0].id,flagged:true,reason:'listening',note:'',revision:1,mutationId:randomUUID(),updatedAt:stamp,...overrides});
const task=(overrides={})=>({id:randomUUID(),resourceId:resources.resources[0].id,plannedDate:'2026-01-01',status:'planned',minutes:5,checkinId:null,revision:1,mutationId:randomUUID(),updatedAt:stamp,...overrides});
function database(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(fs.readFileSync(path.join(root,'drizzle/0000_spotty_stellaris.sql'),'utf8'));
 sqlite.prepare('INSERT INTO profiles(user_id,body,updated_at) VALUES(?,?,?)').run('existing',JSON.stringify(model.DEFAULT_PROFILE),stamp);
 const legacy=sqlite.prepare('SELECT * FROM profiles').all();
 for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(name=>name.endsWith('.sql')&&!name.startsWith('0000')).sort())sqlite.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
 assert.deepEqual(sqlite.prepare('SELECT * FROM profiles').all(),legacy,'Additive migrations preserve existing data');
 const db=drizzle(async(query,params,method)=>{
  const prepared=sqlite.prepare(query);
  if(method==='run'){prepared.run(...params);return {rows:[]};}
  const rows=prepared.all(...params).map(row=>Object.values(row));
  return {rows:method==='get'?rows[0]:rows};
 });
 return {sqlite,db};
}

test('v1 migration and backup round trips preserve first answers, minutes, resource notes and recording IDs',()=>{
 const old=plain(model.EMPTY_DATA);delete old.schemaVersion;delete old.questionMarks;delete old.resourceTasks;
 old.attempts=[{id:randomUUID(),qid:questions[0].id,choice:0,correct:true,createdAt:stamp,seconds:6,mode:'first'}];
 old.checkins=[{id:randomUUID(),date:'2026-01-01',minutes:5,load:'轻',note:'[资源:legacy] original note',createdAt:stamp}];
 old.recordings=[{id:randomUUID(),promptId:'speaking-1',title:'Practice',createdAt:stamp,duration:8,mime:'audio/webm',uploaded:true}];
 const upgraded=model.migrateStudyData(old);
 assert.deepEqual(plain(model.migrateStudyData(upgraded)),plain(upgraded));
 for(const key of ['attempts','checkins','recordings'])assert.deepEqual(plain(upgraded[key]),old[key]);
 upgraded.questionMarks=[mark({flagged:false})];upgraded.resourceTasks=[task({status:'cancelled',minutes:100})];
 const encoded=JSON.stringify(backup.createStudyBackup(upgraded,stamp));
 const restored=backup.restoreStudyBackup(model.EMPTY_DATA,encoded);
 assert.equal(restored.recordings[0].uploaded,false,'Imported metadata is not cloud ownership evidence');
 assert.deepEqual(plain(backup.restoreStudyBackup(restored,encoded)),plain(restored));
 assert.equal(model.getWeek(restored,'2026-01-01').at(-1).minutes,5,'Task budget does not duplicate checkin minutes');
 assert.equal(model.firstAttempts(restored.attempts)[0].id,old.attempts[0].id);
 const existing=backup.restoreStudyBackup(upgraded,encoded);assert.equal(existing.recordings[0].uploaded,true,'This account existing confirmation remains valid');
 assert.throws(()=>backup.parseStudyBackup({...old,schemaVersion:3}),/版本/);
 assert.throws(()=>backup.parseStudyBackup({...old,checkins:[{...old.checkins[0],date:'2026-02-30'}]}));
});

test('mutable merge converges across order, repeated delivery, clock rollback and Unicode payload ties',()=>{
 const first=mark({revision:4,note:'😀'}),cancel=mark({revision:4,flagged:false,updatedAt:'2025-01-01T00:00:00.000Z'});
 const third=mark({revision:3,note:'old'});
 const result=items=>plain(model.mergeMutableRecords(items));
 assert.equal(result([first,cancel,third])[0].flagged,false);
 assert.deepEqual(result([first,cancel,third]),result([third,cancel,first]));
 assert.deepEqual(result([...model.mergeMutableRecords([first,third]),cancel]),result([first,...model.mergeMutableRecords([cancel,third])]));
 assert.deepEqual(result([cancel,cancel]),result([cancel]));
 const reenabled=mark({revision:5});assert.equal(result([cancel,reenabled])[0].flagged,true);
 const tie={...first,note:'\ue000'};
 assert.deepEqual(result([first,tie]),result([tie,first]));
 assert.match(model.serializeMutableRecord(first),/\\ud83d\\ude00/);
});

test('actual SQLite upsert matches browser ordering and isolates identical entity IDs by account',async()=>{
 const {sqlite,db}=database();
 try{
  const initial=mark({revision:2}),cancel=mark({revision:2,flagged:false}),reenabled=mark({revision:3});
  for(const incoming of [cancel,initial,cancel])await db.run(statements.mutableStudyUpsert('questionMark','alice',incoming));
  await db.run(statements.mutableStudyUpsert('questionMark','bob',initial));
  assert.equal(JSON.parse(sqlite.prepare('SELECT body FROM question_marks WHERE user_id=?').get('alice').body).flagged,false);
  assert.equal(JSON.parse(sqlite.prepare('SELECT body FROM question_marks WHERE user_id=?').get('bob').body).flagged,true);
  await db.run(statements.mutableStudyUpsert('questionMark','alice',reenabled));
  await db.run(statements.mutableStudyUpsert('questionMark','alice',cancel));
  assert.equal(JSON.parse(sqlite.prepare('SELECT body FROM question_marks WHERE user_id=?').get('alice').body).revision,3);
  const records=[task(),task()];records[1]={...records[0],status:'cancelled'};
  for(const incoming of [records[1],records[0]])await db.run(statements.mutableStudyUpsert('resourceTask','alice',incoming));
  assert.equal(JSON.parse(sqlite.prepare('SELECT body FROM resource_tasks').get().body).status,'cancelled');
  const unicode=mark({revision:4,note:'😀'}),other={...unicode,note:'\ue000'};
  for(const incoming of [unicode,other])await db.run(statements.mutableStudyUpsert('questionMark','alice',incoming));
  assert.deepEqual(JSON.parse(sqlite.prepare('SELECT body FROM question_marks WHERE user_id=?').get('alice').body),plain(model.mergeMutableRecords([unicode,other])[0]));
 }finally{sqlite.close();}
});

test('API validates references, real dates and account ownership, and reads only the current account state',async()=>{
 const {sqlite,db}=database();let owner='alice';
 const api=load('app/api/study/route.ts',{
  'drizzle-orm':orm,zod:require('zod'),'@/db':{getDb:()=>db},'@/db/schema':schema,'@/db/mutable-study':statements,'@/lib/study-model':model,
  '@/lib/server-auth':{userId:async()=>owner,safeMutation:req=>req.headers.get('origin')==='https://test.local',privateJson:(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})},
  '@/content/questions.json':{default:questions},'@/content/resources-v2':resources,'@/content/exams/catalogue.json':{default:exams}
 });
 const post=(type,data,expectedOwner=owner)=>api.POST(new Request('https://test.local/api/study',{method:'POST',headers:{origin:'https://test.local','Content-Type':'application/json','X-Lantern-Owner':expectedOwner},body:JSON.stringify({type,data})}));
 try{
  assert.equal((await post('questionMark',mark())).status,200);
  assert.equal((await post('questionMark',mark({qid:'missing'}))).status,400);
  assert.equal((await post('questionMark',mark({reason:'invented'}))).status,400);
  assert.equal((await post('resourceTask',task({resourceId:'missing'}))).status,400);
  assert.equal((await post('resourceTask',task({plannedDate:'2026-02-30'}))).status,400);
  assert.equal((await post('resourceTask',task({qid:'unexpected'}))).status,400);
  assert.equal((await post('resourceTask',task({flagged:false}))).status,400);
  const linked=randomUUID();sqlite.prepare('INSERT INTO checkins(id,user_id,body,created_at) VALUES(?,?,?,?)').run(linked,'bob','{}',stamp);
  assert.equal((await post('resourceTask',task({checkinId:linked}))).status,400);
  assert.equal((await post('resourceTask',task({resourceId:'exam-'+exams[0].id}))).status,200);
  assert.equal((await post('questionMark',mark(),'bob')).status,409);
  const priorAttempt={id:randomUUID(),qid:questions[0].id,choice:0,createdAt:stamp,seconds:5};
  const priorCheckin={id:randomUUID(),date:'2026-01-01',minutes:5,load:'轻',note:'',createdAt:stamp};
  assert.equal((await post('attempt',priorAttempt)).status,200);assert.equal((await post('checkin',priorCheckin)).status,200);
  let response=await api.GET();assert.equal(response.headers.get('cache-control'),'no-store');
  const alice=await response.json();assert.equal(alice.schemaVersion,2);assert.equal(alice.questionMarks.length,1);assert.equal(alice.resourceTasks.length,1);
  owner='bob';const bob=await (await api.GET()).json();assert.equal(bob.questionMarks.length,0);assert.equal(bob.resourceTasks.length,0);
  assert.equal((await post('attempt',priorAttempt)).status,422);assert.equal((await post('checkin',priorCheckin)).status,422);
  assert.equal((await (await api.GET()).json()).attempts.length,0,'Conflicting imports must not falsely create an account copy');
  owner=null;assert.equal((await api.GET()).status,401);
 }finally{sqlite.close();}
});
