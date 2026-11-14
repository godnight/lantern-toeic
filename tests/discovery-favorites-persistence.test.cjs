'use strict';
// Exercises the real feed and favorite stores with isolated in-memory responses.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..');
const loader=createSourceLoader({root});
const feed=loader.load('lib/discovery-feed.ts'),favorites=loader.load('lib/discovery-favorites.ts');
const A='owner-a',B='owner-b',POD='https://feeds.simplecast.com/BqbsxVfO';
const plain=value=>JSON.parse(JSON.stringify(value));
const guid=n=>`12345678-${n.toString(16).padStart(4,'0')}-4000-8000-${n.toString(16).padStart(12,'0')}`;
const row=n=>`<item><guid>${guid(n)}</guid><link>https://99percentinvisible.org/episode/episode-${n}/</link><title>Episode ${n}</title><description>An original English episode.</description></item>`;
const xml=items=>`<rss><channel>${items}</channel></rss>`;
function memory(){const map=new Map(),writes=[];return {map,writes,getItem:k=>map.get(k)??null,setItem(k,v){writes.push([k,String(v)]);map.set(k,String(v));},removeItem:k=>map.delete(k)};}
function fetcher(rows){return async url=>String(url)===POD?new Response(xml(rows),{status:200}):new Response('offline',{status:503});}
const open=(owner,storage,extra={})=>favorites.createDiscoveryFavoritesStore({owner,storage,canAccess:()=>true,...extra});

test('an admitted dynamic favorite survives feed eviction and offline reload; cancellation removes its saved metadata',async()=>{
 const storage=memory(),store=open(A,storage);
 const first=await feed.refreshDiscoveryFeed({storage,fetchImpl:fetcher(row(1))});
 const entry=first.entries.find(x=>x.id==='99pi-'+guid(1));assert(entry,'the episode must come from the actual reviewed feed path');
 const saved=store.toggle(entry.id,entry);assert.equal(saved.status,'ready');assert(saved.ids.includes(entry.id));
 const many=Array.from({length:50},(_,i)=>row(i+2)).join('');
 const rotated=await feed.refreshDiscoveryFeed({storage,fetchImpl:fetcher(many)});
 assert(!rotated.entries.some(x=>x.id===entry.id),'the rotating public cache must no longer contain the episode');
 const offline=await feed.refreshDiscoveryFeed({storage,fetchImpl:async()=>{throw Error('offline');}});
 assert(!offline.entries.some(x=>x.id===entry.id));
 const restored=open(A,storage).read();assert.equal(restored.status,'ready');
 const retained=restored.entries.find(x=>x.id===entry.id);assert(retained);assert.equal(retained.title,entry.title);assert.equal(retained.sourceUrl,entry.sourceUrl);
 assert.equal(retained.author,null);assert.equal(retained.language,'en');assert(retained.verification.evidenceUrls.length);
 const removed=store.toggle(entry.id,retained);assert.equal(removed.status,'ready');assert(!removed.ids.includes(entry.id));
 assert(!open(A,storage).read().entries.some(x=>x.id===entry.id));
});

test('favorites and retained metadata are owner scoped and stale A callbacks stay revoked after A/B/A',async()=>{
 const storage=memory();let current=1;const oldA=open(A,storage,{isCurrent:()=>current===1});
 const result=await feed.refreshDiscoveryFeed({storage,fetchImpl:fetcher(row(1))});const entry=result.entries.find(x=>x.id==='99pi-'+guid(1));
 assert.equal(oldA.toggle(entry.id,entry).status,'ready');
 current=2;const b=open(B,storage,{isCurrent:()=>current===2});assert.deepEqual(plain(b.read().ids),[]);assert.deepEqual(plain(b.read().entries),[]);
 b.toggle('stanford-jobs-2005');current=3;const newA=open(A,storage,{isCurrent:()=>current===3});
 const before=storage.map.get(newA.key);assert.equal(oldA.toggle(entry.id,entry).status,'blocked');assert.equal(storage.map.get(newA.key),before);
 const restored=newA.read();assert(restored.ids.includes(entry.id));assert(restored.entries.some(x=>x.id===entry.id));
});

