// Real model/workflow + synthetic IDB/journal; no account server or learner data.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),{createSourceLoader}=require('./helpers/actual-source-loader.cjs'),{IDBFactory}=require('fake-indexeddb');
const plain=x=>JSON.parse(JSON.stringify(x));
const words=Array.from({length:60},(_,i)=>({id:'word-'+String(i).padStart(3,'0'),word:String.fromCharCode(97+i%26)+'word'+i,pos:'n.',meaning:'测试释义',category:'office',example:'A sample word.',translation:'合成例句',collocation:''}));
const catalog={WORKFLOW_WORDS:words,getWorkflowCatalog:()=>words,isWorkflowBookId:()=>true,getCandidateLearningWord:row=>words.find(w=>w.id===row.id),CANDIDATE_CONTENT_PENDING:'pending'};
const loader=createSourceLoader({root,imports:{'./workflow-catalog':catalog}}),model=loader.load('lib/vocabulary-model.ts'),{createVocabularyWorkflow,validateVocabularyWorkflowBackup}=loader.load('lib/vocabulary-workflow.ts'),{stableNewVocabularyOrder}=loader.load('lib/vocabulary-new-order.ts');
const scope={kind:'web-local',partition:'existing-device'},zone='UTC';
async function fixture(options={}){
 const events=options.events??new Map(),factory=options.factory??new IDBFactory(),name=options.name??crypto.randomUUID();let at='2026-10-01T10:00:00.000Z',mode='',current=true,writes=0;
 const write=e=>{if(!current)throw Error('owner invalid');if(mode==='before')throw Error('quota');events.set(e.id,plain(e));if(e.type==='review-correction')writes++;if(mode==='after')throw Error('reply lost');return true;};
 const legacy={readEvents:()=>[...events.values()],readEvent:id=>events.get(id),writeReview:write,writeCorrection:write};
 const service=await createVocabularyWorkflow({scope:options.scope??scope,legacy,words,factory,databaseName:name,isCurrent:()=>current,now:()=>new Date(at)});
 return {service,events,factory,name,legacy,get writes(){return writes;},setMode:v=>mode=v,setTime:v=>at=v,invalidate:()=>current=false,async start(){const p=await service.readProjection(zone);if(!p.plan)ok(await service.savePlan({bookId:'scene',goal:60,dailyNew:20,weekdays:[1,2,3,4,5,6,7]},null,zone));ok(await service.startGroup('new',zone));},close(){service.close();}};
}
function ok(r){assert(['applied','replayed'].includes(r.status),JSON.stringify(r));}
async function visible(f){const p=await f.service.readProjection(zone);return p.activeSession;}
const target=s=>({sessionId:s.id,stepId:s.currentStep.id});
const correction=s=>({...target(s),commandId:s.currentStep.receipt.commandId,reviewId:s.currentStep.receipt.legacyEventId});
async function rate(f){const s=await visible(f);ok(await f.service.submitRating('known',zone,target(s)));return visible(f);}
async function next(f){const s=await visible(f);ok(await f.service.nextStep(zone,target(s)));return visible(f);}

test('new order is a deterministic full permutation, independent of input array, date and quota',()=>{
 const input=plain(words),a=stableNewVocabularyOrder(input,'scene'),b=stableNewVocabularyOrder([...input].reverse(),'scene');
 assert.deepEqual(a.map(w=>w.id),b.map(w=>w.id));assert.deepEqual(input,words);assert.equal(new Set(a.map(w=>w.id)).size,words.length);assert.deepEqual(a.map(w=>w.id).sort(),words.map(w=>w.id).sort());
 assert.notDeepEqual(a.map(w=>w.id),words.map(w=>w.id));assert(new Set(a.slice(0,20).map(w=>w.word[0])).size>=10);
});
test('saved group survives plan changes, reopen and reload without reordering or duplicating words',async()=>{
 const f=await fixture();try{await f.start();const first=plain(await visible(f));ok(await f.service.savePlan({bookId:'expressions',goal:60,dailyNew:10,weekdays:[1,2,3,4,5,6,7]},1,zone));ok(await f.service.startGroup('extra',zone));assert.deepEqual(plain((await visible(f)).queue),first.queue);
 const second=await fixture({factory:f.factory,name:f.name,events:f.events});try{assert.deepEqual(plain((await visible(second)).queue),first.queue);}finally{second.close();}
 }finally{f.close();}});
