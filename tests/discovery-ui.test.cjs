const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..'),A='usr_aaaaaaaa-1111-4111-8111-111111111111',B='usr_bbbbbbbb-2222-4222-8222-222222222222';
const plain=value=>JSON.parse(JSON.stringify(value));
function nodes(tree,predicate){const result=[],queue=[tree];while(queue.length){const node=queue.shift();if(node==null||typeof node==='boolean')continue;if(Array.isArray(node)){queue.push(...node);continue;}if(typeof node==='object'){if(predicate(node))result.push(node);queue.push(node.props?.children);}}return result;}
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='object'?Array.isArray(node)?node.map(text).join(''):text(node.props?.children):String(node);
function memory(){const map=new Map();return {map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}
function fixture(file,initial){
 let cursor=0,dirty=true,tree,props=initial,backHandler;const slots=[],pending=[],events=new Map(),local=memory(),session=memory(),scrolls=[],libraryActive=[];
 const window={localStorage:local,sessionStorage:session,scrollY:0,scrollTo(value){this.scrollY=value.top;scrolls.push(value.top);},addEventListener(name,fn){const set=events.get(name)??new Set();set.add(fn);events.set(name,set);},removeEventListener(name,fn){events.get(name)?.delete(fn);}};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
 const react={useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;dirty=true;}];},useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},useMemo(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const prior=slots[i];slots[i]={deps,work:fn};pending.push(()=>{prior?.cleanup?.();slots[i].cleanup=fn();});}}};react.useLayoutEffect=react.useEffect;
 const jsx=(type,props)=>({type,props}),icons=Object.fromEntries(['ArrowLeft','ArrowUpRight','Bookmark','Search','BookOpen','Check','ChevronRight','Clock','Headphones','Info','NotebookPen'].map(name=>[name,'icon-'+name]));
 const loader=createSourceLoader({root,imports:{react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':icons,'@/lib/native-host':{registerNativeBack(fn){backHandler=fn;return()=>{if(backHandler===fn)backHandler=null;};}}},globals:{window,requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){}}});
 const Component=loader.load(file).default;
 const render=()=>{let loops=0;do{dirty=false;cursor=0;tree=Component(props);for(const node of nodes(tree,node=>node.props?.ref)){const element={focus(){}};if(typeof node.props.ref==='function')node.props.ref(element);else node.props.ref.current=element;}while(pending.length)pending.shift()();assert(++loops<10,'React fixture did not settle');}while(dirty);return tree;};
 render();return {get tree(){return tree;},local,session,window,events,scrolls,libraryActive,loader,render,update(next){props={...props,...next};return render();},find(predicate){const found=nodes(tree,predicate)[0];assert(found,'Missing rendered node');return found;},click(predicate){this.find(node=>node.type==='button'&&predicate(node)).props.onClick();return render();},back(){const result=backHandler?.();render();return result;},replayEffects(){slots.filter(slot=>slot?.work).forEach(slot=>slot.cleanup?.());slots.filter(slot=>slot?.work).forEach(slot=>{slot.cleanup=slot.work();});return render();},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
const kind=id=>node=>node.props?.['data-discovery-category']===id;

test('real discovery component searches, filters, saves after storage success and retains the mounted library',()=>{
 const changes=[],library={type:'stateful-library-fixture',props:{}},access=()=>true,h=fixture('app/learn/discovery-view.tsx',{owner:A,canAccess:access,library,onLibraryActiveChange:value=>changes.push(value)});
 try{
  assert.equal(nodes(h.tree,node=>node.props?.className==='discovery-card').length,3);
  h.find(node=>node.type==='input').props.onChange({target:{value:'Jobs'}});h.render();assert.equal(nodes(h.tree,node=>node.props?.className==='discovery-card').length,1);
  h.click(node=>node.props?.['data-discovery-save']==='stanford-jobs-2005');assert.equal(h.find(node=>node.props?.['data-discovery-save']==='stanford-jobs-2005').props['aria-pressed'],true);
  h.click(kind('library'));assert.equal(h.find(node=>node.props?.className==='discovery-library').props.hidden,false);assert.equal(nodes(h.tree,node=>node===library).length,1);
  h.click(kind('all'));assert.equal(h.find(node=>node.props?.className==='discovery-library').props.hidden,true);assert.equal(nodes(h.tree,node=>node===library).length,1);
  h.update({libraryFocused:true});assert(h.find(node=>node.props?.className==='discovery-categories'));
  h.click(kind('library'));assert.equal(nodes(h.tree,node=>node.props?.className==='discovery-categories').length,0);
 }finally{h.unmount();}
});

test('old A callbacks cannot revive after A/B/A, a new proof or inactive return',()=>{
 let originalOpen=true,currentOpen=true;const original=()=>originalOpen,newA=()=>currentOpen,newB=()=>true;
 const h=fixture('app/learn/discovery-view.tsx',{owner:A,canAccess:original,library:null});
 try{
  const oldSave=h.find(node=>node.props?.['data-discovery-save']==='stanford-jobs-2005').props.onClick;
  const oldLink=h.find(node=>node.props?.['data-discovery-source']==='stanford-jobs-2005').props.onClick;
  h.update({owner:B,canAccess:newB});h.update({owner:A,canAccess:newA});
  const before=[...h.local.map];oldSave();let prevented=false;oldLink({preventDefault(){prevented=true;}});h.render();
  assert.deepEqual([...h.local.map],before);assert.equal(prevented,true);assert.equal(h.session.map.size,0);
  const previous=h.find(node=>node.props?.['data-discovery-save']==='stanford-jobs-2005').props.onClick;
  originalOpen=false;currentOpen=false;h.update({canAccess:()=>true});previous();h.render();assert.deepEqual([...h.local.map],before);
  const currentLink=h.find(node=>node.props?.['data-discovery-source']==='stanford-jobs-2005').props.onClick;
  h.update({active:false});prevented=false;currentLink({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.session.map.size,0);
 }finally{h.unmount();}
});

test('StrictMode effect replay reopens only the current generation and rejected UI writes remain unsaved',()=>{
 const access=()=>true,h=fixture('app/learn/discovery-view.tsx',{owner:A,canAccess:access,library:null});
 try{h.replayEffects();assert.equal(h.events.get('storage').size,1);
  h.click(node=>node.props?.['data-discovery-save']==='stanford-jobs-2005');assert.equal(h.find(node=>node.props?.['data-discovery-save']==='stanford-jobs-2005').props['aria-pressed'],true);
  h.local.setItem=()=>{throw Error('quota');};h.click(node=>node.props?.['data-discovery-save']==='stanford-jobs-2005');
  assert.equal(h.find(node=>node.props?.['data-discovery-save']==='stanford-jobs-2005').props['aria-pressed'],true);assert.match(text(h.tree),/收藏未能保存/);
 }finally{h.unmount();}
});

test('directory source remembers same-owner query/category/scroll and does not claim playback or study completion',()=>{
 const access=()=>true,h=fixture('app/learn/discovery-view.tsx',{owner:A,canAccess:access,library:null});
 try{h.click(kind('person'));h.find(node=>node.type==='input').props.onChange({target:{value:'Jobs'}});h.render();h.window.scrollY=412;
  let prevented=false;h.find(node=>node.props?.['data-discovery-source']==='stanford-jobs-2005').props.onClick({preventDefault(){prevented=true;}});assert.equal(prevented,false);
  const state=h.loader.load('lib/discovery-return.ts').readDiscoveryReturn(A,h.session);assert.equal(state.category,'person');assert.equal(state.query,'Jobs');assert.equal(state.scroll,412);
  assert.equal(nodes(h.tree,node=>node.type==='video'||node.type==='audio'||node.type==='iframe').length,0);assert.match(text(h.tree),/不会自动记作听完/);
 }finally{h.unmount();}
});

test('legacy resource external return restores validated detail/list state and notifies before both external links',()=>{
 const snapshots=[],initialReturn={category:'listening',query:'team',selectedId:'bc-new-team-member',listPosition:{scroll:640,id:'bc-new-team-member'},scroll:312};
 const h=fixture('app/learn/resource-library.tsx',{checkins:[],onRecord(){},initialReturn,onBeforeExternal:state=>{snapshots.push(plain(state));return false;}});
 try{assert.equal(h.scrolls.at(-1),312);assert.match(text(h.tree),/按这几步完成/);
  for(const anchor of nodes(h.tree,node=>node.type==='a')){let prevented=false;anchor.props.onClick({preventDefault(){prevented=true;}});assert(prevented);}
  assert.equal(snapshots.length,2);assert.deepEqual(snapshots[0],initialReturn);
  assert.equal(h.back(),true);assert.equal(h.scrolls.at(-1),640);assert.equal(h.find(node=>node.props?.['data-resource-category']==='listening').props['aria-pressed'],true);
  assert.equal(h.find(node=>node.type==='input').props.value,'team');
 }finally{h.unmount();}
});
