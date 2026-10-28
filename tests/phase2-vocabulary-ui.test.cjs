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
const referenceFixture={schemaVersion:1,sources:{dictionary:{label:'合成词典来源',url:'https://example.test/dictionary',wordUrlPattern:'https://example.test/word/{word}',license:'CC-BY-SA-4.0',licenseUrl:'https://example.test/license',attribution:'合成测试来源'}},entries:{quiet:{phonetics:['/qa-primary/','/qa-variant/'],etymology:'合成构词资料_QUIET',phoneticSource:'dictionary',etymologySource:'dictionary',phoneticSourceUrl:'https://example.test/word/quiet?oldid=123'},available:{phonetics:['/qa-next/'],etymology:'合成构词资料_AVAILABLE',phoneticSource:'dictionary',etymologySource:'dictionary'}}};

const books=[{id:'scene',name:'托业场景词',capacity:2},{id:'expressions',name:'题内表达',capacity:1},{id:'general-base-1.2',name:'通用基础',capacity:2},{id:'combined-with-supplement-1.2',name:'托业备考',capacity:2}];
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
function harness(componentName,initialProps,references=referenceFixture){
 let slots=[],cursor=0,effects=[],tree,props=initialProps;const downloads=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
 react.useSyncExternalStore=(_subscribe,read)=>read();
 const jsx=(type,props)=>typeof type==='function'&&['WorkflowNotice','ThemeScene','SpeechPlayer','InteractiveExample','VocabularyPlanEditor','PlanExitPrompt'].includes(type.name)?type(props):{type,props};
 const componentExports={};const imports={react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':new Proxy({},{get:()=>function Icon(){}}),'@/lib/vocabulary-model':{CATEGORIES:{office:'办公事务'}},'@/lib/workflow-catalog':{getWorkflowCatalog:id=>id==='expressions'?[words[1]]:words,WORKFLOW_BOOKS:books,getWorkflowBook:id=>{const book=books.find(row=>row.id===id);assert.ok(book);return book;},getCandidateLearningWord:row=>words.find(current=>current.id===row.id)??null},'./interactive-example':{InteractiveExample:function InteractiveExample(p){return {type:'example',props:p};}},'./practice':{SpeechPlayer:function SpeechPlayer(){return {type:'audio',props:{}};}},'./ui-theme':{ThemeScene:function ThemeScene(p){return p.theme==='hollow'?{type:'figure',props:{'data-scene':p.scene}}:null;}}};
 imports['@/lib/vocabulary-workflow']=require('./helpers/actual-source-loader.cjs').createSourceLoader({root,imports:{'./workflow-catalog':imports['@/lib/workflow-catalog']}}).load('lib/vocabulary-workflow.ts');
 imports['@/lib/word-audio-bindings-v040']={getWordAudioBindingForSnapshot:()=>null,isPrivateWordAudioBlocked:()=>false,PRIVATE_AUDIO_LABEL:'Synthetic no playback'};
 imports['@/lib/lesson-audio']={naturalAudioRegistry:{pinSelectors:async()=>({release(){}})},subscribeProductLessonAudio:()=>()=>{},productLessonAudioState:()=>({phase:'ready'})};
 imports['./word-card-reference']=require('./helpers/actual-source-loader.cjs').createSourceLoader({root,imports:{'@/content/word-card-reference.json':{__esModule:true,default:references}}}).load('app/learn/word-card-reference.ts');
 imports['./v041-vocabulary.css']={};
 imports['./plan-editor-state']=require('./helpers/actual-source-loader.cjs').createSourceLoader({root,imports,globals:{document:{activeElement:null},HTMLElement:class HTMLElement{},requestAnimationFrame:fn=>fn()}}).load('app/learn/plan-editor-state.tsx');
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
 const h=harness('VocabularyPlan',{workflow,theme:'paper'});assert.match(text(h.tree),/制定单词计划/);assert.equal(saves.length,0);const choices=nodes(h.tree,node=>node.type==='input'&&node.props.type==='radio');assert.deepEqual(choices.map(node=>node.props.value),['general-base-1.2','combined-with-supplement-1.2']);
 const numbers=nodes(h.tree,node=>node.type==='input'&&node.props.type==='number');assert.equal(numbers[0].props.value,2);assert.equal(numbers[1].props.value,15);assert.equal(saves.length,0);
 const days=nodes(h.tree,node=>node.type==='input'&&node.props.type==='checkbox');assert.deepEqual(days.map(node=>node.props.checked),[true,true,true,true,true,false,false]);
 const form=nodes(h.tree,node=>node.type==='form')[0];form.props.onSubmit({preventDefault(){}});await h.flush();assert.equal(saves.length,1);assert.equal(saves[0].revision,null);assert.equal(saves[0].draft.dailyNew,15);h.unmount();
});

