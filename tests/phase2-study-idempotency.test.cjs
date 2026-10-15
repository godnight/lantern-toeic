// Executes the actual hook and API with synthetic storage and an in-memory
// SQLite database. No learner origin, real account or device is accessed.
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto,randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const ts=require('typescript');
const orm=require('drizzle-orm');
const {drizzle}=require('drizzle-orm/sqlite-proxy');
const root=path.resolve(__dirname,'..');
function load(file,imports={},globals={}){
 const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require(name){assert.ok(name in imports,'Unexpected import '+name);return imports[name];},Date,Intl,Map,Set,structuredClone,Request,Response,Headers,Blob,URL,AbortController,FormData,crypto:webcrypto,...globals},{filename:file});return exports;
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
const a=()=>({id:randomUUID(),qid:questions[0].id,choice:0,correct:questions[0].correctIndex===0,seconds:4,createdAt:stamp,mode:'first'});
const c=()=>({id:randomUUID(),date:'2026-01-01',minutes:5,load:'轻',note:'Synthetic settlement',createdAt:stamp});
const main='lantern-v1-alice';
const snapshot=(overrides={})=>JSON.stringify({data:{...plain(model.EMPTY_DATA),...overrides}});
function harness(storage=new Map(),options={}){
 let slots=[],cursor=0,effects=[],owner='alice',online=false;const writes=[],errors=[],requests=[];
 const same=(x,y)=>x&&y&&x.length===y.length&&x.every((v,i)=>Object.is(v,y[i]));
 const react={
  useState(v){const i=cursor++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},
  useRef(v){const i=cursor++;if(!(i in slots))slots[i]={current:v};return slots[i];},
  useCallback(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn,deps};return slots[i].value;},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}
 };
 const localStorage={get length(){return storage.size;},key:i=>[...storage.keys()][i]??null,getItem:key=>storage.get(key)??null,setItem(key,value){options.beforeSet?.(key,value);writes.push(key);storage.set(key,String(value));},removeItem:key=>storage.delete(key)};
 const hook=load('lib/use-study.ts',{react,sonner:{toast:{error:value=>errors.push(value)}},'./study-model':model,'./study-backup':backup},{localStorage,navigator:{get onLine(){return online;}},window:{addEventListener(){},removeEventListener(){}},setTimeout:()=>1,clearTimeout(){},fetch:async(url,init)=>{requests.push({url,init});if(options.fetch)return options.fetch(url,init);throw Error('Offline test must not fetch');}});
 const render=(nextOwner=owner)=>{owner=nextOwner;cursor=0;const api=hook.useStudy(owner);const batch=effects;effects=[];batch.forEach(fn=>fn());return api;};
 render();return {render,storage,writes,errors,requests,online(value){online=value;},ops:()=>[...storage.entries()].filter(([k])=>k.startsWith(main+':op:')).map(([,v])=>JSON.parse(v))};
}
function journal(storage,type,data,{id=randomUUID(),owner='alice',ack=false}={}){storage.set(main+':op:'+id,JSON.stringify({id,owner,type,data}));if(ack)storage.set(main+':ack:'+id,'1');return id;}

test('local fixed attempts and checkins replay in canonical property order without another journal entry',()=>{
 const h=harness(),api=h.render(),attempt=a(),checkin=c();
 assert.equal(api.addAttempt(attempt),true);assert.equal(api.addCheckin(checkin),true);
 const writes=h.writes.length;
 for(let i=0;i<4;i++){
  assert.equal(api.addAttempt(Object.fromEntries(Object.entries(attempt).reverse())),true);
  assert.equal(api.addCheckin(Object.fromEntries(Object.entries(checkin).reverse())),true);
 }
 assert.equal(h.writes.length,writes);assert.equal(h.ops().length,2);
 assert.deepEqual(plain(api.readAttempt(attempt.id)),attempt);assert.deepEqual(plain(api.readCheckin(checkin.id)),checkin);
 const copy=api.readAttempt(attempt.id);copy.choice=3;assert.equal(api.readAttempt(attempt.id).choice,attempt.choice);
});

