const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {IDBFactory}=require('fake-indexeddb');
const loader=require('./helpers/actual-source-loader.cjs').createSourceLoader({root:path.resolve(__dirname,'..')});
const domain=loader.load('lib/practice-workflow.ts'),tasks=loader.load('lib/practice-task.ts');
const plain=v=>JSON.parse(JSON.stringify(v));
const q=(id,part=1)=>({id,part,title:id,prompt:'Choose.',options:['A','B','C','D'],correctIndex:0,explanation:'A',evidence:'A',skill:'detail',difficulty:'basic'});
const questions=[q('a'),q('b'),q('c',5),q('d',5)],scope={kind:'web-owner',ownerId:'synthetic-alice'};
async function setup(factory=new IDBFactory(),facts=new Map(),isCurrent=()=>true){const value=await domain.createPracticeWorkflow({scope,questions,timezone:'Asia/Shanghai',factory,name:'task-resume',isCurrent,legacy:{addAttempt:a=>{if(facts.has(a.id))assert.deepEqual(facts.get(a.id),plain(a));facts.set(a.id,plain(a));return true;},readAttempt:id=>facts.get(id),addCheckin:()=>true,readCheckin:()=>undefined},seenQuestionIds:()=>[...facts.values()].map(a=>a.qid)});return {value,factory,facts};}
const options=(part=1)=>({unitIds:[part===1?'question:a':'question:c'],task:{origin:{kind:'custom',part,count:2},label:'Part '+part},requestId:crypto.randomUUID()});
const state=async(v,id)=>(await v.readProjection()).sessions.find(s=>s.id===id);
async function start(v,rows,extra={}){const result=await v.start(rows,{...options(rows[0].part),unitIds:rows.map(q=>'question:'+q.id),...extra});assert(['started','restored'].includes(result.status),JSON.stringify(result));return result.sessionId;}
test('multiple unfinished v3 tasks survive reopening and resume original queues, answers and seconds',async()=>{
 const a=await setup(),id=await start(a.value,questions.slice(0,2));await a.value.submit(id,0,23,0);await a.value.next(id,0);const other=await start(a.value,questions.slice(2));const before=plain([...a.facts]);a.value.close();
 const b=await setup(a.factory,a.facts);assert.equal((await b.value.readProjection()).sessions.length,2);assert.equal((await b.value.resume(id)).status,'restored');assert.deepEqual(plain((await state(b.value,id)).questionIds),['a','b']);assert.equal((await state(b.value,id)).steps[0].attempt.seconds,23);assert.deepEqual(plain([...b.facts]),before);
 await b.value.submit(id,1,7,1);assert.equal((await b.value.next(id,1)).status,'applied');assert.equal((await b.value.readProjection()).activeSessionId,other);assert.equal((await state(b.value,other)).status,'active');b.value.close();
});
test('cross-connection same task creation deduplicates; explicit new and original request retry are distinct',async()=>{
 const a=await setup(),b=await setup(a.factory,a.facts),rows=questions.slice(0,2),base={...options(),unitIds:rows.map(q=>'question:'+q.id)};
 const results=await Promise.all([a.value.start(rows,base),b.value.start(rows,{...base,requestId:crypto.randomUUID()})]);assert.equal(results[0].sessionId,results[1].sessionId);
 const fresh={...base,mode:'new',requestId:crypto.randomUUID()},first=await a.value.start(rows,fresh),retry=await b.value.start(rows,fresh);assert.notEqual(first.sessionId,results[0].sessionId);assert.equal(retry.sessionId,first.sessionId);assert.equal((await a.value.readProjection()).sessions.length,2);a.value.close();b.value.close();
});
test('lost create response uses original requestID without duplicating group or learning facts',async()=>{
 const {value,facts}=await setup(),commit=value.repository.commit.bind(value.repository);let once=true;
 value.repository.commit=async command=>{const result=await commit(command);if(once&&result.status==='committed'){once=false;return {status:'unknown'};}return result;};
 const o={...options(),mode:'new'},a=await value.start([questions[0]],o);assert.equal(a.status,'unknown');const b=await value.start([questions[0]],o);assert.equal(b.status,'restored');assert.equal(a.sessionId,b.sessionId);assert.equal((await value.readProjection()).sessions.length,1);assert.equal(facts.size,0);value.close();
});
test('restart atomically preserves all facts and another active pointer, including unknown retry',async()=>{
 const {value,facts}=await setup(),id=await start(value,questions.slice(0,2));await value.submit(id,0,17,0);await value.next(id,0);const other=await start(value,questions.slice(2)),old=await state(value,id),before=plain([...facts]);
 const commit=value.repository.commit.bind(value.repository);let once=true;value.repository.commit=async c=>{const result=await commit(c);if(once&&c.commandId.startsWith('practice-restart:')&&result.status==='committed'){once=false;return {status:'unknown'};}return result;};
 const o={expectedRevision:old.revision,requestId:crypto.randomUUID()},a=await value.restart(id,o);assert.equal(a.status,'unknown');const b=await value.restart(id,o);assert.equal(b.status,'restored');assert.equal(a.sessionId,b.sessionId);
 assert.equal((await state(value,id)).status,'left');const fresh=await state(value,b.sessionId);assert.equal(fresh.restartOf,id);assert.equal(fresh.cursor,0);assert.equal(fresh.steps[0].initialSeen,true);assert.notEqual(fresh.chainId,old.chainId);assert.equal((await value.readProjection()).activeSessionId,other);assert.deepEqual(plain([...facts]),before);assert.equal((await value.readProjection()).sessions.length,3);value.close();
});
test('stale restart and rejected transaction cannot leave half a group or end the old group',async()=>{
 const {value}=await setup(),id=await start(value,[questions[0]]),old=await state(value,id);assert.equal((await value.restart(id,{requestId:crypto.randomUUID(),expectedRevision:old.revision+1})).status,'conflict');
 const commit=value.repository.commit.bind(value.repository);value.repository.commit=async()=>({status:'blocked',reason:'synthetic-quota'});assert.equal((await value.restart(id,{requestId:crypto.randomUUID(),expectedRevision:old.revision})).status,'blocked');assert.equal((await state(value,id)).status,'active');assert.equal((await value.readProjection()).sessions.length,1);value.repository.commit=commit;value.close();
});
test('v3 task metadata, multiple active rows and restart history pass full backup roundtrip',async()=>{
 const {value,facts}=await setup(),id=await start(value,[questions[0]]);await value.submit(id,0,13,0);await start(value,questions.slice(2));const restart=await value.restart(id,{requestId:crypto.randomUUID(),expectedRevision:(await state(value,id)).revision});assert.equal(restart.status,'started');
 const backup=await value.repository.exportBackup(),before=JSON.stringify(backup);assert.doesNotThrow(()=>domain.validatePracticeWorkflowBackup(backup,questions));assert.equal(JSON.stringify(backup),before);
 const b=await setup(new IDBFactory(),facts);assert.equal((await b.value.repository.restoreBackup(backup)).status,'committed');assert.equal((await b.value.readProjection()).sessions.length,3);assert.equal((await b.value.resume(restart.sessionId)).status,'restored');assert.equal(facts.size,1);value.close();b.value.close();
});
test('task origin/key and backup scope tampering fail closed without changing facts',async()=>{
 const {value}=await setup();await start(value,[questions[0]]);const backup=plain(await value.repository.exportBackup());
 for(const mutate of [r=>r.value.task.origin.part=5,r=>r.value.task.origin.unknown='bad',r=>r.value.task.key='forged']){const b=plain(backup);mutate(b.records.sessions.find(r=>r.value.kind==='practice-session'));assert.throws(()=>domain.validatePracticeWorkflowBackup(b,questions));}
 assert.throws(()=>domain.validatePracticeWorkflowBackup(backup,questions,'foreign-scope'));value.close();
});
test('origin lookup ignores dynamic selected queue while fixed key and saved counts remain exact',()=>{
 const origin={kind:'wrong',collection:'catalog',part:5,count:5},a=tasks.makePracticeTask(origin,'Wrong','catalog',['a'],['a']),b=tasks.makePracticeTask(origin,'Changed label','catalog',['b'],['b']);assert.notEqual(a.key,b.key);assert.equal(tasks.practiceTaskOriginKey(a.origin),tasks.practiceTaskOriginKey(b.origin));assert.equal(tasks.practiceSavedCount({steps:[{status:'applied'},{status:'pending'},{status:'unanswered'}]}),1);
});
