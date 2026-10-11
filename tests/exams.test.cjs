const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const fixture = require('./fixtures/synthetic-exam.cjs');
const root = process.env.LANTERN_EXAM_ROOT || path.resolve(__dirname, '..');
const ts = require(process.env.LANTERN_TYPESCRIPT || path.join(root, 'node_modules/typescript'));
const { IDBFactory, IDBObjectStore } = require('fake-indexeddb');
function load(file, imports = {}, globals = {}) {
  const exports = {}, code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require(name) { assert.ok(name in imports, `Unexpected import: ${name}`); return imports[name]; }, Date, Map, Set, Error, JSON, Promise, structuredClone, TextEncoder, Uint8Array, Uint32Array, ArrayBuffer, Blob, URL, atob, btoa, crypto: crypto.webcrypto, ...globals }, { filename:file });
  return exports;
}
const model = load('lib/exam-model.ts');
const storage = load('lib/exam-storage.ts', {'./exam-model':model});
const plain = v => JSON.parse(JSON.stringify(v));
const start = Date.parse('2026-10-11T00:00:00.000Z');
const pack = () => model.parseExamPackage(fixture());
const attempt = (e = pack(), extras = {}) => model.createAttempt(e, {id:'attempt-1',ownerId:'alice',fingerprint:'sha256:'+'a'.repeat(64),ordinal:1,now:start,...extras});
async function repo(owner='alice', factory=new IDBFactory()) { return storage.openExamRepository(owner,{factory,name:'test-exams'}); }

