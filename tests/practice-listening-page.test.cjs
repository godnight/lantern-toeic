const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..');
function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node.props?.children);}
function nodes(tree,predicate){const out=[],todo=[tree];while(todo.length){const n=todo.shift();if(!n||typeof n!=='object')continue;if(Array.isArray(n)){todo.push(...n);continue;}if(predicate(n))out.push(n);todo.push(n.props?.children);}return out;}
test('listening opens a standalone selection page and starts actual selected collection with task identity',()=>{
 let cursor=0;const slots=[],events=[],starts=[];
 const react={useState(init){const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(init){const i=cursor++;return slots[i]??=( {current:init} );},useEffect(){cursor++;}};
 const jsx=(type,props,key)=>({type,props,key}), icons=new Proxy({},{get:(_,name)=>String(name)});
 const imports={react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':icons,'@/components/ui/tabs':icons,'@/lib/study-model':{PARTS:['照片','应答','对话','独白','短句','长文','阅读'],createId:()=> 'test'},'@/lib/practice-history-browser':{},'@/lib/practice-selection':{practiceUnits:()=>[]},'@/lib/practice-task':{practiceSavedCount:()=>0},'./practice-records':{taskSessions:()=>[]},'./practice-pages.css':{}};
 const {PracticeHome}=createSourceLoader({root,imports,globals:{requestAnimationFrame:fn=>{fn();return 1}}}).load('app/learn/practice-home.tsx');
 const sample=[{id:'l1',part:1},{id:'l2',part:2}],catalog=[{id:'other',part:4},{id:'r',part:5}];
 const props={questions:catalog,listening:sample,busy:false,tab:'lr',onTab(){},onStart:(rows,task)=>starts.push({rows,task}),onPart(){},onCustom(){},onWrong(){},onListeningWrong(){},onMock(){},children:null,onListeningFocusChange:value=>events.push(value)};
 const render=()=>{cursor=0;return PracticeHome(props);};let tree=render();
 const button=label=>{const a=nodes(tree,n=>n.type==='button'&&text(n).includes(label));assert.equal(a.length,1,label);return a[0]};
 button('听力').props.onClick();tree=render();assert.equal(nodes(tree,n=>n.props?.className==='listening-page').length,1);
 button('开始本组').props.onClick();assert.deepEqual(starts[0].rows,sample);assert.equal(starts[0].task.origin.collection,'listening50');
 button('全部听力').props.onClick();tree=render();button('开始本组').props.onClick();assert.deepEqual(starts[1].rows,[catalog[0]]);assert.equal(starts[1].task.origin.collection,'all');
 props.recordsContent=jsx('section',{className:'practice-records',children:'两组未完成'});tree=render();assert.equal(nodes(tree,n=>n.props?.className==='practice-records').length,1);assert.equal(nodes(tree,n=>n.props?.className==='listening-page').length,0);
 props.recordsContent=undefined;tree=render();assert.equal(nodes(tree,n=>n.props?.className==='listening-page').length,1);assert.equal(button('全部听力').props['aria-pressed'],true,'Returning from task records retains the selected collection');
 button('返回练习').props.onClick();tree=render();assert.equal(nodes(tree,n=>n.props?.className==='listening-page').length,0);assert.deepEqual(events,[true,false]);
});
