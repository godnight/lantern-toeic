// Real shared RecordingPlayer; synthetic media properties/events and React commit
// hooks only. No decoder, device, learner storage, repository migration or network.
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const source=path.join(root,'app/learn/recording-player.tsx');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function nodes(tree,predicate){if(tree==null||typeof tree==='boolean')return [];if(Array.isArray(tree))return tree.flatMap(node=>nodes(node,predicate));if(typeof tree!=='object')return [];return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(tree==null||typeof tree==='boolean')return '';if(Array.isArray(tree))return tree.map(text).join('');if(typeof tree!=='object')return String(tree);return text(tree.props?.children);}
function harness(initial={}){
 let cursor=0,slots=[],effects=[],dirty=false,tree,audioVNode,audio,clock=0,nextTimer=1,mounted=true;
 const timers=new Map(),revoked=[],created=[],elements=[],windowEvents=new Map(),nativeListeners=new Set(),traces=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useMemo(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
  useCallback(fn,deps){return react.useMemo(()=>fn,deps);},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i],slot={deps,setup:fn};slots[i]=slot;effects.push(()=>{old?.cleanup?.();slot.cleanup=fn();});}}
 };
 react.useLayoutEffect=react.useEffect;
 function element(){const listeners=new Map();const node={duration:NaN,currentTime:0,readyState:0,networkState:2,paused:true,ended:false,error:null,src:'',currentSrc:'',muted:false,playCalls:0,pauseCalls:0,loadCalls:0,
  addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn),
  getAttribute:name=>name==='src'?node.src:null,play(){node.playCalls++;return Promise.resolve();},pause(){node.pauseCalls++;node.paused=true;},load(){node.loadCalls++;},listeners};elements.push(node);return node;}
 const jsx=(type,props,key)=>({type,props,key});
 const exports={};const imports={react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':new Proxy({},{get:(_,key)=>String(key)}),'@/lib/recording-media-diagnostics':{recordingMediaTrace(event,src,audio){traces.push({event,src,audio});}},'@/lib/native-host':{subscribeNativeState(fn){nativeListeners.add(fn);return()=>nativeListeners.delete(fn);}}};
 const code=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const URL={createObjectURL:blob=>{created.push(blob);return 'blob:unexpected-player-owned';},revokeObjectURL:url=>revoked.push(url)};
 const window={addEventListener(name,fn){if(!windowEvents.has(name))windowEvents.set(name,new Set());windowEvents.get(name).add(fn);},removeEventListener:(name,fn)=>windowEvents.get(name)?.delete(fn)};
 vm.runInNewContext(code,{exports,require(name){assert.ok(name in imports,'Unexpected shared-player import: '+name);return imports[name];},window,URL,Date,Number,Math,Promise,setTimeout(fn,ms){const id=nextTimer++;timers.set(id,{fn,due:clock+ms});return id;},clearTimeout:id=>timers.delete(id)},{filename:source});
 let props={src:'blob:history-original',label:'回听本次录音',...initial};
 function ref(ref,value){if(typeof ref==='function')ref(value);else if(ref)ref.current=value;}
 function render(next){assert.ok(mounted,'Cannot render after unmount');if(next)props={...props,...next};let rounds=0;do{assert.ok(++rounds<=12,'Shared component must settle without a render loop');dirty=false;cursor=0;tree=exports.RecordingPlayer(props);const nextVNode=nodes(tree,node=>node.type==='audio')[0];
  if(!nextVNode){if(audioVNode)ref(audioVNode.props.ref,null);audio=undefined;audioVNode=undefined;}
  else{if(!audioVNode||audioVNode.key!==nextVNode.key){if(audioVNode)ref(audioVNode.props.ref,null);audio=element();}else if(audioVNode.props.ref!==nextVNode.props.ref)ref(audioVNode.props.ref,null);
   audioVNode=nextVNode;audio.props=nextVNode.props;audio.src=nextVNode.props.src;audio.currentSrc=audio.src;ref(nextVNode.props.ref,audio);}
  const pending=effects;effects=[];pending.forEach(run=>run());
 }while(dirty);return tree;}
 const eventProps={loadstart:'onLoadStart',loadedmetadata:'onLoadedMetadata',durationchange:'onDurationChange',canplay:'onCanPlay',playing:'onPlaying',play:'onPlay',pause:'onPause',ended:'onEnded',error:'onError',waiting:'onWaiting',stalled:'onStalled',emptied:'onEmptied',abort:'onAbort',timeupdate:'onTimeUpdate'};
 function emit(name,values={},target=audio,callbacks=target?.props){assert.ok(target,'Need committed audio node for '+name);Object.assign(target,values);const event={currentTarget:target,target,type:name};callbacks?.[eventProps[name]]?.(event);for(const fn of [...target.listeners.get(name)||[]])fn(event);return render();}
 function cleanup(){if(!mounted)return;mounted=false;for(const slot of slots)slot?.cleanup?.();if(audioVNode)ref(audioVNode.props.ref,null);}
 function advance(ms){clock+=ms;const ready=[...timers].filter(([,timer])=>timer.due<=clock);for(const [id,timer] of ready){timers.delete(id);timer.fn();}return render();}
 render();return {render,emit,advance,cleanup,revoked,created,elements,timers,traces,windowEvents,nativeListeners,windowEvent(name){for(const fn of windowEvents.get(name)||[])fn();},nativeState(active){for(const fn of nativeListeners)fn(active);},get tree(){return tree;},get audio(){return audio;},get props(){return props;},strictReplay(){const active=slots.filter(slot=>slot?.setup);for(const slot of active){slot.cleanup?.();slot.cleanup=undefined;}for(const slot of active)slot.cleanup=slot.setup();return render();},retry(){const button=nodes(tree,node=>node.type==='button'&&/重新读取|重试/.test(text(node)))[0];assert.ok(button,'An explicit retry button must be visible');return button.props.onClick();}};
}

