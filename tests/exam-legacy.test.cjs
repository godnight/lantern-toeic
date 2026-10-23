const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=process.env.LANTERN_EXAM_ROOT||path.resolve(__dirname,'..');
const ts=require(process.env.LANTERN_TYPESCRIPT||path.join(root,'node_modules/typescript'));
const {IDBFactory}=require('fake-indexeddb');
const modern=require('./fixtures/synthetic-exam.cjs');
const legacy=require('./fixtures/synthetic-legacy-exam.cjs');
const packer=require('../scripts/pack-exam-pages.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
function load(file,imports={}) {
  const exports={},code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require(name){if(!Object.hasOwn(imports,name))return require('./helpers/actual-source-loader.cjs').createSourceLoader({root,imports,globals:{}}).resolve(name,file);return imports[name];},Date,Map,Set,Error,JSON,Promise,structuredClone,TextEncoder,Uint8Array,Uint32Array,ArrayBuffer,Blob,File,URL,Request,Response,Headers,ReadableStream,AbortController,TextDecoder,atob,btoa,crypto:crypto.webcrypto});
  return exports;
}
const model=load('lib/exam-model.ts'), storage=load('lib/exam-storage.ts',{'./exam-model':model});
const start=Date.parse('2026-10-11T00:00:00.000Z'),fingerprint='sha256:'+'a'.repeat(64);
const parsed=()=>model.parseExamPackage(legacy());
const attempt=(e=parsed(),id='legacy-first')=>model.createAttempt(e,{id,ownerId:'alice',fingerprint,ordinal:1,now:start});
async function repo(factory=new IDBFactory(),name='legacy-profile') {return storage.openExamRepository('alice',{factory,name});}
function recipe(e=legacy()) {
  return {kind:'lantern-exam-page-recipe',schemaVersion:1,
    exam:{id:e.id,version:e.version,title:e.title,source:e.source,...(e.format===undefined?{}:{format:e.format})},
    documents:[{id:'book',file:'book.pdf'}],audioFile:'audio.wav',answers:e.questions.map(q=>'ABCD'[q.answer]),
    groups:e.groups.map(g=>({id:g.id,part:g.part,questionNumbers:g.questionNumbers,passageCount:g.passages.length,
      pages:g.part===2?[]:[{documentId:'book',page:g.part<=4?1:2}]})),
    pageReview:{reviewed:true,excludedPages:[]},audioReviewed:true};
}

