// F04: actual API/backup/hook modules; only local synthetic data and memory I/O.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID,webcrypto}=require('node:crypto');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const {environment,plain}=require(path.join(root,'tests/helpers/product-auth-harness.cjs'));
const ts=require(path.join(root,'node_modules/typescript'));
const stamp='2026-01-01T10:00:00.000Z';
const invalid=['2026-02-31','2026-02-29','1900-02-29','2100-02-29','2026-04-31',
 '2026-06-31','2026-09-31','2026-11-31','2026-00-10','2026-13-01','2026-01-00',
 '2026-01-32','2026-1-01','26-01-01',' 2026-01-01','2026-01-01T00:00:00Z'];
const valid=['0000-01-01','0001-01-01','0099-12-31','1900-02-28','2000-02-29',
 '2028-02-29','2026-01-01','2026-12-31','9999-12-31'];
const checkin=date=>({id:randomUUID(),date,minutes:5,load:'轻',note:'Synthetic F04 only',createdAt:stamp});
const init=(user,type,data)=>({cookie:user.cookie,owner:user.id,body:{type,data}});

function hookHarness(h,data){
 const model=h.load('lib/study-model.ts'),backup=h.load('lib/study-backup.ts');
 const key='lantern-v1-f04-synthetic',storage=new Map(data?[[key,JSON.stringify({data})]]:[]);
 const writes=[],errors=[];let slots=[],cursor=0,effects=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
 const react={
  useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},
  useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},
  useCallback(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn,deps};return slots[i].value;},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}},
 };
 const imports={react,sonner:{toast:{error:value=>errors.push(value)}},'./study-model':model,'./study-backup':backup};
 const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(root,'lib/use-study.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require(name){assert.ok(name in imports,'Unexpected hook import '+name);return imports[name];},
  Date,Intl,Map,Set,Error,JSON,structuredClone,Blob,URL,AbortController,crypto:webcrypto,
  navigator:{onLine:false},window:{addEventListener(){},removeEventListener(){}},
  localStorage:{get length(){return storage.size;},key:i=>[...storage.keys()][i]??null,getItem:key=>storage.get(key)??null,setItem(key,value){writes.push(key);storage.set(key,String(value));},removeItem:key=>storage.delete(key)},
  setTimeout:()=>1,clearTimeout(){},fetch(){throw Error('Offline F04 hook must not fetch');}}, {filename:'lib/use-study.ts'});
 const render=()=>{cursor=0;const api=exports.useStudy('f04-synthetic');const batch=effects;effects=[];batch.forEach(fn=>fn());return api;};
 render();render();return {render,storage,writes,errors,key};
}

test('F04 calendar predicate keeps reader calendar semantics, including leap centuries and year boundaries',()=>{
 const h=environment();try{
  const {validStudyDate}=h.load('lib/study-model.ts');
  for(const value of valid)assert.equal(validStudyDate(value),true,value);
  for(const value of [...invalid,'',null,undefined,20260101])assert.equal(validStudyDate(value),false,String(value));
 }finally{h.close();}
});

test('F04 profile API rejects every invalid calendar date before changing the existing row',async()=>{
 const h=environment();try{
  const user=await h.register(),model=h.load('lib/study-model.ts');
  const profile={...plain(model.DEFAULT_PROFILE),name:'Synthetic',examDate:'2028-02-29'};
  assert.equal((await h.call('study','POST',init(user,'profile',profile))).status,200);
  const before=h.rows('profiles');
  for(const examDate of invalid){
   const response=await h.call('study','POST',init(user,'profile',{...profile,examDate}));
   assert.equal(response.status,400,examDate);assert.deepEqual(h.rows('profiles'),before,examDate);
  }
 }finally{h.close();}
});

test('F04 checkin API rejects invalid dates and empty dates without creating or changing events',async()=>{
 const h=environment();try{
  const user=await h.register();const prior=checkin('2028-02-29');
  assert.equal((await h.call('study','POST',init(user,'checkin',prior))).status,200);
  const before=h.rows('checkins');
  for(const date of [...invalid,'']){
   assert.equal((await h.call('study','POST',init(user,'checkin',checkin(date)))).status,400,date);
   assert.deepEqual(h.rows('checkins'),before,date);
  }
  assert.equal((await h.call('study','POST',init(user,'checkin',{...prior,date:'2026-02-31'}))).status,400);
  assert.deepEqual(h.rows('checkins'),before);
 }finally{h.close();}
});

test('F04 valid API saves -> GET -> normal export -> strict reader preserve dates and event facts',async()=>{
 const h=environment();try{
  const user=await h.register(),model=h.load('lib/study-model.ts'),backup=h.load('lib/study-backup.ts');
  for(const date of valid){
   assert.equal((await h.call('study','POST',init(user,'profile',{...plain(model.DEFAULT_PROFILE),name:'Synthetic',examDate:date}))).status,200,date);
   const event=checkin(date);assert.equal((await h.call('study','POST',init(user,'checkin',event))).status,200,date);
   const saved=await (await h.call('study','GET',{cookie:user.cookie})).json();
   const encoded=JSON.stringify(backup.createStudyBackup(saved,stamp));const restored=plain(backup.parseStudyBackup(encoded));
   assert.equal(restored.profile.examDate,date);assert.deepEqual(restored.checkins,saved.checkins);
   assert.deepEqual(h.rows('checkins').map(row=>JSON.parse(row.body)),saved.checkins);
  }
  assert.equal((await h.call('study','POST',init(user,'profile',{...plain(model.DEFAULT_PROFILE),name:'Synthetic',examDate:''}))).status,200);
  const saved=await (await h.call('study','GET',{cookie:user.cookie})).json();
  assert.equal(backup.parseStudyBackup(JSON.stringify(backup.createStudyBackup(saved,stamp))).profile.examDate,'');
 }finally{h.close();}
});

