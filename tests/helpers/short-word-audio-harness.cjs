'use strict';
// Actual controller AST and actual explicit wrapper; only Media and monotonic
// time/timers are fixtures, matching audio-resume-confirmation's I/O boundary.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'../..'),fromRoot=createRequire(path.join(root,'package.json')),ts=fromRoot('typescript');
const {createSourceLoader}=require(path.join(root,'tests/helpers/actual-source-loader.cjs'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function environment({regression,order='pause-first',reentry=false}={}){
 let now=0,confirmed=0,errors=0,player,reentered=false,timerId=0;const timers=new Map(),medias=[],diagnostics=[],completions=[],plays=[];
 const source=fs.readFileSync(path.join(root,'lib/lesson-audio.ts'),'utf8'),ast=ts.createSourceFile('lesson-audio.ts',source,ts.ScriptTarget.Latest,true);
 const nodes=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createBundledPlayback'||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&['active','playbackSequence'].includes(d.name.text)));assert.equal(nodes.length,3);
 let code=nodes.map(n=>n.getText(ast)).join('\n\n')+'\nexports.createBundledPlayback=createBundledPlayback;';
 // Explicit test mutants reproduce the two obsolete predicates without private
 // historical source files. Normal cases execute unchanged actual source.
 if(regression==='without-offset-proof'){
  const before='(elapsed<expectedMs*.8&&!observedShortStart)';assert.equal(code.split(before).length,2);code=code.replace(before,'(elapsed<expectedMs*.8)');
 }else if(regression==='old-final-50ms'){
  const before='lastProgress!==null&&actual!==null&&actual>=lastProgress&&\n        lastAdvanceGap>=(actual-lastProgress)/rate*800;';assert.equal(code.split(before).length,2);code=code.replace(before,'lastProgress!==null&&lastProgress>=duration-.05;');
 }else assert.equal(regression,undefined);
 const globals={Map,Error,Math,Number,JSON,performance:{now:()=>now},setTimeout(fn,delay){timers.set(++timerId,{fn,delay,at:now+delay});return timerId;},clearTimeout:id=>timers.delete(id),console:{info(message){diagnostics.push(JSON.parse(message.slice('Bundled playback '.length)));}}};
 const controller={};vm.runInNewContext(ts.transpileModule(code,{fileName:'lesson-audio.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{...globals,exports:controller});
 const wrapper=createSourceLoader({root,imports:{'./lesson-audio':controller},globals}).load('lib/explicit-bundled-playback.ts');
 class Media extends EventTarget{
  constructor(){super();this.src='https://lantern.local/audio/natural/synthetic-short-word.mp3';this.currentSrc=this.src;this._time=0;this.duration=NaN;this.readyState=0;this.paused=true;this.seeking=false;this.ended=false;this.error=null;this.playbackRate=1;this.muted=false;this.seekable={length:1,start:()=>0,end:()=>this.duration};}
  get currentTime(){return this._time;}set currentTime(value){this._time=value;this.seeking=true;queueMicrotask(()=>{this.seeking=false;this.emit('seeked');});}
  emit(type){this.dispatchEvent(new Event(type));}
  load(){this.paused=true;this._time=0;this.duration=NaN;this.readyState=0;this.ended=false;}
  play(){this.paused=false;plays.push({media:medias.indexOf(this),target:this._time,rate:this.playbackRate});return new Promise(resolve=>this.resolvePlay=resolve);}
  pause(){const changed=!this.paused;this.paused=true;if(changed)this.emit('pause');}
  removeAttribute(name){if(name==='src'){this.src='';this.currentSrc='';}}remove(){}
 }
 player=wrapper.createExplicitBundledPlayback(()=>{const m=new Media();medias.push(m);return m;},value=>{if(!value){const complete=player.completed();completions.push(complete);if(reentry&&complete&&!reentered){reentered=true;player.stop();}}},()=>errors++,()=>confirmed++);
 async function prelude(options={}){const m=medias.at(-1),origin=now,at=(elapsed,fn)=>{now=origin+elapsed;fn?.();};m.duration=options.initialDuration??.975;m.readyState=1;m.emit('loadedmetadata');await tick();at(.3,()=>m.emit('waiting'));at((options.playingAt??6)-.3,()=>{m.readyState=4;m.emit('progress');});at((options.playingAt??6)-.1,()=>m.emit('canplay'));at(options.playingAt??6,()=>{m.emit('playing');m.resolvePlay?.();});await tick();return {m,origin,at};}
 async function trace(options={}){player.play(options.rate??1,options.target??0);const frame=await prelude(options),{m,at}=frame;const points=options.points??[[258.1,.68846],[523.6,.968399]];for(let i=0;i<points.length;i++){const[time,position]=points[i];at(time,()=>{m._time=position;m.emit('timeupdate');});if(i===0&&options.afterFirst)await options.afterFirst(frame);}at(options.endAt??592.6,()=>{m._time=options.endPosition??.975;m.paused=true;m.ended=options.trueEnded!==false;if(order==='pause-first'){m.emit('pause');m.emit('ended');}else{m.emit('ended');m.emit('pause');}});await tick();return frame;}
 return {player,medias,diagnostics,completions,plays,trace,prelude,get confirmed(){return confirmed;},get errors(){return errors;},dispose(){player.dispose();assert.equal(timers.size,0,'Disposal cancels every pending confirmation timer');}};
}
module.exports={environment};