test('Sunday is persisted as ISO weekday 7 and produces a Sunday estimate',async()=>{
 let saved;const workflow=controller();workflow.projection.plan=null;workflow.savePlan=async draft=>{saved=draft;return {status:'applied'};};
 const h=harness('VocabularyPlan',{workflow,theme:'paper'});let days=nodes(h.tree,node=>node.type==='input'&&node.props.type==='checkbox');
 for(let index=0;index<5;index++){days[index].props.onChange({target:{checked:false}});h.render();days=nodes(h.tree,node=>node.type==='input'&&node.props.type==='checkbox');}
 days[6].props.onChange({target:{checked:true}});h.render();assert.match(text(h.tree),/预计 2026-10-18 覆盖新词/);
 nodes(h.tree,node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});await h.flush();assert.deepEqual(Array.from(saved.weekdays),[7]);h.unmount();
});

test('learned quiet can explicitly join review; candidate actions never mark learning complete',async()=>{
 const calls=[],workflow=controller({candidateStatus:()=> 'available-review',addCandidate:async(...args)=>{calls.push(args);return {status:'applied'};}});
 const h=harness('CandidateAction',{workflow,word});h.click('加入今日复习');await h.flush();assert.equal(calls.length,1);assert.equal(calls[0][0].id,'quiet');assert.equal(calls[0][1],'manual-review');assert.equal(workflow.projection.daily.reviewDone,0);assert.match(text(h.tree),/尚未计入已复习/);
 workflow.candidateStatus=()=> 'today-reviewed';h.render();assert.equal(h.button('今日已复习').props.disabled,true);h.click('今日已复习');await h.flush();assert.equal(calls.length,1);h.unmount();
});

test('all reference phonetics stay visible before and after each rating; etymology is revealed only after saving',async()=>{
 for(const [rating,label] of [['known','认识'],['fuzzy','模糊'],['forgotten','忘记']]){
  const active=session(),snapshot=JSON.stringify(active.currentStep.word),calls=[];
  const workflow=controller({activeSession:active,submitRating:async value=>{calls.push(value);active.currentStep.receipt={...receipt,rawRating:value};return {status:'applied'};}});
  const h=harness('VocabularyStudyCard',{workflow,theme:'paper'});
  const phonetic=()=>nodes(h.tree,node=>node.props?.className==='word-phonetic')[0];
  assert.equal(text(phonetic()),'/qa-primary/ · /qa-variant/');
  assert.doesNotMatch(text(h.tree),/合成构词资料_QUIET|参考来源/);
  h.click(label);await h.flush();
  assert.deepEqual(calls,[rating]);assert.equal(text(phonetic()),'/qa-primary/ · /qa-variant/');
  assert.match(text(h.tree),/词源与构词参考.*合成构词资料_QUIET/);
  assert.doesNotMatch(text(h.tree),/参考来源|合成词典来源|合成测试来源/);
  assert.equal(nodes(h.tree,node=>node.type==='details'&&node.props.className?.includes('phase2-word-reference-sources')).length,0);
  assert.equal(JSON.stringify(active.currentStep.word),snapshot,'Display enrichment changed the saved word');
  h.unmount();
 }
});