test('actual parser accepts only a complete current 200-question L&R structure',()=>{
  const exam=pack(); assert.equal(exam.questions.length,200);
  assert.deepEqual(Array.from(model.PART_COUNTS),[6,25,39,30,30,16,54]);
  for(let part=1;part<=7;part++)assert.equal(exam.questions.filter(q=>q.part===part).length,model.PART_COUNTS[part-1]);
  assert.equal(exam.groups.filter(g=>g.part===3).length,13);assert.equal(exam.groups.filter(g=>g.part===4).length,10);
  assert.equal(exam.questions.filter(q=>q.part===2&&q.choices.length===3).length,25);
});
test('incomplete, duplicate, noncontinuous, wrong-Part and invalid answer imports fail before storage',()=>{
  const edits=[e=>e.questions.pop(),e=>e.questions[4].number=4,e=>e.questions[31].part=2,e=>e.questions[6].choices.push('D'),e=>e.questions[0].answer=4,e=>e.questions[6].answer=3,e=>e.version=2.5,e=>e.id='../escape',e=>e.assets.push(e.assets[0])];
  for(const edit of edits){const e=fixture();edit(e);assert.throws(()=>model.parseExamPackage(e));}
});
test('question groups reject lost questions, cross-Part groups, missing text, wrong P7 single/multiple boundary',()=>{
  const edits=[e=>e.groups.pop(),e=>e.groups.find(g=>g.part===3).questionNumbers.pop(),e=>e.groups[1].questionNumbers=[1],e=>e.questions[50].groupId='absent',e=>e.groups.find(g=>g.part===6).passages=[],e=>e.groups.find(g=>g.part===7).passages=['one','two'],e=>e.groups.find(g=>g.part===7&&g.questionNumbers[0]>175).passages=['one'],e=>e.groups[0].imageIds=[]];
  for(const edit of edits){const e=fixture();edit(e);assert.throws(()=>model.parseExamPackage(e));}
});
test('all media are embedded, allowlisted, type-sniffed, canonical, referenced and bounded',()=>{
  const edits=[e=>e.assets[0].mime='image/svg+xml',e=>e.assets[0].base64='https://evil.invalid/a.png',e=>e.assets[0].base64=Buffer.from('<script>bad()</script>').toString('base64'),e=>e.assets[0].url='https://evil.invalid',e=>e.groups[0].imageIds=['missing'],e=>e.groups[0].imageIds=['test-silence'],e=>e.listeningAudioId='pixel',e=>e.assets.push({...e.assets[0],id:'unused'}),e=>e.assets[1].base64=e.assets[1].base64.slice(0,-3)+'h=='];
  for(const edit of edits){const e=fixture();edit(e);assert.throws(()=>model.parseExamPackage(e));}
  const huge=fixture();huge.assets[0].base64='A'.repeat(Math.ceil(model.EXAM_LIMITS.imageBytes/3)*4+4);assert.throws(()=>model.parseExamPackage(huge),/base64|限额/);
});
test('source metadata distinguishes unverified imported official material from authored fixtures',()=>{
  const e=fixture();e.source.classification='official-past';assert.throws(()=>model.parseExamPackage(e),/发行方/);
  e.source.publisher='Importer-named publisher';e.source.reference='Specific book edition / test number, declared by importer';
  const valid=model.parseExamPackage(e);assert.equal(valid.source.classification,'official-past');assert.equal('verified' in valid.source,false);
  e.source.rightsStatement='';assert.throws(()=>model.parseExamPackage(e),/使用依据/);
});
test('JSON cannot smuggle executable fields or prototype names and invalid JSON is reported',()=>{
  assert.throws(()=>model.parseExamPackage('{bad'),/JSON/);
  const e=fixture();e.questions[0].html='<b>answer</b>';assert.throws(()=>model.parseExamPackage(e),/不支持字段/);
  assert.throws(()=>model.parseExamPackage(JSON.stringify(fixture()).replace('"kind":','"__proto__":{},"kind":')),/不支持字段/);
});
test('fingerprints normalize object and asset order and portable SHA-256 matches native crypto',async()=>{
  const e=pack(), reversed=fixture();reversed.assets.reverse();reversed.source={rightsStatement:reversed.source.rightsStatement,title:reversed.source.title,classification:reversed.source.classification};
  const expected='sha256:'+crypto.createHash('sha256').update(JSON.stringify(e)).digest('hex');
  assert.equal(await model.fingerprintExam(e),expected);assert.equal(await model.fingerprintExam(model.parseExamPackage(reversed)),expected);
  const portable=load('lib/exam-model.ts',{}, {crypto:undefined});assert.equal(await portable.fingerprintExam(e),expected);
});
test('LC is exactly 45 minutes, RC 75 minutes, with no early RC access or return to LC',()=>{
  const a=attempt();assert.equal(a.listeningDeadline-start,45*60*1000);assert.equal(a.readingDeadline-a.listeningDeadline,75*60*1000);
  assert.throws(()=>model.answerQuestion(a,101,0,start+100),/阶段/);
  assert.throws(()=>model.submitAttempt(a,start+100),/听力/);
  const r=model.advanceAttempt(a,a.listeningDeadline);assert.equal(r.status,'reading');assert.equal(r.activeQuestion,101);
  assert.throws(()=>model.answerQuestion(r,100,0,r.lastObservedAt),/阶段/);
});
test('background/cold restoration jumps through both deadlines and submits exactly at the deadline',()=>{
  const a=attempt(), after=model.advanceAttempt(a,start+7*86400000);
  assert.equal(after.status,'submitted');assert.equal(after.submittedAt,a.readingDeadline);assert.equal(after.submittedReason,'timeout');
  assert.equal(after.questionTimeMs[1],model.LISTENING_MS);assert.equal(after.questionTimeMs[101],model.READING_MS);
  assert.deepEqual(plain(model.advanceAttempt(after,start+9*86400000)),plain(after));
  assert.throws(()=>model.answerQuestion(after,200,1,start+9*86400000),/交卷/);
});
test('clock rollback never reduces observed elapsed time or moves deadlines',()=>{
  const a=model.advanceAttempt(attempt(),start+10000), back=model.advanceAttempt(a,start+1000);
  assert.equal(back.lastObservedAt,a.lastObservedAt);assert.equal(back.readingDeadline,a.readingDeadline);assert.equal(back.clockRollback,true);
  assert.deepEqual(plain(back.questionTimeMs),plain(a.questionTimeMs));
});
test('unfinished presentation omits answer/analysis/reference score and future section, grading is blocked',()=>{
  const e=pack(), a=attempt(e), visible=model.presentExam(e,a);
  assert.equal(visible.questions.length,100);assert.ok(visible.groups.every(g=>g.part<=4));
  assert.ok(visible.questions.every(q=>!('answer' in q)&&!('explanation' in q)));assert.equal(visible.scoreRanges,undefined);
  assert.throws(()=>model.gradeAttempt(e,a),/交卷前/);
  const reading=model.presentExam(e,model.advanceAttempt(a,a.listeningDeadline));assert.ok(reading.questions.every(q=>q.number>100));
});
test('actual full 200-question run keeps raw counts, missed questions, Part accuracy and time, not fabricated ETS scores',()=>{
  const e=pack();let a=attempt(e);
  for(let n=1;n<=100;n++)a=model.answerQuestion(a,n,e.questions[n-1].answer,start+n*100);
  a=model.advanceAttempt(a,a.listeningDeadline);
  for(let n=101;n<=199;n++)a=model.answerQuestion(a,n,e.questions[n-1].answer,a.listeningDeadline+(n-100)*100);
  a=model.answerQuestion(a,101,(e.questions[100].answer+1)%4,a.listeningDeadline+10000);
  a=model.submitAttempt(a,a.listeningDeadline+11000);
  const grade=model.gradeAttempt(e,a);assert.equal(grade.correct,198);assert.equal(grade.unanswered,1);assert.equal(grade.listeningCorrect,100);assert.equal(grade.readingCorrect,98);
  assert.equal(grade.parts[4].correct,29);assert.equal(grade.parts[6].unanswered,1);assert.equal(grade.parts.reduce((n,p)=>n+p.timeMs,0),grade.elapsedMs);
  assert.equal(grade.firstAttempt,true);assert.equal(grade.referenceRange,undefined);assert.equal('score' in grade,false);
  assert.equal(model.presentExam(e,a).questions[0].answer,e.questions[0].answer);
  assert.deepEqual(plain(model.validateAttempt(a,e,'alice',a.fingerprint)),plain(a));
});
test('optional reference tables require source, full range and monotonic bands and are labeled per-paper only',()=>{
  const e=fixture(), bands=[{minCorrect:0,maxCorrect:50,minScore:5,maxScore:250},{minCorrect:51,maxCorrect:100,minScore:250,maxScore:495}];
  e.scoreRanges={source:'Synthetic test-only reference table, not a real conversion',listening:bands,reading:bands};
  const valid=model.parseExamPackage(e),a=model.advanceAttempt(attempt(valid),start+model.LISTENING_MS+model.READING_MS);
  assert.match(model.gradeAttempt(valid,a).referenceRange.disclaimer,/不是官方考试成绩/);
  e.scoreRanges.source='';assert.throws(()=>model.parseExamPackage(e));e.scoreRanges.source='Test';e.scoreRanges.listening=[{...bands[0],maxCorrect:40},bands[1]];assert.throws(()=>model.parseExamPackage(e),/连续/);
});
test('restored attempts reject forged deadlines, wrong owners, premature results, illegal options and accounting',()=>{
  const e=pack(), a=attempt(e);
  const edits=[v=>v.ownerId='bob',v=>v.listeningDeadline++,v=>v.status='submitted',v=>v.activeQuestion=101,v=>v.questionTimeMs[1]=50,v=>v.answers[7]={choice:3,savedAt:start},v=>v.answers[101]={choice:1,savedAt:start},v=>v.answers['__proto__']={choice:1,savedAt:start},v=>v.result={correct:200}];
  for(const edit of edits){const v=plain(a);edit(v);if(Object.getPrototypeOf(v.answers)!==Object.prototype)continue;assert.throws(()=>model.validateAttempt(v,e,'alice',a.fingerprint));}
});
test('IDB import is duplicate-idempotent, versions coexist, content conflicts do not replace originals',async()=>{
  const r=await repo();const first=await r.importPackage(fixture(),start);assert.equal(first.status,'imported');
  assert.equal((await r.importPackage(fixture(),start+1)).status,'unchanged');
  const changed=fixture();changed.questions[0].answer=2;await assert.rejects(r.importPackage(changed),/冲突/);
  assert.equal((await r.getPackage(first.summary.key)).questions[0].answer,fixture().questions[0].answer);
  changed.version=2;await r.importPackage(changed);assert.equal((await r.listPackages()).length,2);r.close();
});
test('actual IDB isolates package list, reads, answers, history and backups by owner',async()=>{
  const factory=new IDBFactory(),a=await repo('alice',factory),b=await repo('bob',factory);
  const {summary}=await a.importPackage(fixture());const begun=await a.startAttempt(summary.key,start,'first');
  assert.deepEqual(plain(await b.listPackages()),[]);assert.deepEqual(plain(await b.listAttempts()),[]);
  await assert.rejects(b.getPackage(summary.key),/当前账号/);await assert.rejects(b.answer(begun.attempt.id,1,0,start),/当前账号/);
  const exported=await a.exportBackup();await assert.rejects(b.importBackup(exported,start),/其他账号/);assert.equal((await b.exportBackup()).packages.length,0);
  a.close();b.close();
});
test('restart restores answers, advances time, persists late automatic grading, and retains first vs retake',async()=>{
  const factory=new IDBFactory();let r=await repo('alice',factory);const {summary}=await r.importPackage(fixture());
  let first=await r.startAttempt(summary.key,start,'first');first=await r.answer('first',7,2,start+5000,first.attempt.revision);r.close();
  r=await repo('alice',factory);let resumed=await r.resumeAttempt('first',start+model.LISTENING_MS+1000);assert.equal(resumed.attempt.status,'reading');assert.equal(resumed.attempt.answers[7].choice,2);
  await assert.rejects(r.answer('first',7,0,start+model.LISTENING_MS+2000),/阶段/);
  const late=await r.answer('first',101,0,start+model.LISTENING_MS+model.READING_MS+1000);assert.equal(late.attempt.status,'submitted');assert.equal(late.result.unanswered,199);assert.equal(late.attempt.answers[101],undefined);
  const again=await r.submit('first',start+99999999);assert.deepEqual(plain(again),plain(late));
  const second=await r.startAttempt(summary.key,start+99999999,'second');assert.equal(second.attempt.ordinal,2);assert.equal((await r.listAttempts()).length,2);r.close();
});
test('concurrent tabs serialize answers and reject stale expected revisions without losing earlier choices',async()=>{
  const factory=new IDBFactory(),r=await repo('alice',factory),tab=await repo('alice',factory);const {summary}=await r.importPackage(fixture());const first=await r.startAttempt(summary.key,start,'same');
  const results=await Promise.allSettled([r.answer('same',1,1,start+100,first.attempt.revision),tab.answer('same',2,2,start+100,first.attempt.revision)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
  const current=await r.resumeAttempt('same',start+100);assert.equal(Object.keys(current.attempt.answers).length,1);
  await tab.answer('same',3,3,start+200);assert.equal(Object.keys((await r.resumeAttempt('same',start+200)).attempt.answers).length,2);
  await assert.rejects(tab.startAttempt(summary.key,start+300,'parallel'),/进行中/);r.close();tab.close();
});
test('quota failure during the second IDB write rolls back the entire new package and keeps existing packages',async()=>{
  const r=await repo();await r.importPackage(fixture());const add=IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add=function(value,...rest){if(this.name==='catalog'&&value.id==='quota-failure'){const e=new Error('full');e.name='QuotaExceededError';throw e;}return add.call(this,value,...rest);};
  try{await assert.rejects(r.importPackage(fixture('quota-failure')),/空间不足/);}finally{IDBObjectStore.prototype.add=add;}
  assert.equal((await r.listPackages()).length,1);await assert.rejects(r.getPackage('quota-failure@1'),/没有/);r.close();
});
test('answer save quota failure preserves earlier answer and exposes failure instead of reporting saved',async()=>{
  const r=await repo(),{summary}=await r.importPackage(fixture());await r.startAttempt(summary.key,start,'exam');await r.answer('exam',1,1,start+100);
  const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='attempts'){const e=new Error('full');e.name='QuotaExceededError';throw e;}return put.apply(this,args);};
  try{await assert.rejects(r.answer('exam',1,2,start+200),/空间不足/);}finally{IDBObjectStore.prototype.put=put;}
  const old=(await r.listAttempts())[0];assert.equal(old.attempt.answers[1].choice,1);assert.equal(old.attempt.lastObservedAt,start+100);r.close();
});
test('backup restores complete private packages/history to the same owner and duplicate import changes no counts',async()=>{
  const a=await repo(),{summary}=await a.importPackage(fixture());await a.importPackage(fixture('second-paper'));await a.startAttempt(summary.key,start,'first');await a.answer('first',1,1,start+100);await a.resumeAttempt('first',start+7200000);
  const backup=await a.exportBackup(),b=await repo();assert.deepEqual(plain(await b.importBackup(JSON.stringify(backup),start+7200001)),{packagesAdded:2,attemptsAdded:1});
  assert.deepEqual(plain(await b.importBackup(backup,start+7200001)),{packagesAdded:0,attemptsAdded:0});assert.equal((await b.listAttempts())[0].result.unanswered,199);
  a.close();b.close();
});
test('a later conflicting attempt or package aborts backup import before any partial new content is visible',async()=>{
  const a=await repo(),{summary}=await a.importPackage(fixture());await a.startAttempt(summary.key,start,'first');const backup=await a.exportBackup();backup.packages.unshift(model.parseExamPackage(fixture('new-paper')));backup.packages[1].title='same ID changed';
  await assert.rejects(a.importBackup(backup,start),/冲突|摘要不匹配/);assert.equal((await a.listPackages()).length,1);
  const b=await a.exportBackup();b.packages.unshift(model.parseExamPackage(fixture('new-paper')));b.attempts[0].answers[1]={choice:2,savedAt:start};
  await assert.rejects(a.importBackup(b,start),/记录冲突/);assert.equal((await a.listPackages()).length,1);assert.equal(Object.keys((await a.listAttempts())[0].attempt.answers).length,0);a.close();
});
test('expired active backup becomes an immutable timeout result and invalid first/retake ordinals are rejected',async()=>{
  const a=await repo(),{summary}=await a.importPackage(fixture());await a.startAttempt(summary.key,start,'first');const backup=await a.exportBackup(),b=await repo();await b.importBackup(backup,start+7200000);assert.equal((await b.listAttempts())[0].attempt.submittedReason,'timeout');
  const bad=plain(backup);bad.attempts[0].ordinal=2;const c=await repo();await assert.rejects(c.importBackup(bad,start+7200000),/序号/);assert.equal((await c.listPackages()).length,0);a.close();b.close();c.close();
});
test('new exam start finalizes a timed-out prior session atomically and does not overwrite earlier history',async()=>{
  const r=await repo(),{summary}=await r.importPackage(fixture());await r.startAttempt(summary.key,start,'first');const next=await r.startAttempt(summary.key,start+7200000,'second');assert.equal(next.attempt.ordinal,2);
  const history=await r.listAttempts();assert.equal(history.find(r=>r.attempt.id==='first').result.unanswered,200);assert.equal(history.length,2);r.close();
});
test('storage does not silently fall back when IndexedDB is unavailable and closed owners cannot save',async()=>{
  await assert.rejects(storage.openExamRepository(''),/账号/);
  await assert.rejects(storage.openExamRepository('alice'),/IndexedDB/);
  const r=await repo();r.close();await assert.rejects(r.listPackages(),/关闭/);
});

