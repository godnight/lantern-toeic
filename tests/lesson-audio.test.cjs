const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/lesson-audio.ts'), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}}).outputText;
let testClock=0;
function implementation() {
  testClock=0;
  const dependencies=require('./helpers/actual-source-loader.cjs').createSourceLoader({root:process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..')});
  const exports = {};
  vm.runInNewContext(code, {exports, require:name=>dependencies.resolve(name,'lib/lesson-audio.ts'), Map, Error, setTimeout, clearTimeout,performance:{now:()=>testClock}});
  return exports;
}
class AudioFixture extends EventTarget {
  src='https://lantern.local/audio/offline/0123456789abcdef0123.mp3';currentSrc=this.src;autoMetadata=true;_time=0;readyState=1;duration=60;seeking=false;playbackRate=1;paused=true;fail=null;
  seekable={length:1,start:()=>0,end:()=>this.duration};
  get currentTime(){return this._time;}
  set currentTime(value){this._time=value;this.seeking=true;queueMicrotask(()=>{this.seeking=false;this.dispatchEvent(new Event('seeked'));});}
  play(){this.paused=false;queueMicrotask(()=>{if(!this.paused){this.dispatchEvent(new Event('playing'));this.dispatchEvent(new Event('timeupdate'));}});return new Promise((resolve,reject)=>{this.fail=reject;});}
  pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
  load(){this.paused=true;this._time=0;this.readyState=0;this.duration=NaN;if(this.autoMetadata)queueMicrotask(()=>{this.readyState=1;this.duration=60;this.dispatchEvent(new Event('loadedmetadata'));});}
  sustain(){this.dispatchEvent(new Event('timeupdate'));for(let i=0;i<3;i++){testClock+=250;this._time+=.25*this.playbackRate;this.dispatchEvent(new Event('timeupdate'));}}
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('a new clip stops the previous lesson player and applies the requested speed', async () => {
  const {createBundledPlayback} = implementation();
  const first = new AudioFixture(), second = new AudioFixture();
  let firstPlaying = false;
  const one = createBundledPlayback(first, value => {firstPlaying = value;}, assert.fail);
  const two = createBundledPlayback(second, () => {}, assert.fail);
  one.play(1);await tick();
  assert.equal(firstPlaying, true);
  two.play(0.85);await tick();
  assert.equal(first.paused, true);
  assert.equal(firstPlaying, false);
  assert.equal(second.playbackRate, 0.85);
  one.dispose(); two.dispose();
});

test('native background pause clears playback state and ignores a late rejected play request', async () => {
  const {createBundledPlayback} = implementation();
  const audio = new AudioFixture();
  let playing = false, errors = 0;
  const player = createBundledPlayback(audio, value => {playing = value;}, () => errors++);
  player.play(1);await tick();
  // installHarmonyHost pauses all DOM media when the native host backgrounds.
  audio.pause();
  audio.fail(new Error('interrupted'));
  await tick();
  assert.equal(playing, false);
  assert.equal(errors, 0);
  player.dispose();
});

test('a queued old pause cannot clear a restarted clip or allow overlapping players', async () => {
  const {createBundledPlayback} = implementation();
  class QueuedAudio extends AudioFixture {
    pause() { this.paused = true; queueMicrotask(() => this.dispatchEvent(new Event('pause'))); }
  }
  const first = new QueuedAudio(), second = new QueuedAudio();
  let playing = false;
  const one = createBundledPlayback(first, value => {playing = value;}, assert.fail);
  const two = createBundledPlayback(second, () => {}, assert.fail);
  one.play(1);await tick();
  one.stop();
  one.play(0.85);
  await tick();
  assert.equal(first.paused, false);
  assert.equal(playing, true);
  two.play(1);await tick();
  assert.equal(first.paused, true);
  assert.equal(second.paused, false);
  one.dispose(); two.dispose();
});

test('unmount cancels late failures, while a current audio failure remains visible', async () => {
  const {createBundledPlayback} = implementation();
  const audio = new AudioFixture();
  let errors = 0;
  const player = createBundledPlayback(audio, () => {}, () => errors++);
  player.play(1);await tick();
  audio.fail(new Error('unsupported codec'));
  await tick();
  assert.equal(errors, 1);
  player.play(1);await tick();
  player.dispose();
  audio.fail(new Error('unmounted'));
  await tick();
  assert.equal(errors, 1);
  assert.equal(audio.paused, true);
});

test('only explicitly registered native clips resolve, without remote URLs or path traversal', () => {
  const {installBundledLessonAudio, bundledLessonAudio} = implementation();
  assert.equal(bundledLessonAudio('Hello.'), null);
  installBundledLessonAudio([{text:'Hello.', file:'0123456789abcdef0123.mp3'}]);
  assert.equal(bundledLessonAudio('Hello.'), '/audio/offline/0123456789abcdef0123.mp3');
  assert.equal(bundledLessonAudio('Different text.'), null);
  assert.throws(() => installBundledLessonAudio([{text:'Bad', file:'../private.mp3'}]), /Invalid/);
  assert.equal(bundledLessonAudio('Hello.'), '/audio/offline/0123456789abcdef0123.mp3');
});

test('pause and resume keep the confirmed offset and speed; explicit play still restarts',async()=>{
 const {createBundledPlayback}=implementation(),audio=new AudioFixture();audio.readyState=1;audio.duration=60;
 const player=createBundledPlayback(audio,()=>{},assert.fail);player.resume(0.85,12.25);await tick();assert.equal(audio.currentTime,12.25);audio.sustain();audio.currentTime=18.75;await tick();assert.equal(player.pause(),18.75);player.resume(1.15);await tick();assert.equal(audio.currentTime,18.75);assert.equal(audio.playbackRate,1.15);player.play(1);assert.equal(audio.currentTime,0);player.dispose();
});
test('late metadata after explicit pause cannot act and a near-end resume only seeks, without inventing confirmation',async()=>{
 const {createBundledPlayback}=implementation(),audio=new AudioFixture();audio.autoMetadata=false;audio.readyState=0;audio.duration=NaN;
 const player=createBundledPlayback(audio,()=>{},assert.fail);player.resume(1,12);player.pause();audio.readyState=1;audio.duration=8;audio.dispatchEvent(new Event('loadedmetadata'));assert.equal(audio.currentTime,0);assert.equal(player.position(),12);assert.equal(audio.paused,true);
 player.resume(1);audio.readyState=1;audio.duration=8;audio.dispatchEvent(new Event('loadedmetadata'));await tick();assert.equal(audio.currentTime,7.99);assert.equal(player.position(),12,'An unconfirmed near-end seek cannot lower the saved checkpoint');player.dispose();
});
test('constructing a restored player is silent and cancelled metadata cannot seek an obsolete target',async()=>{
 const {createBundledPlayback}=implementation(),audio=new AudioFixture();audio.autoMetadata=false;audio.readyState=0;audio.duration=NaN;let calls=0;
 const originalPlay=audio.play.bind(audio);audio.play=()=>{calls++;return originalPlay();};const player=createBundledPlayback(audio,()=>{},assert.fail);assert.equal(calls,0);player.resume(1,5);player.pause();player.resume(1,9);audio.readyState=1;audio.duration=30;audio.dispatchEvent(new Event('loadedmetadata'));await tick();assert.equal(audio.currentTime,9);assert.equal(calls,1);player.dispose();
});
