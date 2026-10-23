const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const {createSourceLoader}=require(path.join(root,'tests/helpers/actual-source-loader.cjs'));
function fixture(hooks={}){
 let now=0,timer=0,errors=0,confirmations=0;const timers=new Map(),audios=[],changes=[],ticks=[],confirmPoints=[];
 const sandbox={Map,Error,console:{info(){}},performance:{now:()=>now},setTimeout(fn,delay){timers.set(++timer,{fn,at:now+delay});return timer;},clearTimeout(id){timers.delete(id);}};
 const source=createSourceLoader({root,globals:sandbox});
 const inner=source.load('lib/lesson-audio.ts'),wrapper=source.load('lib/explicit-bundled-playback.ts');
 class Media extends EventTarget{
  raw=0;src='https://lantern.local/audio/offline/1935c17708c726884ac9.mp3';currentSrc=this.src;readyState=1;duration=33.151519;paused=true;seeking=false;ended=false;muted=false;playbackRate=1;preload='metadata';plays=0;loads=0;removed=false;targets=[];steps=[];history=new Map();listeners=new Map();error=null;
  seekable={length:1,start:()=>0,end:()=>this.duration};
  get currentTime(){return this.raw;}
  set currentTime(value){this.targets.push(value);this.seeking=true;}
  addEventListener(type,handler){super.addEventListener(type,handler);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);if(!this.history.has(type))this.history.set(type,[]);this.history.get(type).push(handler);}
  removeEventListener(type,handler){super.removeEventListener(type,handler);this.listeners.get(type)?.delete(handler);}
  play(){this.plays++;this.paused=false;return new Promise((resolve,reject)=>{this.resolvePlay=resolve;this.rejectPlay=reject;});}
  pause(){this.steps.push('pause');this.paused=true;this.dispatchEvent(new Event('pause'));}
  removeAttribute(name){assert.equal(name,'src');this.steps.push('remove-src');this.src='';}
  remove(){this.steps.push('remove-node');this.removed=true;}
  load(){this.steps.push(this.src?'load-source':'load-empty');this.loads++;this.raw=0;this.readyState=0;this.duration=NaN;this.seeking=false;this.paused=true;this.ended=false;if(!this.src)this.currentSrc='';this.dispatchEvent(new Event('abort'));this.dispatchEvent(new Event('emptied'));this.dispatchEvent(new Event('pause'));}
  metadata(){this.currentSrc=this.src;this.duration=33.151519;this.readyState=1;this.dispatchEvent(new Event('loadedmetadata'));}
  seek(position){this.raw=position;this.seeking=false;this.dispatchEvent(new Event('seeked'));}
  playing(position=this.raw){this.raw=position;this.dispatchEvent(new Event('playing'));}
  progress(position){this.raw=position;this.dispatchEvent(new Event('timeupdate'));}
  fail(){this.error={code:2};this.dispatchEvent(new Event('error'));}
  late(type){for(const handler of this.history.get(type)||[])handler.call(this,new Event(type));}
 }
 let player;const factory=()=>{hooks.beforeFactory?.(audios);const audio=new Media();audios.push(audio);return audio;};
 player=wrapper.createExplicitBundledPlayback(factory,value=>{changes.push(value);hooks.changed?.(value,player);},()=>{errors++;hooks.failed?.(player);},()=>{confirmations++;confirmPoints.push(player.position());hooks.confirmed?.(player);},position=>{ticks.push(position);hooks.tick?.(position,player);});
 const h={player,audios,changes,ticks,confirmPoints,create:wrapper.createExplicitBundledPlayback,Media,
  get audio(){return audios.at(-1);},get errors(){return errors;},get confirmations(){return confirmations;},get pendingTimers(){return timers.size;},
  advance(ms){now+=ms;},run(ms){const until=now+ms;for(let n=0;n<1000;n++){const next=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next){now=until;return;}timers.delete(next[0]);now=next[1].at;next[1].fn();}assert.fail('Unbounded timers');},
  prepare(target=8,rate=1){player.resume(rate,target);h.audio.metadata();h.audio.seek(target);return h;},
  sustain(audio=h.audio,start=audio.raw){audio.playing(start);audio.progress(start);for(let n=1;n<=3;n++){now+=250;audio.progress(start+n*.25*audio.playbackRate);}return h;}
 };
 return h;
}
test('each explicit action retires the old DOM resource before exactly one factory call',()=>{
 const h=fixture({beforeFactory(audios){for(const audio of audios){assert.equal(audio.removed,true);assert.equal(audio.src,'');assert.equal(audio.steps.at(-1),'remove-node');}}});
 assert.equal(h.audios.length,0);h.prepare(9.969,.85);h.sustain();h.player.pause();assert.equal(h.audios.length,1);h.player.resume(1);assert.equal(h.audios.length,2);h.audio.metadata();h.audio.seek(h.player.position());h.sustain();h.player.stop();assert.equal(h.audios.length,2);h.player.play(1);assert.equal(h.audios.length,3);
 for(const old of h.audios.slice(0,-1)){assert.ok(old.steps.indexOf('remove-src')<old.steps.indexOf('load-empty'));assert.ok(old.steps.indexOf('load-empty')<old.steps.indexOf('remove-node'));assert.ok([...old.listeners.values()].every(set=>set.size===0));}
 h.player.dispose();assert.ok(h.audios.every(a=>a.removed));assert.equal(h.pendingTimers,0);
});
test('first restored checkpoint is retained while fresh metadata and genuine seeked are pending',()=>{
 const h=fixture();h.player.resume(.85,15.170487);assert.equal(h.player.position(),15.170487);assert.equal(h.audio.plays,0);h.audio.metadata();assert.equal(h.audio.plays,0);h.audio.progress(0);assert.equal(h.player.position(),15.170487);assert.ok(h.ticks.every(p=>p===15.170487));h.audio.seek(15.170487);assert.equal(h.audio.plays,1);assert.equal(h.player.position(),15.170487);h.sustain();assert.equal(h.confirmations,1);assert.ok(h.player.position()>15.17);h.player.dispose();
});
test('unconfirmed replay failure cannot replace a positive checkpoint with the new inner zero',()=>{
 const h=fixture().prepare(17);h.sustain();h.audio.progress(18);h.player.pause();assert.equal(h.player.position(),18);h.player.play(1);h.audio.metadata();h.audio.playing(0);h.audio.progress(0);h.advance(250);h.audio.progress(.25);assert.equal(h.player.position(),18);h.audio.fail();assert.equal(h.errors,1);assert.equal(h.confirmations,1);assert.equal(h.player.position(),18);assert.ok(h.ticks.slice(-2).every(p=>p===18));h.player.dispose();
});
test('only a confirmed explicit replay may move checkpoint ownership back near zero',()=>{
 const h=fixture().prepare(17);h.sustain();h.player.play(.85);assert.ok(h.player.position()>17);h.audio.metadata();h.sustain(h.audio,0);assert.equal(h.confirmations,2);assert.ok(h.player.position()>0&&h.player.position()<1);assert.ok(h.confirmPoints[1]<1);h.player.dispose();
});
test('pause and stop cancel pending work without replacing or removing the element',()=>{
 for(const method of ['pause','stop'])for(const phase of ['metadata','seek','progress']){
  const h=fixture();h.player.resume(1,8);if(phase!=='metadata')h.audio.metadata();if(phase==='progress'){h.audio.seek(8);h.audio.playing(8);h.audio.progress(8.2);}const audio=h.audio;h.player[method]();assert.equal(h.audios.length,1);assert.equal(audio.removed,false);assert.equal(audio.paused,true);assert.equal(h.pendingTimers,0);audio.metadata();audio.seek(8);h.sustain(audio,8);h.run(10000);assert.equal(h.confirmations,0);assert.equal(h.errors,0);assert.equal(h.player.position(),8);h.player.dispose();
 }
});
test('retired events, handlers and rejected play promises cannot alter the new action',async()=>{
 const h=fixture().prepare(8);h.sustain();const old=h.audio;h.player.resume(.85);const baseline=h.player.position(),changes=h.changes.length,ticks=h.ticks.length;old.raw=0;old.metadata();old.seek(0);old.playing(0);old.progress(0);old.fail();for(const type of ['pause','ended','error','timeupdate','seeked','loadedmetadata','durationchange','canplay','progress'])old.late(type);old.rejectPlay(Error('late retired failure'));await Promise.resolve();
 assert.equal(h.errors,0);assert.equal(h.confirmations,1);assert.equal(h.changes.length,changes);assert.equal(h.ticks.length,ticks);assert.equal(h.player.position(),baseline);h.audio.metadata();h.audio.seek(baseline);h.sustain();assert.equal(h.confirmations,2);h.player.dispose();
});
test('disposal captures the confirmed point, releases DOM media and is idempotent',()=>{
 const h=fixture().prepare(8);h.sustain();h.advance(4000);h.audio.progress(12.4);const audio=h.audio;h.player.dispose();assert.equal(h.player.position(),12.4);assert.equal(audio.paused,true);assert.equal(audio.src,'');assert.equal(audio.currentSrc,'');assert.equal(audio.removed,true);assert.equal(h.pendingTimers,0);const steps=audio.steps.length,changes=h.changes.length;h.player.dispose();h.player.play(1);h.player.resume(1);audio.late('timeupdate');audio.late('error');assert.equal(audio.steps.length,steps);assert.equal(h.audios.length,1);assert.equal(h.errors,0);assert.equal(h.changes.length,changes);
});
test('a confirmed callback may synchronously start another action without old writes or cleanup',()=>{
 let once=false;const h=fixture({confirmed(player){if(!once){once=true;player.resume(.85);}}}).prepare(8);h.sustain(h.audios[0],8);assert.equal(h.audios.length,2);assert.equal(h.audios[0].removed,true);assert.equal(h.audio.removed,false);assert.equal(h.audio.paused,true);const point=h.player.position();assert.ok(point>8);h.audio.metadata();h.audio.seek(point);h.sustain();assert.equal(h.confirmations,2);assert.equal(h.errors,0);h.player.dispose();
});
test('changed callback reentry cancels the pending old start and only the latest factory can play',()=>{
 let once=false;const h=fixture({changed(value,player){if(value&&!once){once=true;player.resume(.85,6);}}});h.player.resume(1,8);assert.equal(h.audios.length,2);assert.equal(h.audios[0].removed,true);assert.equal(h.audios[0].plays,0);h.audio.metadata();h.audio.seek(6);h.sustain();assert.equal(h.confirmations,1);assert.equal(h.errors,0);h.player.dispose();
});
test('current errors notify failure after changed(false), but changed reentry suppresses an old failure',()=>{
 for(const reenter of [false,true]){
  let armed=false;const h=fixture({changed(value,player){if(!value&&armed&&reenter){armed=false;player.resume(1,8);}}}).prepare(8);armed=true;const old=h.audio;old.fail();assert.equal(h.errors,reenter?0:1);assert.equal(h.audios.length,reenter?2:1);assert.equal(h.player.position(),8);h.player.dispose();
 }
});
test('tick callback reentry cannot continue writing from the retired action',()=>{
 let once=false;const h=fixture({tick(position,player){if(position>8&&!once){once=true;player.stop();}}}).prepare(8);h.sustain();h.audio.progress(9);assert.equal(once,true);const point=h.player.position(),count=h.ticks.length;h.audio.progress(0);h.audio.late('timeupdate');assert.equal(h.player.position(),point);assert.equal(h.ticks.length,count);assert.equal(h.errors,0);h.player.dispose();
});
test('a different logical source owns an independent checkpoint and global stop still pauses the old inner',()=>{
 const h=fixture().prepare(8);h.sustain();const old=h.audio,point=h.player.position(),nextAudio=new h.Media();nextAudio.src=nextAudio.currentSrc='https://lantern.local/audio/offline/0123456789abcdef0123.mp3';
 const next=h.create(()=>nextAudio,()=>{},assert.fail);next.resume(1,4);assert.equal(old.paused,true);assert.equal(h.player.position(),point);assert.equal(next.position(),4);h.player.dispose();assert.equal(old.removed,true);next.dispose();assert.equal(nextAudio.removed,true);
});
test('failed factory after a confirmed old action retains its point and never revives retired media',()=>{
 let fail=false;const h=fixture({beforeFactory(){if(fail)throw Error('factory unavailable');}}).prepare(8);h.sustain();const point=h.player.position(),old=h.audio;fail=true;h.player.resume(1);assert.equal(old.removed,true);assert.equal(old.src,'');assert.equal(h.audios.length,1);assert.equal(h.player.position(),point);assert.equal(h.errors,1);assert.equal(h.changes.at(-1),false);h.player.dispose();
});
test('confirmed and changed callbacks may dispose synchronously with no stale play or checkpoint writes',()=>{
 for(const phase of ['changed','confirmed']){
  let once=false;const h=fixture({[phase](value,player){const p=phase==='confirmed'?value:player;if(!once&&(phase==='confirmed'||value)){once=true;p.dispose();}}});h.player.resume(1,8);const audio=h.audio;
  if(phase==='confirmed'){audio.metadata();audio.seek(8);h.sustain(audio,8);}assert.equal(audio.removed,true);assert.equal(audio.src,'');assert.equal(audio.paused,true);assert.equal(h.pendingTimers,0);const point=h.player.position(),changes=h.changes.length;audio.late('timeupdate');audio.late('error');h.run(10000);assert.equal(h.player.position(),point);assert.equal(h.changes.length,changes);assert.equal(h.errors,0);assert.equal(audio.plays,phase==='confirmed'?1:0);h.player.dispose();
 }
});