test('all 200 answers can be completed in order with 100 + 100 raw correct and no implied scaled score',()=>{
  const e=pack();let a=attempt(e);
  for(let n=1;n<=100;n++)a=model.answerQuestion(a,n,e.questions[n-1].answer,start+n*1000);
  for(let n=101;n<=200;n++)a=model.answerQuestion(a,n,e.questions[n-1].answer,start+model.LISTENING_MS+(n-100)*1000);
  a=model.submitAttempt(a,start+model.LISTENING_MS+110000);const result=model.gradeAttempt(e,a);
  assert.equal(result.correct,200);assert.equal(result.listeningCorrect,100);assert.equal(result.readingCorrect,100);assert.equal(result.unanswered,0);assert.ok(result.parts.every(p=>p.accuracy===1));
});
test('package count and input byte limits reject the new import without disturbing existing exams',async()=>{
  assert.throws(()=>model.parseLimitedJson('x'.repeat(1025),1024),/限额/);
  const r=await repo();for(let n=0;n<model.EXAM_LIMITS.packages;n++)await r.importPackage(fixture('set-'+n));
  await assert.rejects(r.importPackage(fixture('set-over-limit')),/限额/);assert.equal((await r.listPackages()).length,20);assert.equal((await r.importPackage(fixture('set-0'))).status,'unchanged');r.close();
});
test('a mid-backup quota failure rolls back every package and history write in that restore',async()=>{
  const original=await repo();await original.importPackage(fixture('first-new'));await original.importPackage(fixture('quota-failure'));const backup=await original.exportBackup(),r=await repo();await r.importPackage(fixture('existing'));
  const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(value,...rest){if(this.name==='catalog'&&value.id==='quota-failure'){const e=new Error('full');e.name='QuotaExceededError';throw e;}return add.call(this,value,...rest);};
  try{await assert.rejects(r.importBackup(backup,start),/空间不足/);}finally{IDBObjectStore.prototype.add=add;}
  assert.deepEqual(Array.from(await r.listPackages(),p=>p.id),['existing']);await assert.rejects(r.getPackage('first-new@1'),/没有/);assert.equal((await r.listAttempts()).length,0);original.close();r.close();
});
test('background, audio failure and recovery seek remain visible in results and backups without pausing the deadline',async()=>{
  const r=await repo(),{summary}=await r.importPackage(fixture());const first=await r.startAttempt(summary.key,start,'interrupted');
  await r.markInterrupted('interrupted','background',start+1000);await r.markInterrupted('interrupted','audio-failure',start+2000);await r.markInterrupted('interrupted','audio-seek',start+3000);
  const back=await r.resumeAttempt('interrupted',start+2500);assert.equal(back.attempt.clockRollback,true);assert.equal(back.attempt.readingDeadline,first.attempt.readingDeadline);
  const finished=await r.resumeAttempt('interrupted',start+7200000);assert.equal(finished.result.integrity,'interrupted');assert.equal(finished.result.interruptions.length,3);assert.equal(finished.result.clockRollback,true);
  const backup=await r.exportBackup(), restored=await repo();await restored.importBackup(backup,start+7200010);const result=(await restored.listAttempts())[0].result;assert.deepEqual(plain(result.interruptions),plain(finished.result.interruptions));assert.equal(result.clockRollback,true);
  const stable=await r.markInterrupted('interrupted','audio-interrupted',start+7200010);assert.deepEqual(plain(stable),plain(finished));r.close();restored.close();
});
test('repeated active backup recovery remains idempotent as time advances and crosses LC to RC',async()=>{
  const source=await repo(),{summary}=await source.importPackage(fixture());await source.startAttempt(summary.key,start,'first');await source.answer('first',1,1,start+100);const backup=await source.exportBackup(),r=await repo();
  assert.deepEqual(plain(await r.importBackup(backup,start+200)),{packagesAdded:1,attemptsAdded:1});
  assert.deepEqual(plain(await r.importBackup(backup,start+300)),{packagesAdded:0,attemptsAdded:0});
  assert.deepEqual(plain(await r.importBackup(backup,start+model.LISTENING_MS+100)),{packagesAdded:0,attemptsAdded:0});
  const after=(await r.listAttempts())[0].attempt;assert.equal(after.status,'reading');assert.equal(after.answers[1].choice,1);assert.equal(after.questionTimeMs[1],model.LISTENING_MS);assert.equal(after.questionTimeMs[101],100);
  await r.answer('first',101,2,start+model.LISTENING_MS+200);await assert.rejects(r.importBackup(backup,start+model.LISTENING_MS+300),/冲突/);assert.equal((await r.listAttempts())[0].attempt.answers[101].choice,2);source.close();r.close();
});
test('future-dated backup records reject atomically instead of locking the account in an endless active exam',async()=>{
  const r=await repo();await r.importPackage(fixture('existing-paper'));const before=plain(await r.exportBackup());
  const imported=model.parseExamPackage(fixture('new-future-paper')),fingerprint=await model.fingerprintExam(imported);
  const make=now=>model.createAttempt(imported,{id:'future-clock',ownerId:'alice',fingerprint,ordinal:1,now});
  const cases=[
    make(start+365*86400000),
    make(start+300001),
    model.advanceAttempt(make(start-3600000),start+300001),
    model.submitAttempt(make(start-3600000),start+300001),
    {...model.advanceAttempt(make(start-10000),start),answers:{1:{choice:1,savedAt:start+300001}}},
    {...model.advanceAttempt(make(start-10000),start),interruptions:[{reason:'background',at:start+300001}]},
    {...make(start),listeningDeadline:start+model.LISTENING_MS+1},
  ];
  for(const future of cases){
    const backup={kind:'lantern-exam-backup',schemaVersion:1,ownerId:'alice',packages:[model.parseExamPackage(fixture('new-normal-paper')),imported],attempts:[future]};
    await assert.rejects(r.importBackup(backup,start),/未来|时间|用时/);
    assert.deepEqual(plain(await r.exportBackup()),before,'No package or history from the rejected backup may be written');
  }
  r.close();
});
test('five-minute clock skew is bounded and valid future section deadlines are not treated as future observations',async()=>{
  const exam=pack(),fingerprint=await model.fingerprintExam(exam);
  for(const original of [
    model.createAttempt(exam,{id:'tolerated-start',ownerId:'alice',fingerprint,ordinal:1,now:start+300000}),
    model.advanceAttempt(model.createAttempt(exam,{id:'tolerated-observed',ownerId:'alice',fingerprint,ordinal:1,now:start-3600000}),start+300000),
  ]){
    const r=await repo(),backup={kind:'lantern-exam-backup',schemaVersion:1,ownerId:'alice',packages:[exam],attempts:[original]};
    await r.importBackup(backup,start);const restored=(await r.listAttempts())[0].attempt;
    assert.equal(restored.startedAt,original.startedAt);assert.equal(restored.lastObservedAt,original.lastObservedAt);
    assert.equal(restored.listeningDeadline,original.startedAt+model.LISTENING_MS);assert.equal(restored.readingDeadline,original.startedAt+model.LISTENING_MS+model.READING_MS);
    assert.equal(restored.clockRollback,true,'Tolerated skew remains visible; it is not silently certified as normal');r.close();
  }
});