for(const field of ['profile','checkin'])test('F04 old invalid '+field+' stays readable and byte-preserved; export fails visibly before emitting normal backup',async()=>{
 const h=environment();try{
  const user=await h.register(),model=h.load('lib/study-model.ts'),backup=h.load('lib/study-backup.ts');
  const profile={...plain(model.DEFAULT_PROFILE),name:'Synthetic',examDate:field==='profile'?'2026-02-31':''};
  const event=checkin(field==='checkin'?'2026-02-31':'2028-02-29');
  h.sqlite.prepare('INSERT INTO profiles(user_id,body,updated_at) VALUES(?,?,?)').run(user.id,JSON.stringify(profile),stamp);
  h.sqlite.prepare('INSERT INTO checkins(id,user_id,body,created_at) VALUES(?,?,?,?)').run(event.id,user.id,JSON.stringify(event),stamp);
  const rowsBefore={profiles:h.rows('profiles'),checkins:h.rows('checkins')};
  const saved=await (await h.call('study','GET',{cookie:user.cookie})).json();const bytesBefore=JSON.stringify(saved);
  assert.equal(field==='profile'?saved.profile.examDate:saved.checkins[0].date,'2026-02-31');
  assert.throws(()=>backup.createStudyBackup(saved,stamp),error=>error.name==='StudyBackupDateError'&&/无效日期/.test(error.message)&&/原记录未修改/.test(error.message));
  assert.equal(JSON.stringify(saved),bytesBefore);assert.deepEqual({profiles:h.rows('profiles'),checkins:h.rows('checkins')},rowsBefore);
  const oldFile={version:'2.0.0',exportedAt:stamp,audioIncluded:false,...saved};
  assert.throws(()=>backup.parseStudyBackup(JSON.stringify(oldFile)));
  assert.equal((await h.call('study','POST',init(user,'checkin',{...event,date:'2026-02-31'}))).status,400);
  assert.deepEqual({profiles:h.rows('profiles'),checkins:h.rows('checkins')},rowsBefore);
 }finally{h.close();}
});

test('F04 legal schema-1 and unversioned historical data remain exportable and strictly readable without input mutation',()=>{
 const h=environment();try{
  const model=h.load('lib/study-model.ts'),backup=h.load('lib/study-backup.ts');
  for(const schemaVersion of [undefined,1,2]){
   const data={...plain(model.EMPTY_DATA),profile:{...plain(model.DEFAULT_PROFILE),examDate:'2000-02-29'},checkins:[checkin('1900-02-28')]};
   if(schemaVersion===undefined)delete data.schemaVersion;else data.schemaVersion=schemaVersion;
   const before=JSON.stringify(data);const value=backup.createStudyBackup(data,stamp),parsed=plain(backup.parseStudyBackup(JSON.stringify(value)));
   assert.equal(value.version,'2.0.0');assert.equal(value.audioIncluded,false);
   assert.equal(parsed.profile.examDate,'2000-02-29');assert.deepEqual(parsed.checkins,data.checkins);assert.equal(JSON.stringify(data),before);
  }
 }finally{h.close();}
});

test('F04 local profile/checkin new writes reject invalid dates before journal/profile/setup mutations',()=>{
 const h=environment();try{
  const model=h.load('lib/study-model.ts'),local=hookHarness(h,plain(model.EMPTY_DATA));
  const before=[...local.storage],writes=local.writes.length;
  for(const date of invalid){
   assert.equal(local.render().saveProfile({...plain(model.DEFAULT_PROFILE),examDate:date}),false,date);
   assert.equal(local.render().addCheckin(checkin(date)),false,date);
   assert.deepEqual([...local.storage],before,date);assert.equal(local.writes.length,writes,date);
  }
  assert.ok(local.errors.some(message=>/日期/.test(message)));
 }finally{h.close();}
});

test('F04 local old invalid event identical replay stays confirmable without rewriting; new invalid ID is rejected',()=>{
 const h=environment();try{
  const model=h.load('lib/study-model.ts'),backup=h.load('lib/study-backup.ts'),event=checkin('2026-02-31');
  const data={...plain(model.EMPTY_DATA),checkins:[event]},local=hookHarness(h,data),before=[...local.storage],writes=local.writes.length;
  assert.deepEqual(plain(local.render().readCheckin(event.id)),event);
  assert.equal(local.render().addCheckin(event),true);assert.equal(local.writes.length,writes);
  assert.equal(local.render().addCheckin({...event,id:randomUUID()}),false);
  assert.throws(()=>backup.createStudyBackup(local.render().data,stamp),error=>error.name==='StudyBackupDateError');
  assert.deepEqual([...local.storage],before);assert.equal(local.writes.length,writes);
 }finally{h.close();}
});

test('F04 local legal new writes preserve normal save/export/read behavior',()=>{
 const h=environment();try{
  const model=h.load('lib/study-model.ts'),backup=h.load('lib/study-backup.ts'),local=hookHarness(h,plain(model.EMPTY_DATA));
  assert.equal(local.render().saveProfile({...plain(model.DEFAULT_PROFILE),examDate:'2028-02-29'}),true);
  const event=checkin('2028-02-29');assert.equal(local.render().addCheckin(event),true);
  const parsed=plain(backup.parseStudyBackup(JSON.stringify(backup.createStudyBackup(local.render().data,stamp))));
  assert.equal(parsed.profile.examDate,'2028-02-29');assert.deepEqual(parsed.checkins,[event]);
 }finally{h.close();}
});
