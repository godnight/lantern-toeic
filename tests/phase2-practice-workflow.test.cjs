const assert=require('node:assert/strict'),test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..'),ts=require(path.join(root,'node_modules/typescript'));
const {IDBFactory,IDBObjectStore}=require('fake-indexeddb');
function load(file,imports={},globals={}){
 const exports={},code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{if(!Object.hasOwn(imports,name))return require('./helpers/actual-source-loader.cjs').createSourceLoader({permitLearningAccess:true,root,imports,globals:globals}).resolve(name,file);return imports[name];},Date,Intl,Map,Set,Error,JSON,Promise,Object,Number,Array,DataView,Uint8Array,Uint32Array,TextEncoder,structuredClone,crypto:crypto.webcrypto,...globals},{filename:file});return exports;
}
const canonical=load('lib/domain-command.ts'),storage=load('lib/learning-domain-repository.ts',{'./domain-command':canonical}),model=load('lib/study-model.ts');
const training=load('lib/practice-training.ts',{'./domain-command':canonical});
const workflow=load('lib/practice-workflow.ts',{'./domain-command':canonical,'./learning-domain-repository':storage,'./study-model':model,'./practice-training':training});
const plain=value=>JSON.parse(JSON.stringify(value));
const question=(id,extra={})=>({id,part:1,title:id,prompt:'Choose one.',options:['A','B','C','D'],correctIndex:0,explanation:'Because A.',evidence:'A',skill:'detail',difficulty:'basic',...extra});
const questions=[question('a'),question('b'),question('c',{part:3,groupId:'talk'}),question('d',{part:3,groupId:'talk'})];
const scope={kind:'web-owner',ownerId:'alice'},stamp='2026-10-14T23:59:59.000Z',draft={minutes:8,load:'刚好',note:'one manual confirmation'};
function legacy(){
 const attempts=new Map(),checkins=new Map(),state={attemptWrites:0,checkinWrites:0,attemptMode:'ok',checkinMode:'ok',readError:false};
 const read=(map,id)=>{if(state.readError)throw Error('journal-unavailable');return map.has(id)?plain(map.get(id)):undefined;};
 const write=(map,value,kind)=>{state[kind+'Writes']++;const mode=state[kind+'Mode'];if(mode==='fail')return false;if(mode==='throw')throw Error('legacy-write-failed');if(map.has(value.id)&&!canonical.canonicalJson(map.get(value.id)).includes('irrelevant')&&canonical.canonicalJson(map.get(value.id))!==canonical.canonicalJson(value))return false;map.set(value.id,plain(value));if(mode==='throw-after')throw Error('response-lost');return mode!=='false-after';};
 return {attempts,checkins,state,adapter:{addAttempt:value=>write(attempts,value,'attempt'),addCheckin:value=>write(checkins,value,'checkin'),readAttempt:id=>read(attempts,id),readCheckin:id=>read(checkins,id)}};
}
async function setup(options={}){
 const factory=options.factory||new IDBFactory(),facts=options.facts||legacy();
 const value=await workflow.createPracticeWorkflow({scope:options.scope||scope,questions:options.questions||questions,timezone:'Asia/Shanghai',factory,name:'practice-test',legacy:facts.adapter,now:options.now||(()=>new Date(stamp)),...options});
 return {value,factory,facts};
}
async function start(value,queue=[questions[0]],options={}){const result=await value.start(queue,{unitIds:[...new Set(queue.map(q=>q.groupId?`group:${q.part}:${q.groupId}`:`question:${q.id}`))],...options});assert.ok(['started','restored'].includes(result.status),JSON.stringify(result));return result.sessionId;}
async function session(value,id){return (await value.readProjection()).sessions.find(item=>item.id===id);}
async function complete(value,id,count=1){for(let cursor=0;cursor<count;cursor++){assert.ok(['applied','replayed'].includes((await value.submit(id,0,12,cursor)).status));assert.ok(['applied','replayed'].includes((await value.next(id,cursor)).status));}}

