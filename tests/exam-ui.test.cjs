// Real proposal TS/TSX modules; no device, media hardware, network or real IDB.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const application = process.env.LANTERN_APP_ROOT || root;
const engineRoot = process.env.LANTERN_EXAM_ROOT || root;
const ts = require(path.join(application, 'node_modules/typescript'));
const React = require(path.join(application, 'node_modules/react'));
const runtime = require(path.join(application, 'node_modules/react/jsx-runtime'));
const {renderToStaticMarkup} = require(path.join(application, 'node_modules/react-dom/server'));
function load(file, imports, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  vm.runInNewContext(code, {exports, require: name => {
    if (!(name in imports)) throw Error('Unexpected import: ' + name);
    return imports[name];
  }, Date, Intl, Map, Set, Promise, Error, URL, Blob, TextEncoder, Uint8Array, Uint32Array, atob, btoa,
    setTimeout, clearTimeout, crypto: globalThis.crypto, ...globals}, {filename: file});
  return exports;
}
const model = load(path.join(engineRoot, 'lib/exam-model.ts'), {});
const ui = load(path.join(root, 'lib/exam-ui.ts'), {'@/lib/exam-model': model});
const dialog = new Proxy({}, {get: (_, name) => name});
const component = load(path.join(root, 'app/learn/mock-exam.tsx'), {
  react: React, 'react/jsx-runtime': runtime, '@/components/ui/dialog': dialog,
  '@/lib/native-host': {}, '@/lib/exam-model': model, '@/lib/exam-storage': {},
  '@/lib/exam-ui': ui, './mock-exam.css': {},
});
const attempt = () => ({status:'listening', startedAt:1000, lastObservedAt:1100, listeningDeadline:2701000, readingDeadline:7201000});
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const repo = ownerId => ({ownerId, closed: false, close() {this.closed = true;}});
const question = {number:1, part:1, groupId:'g1', prompt:'Which option?', choices:['first','second','third','fourth'], answer:2, explanation:'SECRET_EXPLANATION'};
const renderQuestion = props => renderToStaticMarkup(React.createElement(component.QuestionBody, {question, disabled:false, onAnswer() {}, ...props}));