test('downgrade changes effective SRS, preserves original facts and counts, and replays without another write',async()=>{
 const f=await fixture();try{await f.start();const s=await rate(f),original=plain([...f.events.values()][0]),command=plain((await f.service.readCommand(s.currentStep.receipt.commandId)).value),before=await f.service.readProjection(zone);
 ok(await f.service.correctRating(zone,correction(s)));const after=await f.service.readProjection(zone),state=model.vocabularyState([...f.events.values()],s.currentStep.wordId);
 assert.equal(state.level,0);assert.equal(state.reviews,1);assert.equal(state.due,Date.parse(original.createdAt)+600000);assert.deepEqual(f.events.get(original.id),original);assert.equal(after.daily.newDone,before.daily.newDone);assert.equal(after.counts.learned,before.counts.learned);assert.equal(after.activeSession.cursor,0);assert.equal(after.activeSession.currentStep.correctedToForgotten,true);
 const actual=(await f.service.readCommand(command.id)).value;for(const key of ['legacyPayload','rawRating','receipt','occurredAt','payloadHash'])assert.deepEqual(plain(actual[key]),command[key]);const snapshot=plain(await f.service.exportWorkflow());ok(await f.service.correctRating(zone,correction(s)));assert.equal(f.writes,1);assert.deepEqual(plain(await f.service.exportWorkflow()),snapshot);
 }finally{f.close();}});
test('previous-word correction keeps durable cursor and current word; older or foreign-session targets cannot write',async()=>{
 const f=await fixture();try{await f.start();const first=await rate(f),old=correction(first),second=await next(f);ok(await f.service.correctRating(zone,old));const current=await visible(f);assert.equal(current.cursor,1);assert.equal(current.currentStep.id,second.currentStep.id);assert.equal(current.queue[0].correctedToForgotten,true);await rate(f);await next(f);const before=plain([...f.events.values()]);assert.equal((await f.service.correctRating(zone,old)).status,'conflict');assert.equal((await f.service.correctRating(zone,{...old,sessionId:'vocab:session:other'})).status,'conflict');assert.deepEqual(plain([...f.events.values()]),before);
 }finally{f.close();}});
test('failed correction retains one reserved event, blocks next and explicit retry applies it once',async()=>{
 const f=await fixture();try{await f.start();const s=await rate(f);f.setMode('before');assert.equal((await f.service.correctRating(zone,correction(s))).status,'pending');const pending=(await f.service.readCommand(s.currentStep.receipt.commandId)).value.correction.event;assert.equal((await f.service.nextStep(zone,target(s))).status,'pending');f.setMode('');ok(await f.service.correctRating(zone,correction(s)));assert.equal(f.writes,1);assert.deepEqual(f.events.get(pending.id),plain(pending));assert.equal(f.events.size,2);
 }finally{f.close();}});
test('lost correction reply uses exact readback; crash before apply recovers without rewriting fact',async()=>{
 const f=await fixture();try{await f.start();const s=await rate(f),commit=f.service.repository.commit.bind(f.service.repository);let fail=true;f.service.repository.commit=async(...args)=>{if(fail&&args[0].commandId.startsWith('vocab:correct-apply:')){fail=false;throw Error('crash before apply');}return commit(...args);};f.setMode('after');assert.equal((await f.service.correctRating(zone,correction(s))).status,'unknown');f.setMode('');const restored=await visible(f);assert.equal(restored.currentStep.correctedToForgotten,true);assert.equal(f.writes,1);ok(await f.service.correctRating(zone,correction(s)));assert.equal(f.writes,1);
 }finally{f.close();}});