test('existing word reference fields retain priority without modifying the snapshot',()=>{
 const active=session();active.currentStep.word={...word,phonetics:[' /saved-one/ ','/saved-two/'],etymology:'原词卡构词参考'};
 active.currentStep.receipt=receipt;const snapshot=JSON.stringify(active.currentStep.word);
 const h=harness('VocabularyStudyCard',{workflow:controller({activeSession:active}),theme:'paper'});
 assert.match(text(h.tree),/\/saved-one\/ · \/saved-two\//);assert.match(text(h.tree),/原词卡构词参考/);
 assert.doesNotMatch(text(h.tree),/qa-primary|合成构词资料_QUIET|合成词典来源/);
 assert.equal(JSON.stringify(active.currentStep.word),snapshot);h.unmount();
});

test('reference lookup changes with the exact headword and does not stem or invent missing entries',()=>{
 const active=session();active.currentStep.word={...word,word:'  QUIET  '};active.currentStep.receipt=receipt;
 const h=harness('VocabularyStudyCard',{workflow:controller({activeSession:active}),theme:'paper'});
 assert.match(text(h.tree),/qa-primary/);assert.match(text(h.tree),/合成构词资料_QUIET/);
 active.currentStep={...active.currentStep,id:'step-next',word:{...word,id:'available',word:'available'},receipt:undefined};h.render();
 assert.match(text(h.tree),/qa-next/);assert.doesNotMatch(text(h.tree),/qa-primary|合成构词资料_QUIET|合成构词资料_AVAILABLE/);
 active.currentStep={...active.currentStep,id:'step-missing',word:{...word,word:'quietly'},receipt};h.render();
 assert.match(text(h.tree),/暂无音标/);assert.doesNotMatch(text(h.tree),/qa-primary|词源与构词参考|参考来源/);
 h.unmount();
});

test('the known CV card replaces stale verb IPA only with its reviewed noun reference and never mutates the snapshot',()=>{
 const cv={...word,id:'v-resume',word:'resume',pos:'名词',meaning:'简历（美式英语，也写作 résumé）',phonetics:['/qa-old-verb/'],etymology:'旧混合动词资料'};
 const references=structuredClone(referenceFixture);
 references.entries.resume={phonetics:['/qa-reviewed-noun/'],etymology:'合成名词来源_简历',phoneticSource:'dictionary',etymologySource:'dictionary',partOfSpeech:'noun',overrideWordIds:['v-resume']};
 const active=session();active.currentStep.word=cv;active.currentStep.receipt=receipt;const snapshot=JSON.stringify(cv);
 const h=harness('VocabularyStudyCard',{workflow:controller({activeSession:active}),theme:'paper'},references);
 assert.match(text(h.tree),/qa-reviewed-noun/);assert.match(text(h.tree),/合成名词来源_简历/);assert.doesNotMatch(text(h.tree),/qa-old-verb|旧混合动词资料/);
 assert.equal(JSON.stringify(cv),snapshot);h.unmount();
 // An absent or old unscoped reference must not revive the known wrong verb IPA.
 for(const entry of [undefined,{phonetics:['/qa-unscoped-verb/']}]){
  const unavailable=structuredClone(referenceFixture);if(entry)unavailable.entries.resume=entry;
  const missing=harness('VocabularyStudyCard',{workflow:controller({activeSession:active}),theme:'paper'},unavailable);
  assert.match(text(missing.tree),/暂无音标/);assert.doesNotMatch(text(missing.tree),/qa-old-verb|qa-unscoped-verb|旧混合动词资料/);missing.unmount();
 }
});

test('noun-scoped resume references do not leak into verbs or override unrelated saved words',()=>{
 const references=structuredClone(referenceFixture);
 references.entries.resume={phonetics:['/qa-reviewed-noun/'],etymology:'合成名词来源_简历',phoneticSource:'dictionary',etymologySource:'dictionary',partOfSpeech:'noun',overrideWordIds:['v-resume']};
 for(const pos of ['动词','v.','n./v.']){
  const active=session();active.currentStep.word={...word,id:'other-resume',word:'resume',pos,meaning:'继续',phonetics:[]};active.currentStep.receipt=receipt;
  const h=harness('VocabularyStudyCard',{workflow:controller({activeSession:active}),theme:'paper'},references);
  assert.match(text(h.tree),/暂无音标/);assert.doesNotMatch(text(h.tree),/qa-reviewed-noun|合成名词来源_简历|词源与构词参考/);
  active.currentStep.word.phonetics=['/qa-own-verb/'];h.render();assert.match(text(h.tree),/qa-own-verb/);assert.doesNotMatch(text(h.tree),/qa-reviewed-noun/);h.unmount();
 }
 const active=session();active.currentStep.word={...word,id:'other-noun',word:'resume',pos:'n.',meaning:'摘要',phonetics:['/qa-own-noun/']};active.currentStep.receipt=receipt;
 const h=harness('VocabularyStudyCard',{workflow:controller({activeSession:active}),theme:'paper'},references);
 assert.match(text(h.tree),/qa-own-noun/);assert.doesNotMatch(text(h.tree),/qa-reviewed-noun/);h.unmount();
});

test('failed feedback keeps the meaning hidden, locks the original rating and retries it before Next',async()=>{
 const active=session(),calls=[];let tries=0,next=0;
 const workflow=controller({activeSession:active,submitRating:async rating=>{calls.push(rating);if(++tries===1)return {status:'blocked',reason:'空间不足，原反馈保留'};active.currentStep.receipt={...receipt,rawRating:rating};return {status:'applied',receipt:active.currentStep.receipt};},nextStep:async()=>{next++;return {status:'applied'};}});
 const h=harness('VocabularyStudyCard',{workflow,theme:'paper'});assert.doesNotMatch(text(h.tree),/安静的；轻声的/);h.click('模糊');await h.flush();assert.doesNotMatch(text(h.tree),/安静的；轻声的/);assert.match(text(h.tree),/空间不足/);assert.equal(h.button('认识').props.disabled,true);assert.equal(h.button('忘记').props.disabled,true);assert.equal(next,0);
 h.click('模糊');await h.flush();assert.deepEqual(calls,['fuzzy','fuzzy']);assert.match(text(h.tree),/安静的；轻声的/);assert.equal(next,0);h.click('完成这一组');await h.flush();assert.equal(next,1);h.unmount();
});

test('a recovered prepared command displays its original rating and cannot switch to another answer',async()=>{
 const calls=[],workflow=controller({activeSession:session(),pendingRating:'forgotten',submitRating:async rating=>{calls.push(rating);return {status:'pending'};}});
 const h=harness('VocabularyStudyCard',{workflow,theme:'hollow'});assert.equal(h.button('认识').props.disabled,true);assert.equal(h.button('模糊').props.disabled,true);assert.equal(h.button('忘记').props.disabled,false);assert.match(text(h.tree),/待确认：忘记/);h.click('认识');await h.flush();assert.equal(calls.length,0);h.click('忘记');await h.flush();assert.deepEqual(calls,['forgotten']);assert.doesNotMatch(text(h.tree),/安静的；轻声的/);h.unmount();
});

test('normal pending save keeps rating labels stable and never asks for a retry before the result',async()=>{
 const active=session(),calls=[];let confirm;
 const workflow=controller({activeSession:active,submitRating:rating=>{calls.push(rating);return new Promise(resolve=>{confirm=()=>{active.currentStep.receipt={...receipt,rawRating:rating};resolve({status:'applied'});};});}});
 const h=harness('VocabularyStudyCard',{workflow,theme:'paper'});
 h.click('认识');h.render();
 assert.deepEqual(calls,['known']);assert.match(text(h.tree),/正在保存反馈/);
 assert.doesNotMatch(text(h.tree),/待确认|请重试|安静的；轻声的/);
 assert.equal(h.button('认识').props['aria-busy'],true);
 for(const label of ['认识','模糊','忘记'])assert.equal(h.button(label).props.disabled,true);
 h.click('认识');assert.equal(calls.length,1);
 confirm();await h.flush();assert.match(text(h.tree),/安静的；轻声的/);
 assert.doesNotMatch(text(h.tree),/正在保存反馈|待确认|请重试/);h.unmount();
});

test('reading position survives same-word save and retry; only the next word resets it',async()=>{
 const active=session();let tries=0;
 const workflow=controller({activeSession:active,submitRating:async rating=>{if(++tries===1)return {status:'pending'};active.currentStep.receipt={...receipt,rawRating:rating};return {status:'applied'};}});
 const h=harness('VocabularyStudyCard',{workflow,theme:'hollow'});
 const content=nodes(h.tree,node=>node.props?.className==='phase2-word-content')[0].props.ref;
 const heading=nodes(h.tree,node=>node.type==='h2'&&node.props.className==='phase2-current-word')[0].props.ref;
 let revealFocusCalls=0;content.current={scrollTop:137,focus:()=>{revealFocusCalls++;}};let focusCalls=0;heading.current={focus:()=>{focusCalls++;}};
 h.click('模糊');await h.flush();assert.equal(content.current.scrollTop,137);
 h.click('模糊');await h.flush();assert.equal(content.current.scrollTop,137);assert.equal(focusCalls,0);assert.equal(revealFocusCalls,1);
 active.currentStep={...active.currentStep,id:'next-word',word:{...word,id:'available',word:'available',meaning:'可用的'},receipt:undefined};
 h.render();assert.equal(content.current.scrollTop,0);assert.equal(focusCalls,1);
 assert.doesNotMatch(text(h.tree),/安静的；轻声的|可用的/);h.unmount();
});

test('late result from the previous word cannot clear the current word save or display its error',async()=>{
 const active=session(),first=active.currentStep,calls=[];let finishFirst,finishSecond;
 const workflow=controller({activeSession:active,submitRating:rating=>{const target=active.currentStep;calls.push({step:target.id,rating});return new Promise(resolve=>{if(target===first)finishFirst=()=>resolve({status:'blocked',reason:'上一词迟到的失败'});else finishSecond=()=>{target.receipt={...receipt,commandId:'second',rawRating:rating};resolve({status:'applied'});};});}});
 const h=harness('VocabularyStudyCard',{workflow,theme:'paper'});
 h.click('认识');h.render();
 active.currentStep={...first,id:'step-2',word:{...word,id:'available',word:'available',meaning:'可用的'}};h.update({workflow});
 h.click('模糊');h.render();assert.equal(calls.length,2);assert.equal(h.button('模糊').props['aria-busy'],true);
 finishFirst();await h.flush();
 assert.equal(h.button('模糊').props['aria-busy'],true);assert.equal(h.button('模糊').props.disabled,true);
 assert.doesNotMatch(text(h.tree),/上一词迟到的失败/);
 h.click('模糊');assert.equal(calls.length,2,'Old finally reopened the current pending callback');
 finishSecond();await h.flush();assert.match(text(h.tree),/可用的/);assert.doesNotMatch(text(h.tree),/安静的；轻声的|上一词迟到的失败/);h.unmount();
});

test('returning to the same word target still rejects an older attempt catch and finally',async()=>{
 const active=session(),first=active.currentStep,calls=[];let failOld,finishCurrent;
 const workflow=controller({activeSession:active,submitRating:rating=>{calls.push(rating);return new Promise((resolve,reject)=>{if(calls.length===1)failOld=()=>reject(Error('旧请求迟到异常'));else finishCurrent=()=>{active.currentStep.receipt={...receipt,rawRating:rating};resolve({status:'applied'});};});}});
 const h=harness('VocabularyStudyCard',{workflow,theme:'hollow'});
 h.click('认识');h.render();
 active.currentStep={...first,id:'temporary-step'};h.render();active.currentStep=first;h.render();
 h.click('忘记');h.render();assert.equal(calls.length,2);assert.equal(h.button('忘记').props['aria-busy'],true);
 failOld();await h.flush();
 assert.equal(h.button('忘记').props['aria-busy'],true);assert.equal(h.button('忘记').props.disabled,true);assert.doesNotMatch(text(h.tree),/旧请求迟到异常/);
 h.click('忘记');assert.equal(calls.length,2);
 finishCurrent();await h.flush();assert.match(text(h.tree),/已保存：忘记/);h.unmount();
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
 const h=harness('VocabularyWorkflowData',{workflow,theme:'paper'});const input=nodes(h.tree,node=>node.type==='input'&&node.props.type==='file')[0];input.props.onChange({currentTarget:{files:[file],value:'backup.json'}});h.render();
 h.update({workflow:controller({scopeKey:'owner-b',restoreWorkflow:async()=>{restores++;return {status:'applied'};}})});resolve(JSON.stringify({kind:'lantern-workflow',schemaVersion:1}));await h.flush();assert.equal(restores,0);h.unmount();
});

test('workflow export uses the native allowlisted filename and names both vocabulary and practice workflows',async()=>{
 const workflow=controller();const h=harness('VocabularyWorkflowData',{workflow,theme:'paper'});h.click('备份学习进度');await h.flush();assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].download,'lantern-workflow-backup.json');assert.match(text(h.tree),/学习进度备份已生成/);assert.match(text(h.tree),/单词计划、候选、词组与普通练习流程/);h.unmount();
});

test('rest-day task separates due review from new words and opens only after a confirmed start',async()=>{
 let opened=0,starts=0;const workflow=controller();workflow.projection.daily.isLearningDay=false;workflow.projection.daily.newRemaining=0;workflow.projection.daily.reviewRemaining=3;workflow.startGroup=async()=>{starts++;return starts===1?{status:'unknown'}:{status:'applied'};};
 const h=harness('TodayVocabularyTask',{workflow,onOpen(){opened++;}});assert.match(text(h.tree),/今日休息，仍可复习或加练/);h.click('开始背词');await h.flush();assert.equal(opened,0);assert.match(text(h.tree),/保存结果尚未确认/);h.click('开始背词');await h.flush();assert.equal(opened,1);assert.equal(workflow.projection.daily.newDone,0);h.unmount();
});