test('countdown derives from fixed deadlines after a long background gap', () => {
  const a = attempt(); assert.equal(ui.remainingMs(a, 2_000_000), 701_000);
  assert.equal(a.listeningDeadline, 2_701_000);
});
test('clock rollback cannot give the current stage extra time', () => {
  const a = {...attempt(), lastObservedAt:2_000_000};
  assert.equal(ui.remainingMs(a, 50_000), 701_000);
});
test('submitted attempts show zero remaining; reading uses its own fixed deadline', () => {
  assert.equal(ui.remainingMs({...attempt(), status:'submitted'}, 1100), 0);
  assert.equal(ui.remainingMs({...attempt(), status:'reading'}, 3_000_000), 4_201_000);
});
test('resume offset follows exam elapsed time and cannot exceed media duration', () => {
  assert.equal(ui.audioOffsetSeconds(attempt(), 61_000, 2700), 60);
  assert.equal(ui.audioOffsetSeconds(attempt(), 9_000_000, 2400), 2400);
  assert.equal(ui.audioOffsetSeconds({...attempt(), lastObservedAt:121_000}, 1000, 2700), 120);
});
test('clock text does not wrap at 60 minutes or render a negative number', () => {
  assert.equal(ui.clockText(75 * 60_000), '75:00');
  assert.equal(ui.clockText(-200), '0:00');
  assert.equal(ui.clockText(1), '0:01');
});
test('session rejects an owner/repository mismatch before work', () => {
  assert.throws(() => new ui.ExamUiSession(repo('alice'), 'bob'), /账号不匹配/);
});
test('tick and answer share FIFO; answer observes the latest stored revision', async () => {
  const storage = repo('alice'); storage.revision = 1;
  const owner = new ui.ExamUiSession(storage, 'alice'), first = deferred(), order = [];
  const tick = owner.run(async r => {order.push('tick-start'); await first.promise; r.revision++; order.push('tick-finished');});
  const answer = owner.run(async r => {order.push('answer'); return r.revision;});
  await Promise.resolve(); assert.deepEqual(order, ['tick-start']);
  first.resolve(); await tick; assert.equal(await answer, 2);
  assert.deepEqual(order, ['tick-start','tick-finished','answer']);
});
test('a failed write remains rejected without poisoning later explicit retries', async () => {
  const owner = new ui.ExamUiSession(repo('alice'), 'alice');
  await assert.rejects(owner.run(async () => {throw Error('quota full');}), /quota full/);
  assert.equal(await owner.run(async () => 'retry committed'), 'retry committed');
});
test('closing an owner discards pending result and blocks queued writes', async () => {
  const storage = repo('alice'), owner = new ui.ExamUiSession(storage, 'alice'), hold = deferred();
  const old = owner.run(async () => {await hold.promise; return 'private-alice';});
  let queuedRan = false;
  const queued = owner.run(async () => {queuedRan = true;});
  // Attach rejection handlers before settling the old work to avoid incidental unhandled rejections.
  const a = assert.rejects(old, ui.StaleExamOwner), b = assert.rejects(queued, ui.StaleExamOwner);
  await Promise.resolve(); owner.close(); hold.resolve(); await Promise.all([a,b]);
  assert.equal(queuedRan, false); assert.equal(storage.closed, true);
});
test('new owner session remains independent when the old owner resolves late', async () => {
  const a = new ui.ExamUiSession(repo('alice'), 'alice'), b = new ui.ExamUiSession(repo('bob'), 'bob');
  a.close(); await assert.rejects(a.run(async () => 'alice'), ui.StaleExamOwner);
  assert.equal(await b.run(async r => r.ownerId), 'bob');
});
test('exit save gate allows the normal close only after the write resolves', async () => {
  const wait = deferred(); let settled = false;
  const result = ui.trySaveExamExit(() => wait.promise).then(value => {settled = true; return value;});
  await Promise.resolve(); assert.equal(settled, false);
  wait.resolve(); assert.equal(await result, true);
});
test('exit save gate reports failure without pretending the interruption was saved', async () => {
  const error = Error('storage quota full'); error.name = 'QuotaExceededError';
  assert.equal(await ui.trySaveExamExit(async () => {throw error;}), false);
  assert.equal(await ui.trySaveExamExit(async () => 'retry committed'), true);
});
test('owner disposal never becomes a leave-failure action in another owner', async () => {
  await assert.rejects(ui.trySaveExamExit(async () => {throw new ui.StaleExamOwner();}), ui.StaleExamOwner);
});
test('asset URLs are reused per scope and revoked once on disposal', () => {
  const created = [], revoked = [];
  const assets = new ui.ExamAssetUrls({}, (_, id) => {created.push(id); return 'blob:' + id;}, url => revoked.push(url));
  assert.equal(assets.get('audio'), 'blob:audio'); assert.equal(assets.get('audio'), 'blob:audio');
  assets.get('image'); assets.close(); assets.close();
  assert.deepEqual(created, ['audio','image']); assert.deepEqual(revoked, ['blob:audio','blob:image']);
  assert.throws(() => assets.get('late'), ui.StaleExamOwner);
});
test('partial asset allocation can clean up URLs if a later decoder throws', () => {
  const revoked = []; const assets = new ui.ExamAssetUrls({}, (_, id) => {if (id === 'bad') throw Error('decode'); return 'blob:' + id;}, url => revoked.push(url));
  assets.get('good'); assert.throws(() => assets.get('bad'), /decode/); assets.close();
  assert.deepEqual(revoked, ['blob:good']);
});
test('media StrictMode setup-cleanup-setup restores the same src', () => {
  const attributes = new Map([['src', 'blob:exam-audio']]), calls = [];
  const player = {getAttribute: key => attributes.get(key) ?? null,
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
    pause: () => calls.push('pause'), load: () => calls.push('load')};
  const firstCleanup = ui.attachExamMedia(player, 'blob:exam-audio');
  firstCleanup(); assert.equal(attributes.has('src'), false);
  const secondCleanup = ui.attachExamMedia(player, 'blob:exam-audio');
  assert.equal(attributes.get('src'), 'blob:exam-audio'); assert.deepEqual(calls, ['pause','load','load']);
  secondCleanup(); assert.equal(attributes.has('src'), false);
});
test('media cleanup holds the original element even after React clears its ref', () => {
  const calls = [], player = {getAttribute: () => 'blob:a', setAttribute() {},
    removeAttribute: name => calls.push('remove:' + name), pause: () => calls.push('pause'), load: () => calls.push('load')};
  let ref = player;
  const detach = ui.attachExamMedia(ref, 'blob:a'); ref = null; detach();
  assert.deepEqual(calls, ['pause','remove:src','load']);
});
function imageStub(decode = async () => {}) {
  return {src:'', naturalWidth:800, naturalHeight:1000, onload:null, onerror:null, decode,
    removed:false, removeAttribute() {this.src = ''; this.removed = true;}};
}
test('image preflight waits for actual decode, not merely a loaded file header', async () => {
  const wait = deferred(), image = imageStub(() => wait.promise), controller = new AbortController();
  let passed = false;
  const result = ui.verifyExamImage('blob:image', controller.signal, {createImage:() => image}).then(() => {passed = true;});
  image.onload(); await Promise.resolve(); assert.equal(passed, false);
  wait.resolve(); await result; assert.equal(passed, true); assert.equal(image.removed, true);
});
test('broken image decode rejects instead of enabling Start', async () => {
  const image = imageStub(async () => {throw Error('bad data');}), controller = new AbortController();
  const result = ui.verifyExamImage('blob:broken', controller.signal, {createImage:() => image});
  image.onload(); await assert.rejects(result, /解码失败/); assert.equal(image.removed, true);
});
test('image load failure and zero-size material reject before decode', async () => {
  const image = imageStub(), controller = new AbortController();
  const first = ui.verifyExamImage('blob:bad', controller.signal, {createImage:() => image});
  image.onerror(); await assert.rejects(first, /无法解码/);
  const zero = imageStub(); zero.naturalWidth = 0;
  const second = ui.verifyExamImage('blob:zero', controller.signal, {createImage:() => zero});
  zero.onload(); await assert.rejects(second, /尺寸/);
});
test('owner abort cancels image preflight and late decode cannot pass', async () => {
  const wait = deferred(), image = imageStub(() => wait.promise), controller = new AbortController();
  const result = ui.verifyExamImage('blob:image', controller.signal, {createImage:() => image});
  image.onload(); await Promise.resolve(); controller.abort(); wait.resolve();
  await assert.rejects(result, ui.StaleExamOwner); assert.equal(image.removed, true);
});
test('stalled image decode is bounded by a deadline', async () => {
  const image = imageStub(), controller = new AbortController();
  const result = ui.verifyExamImage('blob:stalled', controller.signal, {createImage:() => image, timeoutMs:5});
  await assert.rejects(result, /超时/); assert.equal(image.removed, true);
});
test('active QuestionBody never renders a supplied answer or explanation', () => {
  const html = renderQuestion({submitted:false, selected:0});
  assert.doesNotMatch(html, /SECRET_EXPLANATION|正确答案|交卷后解析/);
  assert.match(html, /清除此题答案/); assert.match(html, /type="radio"/);
});
test('submitted QuestionBody reveals answer only then and disables edits', () => {
  const html = renderQuestion({submitted:true, selected:0});
  assert.match(html, /SECRET_EXPLANATION/); assert.match(html, /正确答案 C/);
  assert.match(html, /fieldset[^>]*disabled/); assert.doesNotMatch(html, /清除此题答案/);
});
test('imported HTML remains escaped text in prompt, options, and explanation', () => {
  const malicious = {...question, prompt:'<script>bad()</script>', choices:['<img onerror=bad()>','b','c','d'], explanation:'<iframe src="evil">'};
  const html = renderToStaticMarkup(React.createElement(component.QuestionBody, {question:malicious, submitted:true, disabled:false, onAnswer() {}}));
  assert.doesNotMatch(html, /<script>|<img |<iframe/); assert.match(html, /&lt;script&gt;/);
});
test('unresolved owner shows an honest blocked state and opens no anonymous store', () => {
  const html = renderToStaticMarkup(React.createElement(component.default, {ownerId:null, onClose() {}}));
  assert.match(html, /无法确认本机记录范围/); assert.doesNotMatch(html, /开始新考试|正确.*200/);
});
test('changing owner produces a different keyed subtree before effects run', () => {
  const alice = component.default({ownerId:'alice', onClose() {}}), bob = component.default({ownerId:'bob', onClose() {}});
  assert.equal(alice.key, 'alice'); assert.equal(bob.key, 'bob'); assert.notEqual(alice.key, bob.key);
});


