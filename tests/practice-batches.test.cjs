const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {IDBFactory}=require('fake-indexeddb');
const loader=require('./helpers/actual-source-loader.cjs').createSourceLoader({root:path.resolve(__dirname,'..')});
const {createPracticeWorkflow,validatePracticeWorkflowBackup}=loader.load('lib/practice-workflow.ts');
const {partitionPracticeBatch}=loader.load('lib/practice-batches.ts');
const plain=x=>JSON.parse(JSON.stringify(x));
const q=(i,groupId)=>({id:'q'+String(i).padStart(3,'0'),part:1,title:'Question '+i,prompt:'Choose.',options:['A','B','C','D'],correctIndex:0,explanation:'A',evidence:'A',skill:'detail',difficulty:'basic',...(groupId?{groupId}:{})});
const questions=Array.from({length:203},(_,i)=>q(i+1,i>=199&&i<=201?'material-1':undefined));
const origin={kind:'wrong',collection:'all',count:200};
const facts=new Map();
async function open(factory,owner='synthetic-a',rows=questions,compatible=[]){return createPracticeWorkflow({scope:{kind:'web-owner',ownerId:owner},questions:rows,compatibleQuestionCatalogs:compatible,timezone:'Asia/Shanghai',factory,name:'batch-test',legacy:{addAttempt:a=>{facts.set(a.id,plain(a));return true;},readAttempt:id=>facts.get(id),addCheckin:()=>true,readCheckin:()=>undefined}});}
test('complete authored materials stay together across a 200 boundary',()=>{const groups=plain(partitionPracticeBatch(questions));assert.deepEqual(groups.map(x=>x.questionIds.length),[199,4]);assert.deepEqual(groups.flatMap(x=>x.questionIds),questions.map(x=>x.id));assert.deepEqual(groups[1].questionIds.slice(0,3),['q200','q201','q202']);});
test('arbitrary group first persists atomic full plan, saved answer and original snapshot on reopen despite changed wrong pool',async()=>{
 const factory=new IDBFactory(),a=await open(factory),r=await a.openBatch(origin,'Wrong',questions,2,crypto.randomUUID());assert.equal(r.status,'started',JSON.stringify(r));
 let projection=await a.readProjection();assert.equal(projection.batchPlans.length,1);assert.deepEqual(plain(projection.batchPlans[0].groups.map(g=>g.questionIds.length)),[199,4]);assert.equal(projection.sessions[0].task.origin.batchIndex,2);
 assert.equal((await a.submit(r.sessionId,0,1,0)).status,'applied');await a.next(r.sessionId,0);a.close();
 const b=await open(factory),next=await b.openBatch(origin,'Wrong',questions.slice(10),1,crypto.randomUUID());assert.equal(next.status,'started',JSON.stringify(next));projection=await b.readProjection();assert.equal(projection.sessions.length,2);assert.deepEqual(plain(projection.sessions.find(x=>x.id===next.sessionId).questionIds),questions.slice(0,199).map(q=>q.id));
 const resumed=await b.openBatch(origin,'Wrong',[],2,crypto.randomUUID());assert.equal(resumed.sessionId,r.sessionId);assert.equal((await b.readProjection()).sessions.find(x=>x.id===r.sessionId).steps[0].status,'applied');b.close();
});
test('concurrent creation yields one immutable plan and one session; rejected transaction leaves no partial plan',async()=>{
 const f=new IDBFactory(),a=await open(f),b=await open(f);const [x,y]=await Promise.all([a.openBatch(origin,'Wrong',questions,1,crypto.randomUUID()),b.openBatch(origin,'Wrong',questions,1,crypto.randomUUID())]);assert.equal(x.sessionId,y.sessionId,JSON.stringify([x,y]));let projection=await a.readProjection();assert.equal(projection.batchPlans.length,1);assert.equal(projection.sessions.length,1);a.close();b.close();
 const c=await open(new IDBFactory());c.repository.commit=async()=>({status:'blocked',reason:'quota'});assert.equal((await c.openBatch(origin,'Wrong',questions,1,crypto.randomUUID())).status,'blocked');projection=await c.readProjection();assert.equal(projection.batchPlans.length,0);assert.equal(projection.sessions.length,0);c.close();
});
test('backup validates batch plans, session references and immutable receipt snapshots; restore preserves source',async()=>{
 const a=await open(new IDBFactory()),r=await a.openBatch(origin,'Wrong',questions,2,crypto.randomUUID());assert.equal(r.status,'started');const backup=plain(await a.repository.exportBackup());assert.doesNotThrow(()=>validatePracticeWorkflowBackup(backup,questions));
 for(const mutate of [b=>b.records.sessions.find(x=>x.value.kind==='practice-batch-plan').value.groups[0].questionIds.reverse(),b=>b.records.sessions.find(x=>x.value.kind==='practice-session').value.task.origin.batchIndex=1,b=>b.records.sessions=b.records.sessions.filter(x=>x.value.kind!=='practice-batch-plan')]){const copy=plain(backup);mutate(copy);assert.throws(()=>validatePracticeWorkflowBackup(copy,questions));}
 const b=await open(new IDBFactory());assert.equal((await b.repository.restoreBackup(backup)).status,'committed');assert.equal((await b.openBatch(origin,'Wrong',[],1,crypto.randomUUID())).status,'started');assert.equal((await b.readProjection()).batchPlans.length,1);a.close();b.close();
});
test('scope and unknown plan catalog remain isolated and fail closed',async()=>{
 const f=new IDBFactory(),a=await open(f);await a.openBatch(origin,'Wrong',questions,1,crypto.randomUUID());const other=await open(f,'synthetic-b');assert.equal((await other.readProjection()).batchPlans.length,0);assert.equal((await other.openBatch(origin,'Wrong',[],1,crypto.randomUUID())).status,'blocked');a.close();other.close();
 const changed=questions.map((q,i)=>i? q:{...q,title:'changed'}),b=await open(f,'synthetic-a',changed);const before=await b.readProjection();assert.equal(before.batchPlans[0].integrityError,'catalog-mismatch');assert.equal((await b.openBatch(origin,'Wrong',[],2,crypto.randomUUID())).status,'blocked');assert.equal((await b.readProjection()).sessions.length,1);b.close();
});

