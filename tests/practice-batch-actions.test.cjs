'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..');
function fixture(groups){
 let state=false,refIndex=0,effects=[],focused=0;const refs=[{current:null},{current:{focus(){focused++;}}}],handlers=new Map(),calls=[];
 class NodeFixture{}
 const document={addEventListener(type,fn){handlers.set(type,fn);},removeEventListener(type,fn){if(handlers.get(type)===fn)handlers.delete(type);}};
 const react={useState:()=>[state,value=>{state=typeof value==='function'?value(state):value;}],useId:()=>':groups:',useRef:()=>refs[refIndex++],useEffect:fn=>effects.push(fn)};
 const jsx=(type,props,key)=>({type,props,key});
 const loader=createSourceLoader({root,imports:{react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'}},globals:{document,Node:NodeFixture}});
 const {PracticeBatchActions}=loader.load('app/learn/practice-batch-actions.tsx');
 const props={groups,total:groups.reduce((sum,g)=>sum+g.count,0),disabled:false,label:'听力练习',onOpen:id=>calls.push(['open',id]),onHistory:id=>calls.push(['history',id])};
 const render=()=>{refIndex=0;effects=[];const tree=PracticeBatchActions(props);return tree;};
 return {render,props,calls,handlers,NodeFixture,refs,get effects(){return effects;},get focused(){return focused;}};
}
function all(node,predicate){const result=[],todo=[node];while(todo.length){const item=todo.shift();if(!item||typeof item!=='object')continue;if(Array.isArray(item)){todo.push(...item);continue;}if(predicate(item))result.push(item);todo.push(item.props?.children);}return result;}
const group=(id,index,count,status,saved=0)=>({id,index,count,status,saved});
test('primary resumes the earliest group with saved answers, and can open another group or its record',()=>{
 const f=fixture([group('one',1,198,'unstarted'),group('two',2,67,'active',8),group('three',3,4,'completed',4)]);
 let tree=f.render(),main=all(tree,n=>n.type==='button'&&n.props['data-task-primary'])[0],more=all(tree,n=>n.type==='button'&&n.props['aria-expanded']!==undefined)[0];
 assert.equal(main.props['aria-label'],'听力练习 · 继续第 2 组');main.props.onClick();assert.deepEqual(f.calls,[['open','two']]);
 more.props.onClick();tree=f.render();more=all(tree,n=>n.type==='button'&&n.props['aria-expanded']!==undefined)[0];assert.equal(more.props['aria-expanded'],true);
 const options=all(tree,n=>n.type==='button'&&n.props.className==='practice-batch-option');assert.equal(options.length,3);options[0].props.onClick();assert.deepEqual(f.calls.at(-1),['open','one']);
 more=f.render().props.children[1].props.children[1];more.props.onClick();tree=f.render();all(tree,n=>n.type==='button'&&n.props.className==='practice-batch-option')[2].props.onClick();assert.deepEqual(f.calls.at(-1),['history','three']);
});
test('active first group resumes and completion disables the main control while preserving records',()=>{
 const f=fixture([group('first',1,4,'active',2),group('second',2,2,'completed',2)]);let tree=f.render();
 let main=all(tree,n=>n.type==='button'&&n.props['data-task-primary'])[0];assert.equal(main.props['aria-label'],'听力练习 · 继续第 1 组');main.props.onClick();assert.deepEqual(f.calls,[['open','first']]);
 f.props.groups=[group('first',1,4,'completed',4),group('second',2,2,'completed',2)];tree=f.render();main=all(tree,n=>n.type==='button'&&n.props['data-task-primary'])[0];assert.equal(main.props.disabled,true);assert.equal(main.props.children,'全部组已完成');assert.equal(all(tree,n=>n.type==='button'&&n.props['aria-expanded']!==undefined)[0].props.disabled,false);
});
test('primary starts the first unfinished group when none has saved answers',()=>{
 const f=fixture([group('first',1,198,'unstarted'),group('second',2,67,'active',0)]),tree=f.render(),main=all(tree,n=>n.type==='button'&&n.props['data-task-primary'])[0];
 assert.equal(main.props['aria-label'],'听力练习 · 开始第 1 组');main.props.onClick();assert.deepEqual(f.calls,[['open','first']]);
});
test('when multiple groups have saved answers primary resumes the first',()=>{
 const f=fixture([group('first',1,198,'active',1),group('second',2,67,'active',8)]),tree=f.render(),main=all(tree,n=>n.type==='button'&&n.props['data-task-primary'])[0];
 assert.equal(main.props['aria-label'],'听力练习 · 继续第 1 组');main.props.onClick();assert.deepEqual(f.calls,[['open','first']]);
});
test('outside pointer closes the list and Escape closes it with focus restored',()=>{
 const f=fixture([group('first',1,3,'unstarted')]);let tree=f.render();let more=all(tree,n=>n.type==='button'&&n.props['aria-expanded']!==undefined)[0];more.props.onClick();f.render();f.refs[0].current={contains:()=>false};let cleanup=f.effects[0]();assert.equal(f.handlers.has('keydown'),true);
 f.handlers.get('pointerdown')({target:new f.NodeFixture()});assert.equal(all(f.render(),n=>n.type==='button'&&n.props['aria-expanded']!==undefined)[0].props['aria-expanded'],false);cleanup();
 more=all(f.render(),n=>n.type==='button'&&n.props['aria-expanded']!==undefined)[0];more.props.onClick();f.render();cleanup=f.effects[0]();let prevented=false,stopped=false;f.handlers.get('keydown')({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(f.focused,1);assert.equal(all(f.render(),n=>n.type==='button'&&n.props['aria-expanded']!==undefined)[0].props['aria-expanded'],false);cleanup();assert.equal(f.handlers.size,0);
});
