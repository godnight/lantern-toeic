const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..'),A='usr_aaaaaaaa-1111-4111-8111-111111111111',B='usr_bbbbbbbb-2222-4222-8222-222222222222';
const plain=value=>JSON.parse(JSON.stringify(value));
function nodes(tree,predicate){const result=[],queue=[tree];while(queue.length){const node=queue.shift();if(node==null||typeof node==='boolean')continue;if(Array.isArray(node)){queue.push(...node);continue;}if(typeof node==='object'){if(predicate(node))result.push(node);queue.push(node.props?.children);}}return result;}
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='object'?Array.isArray(node)?node.map(text).join(''):text(node.props?.children):String(node);
const hasClass=(node,name)=>typeof node.props?.className==='string'&&node.props.className.split(' ').includes(name);
// Match actual HTML disclosure behavior: a closed details element exposes its
// summary, while its explanatory body stays out of the default card surface.
function visibleText(node){
 if(node==null||typeof node==='boolean')return '';
 if(Array.isArray(node))return node.map(visibleText).join('');
 if(typeof node!=='object')return String(node);
 if(node.props?.hidden)return '';
 if(node.type==='details'&&!node.props.open)return nodes(node.props.children,child=>child.type==='summary').map(visibleText).join('');
 return visibleText(node.props?.children);
}
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

test('default discovery stays quiet while actual favorite success and rejected writes retain live status feedback',()=>{
 const h=fixture('app/learn/discovery-view.tsx',{owner:A,canAccess:()=>true,library:null});
 const notices=()=>nodes(h.tree,node=>hasClass(node,'discovery-notice'));
 try{
  assert.equal(notices().length,0,'A fresh directory has no standing notice');
  assert.equal(nodes(h.tree,node=>hasClass(node,'discovery-footnote')).length,0,'Access conditions belong in each closed disclosure');
  h.click(node=>node.props?.['data-discovery-save']==='stanford-jobs-2005');
  assert.equal(notices().length,1);assert.equal(notices()[0].props.role,'status');assert.equal(notices()[0].props['aria-live'],'polite');assert.equal(text(notices()[0]),'已收藏。');
  h.local.setItem=()=>{throw Error('Synthetic quota rejection');};
  h.click(node=>node.props?.['data-discovery-save']==='stanford-jobs-2005');
  assert.equal(notices().length,1);assert.equal(notices()[0].props.role,'status');assert.equal(notices()[0].props['aria-live'],'polite');assert(text(notices()[0]).includes('收藏未能保存'));
  assert.equal(h.find(node=>node.props?.['data-discovery-save']==='stanford-jobs-2005').props['aria-pressed'],true,'Rejected cancellation cannot pretend the saved item was removed');
  h.click(kind('person'));assert.equal(notices().length,0,'The next browsing intent clears the operation feedback');
 }finally{h.unmount();}
});

