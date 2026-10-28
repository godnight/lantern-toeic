'use strict';
const path=require('node:path');
const {createSourceLoader}=require('./actual-source-loader.cjs');
const root=path.resolve(__dirname,'../..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function nodes(tree,predicate){const out=[],queue=[tree];while(queue.length){const n=queue.shift();if(!n)continue;if(Array.isArray(n))queue.push(...n);else if(typeof n==='object'){if(predicate(n))out.push(n);queue.push(n.props?.children);}}return out;}
function text(n){return n==null||typeof n==='boolean'?'':Array.isArray(n)?n.map(text).join(''):typeof n==='object'?text(n.props?.children):String(n);}
const words=[{id:'word-a',word:'quiet'},{id:'word-b',word:'available'}];
const books=[{id:'general-base-1.2',name:'通用基础',capacity:2},{id:'combined-with-supplement-1.2',name:'托业备考',capacity:2},{id:'scene',name:'旧场景词本',capacity:2}];
function workflow(overrides={}){return {scopeKey:'scope-a',ready:true,error:'',activeSession:null,projection:{plan:{bookId:'scene',goal:2,dailyNew:15,weekdays:[1,2,3,4,5],revision:4},counts:{capacity:2,learned:0,remaining:2,reviewDue:0},candidates:[],learnedWordIds:[],daily:{window:{localDate:'2026-10-28'},newDone:0,newRemaining:2,isLearningDay:true}},savePlan:async()=>({status:'applied'}),refresh:async()=>{},...overrides};}
function harness(name,initial){
 let props=initial,slots=[],cursor=0,effects=[],tree,timerId=0;
 const timers=new Map(),same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const react={useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}},useSyncExternalStore:(_,read)=>read()};
 const jsx=(type,props)=>typeof type==='function'&&type.name==='PlanExitPrompt'?type(props):{type,props};
 const catalog={getWorkflowBook:id=>books.find(book=>book.id===id),getWorkflowCatalog:()=>words,getCandidateLearningWord:()=>null,WORKFLOW_BOOKS:books};
 const imports={react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':new Proxy({},{get:()=>function Icon(){}}),'@/components/ui/dialog':{Dialog:'Dialog',DialogContent:'DialogContent',DialogTitle:'DialogTitle',DialogDescription:'DialogDescription'},'@/lib/workflow-catalog':catalog,'./workflow-catalog':catalog,'@/lib/vocabulary-model':{},'./interactive-example':{},'./practice':{},'@/lib/word-audio-bindings-v040':{},'@/lib/lesson-audio':{},'./ui-theme':{},'./word-card-reference':{},'@/lib/native-host':{registerNativeBack:()=>()=>{}}};
 const globals={document:{activeElement:null},HTMLElement:class HTMLElement{},requestAnimationFrame:fn=>fn(),setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
 const loader=createSourceLoader({root,imports,globals});
 const file=name==='VocabularyPlanEditor'?'app/learn/vocabulary-plan.tsx':'app/learn/learning-plan.tsx';
 const component=loader.load(file)[name];
 const render=()=>{cursor=0;tree=component(props);const pending=effects;effects=[];pending.forEach(fn=>fn());return tree;};
 render();render();
 return {get tree(){return tree;},timers,render,find:predicate=>nodes(tree,predicate),button:label=>nodes(tree,n=>n.type==='button'&&text(n).trim()===label)[0],click(label){const b=this.button(label);if(!b)throw Error('Missing '+label);b.props.onClick?.();render();},submit(){nodes(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});render();},update(next){props={...props,...next};render();render();},async flush(){await tick();render();await tick();render();},timeout(){const target=[...timers.values()].find(t=>t.ms===15000);if(!target)throw Error('No15s watchdog');target.fn();render();},unmount(){slots.forEach(s=>s?.cleanup?.());}};
}
exports.harness=harness;exports.workflow=workflow;exports.nodes=nodes;exports.text=text;