test('legacy IDs survive migration; malformed, foreign and unknown versions never overwrite stored bytes',async()=>{
 const storage=memory(),store=open(A,storage);
 const legacy=JSON.stringify({kind:'lantern-discovery-favorites',schemaVersion:1,owner:A,ids:['stanford-jobs-2005','legacy-unknown']});storage.map.set(store.key,legacy);
 assert.deepEqual(plain(store.read().ids),['stanford-jobs-2005','legacy-unknown']);
 const result=await feed.refreshDiscoveryFeed({storage,fetchImpl:fetcher(row(1))});const entry=result.entries.find(x=>x.id==='99pi-'+guid(1));
 assert.equal(store.toggle(entry.id,entry).status,'ready');const restored=open(A,storage).read();
 for(const id of ['stanford-jobs-2005','legacy-unknown',entry.id])assert(restored.ids.includes(id));
 assert(restored.entries.some(x=>x.id===entry.id));
 for(const raw of ['{broken',JSON.stringify({kind:'lantern-discovery-favorites',schemaVersion:999,owner:A,ids:[]}),JSON.stringify({kind:'lantern-discovery-favorites',schemaVersion:1,owner:B,ids:[]}),JSON.stringify({kind:'lantern-discovery-favorites',schemaVersion:1,owner:A,ids:Array.from({length:301},(_,i)=>'entry-'+i)})]){
  storage.map.set(store.key,raw);const count=storage.writes.length;assert.equal(store.read().status,'blocked');assert.equal(store.toggle(entry.id,entry).status,'blocked');assert.equal(storage.map.get(store.key),raw);assert.equal(storage.writes.length,count);
 }
});

test('capture safely preserves old dynamic IDs while metadata is still available',async()=>{
 const storage=memory(),store=open(A,storage),snapshot=await feed.refreshDiscoveryFeed({storage,fetchImpl:fetcher(row(1))});
 const entry=snapshot.entries.find(x=>x.id==='99pi-'+guid(1));
 const legacy=JSON.stringify({kind:'lantern-discovery-favorites',schemaVersion:1,owner:A,ids:[entry.id,'legacy-unknown']});storage.map.set(store.key,legacy);
 assert.equal(store.read().entries.some(x=>x.id===entry.id),false);
 const captured=store.capture(snapshot.entries);assert.equal(captured.status,'ready');assert(captured.entries.some(x=>x.id===entry.id));
 assert(open(A,storage).read().entries.some(x=>x.id===entry.id));assert(open(A,storage).read().ids.includes('legacy-unknown'));
 const prior=storage.map.get(store.key),writeCount=storage.writes.length;store.capture(snapshot.entries);
 assert.equal(storage.writes.length,writeCount,'a no-op capture must not rewrite storage');assert.equal(storage.map.get(store.key),prior);
});

test('a full collection refuses an additional favorite without changing the prior record',()=>{
 const storage=memory(),store=open(A,storage),ids=Array.from({length:300},(_,i)=>'old-'+i);
 const legacy=JSON.stringify({kind:'lantern-discovery-favorites',schemaVersion:1,owner:A,ids});storage.map.set(store.key,legacy);
 const writes=storage.writes.length;assert.equal(store.toggle('stanford-jobs-2005').status,'blocked');
 assert.equal(storage.map.get(store.key),legacy);assert.equal(storage.writes.length,writes);assert.equal(store.read().ids.length,300);
});

test('quota failure is atomic and forged destination cannot become retained metadata',async()=>{
 const storage=memory(),store=open(A,storage);
 const result=await feed.refreshDiscoveryFeed({storage,fetchImpl:fetcher(row(1))});const entry=result.entries.find(x=>x.id==='99pi-'+guid(1));
 const forged={...entry,sourceUrl:'https://99percentinvisible.org.evil.invalid/episode/stolen/'};
 const originalWrites=storage.writes.length;assert.equal(store.toggle(forged.id,forged).status,'blocked');assert.equal(storage.writes.length,originalWrites);assert(!store.read().ids.includes(forged.id));
 assert.equal(store.toggle(entry.id,entry).status,'ready');const prior=storage.map.get(store.key);
 const quotaStore=open(A,{getItem:storage.getItem,setItem(){throw Error('quota');}});
 assert.equal(quotaStore.toggle(entry.id,entry).status,'blocked');assert.equal(storage.map.get(store.key),prior);
 assert(open(A,storage).read().entries.some(x=>x.id===entry.id));
 const tampered=JSON.parse(prior);tampered.items[0].sourceUrl='https://attacker.invalid/';const bad=JSON.stringify(tampered);
 storage.map.set(store.key,bad);const count=storage.writes.length;assert.equal(store.read().status,'blocked');assert.equal(store.toggle(entry.id,entry).status,'blocked');assert.equal(storage.map.get(store.key),bad);assert.equal(storage.writes.length,count);
});

