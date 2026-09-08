const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const ts = require(root + '/node_modules/typescript');

// Exercise the shipped TypeScript and TSX together. The mocks below model browser
// events and React hook slots; they do not copy the native or recording logic.
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  vm.runInNewContext(code, {
    exports, require(name) {
      if (!(name in imports)) throw new Error('Unexpected import: ' + name);
      return imports[name];
    }, Date, Intl, Map, Set, Blob, URL, crypto: { randomUUID }, ...globals
  }, { filename: file });
  return exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function hostHarness(origin = 'https://lantern.local') {
  const listeners = new Map();
  const paused = [];
  const document = {
    hidden: false,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    querySelectorAll() { return [{ pause() { paused.push('audio'); } }, { pause() { paused.push('video'); } }]; }
  };
  const window = { location: { origin }, speechSynthesis: { cancel() { paused.push('speech'); } } };
  const globals = { window, document };
  const native = load('lib/native-host.ts', {}, globals);
  native.installHarmonyHost();
  return { native, globals, window, document, paused, listeners };
}
function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}
function findButton(tree, label) {
  const nodes = [tree];
  while (nodes.length) {
    const node = nodes.shift();
    if (!node) continue;
    if (Array.isArray(node)) { nodes.push(...node); continue; }
    if (node.type === 'button' && textOf(node).includes(label)) return node;
    nodes.push(node.props?.children);
  }
  throw new Error('Missing button: ' + label);
}
function speakingHarness({ manualPermissions = false } = {}) {
  const host = hostHarness();
  let clock = Date.parse('2026-09-08T10:00:00.000Z');
  let cursor = 0, effects = [], closed = 0, confirmCalls = 0, confirmation = false;
  const slots = [], recordings = [], permissions = [], saves = [], stopTasks = [];
  class ClockDate extends Date { static now() { return clock; } }
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const old = slots[i];
        slots[i] = { deps };
        effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    }
  };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(stream) {
      this.stream = stream; this.state = 'inactive'; this.mimeType = 'audio/webm'; this.stopCalls = 0;
      recordings.push(this);
    }
    start() { this.state = 'recording'; }
    stop() {
      assert.equal(this.state, 'recording', 'The browser only accepts stopping a recording once');
      this.state = 'inactive'; this.stopCalls++;
      // ArkWeb may delay these queued media events until after foregrounding.
      stopTasks.push(() => {
        this.ondataavailable?.({ data: new Blob(['recorded voice'], { type: this.mimeType }) });
        return this.onstop?.();
      });
    }
  }
  const navigator = { mediaDevices: { getUserMedia() {
    const request = deferred();
    const track = { stopped: 0, stop() { this.stopped++; } };
    request.stream = { getTracks: () => [track] };
    request.track = track;
    permissions.push(request);
    if (!manualPermissions) request.resolve(request.stream);
    return request.promise;
  } } };
  Object.assign(host.window, { MediaRecorder: Recorder, confirm() { confirmCalls++; return confirmation; } });
  const jsx = (type, props) => ({ type, props });
  const stub = new Proxy({}, { get: (_, name) => String(name) });
  const Room = load('app/learn/speaking.tsx', {
    '@/lib/study-model': load('lib/study-model.ts',{}),
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' }, 'lucide-react': stub,
    '@/components/ui/dialog': stub, '@/components/ui/checkbox': stub, './practice': stub,
    '@/lib/native-host': host.native,
    sonner: { toast: Object.assign(() => {}, { error() {}, success() {} }) }
  }, { ...host.globals, navigator, Date: ClockDate, MediaRecorder: Recorder, setInterval: () => 1, clearInterval() {} });
  const props = {
    nativeMode: true,
    prompt: JSON.parse(fs.readFileSync(path.join(root, 'content/speaking.json'), 'utf8'))[0],
    onClose() { closed++; }, onFinish() {},
    onSave(meta, blob) {
      const save = { ...deferred(), meta, blob }; saves.push(save); return save.promise;
    }
  };
  function render() {
    cursor = 0;
    const tree = Room.default(props);
    const pending = effects; effects = [];
    pending.forEach(fn => fn());
    return tree;
  }
  return {
    ...host, recordings, permissions, saves, render,
    get closed() { return closed; }, get confirmCalls() { return confirmCalls; },
    get time() { return clock; }, advance(ms) { clock += ms; },
    setConfirmation(value) { confirmation = value; },
    button(label) { return findButton(render(), label); },
    click(label) {
      const button = findButton(render(), label);
      assert.notEqual(button.props.disabled, true, label + ' must be enabled');
      return button.props.onClick();
    },
    setNativeForeground(value) { return host.window.__LANTERN_HARMONY__.onAppState(value); },
    back() { render(); return host.window.__LANTERN_HARMONY__.onBackPress(); },
    deliverStop() { assert.ok(stopTasks.length, 'Expected a queued stop event'); return stopTasks.shift()(); },
    cleanup() { for (const slot of slots) slot?.cleanup?.(); }
  };
}
async function startRecording(h) {
  await h.click('开始准备');
  h.click('准备好了');
  h.render();
  assert.equal(h.recordings.length, 1);
  assert.equal(h.recordings[0].state, 'recording');
}

