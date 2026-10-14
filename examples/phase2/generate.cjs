/* SYNTHETIC ONLY. Executes real repository/services against an in-memory IDBFactory.
 * Writes only this examples/phase2 directory. Never opens a browser/device/user DB. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),OUTPUT=__dirname;
const ts=require(path.join(ROOT,'node_modules/typescript'));
const {IDBFactory}=require(path.join(ROOT,'node_modules/fake-indexeddb'));
const BASE='2026-10-14T08:00:00.000Z',TIMEZONE='Asia/Shanghai';
const SCOPES=[
 {name:'harmony-device',code:1,scope:{kind:'harmony-device',partition:'existing-device'}},
 {name:'web-local',code:2,scope:{kind:'web-local',partition:'existing-device'}},
 {name:'web-owner',code:3,scope:{kind:'web-owner',ownerId:'synthetic-phase2-qa'}},
];
const outputs=new Map(),inputs=new Map();
const plain=value=>JSON.parse(JSON.stringify(value));
const bytes=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n','utf8');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const uuid=(code,n)=>`00000000-0000-4000-8000-${code.toString(16).padStart(4,'0')}${n.toString(16).padStart(8,'0')}`;
function source(file){const absolute=path.join(ROOT,file),data=fs.readFileSync(absolute);if(inputs.has(file))assert.equal(hash(data),hash(inputs.get(file)),`Source changed during generation: ${file}`);else inputs.set(file,data);return data;}
function output(file,value){assert.ok(!path.isAbsolute(file)&&!file.split(/[\\/]/).includes('..'));outputs.set(file,bytes(value));}
function runtime(scopeInfo,initialStudy,initialVocabulary){
 const clock={value:Date.parse(BASE)},cache=new Map();let sequence=1000;
 class FixtureDate extends Date{constructor(...args){super(...(args.length?args:[clock.value]));}static now(){return clock.value;}}
 const randomUUID=()=>uuid(scopeInfo.code,sequence++);
 function load(file){
  file=file.split(path.sep).join('/');if(cache.has(file))return cache.get(file);
  if(file.endsWith('.json')){const value=JSON.parse(source(file));cache.set(file,value);return value;}
  const exports={};cache.set(file,exports);
  const compiled=ts.transpileModule(source(file).toString('utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(compiled,{exports,require(name){
   if(name==='zod')return require(path.join(ROOT,'node_modules/zod'));
   assert.ok(name.startsWith('.'),`Unexpected external import: ${name}`);
   const target=path.relative(ROOT,path.resolve(ROOT,path.dirname(file),name));return load(target+(path.extname(target)?'':'.ts'));
  },Date:FixtureDate,Intl,Map,Set,Error,JSON,Number,Object,Array,Math,RegExp,Promise,Uint8Array,Uint32Array,DataView,TextEncoder,TextDecoder,structuredClone,setTimeout,clearTimeout,crypto:{randomUUID,getRandomValues(array){for(let i=0;i<array.length;i++)array[i]=(sequence+i)&255;sequence++;return array;}}},{filename:file});
  return exports;
 }
 const vocabulary=new Map((initialVocabulary?.events||[]).map(event=>[event.id,plain(event)]));
 const attempts=new Map((initialStudy?.attempts||[]).map(event=>[event.id,plain(event)]));
 const checkins=new Map((initialStudy?.checkins||[]).map(event=>[event.id,plain(event)]));
 const state={allowVocabularyWrite:true,vocabularyWrites:0,attemptWrites:0,checkinWrites:0};
 const canonical=load('lib/domain-command.ts');
 const put=(map,value)=>{const old=map.get(value.id);if(old&&canonical.canonicalJson(old)!==canonical.canonicalJson(value))return false;map.set(value.id,plain(value));return true;};
 const vocabularyLegacy={readEvents:()=>[...vocabulary.values()].map(plain),readEvent:id=>vocabulary.has(id)?plain(vocabulary.get(id)):undefined,writeReview(event){state.vocabularyWrites++;return state.allowVocabularyWrite&&put(vocabulary,event);}};
 const practiceLegacy={readAttempt:id=>attempts.has(id)?plain(attempts.get(id)):undefined,readCheckin:id=>checkins.has(id)?plain(checkins.get(id)):undefined,addAttempt(event){state.attemptWrites++;return put(attempts,event);},addCheckin(event){state.checkinWrites++;return put(checkins,event);}};
 const factory=new IDBFactory(),repositoryModule=load('lib/learning-domain-repository.ts'),catalog=load('lib/workflow-catalog.ts'),questions=load('content/questions.json');
 let repository,vocab,practice;
 async function start(){
  repository=await repositoryModule.openLearningDomainRepository(scopeInfo.scope,{factory});
  vocab=await load('lib/vocabulary-workflow.ts').createVocabularyWorkflow({scope:scopeInfo.scope,repository,legacy:vocabularyLegacy,now:()=>new FixtureDate()});
  practice=await load('lib/practice-workflow.ts').createPracticeWorkflow({scope:scopeInfo.scope,repository,questions,legacy:practiceLegacy,timezone:TIMEZONE,now:()=>new FixtureDate(),id:randomUUID,seenQuestionIds:()=>[...attempts.values()].map(event=>event.qid)});
  return api;
 }
 const api={load,clock,randomUUID,state,catalog,questions,vocabulary,attempts,checkins,start,get repository(){return repository;},get vocab(){return vocab;},get practice(){return practice;},close(){repository?.close();}};
 return api;
}
function baseline(info,api){
 const model=api.load('lib/study-model.ts'),backup=api.load('lib/study-backup.ts'),q=api.questions[0];
 const study=plain(model.EMPTY_DATA);study.profile={...study.profile,name:'SYNTHETIC Phase2 QA',timezone:TIMEZONE,onboarded:true};
 study.attempts=[{id:uuid(info.code,1),qid:q.id,choice:q.correctIndex,correct:true,createdAt:'2026-10-12T08:00:00.000Z',seconds:12,mode:'first'},{id:uuid(info.code,2),qid:q.id,choice:(q.correctIndex+1)%q.options.length,correct:false,createdAt:'2026-10-13T08:00:00.000Z',seconds:15,mode:'review'}];
 study.checkins=[{id:uuid(info.code,3),date:'2026-10-13',minutes:9,load:'刚好',note:'[SYNTHETIC] Existing legacy checkin; do not infer a session.',createdAt:'2026-10-13T08:01:00.000Z'}];
 const [first,second]=api.catalog.SCENE_WORDS;
 const vocabulary={kind:'lantern-vocabulary',schemaVersion:1,events:[
  {id:uuid(info.code,10),wordId:first.id,createdAt:'2026-10-10T08:00:00.000Z',type:'review',grade:'remembered'},
  {id:uuid(info.code,11),wordId:second.id,createdAt:'2026-10-11T08:00:00.000Z',type:'review',grade:'again'},
  {id:uuid(info.code,12),wordId:second.id,createdAt:'2026-10-11T08:01:00.000Z',type:'mark',starred:true,revision:1},
  {id:uuid(info.code,13),wordId:second.id,createdAt:'2026-10-11T08:02:00.000Z',type:'mark',starred:false,revision:2},
  {id:uuid(info.code,14),wordId:'synthetic-missing-word',createdAt:'2026-10-10T08:00:00.000Z',type:'review',grade:'remembered'},
 ]};
 assert.ok(!api.catalog.WORKFLOW_WORDS.some(word=>word.id==='synthetic-missing-word'));
 const parsed=backup.parseStudyBackup(backup.createStudyBackup(study,BASE));assert.deepEqual(plain(parsed),study);
 assert.equal(api.load('lib/vocabulary-model.ts').parseVocabularyBackup(vocabulary).events.length,5);
 return {study,vocabulary};
}
const success=result=>assert.ok(['applied','replayed','started','updated'].includes(result.status),JSON.stringify(result));
async function target(api){const session=(await api.vocab.readProjection(TIMEZONE)).activeSession;assert.ok(session?.currentStep);return {sessionId:session.id,stepId:session.currentStep.id};}
function keyInfo(info,api){const owner=info.scope.kind==='web-owner'?info.scope.ownerId:null;return {study:'lantern-v1-'+(owner||'device'),vocabulary:api.load('lib/vocabulary-model.ts').vocabularyKey(owner)+'synthetic-phase2-seed',workflowDatabase:'lantern-workflow-v1',workflowVersion:1,scopeKey:api.load('lib/learning-domain-repository.ts').workflowScopeKey(info.scope)};}
async function validateRestore(info,workflow,study,vocabulary,sessionId,prepared){
 const empty=plain(study);empty.attempts=[];empty.checkins=[];
 const missing=runtime(info,empty,{events:[]});await missing.start();
 const restored=await missing.vocab.restoreWorkflow(plain(workflow),TIMEZONE);success(restored);
 const vp=await missing.vocab.readProjection(TIMEZONE),pp=await missing.practice.readProjection();
 assert.ok(vp.activeSession?.blockedReason,'Missing vocabulary references must not reveal applied history');
 const missingPractice=pp.sessions.find(row=>row.id===sessionId);assert.equal(missingPractice?.integrityError,'reference-unverified');
 assert.equal(missing.vocabulary.size,0);assert.equal(missing.attempts.size,0);assert.equal(missing.checkins.size,0);
 assert.equal(missing.state.vocabularyWrites+missing.state.attemptWrites+missing.state.checkinWrites,0);
 const missingEvidence={restoreStatus:restored.status,vocabularyBlockedReason:vp.activeSession.blockedReason,practiceIntegrityError:missingPractice.integrityError,legacyWrites:0};missing.close();
 const proper=runtime(info,study,vocabulary);await proper.start();const first=await proper.vocab.restoreWorkflow(plain(workflow),TIMEZONE);success(first);
 const second=await proper.vocab.restoreWorkflow(plain(workflow),TIMEZONE);assert.equal(second.status,'replayed');assert.equal(second.added,0);
 const original=await proper.vocab.readProjection(TIMEZONE),practiceProjection=await proper.practice.readProjection();
 assert.equal(original.daily.newDone,2);assert.ok(!original.activeSession?.blockedReason);assert.equal((await proper.vocab.readCommand(prepared.id)).value.status,'prepared');assert.ok(!proper.vocabulary.has(prepared.legacyPayload.id));
 const restoredPractice=practiceProjection.sessions.find(row=>row.id===sessionId);assert.equal(restoredPractice.integrityError,null);assert.equal(restoredPractice.status,'completed');assert.equal(restoredPractice.settlement.status,'draft');
 assert.equal(proper.state.vocabularyWrites+proper.state.attemptWrites+proper.state.checkinWrites,0,'Import/projection must not execute pending actions');
 const beforeMinutes=[...proper.checkins.values()].reduce((total,row)=>total+row.minutes,0);
 success(await proper.practice.settle(sessionId));assert.equal((await proper.practice.settle(sessionId)).status,'replayed');assert.equal(proper.state.checkinWrites,1);assert.equal([...proper.checkins.values()].reduce((total,row)=>total+row.minutes,0),beforeMinutes+7);
 const frozen=plain(prepared.legacyPayload);proper.clock.value+=3600000;success(await proper.vocab.submitRating(prepared.rawRating,TIMEZONE,await target(proper)));assert.deepEqual(proper.vocabulary.get(frozen.id),frozen);
 const properEvidence={firstRestore:first.status,secondRestore:second.status,secondRestoreAdded:second.added,importLegacyWrites:0,originalDailyNewDone:original.daily.newDone,preparedState:'prepared',explicitPendingRetry:'applied-with-original-id-time-payload',settlementDraftWasNotCounted:true,explicitSettlementWrites:proper.state.checkinWrites,settlementRepeat:'replayed',minutesBefore:beforeMinutes,minutesAfter:beforeMinutes+7};proper.close();
 return {missingLegacy:missingEvidence,matchingLegacy:properEvidence};
}
async function generateScope(info){
 const bootstrap=runtime(info),old=baseline(info,bootstrap);bootstrap.close();
 const api=runtime(info,old.study,old.vocabulary);await api.start();
 success(await api.vocab.savePlan({bookId:'scene',goal:20,dailyNew:3,weekdays:[1,2,3,4,5,6,7]},null,TIMEZONE));
 success(await api.vocab.addCandidate(api.catalog.SCENE_WORDS[8],'new','synthetic-candidate-'+info.code,TIMEZONE));
 success(await api.vocab.startGroup('new',TIMEZONE));
 for(const rating of ['known','fuzzy']){api.clock.value+=60000;success(await api.vocab.submitRating(rating,TIMEZONE,await target(api)));success(await api.vocab.nextStep(TIMEZONE,await target(api)));}
 api.clock.value+=60000;api.state.allowVocabularyWrite=false;const pending=await api.vocab.submitRating('forgotten',TIMEZONE,await target(api));assert.equal(pending.status,'pending');
 const preparedRows=(await api.repository.list('commands')).filter(row=>row.id.startsWith('vocab:')&&row.value.status==='prepared');assert.equal(preparedRows.length,1);const prepared=plain(preparedRows[0].value);assert.ok(!api.vocabulary.has(prepared.legacyPayload.id));
 api.clock.value+=60000;
 const grouped=api.questions.find(question=>question.groupId),queue=grouped?api.questions.filter(question=>question.part===grouped.part&&question.groupId===grouped.groupId):api.questions.slice(1,3);
 const units=[...new Set(queue.map(question=>question.groupId?`group:${question.part}:${question.groupId}`:`question:${question.id}`))];
 const started=await api.practice.start(queue,{unitIds:units});success(started);const sessionId=started.sessionId;
 for(let cursor=0;cursor<queue.length;cursor++){api.clock.value+=60000;success(await api.practice.submit(sessionId,queue[cursor].correctIndex,12,cursor));success(await api.practice.next(sessionId,cursor));}
 success(await api.practice.updateSettlementDraft(sessionId,{minutes:7,load:'刚好',note:'[SYNTHETIC] Unconfirmed seven-minute draft; no Checkin yet.'}));
 const workflow=plain(await api.vocab.exportWorkflow()),vocabulary={kind:'lantern-vocabulary',schemaVersion:1,events:[...api.vocabulary.values()].map(plain)},study={...plain(old.study),attempts:[...api.attempts.values()].map(plain),checkins:[...api.checkins.values()].map(plain)};
 const backupModule=api.load('lib/study-backup.ts');assert.deepEqual(plain(backupModule.parseStudyBackup(backupModule.createStudyBackup(study,BASE))),study);
 api.load('lib/vocabulary-model.ts').parseVocabularyBackup(vocabulary);
 api.load('lib/vocabulary-workflow.ts').validateVocabularyWorkflowBackup(workflow,api.repository.scopeKey);api.load('lib/practice-workflow.ts').validatePracticeWorkflowBackup(workflow,api.questions,api.repository.scopeKey);
 const projection=await api.vocab.readProjection(TIMEZONE),practice=(await api.practice.readProjection()).sessions.find(session=>session.id===sessionId);assert.equal(projection.daily.newDone,2);assert.equal(practice.settlement.status,'draft');assert.equal(study.checkins.length,1);
 const keys=keyInfo(info,api),evidence=await validateRestore(info,workflow,study,vocabulary,sessionId,prepared);
 const prefix=info.name+'/';
 output(prefix+'legacy-study-snapshot.json',{data:old.study});output(prefix+'legacy-study-backup.json',backupModule.createStudyBackup(old.study,BASE));output(prefix+'legacy-vocabulary-backup.json',old.vocabulary);
 output(prefix+'workflow.json',workflow);output(prefix+'workflow-study-snapshot.json',{data:study});output(prefix+'workflow-study-backup.json',backupModule.createStudyBackup(study,BASE));output(prefix+'workflow-vocabulary-backup.json',vocabulary);
 output(prefix+'expected.json',{synthetic:true,scope:info.scope,keys,catalog:{sceneCapacity:api.catalog.SCENE_WORDS.length,expressionCapacity:api.catalog.EXPRESSION_WORDS.length,practiceQuestionIds:queue.map(question=>question.id)},baseline:{attempts:old.study.attempts.length,checkins:old.study.checkins.length,minutes:9,vocabularyEvents:old.vocabulary.events.length,unknownWordId:'synthetic-missing-word',cancelledWordId:api.catalog.SCENE_WORDS[1].id},workflow:{fixedLearningDate:'2026-10-14',fixedLearningTimezone:TIMEZONE,dailyNewDone:2,preparedCommandId:prepared.id,preparedLegacyEventId:prepared.legacyPayload.id,preparedLegacyEventAbsent:true,practiceSessionId:sessionId,practiceStatus:'completed',practiceQuestions:queue.length,settlementStatus:'draft',settlementMinutes:7,checkinId:practice.settlement.checkinId,settlementCheckinAbsent:!api.checkins.has(practice.settlement.checkinId)},verification:evidence});
 api.close();return {name:info.name,scope:info.scope,keys,prefix};
}
async function verifySeedHelper(){
 const helper=require('./seed-isolated-context.cjs');
 for(const info of SCOPES)for(const mode of ['legacy-only','matching-workflow','missing-references']){
  const seed=helper.syntheticSeed({scenario:info.name,mode});assert.equal(seed.synthetic,true);assert.deepEqual(seed.scope,info.scope);assert.equal(JSON.parse(seed.entries[0][1]).data.schemaVersion,2);
  if(mode==='missing-references'){assert.equal(JSON.parse(seed.entries[0][1]).data.attempts.length,0);assert.equal(JSON.parse(seed.entries[1][1]).events.length,0);}
 }
 let init;await helper.installSyntheticSeed({async addInitScript(fn,args){init={fn,args};}},{origin:'http://127.0.0.1:49173',scenario:'web-local',mode:'legacy-only'});
 const store=new Map(),localStorage={get length(){return store.size;},getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,String(value))};
 const run=()=>vm.runInNewContext('('+init.fn.toString()+')(seedArgs)',{location:{origin:init.args.origin},localStorage,seedArgs:init.args,JSON,Error});
 run();assert.equal(store.size,3);const before=[...store];run();assert.deepEqual([...store],before);
 store.clear();store.set('unrelated-existing-record','preserve');assert.throws(run,/Refusing to overwrite/);assert.equal(store.get('unrelated-existing-record'),'preserve');
 await assert.rejects(helper.installSyntheticSeed({async addInitScript(){throw Error('Should not run');}},{origin:'https://example.com',scenario:'web-local'}),/isolated loopback/);
 assert.throws(()=>helper.syntheticSeed({scenario:'web-owner',mode:'legacy-only',fault:'bad-main'}),/separate web-local/);
 assert.throws(()=>JSON.parse(helper.syntheticSeed({scenario:'web-local',fault:'bad-main'}).entries[0][1]));
 assert.equal(JSON.parse(helper.syntheticSeed({scenario:'web-local',fault:'future-study'}).entries[0][1]).data.schemaVersion,999);
}
async function main(){
 source('package.json');source('package-lock.json');const scopes=[];for(const info of SCOPES)scopes.push(await generateScope(info));
 const original=JSON.parse(outputs.get('web-local/legacy-study-snapshot.json'));
 output('faults/bad-main-snapshot.txt','{"data":{"schemaVersion":2,"SYNTHETIC_CORRUPTION_ONLY":');
 output('faults/future-study-schema.json',{data:{...original.data,schemaVersion:999}});
 output('faults/future-workflow-schema.json',{kind:'lantern-workflow',schemaVersion:999,scope:SCOPES[1].scope,records:{},commands:[]});
 output('FIXTURE-INDEX.json',{kind:'synthetic-phase2-qa-fixtures',schemaVersion:1,synthetic:true,fixedClock:BASE,timezone:TIMEZONE,ownerId:'synthetic-phase2-qa',noRealUserData:true,generationBackend:'fake-indexeddb; in-memory IDBFactory only',scopes,faults:{normalImport:false,files:['faults/bad-main-snapshot.txt','faults/future-study-schema.json','faults/future-workflow-schema.json']}});
 for(const [file,data]of inputs)assert.equal(hash(fs.readFileSync(path.join(ROOT,file))),hash(data),`Source changed during generation: ${file}; rerun after release`);
 output('SOURCE-MANIFEST.json',{synthetic:true,sourceFiles:[...inputs].sort(([a],[b])=>a.localeCompare(b)).map(([file,data])=>({path:file,bytes:data.length,sha256:hash(data)})),runtime:{node:process.versions.node,typescript:ts.version,fakeIndexedDB:JSON.parse(fs.readFileSync(path.join(ROOT,'node_modules/fake-indexeddb/package.json'),'utf8')).version}});
 const own=['generate.cjs','seed-isolated-context.cjs','README.md'];
 const files=[...outputs].map(([file,data])=>({path:file,bytes:data.length,sha256:hash(data)})).concat(own.map(file=>{const data=fs.readFileSync(path.join(OUTPUT,file));return {path:file,bytes:data.length,sha256:hash(data)};})).sort((a,b)=>a.path.localeCompare(b.path));
 output('MANIFEST.json',{kind:'synthetic-phase2-qa-manifest',schemaVersion:1,synthetic:true,files});
 const checksumFiles=[...outputs].map(([file,data])=>({path:file,sha256:hash(data)})).concat(own.map(file=>({path:file,sha256:hash(fs.readFileSync(path.join(OUTPUT,file)))}))).sort((a,b)=>a.path.localeCompare(b.path));
 output('SHA256SUMS.txt',checksumFiles.map(row=>row.sha256+'  '+row.path).join('\n')+'\n');
 if(process.argv.includes('--verify')){
  for(const [file,data]of outputs)assert.deepEqual(fs.readFileSync(path.join(OUTPUT,file)),data,`Stale or changed fixture: ${file}`);
  process.stdout.write(`SYNTHETIC VERIFIED: ${outputs.size} generated files; 3 real-service scopes; missing/matching-reference checks passed.\n`);
 }else{
  for(const [file,data]of outputs){const destination=path.resolve(OUTPUT,file);assert.ok(destination.startsWith(OUTPUT+path.sep));fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,data);}
  process.stdout.write(`SYNTHETIC GENERATED: ${outputs.size} files in ${OUTPUT}; no browser/device/user storage accessed.\n`);
 }
 await verifySeedHelper();process.stdout.write('SYNTHETIC SEED HELPER VERIFIED: hash-bound inputs, fresh-origin guard, repeat seed, fault restrictions; no browser used.\n');
}
main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