test('local attempt same-ID changes to every immutable field fail without changing the original',()=>{
 const h=harness(),api=h.render(),attempt=a();assert.equal(api.addAttempt(attempt),true);
 const before=[...h.storage];
 for(const change of [{qid:questions[1].id},{choice:1},{correct:!attempt.correct},{seconds:6},{createdAt:'2026-01-02T10:00:00.000Z'},{mode:'review'}])assert.equal(api.addAttempt({...attempt,...change}),false);
 assert.deepEqual([...h.storage],before);assert.deepEqual(plain(api.readAttempt(attempt.id)),attempt);
});

test('local settlement same-ID changes to every immutable field fail and cannot add minutes twice',()=>{
 const h=harness(),api=h.render(),checkin=c();assert.equal(api.addCheckin(checkin),true);const before=[...h.storage];
 for(const change of [{date:'2026-01-02'},{minutes:6},{load:'重'},{note:'changed'},{createdAt:'2026-01-02T10:00:00.000Z'}])assert.equal(api.addCheckin({...checkin,...change}),false);
 assert.deepEqual([...h.storage],before);assert.equal(h.render().data.checkins.reduce((n,v)=>n+v.minutes,0),5);
});

test('a stale tab reads durable events written by another tab before classifying a replay or conflict',()=>{
 const storage=new Map(),first=harness(storage),second=harness(storage),stale=second.render(),attempt=a();
 assert.equal(first.render().addAttempt(attempt),true);
 assert.equal(stale.data.attempts.length,0);assert.deepEqual(plain(stale.readAttempt(attempt.id)),attempt);
 assert.equal(stale.addAttempt({...attempt,seconds:9}),false);assert.equal(stale.addAttempt(attempt),true);assert.equal(first.ops().length,1);
});

test('journal success with summary quota failure is confirmable and retries preserve its ID/time/payload',()=>{
 const h=harness(new Map(),{beforeSet(key){if(key===main)throw Error('Synthetic summary quota');}}),api=h.render(),attempt=a(),checkin=c();
 assert.equal(api.addAttempt(attempt),false);assert.deepEqual(plain(api.readAttempt(attempt.id)),attempt);
 assert.equal(api.addCheckin(checkin),false);assert.deepEqual(plain(api.readCheckin(checkin.id)),checkin);
 const writes=h.writes.length;
 assert.equal(api.addAttempt(attempt),true);assert.equal(api.addCheckin(checkin),true);
 assert.equal(h.writes.length,writes);assert.equal(h.ops().length,2);assert.equal(h.storage.has(main),false);
});

test('journal quota failure never confirms a new record',()=>{
 const h=harness(new Map(),{beforeSet(key){if(key.includes(':op:'))throw Error('Synthetic journal quota');}}),api=h.render(),attempt=a(),checkin=c();
 assert.equal(api.addAttempt(attempt),false);assert.equal(api.addCheckin(checkin),false);
 assert.equal(api.readAttempt(attempt.id),undefined);assert.equal(api.readCheckin(checkin.id),undefined);assert.equal([...h.storage.keys()].filter(key=>!key.endsWith(':setup')).length,0);assert.equal(JSON.parse([...h.storage.entries()].find(([key])=>key.endsWith(':setup'))[1]).state,'suggested');
});

test('acknowledged journal survives a lost summary and is re-read after a reload',()=>{
 const storage=new Map([[main,snapshot()]]),attempt=a(),checkin=c();
 journal(storage,'attempt',attempt,{ack:true});journal(storage,'checkin',checkin,{ack:true});
 const api=harness(storage).render();assert.deepEqual(plain(api.readAttempt(attempt.id)),attempt);assert.deepEqual(plain(api.readCheckin(checkin.id)),checkin);
});

test('snapshot-only legacy records remain confirmable without migration or journal writes',()=>{
 const attempt=a(),checkin=c(),storage=new Map([[main,snapshot({attempts:[attempt],checkins:[checkin]})]]),h=harness(storage),api=h.render();
 assert.deepEqual(plain(api.readAttempt(attempt.id)),attempt);assert.deepEqual(plain(api.readCheckin(checkin.id)),checkin);
 assert.equal(api.addAttempt(attempt),true);assert.equal(api.addCheckin(checkin),true);assert.equal(h.writes.length,0);
});

