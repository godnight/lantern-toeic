'use strict';
const {createSourceLoader}=require('./actual-source-loader.cjs');
const path=require('node:path');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const events=()=>{const all=new Map();return {addEventListener(t,f){if(!all.has(t))all.set(t,new Set());all.get(t).add(f);},removeEventListener(t,f){all.get(t)?.delete(f);},dispatchEvent(e){for(const f of [...all.get(e.type)||[]])f(e);},emit(t,e={}){this.dispatchEvent({type:t,...e});}};};
const storage=()=>{const rows=new Map();return {rows,getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,String(v)),removeItem:k=>rows.delete(k),get length(){return rows.size;},key:i=>[...rows.keys()][i]??null};};
function browser({owner=null,responses=[],bus=new Set()}={}){
 let now=0,wall=1000,slots=[],cursor=0,effects=[],dirty=false,value,mounted=true,timerId=0;
 const timers=new Map(),calls=[],navigation=[],posts=[],queue=[...responses],localStorage=storage(),sessionStorage=storage();
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;dirty=true;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
 class Channel {constructor(name){this.name=name;bus.add(this);}postMessage(data){posts.push(data);for(const c of [...bus])if(c!==this&&c.name===this.name)c.onmessage?.({data});}close(){bus.delete(this);}}
 class CustomEvent {constructor(type,init={}){this.type=type;this.detail=init.detail;}}
 const window={...events(),location:{origin:'https://synthetic.test',assign:p=>navigation.push(p)},localStorage,sessionStorage,BroadcastChannel:Channel},document={...events(),visibilityState:'visible'};
 const globals={window,document,localStorage,sessionStorage,BroadcastChannel:Channel,CustomEvent,performance:{now:()=>now},Date:class extends Date{static now(){return wall;}},setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),fetch:async(url,options)=>{calls.push({url,options});let r=queue.length?queue.shift():deferred();if(r instanceof Error)throw r;if(r.promise)r=await r.promise;if(r instanceof Error)throw r;return {status:r.status,headers:new Headers(r.headers),json:async()=>r.jsonPromise?await r.jsonPromise:r.body};}};
 const loader=createSourceLoader({root:path.resolve(__dirname,'../..'),imports:{react,'react-dom':{flushSync(fn){fn();render();}}},globals});
 const useSession=loader.load('lib/use-product-session.ts').useProductSession;
 function render(){if(!mounted)return;cursor=0;dirty=false;value=useSession(owner,false);const pending=effects;effects=[];pending.forEach(f=>f());}
 render();
 return {get value(){return value;},calls,navigation,posts,window,document,localStorage,sessionStorage,loader,timers,queue,render,async flush(){for(let i=0;i<12;i++){await tick();if(dirty)render();}},advance(ms,fire=true){now+=ms;if(fire)for(let i=0;i<100;i++){const due=[...timers].filter(([,t])=>t.at<=now);if(!due.length)break;for(const [id,t]of due){timers.delete(id);t.fn();}}if(dirty)render();},wall(value){wall=value;},async dispose(){mounted=false;slots.forEach(s=>s?.cleanup?.());await tick();},mounted:()=>value.status==='ready'&&value.access?.canAccess()===true};
}
exports.browser=browser;exports.deferred=deferred;
