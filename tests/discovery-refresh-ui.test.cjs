const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..');
const entries=require('../content/discovery-native.json').entries;
const sources=[...new Map(entries.map(item=>[item.sourceId,{id:item.sourceId,label:item.publisher,mode:'curated'}])).values()];
const seed={entries,sources,status:'seed',refreshedAt:null,lastSuccessAt:null,refresh:null};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function nodes(tree,predicate){const found=[],queue=[tree];while(queue.length){const n=queue.shift();if(n==null||typeof n==='boolean')continue;if(Array.isArray(n)){queue.push(...n);continue;}if(typeof n==='object'){if(predicate(n))found.push(n);queue.push(n.props?.children);}}return found;}
function text(n){return n==null||typeof n==='boolean'?'':Array.isArray(n)?n.map(text).join(''):typeof n==='object'?text(n.props?.children):String(n);}
function fixture(items=entries){
 const initial={...seed,entries:items,sources:[...new Map(items.map(item=>[item.sourceId,{id:item.sourceId,label:item.publisher,mode:'curated'}])).values()]};
 let cursor=0,dirty=true,tree,props={owner:'alpha',canAccess:()=>true,library:null},cache=initial;const slots=[],effects=[],requests=[];
 const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)}};
 const window={localStorage:memory(),sessionStorage:memory(),scrollY:0,scrollTo(){},addEventListener(){},removeEventListener(){}};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={useState(v){const i=cursor++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;dirty=true}]},useRef(v){const i=cursor++;if(!(i in slots))slots[i]={current:v};return slots[i]},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const prior=slots[i];slots[i]={deps};effects.push(()=>{prior?.cleanup?.();slots[i].cleanup=fn()})}}};react.useLayoutEffect=react.useEffect;
 const feed={DISCOVERY_SEED:items,readDiscoveryFeedCache:()=>cache,refreshDiscoveryFeed:options=>new Promise((resolve,reject)=>requests.push({options,resolve(snapshot){if(options.canCommit()&&!options.signal.aborted)cache={...snapshot,refresh:null};resolve(snapshot)},reject}))};
 const jsx=(type,props)=>({type,props}),icons=new Proxy({},{get:(_,key)=>String(key)});
 const loader=createSourceLoader({root,imports:{react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':icons,'@/lib/discovery-feed':feed},globals:{window,requestAnimationFrame:fn=>{fn();return 1},cancelAnimationFrame(){}}});
 const Component=loader.load('app/learn/discovery-view.tsx').default;
 function render(){let count=0;do{dirty=false;cursor=0;tree=Component(props);for(const n of nodes(tree,n=>n.props?.ref)){const element={focus(){}};if(typeof n.props.ref==='function')n.props.ref(element);else n.props.ref.current=element}while(effects.length)effects.shift()();assert(++count<12)}while(dirty);return tree}
 function find(cls){const n=nodes(tree,n=>n.props?.className===cls)[0];assert(n,`missing ${cls}`);return n}
 render();return {requests,render,find,loader,window,get tree(){return tree},update(next){props={...props,...next};return render()},unmount(){slots.forEach(slot=>slot?.cleanup?.())}};
}
function result(outcome,added,lastSuccessAt=1730000000000){return {...seed,status:outcome==='failed'?'offline':'fresh',lastSuccessAt,refreshedAt:lastSuccessAt,refresh:{outcome,added,attemptedAt:1730000001000}}}

test('refresh reports real outcomes and retry stays next to the result',async()=>{
 const h=fixture();try{
  await tick();assert.equal(h.requests.length,1);assert.match(text(h.find('discovery-refresh-result')),/正在刷新/);assert.equal(h.find('discovery-refresh-button').props['aria-disabled'],true);
  h.requests[0].resolve(result('updated',3));await tick();h.render();assert.match(text(h.find('discovery-refresh-result')),/新增 3 条/);assert.match(text(h.find('discovery-refresh-time')),/最近成功/);
  for(const [outcome,added,expected,label] of [['unchanged',0,/本次无新增/,'刷新'],['partial',2,/新增 2 条 · 部分来源更新失败/,'重试'],['failed',0,/刷新失败，已保留现有内容/,'重试']]){
   h.find('discovery-refresh-button').props.onClick();h.render();await tick();const request=h.requests.at(-1);assert.match(text(h.find('discovery-refresh-result')),/正在刷新/);request.resolve(result(outcome,added));await tick();h.render();assert.match(text(h.find('discovery-refresh-result')),expected);assert.match(text(h.find('discovery-refresh-button')),new RegExp(label));assert.match(text(h.find('discovery-refresh-time')),/最近成功/);
  }
  h.find('discovery-refresh-button').props.onClick();h.render();await tick();h.requests.at(-1).reject(Error('offline'));await tick();h.render();assert.match(text(h.find('discovery-refresh-result')),/刷新失败/);assert.match(text(h.find('discovery-refresh-time')),/最近成功/);
 }finally{h.unmount()}
});

test('obsolete account and inactive requests cannot publish a refresh result',async()=>{
 const h=fixture();try{await tick();const old=h.requests[0];h.update({owner:'beta'});await tick();const beta=h.requests.at(-1);assert.equal(old.options.signal.aborted,true);h.update({owner:'alpha',canAccess:()=>true});await tick();const current=h.requests.at(-1);assert.equal(beta.options.signal.aborted,true);
  old.resolve(result('updated',99));beta.resolve(result('updated',88));await tick();h.render();assert.match(text(h.find('discovery-refresh-result')),/正在刷新/);
  h.update({active:false});assert.equal(current.options.signal.aborted,true);current.resolve(result('updated',77));await tick();h.render();assert.doesNotMatch(text(h.find('discovery-refresh-result')),/77/);
 }finally{h.unmount()}
});

test('CGTN episode cards clearly lead to their program page while other links retain their labels',()=>{
 const programs=['cgtn-roundtable','cgtn-beijing-hour','cgtn-world-today'];
 const items=[...programs.map((sourceId,index)=>({...entries[0],id:`program-${index}`,sourceId,title:`Episode ${index}`,sourceUrl:`https://www.cgtn.com/program-${index}`})),entries[0]];
 const h=fixture(items);try{
  for(let index=0;index<programs.length;index++){
   const card=nodes(h.tree,n=>n.type==='article'&&n.props?.['data-discovery-id']===`program-${index}`)[0];assert(card);assert.match(text(card),/到节目页按标题收听/);
   const links=nodes(card,n=>n.type==='a');
   for(const link of links){assert.equal(link.props.href,`https://www.cgtn.com/program-${index}`);let prevented=false;link.props.onClick({preventDefault(){prevented=true}});assert.equal(prevented,false);const saved=h.loader.load('lib/discovery-return.ts').readDiscoveryReturn('alpha',h.window.sessionStorage);assert.equal(saved.entryId,`program-${index}`);assert.equal(saved.entryControl,link.props['data-discovery-control'])}
   assert.match(links.find(n=>n.props['data-discovery-control']==='title').props['aria-label'],/打开节目页/);
   assert.match(links.find(n=>n.props['data-discovery-control']==='cover').props['aria-label'],/打开节目页/);
   assert.match(text(links.find(n=>n.props['data-discovery-control']==='source')),/打开节目页/);
  }
  const original=nodes(h.tree,n=>n.type==='article'&&n.props?.['data-discovery-id']===entries[0].id)[0];assert.doesNotMatch(text(original),/到节目页按标题收听/);assert.match(text(nodes(original,n=>n.props?.['data-discovery-control']==='source')[0]),/阅读原文|打开原站/);
 }finally{h.unmount()}
});

test('CGTN cards display only valid original publication timestamps',()=>{
 const publishedAt='2026-11-17T05:36:22.000Z';
 const items=[
  {...entries[0],id:'cgtn-dated',sourceId:'cgtn-roundtable',publishedAt},
  {...entries[0],id:'cgtn-invalid',sourceId:'cgtn-beijing-hour',publishedAt:'2026-02-30T05:36:22.000Z'},
  {...entries[0],id:'cgtn-missing',sourceId:'cgtn-world-today',publishedAt:null},
  {...entries[0],id:'other-dated',publishedAt}
 ];
 const h=fixture(items);try{
  const card=id=>nodes(h.tree,n=>n.type==='article'&&n.props?.['data-discovery-id']===id)[0];
  const time=nodes(card('cgtn-dated'),n=>n.type==='time');assert.equal(time.length,1);assert.equal(time[0].props.dateTime,publishedAt);
  assert.match(text(card('cgtn-dated')),/发布于/);assert.equal(text(time[0]),new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(publishedAt)));
  for(const id of ['cgtn-invalid','cgtn-missing','other-dated']){assert.equal(nodes(card(id),n=>n.type==='time').length,0);assert.doesNotMatch(text(card(id)),/发布于/)}
 }finally{h.unmount()}
});
