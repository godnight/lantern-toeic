const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function fixture({muted=false,seekRequiresPlay=false}={}){
 const timers=new Map();let timer=0,errors=0,confirmations=0,now=0;
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/lesson-audio.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Map,Error,performance:{now:()=>now},setTimeout:(fn,delay)=>{timers.set(++timer,{fn,delay});return timer;},clearTimeout:id=>timers.delete(id)});
 class Media extends EventTarget{
  raw=0;readyState=1;duration=33.151519;seeking=false;paused=true;ended=false;muted=false;playbackRate=1;plays=0;loads=0;targets=[];activity=[];playMuted=[];playRates=[];loadMuted=[];src='https://lantern.local/audio/test.mp3';currentSrc=this.src;
  seekable={length:1,start:()=>0,end:()=>this.duration};
  get currentTime(){return this.raw;}
  set currentTime(value){if(this.throwSeek)throw Error('seek unavailable');this.targets.push(value);this.seeking=true;}
  play(){this.plays++;this.playMuted.push(this.muted);this.playRates.push(this.playbackRate);this.paused=false;return new Promise(()=>{});}
  pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
  load(){this.loads++;this.loadMuted.push(this.muted);this.raw=0;this.readyState=0;this.duration=NaN;this.seekable.length=0;this.seeking=false;this.paused=true;this.ended=false;this.playbackRate=1;this.dispatchEvent(new Event('pause'));this.dispatchEvent(new Event('emptied'));}
  metadata({duration=33.151519,seekable=true}={}){this.readyState=1;this.duration=duration;this.seekable.length=seekable?1:0;this.dispatchEvent(new Event('loadedmetadata'));}
  rangeReady(){this.seekable.length=1;this.dispatchEvent(new Event('progress'));}
  seek(value){if(this.seekRequiresPlay&&this.paused)return false;this.raw=value;this.seeking=false;this.dispatchEvent(new Event('seeked'));return true;}
  observe(type,value){this.raw=value;const record=phase=>this.activity.push({type,phase,position:this.raw,muted:this.muted,paused:this.paused});record('before');this.dispatchEvent(new Event(type));record('after');}
  playing(value){this.observe('playing',value);}
  progress(value){this.observe('timeupdate',value);}
 }
 const audio=new Media();audio.muted=muted;audio.seekRequiresPlay=seekRequiresPlay;
 const player=exports.createBundledPlayback(audio,()=>{},()=>errors++,()=>confirmations++);
 return {audio,player,Media,createPlayer:exports.createBundledPlayback,advance(ms){now+=ms;},settleSeek(){const entry=[...timers.entries()].find(([,task])=>task.delay===25);assert.ok(entry,'Expected the bounded seek-settling poll');const [id,task]=entry;timers.delete(id);task.fn();},get errors(){return errors;},get confirmations(){return confirmations;},get pendingTimers(){return timers.size;},timeout(){for(const [id,task] of [...timers.entries()])if(task.delay===10000){timers.delete(id);task.fn();}}};
}
test('resume primes muted but waits for an actual seek and new playing/progress before accepting a checkpoint',()=>{
 const h=fixture();h.player.resume(1,8.681);assert.equal(h.audio.plays,1);assert.equal(h.audio.muted,true);assert.deepEqual(h.audio.playMuted,[true]);assert.equal(h.player.position(),8.681);assert.equal(h.confirmations,0);
 h.audio.seek(8.681);assert.equal(h.audio.plays,1,'Seek acknowledgement must not call play twice');h.audio.playing(8.685);assert.equal(h.confirmations,0);assert.equal(h.audio.muted,true);assert.equal(h.player.position(),8.681);
 h.audio.progress(8.7);assert.equal(h.confirmations,1);assert.equal(h.player.position(),8.7);assert.equal(h.audio.muted,false);h.player.dispose();
});
test('a player that returns to zero on play stops and preserves the acknowledged target',()=>{
 const h=fixture();h.player.resume(1,8.681);h.audio.seek(8.681);h.audio.playing(0);assert.equal(h.errors,1);assert.equal(h.audio.paused,true);assert.equal(h.player.position(),8.681);assert.equal(h.confirmations,0);h.player.dispose();
});
test('wrong seeked offset, a throwing setter, and missing seekability never overwrite the baseline',()=>{
 for(const scenario of ['wrong','throw','unseekable']){
  const h=fixture();if(scenario==='throw')h.audio.throwSeek=true;if(scenario==='unseekable')h.audio.seekable.length=0;
  h.player.resume(.85,8.681);if(scenario==='wrong')h.audio.seek(0);if(scenario==='unseekable')h.timeout();
  assert.equal(h.errors,1,scenario);assert.equal(h.player.position(),8.681);assert.equal(h.audio.plays,scenario==='wrong'?1:0);assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,false);h.player.dispose();
 }
});
test('pause during seek cancels late readiness without autoplay or failure',()=>{
 const h=fixture();h.player.resume(1,8.681);assert.equal(h.audio.muted,true);h.player.pause();h.audio.seek(8.681);h.audio.dispatchEvent(new Event('canplay'));h.timeout();assert.equal(h.audio.plays,1);assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,false);assert.equal(h.errors,0);assert.equal(h.player.position(),8.681);h.player.dispose();
});
test('a paused DOM reset cannot become the next resume baseline; later backward progress is rejected',()=>{
 const h=fixture();h.player.resume(1,8.681);h.audio.seek(8.681);h.audio.playing(8.681);h.audio.progress(8.7);h.audio.progress(12.2);h.player.pause();h.audio.raw=0;
 h.player.resume(1);assert.equal(h.audio.targets.at(-1),12.2);h.audio.seek(12.2);h.audio.playing(12.2);h.audio.progress(12.3);h.audio.progress(0);
 assert.equal(h.errors,1);assert.equal(h.player.position(),12.3);assert.equal(h.audio.paused,true);h.player.dispose();
});
test('only explicit replay accepts zero and a failed replay keeps the old position',()=>{
 const h=fixture();h.player.resume(1,8.681);h.audio.seek(8.681);h.audio.playing(8.681);h.audio.progress(8.7);h.player.pause();h.player.play(1);assert.equal(h.player.position(),8.7);h.audio.seek(0);h.audio.playing(0);h.audio.progress(.01);assert.equal(h.player.position(),.01);h.player.dispose();
});