test('real card metadata presents known facts and keeps full uncertainty and source conditions in closed disclosures',()=>{
 const h=fixture('app/learn/discovery-view.tsx',{owner:A,canAccess:()=>true,library:null});
 try{
  const entries=h.loader.load('lib/discovery-catalog.ts').discoveryEntries;
  const cards=nodes(h.tree,node=>node.type==='article'&&hasClass(node,'discovery-card'));
  assert.equal(cards.length,entries.length);
  const cardFor=id=>cards.find(card=>nodes(card,node=>node.props?.['data-discovery-source']===id).length===1);
  for(const entry of entries){
   const card=cardFor(entry.id);assert(card,'Actual catalog entry must remain visible');
   const surface=visibleText(card),details=nodes(card,node=>node.type==='details'&&hasClass(node,'discovery-rights'));
   assert.equal(details.length,1);assert.equal(Boolean(details[0].props.open),false);
   assert(surface.includes(entry.title));assert(surface.includes(entry.author));assert(surface.includes(entry.publisher));assert(surface.includes(entry.description));
   const link=nodes(card,node=>node.props?.['data-discovery-source']===entry.id)[0];assert.equal(link.props.href,entry.sourceUrl);assert.equal(link.props.target,'_blank');assert.equal(link.props.rel,'noopener noreferrer');
   assert.equal(nodes(card,node=>node.props?.['data-discovery-save']===entry.id).length,1);
   for(const placeholder of ['时长以原站为准','字幕以原站为准','难度暂未评估'])assert(!surface.includes(placeholder),'Unknown metadata must not occupy the default card');
   const explanation=text(details[0]);assert(explanation.includes(entry.availability.note));assert(explanation.includes('打开原站不会自动记作听完，也不增加学习时长。'));
   for(const url of entry.rights.evidenceUrls)assert(nodes(details[0],node=>node.type==='a'&&node.props.href===url).length===1);
   assert(Object.values(entry.rights.capabilities).every(value=>value===false),'The real catalog must keep all media/AI capabilities closed');
   assert.equal(nodes(card,node=>['video','audio','iframe'].includes(node.type)).length,0);
  }
  const nasa=entries.find(entry=>entry.id==='nasa-kennedy-rice-1962');assert.equal(nasa.durationSeconds,null);assert.equal(nasa.durationLabel,null);assert.equal(nasa.captions,null);assert.equal(nasa.difficulty,null);
  assert.equal(nodes(cardFor(nasa.id),node=>hasClass(node,'discovery-meta')).length,0);
  const stanford=entries.find(entry=>entry.id==='stanford-jobs-2005');assert.equal(stanford.captions,'原站有英文演讲稿；视频字幕未核');
  const stanfordCard=cardFor(stanford.id),stanfordMeta=nodes(stanfordCard,node=>hasClass(node,'discovery-meta'));
  assert.equal(stanfordMeta.length,1);assert.equal(text(stanfordMeta[0]),'英文稿');assert(!visibleText(stanfordCard).includes(stanford.captions));assert(text(nodes(stanfordCard,node=>node.type==='details')[0]).includes(stanford.captions));
  const film=entries.find(entry=>entry.id==='blender-tears-of-steel');assert.equal(film.durationLabel,'约 12 分钟（官方标注）');
  assert(visibleText(cardFor(film.id)).includes(film.durationLabel));
 }finally{h.unmount();}
});

test('real content titles lead cards without invented covers or duplicate category labels while actions and disclosures remain usable',()=>{
 const h=fixture('app/learn/discovery-view.tsx',{owner:A,canAccess:()=>true,library:null});
 try{
  const catalog=h.loader.load('lib/discovery-catalog.ts'),cards=nodes(h.tree,node=>node.type==='article'&&hasClass(node,'discovery-card'));
  assert.equal(cards.length,catalog.discoveryEntries.length);
  for(const entry of catalog.discoveryEntries){
   const card=cards.find(card=>nodes(card,node=>node.props?.['data-discovery-source']===entry.id).length===1);assert(card);
   assert.equal(nodes(card,node=>node.type==='img'||hasClass(node,'discovery-cover')||typeof node.props?.className==='string'&&node.props.className.split(' ').some(name=>name.startsWith('discovery-cover-'))).length,0,'No unlicensed or invented cover stands in for the content');
   const headings=nodes(card,node=>['h2','h3'].includes(node.type));assert.equal(headings.length,1);assert.equal(text(headings[0]),entry.title,'The real content title is the sole card heading');
   for(const generic of ['分类图','声音与表达','人生中的选择','银幕里的对话'])assert(!text(card).includes(generic),'Generic category art titles must not compete with the real title');
   const category=catalog.DISCOVERY_KINDS[entry.kind];assert.equal(nodes(card,node=>node.type==='span'&&visibleText(node)===category).length,1,'Each card carries one explicit category label');
   const disclosure=nodes(card,node=>node.type==='details'&&hasClass(node,'discovery-rights'))[0];assert(disclosure);assert.equal(Boolean(disclosure.props.open),false);assert.equal(text(nodes(disclosure,node=>node.type==='summary')[0]),'来源与访问说明');assert(text(disclosure).includes(entry.availability.note));
   h.click(node=>node.props?.['data-discovery-save']===entry.id);assert.equal(h.find(node=>node.props?.['data-discovery-save']===entry.id).props['aria-pressed'],true,'Removing decoration must keep the real save action');
   const link=h.find(node=>node.props?.['data-discovery-source']===entry.id);assert.equal(link.props.href,entry.sourceUrl);let prevented=false;link.props.onClick({preventDefault(){prevented=true;}});assert.equal(prevented,false);
   assert.equal(h.loader.load('lib/discovery-return.ts').readDiscoveryReturn(A,h.session).entryId,entry.id,'The real source action still prepares the same entry for return');
  }
 }finally{h.unmount();}
});
