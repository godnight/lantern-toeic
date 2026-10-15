const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const {IDBFactory}=require(path.join(root,'node_modules/fake-indexeddb'));
const plain=value=>JSON.parse(JSON.stringify(value));
const cache=new Map();
function load(file,overrides={},globals={}){
 const key=file+Object.keys(overrides).join();if(!Object.keys(overrides).length&&cache.has(key))return cache.get(key);
 const exports={},source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(source,{exports,require(name){if(name in overrides)return overrides[name];if(name.endsWith('.json'))return JSON.parse(fs.readFileSync(path.resolve(path.dirname(path.join(root,file)),name),'utf8'));return load(path.relative(root,path.resolve(path.dirname(path.join(root,file)),name+'.ts')));},Date,Intl,Map,Set,Promise,Error,JSON,Number,Object,Array,Math,RegExp,Uint8Array,Uint32Array,DataView,TextEncoder,TextDecoder,structuredClone,crypto:crypto.webcrypto,setTimeout,clearTimeout,...globals},{filename:file});
 if(!Object.keys(overrides).length)cache.set(key,exports);return exports;
}
const model=load('lib/vocabulary-model.ts');
const repository=load('lib/learning-domain-repository.ts');
const actualCatalog=load('lib/workflow-catalog.ts');
const word=(id,text=id)=>({id,word:text,pos:'adj',meaning:'释义 '+text,category:'office',example:'An example of '+text+'.',translation:'例句',collocation:''});
const words=[word('quiet'),word('available'),word('invoice')];
const catalog={WORKFLOW_WORDS:words,getWorkflowCatalog:book=>book==='expressions'?[word('expression')]:words};
const {createVocabularyWorkflow,vocabularyDayWindow}=load('lib/vocabulary-workflow.ts',{'./workflow-catalog':catalog});
const scope={kind:'web-local',partition:'existing-device'};
const draft=(extra={})=>({bookId:'scene',goal:3,dailyNew:2,weekdays:[1,2,3,4,5,6,7],...extra});
async function fixture(options={}){
 const factory=options.factory||new IDBFactory(),name=options.name||'workflow-'+crypto.randomUUID(),events=options.events||new Map();let time=options.time||'2026-09-01T12:00:00.000Z',mode='normal',writes=[];
 const legacy={readEvents:()=>[...events.values()],readEvent:id=>{if(mode==='read-fail')throw Error('read unavailable');return events.get(id);},writeReview:event=>{writes.push(plain(event));if(mode==='throw-before')throw Error('quota');if(mode!=='missing')events.set(event.id,plain(event));if(mode==='throw-after')throw Error('lost response');return mode!=='missing';}};
 const repo=await repository.openLearningDomainRepository(options.scope||scope,{factory,name});
 const service=await createVocabularyWorkflow({scope:options.scope||scope,repository:repo,legacy,words,now:()=>new Date(time),isCurrent:options.isCurrent});
 return {service,repo,legacy,events,writes,factory,name,setTime:value=>time=value,setMode:value=>mode=value,async plan(value=draft()){const p=await service.readProjection('UTC');return service.savePlan(value,p.plan?.revision??null,'UTC');}};
}
async function target(service){const p=await service.readProjection('UTC');const s=p.activeSession;assert.ok(s?.currentStep);return {sessionId:s.id,stepId:s.currentStep.id};}
async function rate(service,rating='known',explicit){return service.submitRating(rating,'UTC',explicit||await target(service));}
async function next(service,explicit){return service.nextStep('UTC',explicit||await target(service));}
const successful=result=>assert.ok(['applied','replayed'].includes(result.status),JSON.stringify(result));
const oldReview=(wordId,grade='remembered',id='old-'+wordId,createdAt='2026-09-01T11:00:00.000Z')=>({id,wordId,createdAt,type:'review',grade});

