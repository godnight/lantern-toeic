const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function fixture({muted=false,seekRequiresPlay=false,setterEcho=false,setterSeeking=true,logThrows=false,onConfirmed}={}){
 const timers=new Map(),logs=[];let timer=0,errors=0,confirmations=0,now=0;
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(process.env.CT_AUDIO_CONTROLLER_SOURCE||path.join(__dirname,'../lib/lesson-audio.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,Map,Error,performance:{now:()=>now},console:{info(line){if(logThrows)throw Error('logger unavailable');logs.push(JSON.parse(line.slice('Bundled playback '.length)));}},
  setTimeout:(fn,delay)=>{timers.set(++timer,{fn,delay,at:now+delay});return timer;},clearTimeout:id=>timers.delete(id)
 });
 class Media extends EventTarget{
  raw=0;readyState=1;duration=33.151519;seeking=false;paused=true;ended=false;muted=false;preload='metadata';playbackRate=1;plays=0;loads=0;targets=[];playMuted=[];playRates=[];loadPaused=[];loadPreload=[];error=null;src='https://lantern.local/audio/offline/1935c17708c726884ac9.mp3';currentSrc=this.src;
  seekable={length:1,start:()=>0,end:()=>this.duration};
  get currentTime(){return this.raw;}
  set currentTime(value){if(this.throwSeek)throw Error('seek unavailable');this.targets.push(value);if(setterEcho)this.raw=value;this.seeking=setterSeeking;}
  play(){this.plays++;this.playMuted.push(this.muted);this.playRates.push(this.playbackRate);this.paused=false;return new Promise((resolve,reject)=>{this.resolvePlay=resolve;this.rejectPlay=reject;});}
  pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
  load(){this.loads++;this.loadPaused.push(this.paused);this.loadPreload.push(this.preload);this.raw=0;this.readyState=0;this.duration=NaN;this.seekable.length=0;this.seeking=false;this.paused=true;this.ended=false;this.playbackRate=1;this.dispatchEvent(new Event('pause'));this.dispatchEvent(new Event('emptied'));this.dispatchEvent(new Event('abort'));}
  metadata({duration=33.151519,seekable=false}={}){this.readyState=1;this.duration=duration;this.seekable.length=seekable?1:0;this.currentSrc=this.src;this.dispatchEvent(new Event('loadedmetadata'));}
  rangeReady(){this.seekable.length=1;this.dispatchEvent(new Event('progress'));}
  seek(value){if(seekRequiresPlay&&this.paused)return false;this.raw=value;this.seeking=false;this.dispatchEvent(new Event('seeked'));return true;}
  playing(value=this.raw){this.raw=value;this.dispatchEvent(new Event('playing'));}
  progress(value){this.raw=value;this.dispatchEvent(new Event('timeupdate'));}
 }
 const audio=new Media();audio.muted=muted;const player=exports.createBundledPlayback(audio,()=>{},()=>errors++,()=>{confirmations++;onConfirmed?.(player);});
 const h={audio,player,Media,logs,createPlayer:exports.createBundledPlayback,advance(ms){now+=ms;},
  run(ms){const until=now+ms;for(let count=0;count<1000;count++){const next=[...timers.entries()].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next){now=until;return;}const[id,t]=next;timers.delete(id);now=t.at;t.fn();}assert.fail('Unbounded timers');},
  begin(target=8.681,rate=1){player.resume(rate,target);audio.metadata();return h;},
  sustain(start=audio.raw,rate=audio.playbackRate){audio.playing(start);audio.progress(start);for(let i=1;i<=3;i++){h.advance(250);audio.progress(start+i*.25*rate);}return h;},
  get errors(){return errors;},get confirmations(){return confirmations;},get pendingTimers(){return timers.size;}};
 return h;
}
test('fresh paused preload and empty seekable permit a seek attempt but never play before genuine settled seeked',()=>{
 const h=fixture();h.player.resume(.85,14.376);assert.equal(h.audio.loads,1);assert.deepEqual(h.audio.loadPaused,[true]);assert.deepEqual(h.audio.loadPreload,['auto']);assert.equal(h.audio.plays,0);assert.equal(h.audio.muted,false);assert.equal(h.player.position(),14.376);
 h.audio.metadata();assert.equal(h.audio.seekable.length,0);assert.deepEqual(h.audio.targets,[14.376]);assert.equal(h.audio.plays,0);h.audio.seek(14.376);assert.equal(h.audio.plays,1);assert.deepEqual(h.audio.playMuted,[false]);assert.deepEqual(h.audio.playRates,[.85]);h.sustain();assert.equal(h.confirmations,1);h.player.dispose();assert.equal(h.pendingTimers,0);
});
test('setter echo without genuine seeked and an engine needing play to seek both fail without hidden priming',()=>{
 for(const options of [{setterEcho:true,setterSeeking:false},{seekRequiresPlay:true}]){
  const h=fixture(options).begin();if(options.seekRequiresPlay)assert.equal(h.audio.seek(8.681),false);h.audio.rangeReady();h.audio.dispatchEvent(new Event('canplay'));h.audio.progress(8.681);assert.equal(h.audio.plays,0);h.run(10000);assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8.681);assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,false);h.player.dispose();
 }
});
test('fresh metadata is required even if old readiness and ranges survive load',()=>{
 const h=fixture();h.player.resume(1,8.681);h.audio.readyState=1;h.audio.duration=33.151519;h.audio.rangeReady();h.audio.dispatchEvent(new Event('canplay'));assert.deepEqual(h.audio.targets,[]);assert.equal(h.audio.plays,0);h.audio.metadata({seekable:false});assert.deepEqual(h.audio.targets,[8.681]);h.audio.seek(8.681);h.sustain();assert.equal(h.confirmations,1);h.player.dispose();
});
test('wrong seek, throwing setter and invalid metadata preserve checkpoint without play',()=>{
 for(const mode of ['wrong','throw','duration']){const h=fixture();if(mode==='throw')h.audio.throwSeek=true;h.player.resume(.85,8.681);h.audio.metadata({duration:mode==='duration'?NaN:33.151519});if(mode==='wrong')h.audio.seek(0);if(mode==='duration')h.run(10000);assert.equal(h.errors,1,mode);assert.equal(h.audio.plays,0);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8.681);h.player.dispose();}
});
test('real seeked with transitional seeking flag remains paused until settled and is bounded',()=>{
 for(const settles of [true,false]){const h=fixture().begin();h.audio.raw=8.681;h.audio.dispatchEvent(new Event('seeked'));assert.equal(h.audio.plays,0);assert.equal(h.audio.paused,true);if(settles){h.audio.seeking=false;h.run(25);assert.equal(h.audio.plays,1);h.sustain();assert.equal(h.confirmations,1);}else{h.run(10000);assert.equal(h.audio.plays,0);assert.equal(h.errors,1);assert.equal(h.player.position(),8.681);}h.player.dispose();assert.equal(h.pendingTimers,0);}
});
test('explicit pause and disposal cancel each pending stage and every late event',()=>{
 for(const phase of ['metadata','seek','settling','progress'])for(const action of ['pause','dispose']){const h=fixture();h.player.resume(1,8.681);if(phase!=='metadata')h.audio.metadata();if(phase==='settling'){h.audio.raw=8.681;h.audio.dispatchEvent(new Event('seeked'));}if(phase==='progress'){h.audio.seek(8.681);h.audio.playing();h.audio.progress(8.8);}const plays=h.audio.plays;h.player[action]();assert.equal(h.pendingTimers,0);h.audio.metadata();h.audio.seek(8.681);h.sustain(8.681);h.run(10000);assert.equal(h.audio.plays,plays,phase+action);assert.equal(h.confirmations,0);assert.equal(h.errors,0);assert.equal(h.player.position(),8.681);assert.equal(h.audio.paused,true);h.player.dispose();}
});
test('source changes at any stage including declared src alone cannot certify the old target',()=>{
 for(const phase of ['metadata','seek','progress','src-only']){const h=fixture();h.player.resume(1,8.681);if(phase!=='metadata')h.audio.metadata();if(phase==='progress'){h.audio.seek(8.681);h.audio.playing();h.audio.progress(8.8);}h.audio.src='https://lantern.local/audio/offline/0123456789abcdef0123.mp3';if(phase!=='src-only')h.audio.currentSrc=h.audio.src;if(phase==='metadata')h.audio.metadata();else if(phase==='progress')h.audio.progress(8.9);else h.audio.seek(8.681);assert.equal(h.errors,1,phase);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8.681);assert.equal(h.audio.paused,true);h.player.dispose();}
});
test('another player cancels old preparation and late callbacks cannot revive it',()=>{
 for(const phase of ['metadata','seek','progress']){const h=fixture();h.player.resume(1,8.681);if(phase!=='metadata')h.audio.metadata();if(phase==='progress'){h.audio.seek(8.681);h.audio.playing();h.audio.progress(8.8);}const plays=h.audio.plays,nextAudio=new h.Media();nextAudio.src=nextAudio.currentSrc='https://lantern.local/audio/offline/0123456789abcdef0123.mp3';const next=h.createPlayer(nextAudio,()=>{},assert.fail);next.resume(.85,5);h.audio.metadata();h.audio.seek(8.681);h.sustain(8.681);assert.equal(h.audio.plays,plays);assert.equal(h.audio.paused,true);assert.equal(h.confirmations,0);assert.equal(h.errors,0);assert.equal(h.player.position(),8.681);next.dispose();h.player.dispose();assert.equal(h.pendingTimers,0);}
});
test('selected rates need three advancing updates over a 750ms window after the first observation',()=>{
 for(const rate of [.85,1,1.25]){const h=fixture().begin(8.681,rate);h.audio.seek(8.681);h.audio.playing();h.audio.progress(8.681);h.advance(250);h.audio.progress(8.681+.25*rate);h.advance(250);h.audio.progress(8.681+.5*rate);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8.681);h.advance(250);h.audio.progress(8.681+.75*rate);assert.equal(h.confirmations,1);assert.equal(h.audio.playbackRate,rate);h.player.dispose();}
});
test('short real progress then error or pause never creates the QA-like premature checkpoint',()=>{
 for(const action of ['error','pause']){const h=fixture().begin(13.189);h.audio.seek(13.189);h.audio.playing();h.audio.progress(13.189);h.advance(365);h.audio.progress(13.554);if(action==='error'){h.audio.error={code:3};h.audio.dispatchEvent(new Event('error'));}else h.player.pause();assert.equal(h.errors,action==='error'?1:0);assert.equal(h.confirmations,0);assert.equal(h.player.position(),13.189);assert.equal(h.audio.paused,true);h.player.dispose();}
});
test('first progress, repeated stationary timeupdates and resolved play do not prove sustained playback',async()=>{
 const h=fixture().begin(10.218);h.audio.seek(10.218);h.audio.playing();h.audio.resolvePlay();await Promise.resolve();h.audio.progress(10.373);for(let i=0;i<4;i++){h.advance(250);h.audio.progress(10.373);}assert.equal(h.confirmations,0);assert.equal(h.player.position(),10.218);h.run(9000);assert.equal(h.errors,1);assert.equal(h.audio.paused,true);assert.equal(h.player.position(),10.218);h.player.dispose();
});
test('waiting and stalled invalidate the partial window; only fresh sustained progression may confirm',()=>{
 for(const event of ['waiting','stalled']){const h=fixture().begin();h.audio.seek(8.681);h.audio.playing();h.audio.progress(8.681);h.advance(300);h.audio.progress(8.981);h.audio.dispatchEvent(new Event(event));h.advance(500);h.audio.progress(9.1);assert.equal(h.confirmations,0);h.audio.playing(9.1);h.sustain(9.1);assert.equal(h.confirmations,1);h.player.dispose();}
});
test('wait then timeout cannot turn short progression into a saved checkpoint',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.audio.playing();h.audio.progress(8.7);h.advance(300);h.audio.progress(9);h.audio.dispatchEvent(new Event('waiting'));h.run(9700);assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8.681);h.player.dispose();
});
test('play rejection, native abort after metadata, and premature ended preserve the old point',async()=>{
 for(const event of ['reject','abort','ended']){const h=fixture().begin();h.audio.seek(8.681);if(event==='reject'){h.audio.rejectPlay(Object.assign(Error('private URL must never be logged'),{name:'NotAllowedError'}));await Promise.resolve();}else{if(event==='ended')h.audio.ended=true;h.audio.dispatchEvent(new Event(event));}assert.equal(h.errors,1,event);assert.equal(h.confirmations,0);assert.equal(h.audio.paused,true);assert.equal(h.player.position(),8.681);assert.ok(!JSON.stringify(h.logs).includes('private URL'));h.player.dispose();}
});
test('a paused DOM zero reset is not the next resume target and later backward playback is rejected',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.sustain();h.advance(3000);h.audio.progress(12.2);h.player.pause();h.audio.raw=0;h.player.resume(.85);assert.equal(h.audio.targets.at(-1),12.2);assert.equal(h.audio.plays,1);h.audio.seek(12.2);h.sustain(12.2);assert.equal(h.confirmations,2);h.audio.progress(0);assert.equal(h.errors,1);assert.ok(h.player.position()>12.2);h.player.dispose();
});
test('only explicit replay may replace a nonzero point with confirmed progression from zero',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.sustain();h.player.pause();const old=h.player.position();h.player.play(.85);assert.equal(h.audio.targets.at(-1),0);assert.equal(h.audio.plays,1);assert.equal(h.player.position(),old);h.audio.seek(0);assert.equal(h.audio.plays,2);h.sustain(0);assert.equal(h.confirmations,2);assert.ok(h.player.position()<1);h.player.dispose();
});
test('fresh zero replay needs valid fresh metadata and sustained progression but no invented seeked',()=>{
 const h=fixture();h.player.play(.85);assert.equal(h.audio.plays,0);h.audio.metadata();assert.equal(h.audio.plays,1);assert.deepEqual(h.audio.targets,[]);assert.equal(h.confirmations,0);h.sustain(0);assert.equal(h.confirmations,1);h.player.dispose();
});
test('replay timeout preserves old point and late seeked does not restart',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.sustain();h.player.pause();const old=h.player.position();h.player.play(1);h.run(10000);assert.equal(h.audio.plays,1);assert.equal(h.errors,1);assert.equal(h.player.position(),old);h.audio.seek(0);h.sustain(0);assert.equal(h.audio.plays,1);assert.equal(h.confirmations,1);h.player.dispose();
});
test('ordinary pause is warm while suspension causes exactly one paused reload with fresh metadata',()=>{
 const h=fixture().begin(9.572,.85);h.audio.seek(9.572);h.sustain();h.player.pause();h.player.resume(.85);assert.equal(h.audio.loads,1);assert.equal(h.audio.plays,1);h.audio.seek(h.player.position());h.sustain();h.player.pause(true);h.player.pause();const old=h.player.position(),plays=h.audio.plays;h.player.resume(.85);assert.equal(h.audio.loads,2);assert.equal(h.audio.plays,plays);assert.equal(h.player.position(),old);assert.ok(h.audio.loadPaused.every(Boolean));h.audio.metadata({seekable:false});assert.equal(h.audio.targets.at(-1),old);assert.equal(h.audio.plays,plays);h.audio.seek(old);h.sustain();h.player.pause();h.player.resume(1);assert.equal(h.audio.loads,2);h.player.dispose();
});
test('reload cancellation prevents all late metadata, seeked, progress and zero checkpoint writes',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.sustain();h.player.pause(true);const old=h.player.position(),plays=h.audio.plays,confirmed=h.confirmations;h.player.resume(1);h.player.pause();h.audio.metadata();h.audio.rangeReady();h.audio.seek(old);h.sustain(old);h.run(10000);assert.equal(h.audio.plays,plays);assert.equal(h.confirmations,confirmed);assert.equal(h.errors,0);assert.equal(h.player.position(),old);assert.equal(h.audio.paused,true);assert.equal(h.pendingTimers,0);h.player.dispose();
});
test('the controller never changes either original muted state to prepare or play',()=>{
 for(const muted of [true,false]){const h=fixture({muted}).begin();assert.equal(h.audio.muted,muted);h.audio.seek(8.681);assert.deepEqual(h.audio.playMuted,[muted]);h.sustain();h.player.pause();assert.equal(h.audio.muted,muted);h.player.dispose();}
});
test('short tracks and short genuine remainders may confirm only a fully observed natural end',()=>{
 for(const [target,duration,rate] of [[0,.4,1],[0,1.049433,1.15],[32.7,33.151519,.85]]){const h=fixture();if(target===0)h.player.play(rate);else h.player.resume(rate,target);h.audio.metadata({duration});if(target)h.audio.seek(target);h.audio.playing(target);const wall=(duration-target)/rate*1000;h.advance(wall*.5);h.audio.progress(target+(duration-target)*.5);assert.equal(h.confirmations,0);h.advance(wall*.5);h.audio.progress(duration);h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('pause'));h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,0);assert.equal(h.confirmations,1);assert.equal(h.player.position(),duration);assert.ok(h.logs.some(l=>l.event==='confirmed-short-end'));h.player.dispose();}
});
test('instant, same-position, interrupted, or incomplete short ended cannot invent a completed checkpoint',()=>{
 for(const mode of ['instant','same','interrupted','incomplete']){const h=fixture();h.player.play(1);h.audio.metadata({duration:.4});h.audio.playing(0);if(mode!=='instant'){h.advance(200);h.audio.progress(.2);if(mode==='interrupted')h.audio.dispatchEvent(new Event('waiting'));h.advance(200);}h.audio.raw=mode==='same'?.2:mode==='incomplete'?.3:.4;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,1,mode);assert.equal(h.confirmations,0);assert.equal(h.player.position(),0);h.player.dispose();}
});
test('diagnostics have bounded sampling, terminal evidence, first-progression separation, and no sensitive strings',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.audio.playing();for(let i=0;i<100;i++){h.advance(20);h.audio.progress(8.7);}h.run(8000);assert.equal(h.confirmations,0);assert.ok(h.logs.length<=33);assert.equal(h.logs.at(-1).event,'rejected');assert.ok(h.logs.every(l=>typeof l.player==='number'&&typeof l.request==='number'));assert.ok(h.logs.some(l=>l.firstProgressPosition===8.7));assert.ok(!JSON.stringify(h.logs).includes('https://'));h.player.dispose();
 const broken=fixture({logThrows:true}).begin();broken.audio.seek(8.681);broken.sustain();assert.equal(broken.errors,0);assert.equal(broken.confirmations,1);broken.player.dispose();
});