test('legacy profile covers exact Part boundaries while omission remains current format',()=>{
  assert.deepEqual(Array.from(model.getExamProfile('legacy-2006').partCounts),[10,30,30,30,40,12,48]);
  const boundaries=[[1,10],[11,40],[41,70],[71,100],[101,140],[141,152],[153,200]];
  boundaries.forEach(([a,b],index)=>{assert.equal(model.questionPart(a,'legacy-2006'),index+1);assert.equal(model.questionPart(b,'legacy-2006'),index+1);});
  assert.equal(model.questionPart(7),2);assert.equal(model.questionPart(131),6);assert.equal(model.questionPart(147),7);
  assert.throws(()=>model.questionPart(0,'legacy-2006'));assert.throws(()=>model.questionPart(201,'legacy-2006'));
});
test('legacy format is explicit; unknown, null and cross-profile structures are rejected',()=>{
  const omitted=legacy();delete omitted.format;assert.throws(()=>model.parseExamPackage(omitted));
  assert.throws(()=>model.parseExamPackage({...modern(),format:'legacy-2006'}));
  for(const value of [null,'','modern','legacy-2005',0,{},[]])assert.throws(()=>model.parseExamPackage({...legacy(),format:value}),/题型/);
});
test('legacy full 200 structure has 10 photos, 30 Part 2 and four three-question Part 6 groups',()=>{
  const e=parsed();assert.equal(e.questions.length,200);
  assert.equal(e.groups.filter(g=>g.part===1).length,10);assert.equal(e.groups.filter(g=>g.part===2).length,30);
  assert.deepEqual(e.groups.filter(g=>g.part===6).map(g=>Array.from(g.questionNumbers)),[[141,142,143],[144,145,146],[147,148,149],[150,151,152]]);
});
test('Part 2 D fails at both legacy boundaries while seventh photo accepts D',()=>{
  for(const n of [11,40]){const e=legacy();e.questions[n-1].answer=3;assert.throws(()=>model.parseExamPackage(e),/范围/);}
  const e=legacy();e.questions[6].answer=3;assert.equal(model.parseExamPackage(e).questions[6].answer,3);
  e.questions[10].choices.push('D');assert.throws(()=>model.parseExamPackage(e),/数量/);
});
test('legacy P7 allows two to five single questions and exactly four two-passage double groups',()=>{
  const e=model.parseExamPackage(legacy('legacy-mixed',[2,5,5,5,5,3,3]));
  assert.equal(e.groups.filter(g=>g.part===7&&g.questionNumbers[0]<=180).flatMap(g=>g.questionNumbers).length,28);
  assert.equal(e.groups.filter(g=>g.part===7&&g.questionNumbers[0]>=181).length,4);
  for(const values of [[],['one'],['one','two','three']]){const bad=legacy();bad.groups.find(g=>g.part===7&&g.questionNumbers[0]===181).passages=values;assert.throws(()=>model.parseExamPackage(bad));}
  const single=legacy();single.groups.find(g=>g.part===7).passages=['one','two'];assert.throws(()=>model.parseExamPackage(single));
});
test('legacy grouping rejects modern-sized P6 and crossing single/double boundary',()=>{
  const e=legacy(),groups=e.groups.filter(g=>g.part===6),a=groups[0],b=groups[1];
  a.questionNumbers.push(b.questionNumbers.shift());e.questions[143].groupId=a.id;
  assert.throws(()=>model.parseExamPackage(e),/题数/);
  const bad=legacy(),last=bad.groups.find(g=>g.part===7&&g.questionNumbers.includes(180)),next=bad.groups.find(g=>g.part===7&&g.questionNumbers[0]===181);
  last.questionNumbers.push(next.questionNumbers.shift());bad.questions[180].groupId=last.id;assert.throws(()=>model.parseExamPackage(bad),/跨界/);
});
test('live legacy attempt carries format and accepts photo 7 D but rejects Part 2 D',()=>{
  const e=parsed(),a=attempt(e);assert.equal(a.format,'legacy-2006');
  const b=model.answerQuestion(a,7,3,start+100);assert.equal(b.answers[7].choice,3);
  assert.throws(()=>model.answerQuestion(b,11,3,start+200),/范围/);assert.throws(()=>model.answerQuestion(b,40,3,start+200),/范围/);
  assert.deepEqual(plain(model.validateAttempt(b,e,'alice',fingerprint)),plain(b));
  const m=model.parseExamPackage(modern());assert.throws(()=>model.answerQuestion(attempt(m),7,3,start+100),/范围/);
});
test('format cannot be stripped, forged or mismatched in restored attempts or grading',()=>{
  const e=parsed(),a=attempt(e),without=plain(a);delete without.format;
  for(const bad of [without,{...a,format:'unknown'},{...a,format:null}])assert.throws(()=>model.validateAttempt(bad,e,'alice',fingerprint));
  const m=model.parseExamPackage(modern(e.id)),ma=attempt(m);
  assert.throws(()=>model.validateAttempt({...ma,format:'legacy-2006'},m,'alice',fingerprint),/题型/);
  assert.throws(()=>model.gradeAttempt(m,model.advanceAttempt(a,a.readingDeadline)),/题型/);
  assert.throws(()=>model.presentExam(m,a),/题型/);
});
test('200-item grading uses legacy Part denominators and retains listening-reading timing',()=>{
  const e=parsed();let a=attempt(e);
  for(let n=1;n<=100;n++)a=model.answerQuestion(a,n,e.questions[n-1].answer,start+n);
  assert.throws(()=>model.answerQuestion(a,101,0,start+200),/阶段/);
  a=model.advanceAttempt(a,a.listeningDeadline);
  for(let n=101;n<=200;n++)if(n!==140)a=model.answerQuestion(a,n,e.questions[n-1].answer,a.listeningDeadline+n);
  a=model.submitAttempt(a,a.listeningDeadline+1000);const grade=model.gradeAttempt(e,a);
  assert.deepEqual(Array.from(grade.parts,p=>p.total),[10,30,30,30,40,12,48]);
  assert.equal(grade.correct,199);assert.equal(grade.unanswered,1);assert.equal(grade.listeningCorrect,100);assert.equal(grade.readingCorrect,99);
  assert.equal(grade.parts[4].accuracy,39/40);assert.equal(grade.parts[5].correct,12);assert.equal(grade.parts[6].correct,48);
  assert.equal(grade.firstAttempt,true);assert.deepEqual(plain(model.validateAttempt(a,e,'alice',fingerprint)),plain(a));
});
test('current package canonical hash and missing format field are unchanged',async()=>{
  const e=model.parseExamPackage(modern());
  assert.equal('format'in e,false);assert.equal(await model.fingerprintExam(e),'sha256:501d84ae36785f03b2fe56d2ca3a89bcbd3357479c21e8d48e11dd0e6827cbbc');
  const a=attempt(e);assert.equal('format'in a,false);assert.equal('format'in model.validateAttempt(a,e,'alice',fingerprint),false);
});
test('legacy import, first attempt, retake and mixed-profile backup restore retain history',async()=>{
  const r=await repo(),first=await r.importPackage(legacy()),modernImport=await r.importPackage(modern('modern-sibling'));
  assert.equal(first.summary.format,'legacy-2006');assert.equal('format'in modernImport.summary,false);
  await r.startAttempt(first.summary.key,start,'first');await r.answer('first',7,3,start+100);await r.submit('first',start+model.LISTENING_MS+1);
  const second=await r.startAttempt(first.summary.key,start+model.LISTENING_MS+2,'second');assert.equal(second.attempt.ordinal,2);
  await r.answer('second',10,2,start+model.LISTENING_MS+3);
  const backup=await r.exportBackup(),restored=await repo();
  const outcome=await restored.importBackup(backup,start+model.LISTENING_MS+3);assert.deepEqual(plain(outcome),{packagesAdded:2,attemptsAdded:2});
  assert.deepEqual(plain(await restored.importBackup(backup,start+model.LISTENING_MS+3)),{packagesAdded:0,attemptsAdded:0});
  const history=await restored.listAttempts();assert.equal(history[0].attempt.format,'legacy-2006');assert.equal(history[1].attempt.answers[7].choice,3);
  assert.equal(history[1].result.parts[0].total,10);assert.equal(history[1].result.firstAttempt,true);
  r.close();restored.close();
});
test('a forged legacy backup profile is rejected atomically and old modern backups restore unchanged',async()=>{
  const source=await repo(),{summary}=await source.importPackage(legacy());await source.startAttempt(summary.key,start,'first');
  const bad=plain(await source.exportBackup());delete bad.attempts[0].format;const r=await repo();
  await assert.rejects(r.importBackup(bad,start),/题型/);assert.equal((await r.listPackages()).length,0);
  const old=model.parseExamPackage(modern()),oldFingerprint=await model.fingerprintExam(old),oldAttempt=model.createAttempt(old,{id:'old',ownerId:'alice',fingerprint:oldFingerprint,ordinal:1,now:start});
  const backup={kind:'lantern-exam-backup',schemaVersion:1,ownerId:'alice',packages:[old],attempts:[oldAttempt]};
  await r.importBackup(backup,start);assert.equal(JSON.stringify(await r.exportBackup()),JSON.stringify(backup));source.close();r.close();
});
test('packer accepts and propagates the explicit legacy format with correct Part 2 boundaries',()=>{
  const r=recipe();assert.equal(packer.validateRecipe(r,model),r);
  const images=new Map([['book:1',{id:'first',mime:'image/jpeg',base64:'/9j/2Q=='}],['book:2',{id:'second',mime:'image/jpeg',base64:'/9j/2Q=='}]]);
  const {mime,base64}=legacy().assets[1];
  const packed=packer.buildPackage(r,images,{mime,base64},model);assert.equal(packed.format,'legacy-2006');assert.equal(packed.questions[6].answer,3);
  const bad=recipe();bad.answers[10]='D';assert.throws(()=>packer.validateRecipe(bad,model),/Part 2/);
  const current=recipe(modern());assert.equal(packer.validateRecipe(current,model),current);assert.equal('format'in current.exam,false);
});
test('v4 database prevents older v2 clients from interpreting legacy format using current counters',async()=>{
  const factory=new IDBFactory(),r=await repo(factory,'format-version');await r.importPackage(legacy());r.close();
  await assert.rejects(new Promise((resolve,reject)=>{const req=factory.open('format-version',2);req.onsuccess=()=>{req.result.close();resolve();};req.onerror=()=>reject(req.error);}),e=>e.name==='VersionError');
});
test('v2 current-format package and active attempt survive v4 upgrade byte-for-byte',async()=>{
  const factory=new IDBFactory(),name='existing-v2',e=model.parseExamPackage(modern()),hash=await model.fingerprintExam(e);
  const a=model.answerQuestion(model.createAttempt(e,{id:'existing-active',ownerId:'alice',fingerprint:hash,ordinal:1,now:start}),7,2,start+100);
  const key=model.examKey(e),{assets,...definition}=e;
  const rows={packages:{ownerId:'alice',key,exam:e},catalog:{ownerId:'alice',key,id:e.id,version:e.version,title:e.title,source:e.source,fingerprint:hash,bytes:model.jsonBytes(e),importedAt:start,definition},attempts:{ownerId:'alice',id:a.id,attempt:a}};
  const db=await new Promise((resolve,reject)=>{const request=factory.open(name,2);request.onupgradeneeded=()=>{
    for(const table of ['packages','catalog','attempts']){const store=request.result.createObjectStore(table,{keyPath:table==='attempts'?['ownerId','id']:['ownerId','key']});store.createIndex('owner','ownerId');}
  };request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['packages','catalog','attempts'],'readwrite');for(const [table,row]of Object.entries(rows))tx.objectStore(table).add(row);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  const r=await repo(factory,name);r.close();
  const upgraded=await new Promise((resolve,reject)=>{const request=factory.open(name,4);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  for(const [table,row]of Object.entries(rows)) {
    const actual=await new Promise((resolve,reject)=>{const request=upgraded.transaction(table).objectStore(table).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    assert.equal(JSON.stringify(actual),JSON.stringify([row]));
  }
  upgraded.close();
});
