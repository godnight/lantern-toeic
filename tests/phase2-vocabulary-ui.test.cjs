// Real TSX with an isolated React/I/O adapter. Browser/ArkWeb layout, focus and
// native Back remain separate acceptance work; these cases verify UI commands.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const source=fs.readFileSync(path.join(root,'app/learn/vocabulary-plan.tsx'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const word={id:'quiet',word:'quiet',pos:'adj.',meaning:'安静的；轻声的',category:'office',example:'Keep the room quiet.',translation:'让房间保持安静。',collocation:''};
const words=[word,{...word,id:'available',word:'available'}];
const books=[{id:'scene',name:'托业场景词',capacity:2},{id:'expressions',name:'题内表达',capacity:1}];
const plan={id:'plan',schemaVersion:1,revision:1,createdAt:'2026-10-14T00:00:00.000Z',updatedAt:'2026-10-14T00:00:00.000Z',bookId:'scene',goal:2,dailyNew:15,weekdays:[1,2,3,4,5]};
const day={id:'day',localDate:'2026-10-14',timezone:'Etc/UTC',startAt:'2026-10-14T00:00:00.000Z',endAt:'2026-10-15T00:00:00.000Z'};
const receipt={commandId:'command',legacyEventId:'event',legacyPayloadHash:'fixed',occurredAt:'2026-10-14T00:01:00.000Z',rawRating:'known',intent:'new',ratingPolicy:'three-label-conservative-v1'};
function controller(overrides={}){
 const projection={plan,counts:{capacity:2,learned:0,remaining:2,reviewDue:0},daily:{window:day,newDone:0,reviewDone:0,newRemaining:2,reviewRemaining:0,newWordIds:['quiet','available'],reviewWordIds:[],goalCompleted:false,isLearningDay:true},activeSession:null,candidates:[],learnedWordIds:[]};
 return {scopeKey:'owner-a',ready:true,error:'',projection,activeSession:null,pendingRating:null,candidateStatus:()=> 'available-new',savePlan:async()=>({status:'applied'}),addCandidate:async()=>({status:'applied'}),startGroup:async()=>({status:'applied'}),submitRating:async()=>({status:'applied'}),nextStep:async()=>({status:'applied'}),exportWorkflow:async()=>({kind:'lantern-workflow',schemaVersion:1}),restoreWorkflow:async()=>({status:'applied'}),refresh:async()=>{},...overrides};
}
function session(){return {id:'session',schemaVersion:1,planRevision:1,dayWindow:day,createdAt:day.startAt,cursor:0,status:'active',queue:[{id:'step-1',wordId:word.id,word,intent:'new',reasons:[]}],currentStep:{id:'step-1',wordId:word.id,word,intent:'new',reasons:[]}};}
function nodes(tree,predicate){const result=[],queue=[tree];while(queue.length){const node=queue.shift();if(!node)continue;if(Array.isArray(node)){queue.push(...node);continue;}if(typeof node==='object'){if(predicate(node))result.push(node);queue.push(node.props?.children);}}return result;}
function text(node){return node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);}
function harness(componentName,initialProps){
 let slots=[],cursor=0,effects=[],tree,props=initialProps;const downloads=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
 const jsx=(type,props)=>typeof type==='function'&&['WorkflowNotice','ThemeScene','SpeechPlayer','InteractiveExample'].includes(type.name)?type(props):{type,props};
 const componentExports={};const imports={react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':new Proxy({},{get:()=>function Icon(){}}),'@/lib/vocabulary-model':{CATEGORIES:{office:'办公事务'}},'@/lib/workflow-catalog':{getWorkflowCatalog:id=>id==='expressions'?[words[1]]:words,WORKFLOW_BOOKS:books},'./interactive-example':{InteractiveExample:function InteractiveExample(p){return {type:'example',props:p};}},'./practice':{SpeechPlayer:function SpeechPlayer(){return {type:'audio',props:{}};}},'./ui-theme':{ThemeScene:function ThemeScene(p){return p.theme==='hollow'?{type:'figure',props:{'data-scene':p.scene}}:null;}}};
 vm.runInNewContext(code,{exports:componentExports,require:name=>{assert.ok(name in imports,name);return imports[name];},Set,Map,Date,Number,Math,JSON,Error,Promise,URL,Blob,setTimeout,clearTimeout,document:{createElement:()=>{const anchor={click(){downloads.push({href:anchor.href,download:anchor.download});}};return anchor;}}});
 function render(){cursor=0;tree=componentExports[componentName](props);const pending=effects;effects=[];pending.forEach(fn=>fn());return tree;}
 function button(label){return nodes(tree,node=>node.type==='button'&&text(node).trim()===label)[0];}
 render();render();
 return {exports:componentExports,downloads,get tree(){return tree;},render,update(next){props={...props,...next};render();render();},button,click(label){const node=button(label);assert.ok(node,'button: '+label);node.props.onClick?.();render();},async flush(){await tick();render();await tick();render();},unmount(){slots.forEach(value=>value?.cleanup?.());}};
}

test('invalid total goal takes priority over selected days; covered equality needs no new-word days',()=>{
 const h=harness('TodayVocabularyTask',{workflow:controller(),onOpen(){}}),evaluate=h.exports.evaluatePlanDraft;
 const projection=controller().projection;projection.learnedWordIds=['quiet'];
 for(const goal of [0,3,1.5,NaN]){const view=evaluate({...plan,goal},projection);assert.equal(view.valid,false);assert.equal(view.title,'请先修正总覆盖目标');}
 const covered=evaluate({...plan,goal:1,weekdays:[]},projection);assert.equal(covered.valid,true);assert.equal(covered.title,'总目标已覆盖');
 const noDays=evaluate({...plan,goal:2,weekdays:[]},projection);assert.equal(noDays.valid,false);assert.equal(noDays.title,'至少选择一个学习日');
 const normal=evaluate(plan,projection);assert.equal(normal.finish,'2026-10-14');h.unmount();
});

test('saved calendar follows its local-date window across a year boundary and never guesses past completion',()=>{
 const h=harness('TodayVocabularyTask',{workflow:controller(),onOpen(){}}),projection=controller().projection;
 projection.daily.window={...day,localDate:'2026-12-31',timezone:'Pacific/Kiritimati'};
 projection.plan={...plan,dailyNew:1,weekdays:[1,2,3,4,5,6,7]};projection.daily.reviewDone=9;
 const week=h.exports.planCalendarWeek(projection);
 assert.deepEqual(Array.from(week,row=>row.localDate),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
 assert.deepEqual(Array.from(week,row=>row.estimatedNew),[null,null,null,1,1,0,0]);
 assert.equal(week[3].isToday,true);assert.equal(week[6].weekday,7);assert.equal(projection.daily.reviewDone,9);h.unmount();
});

test('Sunday calendar and future estimates deduct only actual new learning, including when no days remain',()=>{
 const h=harness('TodayVocabularyTask',{workflow:controller(),onOpen(){}}),projection=controller().projection;
 projection.daily.window={...day,localDate:'2026-11-01',timezone:'America/New_York'};
 projection.plan={...plan,dailyNew:2,weekdays:[7]};projection.learnedWordIds=['quiet'];projection.daily.newDone=1;projection.daily.reviewDone=6;
 const week=h.exports.planCalendarWeek(projection),next=h.exports.planCalendarWeek(projection,1);
 assert.equal(week[0].localDate,'2026-10-26');assert.equal(week[6].localDate,'2026-11-01');assert.equal(week[6].estimatedNew,1);
 assert.equal(next.reduce((sum,row)=>sum+row.estimatedNew,0),0);
 projection.plan={...projection.plan,goal:1,weekdays:[]};assert.equal(h.exports.planCalendarWeek(projection)[6].estimatedNew,0);h.unmount();
});

test('unreadable workflow shows recovery without invented zero tasks or a start command',()=>{
 let starts=0;const workflow=controller({ready:false,error:'IndexedDB 已阻止读取',projection:null,startGroup:async()=>{starts++;return {status:'applied'};}});
 const h=harness('TodayVocabularyTask',{workflow,onOpen(){}});assert.match(text(h.tree),/IndexedDB 已阻止读取/);assert.doesNotMatch(text(h.tree),/待学新词|今日已完成/);assert.equal(h.button('开始今日词组'),undefined);assert.equal(starts,0);h.unmount();
});

test('the first plan has editable defaults and is not saved merely by opening the editor',async()=>{
 let saves=[];const workflow=controller();workflow.projection.plan=null;workflow.savePlan=async(draft,revision)=>{saves.push({draft,revision});return {status:'applied'};};
 const h=harness('VocabularyPlan',{workflow,theme:'paper'});assert.match(text(h.tree),/保存后才开始安排/);assert.equal(saves.length,0);h.click('建立我的计划');
 const numbers=nodes(h.tree,node=>node.type==='input'&&node.props.type==='number');assert.equal(numbers[0].props.value,2);assert.equal(numbers[1].props.value,15);assert.equal(saves.length,0);
 const days=nodes(h.tree,node=>node.type==='input'&&node.props.type==='checkbox');assert.deepEqual(days.map(node=>node.props.checked),[true,true,true,true,true,false,false]);
 const form=nodes(h.tree,node=>node.type==='form')[0];form.props.onSubmit({preventDefault(){}});await h.flush();assert.equal(saves.length,1);assert.equal(saves[0].revision,null);assert.equal(saves[0].draft.dailyNew,15);h.unmount();
});

test('Sunday is persisted as ISO weekday 7 and produces a Sunday estimate',async()=>{
 let saved;const workflow=controller();workflow.projection.plan=null;workflow.savePlan=async draft=>{saved=draft;return {status:'applied'};};
 const h=harness('VocabularyPlan',{workflow,theme:'paper'});h.click('建立我的计划');let days=nodes(h.tree,node=>node.type==='input'&&node.props.type==='checkbox');
 for(let index=0;index<5;index++){days[index].props.onChange({target:{checked:false}});h.render();days=nodes(h.tree,node=>node.type==='input'&&node.props.type==='checkbox');}
 days[6].props.onChange({target:{checked:true}});h.render();assert.match(text(h.tree),/预计 2026-10-18 覆盖新词/);
 nodes(h.tree,node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});await h.flush();assert.deepEqual(Array.from(saved.weekdays),[7]);h.unmount();
});

test('learned quiet can explicitly join review; candidate actions never mark learning complete',async()=>{
 const calls=[],workflow=controller({candidateStatus:()=> 'available-review',addCandidate:async(...args)=>{calls.push(args);return {status:'applied'};}});
 const h=harness('CandidateAction',{workflow,word});h.click('加入今日复习');await h.flush();assert.equal(calls.length,1);assert.equal(calls[0][0].id,'quiet');assert.equal(calls[0][1],'manual-review');assert.equal(workflow.projection.daily.reviewDone,0);assert.match(text(h.tree),/尚未计入已复习/);
 workflow.candidateStatus=()=> 'today-reviewed';h.render();assert.equal(h.button('今日已复习').props.disabled,true);h.click('今日已复习');await h.flush();assert.equal(calls.length,1);h.unmount();
});

test('failed feedback keeps the meaning hidden, locks the original rating and retries it before Next',async()=>{
 const active=session(),calls=[];let tries=0,next=0;
 const workflow=controller({activeSession:active,submitRating:async rating=>{calls.push(rating);if(++tries===1)return {status:'blocked',reason:'空间不足，原反馈保留'};active.currentStep.receipt={...receipt,rawRating:rating};return {status:'applied',receipt:active.currentStep.receipt};},nextStep:async()=>{next++;return {status:'applied'};}});
 const h=harness('VocabularyStudyCard',{workflow,theme:'paper'});assert.doesNotMatch(text(h.tree),/安静的；轻声的/);h.click('模糊');await h.flush();assert.doesNotMatch(text(h.tree),/安静的；轻声的/);assert.match(text(h.tree),/空间不足/);assert.equal(h.button('认识').props.disabled,true);assert.equal(h.button('忘记').props.disabled,true);assert.equal(next,0);
 h.click('模糊');await h.flush();assert.deepEqual(calls,['fuzzy','fuzzy']);assert.match(text(h.tree),/安静的；轻声的/);assert.equal(next,0);h.click('完成这一组');await h.flush();assert.equal(next,1);h.unmount();
});

test('a recovered prepared command displays its original rating and cannot switch to another answer',async()=>{
 const calls=[],workflow=controller({activeSession:session(),pendingRating:'forgotten',submitRating:async rating=>{calls.push(rating);return {status:'pending'};}});
 const h=harness('VocabularyStudyCard',{workflow,theme:'hollow'});assert.equal(h.button('认识').props.disabled,true);assert.equal(h.button('模糊').props.disabled,true);assert.equal(h.button('忘记').props.disabled,false);assert.match(text(h.tree),/待确认反馈：忘记/);h.click('认识');await h.flush();assert.equal(calls.length,0);h.click('忘记');await h.flush();assert.deepEqual(calls,['forgotten']);assert.doesNotMatch(text(h.tree),/安静的；轻声的/);h.unmount();
});

test('restored workflow without original word-card references cannot reveal, advance or rewrite a review',async()=>{
 const active=session();active.blockedReason='备份引用的旧词卡事件缺失';let writes=0,next=0,reads=0;
 const workflow=controller({activeSession:active,submitRating:async()=>{writes++;return {status:'applied'};},nextStep:async()=>{next++;return {status:'applied'};},refresh:async()=>{reads++;}});
 const h=harness('VocabularyStudyCard',{workflow,theme:'paper'});assert.match(text(h.tree),/备份引用的旧词卡事件缺失/);assert.doesNotMatch(text(h.tree),/安静的；轻声的|这一组，稳稳地完成了/);for(const label of ['认识','模糊','忘记']){assert.equal(h.button(label).props.disabled,true);h.click(label);}await h.flush();assert.equal(writes,0);assert.equal(next,0);h.click('重新核对词卡记录');await h.flush();assert.equal(reads,1);h.unmount();
});

test('lookup overlay keeps the revealed card and trigger component mounted but blocks grade and Next',async()=>{
 const active=session();active.currentStep.receipt=receipt;let next=0;
 const workflow=controller({activeSession:active,nextStep:async()=>{next++;return {status:'applied'};}});
 const h=harness('VocabularyStudyCard',{workflow,theme:'hollow',onExampleLookup(){}});const before=nodes(h.tree,node=>node.type==='example')[0];assert.equal(before.props.disabled,false);assert.match(text(h.tree),/安静的；轻声的/);
 h.update({overlayBlocked:true});const after=nodes(h.tree,node=>node.type==='example')[0];assert.equal(after.type,before.type);assert.equal(after.props.text,before.props.text);assert.equal(after.props.disabled,true);assert.equal(h.button('完成这一组').props.disabled,true);h.click('完成这一组');await h.flush();assert.equal(next,0);h.unmount();
});

test('a backup selected before scope changes never calls restore on either account',async()=>{
 let resolve,restores=0;const file={size:100,text:()=>new Promise(done=>resolve=done)},workflow=controller({restoreWorkflow:async()=>{restores++;return {status:'applied'};}});
 const h=harness('VocabularyPlan',{workflow,theme:'paper'});const input=nodes(h.tree,node=>node.type==='input'&&node.props.type==='file')[0];input.props.onChange({currentTarget:{files:[file],value:'backup.json'}});h.render();
 h.update({workflow:controller({scopeKey:'owner-b',restoreWorkflow:async()=>{restores++;return {status:'applied'};}})});resolve(JSON.stringify({kind:'lantern-workflow',schemaVersion:1}));await h.flush();assert.equal(restores,0);h.unmount();
});

test('workflow export uses the native allowlisted filename and names both vocabulary and practice workflows',async()=>{
 const workflow=controller();const h=harness('VocabularyPlan',{workflow,theme:'paper'});h.click('导出计划与未完成练习');await h.flush();assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].download,'lantern-workflow-backup.json');assert.match(text(h.tree),/单词计划与普通练习会话的工作流备份已生成/);h.unmount();
});

test('rest-day task separates due review from new words and opens only after a confirmed start',async()=>{
 let opened=0,starts=0;const workflow=controller();workflow.projection.daily.isLearningDay=false;workflow.projection.daily.newRemaining=0;workflow.projection.daily.reviewRemaining=3;workflow.startGroup=async()=>{starts++;return starts===1?{status:'unknown'}:{status:'applied'};};
 const h=harness('TodayVocabularyTask',{workflow,onOpen(){opened++;}});assert.match(text(h.tree),/今天是单词休息日/);h.click('开始今日词组');await h.flush();assert.equal(opened,0);assert.match(text(h.tree),/保存结果尚未确认/);h.click('开始今日词组');await h.flush();assert.equal(opened,1);assert.equal(workflow.projection.daily.newDone,0);h.unmount();
});