test('delayed first progress allows normal elapsed playback at the selected rate',()=>{
 for(const rate of [.85,1,1.25]){
  const h=fixture();h.player.resume(rate,8.681);h.audio.seek(8.681);h.advance(1400);h.audio.playing(8.681+1.4*rate);h.audio.progress(8.681+1.4*rate+.01);
  assert.equal(h.errors,0);assert.equal(h.confirmations,1);assert.ok(h.player.position()>8.681);h.player.dispose();
 }
});

test('replay on existing media requires an acknowledged zero seek and rejects a failed setter',()=>{
 const h=fixture();h.player.resume(1,8.681);h.audio.seek(8.681);h.audio.playing(8.681);h.audio.progress(8.7);h.player.pause();h.audio.throwSeek=true;h.player.play(1);
 assert.equal(h.errors,1);assert.equal(h.audio.plays,1);assert.equal(h.player.position(),8.7);h.player.dispose();
});
test('startup rejects an implausible forward jump and a backward step after observed progress',()=>{
 for(const mode of ['forward','backward']){
  const h=fixture();h.player.resume(1,8.681);h.audio.seek(8.681);
  if(mode==='forward')h.audio.playing(20);else{h.advance(2000);h.audio.progress(10.6);h.audio.playing(9);}
  assert.equal(h.errors,1,mode);assert.equal(h.player.position(),8.681);assert.equal(h.confirmations,0);h.player.dispose();
 }
});

test('small native clock jitter at a changed rate retains the monotonic confirmed baseline',()=>{
 const h=fixture();h.player.resume(.85,17.6);h.audio.seek(17.6);h.audio.playing(17.6);h.audio.progress(17.8);h.audio.progress(17.5);
 assert.equal(h.errors,0);assert.equal(h.player.position(),17.8);h.audio.progress(18);assert.equal(h.player.position(),18);h.player.dispose();
});