test('declared 45:53 accepts a 45:52.521 metadata value without changing the declaration', () => {
  const check = ui.checkExamAudioDuration(2752.521, 2_753_000, 2_753_000);
  assert.equal(check.ready, true); assert.equal(check.error, '');
});

test('declared duration rejects invalid metadata and a longer source instead of truncating it', () => {
  for (const value of [0, -1, NaN, Infinity, -Infinity]) assert.equal(ui.checkExamAudioDuration(value, 2_753_000, 2_753_000).ready, false);
  assert.equal(ui.checkExamAudioDuration(2753.001, 2_753_000, 2_753_000).ready, false);
  assert.equal(ui.checkExamAudioDuration(2753, 2_753_000, 2_753_000).ready, true);
});

test('declared duration has an inclusive 1500ms shorter-media tolerance, not an arbitrary minute warning', () => {
  assert.equal(ui.checkExamAudioDuration(2751.5, 2_753_000, 2_753_000).ready, true);
  assert.equal(ui.checkExamAudioDuration(2751.499, 2_753_000, 2_753_000).ready, false);
  assert.equal(ui.checkExamAudioDuration(20, 2_753_000, 2_753_000).ready, false);
});

test('legacy short QA and 44:31 audio remain compatible, but new legacy starts longer than 45min are blocked', () => {
  for (const duration of [20, 2671.09161, 2700]) assert.equal(ui.checkExamAudioDuration(duration, undefined, model.LISTENING_MS).ready, true);
  const long = ui.checkExamAudioDuration(2752.521, undefined, model.LISTENING_MS);
  assert.equal(long.ready, false); assert.match(long.error, /45:00.*新版本/);
});