test('duration shrink cannot reclassify a long startup as a completed short remainder',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.audio.playing();h.advance(200);h.audio.progress(8.881);h.advance(200);h.audio.duration=9.081;h.audio.raw=9.081;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('pause'));h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8.681);h.player.dispose();
});

test('short natural completion measures the actual playing window, not delayed play request time',()=>{
 const h=fixture();h.player.play(1);h.audio.metadata({duration:1});h.advance(900);h.audio.playing(0);h.advance(10);h.audio.progress(.5);h.advance(90);h.audio.raw=1;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('pause'));h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,1);assert.equal(h.confirmations,0);h.player.dispose();
});
test('initial buffering before first playing does not invent progress and a full short end still needs its real playing duration',()=>{
 const h=fixture();h.player.play(1);h.audio.metadata({duration:.4});h.audio.dispatchEvent(new Event('waiting'));h.advance(900);h.audio.progress(.1);assert.equal(h.confirmations,0);h.audio.playing(0);h.advance(200);h.audio.progress(.2);h.advance(200);h.audio.progress(.4);h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('pause'));h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,0);assert.equal(h.confirmations,1);h.player.dispose();
});

test('startup rejects an implausible forward leap even after a valid paused seek',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.audio.playing(20);assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8.681);h.player.dispose();
});
test('confirmed clock jitter preserves a monotonic checkpoint and a later true reset fails with terminal evidence',()=>{
 const h=fixture().begin(17.6,.85);h.audio.seek(17.6);h.sustain();const confirmed=h.player.position();h.audio.progress(confirmed-.3);assert.equal(h.errors,0);assert.equal(h.player.position(),confirmed);h.audio.progress(confirmed+.2);h.audio.progress(0);assert.equal(h.errors,1);assert.equal(h.player.position(),confirmed+.2);assert.equal(h.confirmations,1);assert.equal(h.logs.at(-1).event,'rejected');assert.equal(h.logs.at(-1).stage,'playing');assert.equal(h.logs.at(-1).reason,'confirmed-position');h.player.dispose();
});