test('native seeked may precede the seeking flag becoming false without rejecting replay or resume',()=>{
 for(const target of [0,8.681]){
  const h=fixture();h.audio.raw=24.2;if(target===0)h.player.play(.85);else h.player.resume(.85,target);
  h.audio.raw=target;h.audio.dispatchEvent(new Event('seeked'));assert.equal(h.errors,0);assert.equal(h.audio.plays,1);assert.equal(h.audio.muted,true);
  h.audio.seeking=false;h.settleSeek();assert.equal(h.audio.plays,1);h.audio.playing(target);h.audio.progress(target+.01);assert.equal(h.confirmations,1);assert.equal(h.audio.muted,false);h.player.dispose();
 }
});
test('pause cancels the bounded native seek-settling wait and cannot autoplay later',()=>{
 const h=fixture();h.player.resume(1,8.681);h.audio.raw=8.681;h.audio.dispatchEvent(new Event('seeked'));h.player.pause();assert.equal(h.pendingTimers,0);h.audio.seeking=false;h.timeout();assert.equal(h.audio.plays,1);assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,false);assert.equal(h.player.position(),8.681);assert.equal(h.errors,0);h.player.dispose();
});

test('a native paused seek that cannot finish until play starts is primed silently and keeps its saved target',()=>{
 const h=fixture({seekRequiresPlay:true});assert.equal(h.audio.seek(9.572),false,'This media fixture cannot finish a paused seek');h.player.resume(.85,9.572);
 assert.equal(h.audio.plays,1);assert.equal(h.audio.paused,false);assert.equal(h.audio.muted,true);assert.equal(h.player.position(),9.572);assert.equal(h.confirmations,0);
 h.audio.playing(0);h.audio.progress(0);assert.equal(h.errors,0,'Pre-seek startup is observed without trusting its position');assert.equal(h.audio.muted,true);assert.equal(h.confirmations,0);assert.equal(h.player.position(),9.572);
 assert.equal(h.audio.seek(9.572),true);assert.equal(h.audio.plays,1);assert.equal(h.audio.muted,true);assert.equal(h.confirmations,0,'Pre-seek progress cannot confirm the new position');
 h.audio.progress(9.6);assert.equal(h.confirmations,1);assert.equal(h.audio.muted,false);assert.equal(h.player.position(),9.6);assert.ok(h.audio.activity.filter(v=>!v.paused&&!v.muted).every(v=>v.position>=9.572));h.player.dispose();
});

test('ignored seeks cannot expose an audible zero or replace the saved checkpoint',()=>{
 const h=fixture();h.player.resume(.85,9.572);h.audio.playing(0);h.audio.progress(0);
 // Even after the engine clears seeking, a genuine acknowledgement is still required.
 h.audio.seeking=false;h.audio.playing(0);h.audio.progress(0);assert.equal(h.errors,0);assert.equal(h.confirmations,0);assert.equal(h.audio.muted,true);assert.equal(h.player.position(),9.572);
 h.audio.seek(0);assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,false);assert.equal(h.player.position(),9.572);
 assert.equal(h.audio.activity.filter(v=>!v.paused&&!v.muted&&v.position===0).length,0);h.player.dispose();
});

test('a zero returned after acknowledged seek still fails while muted and preserves the old point',()=>{
 const h=fixture();h.player.resume(1,9.572);h.audio.seek(9.572);h.audio.playing(0);
 assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.audio.paused,true);assert.equal(h.player.position(),9.572);assert.equal(h.audio.muted,false);
 assert.equal(h.audio.activity.filter(v=>!v.paused&&!v.muted&&v.position===0).length,0);h.player.dispose();
});

test('pause, error, and disposal after muted priming restore the original muted setting',()=>{
 for(const muted of [false,true])for(const action of ['pause','error','dispose']){
  const h=fixture({muted});h.player.resume(1,9.572);assert.equal(h.audio.muted,true);assert.equal(h.audio.plays,1);
  if(action==='pause')h.player.pause();else if(action==='error')h.audio.dispatchEvent(new Event('error'));else h.player.dispose();
  assert.equal(h.audio.paused,true,action);assert.equal(h.audio.muted,muted,action);assert.equal(h.pendingTimers,0,action);assert.equal(h.player.position(),9.572);assert.equal(h.confirmations,0);
  h.audio.seek(9.572);h.audio.playing(9.572);h.audio.progress(9.6);h.timeout();assert.equal(h.audio.plays,1);assert.equal(h.confirmations,0);assert.equal(h.errors,action==='error'?1:0);h.player.dispose();
 }
});

