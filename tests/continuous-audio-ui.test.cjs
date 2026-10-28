// Executes shipped SpeechPlayer, explicit lease wrapper and lesson-audio. DOM/media/TTS are fixtures.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,imports={},globals={}){const exports={},code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInNewContext(code,{exports,require:n=>{if(!(n in imports))return require('./helpers/actual-source-loader.cjs').createSourceLoader({root,imports,globals,permitLearningAccess:true}).resolve(n,file);return imports[n];},crypto:crypto.webcrypto,TextEncoder,structuredClone,Event,setTimeout,clearTimeout,...globals},{filename:file});return exports;}
const textOf=n=>n==null?'':typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(textOf).join(''):textOf(n.props?.children);
function nodes(tree,fn){const out=[],todo=[tree];while(todo.length){const n=todo.shift();if(Array.isArray(n)){todo.push(...n);continue;}if(n&&typeof n==='object'){if(fn(n))out.push(n);todo.push(n.props?.children);}}return out;}
const tick=()=>new Promise(setImmediate),FILE='0123456789abcdef0123.mp3',OTHER_FILE='1123456789abcdef0123.mp3';
const sourceId=file=>'bundled:'+file+':'+file;
const checkpoint=(file,position=6.25,trackId='question',rate=1)=>({trackId,sourceId:sourceId(file),kind:'bundled',capability:'time',positionSeconds:position,rate});
function environment(){
 let clock=0;const media=[],nextAudio=[],nativeListeners=new Set(),toasts=[],utterances=[],window=new EventTarget(),document=new EventTarget();
 document.visibilityState='visible';document.querySelectorAll=()=>media.filter(a=>a.parentNode&&!a.removed);window.speechSynthesis={cancel(){},getVoices:()=>[],speak(u){utterances.push(u);}};
 class Audio extends EventTarget{
  constructor(options={}){super();this.options=options;this.id=media.length+1;this._src='';this.currentSrc='';this._time=0;this.duration=30;this.readyState=1;this.paused=true;this.ended=false;this.seeking=false;this.muted=false;this.volume=1;this.playbackRate=1;this.plays=0;this.loads=0;this.removes=0;this.srcRemovals=0;this.parentNode=null;this.removed=false;this.error=null;this.listeners=new Map();this.loadGeneration=0;this.seekable={length:1,start:()=>0,end:()=>this.duration};media.push(this);}
  get src(){return this._src;}set src(v){this._src=v?new URL(v,'https://lantern.local/').href:'';}
  get currentTime(){return this._time;}set currentTime(v){if(this.options.throwSeek)throw Error('synthetic seek failure');this._time=v;this.seeking=true;queueMicrotask(()=>{this.seeking=false;this.dispatchEvent(new Event('seeked'));});}
  addEventListener(type,listener,options){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);super.addEventListener(type,listener,options);}
  removeEventListener(type,listener,options){this.listeners.get(type)?.delete(listener);super.removeEventListener(type,listener,options);}
  queuedListeners(){return new Map([...this.listeners].map(([type,values])=>[type,[...values]]));}
  play(){this.plays++;if(this.options.rejectPlay)return Promise.reject(Error('synthetic codec'));this.paused=false;queueMicrotask(()=>{if(!this.paused){this.dispatchEvent(new Event('playing'));this.dispatchEvent(new Event('timeupdate'));}});return Promise.resolve();}
  pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
  load(){this.loads++;const generation=++this.loadGeneration;this.paused=true;this._time=0;this.readyState=0;this.duration=NaN;this.currentSrc='';if(this.src&&!this.options.deferMetadata)queueMicrotask(()=>{if(generation===this.loadGeneration)this.metadata();});}
  metadata(){this.readyState=1;this.duration=30;this.currentSrc=this.src;this.dispatchEvent(new Event('loadedmetadata'));}
  removeAttribute(name){assert.equal(name,'src');this.srcRemovals++;this.src='';}
  remove(){this.removes++;this.removed=true;if(this.parentNode){const h=this.parentNode;h.children=h.children.filter(a=>a!==this);this.parentNode=null;}}
  sustain(){this.dispatchEvent(new Event('timeupdate'));for(let i=0;i<3;i++){clock+=250;this._time+=.25*this.playbackRate;this.dispatchEvent(new Event('timeupdate'));}}
 }
 document.createElement=tag=>{assert.equal(tag,'audio');return new Audio(nextAudio.shift()||{});};
 class FixtureDate extends Date{static now(){return 1700000000000+clock;}}
 const globals={window,document,Date:FixtureDate,performance:{now:()=>clock},SpeechSynthesisUtterance:class{constructor(text){this.text=text;}}};
 const lesson=load('lib/lesson-audio.ts',{},globals),explicit=load('lib/explicit-bundled-playback.ts',{'./lesson-audio':lesson},globals),canonical=load('lib/domain-command.ts'),training=load('lib/practice-training.ts',{'./domain-command':canonical}),model=load('lib/study-model.ts');
 let active;const react={useState:x=>active.useState(x),useRef:x=>active.useRef(x),useEffect:(fn,deps)=>active.useEffect(fn,deps)};
 const jsx=(type,props,key)=>({type,props,key}),stubs=new Proxy({},{get:(_,key)=>String(key)}),imports={react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':stubs,sonner:{toast:{error(message){toasts.push(message);}}},'@/lib/domain-command':canonical,'@/lib/practice-training':training,'@/lib/study-model':model,'./use-practice-training':{},'@/lib/lesson-audio':lesson,'@/lib/explicit-bundled-playback':explicit,'@/lib/native-host':{subscribeNativeState(fn){nativeListeners.add(fn);return()=>nativeListeners.delete(fn);},registerNativeBack:()=>()=>{}}};
 for(const name of ['dialog','tabs','radio-group','select','progress'])imports['@/components/ui/'+name]=stubs;
 const SpeechPlayer=load('app/learn/practice.tsx',imports,globals).SpeechPlayer;
 function player(props){
  let slots=[],cursor=0,effects=[],tree,closed=false;const deferred=[],history=[],host={children:[],appendChild(audio){assert(audio instanceof Audio);assert(!audio.parentNode);audio.parentNode=host;audio.removed=false;host.children.push(audio);history.push(audio);return audio;}};
  const runtime={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){const slot={deps};slots[i]=slot;effects.push({old,slot,fn});}}};
  const render=({deferCleanup=false}={})=>{assert(!closed);active=runtime;cursor=0;tree=SpeechPlayer(props);for(const n of nodes(tree,n=>n.type==='span'&&n.props?.ref))n.props.ref.current=host;const pending=effects;effects=[];for(const {old,slot,fn}of pending){if(old?.cleanup){if(deferCleanup)deferred.push(old.cleanup);else old.cleanup();}slot.cleanup=fn();}return tree;};
  const click=(restart=false)=>{const buttons=nodes(tree,n=>n.type==='button'),b=restart?buttons.find(n=>/^从头播放 /.test(n.props['aria-label']||'')):buttons[0];assert.ok(b,restart?'Explicit replay button':'Play/pause button');b.props.onClick();render();};
  render();return {props,host,audios:history,get audio(){return history.at(-1);},get tree(){return tree;},render,click,update(next,options){Object.assign(props,next);render(options);render();},flushDeferredCleanup(){for(const fn of deferred.splice(0))fn();},close(){if(closed)return;for(const n of nodes(tree,n=>n.type==='span'&&n.props?.ref))n.props.ref.current=null;for(const s of slots)s?.cleanup?.();for(const fn of deferred.splice(0))fn();closed=true;}};
 }
 return {lesson,player,window,document,media,toasts,utterances,nativeListeners,queueAudio:options=>nextAudio.push(options),advance:milliseconds=>clock+=milliseconds,native(active){for(const fn of [...nativeListeners])fn(active);}};
}
async function confirm(p){await tick();assert(p.audio,'Explicit action creates media');p.audio.sustain();p.render();}
function lateEvents(audio,queued){for(const type of ['seeked','playing','timeupdate','ended','error']){audio.dispatchEvent(new Event(type));for(const fn of queued.get(type)||[])typeof fn==='function'?fn.call(audio,new Event(type)):fn.handleEvent(new Event(type));}}