test('catalog reuses the real 807 scene IDs and 55 expression IDs without fabricated learning',()=>{
 assert.equal(actualCatalog.SCENE_WORDS.length,807);assert.equal(actualCatalog.EXPRESSION_WORDS.length,55);
 assert.equal(new Set(actualCatalog.WORKFLOW_WORDS.map(row=>row.id)).size,862);
 assert.equal(actualCatalog.SCENE_WORDS[0].id,JSON.parse(fs.readFileSync(path.join(root,'content/vocabulary.json'),'utf8'))[0].id);
});
test('initial projection does not create a plan, fake history, or classify old reviews as today',async()=>{
 const f=await fixture();f.events.set('old-quiet',oldReview('quiet'));f.events.set('old-unknown',oldReview('unknown-old-id'));f.events.set('old-mark',{id:'old-mark',wordId:'quiet',createdAt:'2026-09-01T11:00:00.000Z',type:'mark',starred:false,revision:2});
 const p=await f.service.readProjection();assert.equal(p.plan,null);assert.equal(p.counts.learned,1);assert.equal(p.daily.newDone,0);assert.equal(p.daily.reviewDone,0);assert.equal((await f.repo.list('plans')).length,0);assert.equal(f.events.size,3);
});
test('goal validation has priority, equal learned allows no learning days, and completion stays sticky',async()=>{
 const f=await fixture();f.events.set('old-quiet',oldReview('quiet'));
 const invalid=await f.plan(draft({goal:0,weekdays:[]}));assert.equal(invalid.status,'blocked');assert.match(invalid.reason,/目标/);
 const noDays=await f.plan(draft({goal:2,weekdays:[]}));assert.equal(noDays.status,'blocked');assert.match(noDays.reason,/学习日/);
 successful(await f.plan(draft({goal:1,weekdays:[]})));assert.equal((await f.service.readProjection()).daily.goalCompleted,true);
 successful(await f.plan(draft({goal:3})));const p=await f.service.readProjection();assert.equal(p.daily.goalCompleted,true);assert.equal(p.daily.newRemaining,2);assert.equal(p.counts.learned,1);
 const backup=await f.service.exportWorkflow();assert.equal(backup.records.plans[0].value.revision,2);
});
test('quiet and available each move from new candidate to a first explicit manual review',async()=>{
 for(const first of ['quiet','available']){
  const selected=words.find(row=>row.id===first),others=words.filter(row=>row.id!==first),f=await fixture();for(const other of others)f.events.set('old-'+other.id,oldReview(other.id));
  successful(await f.plan(draft({dailyNew:1})));successful(await f.service.addCandidate(selected,'new'));
  assert.equal((await f.service.addCandidate(selected,'new')).status,'already-present');assert.equal(f.writes.length,0);
  successful(await f.service.startGroup('new'));successful(await rate(f.service));assert.equal((await f.service.readProjection()).activeSession.cursor,0);assert.ok((await f.service.readProjection()).activeSession.currentStep.receipt);
  successful(await next(f.service));let p=await f.service.readProjection();assert.equal(p.daily.newDone,1);assert.equal(p.daily.reviewDone,0);assert.equal(f.service.candidateStatus(selected),'available-review');
  assert.equal((await f.service.addCandidate(selected,'new')).status,'stage-changed');successful(await f.service.addCandidate(selected,'manual-review'));
  assert.equal((await f.service.addCandidate(selected,'manual-review')).status,'already-review');p=await f.service.readProjection();assert.equal(p.daily.reviewDone,0);
  successful(await f.service.startGroup('review'));successful(await rate(f.service,'fuzzy'));successful(await next(f.service));p=await f.service.readProjection();assert.equal(p.daily.reviewDone,1);assert.equal(p.daily.newDone,1);assert.equal(f.service.candidateStatus(selected),'today-reviewed');assert.equal((await f.service.addCandidate(selected,'manual-review')).status,'today-reviewed');
 }
});
test('three raw ratings retain their labels while fuzzy/forgotten use the legacy again interval',async()=>{
 for(const rating of ['known','fuzzy','forgotten']){
  const f=await fixture();successful(await f.plan(draft({dailyNew:1})));successful(await f.service.startGroup('new'));successful(await rate(f.service,rating));
  const command=(await f.repo.list('commands'))[0].value,event=[...f.events.values()][0];assert.equal(command.rawRating,rating);assert.equal(command.ratingPolicy,'three-label-conservative-v1');assert.equal(event.grade,rating==='known'?'remembered':'again');assert.equal(event.createdAt,command.occurredAt);
  const state=model.vocabularyState([...f.events.values()],event.wordId);assert.equal(state.due-Date.parse(event.createdAt),rating==='known'?86400000:600000);
 }
});
test('success comes before meaning and next is separate; a lying save bool never unlocks either',async()=>{
 const f=await fixture();successful(await f.plan());successful(await f.service.startGroup('new'));const original=await target(f.service);f.setMode('missing');
 assert.equal((await rate(f.service,'known',original)).status,'pending');let p=await f.service.readProjection();assert.equal(p.activeSession.cursor,0);assert.equal(p.activeSession.currentStep.receipt,undefined);assert.equal(p.activeSession.currentStep.pendingRating,'known');assert.equal(p.daily.newDone,0);assert.equal((await next(f.service,original)).status,'blocked');
 f.setMode('normal');successful(await rate(f.service,'known',original));p=await f.service.readProjection();assert.equal(p.activeSession.cursor,0);assert.ok(p.activeSession.currentStep.receipt);assert.equal(p.daily.newDone,1);successful(await next(f.service,original));assert.equal((await f.service.readProjection()).activeSession.cursor,1);
 assert.equal(f.events.size,1);assert.deepEqual(f.writes[0],f.writes[1]);
});
test('lost legacy write response is confirmed by actual readback rather than written again',async()=>{
 const f=await fixture();successful(await f.plan());successful(await f.service.startGroup());f.setMode('throw-after');successful(await rate(f.service));assert.equal(f.events.size,1);assert.equal(f.writes.length,1);successful(await rate(f.service));assert.equal(f.writes.length,1);
});
test('two labels cannot reserve different answers for one step; repeated same feedback is replayed',async()=>{
 const a=await fixture(),b=await fixture({factory:a.factory,name:a.name,events:a.events});successful(await a.plan());successful(await a.service.startGroup());const fixed=await target(a.service);
 const results=await Promise.all([a.service.submitRating('known','UTC',fixed),b.service.submitRating('forgotten','UTC',fixed)]);assert.equal(results.filter(row=>['applied','replayed'].includes(row.status)).length,1);assert.equal(results.filter(row=>row.status==='conflict').length,1);assert.equal(a.events.size,1);assert.equal((await a.repo.list('commands')).length,1);
 const winner=(await a.repo.list('commands'))[0].value.rawRating;successful(await a.service.submitRating(winner,'UTC',fixed));assert.equal(a.events.size,1);
});
test('a stale tab never submits the previous word rating to the next visible cursor',async()=>{
 const a=await fixture(),b=await fixture({factory:a.factory,name:a.name,events:a.events});successful(await a.plan());successful(await a.service.startGroup());const fixed=await target(b.service);successful(await rate(a.service,'known',fixed));successful(await next(a.service,fixed));
 assert.equal((await b.service.submitRating('forgotten','UTC',fixed)).status,'conflict');assert.equal((await b.service.nextStep('UTC',fixed)).status,'conflict');assert.equal(a.events.size,1);assert.equal((await b.service.readProjection()).activeSession.cursor,1);
});
test('plan edits affect only unstarted arrangements and preserve active group queue/revision',async()=>{
 const f=await fixture();successful(await f.plan());successful(await f.service.startGroup());const before=plain((await f.service.readProjection()).activeSession);successful(await rate(f.service));
 successful(await f.plan(draft({dailyNew:1})));const p=await f.service.readProjection();assert.equal(p.plan.revision,2);assert.equal(p.activeSession.planRevision,1);assert.deepEqual(p.activeSession.queue.map(row=>row.id),before.queue.map(row=>row.id));assert.equal(p.daily.newRemaining,0);assert.equal(p.daily.newDone,1);
 successful(await next(f.service));successful(await rate(f.service));successful(await next(f.service));assert.equal((await f.service.readProjection()).daily.newDone,2);
});
test('rest days dispatch no new words, but due/manual reviews remain available in pages of at most 20',async()=>{
 const f=await fixture();f.events.set('old-quiet',oldReview('quiet','again'));successful(await f.plan(draft({weekdays:[1]})));const p=await f.service.readProjection();assert.equal(p.daily.isLearningDay,false);assert.equal(p.daily.newRemaining,0);assert.equal(p.daily.reviewRemaining,1);successful(await f.service.startGroup());assert.equal((await f.service.readProjection()).activeSession.queue[0].intent,'due-review');
});
test('cross-midnight feedback belongs to the original fixed group and day',async()=>{
 const f=await fixture({time:'2026-09-01T23:59:00.000Z'});successful(await f.plan(draft({dailyNew:1})));successful(await f.service.startGroup());const original=(await f.service.readProjection()).daily.window.id;f.setTime('2026-09-02T00:01:00.000Z');successful(await rate(f.service));
 const p=await f.service.readProjection();assert.notEqual(p.daily.window.id,original);assert.equal(p.activeSession.dayWindow.id,original);assert.equal(p.daily.newDone,0);const days=await f.repo.list('days');assert.equal(days.find(row=>row.id===original).value.newDone.length,1);
});
test('timezone transition follows live receipts from a cross-midnight group without a second quota',async()=>{
 const f=await fixture({time:'2026-09-01T23:50:00.000Z'});successful(await f.plan(draft({dailyNew:3})));successful(await f.service.startGroup());successful(await rate(f.service));successful(await next(f.service));
 f.setTime('2026-09-02T00:05:00.000Z');let p=await f.service.readProjection('America/New_York');successful(await f.service.savePlan(draft({dailyNew:3}),p.plan.revision,'America/New_York'));assert.equal((await f.service.readProjection('America/New_York')).daily.newDone,1);
 successful(await rate(f.service));successful(await next(f.service));successful(await rate(f.service));successful(await next(f.service));p=await f.service.readProjection('America/New_York');assert.equal(p.daily.newDone,3);assert.equal(p.daily.newRemaining,0);
});
test('explicit extra practice has no daily cap and reinforcement never adds a second review count',async()=>{
 const f=await fixture();for(const row of words)f.events.set('old-'+row.id,oldReview(row.id));successful(await f.plan(draft({goal:3,weekdays:[]})));successful(await f.service.addCandidate(words[0],'manual-review'));successful(await f.service.startGroup('review'));successful(await rate(f.service));successful(await next(f.service));
 successful(await f.service.startGroup('extra'));let p=await f.service.readProjection();assert.equal(p.activeSession.currentStep.intent,'reinforcement');successful(await rate(f.service));p=await f.service.readProjection();assert.equal(p.daily.reviewDone,1);assert.equal(p.counts.learned,3);
});
test('separate workflow backups merge twice with zero additions and preserve unknown old IDs/marks',async()=>{
 const a=await fixture();a.events.set('old-unknown',oldReview('unknown-old-id'));a.events.set('old-mark',{id:'old-mark',wordId:'quiet',createdAt:'2026-09-01T11:00:00.000Z',type:'mark',starred:false,revision:4});successful(await a.plan());successful(await a.service.startGroup());successful(await rate(a.service));const backup=plain(await a.service.exportWorkflow()),before=plain([...a.events.values()]);
 const b=await fixture({events:a.events});successful(await b.service.restoreWorkflow(backup));const duplicate=await b.service.restoreWorkflow(backup);assert.equal(duplicate.status,'replayed');assert.equal(duplicate.added,0);assert.deepEqual([...a.events.values()],before);assert.equal((await b.service.readProjection()).daily.newDone,1);
 const changed=plain(backup);changed.records.plans[0].value.dailyNew=9;assert.equal((await b.service.restoreWorkflow(changed)).status,'conflict');assert.equal((await b.service.readProjection()).plan.dailyNew,2);
});
test('an imported completed session without old facts is unverified, unrevealed and not completed',async()=>{
 const a=await fixture();successful(await a.plan(draft({dailyNew:1})));successful(await a.service.startGroup());successful(await rate(a.service));successful(await next(a.service));const backup=plain(await a.service.exportWorkflow());
 const b=await fixture();successful(await b.service.restoreWorkflow(backup));const p=await b.service.readProjection();assert.equal(p.daily.newDone,0);assert.equal(p.counts.learned,0);assert.equal(p.activeSession.status,'active');assert.ok(p.activeSession.blockedReason);assert.equal(p.activeSession.currentStep.receipt,undefined);assert.equal((await next(b.service)).status,'blocked');assert.equal(b.writes.length,0);
});
test('restored prepared commands do not execute until an explicit identical-rating retry',async()=>{
 const a=await fixture();successful(await a.plan(draft({dailyNew:1})));successful(await a.service.startGroup());a.setMode('throw-before');assert.equal((await rate(a.service,'fuzzy')).status,'pending');const original=(await a.repo.list('commands'))[0].value,backup=plain(await a.service.exportWorkflow());
 const b=await fixture();successful(await b.service.restoreWorkflow(backup));assert.equal(b.writes.length,0);assert.equal((await b.service.readProjection()).activeSession.currentStep.pendingRating,'fuzzy');assert.equal((await rate(b.service,'known')).status,'conflict');successful(await rate(b.service,'fuzzy'));assert.deepEqual(b.writes[0],original.legacyPayload);assert.equal(b.events.size,1);
});
test('legacy write followed by failed apply recovers after reopen without another legacy event',async()=>{
 const a=await fixture();successful(await a.plan());successful(await a.service.startGroup());const original=a.repo.commit.bind(a.repo);a.repo.commit=command=>command.commandId.startsWith('vocab:apply:')?Promise.resolve({status:'blocked',reason:'quota'}):original(command);
 assert.equal((await rate(a.service)).status,'blocked');assert.equal(a.events.size,1);a.service.close();const b=await fixture({factory:a.factory,name:a.name,events:a.events});const p=await b.service.readProjection();assert.equal(p.daily.newDone,1);assert.ok(p.activeSession.currentStep.receipt);assert.equal(b.writes.length,0);
});
test('IDB prepare quota and scope generation failure cannot leak an event or reveal',async()=>{
 let active=true;const f=await fixture({isCurrent:()=>active});successful(await f.plan());successful(await f.service.startGroup());const fixed=await target(f.service),commit=f.repo.commit.bind(f.repo);f.repo.commit=command=>command.commandId.startsWith('vocab:prepare:')?Promise.resolve({status:'blocked',reason:'quota'}):commit(command);
 assert.equal((await rate(f.service,'known',fixed)).status,'blocked');assert.equal(f.events.size,0);assert.equal((await f.service.readProjection()).activeSession.currentStep.receipt,undefined);active=false;assert.equal((await f.service.submitRating('known','UTC',fixed)).status,'unknown');assert.equal(f.events.size,0);
});
test('scope mismatch and future workflow schema block restore before mutations',async()=>{
 const a=await fixture();successful(await a.plan());const backup=plain(await a.service.exportWorkflow()),b=await fixture({scope:{kind:'web-owner',ownerId:'owner-b'}});assert.equal((await b.service.restoreWorkflow(backup)).status,'blocked');assert.equal((await b.repo.list('plans')).length,0);
 const future=plain(backup);future.records.plans[0].value.schemaVersion=2;assert.equal((await a.service.restoreWorkflow(future)).status,'blocked');assert.equal((await a.service.readProjection()).plan.revision,1);
});
test('day boundaries use profile timezone and retain DST-length days',()=>{
 const window=vocabularyDayWindow(new Date('2026-03-08T12:00:00.000Z'),'America/New_York');assert.equal(window.localDate,'2026-03-08');assert.equal(Date.parse(window.endAt)-Date.parse(window.startAt),23*3600000);
});
test('explicit new candidates are scheduled without increasing the saved goal',async()=>{
 const f=await fixture();successful(await f.plan(draft({dailyNew:1})));successful(await f.service.addCandidate(word('lookup-quiet','quiet'),'new'));const p=await f.service.readProjection();assert.equal(p.plan.goal,3);assert.equal(p.counts.capacity,4);assert.equal(p.daily.newWordIds[0],'lookup-quiet');successful(await f.service.startGroup('new'));assert.equal((await f.service.readProjection()).activeSession.currentStep.wordId,'lookup-quiet');
});
test('a book change preserves due old IDs, including explicitly unresolved ones',async()=>{
 const f=await fixture();f.events.set('old-quiet',oldReview('quiet','again'));f.events.set('old-unresolved',oldReview('old-unresolved','again'));successful(await f.plan(draft({bookId:'expressions',goal:1})));const p=await f.service.readProjection();assert.equal(p.counts.reviewDue,2);assert.equal(p.daily.reviewRemaining,2);assert.deepEqual(plain(p.unresolvedReviewWordIds),['old-unresolved']);successful(await f.service.startGroup('review'));assert.equal((await f.service.readProjection()).activeSession.currentStep.wordId,'quiet');
});
test('review paging really retains the remaining ten after a twenty-card fixed group',async()=>{
 const f=await fixture();successful(await f.plan());for(let i=0;i<30;i++){const item=word('manual-'+i);f.events.set('old-'+item.id,oldReview(item.id));successful(await f.service.addCandidate(item,'manual-review'));}
 assert.equal((await f.service.readProjection()).daily.reviewRemaining,30);successful(await f.service.startGroup('review'));assert.equal((await f.service.readProjection()).activeSession.queue.length,20);
 for(let i=0;i<20;i++){successful(await rate(f.service));successful(await next(f.service));}
 assert.equal((await f.service.readProjection()).daily.reviewRemaining,10);successful(await f.service.startGroup('review'));assert.equal((await f.service.readProjection()).activeSession.queue.length,10);
});
test('a completed goal imported without its old coverage events does not claim completion',async()=>{
 const a=await fixture();a.events.set('old-quiet',oldReview('quiet'));successful(await a.plan(draft({goal:1,weekdays:[]})));successful(await a.plan(draft({goal:3})));assert.equal((await a.service.readProjection()).daily.goalCompleted,true);const backup=plain(await a.service.exportWorkflow());const b=await fixture();successful(await b.service.restoreWorkflow(backup));assert.equal((await b.service.readProjection()).daily.goalCompleted,false);
});
test('foreign malformed practice rows and unknown domains are rejected before any IDB restore',async()=>{
 const a=await fixture();successful(await a.plan());const backup=plain(await a.service.exportWorkflow());
 for(const row of [{id:'practice:bad',revision:1,value:{kind:'practice-session',schemaVersion:1,status:'completed'}},{id:'foreign:bad',revision:1,value:{schemaVersion:1}}]){
  const input=plain(backup);input.records.sessions.push(row);const b=await fixture();assert.equal((await b.service.restoreWorkflow(input)).status,'blocked');assert.equal((await b.repo.list('plans')).length,0);assert.equal((await b.repo.list('sessions')).length,0);
 }
});
test('one valid whole-scope backup includes real practice sessions, answers and technical receipts',async()=>{
 const a=await fixture();successful(await a.plan());const questions=JSON.parse(fs.readFileSync(path.join(root,'content/questions.json'),'utf8')),question=questions.find(row=>!row.groupId),attempts=new Map(),checkins=new Map();
 const practice=await load('lib/practice-workflow.ts').createPracticeWorkflow({scope,repository:a.repo,questions,timezone:'UTC',now:()=>new Date('2026-09-01T12:00:00.000Z'),legacy:{addAttempt:event=>{attempts.set(event.id,plain(event));return true;},readAttempt:id=>attempts.get(id),addCheckin:event=>{checkins.set(event.id,plain(event));return true;},readCheckin:id=>checkins.get(id)}});
 const started=await practice.start([question],{unitIds:['question:'+question.id]});assert.equal(started.status,'started',JSON.stringify(started));const submitted=await practice.submit(started.sessionId,question.correctIndex,4,0);assert.equal(submitted.status,'applied',JSON.stringify(submitted));const state=(await practice.readProjection()).sessions.find(row=>row.id===started.sessionId),training=load('lib/practice-training.ts'),nextTraining=plain(state.training);nextTraining.materials[0].dictationDraft='CT whole-scope draft';nextTraining.materials[0].step='dictation';const saved=await practice.updateTraining(started.sessionId,{operationId:crypto.randomUUID(),occurredAt:'2026-09-01T12:00:00.000Z',expectedHash:training.trainingHash(state.training),training:nextTraining});assert.equal(saved.status,'updated',JSON.stringify(saved));const advanced=await practice.next(started.sessionId,0);assert.equal(advanced.status,'applied',JSON.stringify(advanced));
 const backup=plain(await a.service.exportWorkflow());assert.ok(backup.records.commands.some(row=>row.id.startsWith('practice-answer:')));assert.ok(backup.commands.some(row=>row.command.commandId.startsWith('practice-start:')));const b=await fixture();successful(await b.service.restoreWorkflow(backup));assert.equal((await b.repo.list('commands')).filter(row=>row.id.startsWith('practice-answer:')).length,1);assert.equal((await b.repo.list('plans')).length,1);const restored=(await b.repo.list('sessions')).find(row=>row.id===started.sessionId);assert.equal(restored.value.schemaVersion,2);assert.equal(restored.value.training.materials[0].dictationDraft,'CT whole-scope draft');successful(await b.service.restoreWorkflow(backup));
});