test('successful confirmation restores an already muted source without making it audible',()=>{
 const h=fixture({muted:true});h.player.resume(.85,9.572);h.audio.seek(9.572);h.audio.playing(9.572);h.audio.progress(9.6);
 assert.equal(h.confirmations,1);assert.equal(h.player.position(),9.6);assert.equal(h.audio.muted,true);assert.equal(h.audio.activity.filter(v=>!v.paused&&!v.muted).length,0);h.player.pause();assert.equal(h.audio.muted,true);h.player.dispose();
});

test('starting another source cancels muted priming and late events cannot revive or unmute the old source',()=>{
 for(const muted of [false,true]){
  const h=fixture({muted});h.player.resume(1,9.572);const nextAudio=new h.Media();nextAudio.src=nextAudio.currentSrc='https://lantern.local/audio/next.mp3';
  const next=h.createPlayer(nextAudio,()=>{},assert.fail);next.resume(.85,5);
  assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,muted);assert.equal(nextAudio.muted,true);assert.equal(h.player.position(),9.572);assert.equal(h.confirmations,0);
  h.audio.seek(9.572);h.audio.playing(9.572);h.audio.progress(9.6);assert.equal(h.audio.plays,1);assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,muted);assert.equal(h.confirmations,0);assert.equal(h.errors,0);assert.equal(nextAudio.muted,true);
  next.dispose();h.player.dispose();assert.equal(nextAudio.muted,false);assert.equal(h.pendingTimers,0);
 }
});

test('ordinary pause never reloads while suspension marks exactly one reload for the next user resume',()=>{
 const h=fixture();h.player.resume(.85,9.572);h.audio.seek(9.572);h.audio.playing(9.572);h.audio.progress(9.6);h.player.pause();assert.equal(h.audio.loads,0);
 h.player.resume(.85);h.audio.playing(9.6);h.audio.progress(9.7);h.player.pause(true);h.player.pause();
 const plays=h.audio.plays;assert.equal(h.audio.loads,0,'Suspension must not reload by itself');assert.equal(h.audio.paused,true);assert.equal(h.player.position(),9.7);
 h.audio.dispatchEvent(new Event('canplay'));h.audio.dispatchEvent(new Event('loadedmetadata'));h.timeout();assert.equal(h.audio.plays,plays);assert.equal(h.audio.loads,0);
 h.player.resume(.85);assert.equal(h.audio.loads,1);assert.equal(h.audio.plays,plays);assert.equal(h.audio.muted,true);assert.equal(h.player.position(),9.7);
 h.audio.metadata();h.audio.seek(9.7);h.audio.playing(9.7);h.audio.progress(9.8);h.player.pause();h.player.resume(.85);
 assert.equal(h.audio.loads,1,'The consumed suspension marker must not reload every ordinary resume');h.player.dispose();
});

test('suspending a pending request cannot load or autoplay until a fresh user action',()=>{
 const h=fixture();h.player.resume(.85,9.572);h.player.pause(true);
 assert.equal(h.audio.loads,0);assert.equal(h.audio.plays,1);assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,false);assert.equal(h.player.position(),9.572);assert.equal(h.pendingTimers,0);
 h.audio.metadata();h.audio.seek(9.572);h.audio.playing(9.572);h.audio.progress(9.6);h.timeout();
 assert.equal(h.audio.loads,0);assert.equal(h.audio.plays,1);assert.equal(h.audio.paused,true);assert.equal(h.confirmations,0);assert.equal(h.errors,0);h.player.dispose();
});