test('shared history/current player consumes the supplied URL and defaults to manual playback',t=>{
 const h=harness();t.after(h.cleanup);assert.equal(h.audio.props.controls,true);assert.equal(h.audio.props.src,'blob:history-original');assert.notEqual(h.audio.props.autoPlay,true);assert.equal(h.audio.playCalls,0);assert.deepEqual(h.created,[]);assert.deepEqual(h.revoked,[]);
});
test('explicit playback speeds update the existing audio element and survive its metadata readiness',t=>{
 const h=harness();t.after(h.cleanup);const original=h.audio;let select=nodes(h.tree,n=>n.type==='select'&&n.props['aria-label']==='录音回听速度')[0];assert.ok(select);
 for(const rate of [.75,1.25,1.5,1]){select.props.onChange({target:{value:String(rate)}});h.render();h.emit('loadedmetadata',{duration:6,readyState:1});assert.equal(h.audio,original);assert.equal(h.audio.playbackRate,rate);select=nodes(h.tree,n=>n.type==='select')[0];assert.equal(select.props.value,rate);}
 select.props.onChange({target:{value:'99'}});h.render();assert.equal(h.audio.playbackRate,1);assert.equal(h.audio.playCalls,0);assert.deepEqual(h.revoked,[]);
});
test('history may request autoplay while current-clip class and accessible label are retained',t=>{
 const h=harness({autoPlay:true,className:'speaking-audio',label:'当前录音回听'});t.after(h.cleanup);assert.equal(h.audio.props.autoPlay,true);assert.equal(h.audio.props.className,'speaking-audio');assert.equal(h.audio.props['aria-label'],'当前录音回听');
});
for(const [code,description] of [[1,/中断|中止|取消/],[2,/网络|读取/],[3,/解码/],[4,/格式|支持/]])test(`MediaError ${code} displays a readable reason without replacing or revoking the mounted Blob URL`,t=>{
 const h=harness({onRetry(){}});t.after(h.cleanup);const original=h.audio;h.emit('error',{error:{code,message:'synthetic native diagnostic'},networkState:3});
 assert.equal(h.audio,original);assert.equal(h.audio.props.src,'blob:history-original');assert.match(text(h.tree),description);assert.match(text(h.tree),/保留|原录音/);assert.equal(nodes(h.tree,node=>node.props?.role==='alert').length>0,true);assert.deepEqual(h.revoked,[]);assert.deepEqual(h.created,[]);h.render();assert.equal(h.audio,original);assert.deepEqual(h.revoked,[]);
});
test('missing MediaError information still explains failure without claiming the original file is damaged',t=>{
 const h=harness();t.after(h.cleanup);h.emit('error',{error:null});assert.match(text(h.tree),/无法|失败|错误/);assert.doesNotMatch(text(h.tree),/文件已损坏|录音已损坏/);assert.deepEqual(h.revoked,[]);
});
test('metadata duration zero is explicitly unplayable; a later positive metadata duration recovers readiness',t=>{
 const h=harness();t.after(h.cleanup);h.emit('loadedmetadata',{duration:0,readyState:1});assert.match(text(h.tree),/时长.*0|0.*时长|零时长/);assert.match(text(h.tree),/无法|不能|不可/);assert.match(text(h.tree),/保留|原录音/);assert.doesNotMatch(text(h.tree),/正在播放|正在回听/);
 h.emit('playing',{duration:0,readyState:4,paused:false});assert.doesNotMatch(text(h.tree),/正在播放|正在回听/);assert.match(text(h.tree),/无法|不能|不可/);
 h.emit('durationchange',{duration:6,readyState:1,paused:true});assert.doesNotMatch(text(h.tree),/零时长|时长.*0|0.*时长/);h.emit('playing',{readyState:4,paused:false});assert.match(text(h.tree),/正在播放|正在回听/);assert.deepEqual(h.revoked,[]);
});
for(const readyState of [1,4])test(`known finite zero metadata then playing at readyState ${readyState} retains an explained unavailable state`,t=>{
 const h=harness();t.after(h.cleanup);const original=h.audio;h.emit('loadedmetadata',{duration:0,readyState:1,paused:true});
 for(let i=0;i<2;i++){h.emit('playing',{duration:0,readyState,paused:false});assert.doesNotMatch(text(h.tree),/正在播放|正在回听/);assert.match(text(h.tree),/时长.*0|0.*时长|零时长/);assert.match(text(h.tree),/无法|不能|不可/);assert.match(text(h.tree),/保留|原录音/);assert.equal(nodes(h.tree,node=>node.props?.role==='alert').length>0,true);}
 assert.equal(h.audio,original);assert.equal(h.audio.props.src,'blob:history-original');assert.equal(h.audio.playCalls,0);assert.equal(h.audio.loadCalls,0);assert.deepEqual(h.created,[]);assert.deepEqual(h.revoked,[]);
});
test('late positive duration property before its queued metadata event permits genuine playing recovery',t=>{
 const h=harness();t.after(h.cleanup);const original=h.audio;h.emit('loadedmetadata',{duration:0,readyState:1});h.emit('playing',{duration:0,readyState:4,paused:false});assert.doesNotMatch(text(h.tree),/正在播放|正在回听/);
 h.emit('playing',{duration:6,readyState:4,paused:false});assert.match(text(h.tree),/正在播放|正在回听/);assert.equal(nodes(h.tree,node=>node.props?.role==='alert').length,0);assert.equal(h.audio,original);assert.equal(h.audio.props.src,'blob:history-original');assert.deepEqual(h.created,[]);assert.deepEqual(h.revoked,[]);
});
test('unknown metadata duration remains an explained reading state and is never called real playing',t=>{
 const h=harness();t.after(h.cleanup);h.emit('loadstart');h.emit('loadedmetadata',{duration:NaN,readyState:1});assert.match(text(h.tree),/读取|时长|加载/);assert.doesNotMatch(text(h.tree),/正在播放|正在回听/);assert.equal(h.audio.playCalls,0);
});
test('ten-second read timeout is explanatory only: no retry, reload, play or URL replacement occurs',t=>{
 let retries=0;const h=harness({onRetry:()=>retries++});t.after(h.cleanup);const first=h.audio;h.advance(9999);assert.equal(retries,0);h.advance(1);assert.match(text(h.tree),/10|较久|尚未|仍未|超时/);assert.equal(retries,0);assert.equal(h.audio,first);assert.equal(h.audio.playCalls,0);assert.equal(h.audio.loadCalls,0);assert.deepEqual(h.revoked,[]);assert.deepEqual(h.created,[]);
});
test('the status distinguishes available metadata, actual playing, pause and natural ended',t=>{
 const h=harness();t.after(h.cleanup);h.emit('loadedmetadata',{duration:6,readyState:1,paused:true});assert.doesNotMatch(text(h.tree),/正在播放|正在回听/);h.emit('playing',{paused:false,readyState:4});assert.match(text(h.tree),/正在播放|正在回听/);h.emit('pause',{paused:true});assert.match(text(h.tree),/暂停/);h.emit('ended',{ended:true,currentTime:6,paused:true});assert.match(text(h.tree),/结束|播完|完成/);assert.deepEqual(h.revoked,[]);
});
test('a replaced source rejects old-node error/metadata/playing callbacks and the old reading timer',t=>{
 const h=harness();t.after(h.cleanup);const old=h.audio,callbacks={...old.props};h.render({src:'blob:next-recording'});const next=h.audio;h.emit('loadedmetadata',{duration:9,readyState:1},next);h.emit('playing',{paused:false,readyState:4},next);const before=text(h.tree);
 for(const [name,values] of [['error',{error:{code:3}}],['durationchange',{duration:0}],['playing',{paused:false}],['pause',{paused:true}]])h.emit(name,values,old,callbacks);
 h.advance(10000);assert.equal(text(h.tree),before);assert.equal(h.audio,next);assert.equal(h.audio.props.src,'blob:next-recording');assert.deepEqual(h.revoked,[]);
});
test('events from a different element are ignored even if the current source is unchanged',t=>{
 const h=harness();t.after(h.cleanup);h.emit('loadedmetadata',{duration:6,readyState:1});const before=text(h.tree),foreign={...h.audio,error:{code:3},duration:0,listeners:new Map()};
 for(const name of ['error','loadedmetadata','playing'])h.emit(name,{},foreign,h.audio.props);
 assert.equal(text(h.tree),before);assert.deepEqual(h.revoked,[]);
});
test('explicit reread is serial, retains the URL while pending, and exposes a rejected retry',async t=>{
 const request=deferred();let retries=0;const h=harness({onRetry(){retries++;return request.promise;}});t.after(h.cleanup);h.emit('error',{error:{code:2}});const first=h.audio,button=nodes(h.tree,node=>node.type==='button')[0],pending=button.props.onClick();h.render();await button.props.onClick();assert.equal(retries,1);assert.equal(h.audio,first);assert.deepEqual(h.revoked,[]);request.reject(Error('Synthetic read failure'));await pending;await tick();h.render();assert.match(text(h.tree),/读取|失败|重试/);assert.equal(retries,1);assert.deepEqual(h.revoked,[]);
});
test('a retired asynchronous retry cannot add its error or busy state to the replacement source',async t=>{
 const pending=deferred();let retries=0;const h=harness({onRetry(){retries++;return pending.promise;}});t.after(h.cleanup);h.emit('error',{error:{code:2}});h.retry();await tick();assert.equal(retries,1);h.render({src:'blob:replacement'});h.emit('loadedmetadata',{duration:8,readyState:1});h.emit('playing',{paused:false,readyState:4});const before=text(h.tree);pending.reject(Error('obsolete read failure'));await tick();h.render();assert.equal(text(h.tree),before);assert.equal(retries,1);assert.deepEqual(h.revoked,[]);
});
test('cached retry callbacks after unmount cannot start reads; cleanup and Strict replay never revoke consumer URLs',t=>{
 let retries=0;const h=harness({onRetry:()=>retries++});t.after(h.cleanup);h.strictReplay();h.emit('error',{error:{code:2}});const oldRetry=nodes(h.tree,node=>node.type==='button')[0].props.onClick;h.cleanup();oldRetry();assert.equal(retries,0);assert.equal(h.timers.size,0);assert.deepEqual(h.revoked,[]);assert.deepEqual(h.created,[]);
});
test('default current-clip reread remounts the same owned URL without creating a replacement Blob',async t=>{
 const h=harness({className:'speaking-audio'});t.after(h.cleanup);const old=h.audio;h.emit('error',{error:{code:3}});h.retry();h.render();assert.notEqual(h.audio,old);assert.equal(h.audio.props.src,'blob:history-original');assert.equal(h.audio.props.className,'speaking-audio');assert.equal(h.audio.props.autoPlay,false);assert.deepEqual(h.created,[]);assert.deepEqual(h.revoked,[]);await tick();assert.equal(old.pauseCalls,1);assert.equal(h.audio.pauseCalls,0);
});
test('Strict effect replay preserves the active element; actual replacement and unmount stop only retired elements',async()=>{
 const h=harness();const original=h.audio;h.strictReplay();await tick();assert.equal(original.pauseCalls,0);h.render({src:'blob:second'});const second=h.audio;await tick();assert.equal(original.pauseCalls,1);assert.equal(second.pauseCalls,0);h.cleanup();await tick();assert.equal(original.pauseCalls,1);assert.equal(second.pauseCalls,1);assert.deepEqual(h.revoked,[]);assert.deepEqual(h.created,[]);
});
test('a first media error survives late playback, zero metadata/end and a different repeated error until explicit reread',t=>{
 const h=harness();t.after(h.cleanup);h.emit('error',{error:{code:3}});const original=h.audio,first=text(h.tree);
 for(const [name,values] of [['playing',{paused:false}],['pause',{paused:true}],['waiting',{}],['ended',{ended:true,currentTime:6,duration:6}]]){h.emit(name,values);assert.equal(text(h.tree),first);}
 h.emit('durationchange',{error:null,duration:0,readyState:4});assert.equal(text(h.tree),first);h.emit('ended',{duration:0,currentTime:0,ended:true});assert.equal(text(h.tree),first);h.emit('error',{error:{code:2}});assert.equal(text(h.tree),first);
 h.emit('playing',{error:null,duration:0,readyState:4,paused:false});assert.equal(text(h.tree),first,'The recorded first error takes precedence over the finite-zero guard');
 h.emit('durationchange',{error:null,duration:6,readyState:4});assert.equal(text(h.tree),first);assert.equal(h.audio,original);h.retry();h.render();assert.notEqual(h.audio,original);assert.doesNotMatch(text(h.tree),/媒体错误 3/);assert.deepEqual(h.revoked,[]);
});
test('optional history download exposes the exact existing URL and filename without fetching or creating bytes',t=>{
 const h=harness({downloadName:'original-recording.webm'});t.after(h.cleanup);h.emit('error',{error:{code:4}});const download=nodes(h.tree,node=>node.type==='a'&&node.props.download)[0];assert.ok(download);assert.equal(download.props.href,h.audio.props.src);assert.equal(download.props.download,'original-recording.webm');assert.deepEqual(h.revoked,[]);assert.deepEqual(h.created,[]);
});
test('global stop/background observers only report the live lease and subscriptions retire on replacement/unmount',async()=>{
 const h=harness(),old=h.audio;h.windowEvent('lantern-stop-lesson-audio');h.windowEvent('pagehide');h.nativeState(false);assert.deepEqual(h.traces.slice(-3).map(row=>row.event),['global-stop','native-background','native-background']);assert.equal(old.playCalls,0);assert.equal(old.pauseCalls,0);
 h.render({src:'blob:observer-next'});const current=h.audio;await tick();assert.equal(h.nativeListeners.size,1);assert.equal(h.windowEvents.get('pagehide').size,1);h.windowEvent('lantern-stop-lesson-audio');assert.equal(h.traces.at(-1).audio,current);assert.equal(h.traces.at(-1).src,'blob:observer-next');h.cleanup();await tick();const count=h.traces.length;h.windowEvent('pagehide');h.nativeState(false);assert.equal(h.traces.length,count);assert.equal(h.nativeListeners.size,0);assert.equal(h.windowEvents.get('pagehide').size,0);assert.deepEqual(h.revoked,[]);
});