test('r14 regression A: stationary updates and late playing cannot cash in three old advances',async()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.audio.playing();h.audio.progress(8.681);
 for(let i=1;i<=3;i++){h.advance(200);h.audio.progress(8.681+.2*i);}
 assert.equal(h.confirmations,0);h.advance(200);h.audio.progress(9.281);h.audio.playing(9.281);h.audio.resolvePlay();await Promise.resolve();
 assert.equal(h.confirmations,0,'Idle time cannot complete an old progression window');assert.equal(h.player.position(),8.681);
 h.run(9200);assert.equal(h.errors,1);assert.equal(h.player.position(),8.681);h.player.dispose();
});
test('r14 regression B: NaN during paused seek cannot start or bypass the four-second remainder guard',()=>{
 const h=fixture();h.player.resume(1,8);h.audio.metadata({duration:12});h.audio.duration=NaN;h.audio.seek(8);
 h.audio.playing(8);h.advance(500);h.audio.progress(8.5);h.audio.duration=12;h.advance(2500);h.audio.raw=12;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('pause'));h.audio.dispatchEvent(new Event('ended'));
 assert.equal(h.confirmations,0);assert.equal(h.audio.plays,0);assert.equal(h.errors,1);assert.equal(h.player.position(),8);h.player.dispose();
});
test('instantaneous progression bursts cannot accumulate a continuous startup window',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.audio.playing();h.audio.progress(8.681);h.audio.progress(8.881);h.audio.progress(9.081);h.audio.progress(9.281);
 h.advance(800);h.audio.progress(9.281);assert.equal(h.confirmations,0);h.advance(200);h.audio.progress(9.481);assert.equal(h.confirmations,0);
 h.sustain(9.481);assert.equal(h.confirmations,1,'A new actual bounded progression chain can succeed');h.player.dispose();
});
test('a gap above 500ms resets old advances while the inclusive 500ms boundary stays usable',()=>{
 for(const gap of [500,501]){
  const h=fixture().begin();h.audio.seek(8.681);h.audio.playing();h.audio.progress(8.681);h.advance(gap);h.audio.progress(9.181);h.advance(250);h.audio.progress(9.431);h.advance(250);h.audio.progress(9.681);
  assert.equal(h.confirmations,gap===500?1:0,String(gap));if(gap===501){assert.equal(h.player.position(),8.681);h.advance(250);h.audio.progress(9.931);assert.equal(h.confirmations,1);}h.player.dispose();
 }
});
test('a quiet long gap followed by a new forward sample starts a fresh window and keeps the old point meanwhile',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.audio.playing();h.audio.progress(8.681);h.advance(250);h.audio.progress(8.931);h.advance(250);h.audio.progress(9.181);h.advance(1000);h.audio.progress(9.381);
 assert.equal(h.confirmations,0);assert.equal(h.player.position(),8.681);h.sustain(9.381);assert.equal(h.confirmations,1);h.player.dispose();
});
test('nonfinite or nonpositive initial metadata cannot seek or play',()=>{
 for(const duration of [NaN,Infinity,-Infinity,0,-1]){
  const h=fixture();h.player.resume(1,8);h.audio.metadata({duration});assert.equal(h.audio.targets.length,0);assert.equal(h.audio.plays,0);h.run(10000);assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8);h.player.dispose();
 }
});
test('invalid duration between metadata and genuine seeked rejects before play even without durationchange',()=>{
 for(const duration of [NaN,Infinity,-Infinity,0,-1]){
  const h=fixture();h.player.resume(1,8);h.audio.metadata({duration:12});h.audio.duration=duration;h.audio.seek(8);assert.equal(h.audio.plays,0,String(duration));assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8);h.player.dispose();
 }
});
test('durationchange during paused seek is rejected and restored metadata cannot revive the request',()=>{
 const h=fixture();h.player.resume(1,8);h.audio.metadata({duration:12});h.audio.duration=NaN;h.audio.dispatchEvent(new Event('durationchange'));h.audio.metadata({duration:12});h.audio.seek(8);h.sustain(8);assert.equal(h.audio.plays,0);assert.equal(h.confirmations,0);assert.equal(h.errors,1);assert.equal(h.player.position(),8);h.player.dispose();
});
test('invalid duration after play but before sustained acceptance fails closed',()=>{
 for(const duration of [NaN,Infinity,0]){
  const h=fixture().begin();h.audio.seek(8.681);h.audio.playing();h.audio.progress(8.681);h.advance(250);h.audio.progress(8.931);h.audio.duration=duration;h.advance(250);h.audio.progress(9.181);assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8.681);h.player.dispose();
 }
});
test('short-end requires finite accepted metadata and a real endpoint within the original tail proof',()=>{
 for(const duration of [NaN,Infinity,-Infinity,0,1.2]){
  const h=fixture();h.player.play(1);h.audio.metadata({duration:1});h.audio.playing(0);h.advance(500);h.audio.progress(.5);h.audio.duration=duration;h.advance(500);h.audio.raw=1;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('pause'));h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,1,String(duration));assert.equal(h.confirmations,0);assert.equal(h.player.position(),0);h.player.dispose();
 }
});
test('loss of metadata readiness during paused seek cannot start playback',()=>{
 const h=fixture().begin();h.audio.readyState=0;h.audio.seek(8.681);assert.equal(h.audio.plays,0);assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8.681);h.player.dispose();
});