test('reload keeps the old checkpoint through zero and requires new metadata plus a seekable range',()=>{
 for(const muted of [false,true]){
  const h=fixture({muted});h.player.resume(.85,16.3);h.audio.seek(16.3);h.audio.playing(16.3);h.audio.progress(16.34);h.player.pause(true);h.audio.activity.length=0;
  const plays=h.audio.plays,confirmed=h.confirmations;h.player.resume(.85);
  assert.equal(h.audio.loads,1);assert.deepEqual(h.audio.loadMuted,[true]);assert.equal(h.audio.currentTime,0);assert.equal(h.audio.playbackRate,1,'The fixture resets the decoder rate on load');assert.equal(h.audio.plays,plays);assert.equal(h.audio.muted,true);assert.equal(h.player.position(),16.34);assert.equal(h.confirmations,confirmed);
  // Some native engines expose stale readyState/ranges before the new metadata event.
  h.audio.readyState=1;h.audio.duration=33.151519;h.audio.seekable.length=1;h.audio.dispatchEvent(new Event('canplay'));h.audio.dispatchEvent(new Event('progress'));
  assert.equal(h.audio.plays,plays,'Old readiness cannot certify the reloaded decoder');assert.equal(h.player.position(),16.34);
  h.audio.metadata({seekable:false});assert.equal(h.audio.plays,plays);assert.equal(h.audio.muted,true);assert.equal(h.player.position(),16.34);
  h.audio.rangeReady();assert.equal(h.audio.plays,plays+1);assert.equal(h.audio.targets.at(-1),16.34);assert.equal(h.audio.playRates.at(-1),.85);assert.equal(h.audio.playMuted.at(-1),true);assert.equal(h.audio.muted,true);
  h.audio.playing(0);h.audio.progress(0);assert.equal(h.confirmations,confirmed);assert.equal(h.player.position(),16.34);assert.equal(h.errors,0);
  h.audio.seek(16.34);h.audio.progress(16.4);assert.equal(h.confirmations,confirmed+1);assert.equal(h.player.position(),16.4);assert.equal(h.audio.muted,muted);
  assert.equal(h.audio.activity.filter(v=>!v.paused&&!v.muted&&v.position===0).length,0);h.player.dispose();
 }
});

test('explicit pause cancels a reload wait and late metadata cannot prime playback or write zero',()=>{
 for(const muted of [false,true]){
  const h=fixture({muted});h.player.resume(.85,9.572);h.audio.seek(9.572);h.audio.playing(9.572);h.audio.progress(9.6);h.player.pause(true);const plays=h.audio.plays,confirmed=h.confirmations;
  h.player.resume(.85);assert.equal(h.audio.loads,1);assert.equal(h.audio.muted,true);h.player.pause();assert.equal(h.pendingTimers,0);assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,muted);
  h.audio.metadata();h.audio.rangeReady();h.audio.seek(9.6);h.audio.playing(9.6);h.audio.progress(9.7);h.timeout();
  assert.equal(h.audio.plays,plays);assert.equal(h.confirmations,confirmed);assert.equal(h.player.position(),9.6);assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,muted);assert.equal(h.errors,0);h.player.dispose();
 }
});

test('reload failure preserves the pre-suspension point and restores mute after stopping',()=>{
 for(const mode of ['timeout','wrong-seek']){
  const h=fixture();h.player.resume(.85,9.572);h.audio.seek(9.572);h.audio.playing(9.572);h.audio.progress(9.6);h.player.pause(true);const plays=h.audio.plays,confirmed=h.confirmations;
  h.player.resume(.85);assert.equal(h.player.position(),9.6);if(mode==='timeout')h.timeout();else{h.audio.metadata();h.audio.seek(0);}
  assert.equal(h.errors,1,mode);assert.equal(h.audio.loads,1);assert.equal(h.audio.plays,mode==='timeout'?plays:plays+1);assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,false);assert.equal(h.player.position(),9.6);assert.equal(h.confirmations,confirmed);assert.equal(h.pendingTimers,0);h.player.dispose();
 }
});

test('switching source during reload cancels old metadata and leaves the next source muted until its own proof',()=>{
 const h=fixture();h.player.resume(.85,9.572);h.audio.seek(9.572);h.audio.playing(9.572);h.audio.progress(9.6);h.player.pause(true);const plays=h.audio.plays,confirmed=h.confirmations;h.player.resume(.85);
 const nextAudio=new h.Media();nextAudio.src=nextAudio.currentSrc='https://lantern.local/audio/other.mp3';const next=h.createPlayer(nextAudio,()=>{},assert.fail);next.resume(1,5);
 assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,false);assert.equal(nextAudio.muted,true);h.audio.metadata();h.audio.rangeReady();h.audio.seek(9.6);
 assert.equal(h.audio.plays,plays);assert.equal(h.confirmations,confirmed);assert.equal(h.player.position(),9.6);assert.equal(nextAudio.muted,true);assert.equal(h.errors,0);next.dispose();h.player.dispose();assert.equal(h.pendingTimers,0);
});