test('only the latest confirmed bundled sentence captures on global stop; old mounted players cannot overwrite it',async()=>{
 const e=environment(),events=[];const one=e.player({text:'First.',trackId:'sentence:0',onCheckpoint:v=>events.push(v.trackId)}),two=e.player({text:'Second.',trackId:'sentence:1',onCheckpoint:v=>events.push(v.trackId)});
 e.lesson.installBundledLessonAudio([{text:'First.',file:FILE},{text:'Second.',file:OTHER_FILE}]);two.update({});one.update({});two.click();await confirm(two);one.click();await confirm(one);one.click();events.length=0;e.lesson.stopLessonAudio();assert.ok(events.length);assert.ok(events.every(v=>v==='sentence:0'));assert.equal(e.utterances.length,0,'No system TTS fallback');assert.ok(e.media.every(a=>a.paused));two.close();one.close();
});
test('native checkpoint restoration is silent; pause/resume and explicit restart keep distinct positions',async()=>{
 const e=environment(),events=[];e.lesson.installBundledLessonAudio([{text:'Native.',file:FILE}]);const p=e.player({text:'Native.',trackId:'sentence:0',checkpoint:checkpoint(FILE,6.25,'sentence:0',.85),onCheckpoint:v=>events.push(v)});
 try{assert.equal(p.audios.length,0);assert.equal(events.length,0);p.click();await tick();p.render();const first=p.audio;assert.equal(first.currentTime,6.25);assert.equal(first.plays,1);assert.equal(events.length,0);first.sustain();first.currentTime=9.5;await tick();p.render();p.click();assert.equal(events.at(-1).positionSeconds,9.5);p.click();await tick();p.render();const second=p.audio;assert.notEqual(second,first);assert.equal(first.removed,true);assert.equal(first.src,'');assert.equal(second.currentTime,9.5);second.sustain();p.render();p.click();p.click(true);await tick();p.render();const replay=p.audio;assert.notEqual(replay,second);assert.equal(replay.currentTime,0);replay.sustain();assert.ok(events.at(-1).positionSeconds>0&&events.at(-1).positionSeconds<1);assert.equal(p.audios.length,3);}finally{p.close();}
});
test('old TTS cleanup never cancels the newly started source',()=>{
 const e=environment();let cancels=0;e.window.speechSynthesis.cancel=()=>cancels++;const one=e.player({text:'One.'}),two=e.player({text:'Two.'});one.click();two.click();const before=cancels;one.close();assert.equal(cancels,before);two.close();
});
test('an unconfirmed new bundled source cannot replace the last valid track with zero',async()=>{
 const e=environment(),events=[];e.lesson.installBundledLessonAudio([{text:'Good.',file:FILE},{text:'Failure.',file:OTHER_FILE}]);const good=e.player({text:'Good.',trackId:'question',onCheckpoint:v=>events.push(v)}),bad=e.player({text:'Failure.',trackId:'sentence:0',onCheckpoint:v=>events.push(v)});
 try{good.click();await confirm(good);good.audio.currentTime=8.7;await tick();good.render();good.click();e.queueAudio({rejectPlay:true});events.length=0;bad.click();await tick();bad.render();e.lesson.stopLessonAudio();assert.ok(nodes(bad.tree,n=>n.props?.role==='alert').length,'Current failure stays visible inline');assert.ok(events.length);assert.ok(events.every(v=>v.trackId==='question'&&v.positionSeconds===8.7));assert.equal(bad.audios.length,1);}finally{bad.close();good.close();}
});
test('unconfirmed native resume can be cancelled by pause or background before metadata',async()=>{
 for(const action of ['pause','background','native','record-global']){
  const e=environment(),events=[];e.lesson.installBundledLessonAudio([{text:'Pending.',file:FILE}]);const p=e.player({text:'Pending.',trackId:'question',checkpoint:checkpoint(FILE),onCheckpoint:v=>events.push(v)});
  try{e.queueAudio({deferMetadata:true});p.click();await tick();p.render();const pending=p.audio,queued=pending.queuedListeners();assert.equal(pending.plays,0);if(action==='pause')p.click();else if(action==='background'){e.document.visibilityState='hidden';e.document.dispatchEvent(new Event('visibilitychange'));}else if(action==='native')e.native(false);else e.lesson.stopLessonAudio();pending.metadata();lateEvents(pending,queued);await tick();assert.equal(pending.plays,0,action);assert.equal(events.length,0,action);assert.equal(e.toasts.length,0,action);assert.equal(p.audios.length,1);assert(pending.paused);}finally{p.close();}
 }
});
test('React unmount clears the DOM ref before cleanup without erasing a confirmed bundled checkpoint',async()=>{
 const e=environment(),events=[];e.lesson.installBundledLessonAudio([{text:'Unmount.',file:FILE}]);const p=e.player({text:'Unmount.',trackId:'question',onCheckpoint:v=>events.push(v)});p.click();await confirm(p);p.audio.currentTime=8.7;await tick();p.render();p.click();events.length=0;p.close();assert.ok(events.length);assert.ok(events.every(v=>v.positionSeconds===8.7&&v.trackId==='question'&&v.sourceId===sourceId(FILE)));assert.equal(p.audio.removed,true);assert.equal(p.host.children.length,0);assert.equal(e.nativeListeners.size,0);
});
test('one factory call per explicit action; rerenders keep the current node and old resources are released',async()=>{
 const e=environment();e.lesson.installBundledLessonAudio([{text:'Identity.',file:FILE}]);const p=e.player({text:'Identity.',checkpoint:checkpoint(FILE)});
 try{assert.equal(e.media.length,0);p.click();await confirm(p);const first=p.audio;for(let i=0;i<4;i++)p.render();assert.equal(p.audio,first);assert.equal(e.media.length,1);p.click();assert.equal(e.media.length,1,'Pause does not create media');p.click();await confirm(p);const second=p.audio;assert.notEqual(second,first);assert.equal(e.media.length,2);assert.equal(first.removes,1);assert.equal(first.srcRemovals,1);assert.equal(first.loads,2);assert.deepEqual(p.host.children,[second]);p.click();p.click(true);await confirm(p);assert.equal(e.media.length,3);assert.equal(second.removed,true);assert.equal(p.host.children.length,1);}finally{p.close();}
});
test('late retired lease events cannot change the new node, position or checkpoint owner',async()=>{
 const e=environment(),events=[];e.lesson.installBundledLessonAudio([{text:'Lease.',file:FILE}]);const p=e.player({text:'Lease.',checkpoint:checkpoint(FILE),onCheckpoint:v=>events.push(v)});
 try{p.click();await confirm(p);const old=p.audio,queued=old.queuedListeners();old.currentTime=8.7;await tick();p.render();p.click();p.click();await confirm(p);const current=p.audio;assert.notEqual(current,old);const before=events.length;old._time=0;old.error={code:2};lateEvents(old,queued);p.render();assert.equal(p.audio,current);assert.equal(current.paused,false);assert.equal(events.length,before);assert.equal(e.toasts.length,0);assert.equal(p.host.children.length,1);assert.equal(p.host.children[0],current);}finally{p.close();}
});
test('failed explicit replay preserves the prior positive checkpoint until a later replay confirms',async()=>{
 const e=environment(),events=[];e.lesson.installBundledLessonAudio([{text:'Replay.',file:FILE}]);const p=e.player({text:'Replay.',checkpoint:checkpoint(FILE),onCheckpoint:v=>events.push(v)});
 try{p.click();await confirm(p);p.audio.currentTime=8.7;await tick();p.render();p.click();const prior=p.audio;e.queueAudio({rejectPlay:true});events.length=0;p.click(true);await tick();p.render();const failed=p.audio;assert.notEqual(failed,prior);assert.equal(p.audios.length,2);assert.equal(failed.plays,1);assert.ok(nodes(p.tree,n=>n.props?.role==='alert').length,'Current replay failure stays visible inline');e.lesson.stopLessonAudio();assert.ok(events.length);assert.ok(events.every(v=>v.positionSeconds===8.7&&v.sourceId===sourceId(FILE)));p.click(true);await tick();p.render();assert.equal(p.audios.length,3);assert.equal(p.audio.currentTime,0);p.audio.sustain();p.render();assert.ok(events.at(-1).positionSeconds>0&&events.at(-1).positionSeconds<1);}finally{p.close();}
});
test('same-source callback updates use the latest parent without creating another Audio',async()=>{
 const e=environment(),oldEvents=[],newEvents=[];e.lesson.installBundledLessonAudio([{text:'Callback.',file:FILE}]);const p=e.player({text:'Callback.',checkpoint:checkpoint(FILE),onCheckpoint:v=>oldEvents.push(v)});
 try{p.click();await tick();const audio=p.audio;p.update({onCheckpoint:v=>newEvents.push(v)});audio.sustain();p.render();assert.equal(p.audio,audio);assert.equal(p.audios.length,1);assert.ok(newEvents.length,'Current source confirmation follows current parent callback');const oldCount=oldEvents.length;e.advance(5001);audio._time=8.7;audio.dispatchEvent(new Event('timeupdate'));p.render();assert.equal(oldEvents.length,oldCount);assert.equal(newEvents.at(-1).positionSeconds,8.7);p.click();assert.equal(newEvents.at(-1).positionSeconds,8.7);}finally{p.close();}
});
test('old scope cleanup captures only its own source and cannot retire or write the new controller',async()=>{
 for(const deferred of [false,true]){
  const e=environment(),oldEvents=[],newEvents=[];e.lesson.installBundledLessonAudio([{text:'Old scope.',file:FILE},{text:'New scope.',file:OTHER_FILE}]);const p=e.player({text:'Old scope.',trackId:'question',checkpoint:checkpoint(FILE),onCheckpoint:v=>oldEvents.push(v)});
  try{p.click();await confirm(p);const old=p.audio;old.currentTime=9.5;await tick();p.render();p.update({text:'New scope.',trackId:'sentence:1',checkpoint:checkpoint(OTHER_FILE,2.5,'sentence:1'),onCheckpoint:v=>newEvents.push(v)},{deferCleanup:deferred});assert.equal(newEvents.length,0,'Old cleanup cannot write new callback');if(!deferred)assert.equal(oldEvents.at(-1).positionSeconds,9.5);p.click();await confirm(p);const current=p.audio;assert.notEqual(current,old);assert.equal(current.plays,1);assert.equal(p.audios.length,2);assert.equal(current.paused,false);const beforeNew=newEvents.length,beforeOld=oldEvents.length;p.flushDeferredCleanup();p.render();assert.equal(p.audio,current);assert.equal(current.paused,false);assert.equal(newEvents.length,beforeNew);assert.equal(oldEvents.length,beforeOld);e.lesson.stopLessonAudio();assert.ok(newEvents.length>beforeNew);assert.ok(newEvents.every(v=>v.sourceId===sourceId(OTHER_FILE)&&v.trackId==='sentence:1'));assert.ok(oldEvents.every(v=>v.sourceId===sourceId(FILE)&&v.trackId==='question'));}finally{p.close();}
 }
});
test('confirmed bundled native background, pagehide, visibility and recording global stop preserve the point',async()=>{
 for(const boundary of ['native','pagehide','visibility','record-global']){
  const e=environment(),events=[];e.lesson.installBundledLessonAudio([{text:'Boundary.',file:FILE}]);const p=e.player({text:'Boundary.',checkpoint:checkpoint(FILE),onCheckpoint:v=>events.push(v)});
  try{p.click();await confirm(p);const audio=p.audio;audio.currentTime=8.7;await tick();p.render();events.length=0;if(boundary==='native')e.native(false);else if(boundary==='pagehide')e.window.dispatchEvent(new Event('pagehide'));else if(boundary==='visibility'){e.document.visibilityState='hidden';e.document.dispatchEvent(new Event('visibilitychange'));}else e.lesson.stopLessonAudio();assert(audio.paused,boundary);assert.equal(p.audios.length,1);assert.ok(events.length,boundary);assert.ok(events.every(v=>v.positionSeconds===8.7&&v.sourceId===sourceId(FILE)),boundary);p.render();assert.match(nodes(p.tree,n=>n.type==='button')[0].props['aria-label'],/^继续 /);}finally{p.close();}
 }
});
test('unregistered speech remains closed across native and pagehide without system TTS or checkpoint invention',()=>{
 for(const boundary of ['native','pagehide']){
  const e=environment(),events=[];let cancels=0;e.window.speechSynthesis.cancel=()=>cancels++;const p=e.player({text:'TTS active.',trackId:'sentence:0',onCheckpoint:v=>events.push(v)});assert.equal(nodes(p.tree,n=>n.type==='button')[0].props.disabled,true);assert.match(textOf(p.tree),/音频尚未准备/);const beforeCancel=cancels;if(boundary==='native')e.native(false);else e.window.dispatchEvent(new Event('pagehide'));assert.equal(cancels,beforeCancel);assert.equal(events.length,0);assert.equal(e.utterances.length,0);assert.equal(e.media.length,0);p.close();
 }
});
