// Exercises the real TSX with controlled React hooks and metadata; no user storage or external requests.
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const sourceRoot=process.env.LANTERN_RESOURCE_SOURCE_ROOT||root;
const ts=require(path.join(root,'node_modules/typescript'));

function load(file,imports={},globals={},from=root){
 const exports={};
 const code=ts.transpileModule(fs.readFileSync(path.join(from,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{assert.ok(name in imports,'Unexpected import '+name);return imports[name];},Map,Set,Date,...globals},{filename:file});
 return exports;
}
const catalog=load('content/resources-v2.ts');
function nodes(tree,predicate){const result=[],queue=[tree];while(queue.length){const node=queue.shift();if(node==null||typeof node==='boolean')continue;if(Array.isArray(node)){queue.push(...node);continue;}if(typeof node==='object'){if(predicate(node))result.push(node);queue.push(node.props?.children);}}return result;}
function textOf(node){return node==null||typeof node==='boolean'?'':typeof node==='object'?Array.isArray(node)?node.map(textOf).join(''):textOf(node.props?.children):String(node);}
function harness(initial={}){
 let slots=[],cursor=0,pending=[],tree,backHandler,props={checkins:[],onRecord:resource=>recordCalls.push(resource),...initial};
 const recordCalls=[],focused=[],scrolls=[];
 const window={scrollY:0,scrollTo(position){window.scrollY=position.top;scrolls.push(position.top);}};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useMemo(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};pending.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}
 };
 react.useLayoutEffect=react.useEffect;
 const jsx=(type,props)=>({type,props});
 const icons=Object.fromEntries(['ArrowLeft','ArrowUpRight','BookOpen','Check','ChevronRight','Clock','Headphones','Info','NotebookPen'].map(name=>[name,'icon-'+name]));
 const component=load('app/learn/resource-library.tsx',{react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':icons,'@/content/resources-v2':catalog,'@/lib/native-host':{registerNativeBack(fn,priority){assert.equal(priority,20);backHandler=fn;return()=>{if(backHandler===fn)backHandler=undefined;};}}},{window},sourceRoot).default;
 const render=()=>{
  cursor=0;tree=component(props);
  for(const node of nodes(tree,node=>node.props?.ref)){
   const element={focus(){focused.push(node.props['data-resource-id']||node.props.id);}};
   if(typeof node.props.ref==='function')node.props.ref(element);else node.props.ref.current=element;
  }
  const effects=pending;pending=[];effects.forEach(fn=>fn());return tree;
 };
 const click=(predicate)=>{const button=nodes(tree,node=>node.type==='button'&&predicate(node))[0];assert.ok(button,'Missing button');button.props.onClick();render();};
 return {render,recordCalls,focused,scrolls,window,get tree(){return tree;},update(value){props={...props,...value};render();},open(id){click(node=>node.props['data-resource-id']===id);},filter(id){click(node=>node.props['data-resource-category']===id);},clickLabel(label){click(node=>textOf(node)===label);},back(){assert.ok(backHandler);const consumed=backHandler();render();return consumed;},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
function checkin(id,resourceId,minutes){return {id,date:'2026-10-13',minutes,load:'刚好',note:`[资源:${resourceId}] synthetic title\nonly a fixture`,createdAt:'2026-10-13T09:00:00.000Z'};}

test('all 15 original resources remain browsable and each chosen provider, URL and steps stay bound to its ID',()=>{
 const h=harness();h.render();assert.equal(catalog.resources.length,15);
 assert.equal(nodes(h.tree,node=>!!node.props?.['data-resource-id']).length,15);
 for(const id of ['voa-budget-cuts','bc-new-team-member','iibc-p7-multiple']){
  const resource=catalog.resources.find(item=>item.id===id);assert.ok(resource);
  h.open(id);assert.match(textOf(h.tree),new RegExp(resource.provider.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(nodes(h.tree,node=>node.type==='a'&&node.props.href===resource.url).length,1);
  for(const step of resource.steps)assert.ok(textOf(h.tree).includes(step));
  assert.ok(textOf(h.tree).includes(resource.accessNote));h.clickLabel('返回资料列表');
 }
 h.unmount();
});

test('skill filter and list scroll/focus survive detail return through screen and native back',()=>{
 const h=harness();h.render();h.filter('listening');
 assert.equal(nodes(h.tree,node=>!!node.props?.['data-resource-id']).length,catalog.resources.filter(item=>item.category==='listening').length);
 h.window.scrollY=640;h.open('bc-new-team-member');assert.equal(h.scrolls.at(-1),0);
 assert.equal(h.focused.at(-1),'resource-detail-title');assert.equal(h.back(),true);
 assert.equal(h.scrolls.at(-1),640);assert.equal(h.focused.at(-1),'bc-new-team-member');
 assert.equal(nodes(h.tree,node=>node.props?.['data-resource-category']==='listening')[0].props['aria-pressed'],true);
 assert.equal(h.back(),false);h.unmount();
});

test('record action uses the chosen original object and does not invent a saved visit before parent checkins change',()=>{
 const h=harness();h.render();h.open('bc-new-team-member');h.clickLabel('学完记一笔');
 assert.equal(h.recordCalls.length,1);assert.equal(h.recordCalls[0],catalog.resources.find(item=>item.id==='bc-new-team-member'));
 assert.match(textOf(h.tree),/尚未记录这份材料的学习/);
 h.update({checkinOpen:true});assert.equal(h.back(),false);assert.match(textOf(h.tree),/按这几步完成/);
 h.update({checkinOpen:false});assert.match(textOf(h.tree),/尚未记录这份材料的学习/);h.unmount();
});

test('successful parent records update only the associated material and preserve other providers statistics',()=>{
 const h=harness({checkins:[checkin('fixture-1','voa-budget-cuts',12),checkin('fixture-2','bc-new-team-member-extra',40)]});
 h.render();h.open('bc-new-team-member');assert.match(textOf(h.tree),/尚未记录这份材料的学习/);
 h.update({checkins:[checkin('fixture-1','voa-budget-cuts',12),checkin('fixture-3','bc-new-team-member',8),checkin('fixture-4','bc-new-team-member',5)]});
 assert.match(textOf(h.tree),/已学习 2 次 · 13 分钟/);
 h.clickLabel('返回资料列表');h.open('voa-budget-cuts');assert.match(textOf(h.tree),/已学习 1 次 · 12 分钟/);h.unmount();
});

test('pending records never present an empty history or allow record action, even if a click is invoked directly',()=>{
 const h=harness({recordsReady:false});h.render();h.open('iibc-p7-multiple');
 assert.match(textOf(h.tree),/正在读取学习记录/);assert.doesNotMatch(textOf(h.tree),/尚未记录这份材料/);
 const button=nodes(h.tree,node=>node.type==='button'&&textOf(node)==='学完记一笔')[0];assert.equal(button.props.disabled,true);
 button.props.onClick();assert.equal(h.recordCalls.length,0);
 h.update({recordsReady:true});h.clickLabel('学完记一笔');assert.equal(h.recordCalls[0].id,'iibc-p7-multiple');h.unmount();
});

test('product text has natural instructions and existing source boundaries, without prototype or hook names',()=>{
 const h=harness();h.render();h.open('voa-budget-cuts');
 assert.doesNotMatch(textOf(h.tree),/addCheckin|LearningResource|RecordingList|recordingUrl|原型|本轮/);
 assert.match(textOf(h.tree),/打开材料不会自动记录学习/);
 for(const link of nodes(h.tree,node=>node.type==='a')){assert.equal(link.props.target,'_blank');assert.equal(link.props.rel,'noopener noreferrer');}
 h.unmount();
});