test('conflicting snapshot and journal cannot be confirmed or overwritten',()=>{
 for(const type of ['attempt','checkin']){
  const value=type==='attempt'?a():c(),storage=new Map([[main,snapshot({[type==='attempt'?'attempts':'checkins']:[value]})]]);
  journal(storage,type,{...value,...(type==='attempt'?{seconds:9}:{minutes:9})});const before=[...storage];
  const h=harness(storage),api=h.render();assert.throws(()=>api[type==='attempt'?'readAttempt':'readCheckin'](value.id),/不同内容/);
  assert.equal(api[type==='attempt'?'addAttempt':'addCheckin'](value),false);assert.equal(h.render().recordsReadable,false);assert.deepEqual([...storage],before);
 }
});

test('corrupt and future main snapshots stop bridges and retain the exact original bytes',()=>{
 for(const raw of ['{"data":','{}','null',snapshot({schemaVersion:999})]){
  const storage=new Map([[main,raw]]),h=harness(storage),api=h.render(),attempt=a();
  assert.throws(()=>api.readAttempt(attempt.id));assert.throws(()=>api.readCheckin('missing'));assert.equal(api.addAttempt(attempt),false);
  assert.equal(storage.get(main),raw);assert.equal(h.writes.length,0);
 }
});

test('corrupt journals and malformed matching payloads fail closed without removing raw bytes',()=>{
 for(const raw of ['{','null',JSON.stringify({id:'op',owner:'alice',type:'attempt',data:{id:'broken'}})]){
  const storage=new Map([[main,snapshot()],[main+':op:bad',raw]]),h=harness(storage),api=h.render();
  assert.throws(()=>api.readAttempt('broken'));assert.equal(storage.get(main+':op:bad'),raw);assert.equal(h.writes.length,0);
 }
});

test('owner switch invalidates captured readers and does not confirm another partition or foreign journal',()=>{
 const attempt=a(),storage=new Map([[main,snapshot({attempts:[attempt]})]]),h=harness(storage),alice=h.render();
 h.render('bob');const bob=h.render('bob');assert.throws(()=>alice.readAttempt(attempt.id),/账号/);assert.equal(bob.readAttempt(attempt.id),undefined);
 assert.equal(alice.addAttempt(a()),false);
 const foreign=new Map();journal(foreign,'attempt',attempt,{owner:'bob'});assert.equal(harness(foreign).render().readAttempt(attempt.id),undefined);
});

test('a payload-conflict 409 blocks only its event while healthy later records synchronize',async()=>{
 const h=harness(new Map(),{fetch:async(url,init)=>{
  if(init?.method==='POST')return JSON.parse(init.body).type==='attempt'?new Response('{}',{status:409,headers:{'X-Lantern-Conflict':'event-payload'}}):new Response('{}');
  return Response.json({...plain(model.EMPTY_DATA),owner:'alice',hasProfile:true});
 }}),api=h.render(),attempt=a(),checkin=c();
 api.addAttempt(attempt);api.addCheckin(checkin);h.online(true);await api.syncNow();
 const issues=h.render().issues;assert.equal(issues.length,1);assert.equal(issues[0].kind,'op');assert.equal(issues[0].status,'blocked');
 assert.ok(h.requests.some(r=>r.init?.method==='POST'&&JSON.parse(r.init.body).type==='checkin'));
 const op=h.ops().find(op=>op.type==='checkin');assert.equal(h.storage.get(main+':ack:'+op.id),'1');assert.equal(h.storage.has(main+':sync:session:account'),false);
});

function server(){
 const sqlite=new DatabaseSync(':memory:');for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));
 let owner='alice',failed=false;
 const db=drizzle(async(query,params,method)=>{if(failed)throw Error('Synthetic database failure');const prepared=sqlite.prepare(query);if(method==='run'){prepared.run(...params);return {rows:[]};}const rows=prepared.all(...params).map(row=>Object.values(row));return {rows:method==='get'?rows[0]:rows};});
 const api=load('app/api/study/route.ts',{'drizzle-orm':orm,zod:require('zod'),'@/db':{getDb:()=>db},'@/db/schema':schema,'@/db/mutable-study':statements,'@/lib/study-model':model,'@/lib/server-auth':{userId:async()=>owner,safeMutation:req=>req.headers.get('origin')==='https://test.local',privateJson:(body,status=200)=>Response.json(body,{status})},'@/content/questions.json':{default:questions},'@/content/resources-v2':resources,'@/content/exams/catalogue.json':{default:exams}});
 return {sqlite,api,owner(value){owner=value;},fail(){failed=true;},post:(type,data,headerOwner=owner)=>api.POST(new Request('https://test.local/api/study',{method:'POST',headers:{origin:'https://test.local','Content-Type':'application/json','X-Lantern-Owner':headerOwner},body:JSON.stringify({type,data})}))};
}