test('duration gate refuses inconsistent declarations or effective defaults', () => {
  for (const declaration of [null, NaN, 0, 2753000.5, 2753521, 2399000, 3001000]) assert.equal(ui.checkExamAudioDuration(2752.5, declaration, 2753000).ready, false);
  assert.equal(ui.checkExamAudioDuration(2752.5, 2753000, 2700000).ready, false);
  assert.equal(ui.checkExamAudioDuration(2700, undefined, 2753000).ready, false);
});

test('long listening recovery and ended media never rebase stored absolute deadlines', () => {
  const a = {...attempt(), listeningDeadline:2754000, readingDeadline:7254000};
  const before = JSON.stringify(a);
  assert.equal(ui.remainingMs(a, 2701000), 53000);
  assert.equal(ui.audioOffsetSeconds(a, 2754000, 2752.521), 2752.521);
  assert.equal(ui.remainingMs(a, 2754000), 0);
  assert.equal(ui.remainingMs({...a, status:'reading'}, 2754000), 4500000);
  assert.equal(JSON.stringify(a), before);
});


// Executes the actual ExamAudio handlers/effects with a small synchronous hook/media double.
// This is an offline lifecycle regression, not browser decoding or a human listening check.
function audioHarness(initial = {}) {
  let slots = [], index = 0, dirty = false, effects = [], tree, audioNode, props;
  const callbacks = [], interruptions = [], listeners = new Map();
  const player = {duration:2752.521, currentTime:0, readyState:4, paused:true, ended:false, playbackRate:1,
    attributes:new Map(), playCalls:0, pauseCalls:0,
    getAttribute(key) {return this.attributes.get(key) ?? null;}, setAttribute(key,value) {this.attributes.set(key,value);},
    removeAttribute(key) {this.attributes.delete(key);}, load() {}, pause() {this.paused=true; this.pauseCalls++;},
    async play() {this.paused=false; this.playCalls++;}};
  const hooks = {
    useRef(value) {const i=index++; return slots[i] ||= {current:value};},
    useState(value) {const i=index++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value;
      return [slots[i], next => {const value=typeof next==='function' ? next(slots[i]) : next; if (!Object.is(slots[i],value)) {slots[i]=value;dirty=true;}}];},
    useEffect(work,deps) {const i=index++, old=slots[i];
      if (!old || !deps || deps.some((v,n)=>!Object.is(v,old.deps?.[n]))) effects.push(()=>{old?.cleanup?.(); slots[i]={deps,cleanup:work()};});},
    useCallback(work,deps) {const i=index++, old=slots[i]; if (!old || deps.some((v,n)=>!Object.is(v,old.deps[n]))) slots[i]={deps,work}; return slots[i].work;},
  };
  const document = {hidden:false, addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
  const mod=load(path.join(root,'app/learn/mock-exam.tsx'), {
    react:hooks,'react/jsx-runtime':runtime,'@/components/ui/dialog':dialog,
    '@/lib/native-host':{isNativeForeground:()=>true,subscribeNativeState:()=>()=>{}},
    '@/lib/exam-model':model,'@/lib/exam-storage':{},'@/lib/exam-ui':ui,'./mock-exam.css':{},
  },{document});
  function nodes(node) {
    if (!node || typeof node!=='object') return [];
    return [node,...React.Children.toArray(node.props?.children).flatMap(nodes)];
  }
  function flush() {
    let turns=0;
    do {if (++turns>20) throw Error('Audio lifecycle did not settle'); dirty=false;index=0;effects=[];
      tree=mod.ExamAudio(props); audioNode=nodes(tree).find(n=>n.type==='audio'); audioNode.props.ref.current=player;
      for (const effect of effects) effect();
    } while(dirty);
  }
  props={url:'blob:one',declaredListeningDurationMs:2753000,effectiveListeningDurationMs:2753000,
    attempt:null,durableSubmitted:false,busy:false,onPreflight:(ready,url)=>callbacks.push({ready,url}),
    onInterruption:async reason=>interruptions.push(reason),onRefresh:async()=>{},...initial};flush();
  return {player,callbacks,interruptions,
    get ready(){return callbacks.at(-1)?.ready;},get tree(){return tree;},
    async fire(name,duration) {if (duration!==undefined) player.duration=duration;
      audioNode.props[name]({currentTarget:player});await Promise.resolve();await Promise.resolve();flush();},
    async click(text) {const button=nodes(tree).find(n=>n.type==='button' && n.props.children===text);
      assert.ok(button,'Expected actual audio action '+text);button.props.onClick();await Promise.resolve();await Promise.resolve();flush();},
    update(next) {props={...props,...next};flush();},
    dispose(){for(const slot of slots)slot?.cleanup?.();},
  };
}

test('actual Audio preflight needs matching metadata AND successful playing; durationchange revokes it immediately', async () => {
  const h=audioHarness();
  await h.fire('onLoadedMetadata');await h.fire('onCanPlay');assert.equal(h.ready,false);
  await h.fire('onPlaying');assert.equal(h.ready,true);
  await h.fire('onDurationChange',2753.001);assert.equal(h.ready,false);assert.ok(h.player.paused);
  await h.fire('onDurationChange',2752.521);await h.fire('onCanPlay');assert.equal(h.ready,false);
  await h.fire('onPlaying');assert.equal(h.ready,true);h.dispose();
});

test('valid metadata change also needs a fresh play and cannot inherit the old preview', async () => {
  const h=audioHarness();await h.fire('onPlaying');assert.equal(h.ready,true);
  await h.fire('onDurationChange',2752.6);assert.equal(h.ready,false);
  await h.fire('onPlaying');assert.equal(h.ready,true);h.dispose();
});

test('actual Audio error and reload clear played state until the same source plays again', async () => {
  const h=audioHarness();await h.fire('onPlaying');assert.equal(h.ready,true);
  await h.fire('onError');assert.equal(h.ready,false);
  await h.fire('onCanPlay');assert.equal(h.ready,false);
  await h.fire('onPlaying');assert.equal(h.ready,true);
  await h.fire('onEmptied');assert.equal(h.ready,false);h.dispose();
});

test('actual Audio source/declaration change resets readiness; owner remount has no prior media approval', async () => {
  const h=audioHarness();await h.fire('onPlaying');assert.equal(h.ready,true);
  h.update({url:'blob:two'});assert.equal(h.ready,false);assert.equal(h.player.getAttribute('src'),'blob:two');
  await h.fire('onPlaying');assert.equal(h.ready,true);
  h.update({declaredListeningDurationMs:2754000,effectiveListeningDurationMs:2754000});assert.equal(h.ready,false);
  h.dispose();const owner=audioHarness({url:'blob:new-owner'});assert.equal(owner.ready,false);owner.dispose();
});

test('restored mismatching recording never plays and logs failure without changing the saved deadline', async () => {
  const restored={...attempt(),id:'restored',startedAt:Date.now()-1000,listeningDeadline:Date.now()+2699000,readingDeadline:Date.now()+7199000};
  const before=JSON.stringify(restored);
  const h=audioHarness({attempt:restored,declaredListeningDurationMs:undefined,effectiveListeningDurationMs:2700000});
  await h.fire('onLoadedMetadata');await h.click('按已用时间恢复听力');
  assert.equal(h.player.playCalls,0);assert.deepEqual(h.interruptions,['audio-failure']);
  assert.equal(JSON.stringify(restored),before);h.dispose();
});

test('actual ended event does not submit or move LC early; saved stage change stops playback', async () => {
  const now=Date.now(), restored={...attempt(),id:'restored',startedAt:now-1000,lastObservedAt:now,listeningDeadline:now+2752000,readingDeadline:now+7252000};
  const before=JSON.stringify(restored),h=audioHarness({attempt:restored});
  await h.fire('onLoadedMetadata');await h.fire('onEnded');
  assert.equal(JSON.stringify(restored),before);assert.equal(restored.status,'listening');
  h.update({attempt:{...restored,status:'reading'}});assert.equal(h.player.paused,true);assert.equal(h.tree.props.hidden,true);h.dispose();
});