test('actual discovery view renders a saved episode absent from the current feed',async()=>{
 const local=memory(),session=memory();
 const first=await feed.refreshDiscoveryFeed({storage:local,fetchImpl:fetcher(row(1))});
 const entry=first.entries.find(x=>x.id==='99pi-'+guid(1));open(A,local).toggle(entry.id,entry);
 const rotated=await feed.refreshDiscoveryFeed({storage:local,fetchImpl:fetcher(Array.from({length:50},(_,i)=>row(i+2)).join(''))});
 assert(!rotated.entries.some(x=>x.id===entry.id));
 let cursor=0,dirty=true,tree;const slots=[],pending=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;dirty=true;}];},useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const prior=slots[i];slots[i]={deps};pending.push(()=>{prior?.cleanup?.();slots[i].cleanup=fn();});}}};react.useLayoutEffect=react.useEffect;
 const icons=Object.fromEntries(['ArrowUpRight','Bookmark','BookOpen','ChevronLeft','FileText','Headphones','Library','RefreshCw','Search','SlidersHorizontal','Video','X'].map(x=>[x,'icon-'+x]));
 const window={localStorage:local,sessionStorage:session,scrollY:0,scrollTo(){},addEventListener(){},removeEventListener(){}};
 const sourceFeed={DISCOVERY_SEED:feed.DISCOVERY_SEED,readDiscoveryFeedCache:()=>rotated,refreshDiscoveryFeed:()=>new Promise(()=>{})};
 const uiLoader=createSourceLoader({root,imports:{react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':icons,'@/lib/discovery-feed':sourceFeed},globals:{window,requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){}}});
 const Component=uiLoader.load('app/learn/discovery-view.tsx').default,props={owner:A,canAccess:()=>true,library:null};
 const nodes=(node,pred)=>{const output=[],q=[node];while(q.length){const value=q.shift();if(value==null||typeof value!=='object')continue;if(Array.isArray(value)){q.push(...value);continue;}if(pred(value))output.push(value);q.push(value.props?.children);}return output;};
 const render=()=>{let loops=0;do{dirty=false;cursor=0;tree=Component(props);while(pending.length)pending.shift()();assert(++loops<10);}while(dirty);};
 try{
  render();const button=nodes(tree,n=>n.type==='button'&&n.props?.['aria-label']==='我的收藏')[0];assert(button);button.props.onClick();render();
  const links=nodes(tree,n=>n.props?.['data-discovery-source']===entry.id);assert.equal(links.length,1);assert.equal(links[0].props.href,entry.sourceUrl);
  const remove=nodes(tree,n=>n.props?.['data-discovery-save']===entry.id)[0];assert(remove);remove.props.onClick();render();
  assert.equal(nodes(tree,n=>n.props?.['data-discovery-source']===entry.id).length,0);
 }finally{slots.forEach(slot=>slot?.cleanup?.());}
});

// Deferred animation frames allow a test to model expiry, replacement, and
// owner changes between scheduling restoration and actually restoring it.
function returnFixture(initialState,session,access=()=>true){
 const local=memory(),frames=[],scrolls=[],focuses=[];let props={owner:A,canAccess:access,library:null,initialReturn:initialState,onReturnConsumed:()=>{consumed++;}},cursor=0,dirty=true,tree,consumed=0;
 const slots=[],pending=[],same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;dirty=true;}];},useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const prior=slots[i];slots[i]={deps};pending.push(()=>{prior?.cleanup?.();slots[i].cleanup=fn();});}}};react.useLayoutEffect=react.useEffect;
 const icons=Object.fromEntries(['ArrowUpRight','Bookmark','BookOpen','ChevronLeft','FileText','Headphones','Library','RefreshCw','Search','SlidersHorizontal','Video','X'].map(x=>[x,'icon-'+x]));
 const window={localStorage:local,sessionStorage:session,scrollY:0,scrollTo(value){scrolls.push(value.top);},addEventListener(){},removeEventListener(){}};
 const seed={entries:feed.DISCOVERY_SEED,sources:[],status:'seed',refreshedAt:null};
 const sourceFeed={DISCOVERY_SEED:feed.DISCOVERY_SEED,readDiscoveryFeedCache:()=>seed,refreshDiscoveryFeed:()=>new Promise(()=>{})};
 const uiLoader=createSourceLoader({root,imports:{react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':icons,'@/lib/discovery-feed':sourceFeed},globals:{window,requestAnimationFrame:fn=>{frames.push({fn,cancelled:false});return frames.length;},cancelAnimationFrame:id=>{if(frames[id-1])frames[id-1].cancelled=true;}}});
 const Component=uiLoader.load('app/learn/discovery-view.tsx').default;
 const attach=(node,id=null)=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(child=>attach(child,id));return;}const next=node.props?.['data-discovery-id']??id,ref=node.props?.ref;if(typeof ref==='function')ref({focus(){focuses.push({id:next,control:node.props?.['data-discovery-control']});}});attach(node.props?.children,next);};
 const render=()=>{let loops=0;do{dirty=false;cursor=0;tree=Component(props);attach(tree);while(pending.length)pending.shift()();assert(++loops<10);}while(dirty);};
 render();return {frames,scrolls,focuses,session,get consumed(){return consumed;},render,update(next){props={...props,...next};render();},flush(){for(const frame of frames.splice(0)){if(!frame.cancelled)frame.fn();}render();},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
const returns=loader.load('lib/discovery-return.ts');
const savedReturn={category:'all',query:'',savedOnly:false,scroll:315,entryId:null};

test('current owner restoration scrolls once, consumes the return and clears the session record',()=>{
 const session=memory();assert(returns.rememberDiscoveryReturn(A,savedReturn,session));const h=returnFixture(savedReturn,session);
 try{h.flush();assert.deepEqual(h.scrolls,[315]);assert.equal(h.consumed,1);assert.equal(returns.readDiscoveryReturn(A,session),null);h.render();h.flush();assert.deepEqual(h.scrolls,[315]);assert.equal(h.consumed,1);}finally{h.unmount();}
});

test('return restores the exact originating control at a nonzero scroll position, with legacy fallback',()=>{
 for(const control of ['cover','title','source',undefined]){
  const state={...savedReturn,scroll:640,entryId:'nasa-skywatching-nov2026',...control?{entryControl:control}:{}};
  const session=memory();assert(returns.rememberDiscoveryReturn(A,state,session));const h=returnFixture(state,session);
  try{h.flush();assert.deepEqual(h.scrolls,[640]);assert.deepEqual(h.focuses,[{id:state.entryId,control:control??'source'}]);assert.equal(h.consumed,1);assert.equal(returns.readDiscoveryReturn(A,session),null);}finally{h.unmount();}
 }
});

test('expired or replaced return does not scroll or clear newer session, but consumes old in-memory return',()=>{
 for(const variant of ['expired','replaced','replaced-identical']){
  const session=memory(),stamp=Date.now()-1000;assert(returns.rememberDiscoveryReturn(A,savedReturn,session,stamp));const h=returnFixture(savedReturn,session);
  try{
   const key=[...session.map.keys()][0];
   if(variant==='expired'){const record=JSON.parse(session.map.get(key));record.savedAt=Date.now()-31*60*1000;session.map.set(key,JSON.stringify(record));}
   else if(variant==='replaced-identical')assert(returns.rememberDiscoveryReturn(A,savedReturn,session,stamp));
   else assert(returns.rememberDiscoveryReturn(A,{...savedReturn,scroll:800,query:'new'},session));
   const bytes=session.map.get(key);h.flush();assert.deepEqual(h.scrolls,[]);assert.equal(h.consumed,1);assert.equal(session.map.get(key),bytes);h.render();h.flush();assert.equal(h.consumed,1);
  }finally{h.unmount();}
 }
});

test('old A/B/A frame and revoked access cannot restore or consume the old owner return',()=>{
 const session=memory();assert(returns.rememberDiscoveryReturn(A,savedReturn,session));let permitted=true;const access=()=>permitted;const h=returnFixture(savedReturn,session,access);
 try{
  const stale=h.frames.find(f=>!f.cancelled);assert(stale);h.update({owner:B,canAccess:()=>true});h.update({owner:A,canAccess:()=>true});
  const before=session.map.get([...session.map.keys()][0]),count=h.consumed;stale.fn();assert.deepEqual(h.scrolls,[]);assert.equal(h.consumed,count);assert.equal(session.map.get([...session.map.keys()][0]),before);
 }finally{h.unmount();}
 const session2=memory();assert(returns.rememberDiscoveryReturn(A,savedReturn,session2));const h2=returnFixture(savedReturn,session2,access);
 try{const old=h2.frames.find(f=>!f.cancelled);assert(old);permitted=false;old.fn();assert.deepEqual(h2.scrolls,[]);assert.equal(h2.consumed,0);assert(returns.readDiscoveryReturn(A,session2));}finally{h2.unmount();}
});
