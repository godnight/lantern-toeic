const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/lesson-audio.ts'), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}}).outputText;
function implementation() {
  const exports = {};
  vm.runInNewContext(code, {exports, Map, Error});
  return exports;
}
class AudioFixture extends EventTarget {
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  fail = null;
  play() { this.paused = false; return new Promise((resolve, reject) => {this.fail = reject;}); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a new clip stops the previous lesson player and applies the requested speed', () => {
  const {createBundledPlayback} = implementation();
  const first = new AudioFixture(), second = new AudioFixture();
  let firstPlaying = false;
  const one = createBundledPlayback(first, value => {firstPlaying = value;}, assert.fail);
  const two = createBundledPlayback(second, () => {}, assert.fail);
  one.play(1);
  assert.equal(firstPlaying, true);
  two.play(0.85);
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
  player.play(1);
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
  one.play(1);
  one.stop();
  one.play(0.85);
  await tick();
  assert.equal(first.paused, false);
  assert.equal(playing, true);
  two.play(1);
  assert.equal(first.paused, true);
  assert.equal(second.paused, false);
  one.dispose(); two.dispose();
});

test('unmount cancels late failures, while a current audio failure remains visible', async () => {
  const {createBundledPlayback} = implementation();
  const audio = new AudioFixture();
  let errors = 0;
  const player = createBundledPlayback(audio, () => {}, () => errors++);
  player.play(1);
  audio.fail(new Error('unsupported codec'));
  await tick();
  assert.equal(errors, 1);
  player.play(1);
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

test('pause and resume keep the confirmed offset and speed; explicit play still restarts',()=>{
 const {createBundledPlayback}=implementation(),audio=new AudioFixture();audio.readyState=1;audio.duration=60;
 const player=createBundledPlayback(audio,()=>{},assert.fail);player.resume(0.85,12.25);assert.equal(audio.currentTime,12.25);audio.currentTime=18.75;assert.equal(player.pause(),18.75);player.resume(1.15);assert.equal(audio.currentTime,18.75);assert.equal(audio.playbackRate,1.15);player.play(1);assert.equal(audio.currentTime,0);player.dispose();
});
test('late metadata after pause retains the target offset and resume clamps to current duration',()=>{
 const {createBundledPlayback}=implementation();class Delayed extends EventTarget{readyState=0;duration=NaN;offset=0;paused=true;playbackRate=1;play(){this.paused=false;return Promise.resolve();}pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}get currentTime(){return this.offset||0;}set currentTime(value){if(this.readyState===0)throw Error('no metadata');this.offset=value;}}
 const audio=new Delayed(),player=createBundledPlayback(audio,()=>{},assert.fail);player.resume(1,12);player.pause();audio.readyState=1;audio.duration=8;audio.dispatchEvent(new Event('loadedmetadata'));assert.equal(audio.currentTime,0);assert.equal(player.position(),12);assert.equal(audio.paused,true);player.resume(1);assert.equal(audio.currentTime,7.99);assert.equal(player.position(),7.99);player.dispose();
});
test('creating a player with a restored target never autoplays; old metadata cannot seek a newer play',()=>{
 const {createBundledPlayback}=implementation(),audio=new AudioFixture();audio.readyState=0;audio.duration=30;let calls=0;audio.play=()=>{calls++;audio.paused=false;return Promise.resolve();};const player=createBundledPlayback(audio,()=>{},assert.fail);assert.equal(calls,0);player.resume(1,5);player.pause();player.resume(1,9);audio.readyState=1;audio.dispatchEvent(new Event('loadedmetadata'));assert.equal(audio.currentTime,9);assert.equal(calls,2);player.dispose();
});