test('native background stops and saves recording even when document.hidden stays false', async t => {
  const h = speakingHarness(); t.after(() => h.cleanup());
  await startRecording(h);
  const start = h.time;
  h.advance(5000);
  assert.equal(h.document.hidden, false);
  h.setNativeForeground(false);
  assert.equal(h.recordings[0].state, 'inactive');
  assert.ok(h.permissions[0].track.stopped > 0, 'Background must immediately release the microphone');
  h.advance(300000);
  const saving = h.deliverStop();
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0].meta.duration, 5, 'Suspension after stop is not recorded practice time');
  assert.equal(h.saves[0].meta.createdAt, new Date(start).toISOString());
  assert.equal(await h.saves[0].blob.text(), 'recorded voice');
  assert.equal(h.button('记录收获').props.disabled, true);
  h.setNativeForeground(true);
  h.setNativeForeground(false);
  h.setNativeForeground(false);
  h.saves[0].resolve(); await saving;
  assert.equal(h.recordings[0].stopCalls, 1, 'Repeated native background events must not stop twice');
  assert.equal(h.button('记录收获').props.disabled, false, 'Repeated background events must preserve pending save completion');
});

test('permission reply after a native background and foreground round trip cannot begin preparation', async t => {
  const h = speakingHarness({ manualPermissions: true }); t.after(() => h.cleanup());
  const pendingStart = h.click('开始准备');
  h.render();
  h.setNativeForeground(false);
  h.setNativeForeground(true);
  h.permissions[0].resolve(h.permissions[0].stream);
  await pendingStart;
  assert.ok(h.permissions[0].track.stopped > 0, 'Late microphone stream must be released');
  assert.equal(h.recordings.length, 0);
  assert.equal(h.button('开始准备').props.disabled, false, 'User can explicitly start again after returning');
  assert.throws(() => h.button('准备好了'), /Missing button/);
  const freshStart = h.click('开始准备');
  h.permissions[1].resolve(h.permissions[1].stream); await freshStart;
  h.click('准备好了'); h.render();
  assert.equal(h.recordings.length, 1, 'Only a fresh user action can record');
});

test('native back waits for stop events and successful saving before closing the room', async t => {
  const h = speakingHarness(); t.after(() => h.cleanup());
  await startRecording(h);
  h.advance(2000);
  assert.equal(h.back(), true);
  assert.equal(h.closed, 0);
  assert.equal(h.recordings[0].state, 'inactive');
  h.back();
  assert.equal(h.closed, 0, 'An inactive recorder can still have queued audio data');
  const saving = h.deliverStop();
  h.back();
  assert.equal(h.closed, 0, 'Back must not discard an in-flight IndexedDB save');
  h.saves[0].resolve(); await saving;
  h.back();
  assert.equal(h.closed, 1, 'A saved clip allows normal dismissal');
});