test('only the requested paused seek is allowed; a real seek after play invalidates either startup path',()=>{
 for(const short of [false,true]){
  const h=fixture();if(short){h.player.play(1);h.audio.metadata({duration:1});}else{h.begin();h.audio.dispatchEvent(new Event('seeking'));assert.equal(h.errors,0);h.audio.seek(8.681);}
  const target=short?0:8.681;h.audio.playing(target);h.audio.progress(target);h.advance(250);h.audio.progress(target+.25);h.audio.seeking=true;h.audio.dispatchEvent(new Event('seeking'));
  assert.equal(h.errors,1);assert.equal(h.audio.paused,true);h.audio.seek(short?.99:9.2);h.advance(750);h.audio.raw=short?1:9.5;h.audio.ended=true;h.audio.dispatchEvent(new Event('ended'));assert.equal(h.confirmations,0);assert.equal(h.player.position(),target);h.player.dispose();
 }
});
test('a late seeking notification with its flag already false cannot reject a settled requested seek',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.audio.dispatchEvent(new Event('seeking'));assert.equal(h.errors,0);h.sustain();assert.equal(h.confirmations,1);h.player.dispose();
});
test('unrequested seeking after confirmation stops without capturing the jumped position',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.sustain();const old=h.player.position();h.audio.raw=20;h.audio.seeking=true;h.audio.dispatchEvent(new Event('seeking'));assert.equal(h.errors,1);assert.equal(h.confirmations,1);assert.equal(h.player.position(),old);assert.equal(h.audio.paused,true);h.player.dispose();
});
test('a short-end cannot turn a delayed first advance and simultaneous ended into a full observed tail',()=>{
 const h=fixture();h.player.play(1);h.audio.metadata({duration:1});h.audio.playing(0);h.advance(800);h.audio.progress(.5);h.audio.raw=1;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),0);h.player.dispose();
});
test('confirmed checkpoint capture rejects duration mutation even without a durationchange event',()=>{
 for(const action of ['position','pause','stop','ended','natural-pause'])for(const duration of [NaN,Infinity,0,34]){
  const h=fixture().begin();h.audio.seek(8.681);h.sustain();const old=h.player.position();h.audio.duration=duration;h.audio.raw=20;
  if(action==='ended'||action==='natural-pause'){h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event(action==='ended'?'ended':'pause'));}else h.player[action]();
  assert.equal(h.player.position(),old,action+String(duration));assert.equal(h.confirmations,1);assert.equal(h.errors,action==='ended'||action==='natural-pause'?1:0);h.player.dispose();
 }
});
test('unchanged confirmed duration may still capture a genuine natural ending',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.sustain();h.audio.raw=h.audio.duration;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('pause'));h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,0);assert.equal(h.confirmations,1);assert.equal(h.player.position(),h.audio.duration);h.player.dispose();
});
test('a short-end confirmed callback may open a new request without the old ending cancelling it',()=>{
 let transitions=0;const h=fixture({onConfirmed(player){if(++transitions===1)player.resume(1,0);}});h.player.play(1);h.audio.metadata({duration:1});h.audio.playing(0);h.advance(500);h.audio.progress(.5);h.advance(500);h.audio.raw=1;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('ended'));
 assert.equal(h.confirmations,1);assert.equal(h.errors,0);assert.equal(h.audio.targets.at(-1),0);assert.ok(h.pendingTimers>0);h.audio.ended=false;h.audio.seek(0);assert.equal(h.audio.plays,2);h.sustain(0);assert.equal(h.confirmations,2);assert.equal(h.errors,0);h.player.dispose();assert.equal(h.pendingTimers,0);
});
test('a long stationary prefix followed by a near-end first advance cannot confirm a short track',()=>{
 const h=fixture();h.player.play(1);h.audio.metadata({duration:1});h.audio.playing(0);h.audio.progress(0);for(let i=0;i<3;i++){h.advance(250);h.audio.progress(0);}h.advance(250);h.audio.progress(.99);h.advance(10);h.audio.raw=1;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),0);h.player.dispose();
});
test('a short-end needs a timely first advance, an observable final fifth, and recent actual advancement',()=>{
 for(const mode of ['late-first','near-end-first','old-advance']){
  const h=fixture();h.player.play(1);h.audio.metadata({duration:1});h.audio.playing(0);h.audio.progress(0);
  if(mode==='late-first'){h.advance(600);h.audio.progress(.5);h.advance(400);}else if(mode==='near-end-first'){h.advance(250);h.audio.progress(.99);h.advance(750);}else{h.advance(250);h.audio.progress(.25);h.advance(750);}
  h.audio.raw=1;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,1,mode);assert.equal(h.confirmations,0);assert.equal(h.player.position(),0);h.player.dispose();
 }
});