test('finishing one planned group starts the remaining snapshot and never reuses old ungrouped origin',async()=>{
 const f=new IDBFactory(),a=await open(f),old=await a.start([questions[0]],{unitIds:['question:q001'],task:{origin,label:'Old wrong'},requestId:crypto.randomUUID()});assert.equal(old.status,'started');
 const second=await a.openBatch(origin,'Wrong',questions,2,crypto.randomUUID());assert.notEqual(second.sessionId,old.sessionId);
 for(let i=0;i<4;i++){assert.equal((await a.submit(second.sessionId,0,1,i)).status,'applied');assert.equal((await a.next(second.sessionId,i)).status,'applied');}
 assert.equal((await a.readProjection()).sessions.find(x=>x.id===second.sessionId).status,'completed');
 assert.equal((await a.openBatch(origin,'Wrong',[],2,crypto.randomUUID())).reason,'practice-batch-already-completed');
 const first=await a.openBatch(origin,'Wrong',[],1,crypto.randomUUID());assert.equal(first.status,'started');const view=await a.readProjection();assert.equal(view.sessions.find(x=>x.id===first.sessionId).questionIds.length,199);assert.equal(view.sessions.find(x=>x.id===old.sessionId).task.origin.batchId,undefined);
 const bad=await a.start([questions[0]],{unitIds:['question:q001'],task:{origin:{...origin,batchId:view.batchPlans[0].id,batchIndex:2},label:'Forged'},requestId:crypto.randomUUID()});assert.equal(bad.reason,'practice-batch-use-plan');a.close();
});
test('older planned catalog remains pinned after an append, including not-yet-opened group',async()=>{
 const f=new IDBFactory(),a=await open(f);const second=await a.openBatch(origin,'Wrong',questions,2,crypto.randomUUID());assert.equal(second.status,'started');a.close();
 const newer=[...questions,...[204,205,206].map(i=>q(i))],b=await open(f,'synthetic-a',newer,[questions]);const first=await b.openBatch(origin,'Wrong',[],1,crypto.randomUUID());assert.equal(first.status,'started',JSON.stringify(first));const view=await b.readProjection();assert.equal(view.sessions.find(s=>s.id===first.sessionId).catalogVersion,view.batchPlans[0].catalogVersion);assert.deepEqual(plain(view.batchPlans[0].groups.flatMap(g=>g.questionIds)),questions.map(q=>q.id));
 const backup=await b.repository.exportBackup();assert.doesNotThrow(()=>validatePracticeWorkflowBackup(backup,newer,undefined,[questions]));b.close();
});

test('actual 325 catalog partitions all 265 listening questions without loss and preserves legacy 200 origin',async()=>{
 const catalog=loader.load('lib/question-catalog.ts'),all=catalog.QUESTIONS.filter(q=>q.part<=4),groups=partitionPracticeBatch(all);assert.equal(all.length,265);assert.deepEqual(plain(groups.map(g=>g.questionIds.length)),[200,65]);assert.deepEqual(plain(groups.flatMap(g=>g.questionIds)),plain(all.map(q=>q.id)));
 const legacy={addAttempt:a=>{facts.set(a.id,plain(a));return true;},readAttempt:id=>facts.get(id),addCheckin:()=>true,readCheckin:()=>undefined},v=await createPracticeWorkflow({scope:{kind:'web-owner',ownerId:'real-catalog-isolated'},questions:catalog.QUESTIONS,compatibleQuestionCatalogs:catalog.PRACTICE_QUESTION_CATALOGS,timezone:'Asia/Shanghai',factory:new IDBFactory(),name:'batch-real',legacy});
 const source=catalog.LISTENING_COLLECTION_QUESTIONS,unitIds=loader.load('lib/practice-selection.ts').practiceUnits(source).map(u=>u.id),old=await v.start(source,{unitIds,task:{origin:{kind:'listening',collection:'listening50'},label:'听力练习'},requestId:crypto.randomUUID()});assert.equal(old.status,'started',JSON.stringify(old));
 const first=await v.openBatch({kind:'listening',collection:'all'},'听力练习',all,1,crypto.randomUUID());assert.equal(first.status,'started',JSON.stringify(first));const view=await v.readProjection();assert.equal(view.sessions.find(s=>s.id===old.sessionId).questionIds.length,200);assert.deepEqual(plain(view.batchPlans[0].groups.flatMap(g=>g.questionIds)),plain(all.map(q=>q.id)));assert.notEqual(first.sessionId,old.sessionId);v.close();
});