test('clock rollback is clamped before persistence and cannot poison future reads',async()=>{
 const f=await fixture();try{await f.start();const s=await rate(f);f.setTime('2026-10-01T09:59:00.000Z');ok(await f.service.correctRating(zone,correction(s)));const corrected=[...f.events.values()].find(e=>e.type==='review-correction');assert.equal(corrected.createdAt,s.currentStep.receipt.occurredAt);assert.equal((await visible(f)).currentStep.correctedToForgotten,true);const plainSnapshot=plain(await f.service.exportWorkflow());assert.doesNotThrow(()=>validateVocabularyWorkflowBackup(plainSnapshot));}finally{f.close();}
});
test('v1 backups remain readable, v2 correction can arrive before original but does not invent a review',()=>{
 const original={id:'review-origin',wordId:'word-000',type:'review',grade:'remembered',createdAt:'2026-10-01T10:00:00.000Z'},event={id:'review-correct',wordId:original.wordId,type:'review-correction',reviewId:original.id,reviewHash:model.vocabularyReviewHash(original),grade:'again',createdAt:'2026-10-01T10:00:01.000Z'};
 assert.equal(model.parseVocabularyBackup({kind:'lantern-vocabulary',schemaVersion:1,events:[original]}).schemaVersion,1);const backup=model.parseVocabularyBackup(model.vocabularyBackup([event]));assert.equal(backup.schemaVersion,2);assert.equal(model.vocabularyState(backup.events,original.wordId).reviews,0);const all=model.mergeVocabularyEvents(backup.events,[original]);assert.equal(model.vocabularyState(all,original.wordId).level,0);assert.equal(model.vocabularyState(all,original.wordId).reviews,1);assert.equal(model.vocabularyState([original,{...event,reviewHash:'0'.repeat(64)}],original.wordId).level,1);
});
test('alias projection folds valid corrections before translating legacy word IDs',()=>{
 const original={id:'alias-review',wordId:'dict-3a7bd3e2360a3d29eea4',type:'review',grade:'remembered',createdAt:'2026-10-01T10:00:00.000Z'},event={id:'alias-correct',wordId:original.wordId,type:'review-correction',reviewId:original.id,reviewHash:model.vocabularyReviewHash(original),grade:'again',createdAt:'2026-10-01T10:01:00.000Z'};
 const dictionary=loader.load('lib/dictionary-model.ts'),before=JSON.stringify([original,event]),states=dictionary.vocabularyStates([original,event]);assert.equal(states.get('v041-word-3a7bd3e2360a3d29eea4').level,0);assert.equal(states.get('v041-word-3a7bd3e2360a3d29eea4').reviews,1);assert.equal(JSON.stringify([original,event]),before);
});
test('workflow backup requires canonical correction; metadata without fact blocks instead of recreating it',async()=>{
 const f=await fixture();let other;try{await f.start();const s=await rate(f);ok(await f.service.correctRating(zone,correction(s)));const backup=plain(await f.service.exportWorkflow());validateVocabularyWorkflowBackup(backup);for(const change of [e=>e.extra=true,e=>e.createdAt='2026-10-01T18:00:00+08:00']){const bad=plain(backup);change(bad.records.commands[0].value.correction.event);assert.throws(()=>validateVocabularyWorkflowBackup(bad));}
 const original=[...f.events.values()].find(e=>e.type==='review');other=await fixture({events:new Map([[original.id,original]])});ok(await other.service.restoreWorkflow(backup,zone));const restored=await visible(other);assert.match(restored.blockedReason,/改判事件/);assert.equal(restored.currentStep.correctedToForgotten,false);assert.equal((await other.service.correctRating(zone,correction(s))).status,'blocked');assert.equal(other.writes,0);assert.equal(other.events.size,1);
 }finally{other?.close();f.close();}});
test('owner invalidation during correction prepare aborts full IDB batch and writes no correction fact',async()=>{
 const f=await fixture();try{await f.start();const s=await rate(f),before=plain(await f.service.exportWorkflow()),commit=f.service.repository.commit.bind(f.service.repository);f.service.repository.commit=async(...args)=>{if(args[0].commandId.startsWith('vocab:correct-prepare:'))f.invalidate();return commit(...args);};assert.equal((await f.service.correctRating(zone,correction(s))).status,'blocked');assert.equal(f.writes,0);assert.equal(f.events.size,1);assert.deepEqual(plain(await f.service.repository.exportBackup()),before);
 }finally{f.close();}});

test('successive daily groups cover the pool once without gaps and keep the same relative order across dates',async()=>{
 const f=await fixture();try{const seen=[];for(let day=0;day<3;day++){f.setTime(`2026-10-0${day+1}T10:00:00.000Z`);await f.start();const first=await visible(f);seen.push(...first.queue.map(s=>s.wordId));for(let i=0;i<first.queue.length;i++){await rate(f);await next(f);}}assert.equal(seen.length,words.length);assert.equal(new Set(seen).size,words.length);assert.deepEqual([...seen].sort(),words.map(w=>w.id).sort());assert.deepEqual(seen,stableNewVocabularyOrder(words,'scene').map(w=>w.id));}finally{f.close();}
});
test('owner invalidation after a staged correction put aborts session, command and receipt together',async()=>{
 const {IDBObjectStore}=require('fake-indexeddb'),f=await fixture(),put=IDBObjectStore.prototype.put;try{await f.start();const s=await rate(f),before=plain(await f.service.exportWorkflow());IDBObjectStore.prototype.put=function(value,...args){const request=put.call(this,value,...args);if(value?.value?.correction?.status==='prepared')f.invalidate();return request;};assert.equal((await f.service.correctRating(zone,correction(s))).status,'blocked');assert.equal(f.writes,0);assert.deepEqual(plain(await f.service.repository.exportBackup()),before);}finally{IDBObjectStore.prototype.put=put;f.close();}
});
