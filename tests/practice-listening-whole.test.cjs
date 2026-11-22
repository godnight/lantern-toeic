'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {IDBFactory}=require('fake-indexeddb');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..'),domainLoader=createSourceLoader({root});
const tasks=domainLoader.load('lib/practice-task.ts'),domain=domainLoader.load('lib/practice-workflow.ts');
const question=(id,part)=>({id,part,title:id,prompt:'Choose.',options:['A','B','C','D'],correctIndex:0,explanation:'A',evidence:'A',skill:'detail',difficulty:'basic'});
const nodes=(tree,predicate)=>{const found=[],todo=[tree];while(todo.length){const item=todo.shift();if(!item||typeof item!=='object')continue;if(Array.isArray(item)){todo.push(...item);continue;}if(predicate(item))found.push(item);todo.push(item.props?.children);}return found;};
const snapshot=value=>JSON.parse(JSON.stringify(value));

test('whole listening origin keeps Part and collection validation and stable existing task keys',()=>{
 const whole={kind:'listening',collection:'listening50'},part={kind:'listening',collection:'listening50',part:1};
 assert.doesNotThrow(()=>tasks.validatePracticeTaskOrigin(whole));
 for(const number of [1,2,3,4])assert.doesNotThrow(()=>tasks.validatePracticeTaskOrigin({...whole,part:number}));
 for(const invalid of [{kind:'listening'},{...whole,collection:''},...[0,5,7,8,1.5,undefined].map(value=>({...whole,part:value})),{...whole,other:'unexpected'}])assert.throws(()=>tasks.validatePracticeTaskOrigin(invalid),/practice-task-invalid/);
 const identity=tasks.makePracticeTask(part,'Part 1','v',['question:a'],['a']);
 assert.doesNotThrow(()=>tasks.validatePracticeTask(identity,'v',['question:a'],['a']));
 assert.equal(tasks.practiceTaskOriginKey(identity.origin),tasks.practiceTaskOriginKey(part));
 assert.notEqual(tasks.practiceTaskOriginKey(whole),tasks.practiceTaskOriginKey(part));
});

test('real listening page and task actions create, save and resume its exact 200-question collection',async()=>{
 const pool=Array.from({length:200},(_,index)=>question(`whole-${index+1}`,index%4+1));
 const outside=[question('other-listening',1),question('reading',5)],catalog=[...pool,...outside],factory=new IDBFactory(),facts=new Map();
 const options={scope:{kind:'web-owner',ownerId:'collection-owner'},questions:catalog,timezone:'Asia/Shanghai',factory,name:'whole-listening',legacy:{addAttempt:a=>{facts.set(a.id,snapshot(a));return true;},readAttempt:id=>facts.get(id),addCheckin:()=>true,readCheckin:()=>undefined}};
 let workflow=await domain.createPracticeWorkflow(options),pending;
 const fakeReact={useState:init=>[typeof init==='function'?init():init,()=>{}],useRef:init=>({current:init}),useEffect:()=>{}};
 const jsx=(type,props,key)=>({type,props,key}),icons=new Proxy({},{get:(_,name)=>String(name)});
 const loader=createSourceLoader({root,imports:{react:fakeReact,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':icons,'@/components/ui/tabs':icons,'@/components/ui/dialog':icons,'@/lib/study-model':{PARTS:['照片','应答','对话','独白','短句','长文','阅读'],createId:()=>crypto.randomUUID()},'@/lib/practice-history-browser':{},'@/lib/native-host':{},'@/lib/practice-selection':{practiceUnits:()=>[]},'@/lib/practice-task':tasks}});
 const {PracticeHome}=loader.load('app/learn/practice-home.tsx'),{PracticeTaskActions}=loader.load('app/learn/practice-records.tsx');
 const draw=sessions=>PracticeHome({questions:catalog,listening:pool,busy:false,tab:'lr',listeningFocused:true,practiceSessions:sessions,onTab(){},onPart(){},onCustom(){},onWrong(){},onListeningWrong(){},onMock(){},children:null,
  onStart:(rows,task)=>{pending=workflow.start(rows,{unitIds:rows.map(row=>'question:'+row.id),task,requestId:crypto.randomUUID()});},
  renderTaskAction:(origin,label,start,startLabel)=>PracticeTaskActions({origin,label,sessions,disabled:false,onNew:start,onResume:id=>{pending=workflow.resume(id);},onChoose:()=>assert.fail('unexpected multiple sessions'),onRestart:()=>assert.fail('unexpected restart'),startLabel})});
 let tree=draw([]),button=nodes(tree,n=>n.type==='button'&&n.props?.['aria-label']==='听力练习 · 开始本组')[0];assert(button,'real wrapped collection action is present');assert.equal(button.props.disabled,false);
 button.props.onClick();const started=await pending;assert.equal(started.status,'started');
 let projection=await workflow.readProjection(),session=projection.sessions.find(row=>row.id===started.sessionId);
 assert.equal(session.queue.length,200);assert.deepEqual(snapshot(session.questionIds),pool.map(row=>row.id));assert.deepEqual(snapshot(session.task.origin),{kind:'listening',collection:'listening50'});
 assert.equal((await workflow.submit(session.id,0,7,0)).status,'applied');workflow.close();
 workflow=await domain.createPracticeWorkflow(options);projection=await workflow.readProjection();session=projection.sessions.find(row=>row.id===started.sessionId);
 assert.equal(session.steps[0].status,'applied');assert.equal(session.steps[0].attempt.seconds,7);assert.equal(session.queue.length,200);
 tree=draw(projection.sessions);button=nodes(tree,n=>n.type==='button'&&n.props?.['aria-label']==='听力练习 · 继续')[0];assert(button,'real wrapped action offers resume');assert.equal(button.props.disabled,false);button.props.onClick();
 assert.equal((await pending).sessionId,started.sessionId);assert.equal((await pending).status,'restored');assert.equal(facts.size,1);workflow.close();
});

test('listening whole rejects reading questions and oversize queues without creating sessions',async()=>{
 const listening=Array.from({length:253},(_,index)=>question(`q-${index+1}`,index%4+1)),rows=[...listening,question('reading-only',5)];
 const workflow=await domain.createPracticeWorkflow({scope:{kind:'web-owner',ownerId:'blocked-owner'},questions:rows,timezone:'Asia/Shanghai',factory:new IDBFactory(),name:'blocked-listening',legacy:{addAttempt:()=>true,readAttempt:()=>undefined,addCheckin:()=>true,readCheckin:()=>undefined}});
 const start=queue=>workflow.start(queue,{unitIds:queue.map(row=>'question:'+row.id),task:{origin:{kind:'listening',collection:'listening50'},label:'听力练习'},requestId:crypto.randomUUID()});
 const mixed=await start([rows[0],rows[253]]);assert.equal(mixed.status,'blocked');assert.equal(mixed.reason,'practice-task-reference');
 for(const queue of [listening.slice(0,201),listening]){const oversize=await start(queue);assert.equal(oversize.status,'blocked');assert.equal(oversize.reason,'practice-queue-invalid');}
 assert.equal((await workflow.readProjection()).sessions.length,0);workflow.close();
});