test('QA r15 confirmed Continue survives its later same-source duration refinement without another confirmation',()=>{
 const h=fixture().begin(30.014214,.7);h.audio.seek(30.014214);h.audio.playing();
 for(const [ms,position] of [[252.9,30.084302],[265.9,30.171781],[265.5,30.367322],[265.6,30.549720]]){h.advance(ms);h.audio.progress(position);}
 // QA recorded this next trusted baseline, but not its precise event time; 250ms is fixture timing only.
 assert.equal(h.confirmations,1);h.advance(250);h.audio.progress(30.735384);const baseline=h.player.position();h.advance(103.1);h.audio.raw=30.804094;h.audio.duration=33.175510;h.audio.dispatchEvent(new Event('durationchange'));
 assert.equal(h.errors,0);assert.equal(h.audio.paused,false);assert.equal(h.confirmations,1);assert.equal(h.audio.plays,1);assert.deepEqual(h.audio.targets,[30.014214]);
 const event=h.logs.findLast(row=>row.event==='durationchange');assert.equal(event.baseline,baseline);assert.equal(event.preparedDuration,33.151519);
 h.audio.dispatchEvent(new Event('canplay'));assert.equal(h.logs.at(-1).baseline,baseline);assert.equal(h.player.position(),30.804094);
 h.advance(250);h.audio.progress(30.979094);assert.equal(h.player.pause(),30.979094);assert.equal(h.errors,0);h.player.dispose();
});
test('accepted duration revisions keep progress, capture and natural ending on the same confirmed epoch at every selected rate',()=>{
 for(const rate of [1,.85,.7,1.15])for(const action of ['position','pause','stop','ended','natural-pause']){
  const h=fixture().begin(8,rate);h.audio.seek(8);h.sustain(8,rate);const baseline=h.player.position();
  h.advance(250);h.audio.raw=baseline+.25*rate;h.audio.duration=33.175510;h.audio.dispatchEvent(new Event('durationchange'));
  assert.equal(h.errors,0,rate+action);assert.equal(h.confirmations,1);assert.equal(h.audio.plays,1);assert.equal(h.logs.findLast(row=>row.event==='durationchange').baseline,baseline);
  h.advance(250);h.audio.progress(baseline+.5*rate);assert.equal(h.player.position(),baseline+.5*rate);
  if(action==='ended'||action==='natural-pause'){h.audio.raw=h.audio.duration;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event(action==='ended'?'ended':'pause'));assert.equal(h.player.position(),h.audio.duration);}else{h.player[action]();assert.equal(h.player.position(),baseline+.5*rate);}
  assert.equal(h.errors,0);assert.equal(h.confirmations,1);h.player.dispose();
 }
});
test('confirmed duration events cannot authorize invalid metadata, changed identity, interrupted media or a discontinuous position',()=>{
 const mutations={nan:a=>a.duration=NaN,infinity:a=>a.duration=Infinity,zero:a=>a.duration=0,negative:a=>a.duration=-1,truncated:a=>a.duration=8.5,declared:a=>a.src+='?other',resolved:a=>a.currentSrc+='?other',rate:a=>a.playbackRate=.85,seeking:a=>a.seeking=true,notReady:a=>a.readyState=0,mediaError:a=>a.error={code:2},jump:a=>a.raw=20,backward:a=>a.raw=6,negativePosition:a=>a.raw=-1};
 for(const [mode,mutate] of Object.entries(mutations)){
  const h=fixture().begin(8,1);h.audio.seek(8);h.sustain(8,1);const baseline=h.player.position();h.advance(250);h.audio.raw=baseline+.25;h.audio.duration=33.175510;mutate(h.audio);h.audio.dispatchEvent(new Event('durationchange'));
  assert.equal(h.errors,1,mode);assert.equal(h.confirmations,1,mode);assert.equal(h.audio.paused,true,mode);assert.equal(h.player.position(),baseline,mode);assert.equal(h.audio.plays,1,mode);h.player.dispose();
 }
});
test('multiple confirmed refinements preserve startup proof and never bless a truncation of trusted history',()=>{
 const h=fixture().begin(8,1);h.audio.seek(8);h.sustain(8,1);const baseline=h.player.position();
 for(const duration of [33.175510,33.16,34]){h.advance(100);h.audio.duration=duration;h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.errors,0);assert.equal(h.confirmations,1);assert.equal(h.logs.findLast(row=>row.event==='durationchange').preparedDuration,33.151519);}
 assert.equal(h.logs.filter(row=>row.event==='confirmed').length,1);assert.equal(h.logs.findLast(row=>row.event==='durationchange').baseline,baseline);
 h.audio.duration=baseline-.1;h.advance(250);h.audio.progress(baseline+.25);assert.equal(h.errors,1);assert.equal(h.player.position(),baseline);h.player.dispose();
});
test('late loadedmetadata cannot replace preparation proof and queued finite refinement is validated by progress',()=>{
 const h=fixture().begin();h.audio.seek(8.681);h.sustain();const baseline=h.player.position();h.audio.duration=33.175510;h.audio.dispatchEvent(new Event('loadedmetadata'));assert.equal(h.confirmations,1);
 h.advance(250);h.audio.progress(baseline+.25);assert.equal(h.errors,0);assert.equal(h.player.position(),baseline+.25);assert.equal(h.logs.find(row=>row.event==='confirmed').preparedDuration,33.151519);h.player.dispose();
});
test('a duration getter that stops or replaces its request cannot commit or fail into the new generation',()=>{
 for(const action of ['stop','resume']){
  const h=fixture().begin(8,1);h.audio.seek(8);h.sustain(8,1);const baseline=h.player.position();let reads=0;
  Object.defineProperty(h.audio,'duration',{configurable:true,get(){if(++reads===2){Object.defineProperty(h.audio,'duration',{configurable:true,writable:true,value:33.175510});if(action==='stop')h.player.stop();else h.player.resume(1,8);}return 33.175510;}});
  h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.errors,0,action);assert.equal(h.confirmations,1,action);
  if(action==='resume'){h.audio.seek(8);h.sustain(8,1);assert.equal(h.confirmations,2);assert.equal(h.errors,0);}else assert.equal(h.player.position(),baseline);
  h.player.dispose();assert.equal(h.pendingTimers,0);
 }
});
test('a jumped timeupdate cannot become the trusted anchor for a later duration revision',()=>{
 const h=fixture().begin(8,1);h.audio.seek(8);h.sustain(8,1);const baseline=h.player.position();h.advance(250);h.audio.progress(20);assert.equal(h.errors,1);assert.equal(h.player.position(),baseline);
 h.audio.duration=33.175510;h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.errors,1);assert.equal(h.confirmations,1);assert.equal(h.player.position(),baseline);h.player.dispose();
});
test('a valid queued duration revision at pause or natural end does not manufacture a failure',()=>{
 for(const ending of [false,'old-end','new-end']){
  const h=fixture().begin(8,1);h.audio.seek(8);h.sustain(8,1);const baseline=h.player.position();
  if(ending){const end=ending==='new-end'?33.175510:33.151519;h.advance((end-baseline)*1000);h.audio.raw=end;h.audio.ended=true;}else{h.advance(250);h.audio.raw=baseline+.25;}
  h.audio.paused=true;h.audio.duration=33.175510;h.audio.dispatchEvent(new Event('durationchange'));h.audio.dispatchEvent(new Event(ending?'ended':'pause'));
  assert.equal(h.errors,0);assert.equal(h.confirmations,1);assert.equal(h.audio.plays,1);assert.equal(h.player.position(),h.audio.raw);h.player.dispose();
 }
});
test('confirmed timeupdate evidence remains bounded and metadata events alone never advance its checkpoint',()=>{
 const h=fixture().begin(8,1);h.audio.seek(8);h.sustain(8,1);const baseline=h.player.position();
 for(let i=1;i<=60;i++){h.advance(100);h.audio.progress(baseline+i*.1);}
 assert.ok(h.logs.length<=33);assert.ok(h.logs.some(row=>row.stage==='playing'&&row.event==='timeupdate'));assert.equal(h.errors,0);h.player.pause();assert.equal(h.logs.at(-1).event,'stop');h.player.dispose();
});
test('confirmed progress cannot write a new baseline after a source getter replaces its generation',()=>{
 const h=fixture().begin(8,1);h.audio.seek(8);h.sustain(8,1);const baseline=h.player.position(),source=h.audio.src;let replaced=false;
 Object.defineProperty(h.audio,'currentSrc',{configurable:true,get(){if(!replaced){replaced=true;h.audio.raw=baseline;h.player.resume(1,8);}return source;}});
 h.advance(250);h.audio.progress(baseline+.25);assert.equal(h.errors,0);assert.equal(h.confirmations,1);assert.equal(h.player.position(),baseline);h.audio.seek(8);h.sustain(8,1);assert.equal(h.confirmations,2);assert.equal(h.errors,0);h.player.dispose();
});
test('an accepted duration event leaves capture pending until the next explicit sample or pause',()=>{
 for(const action of ['position','pause','stop']){
  const h=fixture().begin(8,1);h.audio.seek(8);h.sustain(8,1);const baseline=h.player.position();h.advance(250);h.audio.raw=baseline+.25;h.audio.duration=33.175510;h.audio.dispatchEvent(new Event('durationchange'));h.audio.dispatchEvent(new Event('canplay'));
  assert.equal(h.logs.at(-1).baseline,baseline);h.player[action]();assert.equal(h.player.position(),baseline+.25);assert.equal(h.errors,0);assert.equal(h.confirmations,1);h.player.dispose();
 }
});