test('start reserves stable queue, complete units, first-seen flags and settlement identity without writing facts',async()=>{
 const {value,facts}=await setup(),id=await start(value,[questions[2],questions[3]],{initialSeenQids:['c']});
 const state=await session(value,id);assert.deepEqual(plain(state.questionIds),['c','d']);assert.deepEqual(plain(state.unitIds),['group:3:talk']);assert.equal(state.steps[0].initialSeen,true);assert.equal(state.steps[1].initialSeen,false);assert.notEqual(state.steps[0].attemptId,state.steps[1].attemptId);assert.match(state.settlement.checkinId,/^[0-9a-f-]{36}$/);assert.equal(facts.attempts.size,0);assert.equal(facts.checkins.size,0);
 assert.equal((await value.readProjection()).activeSessionId,id);value.close();
});
test('incomplete authored conversation and mismatched unit IDs are rejected before any session write',async()=>{
 const {value}=await setup();assert.equal((await value.start([questions[2]],{unitIds:['group:3:talk']})).status,'blocked');assert.equal((await value.start([questions[0]],{unitIds:['wrong']})).status,'blocked');assert.equal((await value.readProjection()).sessions.length,0);value.close();
});
test('submission reveals only after durable legacy confirmation; next is a separate persisted action',async()=>{
 const {value,facts,factory}=await setup(),id=await start(value,[questions[0],questions[1]],{initialSeenQids:['a']});
 const before=await session(value,id),result=await value.submit(id,0,17,0);assert.equal(result.status,'applied');
 const after=await session(value,id);assert.equal(after.cursor,0);assert.equal(after.steps[0].status,'applied');assert.equal(after.steps[0].attempt.mode,'review');assert.equal(after.steps[0].attempt.id,before.steps[0].attemptId);assert.equal(facts.attempts.size,1);
 assert.equal((await value.next(id,0)).status,'applied');value.close();const restarted=await setup({factory,facts});assert.equal((await session(restarted.value,id)).cursor,1);assert.equal((await restarted.value.resume(id)).status,'restored');restarted.value.close();
});
test('a failed legacy write keeps original choice, seconds and timestamp pending across a restart',async()=>{
 const {value,facts,factory}=await setup(),id=await start(value);facts.state.attemptMode='fail';
 assert.equal((await value.submit(id,2,41,0)).status,'pending');const pending=await session(value,id);assert.equal(pending.steps[0].choice,2);assert.equal(pending.steps[0].attempt,null);assert.equal(pending.cursor,0);assert.equal((await value.next(id,0)).status,'blocked');
 const stored=await value.repository.read('sessions',id),frozen=plain(stored.value.steps[0].pendingPayload);value.close();
 facts.state.attemptMode='ok';const restarted=await setup({factory,facts,now:()=>new Date('2026-10-16T12:00:00Z')});
 assert.equal((await restarted.value.submit(id,2,99,0)).status,'applied');assert.deepEqual(facts.attempts.get(frozen.id),frozen);assert.equal(facts.attempts.size,1);restarted.value.close();
});
test('prepared answer refuses a different choice; same original choice retries the frozen payload',async()=>{
 const {value,facts}=await setup(),id=await start(value);facts.state.attemptMode='fail';await value.submit(id,1,20,0);
 assert.equal((await value.submit(id,0,21,0)).reason,'practice-answer-frozen');assert.equal(facts.state.attemptWrites,1);facts.state.attemptMode='ok';assert.equal((await value.submit(id,1,44,0)).status,'applied');assert.equal([...facts.attempts.values()][0].seconds,20);value.close();
});
test('false after a successful journal write is confirmed by fresh read and counts once',async()=>{
 const {value,facts}=await setup(),id=await start(value);facts.state.attemptMode='false-after';assert.equal((await value.submit(id,0,9,0)).status,'applied');assert.equal((await value.submit(id,0,99,0)).status,'replayed');assert.equal(facts.attempts.size,1);assert.equal(facts.state.attemptWrites,1);value.close();
});
test('lost legacy response retains pending intent; explicit retry reads the original event instead of writing again',async()=>{
 const {value,facts}=await setup(),id=await start(value);facts.state.attemptMode='throw-after';assert.equal((await value.submit(id,0,15,0)).status,'pending');assert.equal((await session(value,id)).steps[0].status,'pending');facts.state.attemptMode='ok';assert.equal((await value.submit(id,0,60,0)).status,'applied');assert.equal(facts.state.attemptWrites,1);assert.equal(facts.attempts.size,1);value.close();
});
test('unreadable journal blocks analysis and next even if a write could have succeeded',async()=>{
 const {value,facts}=await setup(),id=await start(value);facts.state.readError=true;assert.equal((await value.submit(id,0,5,0)).status,'pending');assert.equal(facts.state.attemptWrites,0);assert.equal((await session(value,id)).steps[0].attempt,null);facts.state.readError=false;assert.equal((await value.submit(id,0,6,0)).status,'applied');value.close();
});
test('two real IDB connections starting together share one active session pointer',async()=>{
 const a=await setup(),b=await setup({factory:a.factory,facts:a.facts});
 const results=await Promise.all([a.value.start([questions[0]],{unitIds:['question:a']}),b.value.start([questions[1]],{unitIds:['question:b']})]);
 assert.equal(results.filter(result=>result.status==='started').length,1);assert.equal(results.filter(result=>result.status==='restored').length,1);assert.equal(results[0].sessionId,results[1].sessionId);assert.equal((await a.value.readProjection()).sessions.length,1);a.value.close();b.value.close();
});
test('two tabs submitting different choices freeze one original intent and one legacy fact',async()=>{
 const a=await setup(),id=await start(a.value),b=await setup({factory:a.factory,facts:a.facts});
 const results=await Promise.all([a.value.submit(id,0,10,0),b.value.submit(id,1,11,0)]);assert.equal(results.filter(result=>result.status==='applied').length,1);assert.equal(results.filter(result=>result.status==='conflict').length,1);assert.equal(a.facts.attempts.size,1);assert.equal((await session(a.value,id)).cursor,0);a.value.close();b.value.close();
});
test('double submit of the same choice and double next never duplicate facts or skip a question',async()=>{
 const a=await setup(),id=await start(a.value,[questions[0],questions[1]]),b=await setup({factory:a.factory,facts:a.facts});
 const submitted=await Promise.all([a.value.submit(id,0,10,0),b.value.submit(id,0,14,0)]);assert.ok(submitted.every(result=>['applied','replayed'].includes(result.status)),JSON.stringify(submitted));assert.equal(a.facts.attempts.size,1);
 const advanced=await Promise.all([a.value.next(id,0),b.value.next(id,0)]);assert.ok(advanced.every(result=>['applied','replayed'].includes(result.status)));assert.equal((await session(a.value,id)).cursor,1);assert.equal((await b.value.submit(id,2,15,0)).reason,'practice-cursor-changed');assert.equal(a.facts.attempts.size,1);a.value.close();b.value.close();
});
test('IDB abort during prepare leaves no legacy attempt and no prepared command',async()=>{
 const {value,facts}=await setup(),id=await start(value),original=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(data,...args){const result=original.call(this,data,...args);if(this.name==='sessions'&&data.id===id&&data.value.steps[0].status==='prepared')result.addEventListener('success',()=>this.transaction.abort());return result;};
 let result;try{result=await value.submit(id,0,5,0);}finally{IDBObjectStore.prototype.put=original;}
 assert.equal(result.status,'blocked');assert.equal(facts.attempts.size,0);assert.equal((await session(value,id)).steps[0].status,'unanswered');assert.equal((await value.repository.list('commands')).length,0);value.close();
});
test('IDB abort after legacy write keeps a pending answer; retry applies the same durable event',async()=>{
 const {value,facts}=await setup(),id=await start(value),original=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(data,...args){const result=original.call(this,data,...args);if(this.name==='sessions'&&data.id===id&&data.value.steps[0].status==='applied')result.addEventListener('success',()=>this.transaction.abort());return result;};
 let result;try{result=await value.submit(id,0,5,0);}finally{IDBObjectStore.prototype.put=original;}
 assert.equal(result.status,'blocked');assert.equal(facts.attempts.size,1);assert.equal((await session(value,id)).steps[0].status,'pending');assert.equal((await value.next(id,0)).status,'blocked');assert.equal((await value.submit(id,0,50,0)).status,'applied');assert.equal(facts.state.attemptWrites,1);value.close();
});
test('completing a group releases active pointer and preserves the old unsettled draft while continuing',async()=>{
 const {value}=await setup(),id=await start(value);await complete(value,id);await value.updateSettlementDraft(id,draft);
 const first=await session(value,id),nextId=await start(value,[questions[1]],{chainId:first.chainId});assert.notEqual(id,nextId);assert.equal((await value.readProjection()).activeSessionId,nextId);assert.equal((await value.readProjection()).pendingSettlements[0].id,id);assert.deepEqual(plain((await session(value,id)).settlement.draft),draft);
 assert.equal((await value.start([questions[0]],{unitIds:['question:a'],chainId:first.chainId})).status,'restored');await value.leave(nextId);assert.equal((await value.start([questions[0]],{unitIds:['question:a'],chainId:first.chainId})).reason,'practice-chain-unit-repeated');value.close();
});
test('settlement freezes one manual Checkin, never adds answer seconds, and survives lost response/restart',async()=>{
 const {value,facts,factory}=await setup(),id=await start(value);await complete(value,id);await value.updateSettlementDraft(id,draft);facts.state.checkinMode='throw-after';
 assert.equal((await value.settle(id,draft)).status,'pending');const raw=await value.repository.read('sessions',id),payload=plain(raw.value.settlement.pendingPayload);assert.equal(payload.minutes,8);assert.equal(payload.date,'2026-10-15');assert.equal(payload.id,(await session(value,id)).settlement.checkinId);value.close();
 facts.state.checkinMode='ok';const restarted=await setup({factory,facts,now:()=>new Date('2026-10-18T10:00:00Z')});assert.equal((await restarted.value.settle(id,draft)).status,'applied');assert.equal((await restarted.value.settle(id,draft)).status,'replayed');assert.equal((await restarted.value.settle(id,{...draft,minutes:9})).reason,'practice-settlement-frozen');assert.equal(facts.checkins.size,1);assert.equal(facts.state.checkinWrites,1);assert.deepEqual([...facts.checkins.values()][0],payload);assert.equal((await restarted.value.readProjection()).pendingSettlements.length,0);restarted.value.close();
});
test('settlement validates minutes and only completed or explicitly left sessions can be confirmed',async()=>{
 const {value}=await setup(),id=await start(value);assert.equal((await value.settle(id,draft)).reason,'practice-not-finished');await complete(value,id);
 for(const minutes of [0,241,1.5,NaN])assert.equal((await value.settle(id,{...draft,minutes})).status,'blocked');assert.equal((await value.settle(id,draft)).status,'applied');assert.equal((await value.updateSettlementDraft(id,draft)).status,'conflict');value.close();
});
test('restored applied metadata without original Study facts stays reference-unverified and never recreates facts',async()=>{
 const original=await setup(),id=await start(original.value);await complete(original.value,id);await original.value.settle(id,draft);const backup=await original.value.repository.exportBackup();original.value.close();
 const restored=await setup();assert.equal((await restored.value.repository.restoreBackup(backup)).status,'committed');const state=await session(restored.value,id);assert.equal(state.steps[0].status,'reference-unverified');assert.equal(state.steps[0].attempt,null);assert.equal(state.settlement.status,'reference-unverified');assert.equal((await restored.value.settle(id,draft)).status,'blocked');assert.equal(restored.facts.attempts.size,0);assert.equal(restored.facts.checkins.size,0);restored.value.close();
});
test('restored prepared intents do not execute on read; explicit retry reuses original payload and IDs',async()=>{
 const original=await setup(),id=await start(original.value);original.facts.state.attemptMode='fail';await original.value.submit(id,1,22,0);const backup=await original.value.repository.exportBackup(),raw=await original.value.repository.read('sessions',id),payload=plain(raw.value.steps[0].pendingPayload);original.value.close();
 const restored=await setup();await restored.value.repository.restoreBackup(backup);assert.equal((await session(restored.value,id)).steps[0].status,'pending');assert.equal(restored.facts.state.attemptWrites,0);assert.equal((await restored.value.submit(id,1,90,0)).status,'applied');assert.deepEqual([...restored.facts.attempts.values()][0],payload);restored.value.close();
});
test('applied answer loses its learning authority when durable original is missing or changed',async()=>{
 const {value,facts}=await setup(),id=await start(value);await value.submit(id,0,12,0);const [attemptId,attempt]=[...facts.attempts.entries()][0];facts.attempts.delete(attemptId);
 assert.equal((await session(value,id)).steps[0].status,'reference-unverified');assert.equal((await value.next(id,0)).reason,'reference-unverified');assert.equal((await value.submit(id,0,12,0)).reason,'reference-unverified');assert.equal(facts.state.attemptWrites,1);facts.attempts.set(attemptId,{...attempt,seconds:99});assert.equal((await value.submit(id,0,12,0)).reason,'reference-unverified');value.close();
});
test('owner, anonymous web and Harmony scopes cannot see or overwrite one another',async()=>{
 const a=await setup(),id=await start(a.value),scopes=[{kind:'web-owner',ownerId:'bob'},{kind:'web-local',partition:'existing-device'},{kind:'harmony-device',partition:'existing-device'}];
 for(const other of scopes){const b=await setup({factory:a.factory,facts:a.facts,scope:other});assert.equal((await b.value.readProjection()).sessions.length,0);assert.equal((await b.value.resume(id)).status,'blocked');b.value.close();}a.value.close();
});
test('identity change after prepare prevents any late legacy write or UI success',async()=>{
 let current=true;const {value,facts}=await setup({isCurrent:()=>current}),id=await start(value),commit=value.repository.commit.bind(value.repository);
 value.repository.commit=async command=>{const result=await commit(command);if(command.commandId.endsWith(':prepare'))current=false;return result;};
 assert.equal((await value.submit(id,0,12,0)).status,'blocked');assert.equal(facts.attempts.size,0);current=true;assert.equal((await session(value,id)).steps[0].status,'pending');value.close();
});
test('a changed catalog preserves frozen queue metadata and blocks answering with different content',async()=>{
 const original=await setup(),id=await start(original.value),factory=original.factory,facts=original.facts;original.value.close();
 const updated=await setup({factory,facts,questions:questions.map(q=>q.id==='a'?{...q,prompt:'Changed prompt'}:q)});assert.equal((await session(updated.value,id)).integrityError,'catalog-mismatch');assert.equal((await updated.value.submit(id,0,1,0)).reason,'catalog-mismatch');assert.equal(facts.attempts.size,0);updated.value.close();
});
test('quota or IDB unavailability yields blocked rather than ephemeral progress',async()=>{
 const value=await workflow.createPracticeWorkflow({scope,questions,timezone:'Asia/Shanghai',factory:{open(){throw Object.assign(Error('quota'),{name:'QuotaExceededError'});}},legacy:legacy().adapter});assert.equal((await value.start([questions[0]],{unitIds:['question:a']})).status,'blocked');value.close();
});
test('whole-backup preflight accepts prepared/applied history without touching legacy or storage',async()=>{
 const {value,facts}=await setup(),id=await start(value,[questions[0],questions[1]]);await value.submit(id,0,12,0);await value.next(id,0);facts.state.attemptMode='fail';await value.submit(id,1,18,1);
 const backup=await value.repository.exportBackup(),before=canonical.canonicalJson(backup),writes=facts.state.attemptWrites;
 assert.doesNotThrow(()=>workflow.validatePracticeWorkflowBackup(backup,questions,storage.workflowScopeKey(scope)));assert.equal(canonical.canonicalJson(backup),before);assert.equal(facts.state.attemptWrites,writes);
 assert.throws(()=>workflow.validatePracticeWorkflowBackup(backup,questions,storage.workflowScopeKey({kind:'web-owner',ownerId:'bob'})));value.close();
});
test('whole-backup preflight rejects malformed session, pointer, command links and historical snapshots',async()=>{
 const {value}=await setup(),id=await start(value);await complete(value,id);await value.settle(id,draft);const backup=plain(await value.repository.exportBackup());
 const checks=[b=>b.records.sessions.find(row=>row.id===id).value.cursor=9,b=>b.records.sessions.find(row=>row.id==='practice:active').value.sessionId='missing-session',b=>b.records.commands[0].value.stepId='wrong-step',b=>b.records.commands.pop(),b=>b.records.sessions.find(row=>row.id===id).value.settlement.pendingPayload.minutes=99,b=>b.records.sessions.find(row=>row.id===id).value.futureField=true,b=>b.commands[0].command.writes.find(row=>row.id===id).value.steps[0].attemptId=crypto.randomUUID(),b=>b.records.days.push({id:'practice:unexpected',revision:1,value:{kind:'practice-active',sessionId:null}})];
 for(const alter of checks){const changed=plain(backup);alter(changed);assert.throws(()=>workflow.validatePracticeWorkflowBackup(changed,questions));}assert.doesNotThrow(()=>workflow.validatePracticeWorkflowBackup(backup,questions));value.close();
});
test('whole-backup preflight rejects two sessions sharing one reserved attempt or checkin ID',async()=>{
 const {value}=await setup(),id=await start(value);await complete(value,id);await start(value,[questions[1]]);const backup=plain(await value.repository.exportBackup()),rows=backup.records.sessions.filter(row=>row.id!=='practice:active');
 const changed=plain(backup),sessions=changed.records.sessions.filter(row=>row.id!=='practice:active');sessions[1].value.steps[0].attemptId=sessions[0].value.steps[0].attemptId;assert.throws(()=>workflow.validatePracticeWorkflowBackup(changed,questions));rows[1].value.settlement.checkinId=rows[0].value.settlement.checkinId;assert.throws(()=>workflow.validatePracticeWorkflowBackup(backup,questions));value.close();
});
test('a completed session whose facts disappear cannot reopen, replay, settle, or start another group',async()=>{
 const {value,facts}=await setup(),id=await start(value);await complete(value,id);facts.attempts.clear();for(const action of [()=>value.resume(id),()=>value.next(id,0),()=>value.settle(id,draft),()=>value.start([questions[1]],{unitIds:['question:b']})])assert.equal((await action()).reason,'reference-unverified');assert.equal(facts.checkins.size,0);value.close();
});
test('restored applied session with matching original facts reconciles and can advance and settle',async()=>{
 const original=await setup(),id=await start(original.value);await original.value.submit(id,0,16,0);const backup=await original.value.repository.exportBackup(),facts=original.facts;original.value.close();const restored=await setup({facts});workflow.validatePracticeWorkflowBackup(backup,questions);await restored.value.repository.restoreBackup(backup);assert.equal((await restored.value.next(id,0)).status,'applied');assert.equal((await restored.value.settle(id,draft)).status,'applied');assert.equal(facts.attempts.size,1);assert.equal(facts.checkins.size,1);assert.equal((await restored.value.start([questions[1]],{unitIds:['question:b']})).status,'started');restored.value.close();
});
test('two tabs confirming different drafts create exactly one fixed Checkin',async()=>{
 const a=await setup(),id=await start(a.value);await complete(a.value,id);const b=await setup({factory:a.factory,facts:a.facts});const results=await Promise.all([a.value.settle(id,draft),b.value.settle(id,{...draft,minutes:11})]);assert.equal(results.filter(result=>result.status==='applied').length,1);assert.equal(results.filter(result=>result.status==='conflict').length,1);assert.equal(a.facts.checkins.size,1);assert.equal(a.facts.state.checkinWrites,1);a.value.close();b.value.close();
});
test('projection retries a read straddling atomic start instead of reporting a corrupt pointer',async()=>{
 const {value}=await setup(),original=value.repository.list.bind(value.repository);let injected=false;value.repository.list=async collection=>{if(collection==='sessions'&&!injected){injected=true;await start(value);}return original(collection);};const projection=await value.readProjection();assert.equal(projection.sessions.length,1);assert.equal(projection.activeSessionId,projection.sessions[0].id);value.close();
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function hookHarness({factory=new IDBFactory(),facts=legacy(),allowed=true}={}){
 let slots=[],cursor=0,effects=[],options={owner:'alice',nativeMode:false,ready:true,timezone:'Asia/Shanghai',questions,attempts:[],legacy:facts.adapter},opens=0,available=allowed,readFailure=false;
 const listeners=new Map(),sameDeps=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
 const react={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value];},useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},useEffect(fn,deps){const index=cursor++;if(!slots[index]||!sameDeps(slots[index].deps,deps)){const prior=slots[index];slots[index]={deps};effects.push(()=>{prior?.cleanup?.();slots[index].cleanup=fn();});}}};
 const api=load('lib/use-practice-workflow.ts',{react,'./learning-domain-repository':storage,'./practice-workflow':{...workflow,createPracticeWorkflow:async input=>{opens++;const value=await workflow.createPracticeWorkflow({...input,factory:available?factory:{open(){throw Error('initially-unavailable');}},name:'practice-test'});const read=value.readProjection.bind(value);value.readProjection=()=>readFailure?Promise.reject(Error('temporarily-unavailable')):read();return value;}}},{window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}});
 const render=changes=>{options={...options,...changes};cursor=0;const result=api.usePracticeWorkflow(options),batch=effects;effects=[];batch.forEach(fn=>fn());return result;};
 const flush=async predicate=>{let result;for(let i=0;i<35;i++){await tick();result=render();if(predicate(result))return result;}throw Error('hook did not reach requested state: '+JSON.stringify({ready:result?.ready,error:result?.error}));};
 return {render,flush,get opens(){return opens;},enable(){available=true;},failReads(){readFailure=true;},recoverReads(){readFailure=false;},fire(name){listeners.get(name)?.();},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
test('hook loads durable sessions without forcing practice open; resume and closeView preserve them',async()=>{
 const initial=await setup(),id=await start(initial.value);initial.value.close();const h=hookHarness({factory:initial.factory,facts:initial.facts});h.render();let api=await h.flush(value=>value.ready);assert.equal(api.session,null);assert.equal(api.sessions.length,1);await api.resume(id);api=h.render();assert.equal(api.session.id,id);await api.closeView();api=h.render();assert.equal(api.session,null);assert.equal(api.sessions.length,1);h.unmount();
});
test('public refresh reopens failed initialization; background invalidation never spins initialization',async()=>{
 const h=hookHarness({allowed:false});h.render();let api=await h.flush(value=>!!value.error);assert.equal(h.opens,1);h.fire('focus');await tick();h.render();h.fire('storage');await tick();api=h.render();assert.equal(h.opens,1);assert.equal(api.ready,false);h.enable();await api.refresh();h.render();api=await h.flush(value=>value.ready);assert.equal(h.opens,2);assert.equal(api.session,null);assert.equal(api.sessions.length,0);h.unmount();
});

test('same-scope read/reopen failures preserve the visible session; owner switch immediately removes it',async()=>{
 const initial=await setup(),id=await start(initial.value);initial.value.close();const h=hookHarness({factory:initial.factory,facts:initial.facts});h.render();let api=await h.flush(value=>value.ready);await api.resume(id);api=h.render();h.failReads();h.fire('focus');api=await h.flush(value=>!!value.error);assert.equal(api.ready,false);assert.equal(api.session.id,id);assert.equal((await api.submit(0,4)).status,'blocked');assert.equal(initial.facts.attempts.size,0);await api.refresh();h.render();api=await h.flush(value=>!!value.error);assert.equal(api.session.id,id);h.recoverReads();await api.refresh();h.render();api=await h.flush(value=>value.ready);assert.equal(api.session.id,id);api=h.render({owner:'bob'});assert.equal(api.session,null);assert.equal(api.sessions.length,0);h.unmount();
});
test('an operation queued before a known projection failure cannot advance after the failure',async()=>{
 const initial=await setup(),id=await start(initial.value,[questions[0],questions[1]]);initial.value.close();const h=hookHarness({factory:initial.factory,facts:initial.facts});h.render();let api=await h.flush(value=>value.ready);await api.resume(id);api=h.render();h.failReads();const [answer,next]=await Promise.all([api.submit(0,5),api.next(0)]);assert.equal(answer.status,'applied');assert.equal(next.status,'blocked');assert.equal(initial.facts.attempts.size,1);h.recoverReads();api=h.render();await api.refresh();h.render();api=await h.flush(value=>value.ready);assert.equal(api.session.cursor,0);h.unmount();
});