test('server same-payload retries preserve one row, original first mode and server-calculated correctness',async()=>{
 const h=server();try{
  const attempt={...a(),correct:questions[0].correctIndex!==0,mode:'review'};
  for(let i=0;i<4;i++)assert.equal((await h.post('attempt',attempt)).status,200);
  const rows=h.sqlite.prepare('SELECT * FROM attempts').all();assert.equal(rows.length,1);assert.equal(rows[0].mode,'first');assert.equal(Boolean(rows[0].correct),attempt.choice===questions[0].correctIndex);
  const later={...attempt,id:randomUUID(),createdAt:'2026-01-02T10:00:00.000Z',mode:'first'};assert.equal((await h.post('attempt',later)).status,200);
  assert.equal(h.sqlite.prepare('SELECT mode FROM attempts WHERE id=?').get(later.id).mode,'review');
  assert.equal((await h.post('attempt',attempt)).status,200);assert.equal(h.sqlite.prepare('SELECT mode FROM attempts WHERE id=?').get(attempt.id).mode,'first');
 }finally{h.sqlite.close();}
});

test('server same-owner attempt payload changes return 409 and preserve the complete original row',async()=>{
 const h=server();try{
  const attempt=a();assert.equal((await h.post('attempt',attempt)).status,200);const before=plain(h.sqlite.prepare('SELECT * FROM attempts').all());
  for(const change of [{qid:questions[1].id},{choice:1},{seconds:9},{createdAt:'2026-01-02T10:00:00.000Z'}]){const response=await h.post('attempt',{...attempt,...change});assert.equal(response.status,409);assert.equal(response.headers.get('X-Lantern-Conflict'),'event-payload');}
  assert.deepEqual(plain(h.sqlite.prepare('SELECT * FROM attempts').all()),before);
 }finally{h.sqlite.close();}
});

test('server settlement retries count once; changes to any checkin payload field return 409',async()=>{
 const h=server();try{
  const checkin=c();for(let i=0;i<4;i++)assert.equal((await h.post('checkin',checkin)).status,200);
  const before=plain(h.sqlite.prepare('SELECT * FROM checkins').all());assert.equal(before.length,1);
  for(const change of [{date:'2026-01-02'},{minutes:9},{load:'重'},{note:'changed'},{createdAt:'2026-01-02T10:00:00.000Z'}])assert.equal((await h.post('checkin',{...checkin,...change})).status,409);
  assert.deepEqual(plain(h.sqlite.prepare('SELECT * FROM checkins').all()),before);assert.equal(JSON.parse(before[0].body).minutes,5);
 }finally{h.sqlite.close();}
});

test('server global-ID collisions retain account isolation and existing 422 without copying foreign rows',async()=>{
 const h=server();try{
  const attempt=a(),checkin=c();assert.equal((await h.post('attempt',attempt)).status,200);assert.equal((await h.post('checkin',checkin)).status,200);
  h.owner('bob');assert.equal((await h.post('attempt',attempt)).status,422);assert.equal((await h.post('checkin',checkin)).status,422);
  const bob=await (await h.api.GET()).json();assert.equal(bob.attempts.length,0);assert.equal(bob.checkins.length,0);
  assert.equal((await h.post('attempt',a(),'alice')).status,409);
 }finally{h.sqlite.close();}
});

test('overlapping identical server retries produce one durable event and no false conflicts',async()=>{
 const h=server();try{
  const attempt=a(),checkin=c();const results=await Promise.all(Array.from({length:5},()=>h.post('attempt',attempt)));assert.ok(results.every(r=>r.status===200));
  const settlements=await Promise.all(Array.from({length:5},()=>h.post('checkin',checkin)));assert.ok(settlements.every(r=>r.status===200));
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM attempts').get().n,1);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM checkins').get().n,1);
 }finally{h.sqlite.close();}
});

test('server database failure returns unavailable, never a durable success',async()=>{
 const h=server();try{h.fail();assert.equal((await h.post('attempt',a())).status,503);assert.equal((await h.post('checkin',c())).status,503);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM attempts').get().n,0);}finally{h.sqlite.close();}
});