test('failed recording save stays open when discard confirmation is declined', async t => {
  const h = speakingHarness(); t.after(() => h.cleanup());
  await startRecording(h);
  h.click('结束录音');
  const saving = h.deliverStop();
  h.saves[0].reject(new Error('IndexedDB storage unavailable')); await saving;
  assert.equal(h.button('再说一次').props.disabled, true, 'An unsaved clip cannot be overwritten by a new recording');
  h.setConfirmation(false); h.back();
  assert.equal(h.confirmCalls, 1);
  assert.equal(h.closed, 0, 'Declining discard must preserve the failed recording and retry path');
  const retry = h.click('重试保存');
  assert.equal(h.saves.length, 2);
  assert.equal(h.saves[1].meta.id, h.saves[0].meta.id);
  assert.equal(h.saves[1].blob, h.saves[0].blob, 'Retry must retain the original audio');
  h.saves[1].resolve(); await retry;
  assert.equal(h.button('再说一次').props.disabled, false, 'A saved clip allows recording again');
  h.back();
  assert.equal(h.closed, 1);
  assert.equal(h.confirmCalls, 1, 'Successful retry removes the discard confirmation');
});

test('native back cancels preparation and releases the microphone before a later dismissal', async t => {
  const h = speakingHarness(); t.after(() => h.cleanup());
  await h.click('开始准备'); h.render();
  h.back();
  assert.equal(h.closed, 0);
  assert.ok(h.permissions[0].track.stopped > 0);
  assert.equal(h.recordings.length, 0);
  assert.equal(h.button('开始准备').props.disabled, false);
  h.back();
  assert.equal(h.closed, 1);
});

test('Harmony bridge validates foreground events, pauses media, and survives an isolated listener failure', () => {
  const wrong = hostHarness('https://example.com');
  assert.equal(wrong.window.__LANTERN_HARMONY__, undefined, 'Protocol is only installed for the packaged origin');
  const h = hostHarness();
  const bridge = h.window.__LANTERN_HARMONY__;
  h.native.installHarmonyHost();
  assert.equal(h.window.__LANTERN_HARMONY__, bridge, 'Installation is idempotent');
  assert.equal(h.listeners.get('click').size, 1);
  const states = [];
  const unsubscribe = h.native.subscribeNativeState(value => states.push(value));
  h.native.subscribeNativeState(value => { if (!value) throw new Error('one consumer failed'); });
  const otherStates = [];
  h.native.subscribeNativeState(value => otherStates.push(value));
  assert.equal(bridge.onAppState('false'), false);
  assert.equal(h.native.isNativeForeground(), true);
  assert.equal(bridge.onAppState(false), true);
  assert.equal(h.native.isNativeForeground(), false);
  assert.deepEqual(states, [true, false]);
  assert.deepEqual(otherStates, [true, false], 'Other consumers must still receive the background event');
  assert.deepEqual(h.paused, ['speech', 'audio', 'video']);
  unsubscribe();
  assert.equal(bridge.onAppState(true), true);
  assert.equal(h.native.isNativeForeground(), true);
  assert.deepEqual(states, [true, false], 'Unregistered state consumer receives no later event');
  assert.deepEqual(otherStates, [true, false, true]);
});

test('native back respects overlay priority, unregisters cleanly, and consumes handler errors', () => {
  const h = hostHarness();
  const bridge = h.window.__LANTERN_HARMONY__;
  const calls = [];
  const removePage = h.native.registerNativeBack(() => { calls.push('page'); return false; }, 0);
  const removeRoom = h.native.registerNativeBack(() => { calls.push('room'); return true; }, 100);
  assert.equal(bridge.onBackPress(), true);
  assert.deepEqual(calls, ['room'], 'The active room handles back before page navigation');
  removeRoom(); calls.length = 0;
  assert.equal(bridge.onBackPress(), false);
  assert.deepEqual(calls, ['page'], 'Removing an overlay restores the underlying page handler');
  const removeFailure = h.native.registerNativeBack(() => { calls.push('failed overlay'); throw new Error('dialog failed'); }, 200);
  calls.length = 0;
  assert.equal(bridge.onBackPress(), true);
  assert.deepEqual(calls, ['failed overlay'], 'An overlay exception must not leak back to page navigation');
  removeFailure(); calls.length = 0;
  bridge.onAppState(false);
  assert.equal(bridge.onBackPress(), true);
  assert.deepEqual(calls, [], 'A background app must not navigate in response to native back');
  bridge.onAppState(true);
  assert.equal(bridge.onBackPress(), false);
  assert.deepEqual(calls, ['page']);
  removePage(); calls.length = 0;
  assert.equal(bridge.onBackPress(), true);
  assert.deepEqual(calls, []);
});