function reactHarness(){
 const slots=[];let cursor=0,effects=[];const same=(a,b)=>a&&b&&a.length===b.length&&a.every((item,i)=>Object.is(item,b[i]));
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
 return {react,render(fn){cursor=0;const value=fn(),batch=effects;effects=[];batch.forEach(effect=>effect());return value;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('the public workflow refresh reopens a failed IDB service while timer refreshes never loop',async()=>{
 const f=await fixture(),projection=await f.service.readProjection(),h=reactHarness(),timers=[];let opens=0,closed=0;
 const options={owner:null,nativeMode:false,identityReady:true,timezone:'UTC',legacy:{ready:true,error:'',events:[],backup:()=>({events:[]}),readEvent:()=>undefined,reviewEvent:()=>false}};
 const hook=load('lib/use-vocabulary-workflow.ts',{react:h.react,'./vocabulary-workflow':{createVocabularyWorkflow:async()=>{const generation=++opens;return {readProjection:async()=>{if(generation===1)throw Error('IDB temporarily unavailable');return projection;},close:()=>closed++,candidateStatus:()=> 'available-new'};}}},{window:{addEventListener(){},removeEventListener(){}},setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){}});
 const render=()=>h.render(()=>hook.useVocabularyWorkflow(options));render();await tick();let api=render();assert.equal(api.ready,false);assert.match(api.error,/unavailable/);timers.forEach(fn=>fn());await tick();api=render();assert.equal(opens,1);await api.refresh();render();await tick();api=render();assert.equal(opens,2);assert.equal(api.ready,true);assert.equal(api.error,'');assert.ok(closed>=1);
});
test('same-page legacy hooks observe invalidations and confirm fixed full review content',()=>{
 const storage=new Map(),listeners=new Map(),window={addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);},dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event);return true;}};
 const localStorage={get length(){return storage.size;},key:i=>[...storage.keys()][i]??null,getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
 class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail;}}
 function mounted(){const h=reactHarness(),hook=load('lib/use-vocabulary.ts',{react:h.react,sonner:{toast:{error(){}}}},{window,localStorage,CustomEvent});const render=()=>h.render(()=>hook.useVocabulary(null));render();return {render};}
 const a=mounted(),b=mounted(),fixed=oldReview('quiet','again','fixed-review','2026-09-01T12:00:00.000Z');assert.equal(b.render().events.length,0);assert.equal(a.render().reviewEvent(fixed),true);assert.deepEqual(plain(a.render().readEvent(fixed.id)),fixed);assert.equal(b.render().events.length,1);const entries=storage.size;assert.equal(a.render().reviewEvent({...fixed}),true);assert.equal(storage.size,entries);assert.equal(a.render().reviewEvent({...fixed,grade:'remembered'}),false);assert.equal(b.render().events[0].grade,'again');
});
