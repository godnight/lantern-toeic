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