test('r16 native preconfirmation duration refinement keeps its genuine paused seek and waits for the unchanged progress gate',()=>{
 const h=fixture().begin(30.735,.7);h.audio.seek(30.735);h.advance(21.9);h.audio.playing();h.advance(266.9);h.audio.progress(30.751254);
 h.advance(183.9);h.audio.raw=30.828672;h.audio.duration=33.175510;h.audio.dispatchEvent(new Event('durationchange'));
 assert.equal(h.errors,0);assert.equal(h.confirmations,0);assert.equal(h.player.position(),30.735);assert.equal(h.audio.plays,1);assert.deepEqual(h.audio.targets,[30.735]);
 h.audio.dispatchEvent(new Event('canplay'));assert.equal(h.logs.at(-1).baseline,30.735);assert.equal(h.logs.at(-1).preparedDuration,33.151519);
 // Later advancing points are synthetic; the native failed trace ends at472.8ms.
 for(const [ms,position] of [[66.1,30.901254],[250,31.076254],[250,31.251254]]){h.advance(ms);h.audio.progress(position);}
 assert.equal(h.confirmations,1);assert.equal(h.errors,0);assert.equal(h.player.pause(),31.251254);assert.equal(h.audio.plays,1);h.player.dispose();
});
test('preconfirmation refinement at every selected rate never promotes metadata current into an advance or saved point',()=>{
 for(const rate of [.7,.85,1,1.15]){
  const h=fixture().begin(8,rate);h.audio.seek(8);h.audio.playing();h.advance(250);h.audio.progress(8+.25*rate);
  h.advance(150);h.audio.raw=8+.4*rate;h.audio.duration=33.175510;h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.errors,0);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8);
  for(let i=2;i<=4;i++){h.advance(i===2?100:250);h.audio.progress(8+i*.25*rate);if(i<4)assert.equal(h.confirmations,0);}
  assert.equal(h.confirmations,1);assert.equal(h.errors,0);assert.equal(h.audio.plays,1);assert.deepEqual(h.audio.targets,[8]);h.player.dispose();
 }
});
test('preconfirmation duration events reject a true jump, regression, truncation, wrong source or invalid media state',()=>{
 const mutations={nan:a=>a.duration=NaN,infinity:a=>a.duration=Infinity,zero:a=>a.duration=0,truncated:a=>a.duration=8.1,jump:a=>a.raw=20,backward:a=>a.raw=6,declared:a=>a.src+='?changed',resolved:a=>a.currentSrc+='?changed',rate:a=>a.playbackRate=.85,seeking:a=>a.seeking=true,notReady:a=>a.readyState=0,error:a=>a.error={code:2}};
 for(const [mode,mutate]of Object.entries(mutations)){
  const h=fixture().begin(8,1);h.audio.seek(8);h.audio.playing();h.advance(250);h.audio.progress(8.25);h.advance(150);h.audio.raw=8.4;h.audio.duration=33.175510;mutate(h.audio);h.audio.dispatchEvent(new Event('durationchange'));
  assert.equal(h.errors,1,mode);assert.equal(h.confirmations,0,mode);assert.equal(h.player.position(),8,mode);assert.equal(h.audio.paused,true,mode);h.player.dispose();
 }
});
test('stationary metadata refinements cannot fill a progress window or extend the original deadline',()=>{
 const h=fixture().begin(8,1);h.audio.seek(8);h.audio.playing();h.advance(250);h.audio.progress(8.1);
 for(let i=0;i<16;i++){h.advance(250);h.audio.duration=i%2?33.151519:33.175510;h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.errors,0);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8);}
 h.run(5750);assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8);h.player.dispose();
});
test('approved startup duration transfers into confirmation and cannot bless later truncation of trusted history',()=>{
 const h=fixture().begin(8,1);h.audio.seek(8);h.audio.playing();h.audio.progress(8);h.advance(250);h.audio.progress(8.25);h.audio.duration=33.175510;h.audio.dispatchEvent(new Event('durationchange'));h.advance(250);h.audio.progress(8.5);h.advance(250);h.audio.progress(8.75);assert.equal(h.confirmations,1);
 h.audio.duration=8.5;h.advance(250);h.audio.progress(9);assert.equal(h.errors,1);assert.equal(h.player.position(),8.75);h.player.dispose();
});
test('a valid short ending follows the accepted startup epoch while retaining its initial duration proof',()=>{
 const h=fixture();h.player.play(1);h.audio.metadata({duration:1});h.audio.playing(0);h.advance(500);h.audio.progress(.5);h.audio.duration=1.023991;h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.errors,0);assert.equal(h.confirmations,0);h.advance(273.991);h.audio.progress(.773991);h.advance(250);h.audio.raw=1.023991;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('ended'));
 assert.equal(h.errors,0);assert.equal(h.confirmations,1);assert.equal(h.player.position(),1.023991);assert.equal(h.logs.find(row=>row.event==='confirmed-short-end').preparedDuration,1);h.player.dispose();
});
test('a duration shrink cannot turn an initially long or previously extended startup into a fake short ending',()=>{
 for(const initial of [1,10]){
  const h=fixture();h.player.play(1);h.audio.metadata({duration:initial});h.audio.playing(0);h.advance(250);h.audio.progress(.25);
  if(initial===1){h.audio.duration=10;h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.errors,0);}
  h.audio.duration=1;h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.errors,0);h.advance(750);h.audio.raw=1;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),0);h.player.dispose();
 }
});
test('a compatible duration observed during the requested paused seek waits for genuine seeked without moving its target',()=>{
 const h=fixture();h.player.resume(.7,8);h.audio.metadata({duration:12});h.audio.duration=12.5;h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.errors,0);assert.equal(h.audio.plays,0);assert.deepEqual(h.audio.targets,[8]);
 h.audio.raw=8;h.audio.seeking=false;h.audio.dispatchEvent(new Event('canplay'));assert.equal(h.audio.plays,0);h.audio.seek(8);assert.equal(h.audio.plays,1);assert.equal(h.logs.find(row=>row.event==='play').preparedDuration,12);h.sustain(8,.7);assert.equal(h.confirmations,1);assert.equal(h.errors,0);h.player.dispose();
});
test('queued duration properties are validated by a genuine timeupdate before durationchange at every selected rate',()=>{
 for(const rate of [.7,.85,1,1.15]){
  const h=fixture().begin(8,rate);h.audio.seek(8);h.audio.playing();h.audio.progress(8);h.advance(250);h.audio.progress(8+.25*rate);h.audio.duration=34;h.advance(250);h.audio.progress(8+.5*rate);assert.equal(h.errors,0);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8);
  h.audio.dispatchEvent(new Event('durationchange'));h.advance(250);h.audio.progress(8+.75*rate);assert.equal(h.confirmations,1);assert.equal(h.errors,0);h.player.dispose();
 }
});
test('confirmed sample pause and ending share validation when the duration property arrives before its event',()=>{
 for(const action of ['position','pause','stop','ended','natural-pause']){
  const h=fixture().begin(8,1);h.audio.seek(8);h.sustain(8,1);const baseline=h.player.position();h.audio.duration=33.175510;
  if(action==='ended'||action==='natural-pause'){h.advance((h.audio.duration-baseline)*1000);h.audio.raw=h.audio.duration;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event(action==='ended'?'ended':'pause'));}else{h.advance(250);h.audio.raw=baseline+.25;h.player[action]();}
  assert.equal(h.errors,0,action);assert.equal(h.confirmations,1,action);assert.equal(h.player.position(),h.audio.raw,action);h.player.dispose();
 }
});
test('a sub-tolerance duration extension cannot be hidden by a later shrink to obtain short-tail eligibility',()=>{
 const h=fixture();h.player.play(1);h.audio.metadata({duration:1.499});h.audio.playing(0);h.advance(250);h.audio.progress(.25);h.audio.duration=1.508;h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.errors,0);h.audio.duration=1;h.audio.dispatchEvent(new Event('durationchange'));h.advance(750);h.audio.raw=1;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),0);h.player.dispose();
});
test('a compatible long duration observed while seek is pending cannot disappear from short-tail history',()=>{
 const h=fixture();h.player.resume(1,.1);h.audio.metadata({duration:1.1});h.audio.duration=10;h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.audio.plays,0);assert.equal(h.errors,0);h.audio.duration=1.1;h.audio.dispatchEvent(new Event('durationchange'));h.audio.seek(.1);h.audio.playing(.1);h.advance(500);h.audio.progress(.6);h.advance(500);h.audio.raw=1.1;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),.1);h.player.dispose();
});
test('confirmation rechecks the actual progress window after a reentrant native position getter',()=>{
 const h=fixture().begin(8,1);h.audio.seek(8);h.audio.playing();h.audio.progress(8);h.advance(250);h.audio.progress(8.25);h.advance(250);h.audio.progress(8.5);let reads=0,reentered=false;
 Object.defineProperty(h.audio,'currentTime',{configurable:true,get(){const value=this.raw;if(++reads===5){reentered=true;this.progress(8.8);}return value;},set(value){this.targets.push(value);this.seeking=true;}});
 h.advance(250);h.audio.progress(8.75);assert.equal(reentered,true);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8);h.sustain(8.8,1);assert.equal(h.confirmations,1);assert.equal(h.errors,0);h.player.dispose();
});
test('short-end cannot mix a new long metadata epoch with old local endpoint and timing fields',()=>{
 const h=fixture();h.player.play(1);h.audio.metadata({duration:1});h.audio.playing(0);h.advance(500);h.audio.progress(.5);let reads=0;Object.defineProperty(h.audio,'duration',{configurable:true,get(){return ++reads===3?10:1;}});
 h.advance(500);h.audio.raw=1;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('ended'));assert.ok(reads>=3);assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),0);h.player.dispose();
});
test('transitional genuine seeked may await a compatible epoch but truncating the fixed target fails immediately',()=>{
 for(const mode of ['compatible','truncated']){
  const h=fixture().begin(8,.7);h.audio.duration=mode==='compatible'?33.175510:7;
  if(mode==='compatible'){h.audio.raw=8;h.audio.dispatchEvent(new Event('seeked'));h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.audio.plays,0);assert.equal(h.errors,0);h.audio.seeking=false;h.run(25);h.sustain(8,.7);assert.equal(h.confirmations,1);assert.equal(h.errors,0);}else{h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.errors,1);assert.equal(h.audio.plays,0);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8);}
  h.player.dispose();
 }
});
test('a long epoch first observed by timeupdate stays in short-tail history after a queued shrink',()=>{
 const h=fixture();h.player.play(1);h.audio.metadata({duration:1.1});h.audio.playing(0);h.audio.duration=10;h.advance(250);h.audio.progress(.25);assert.equal(h.errors,0);h.advance(250);h.audio.progress(.5);h.audio.duration=1.1;h.advance(500);h.audio.raw=1.1;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),0);h.player.dispose();
});
test('a shortened tail keeps its stricter first-advance timing even after the original larger span has elapsed',()=>{
 const h=fixture();h.player.play(1);h.audio.metadata({duration:1.4});h.audio.playing(0);h.advance(500);h.audio.progress(.3);h.audio.duration=.5;h.audio.dispatchEvent(new Event('durationchange'));assert.equal(h.errors,0);h.advance(500);h.audio.progress(.4);h.advance(400);h.audio.raw=.5;h.audio.ended=true;h.audio.paused=true;h.audio.dispatchEvent(new Event('ended'));assert.equal(h.errors,1);assert.equal(h.confirmations,0);assert.equal(h.player.position(),0);h.player.dispose();
});
test('exactly 750ms with only two genuine advances cannot borrow a third advance from metadata',()=>{
 const h=fixture().begin(8,1);h.audio.seek(8);h.audio.playing();h.audio.progress(8);h.advance(375);h.audio.progress(8.375);h.audio.duration=33.175510;h.audio.dispatchEvent(new Event('durationchange'));h.advance(375);h.audio.progress(8.75);assert.equal(h.errors,0);assert.equal(h.confirmations,0);assert.equal(h.player.position(),8);h.advance(250);h.audio.progress(9);assert.equal(h.confirmations,1);assert.equal(h.errors,0);h.player.dispose();
});
