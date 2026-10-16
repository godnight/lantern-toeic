const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const source=process.env.LANTERN_SPEAKING_SOURCE||path.join(root,'app/learn/speaking.tsx');
const ts=require(path.join(root,'node_modules/typescript'));
const prompts=JSON.parse(fs.readFileSync(path.join(root,'content/speaking.json'),'utf8'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node.props?.children);}
function nodes(tree,predicate){const queue=[tree],found=[];while(queue.length){const node=queue.shift();if(!node)continue;if(Array.isArray(node)){queue.push(...node);continue;}if(node.type==='Dialog'&&node.props.open===false)continue;if(predicate(node))found.push(node);queue.push(node.props?.children);}return found;}
function findButton(tree,label){const button=nodes(tree,node=>node.type==='button'&&text(node).includes(label))[0];assert.ok(button,`Missing visible button: ${label}`);return button;}
function hookRuntime(){let cursor=0,effects=[];const slots=[];const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));const react={
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
 useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
 useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps,setup:fn};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}
};return {react,render(component,props){cursor=0;const tree=component(props);const pending=effects;effects=[];pending.forEach(effect=>effect());return tree;},strictReplay(){const active=slots.filter(slot=>slot?.setup);for(const slot of active){slot.cleanup?.();slot.cleanup=undefined;}for(const slot of active)slot.cleanup=slot.setup();},cleanup(){for(const slot of slots){slot?.cleanup?.();if(slot?.cleanup)slot.cleanup=undefined;}}};}
function loadRoom(react,globals,native,capture={createRecordingCaptureTrace:()=>()=>{}}){const exports={};const proxy=new Proxy({},{get:(_,key)=>String(key)});const jsx=(type,props)=>({type,props});const modelCode=ts.transpileModule(fs.readFileSync(path.join(root,'lib/study-model.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const model={};vm.runInNewContext(modelCode,{exports:model,Date,Intl,crypto:{randomUUID}});
 const imports={react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':proxy,'@/components/ui/dialog':proxy,'@/components/ui/checkbox':proxy,'@/lib/study-model':model,'@/lib/native-host':native,'@/lib/lesson-audio':{stopLessonAudio(){}},'./practice':proxy,'./recording-player':{RecordingPlayer:'audio'},sonner:{toast:Object.assign(()=>{},{success(){},error(){}})}};
 const viewport={};const viewportSource=path.join(root,'lib/use-dialog-viewport.ts');const viewportCode=ts.transpileModule(fs.readFileSync(viewportSource,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(viewportCode,{exports:viewport,require(name){assert.equal(name,'react');return react;},...globals},{filename:viewportSource});imports['@/lib/use-dialog-viewport']=viewport;
 const code=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require(name){if(name==='@/lib/recording-capture-diagnostics')return capture;if(name==='@/lib/recording-media-diagnostics')return {recordingMediaTrace(){}};assert.ok(name in imports,`Unexpected import: ${name}`);return imports[name];},Blob,URL,Intl,Date,...globals},{filename:source});return exports;
}
function harness({prompt=prompts[0],manualPermissions=false,emptyClip=false,manualChunks=false,failStart=false,recovery,onRetain,onRelease,nativeMode=true,browser}={}){
 const hooks=hookRuntime(),permissions=[],recorders=[],saves=[],stopTasks=[],finished=[],captureEvents=[],sequence=[];
 const events=new Map(),documentEvents=new Map(),backs=new Map(),nativeListeners=new Set(),timers=new Map();
 let clock=Date.parse('2026-10-13T11:42:00.000Z'),closed=0,foreground=true,nextTimer=1,nextBack=1,captureAttempt=0;
 class ClockDate extends Date{static now(){return clock;}}
 class Recorder{
  static isTypeSupported(){return true;}
  constructor(stream){this.stream=stream;this.state='inactive';this.mimeType='audio/webm';this.stopCalls=0;recorders.push(this);}
  start(timeslice){this.timeslice=timeslice;sequence.push('recorder-start');if(failStart)throw Error('Synthetic recorder start failed');this.state='recording';}
  emit(data){sequence.push('dataavailable');this.ondataavailable?.({data});}
  stop(){assert.equal(this.state,'recording');this.state='inactive';this.stopCalls++;sequence.push('recorder-stop');stopTasks.push(()=>{if(!emptyClip&&!manualChunks)this.emit(new Blob(['recorded speaking clip'],{type:this.mimeType}));sequence.push('recorder-onstop');return this.onstop?.();});}
  fail(){this.state='inactive';this.onerror?.();stopTasks.push(()=>{this.ondataavailable?.({data:new Blob(['interrupted clip'],{type:this.mimeType})});return this.onstop?.();});}
 }
 const add=(map,type,handler)=>{if(!map.has(type))map.set(type,new Set());map.get(type).add(handler);};
 const document={hidden:false,addEventListener:(type,handler)=>add(documentEvents,type,handler),removeEventListener:(type,handler)=>documentEvents.get(type)?.delete(handler)};
 const window=Object.assign(browser?.window||{addEventListener:(type,handler)=>add(events,type,handler),removeEventListener:(type,handler)=>events.get(type)?.delete(handler)},{MediaRecorder:Recorder,confirm(){throw Error('Custom risk dialog must not use window.confirm');}});
 const navigator={mediaDevices:{getUserMedia(){const request=deferred();request.track={kind:'audio',readyState:'live',enabled:true,stopped:0,stop(){this.stopped++;this.readyState='ended';}};request.stream={getTracks:()=>[request.track]};permissions.push(request);if(!manualPermissions)request.resolve(request.stream);return request.promise;}}};
 const native={isNativeForeground:()=>foreground,registerNativeBack(fn,priority){const id=nextBack++;backs.set(id,{fn,priority});return()=>backs.delete(id);},subscribeNativeState(fn){nativeListeners.add(fn);return()=>nativeListeners.delete(fn);}};
 const exports=loadRoom(hooks.react,{window,document,navigator,MediaRecorder:Recorder,Date:ClockDate,setTimeout:browser?.setTimeout||setTimeout,clearTimeout:browser?.clearTimeout||clearTimeout,setInterval(fn){const id=nextTimer++;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id)},native,{createRecordingCaptureTrace:()=>{const attempt=++captureAttempt;return(event,fields)=>{captureEvents.push({event,...fields,traceAttempt:attempt});sequence.push('trace:'+event);};}});
 const props={nativeMode,timezone:'Asia/Shanghai',prompt,recovery,onRetain,onRelease,onClose(){closed++;},onFinish:minutes=>finished.push(minutes),onSave(meta,blob){sequence.push('onSave');const save={...deferred(),meta,blob};saves.push(save);return save.promise;}};
 const render=()=>hooks.render(exports.default,props);
 const h={exports,props,render,permissions,recorders,saves,finished,captureEvents,sequence,window,document,get closed(){return closed;},get time(){return clock;},strictReplay(){hooks.strictReplay();return render();},advance(ms){clock+=ms;for(const fn of timers.values())fn();render();},button:label=>findButton(render(),label),click(label){const button=findButton(render(),label);assert.notEqual(button.props.disabled,true,`${label} must be enabled`);return button.props.onClick();},back(){render();const handler=[...backs.values()].sort((a,b)=>b.priority-a.priority)[0];assert.equal(handler.priority,100);return handler.fn();},deliverStop(){assert.ok(stopTasks.length);return stopTasks.shift()();},background(){foreground=false;for(const fn of nativeListeners)fn(false);},foreground(){foreground=true;for(const fn of nativeListeners)fn(true);},beforeUnload(){render();const e={blocked:false,returnValue:undefined,preventDefault(){this.blocked=true;}};if(browser)browser.dispatch('beforeunload',e);else for(const fn of events.get('beforeunload')||[])fn(e);return e;},cleanup:()=>hooks.cleanup()};return h;
}
async function record(h){await h.click('开始准备');h.click('准备好了');h.render();assert.equal(h.recorders[0].state,'recording');}

test('all five shipped speaking tasks route by the original prompt object and expose actual preparation/answer times',()=>{
 const h=harness();const opened=[];const tree=h.exports.SpeakingTaskCatalog({prompts,onOpen:prompt=>opened.push(prompt)});
 const buttons=nodes(tree,node=>node.type==='button');assert.equal(buttons.length,5);buttons.forEach(button=>button.props.onClick());assert.deepEqual(opened,prompts);
 assert.match(text(tree),/3 秒/);assert.match(text(tree),/15 秒/);assert.match(text(tree),/60 秒/);assert.match(text(tree),/单题专项/);
});
test('actual image and multi-line speaking material remain rendered, not reduced to a short question card',()=>{
 const image=harness({prompt:prompts[1]});assert.equal(nodes(image.render(),node=>node.type==='img')[0].props.src,prompts[1].image);image.cleanup();
 const info=harness({prompt:prompts[3]});assert.ok(text(info.render()).includes(prompts[3].passage));info.cleanup();
});
test('3-second response preparation changes to the real 15-second answer timer',async t=>{
 const h=harness({prompt:prompts[2]});t.after(h.cleanup);await h.click('开始准备');assert.match(text(h.render()),/00:03/);h.advance(3000);h.render();assert.equal(h.recorders.length,1);assert.equal(h.recorders[0].state,'recording');assert.match(text(h.render()),/00:15/);
});
test('microphone denial has an inline retryable error and never claims a recording was saved',async t=>{
 const h=harness({manualPermissions:true});t.after(h.cleanup);const pending=h.click('开始准备');h.permissions[0].reject(Error('permission denied'));await pending;assert.match(text(h.render()),/允许微光托业使用麦克风/);assert.equal(h.saves.length,0);assert.equal(h.button('开始准备').props.disabled,false);assert.equal(nodes(h.render(),node=>node.type==='audio').length,0);
 assert.equal(h.captureEvents.filter(row=>row.event==='permission-error').length,1);assert.equal(h.captureEvents.some(row=>row.event==='start'),false);
});
test('recorder start diagnostic failure preserves the original ready/error behavior without a fake clip',async t=>{
 const h=harness({failStart:true});t.after(h.cleanup);await h.click('开始准备');h.click('准备好了');assert.match(text(h.render()),/录音未能启动/);assert.equal(h.button('开始准备').props.disabled,false);assert.equal(h.recorders[0].state,'inactive');assert.equal(h.recorders[0].timeslice,250);assert.equal(h.permissions[0].track.readyState,'ended');assert.equal(h.saves.length,0);assert.equal(nodes(h.render(),node=>node.type==='audio').length,0);assert.equal(h.captureEvents.filter(row=>row.event==='start-error').length,1);assert.equal(h.captureEvents.some(row=>row.event==='start'||row.event.startsWith('save-')),false);
});
test('queued stop exposes processing, then the real Blob player during pending save',async t=>{
 const h=harness();t.after(h.cleanup);await record(h);h.advance(28000);h.click('结束录音');assert.match(text(h.render()),/正在整理已录内容/);assert.equal(h.saves.length,0);const saving=h.deliverStop();
 const audio=nodes(h.render(),node=>node.type==='audio')[0];assert.ok(audio.props.src.startsWith('blob:'));assert.equal(h.button('再说一次').props.disabled,true);assert.equal(h.button('记录收获').props.disabled,true);assert.equal(await h.saves[0].blob.text(),'recorded speaking clip');h.saves[0].resolve();await saving;assert.equal(h.button('记录收获').props.disabled,false);
});
test('capture observations preserve multiple dataavailable chunks, final queued bytes and stop-before-save order',async t=>{
 const h=harness({manualChunks:true});t.after(h.cleanup);await record(h);const start=h.time,recorder=h.recorders[0];assert.equal(recorder.timeslice,250);
 recorder.emit(new Blob(['AB'],{type:'audio/webm'}));h.advance(1000);recorder.emit(new Blob([],{type:'audio/webm'}));h.advance(2000);recorder.emit(new Blob([new Uint8Array([0,255,1])],{type:'audio/webm'}));h.advance(3000);
 assert.equal(h.saves.length,0);h.click('结束录音');assert.equal(recorder.stopCalls,1);assert.equal(h.permissions[0].track.readyState,'ended');assert.equal(h.saves.length,0);recorder.emit(new Blob(['END'],{type:'audio/webm'}));const saving=h.deliverStop();
 assert.equal(h.saves.length,1);assert.deepEqual(Array.from(new Uint8Array(await h.saves[0].blob.arrayBuffer())),[65,66,0,255,1,69,78,68]);assert.equal(h.saves[0].blob.type,'audio/webm');assert.equal(h.saves[0].meta.mime,'audio/webm');assert.equal(h.saves[0].meta.duration,6);assert.equal(h.saves[0].meta.createdAt,new Date(start).toISOString());
 const chunks=h.captureEvents.filter(row=>row.event==='chunk');assert.deepEqual(chunks.map(({chunkCount,zeroChunks,totalBytes,lastChunkBytes})=>({chunkCount,zeroChunks,totalBytes,lastChunkBytes})),[{chunkCount:1,zeroChunks:0,totalBytes:2,lastChunkBytes:2},{chunkCount:2,zeroChunks:1,totalBytes:2,lastChunkBytes:0},{chunkCount:3,zeroChunks:1,totalBytes:5,lastChunkBytes:3},{chunkCount:4,zeroChunks:1,totalBytes:8,lastChunkBytes:3}]);
 const required=['trace:permission-request','trace:stream-acquired','trace:recorder-created','recorder-start','trace:start','trace:chunk','trace:stop-request','recorder-stop','trace:track-release','recorder-onstop','trace:stopped','trace:save-start','onSave'];let previous=-1;for(const name of required){const index=h.sequence.indexOf(name,previous+1);assert.ok(index>previous,'Required observed sequence stage: '+name);previous=index;}
 for(const event of ['stopped','save-start']){const row=h.captureEvents.find(row=>row.event===event);assert.equal(row.chunkCount,4);assert.equal(row.zeroChunks,1);assert.equal(row.totalBytes,8);assert.equal(row.elapsedMs,6000);assert.equal(row.activeTracks,0);}
 assert.equal(h.captureEvents.some(row=>row.event==='save-ok'),false);assert.equal(h.button('记录收获').props.disabled,true);h.advance(9000);h.saves[0].resolve();await saving;assert.equal(h.saves[0].meta.duration,6,'Delivery/save delay must not extend the captured duration');assert.equal(h.captureEvents.filter(row=>row.event==='save-ok').length,1);assert.equal(h.captureEvents.at(-1).elapsedMs,6000);assert.equal(h.button('记录收获').props.disabled,false);
});
test('multiple zero dataavailable events are counted but never fabricate a savable clip',async t=>{
 const h=harness({manualChunks:true});t.after(h.cleanup);await record(h);const recorder=h.recorders[0];recorder.emit(new Blob([],{type:'audio/webm'}));h.advance(2000);recorder.emit(new Blob([],{type:'audio/webm'}));h.click('结束录音');await h.deliverStop();
 assert.equal(h.saves.length,0);assert.equal(h.captureEvents.some(row=>row.event.startsWith('save-')),false);const final=h.captureEvents.find(row=>row.event==='stopped');assert.ok(final);assert.equal(final.chunkCount,2);assert.equal(final.zeroChunks,2);assert.equal(final.totalBytes,0);assert.equal(final.lastChunkBytes,0);assert.equal(final.activeTracks,0);assert.match(text(h.render()),/没有收到录音/);assert.equal(nodes(h.render(),node=>node.type==='audio').length,0);
});
test('multi-chunk save failure and retry retain identical Blob/id/counters without another capture attempt',async t=>{
 const h=harness({manualChunks:true});t.after(h.cleanup);await record(h);const recorder=h.recorders[0];recorder.emit(new Blob(['first'],{type:'audio/webm'}));recorder.emit(new Blob(['second'],{type:'audio/webm'}));h.advance(4000);h.click('结束录音');const saving=h.deliverStop();const original=h.saves[0];original.reject(Error('Synthetic save unavailable'));await saving;
 assert.equal(h.captureEvents.filter(row=>row.event==='save-error').length,1);assert.equal(h.captureEvents.some(row=>row.event==='save-ok'),false);assert.equal(h.button('记录收获').props.disabled,true);const retry=h.button('重试保存').props.onClick();assert.equal(h.saves[1].blob,original.blob);assert.equal(h.saves[1].meta.id,original.meta.id);assert.equal(await h.saves[1].blob.text(),'firstsecond');assert.equal(h.recorders.length,1);assert.equal(h.permissions.length,1);h.saves[1].resolve();await retry;
 assert.equal(h.captureEvents.filter(row=>row.event==='permission-request').length,1);assert.equal(h.captureEvents.filter(row=>row.event==='save-start').length,2);assert.equal(h.captureEvents.filter(row=>row.event==='save-error').length,1);assert.equal(h.captureEvents.filter(row=>row.event==='save-ok').length,1);for(const row of h.captureEvents.filter(row=>row.event.startsWith('save-'))){assert.equal(row.chunkCount,2);assert.equal(row.zeroChunks,0);assert.equal(row.totalBytes,11);assert.equal(row.lastChunkBytes,6);assert.equal(row.elapsedMs,4000);}assert.equal(h.button('记录收获').props.disabled,false);
});
test('save failure preserves audio, emergency download, original recording ID/start time and saved gates',async t=>{
 const h=harness();t.after(h.cleanup);await record(h);const started=h.time;h.advance(4000);h.click('结束录音');const saving=h.deliverStop();h.saves[0].reject(Error('storage unavailable'));await saving;
 const tree=h.render(),audio=nodes(tree,node=>node.type==='audio')[0],download=nodes(tree,node=>node.type==='a'&&node.props.download)[0];assert.equal(download.props.href,audio.props.src);assert.equal(download.props.download,'speaking-recording.webm');assert.equal(h.saves[0].meta.createdAt,new Date(started).toISOString());assert.equal(h.saves[0].meta.duration,4);assert.equal(h.button('再说一次').props.disabled,true);assert.equal(h.button('记录收获').props.disabled,true);assert.match(text(tree),/录音尚未保存/);
 const retry=h.button('重试保存').props.onClick;const firstRetry=retry();await retry();assert.equal(h.saves.length,2,'rapid duplicate retry must be serial');assert.equal(h.saves[1].meta.id,h.saves[0].meta.id);assert.equal(h.saves[1].blob,h.saves[0].blob);h.saves[1].resolve();await firstRetry;assert.equal(h.button('再说一次').props.disabled,false);
});
test('recording and saving returns stay in room; success clearly requires a second controlled return',async t=>{
 const h=harness();t.after(h.cleanup);await record(h);h.back();assert.equal(h.closed,0);assert.equal(h.recorders[0].state,'inactive');h.back();assert.equal(h.closed,0);const saving=h.deliverStop();h.back();assert.equal(h.closed,0);assert.match(text(h.render()),/再次点击/);h.saves[0].resolve();await saving;assert.equal(h.closed,0,'save resolution must not silently dismiss');assert.match(text(h.render()),/再次点击“返回口语目录”即可离开/);h.click('返回口语目录');assert.equal(h.closed,1);
});
test('unsaved return opens risk layout; dismiss/cancel retain Blob and explicit discard alone exits',async t=>{
 const h=harness();t.after(h.cleanup);await record(h);h.click('结束录音');const saving=h.deliverStop();h.saves[0].reject(Error('full'));await saving;h.back();assert.match(text(h.render()),/离开会释放当前页面/);assert.equal(h.closed,0);h.click('留在这里');assert.equal(h.closed,0);assert.equal(nodes(h.render(),node=>node.type==='audio').length,1);h.click('放弃并离开');h.click('确认放弃并离开');assert.equal(h.closed,1);
});
test('preparation return and late permission response release microphone without starting or closing',async t=>{
 const h=harness({manualPermissions:true});t.after(h.cleanup);const permission=h.click('开始准备');h.back();assert.equal(h.closed,0);h.permissions[0].resolve(h.permissions[0].stream);await permission;assert.ok(h.permissions[0].track.stopped>0);assert.equal(h.recorders.length,0);assert.equal(h.button('开始准备').props.disabled,false);h.back();assert.equal(h.closed,1);
});
test('cancelled permission rejection cannot be attributed to a newer capture trace or clear its pending state',async t=>{
 const h=harness({manualPermissions:true});t.after(h.cleanup);const oldRequest=h.click('开始准备');assert.equal(h.captureEvents.at(-1).traceAttempt,1);h.back();assert.equal(h.closed,0);assert.equal(h.button('开始准备').props.disabled,false);
 const currentRequest=h.click('开始准备');assert.equal(h.permissions.length,2);assert.equal(h.captureEvents.at(-1).event,'permission-request');assert.equal(h.captureEvents.at(-1).traceAttempt,2);const before=JSON.stringify(h.captureEvents);
 h.permissions[0].reject(Error('Obsolete permission rejection'));await oldRequest;assert.equal(JSON.stringify(h.captureEvents),before,'The obsolete rejection must not emit a permission-error on the current trace');assert.equal(h.button('等待麦克风').props.disabled,true,'An obsolete finally must not clear the current pending request');assert.doesNotMatch(text(h.render()),/允许微光托业使用麦克风/);assert.equal(h.recorders.length,0);assert.equal(h.saves.length,0);
 h.permissions[1].resolve(h.permissions[1].stream);await currentRequest;assert.equal(h.captureEvents.at(-1).event,'stream-acquired');assert.equal(h.captureEvents.at(-1).traceAttempt,2);assert.equal(h.captureEvents.some(row=>row.event==='permission-error'),false);assert.match(text(h.render()),/准备好了/);assert.equal(h.closed,0);
});
test('duplicate native background keeps queued save and uses stop time rather than later delivery time',async t=>{
 const h=harness();t.after(h.cleanup);await record(h);const start=h.time;h.advance(5000);h.background();h.foreground();h.background();h.advance(300000);const saving=h.deliverStop();assert.equal(h.saves[0].meta.duration,5);assert.equal(h.saves[0].meta.createdAt,new Date(start).toISOString());h.background();h.saves[0].resolve();await saving;assert.equal(h.recorders[0].stopCalls,1);assert.equal(h.button('记录收获').props.disabled,false);
});
test('empty audio reports error without generating a fake recording or saved state',async t=>{
 const h=harness({emptyClip:true});t.after(h.cleanup);await record(h);h.click('结束录音');await h.deliverStop();assert.equal(h.saves.length,0);assert.match(text(h.render()),/没有收到录音/);assert.equal(h.button('开始准备').props.disabled,false);
});
test('an inactive recorder error waits for queued audio/stop and cannot start a new clip over its pending data',async t=>{
 const h=harness();t.after(h.cleanup);const staleStart=h.button('开始准备').props.onClick;await record(h);const start=h.time;h.advance(5000);h.recorders[0].fail();assert.equal(h.captureEvents.filter(row=>row.event==='recorder-error').length,1);assert.match(text(h.render()),/正在整理已录内容/);await staleStart();assert.equal(h.permissions.length,1);h.advance(120000);const saving=h.deliverStop();assert.equal(h.saves[0].meta.duration,5);assert.equal(h.saves[0].meta.createdAt,new Date(start).toISOString());assert.equal(await h.saves[0].blob.text(),'interrupted clip');h.saves[0].resolve();await saving;assert.equal(h.button('再说一次').props.disabled,false);
});
test('self-check remains transient and record-gain delegates estimated minutes only after successful save',async t=>{
 const h=harness();t.after(h.cleanup);await record(h);h.advance(28000);h.click('结束录音');const saving=h.deliverStop();h.saves[0].resolve();await saving;const checkbox=nodes(h.render(),node=>node.type==='Checkbox')[0];checkbox.props.onCheckedChange(true);assert.equal(nodes(h.render(),node=>node.type==='Checkbox')[0].props.checked,true);assert.equal(h.saves[0].meta.note,'');assert.equal('score' in h.saves[0].meta,false);assert.equal(h.finished.length,0);h.click('记录收获');assert.deepEqual(h.finished,[2]);
});
test('beforeunload protects active/unsaved clip but stops prompting once its save succeeded',async t=>{
 const h=harness();t.after(h.cleanup);assert.equal(h.beforeUnload().blocked,false);await record(h);assert.equal(h.beforeUnload().blocked,true);h.click('结束录音');assert.equal(h.beforeUnload().blocked,true);const saving=h.deliverStop();assert.equal(h.beforeUnload().blocked,true);h.saves[0].resolve();await saving;assert.equal(h.beforeUnload().blocked,false);
});
test('a new microphone permission request disables re-record and record-gain without changing the saved previous clip',async t=>{
 const h=harness({manualPermissions:true});t.after(h.cleanup);const firstPermission=h.click('开始准备');h.permissions[0].resolve(h.permissions[0].stream);await firstPermission;h.click('准备好了');h.click('结束录音');const saving=h.deliverStop();h.saves[0].resolve();await saving;
 const again=h.click('再说一次');assert.equal(h.button('记录收获').props.disabled,true);assert.equal(h.button('等待麦克风').props.disabled,true);assert.equal(h.finished.length,0);h.permissions[1].reject(Error('permission denied'));await again;assert.equal(h.button('记录收获').props.disabled,false);assert.equal(h.saves.length,1);assert.equal(h.recorders.length,1);
});
test('a late re-record permission after native background/foreground cannot automatically replace the saved clip',async t=>{
 const h=harness({manualPermissions:true});t.after(h.cleanup);const firstPermission=h.click('开始准备');h.permissions[0].resolve(h.permissions[0].stream);await firstPermission;h.click('准备好了');h.click('结束录音');const saving=h.deliverStop();h.saves[0].resolve();await saving;
 const again=h.click('再说一次');h.render();h.background();h.foreground();h.permissions[1].resolve(h.permissions[1].stream);await again;assert.ok(h.permissions[1].track.stopped>0);assert.equal(h.recorders.length,1);assert.equal(h.saves.length,1);assert.equal(h.button('再说一次').props.disabled,false);assert.equal(h.button('记录收获').props.disabled,false);assert.equal(nodes(h.render(),node=>node.type==='audio').length,1);
});
test('history read error retains metadata and retries the same recording instead of fabricating an empty list',async()=>{
 const hooks=hookRuntime();const exports=loadRoom(hooks.react,{},{});const recording={id:'existing-id',promptId:prompts[0].id,title:prompts[0].title,duration:45,createdAt:'2026-10-13T11:42:00.000Z',mime:'audio/webm'};const requests=[];
 const props={recordings:[recording],timezone:'Asia/Shanghai',onPlay:async rec=>{requests.push(rec);if(requests.length===1)throw Error('missing audio');}};const render=()=>hooks.render(exports.SpeakingRecordingHistory,props);
 findButton(render(),'回听').props.onClick();await flush();assert.match(text(render()),/原记录与练习时间保留/);assert.match(text(render()),/45 秒/);assert.match(text(render()),/1 段/);findButton(render(),'重新读取').props.onClick();await flush();assert.equal(requests[1],recording);assert.doesNotMatch(text(render()),/暂时无法读取/);hooks.cleanup();
});

function loadRecoveryStore(){
 const recoverySource=path.join(root,'lib/speaking-recovery.ts');const exports={};
 const code=ts.transpileModule(fs.readFileSync(recoverySource,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,Blob,Map,Set},{filename:recoverySource});return exports;
}
const scope=(owner,nativeMode=false)=>JSON.stringify([nativeMode,owner]);
function scopedHarness(store,owner,options={}){
 const key=scope(owner,options.nativeMode??false);
 return harness({...options,recovery:store.getSpeakingRecovery(key),onRetain:clip=>store.retainSpeakingRecovery(key,clip),onRelease:id=>store.releaseSpeakingRecovery(key,id)});
}
function memoryClip(id='clip-a'){return {prompt:prompts[0],meta:{id,promptId:prompts[0].id,title:prompts[0].title,duration:7,createdAt:'2026-10-13T11:42:00.000Z',mime:'audio/webm',note:''},blob:new Blob(['unsaved account A audio'],{type:'audio/webm'})};}

test('page-memory recovery uses the exact owner/native scope and never exposes A audio to B or native mode',()=>{
 const store=loadRecoveryStore(),clip=memoryClip();store.retainSpeakingRecovery(scope('account-a'),clip);
 assert.equal(store.hasSpeakingRecovery(),true);assert.equal(store.getSpeakingRecovery(scope('account-a')),clip);
 assert.equal(store.getSpeakingRecovery(scope('account-b')),undefined);assert.equal(store.getSpeakingRecovery(scope(null,true)),undefined);assert.equal(store.getSpeakingRecovery(scope('account-a',true)),undefined);
 const native=memoryClip('native-clip');store.retainSpeakingRecovery(scope(null,true),native);store.releaseSpeakingRecovery(scope('account-a'),clip.meta.id);
 assert.equal(store.getSpeakingRecovery(scope(null,true)),native);store.releaseSpeakingRecovery(scope(null,true),native.meta.id);assert.equal(store.hasSpeakingRecovery(),false);
});
test('matching-ID release preserves a newer clip and subscriber notifications stay in their owner scope',()=>{
 const store=loadRecoveryStore(),a=scope('account-a'),b=scope('account-b');let aCalls=0,bCalls=0;
 const unsubscribeA=store.subscribeSpeakingRecovery(a,()=>aCalls++),unsubscribeB=store.subscribeSpeakingRecovery(b,()=>bCalls++);
 const old=memoryClip('old-a'),newer=memoryClip('new-a');store.retainSpeakingRecovery(a,old);store.retainSpeakingRecovery(a,newer);
 store.releaseSpeakingRecovery(a,old.meta.id);assert.equal(store.getSpeakingRecovery(a),newer);assert.equal(aCalls,2);assert.equal(bCalls,0);
 store.releaseSpeakingRecovery(b,newer.meta.id);assert.equal(store.getSpeakingRecovery(a),newer);assert.equal(aCalls,2);assert.equal(bCalls,0);
 store.releaseSpeakingRecovery(a,newer.meta.id);assert.equal(aCalls,3);assert.equal(store.getSpeakingRecovery(a),undefined);unsubscribeA();unsubscribeB();
 store.retainSpeakingRecovery(a,old);assert.equal(aCalls,3);assert.equal(bCalls,0);
});
test('switch A to B during recording retains delayed dataavailable/onstop under A without any automatic owner write',async t=>{
 const store=loadRecoveryStore(),a=scopedHarness(store,'account-a'),b=scopedHarness(store,'account-b');t.after(b.cleanup);
 await record(a);const began=a.time;a.advance(7000);a.cleanup();assert.equal(a.recorders[0].stopCalls,1);assert.ok(a.permissions[0].track.stopped>0);
 const pending=store.getSpeakingRecovery(scope('account-a'));assert.equal(pending?.processing,true,'queued recorder recovery must protect its owner before onstop');assert.equal(pending.blob.size,0,'audio data is not fabricated before dataavailable');
 assert.equal(nodes(b.render(),node=>node.type==='audio').length,0);assert.equal(b.saves.length,0);a.advance(300000);await a.deliverStop();
 const retained=store.getSpeakingRecovery(scope('account-a'));assert.ok(retained?.blob.size);assert.equal(retained.meta.id,pending.meta.id,'processing-to-Blob transition must retain one recording identity');assert.equal(retained.processing,undefined);assert.equal(await retained.blob.text(),'recorded speaking clip');
 assert.equal(retained.meta.createdAt,new Date(began).toISOString());assert.equal(retained.meta.duration,7,'duration ends at unmount stop, not delayed delivery');
 assert.equal(a.saves.length,0,'unmounted onstop must not persist under the changed owner');assert.equal(b.saves.length,0);assert.equal(store.getSpeakingRecovery(scope('account-b')),undefined);
 const restored=scopedHarness(store,'account-a');t.after(restored.cleanup);restored.render();const tree=restored.render();assert.equal(nodes(tree,node=>node.type==='audio').length,1);assert.match(text(tree),/录音尚未保存/);
 assert.equal(restored.button('再说一次').props.disabled,true);assert.equal(restored.button('记录收获').props.disabled,true);
 const download=nodes(tree,node=>node.type==='a'&&node.props.download)[0];assert.ok(download.props.href.startsWith('blob:'));assert.equal(restored.saves.length,0);
});
test('failed save after A unmount remains recoverable only in A; retry retains original ID/start time/Blob',async t=>{
 const store=loadRecoveryStore(),a=scopedHarness(store,'account-a');await record(a);const began=a.time;a.advance(6000);a.click('结束录音');const saving=a.deliverStop();const original=a.saves[0];
 assert.equal(store.getSpeakingRecovery(scope('account-a')).saving,original.promise);a.cleanup();const b=scopedHarness(store,'account-b');t.after(b.cleanup);original.reject(Error('A storage offline'));await saving;
 const retained=store.getSpeakingRecovery(scope('account-a'));assert.equal(retained.saving,undefined);assert.equal(retained.meta,original.meta);assert.equal(retained.blob,original.blob);assert.equal(nodes(b.render(),node=>node.type==='audio').length,0);assert.equal(b.saves.length,0);
 const restored=scopedHarness(store,'account-a');t.after(restored.cleanup);restored.render();restored.render();const retry=restored.click('重试保存');assert.equal(restored.saves.length,1);
 const retried=restored.saves[0];assert.equal(retried.meta.id,original.meta.id);assert.equal(retried.meta.createdAt,new Date(began).toISOString());assert.equal(retried.meta.duration,6);assert.equal(retried.blob,original.blob);
 retried.resolve();await retry;assert.equal(store.getSpeakingRecovery(scope('account-a')),undefined);assert.equal(restored.button('记录收获').props.disabled,false);assert.equal(b.saves.length,0);
});
test('restored failed clip survives return/cancel/download and is released only by explicit discard',async t=>{
 const store=loadRecoveryStore(),clip=memoryClip();store.retainSpeakingRecovery(scope('account-a'),clip);const a=scopedHarness(store,'account-a');t.after(a.cleanup);a.render();a.render();
 a.back();assert.equal(a.closed,0);assert.equal(store.getSpeakingRecovery(scope('account-a')),clip);assert.match(text(a.render()),/离开会释放当前页面/);
 const download=nodes(a.render(),node=>node.type==='a'&&node.props.download)[0];assert.ok(download.props.href.startsWith('blob:'));assert.equal(a.closed,0);assert.equal(store.getSpeakingRecovery(scope('account-a')),clip,'download link cannot authorize dropping the recovery clip');
 a.click('留在这里');assert.equal(a.closed,0);assert.equal(store.getSpeakingRecovery(scope('account-a')),clip);a.click('放弃并离开');a.click('确认放弃并离开');
 assert.equal(a.closed,1);assert.equal(store.getSpeakingRecovery(scope('account-a')),undefined);assert.equal(a.saves.length,0);
});
test('pending A save resolves after switch to B and an A remount without issuing a second write',async t=>{
 const store=loadRecoveryStore(),a=scopedHarness(store,'account-a');await record(a);a.click('结束录音');const saving=a.deliverStop(),original=a.saves[0];a.cleanup();
 const b=scopedHarness(store,'account-b'),restored=scopedHarness(store,'account-a');t.after(b.cleanup);t.after(restored.cleanup);restored.render();restored.render();
 assert.equal(restored.button('记录收获').props.disabled,true);assert.equal(restored.saves.length,0);restored.back();assert.equal(restored.closed,0);assert.equal(b.saves.length,0);
 original.resolve();await saving;await flush();assert.equal(store.getSpeakingRecovery(scope('account-a')),undefined);assert.equal(restored.saves.length,0);assert.equal(restored.button('记录收获').props.disabled,false);assert.equal(nodes(b.render(),node=>node.type==='audio').length,0);
 restored.click('返回口语目录');assert.equal(restored.closed,1);assert.equal(b.saves.length,0);
});
test('pending A save failure propagates to its remounted recovery room and enables one same-clip retry',async t=>{
 const store=loadRecoveryStore(),a=scopedHarness(store,'account-a');await record(a);a.advance(3000);a.click('结束录音');const saving=a.deliverStop(),original=a.saves[0];a.cleanup();
 const restored=scopedHarness(store,'account-a');t.after(restored.cleanup);restored.render();restored.render();original.reject(Error('owner A save failed'));await saving;await flush();
 assert.match(text(restored.render()),/录音尚未保存/);assert.equal(restored.button('重试保存').props.disabled,false);assert.equal(restored.button('再说一次').props.disabled,true);
 const retry=restored.click('重试保存');assert.equal(restored.saves.length,1);assert.equal(restored.saves[0].meta.id,original.meta.id);assert.equal(restored.saves[0].blob,original.blob);restored.saves[0].resolve();await retry;assert.equal(store.getSpeakingRecovery(scope('account-a')),undefined);
});
test('late successful save releases only its matching recovery ID and cannot drop a newer A recovery',async t=>{
 const store=loadRecoveryStore(),a=scopedHarness(store,'account-a');await record(a);a.click('结束录音');const saving=a.deliverStop(),original=a.saves[0];a.cleanup();
 const newer=memoryClip('newer-owner-a-clip');store.retainSpeakingRecovery(scope('account-a'),newer);original.resolve();await saving;
 assert.equal(store.getSpeakingRecovery(scope('account-a')),newer);assert.equal(store.getSpeakingRecovery(scope('account-b')),undefined);
});

function speakingBrowser(){
 const entries=[{lanternWorkspaceView:'training',parent:'owner-fixture'}],navigation=[],listeners=[],timers=new Map();let index=0,timerId=0,pushCalls=0,backCalls=0;
 const window={
  addEventListener(type,fn,capture=false){listeners.push({type,fn,capture:typeof capture==='boolean'?capture:!!capture.capture});},
  removeEventListener(type,fn){const i=listeners.findIndex(item=>item.type===type&&item.fn===fn);if(i>=0)listeners.splice(i,1);},
  history:{get state(){return entries[index];},pushState(state){pushCalls++;entries.splice(index+1);entries.push(structuredClone(state));index++;},replaceState(state){entries[index]=structuredClone(state);},back(){backCalls++;navigation.push(()=>{if(index===0)return;index--;dispatch('popstate',{state:structuredClone(entries[index])});});}}
 };
 function dispatch(type,event={}){let stopped=false;event.stopImmediatePropagation=()=>{stopped=true;};for(const listener of [...listeners].filter(item=>item.type===type).sort((a,b)=>Number(b.capture)-Number(a.capture))){listener.fn(event);if(stopped)break;}event.wasStopped=stopped;return event;}
 return {window,dispatch,setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),flushTimers(){const jobs=[...timers.values()];timers.clear();jobs.forEach(fn=>fn());},flushHistory(){let guard=0;while(navigation.length){assert.ok(++guard<30,'history traversal must settle');navigation.shift()();}},flush(){this.flushTimers();this.flushHistory();},get pushCalls(){return pushCalls;},get backCalls(){return backCalls;},get popListeners(){return listeners.filter(item=>item.type==='popstate').length;},get index(){return index;}};
}
test('Speaking StrictMode replay owns one browser history layer and final cleanup consumes it exactly once',()=>{
 const browser=speakingBrowser(),h=harness({browser});h.render();const token=browser.window.history.state.lanternSpeakingView;assert.ok(token);h.strictReplay();browser.flush();h.render();
 assert.equal(browser.pushCalls,1);assert.equal(browser.backCalls,0);assert.equal(browser.popListeners,1);assert.equal(browser.window.history.state.lanternSpeakingView,token);assert.equal(h.closed,0);
 h.cleanup();browser.flush();assert.equal(browser.backCalls,1);assert.equal(browser.popListeners,0);assert.equal(browser.window.history.state.lanternSpeakingView,undefined);assert.equal(browser.window.history.state.parent,'owner-fixture');
});
test('Speaking StrictMode replay followed immediately by unmount never consumes the parent history layer',()=>{
 const browser=speakingBrowser(),h=harness({browser});h.render();h.strictReplay();h.cleanup();assert.equal(browser.backCalls,0);browser.flush();
 assert.equal(browser.backCalls,1);assert.equal(browser.index,0);assert.equal(browser.window.history.state.lanternWorkspaceView,'training');assert.equal(browser.popListeners,0);assert.equal(h.closed,0);assert.equal(h.saves.length,0);
});
test('Browser Back during recording stops once and preserves room through processing/pending save until a second return',async()=>{
 const browser=speakingBrowser(),h=harness({browser});h.render();await record(h);h.advance(4000);const token=browser.window.history.state.lanternSpeakingView;let parentPops=0;browser.window.addEventListener('popstate',()=>parentPops++);
 browser.window.history.back();browser.flushHistory();h.render();assert.equal(h.recorders[0].stopCalls,1);assert.equal(h.closed,0);assert.equal(browser.window.history.state.lanternSpeakingView,token);assert.equal(parentPops,0);
 browser.window.history.back();browser.flushHistory();h.render();assert.equal(h.closed,0);assert.equal(h.recorders[0].stopCalls,1);const saving=h.deliverStop();
 browser.window.history.back();browser.flushHistory();h.render();assert.equal(h.closed,0);assert.equal(h.saves.length,1);assert.equal(browser.window.history.state.lanternSpeakingView,token);
 h.saves[0].resolve();await saving;h.render();assert.equal(h.closed,0,'save completion does not silently close the room');browser.window.history.back();browser.flushHistory();h.render();assert.equal(h.closed,1);
 h.cleanup();browser.flush();assert.equal(browser.window.history.state.lanternWorkspaceView,'training');assert.equal(browser.window.history.state.lanternSpeakingView,undefined);assert.equal(parentPops,1,'only final room cleanup yields a parent pop');
});
test('Browser Back on failed recovery toggles risk dialog while retaining download/audio; explicit discard alone exits',()=>{
 const store=loadRecoveryStore(),clip=memoryClip(),browser=speakingBrowser();store.retainSpeakingRecovery(scope('account-a'),clip);const h=scopedHarness(store,'account-a',{browser});h.render();h.render();const token=browser.window.history.state.lanternSpeakingView;
 browser.window.history.back();browser.flushHistory();h.render();assert.equal(h.closed,0);assert.match(text(h.render()),/放弃这段未保存录音/);assert.equal(store.getSpeakingRecovery(scope('account-a')),clip);
 browser.window.history.back();browser.flushHistory();h.render();assert.equal(nodes(h.render(),node=>node.type==='Dialog'&&node.props.open===true).length,1);assert.equal(nodes(h.render(),node=>node.type==='audio').length,1);assert.equal(browser.window.history.state.lanternSpeakingView,token);
 browser.window.history.back();browser.flushHistory();h.render();h.click('确认放弃并离开');assert.equal(h.closed,1);assert.equal(store.getSpeakingRecovery(scope('account-a')),undefined);assert.equal(h.saves.length,0);
 h.cleanup();browser.flush();assert.equal(browser.window.history.state.lanternWorkspaceView,'training');assert.equal(browser.popListeners,0);
});
test('Speaking final cleanup leaves a replacement browser destination untouched',()=>{
 const browser=speakingBrowser(),h=harness({browser});h.render();h.cleanup();browser.window.history.replaceState({lanternWorkspaceView:'settings',replacement:true});browser.flush();
 assert.equal(browser.backCalls,0);assert.equal(browser.window.history.state.replacement,true);assert.equal(browser.popListeners,0);
});

function mountActualRecoveryGuard(store,browser){
 // Execute the shipped named function rather than a duplicate test guard. The
 // surrounding StudyWorkspace has its own owner-remount suite on the root line.
 const file=path.join(root,'app/study-app.tsx'),contents=fs.readFileSync(file,'utf8');
 const ast=ts.createSourceFile(file,contents,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 const guard=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='SpeakingRecoveryGuard');assert.ok(guard,'Shipped recovery guard must exist');
 const code=ts.transpileModule(guard.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={},hooks=hookRuntime();
 vm.runInNewContext(code,{exports,useEffect:hooks.react.useEffect,hasSpeakingRecovery:store.hasSpeakingRecovery,window:browser.window},{filename:file});hooks.render(exports.SpeakingRecoveryGuard,{});
 return {cleanup:()=>hooks.cleanup(),unload(){const event={blocked:false,returnValue:undefined,preventDefault(){this.blocked=true;}};return browser.dispatch('beforeunload',event);}};
}
test('actual outer recovery guard protects A clip while B has no visible A recording and releases after explicit discard',()=>{
 const store=loadRecoveryStore(),browser=speakingBrowser(),guard=mountActualRecoveryGuard(store,browser),clip=memoryClip(),b=scopedHarness(store,'account-b',{browser});b.render();
 assert.equal(guard.unload().blocked,false);store.retainSpeakingRecovery(scope('account-a'),clip);assert.equal(nodes(b.render(),node=>node.type==='audio').length,0);assert.equal(guard.unload().blocked,true);assert.equal(b.saves.length,0);
 store.releaseSpeakingRecovery(scope('account-b'),clip.meta.id);assert.equal(guard.unload().blocked,true,'B cannot release A recovery');store.releaseSpeakingRecovery(scope('account-a'),clip.meta.id);assert.equal(guard.unload().blocked,false);b.cleanup();guard.cleanup();browser.flush();
});
test('outer guard still protects A stop-to-onstop recovery gap after switching to B',async()=>{
 const store=loadRecoveryStore(),browser=speakingBrowser(),guard=mountActualRecoveryGuard(store,browser),a=scopedHarness(store,'account-a',{browser});a.render();await record(a);a.advance(4000);
 assert.equal(guard.unload().blocked,true,'active A recording owns a beforeunload guard');a.cleanup();const b=scopedHarness(store,'account-b',{browser});b.render();
 const duringQueuedStop=guard.unload();await a.deliverStop();const afterQueuedStop=guard.unload();b.cleanup();guard.cleanup();browser.flush();
 assert.equal(afterQueuedStop.blocked,true,'A is protected after the real Blob arrives');assert.equal(duringQueuedStop.blocked,true,'switching owner must not leave the retained pending recorder unprotected before delayed onstop');
});
test('empty late onstop releases pending owner recovery and does not leave a fake playable/savable clip',async()=>{
 const store=loadRecoveryStore(),browser=speakingBrowser(),guard=mountActualRecoveryGuard(store,browser),a=scopedHarness(store,'account-a',{browser,emptyClip:true});a.render();await record(a);a.cleanup();
 const pending=store.getSpeakingRecovery(scope('account-a'));assert.equal(pending.processing,true);assert.equal(pending.blob.size,0);assert.equal(guard.unload().blocked,true);await a.deliverStop();
 assert.equal(store.getSpeakingRecovery(scope('account-a')),undefined);assert.equal(guard.unload().blocked,false);assert.equal(a.saves.length,0);guard.cleanup();browser.flush();
});
test('owner change while inactive recorder error is processing preserves the pending clip and original stop time',async t=>{
 const store=loadRecoveryStore(),a=scopedHarness(store,'account-a');await record(a);const began=a.time;a.advance(5000);a.recorders[0].fail();a.render();a.advance(120000);a.cleanup();
 const pending=store.getSpeakingRecovery(scope('account-a'));assert.equal(pending.processing,true);assert.equal(pending.meta.duration,5);assert.equal(pending.meta.createdAt,new Date(began).toISOString());assert.equal(a.recorders[0].stopCalls,0,'already inactive error cannot be stopped twice');
 const b=scopedHarness(store,'account-b');t.after(b.cleanup);assert.equal(nodes(b.render(),node=>node.type==='audio').length,0);await a.deliverStop();const clip=store.getSpeakingRecovery(scope('account-a'));
 assert.equal(clip.meta.id,pending.meta.id);assert.equal(clip.meta.duration,5);assert.equal(await clip.blob.text(),'interrupted clip');assert.equal(a.saves.length,0);assert.equal(b.saves.length,0);
});
test('late A microphone permission after owner unmount releases its stream and cannot start or write a B recording',async t=>{
 const store=loadRecoveryStore(),a=scopedHarness(store,'account-a',{manualPermissions:true}),pending=a.click('开始准备');a.cleanup();const b=scopedHarness(store,'account-b');t.after(b.cleanup);b.render();
 a.permissions[0].resolve(a.permissions[0].stream);await pending;assert.ok(a.permissions[0].track.stopped>0);assert.equal(a.recorders.length,0);assert.equal(b.recorders.length,0);assert.equal(a.saves.length,0);assert.equal(b.saves.length,0);assert.equal(store.hasSpeakingRecovery(),false);
});