// Declared LC duration, immutable clocks and database-version compatibility.
const duration = 2753000;
const declared = (ms = duration, id = 'declared-duration') => ({...fixture(id),listeningDurationMs:ms});
const parsed = ms => model.parseExamPackage(declared(ms));
const make = (exam, now = start, id = 'duration-attempt') => model.createAttempt(exam,{id,ownerId:'alice',fingerprint:'sha256:'+'a'.repeat(64),ordinal:1,now});
async function durationRepo(factory = new IDBFactory(), name = 'duration-tests', owner = 'alice') {return storage.openExamRepository(owner,{factory,name});}
function rawOpen(factory, name, version, upgrade) {
  return new Promise((resolve,reject)=>{const r=factory.open(name,version);r.onupgradeneeded=()=>upgrade?.(r.result,r.transaction);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
async function rawRows(db) {
  return new Promise((resolve,reject)=>{const tx=db.transaction(['packages','catalog','attempts'],'readonly'),rows={};
    for(const name of ['packages','catalog','attempts']) {const r=tx.objectStore(name).getAll();r.onsuccess=()=>{rows[name]=r.result;};}
    tx.oncomplete=()=>resolve(plain(rows));tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
async function seedLegacy(factory, name) {
  const db=await rawOpen(factory,name,1,db=>{for(const storeName of ['packages','catalog','attempts']) {
    const store=db.createObjectStore(storeName,{keyPath:storeName==='attempts'?['ownerId','id']:['ownerId','key']});store.createIndex('owner','ownerId',{unique:false});
  }});
  const exam=model.parseExamPackage(fixture()),fingerprint=await model.fingerprintExam(exam),key=model.examKey(exam),{assets,...definition}=exam;
  const attempt=model.answerQuestion(model.createAttempt(exam,{id:'legacy-active',ownerId:'alice',fingerprint,ordinal:1,now:start}),1,1,start+100);
  const catalog={ownerId:'alice',key,id:exam.id,version:exam.version,title:exam.title,source:exam.source,fingerprint,bytes:model.jsonBytes(exam),importedAt:start,definition};
  await new Promise((resolve,reject)=>{const tx=db.transaction(['packages','catalog','attempts'],'readwrite');
    tx.objectStore('packages').add({ownerId:'alice',key,exam});tx.objectStore('catalog').add(catalog);tx.objectStore('attempts').add({ownerId:'alice',id:attempt.id,attempt});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  return db;
}

test('legacy normalization remains byte-identical by its pre-change SHA and has no injected duration',async()=>{
  const exam=model.parseExamPackage(fixture()),json=JSON.stringify(exam);
  assert.equal(Object.hasOwn(exam,'listeningDurationMs'),false);
  assert.equal(crypto.createHash('sha256').update(json).digest('hex'),'501d84ae36785f03b2fe56d2ca3a89bcbd3357479c21e8d48e11dd0e6827cbbc');
  assert.equal(await model.fingerprintExam(exam),'sha256:501d84ae36785f03b2fe56d2ca3a89bcbd3357479c21e8d48e11dd0e6827cbbc');
  const a=make(exam);assert.equal(a.listeningDeadline-start,2700000);assert.equal(a.readingDeadline-a.listeningDeadline,4500000);
  assert.deepEqual(plain(model.validateAttempt(a,exam,'alice',a.fingerprint)),plain(a));
});
test('declared whole-second LC durations preserve both engineering bounds and canonical object order',async()=>{
  for(const ms of [2400000,duration,3000000]) {const exam=parsed(ms);assert.equal(exam.listeningDurationMs,ms);assert.equal(model.getListeningDurationMs(exam),ms);}
  const input=declared(),reordered={listeningDurationMs:duration,...fixture('declared-duration')};
  assert.equal(JSON.stringify(model.parseExamPackage(input)),JSON.stringify(model.parseExamPackage(reordered)));
  assert.notEqual(await model.fingerprintExam(parsed(duration)),await model.fingerprintExam(parsed(duration+1000)));
});
test('duration declarations reject wrong types, fractions, non-second units and out-of-range values',()=>{
  for(const value of [null,'2753000',true,NaN,Infinity,-1,0,2399000,3001000,2752521,2753000.5]) {
    assert.throws(()=>model.parseExamPackage(declared(value)),/听力.*时长|时长.*听力|整秒/);
  }
  assert.throws(()=>model.createAttempt({...model.parseExamPackage(fixture()),listeningDurationMs:3001000},{id:'invalid-direct',ownerId:'alice',fingerprint:'sha256:'+'a'.repeat(64),ordinal:1,now:start}),/时长/);
});
test('declared LC locks at its exact boundary and retains all 75 reading minutes',()=>{
  for(const ms of [2400000,duration,3000000]) {
    const exam=parsed(ms),a=make(exam);assert.equal(a.listeningDeadline,start+ms);assert.equal(a.readingDeadline,start+ms+4500000);
    assert.equal(model.advanceAttempt(a,start+ms-1).status,'listening');
    assert.throws(()=>model.answerQuestion(a,101,0,start+ms-1),/阶段/);
    const last=model.answerQuestion(a,100,0,start+ms-1);assert.equal(last.answers[100].savedAt,start+ms-1);
    const rc=model.advanceAttempt(last,start+ms);assert.equal(rc.status,'reading');assert.equal(rc.activeQuestion,101);
    assert.throws(()=>model.answerQuestion(rc,100,1,start+ms),/阶段/);
    assert.equal(model.answerQuestion(rc,101,0,start+ms).answers[101].savedAt,start+ms);
    assert.equal(model.advanceAttempt(rc,rc.readingDeadline-1).status,'reading');
    const end=model.advanceAttempt(rc,rc.readingDeadline);assert.equal(end.status,'submitted');assert.equal(end.submittedAt,rc.readingDeadline);
    assert.deepEqual(plain(model.validateAttempt(end,exam,'alice',end.fingerprint)),plain(end));
    assert.equal(end.questionTimeMs[101],4500000);
  }
  assert.equal(model.advanceAttempt(make(parsed()),start+2700000).status,'listening');
});
test('declared attempts reject forged clocks, cross-stage saved times and redistributed LC accounting',()=>{
  const exam=parsed(),a=make(exam),rc=model.advanceAttempt(a,start+duration+100);
  const edits=[v=>v.listeningDeadline++,v=>v.readingDeadline++,v=>{v.listeningDeadline=start+2700000;v.readingDeadline=start+7200000;},v=>{v.questionTimeMs[1]--;v.questionTimeMs[101]++;},v=>{v.answers[100]={choice:0,savedAt:start+duration};},v=>{v.answers[101]={choice:0,savedAt:start+duration-1};}];
  for(const edit of edits){const bad=plain(rc);edit(bad);assert.throws(()=>model.validateAttempt(bad,exam,'alice',a.fingerprint));}
  const back=model.advanceAttempt(rc,start+duration-500);assert.equal(back.clockRollback,true);assert.equal(back.listeningDeadline,a.listeningDeadline);assert.equal(back.readingDeadline,a.readingDeadline);
  assert.deepEqual(plain(model.validateAttempt(back,exam,'alice',a.fingerprint)),plain(back));
});
test('Date upper bound accounts for actual declared LC length',()=>{
  for(const ms of [2400000,3000000]) {const exam=parsed(ms),latest=8640000000000000-ms-4500000,a=make(exam,latest);
    assert.equal(a.readingDeadline,8640000000000000);assert.throws(()=>make(exam,latest+1),/开始时间/);
    assert.deepEqual(plain(model.validateAttempt(a,exam,'alice',a.fingerprint)),plain(a));
  }
});
test('catalog summaries expose only declared durations without rewriting legacy package shape',async()=>{
  const r=await durationRepo();await r.importPackage(fixture(),start);const {summary}=await r.importPackage(declared(),start+1);
  assert.equal(summary.listeningDurationMs,duration);const listed=await r.listPackages();
  assert.equal(listed.find(x=>x.id==='declared-duration').listeningDurationMs,duration);assert.equal(Object.hasOwn(listed.find(x=>x.id==='structural-test-only'),'listeningDurationMs'),false);
  assert.equal((await r.getPackage(summary.key)).listeningDurationMs,duration);r.close();
});
test('changing duration requires a new package version and retake sequence spans versions',async()=>{
  const r=await durationRepo(),{summary}=await r.importPackage(declared(),start);await r.startAttempt(summary.key,start,'one');
  await assert.rejects(r.importPackage(declared(duration+1000)),/冲突/);assert.equal((await r.getPackage(summary.key)).listeningDurationMs,duration);
  const v2={...declared(duration+1000),version:2},second=await r.importPackage(v2,start+1);
  const next=await r.startAttempt(second.summary.key,start+duration+4500000,'two');assert.equal(next.attempt.ordinal,2);assert.equal(next.attempt.listeningDeadline-next.attempt.startedAt,duration+1000);
  const prior=(await r.listAttempts()).find(x=>x.attempt.id==='one').attempt;assert.equal(prior.listeningDeadline,start+duration);assert.equal(prior.submittedAt,start+duration+4500000);r.close();
});
test('cold reopen retains LC answers after 45 minutes and persists exact custom expiry',async()=>{
  const factory=new IDBFactory();let r=await durationRepo(factory),{summary}=await r.importPackage(declared(),start);await r.startAttempt(summary.key,start,'resume');await r.answer('resume',100,2,start+2700000);r.close();
  r=await durationRepo(factory);let row=await r.resumeAttempt('resume',start+duration-1);assert.equal(row.attempt.status,'listening');assert.equal(row.attempt.answers[100].choice,2);
  row=await r.resumeAttempt('resume',start+duration);assert.equal(row.attempt.status,'reading');assert.equal(row.attempt.readingDeadline,start+duration+4500000);
  const late=await r.resumeAttempt('resume',start+duration+4500000+1000);assert.equal(late.attempt.submittedAt,start+duration+4500000);assert.equal(late.result.elapsedMs,duration+4500000);assert.equal(late.result.parts.slice(0,4).reduce((n,p)=>n+p.timeMs,0),duration);r.close();
});
test('mixed old and declared backups are idempotent while preserving history and later answers',async()=>{
  const source=await durationRepo(),legacy=await source.importPackage(fixture(),start);await source.startAttempt(legacy.summary.key,start,'old');await source.answer('old',1,1,start+100);await source.resumeAttempt('old',start+7200000);
  const old=plain((await source.listAttempts())[0]),nextStart=start+7200000,added=await source.importPackage(declared(),nextStart);await source.startAttempt(added.summary.key,nextStart,'new');await source.answer('new',2,1,nextStart+100);
  const backup=await source.exportBackup(),r=await durationRepo(),now=nextStart+duration+100;
  assert.deepEqual(plain(await r.importBackup(backup,now)),{packagesAdded:2,attemptsAdded:2});assert.deepEqual(plain(await r.importBackup(backup,now+100)),{packagesAdded:0,attemptsAdded:0});
  assert.deepEqual(plain((await r.listAttempts()).find(x=>x.attempt.id==='old')),old);
  const current=(await r.listAttempts()).find(x=>x.attempt.id==='new').attempt;assert.equal(current.listeningDeadline,nextStart+duration);assert.equal(current.status,'reading');
  await r.answer('new',101,0,now+200);await assert.rejects(r.importBackup(backup,now+300),/冲突/);assert.equal((await r.listAttempts()).find(x=>x.attempt.id==='new').attempt.answers[101].choice,0);source.close();r.close();
});
test('tampered duration backups fail atomically before any new package or history is written',async()=>{
  const source=await durationRepo(),{summary}=await source.importPackage(declared(),start);await source.startAttempt(summary.key,start,'declared');await source.answer('declared',1,1,start+100);
  const original=plain(await source.exportBackup()),r=await durationRepo();await r.importPackage(fixture('existing'),start);const before=plain(await r.exportBackup());
  for(const edit of [b=>b.attempts[0].listeningDeadline++,b=>b.attempts[0].readingDeadline++,b=>{delete b.packages[0].listeningDurationMs;},b=>b.packages[0].listeningDurationMs+=1000,b=>b.attempts[0].answers[100]={choice:0,savedAt:start+duration}]) {
    const bad=plain(original);edit(bad);bad.packages.unshift(model.parseExamPackage(fixture('must-not-appear')));
    await assert.rejects(r.importBackup(bad,start+200));assert.deepEqual(plain(await r.exportBackup()),before);
  }
  source.close();r.close();
});
test('v1 to v3 upgrade preserves all raw rows without add, put, delete or clear',async()=>{
  const factory=new IDBFactory(),name='legacy-migration',old=await seedLegacy(factory,name),before=await rawRows(old);old.close();
  const originals={};let r;
  for(const method of ['add','put','delete','clear']) {originals[method]=IDBObjectStore.prototype[method];IDBObjectStore.prototype[method]=function(){throw new Error('Upgrade must not rewrite any row');};}
  try{r=await durationRepo(factory,name);}finally{for(const [method,fn] of Object.entries(originals))IDBObjectStore.prototype[method]=fn;}
  const inspect=await rawOpen(factory,name,3);assert.equal(inspect.version,3);assert.deepEqual(await rawRows(inspect),before);inspect.close();
  const restored=(await r.listAttempts())[0].attempt;assert.equal(restored.listeningDeadline-start,2700000);assert.equal(restored.answers[1].choice,1);r.close();
});
test('upgrading closes a cooperative v1 tab and old code cannot reopen the v3 database',async()=>{
  const factory=new IDBFactory(),name='legacy-tab',old=await seedLegacy(factory,name);let changed=false;old.onversionchange=()=>{changed=true;old.close();};
  const r=await durationRepo(factory,name);assert.equal(changed,true);
  await assert.rejects(rawOpen(factory,name,1),error=>error.name==='VersionError');assert.equal((await r.listAttempts()).length,1);r.close();
});
test('a newer database is rejected without changing its version or rows',async()=>{
  const factory=new IDBFactory(),name='future-version',db=await rawOpen(factory,name,4,db=>db.createObjectStore('sentinel'));
  db.close();await assert.rejects(durationRepo(factory,name),error=>error.name==='VersionError');const after=await rawOpen(factory,name,4);assert.deepEqual(Array.from(after.objectStoreNames),['sentinel']);after.close();
});
