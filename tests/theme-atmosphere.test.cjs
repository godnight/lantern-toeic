'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));

// Run the actual component and native bridge together. Only React hook slots,
// localStorage, and browser event/observer surfaces are simulated.
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
  }).outputText;
  vm.runInNewContext(source, {
    exports, require(name) {
      if (!(name in imports)) throw Error('Unexpected import: ' + name);
      return imports[name];
    }, Map, Set, ...globals,
  }, {filename: file});
  return exports;
}

function atmosphereHarness({preference, reduced = false, hidden = false, foreground = true, storageThrows = false, intersectionAvailable = true} = {}) {
  const storage = new Map(preference === undefined ? [] : [['lantern-scene-motion-v1', preference]]);
  const writes = [], documentListeners = new Map(), mediaListeners = new Set(), observers = [];
  let cursor = 0, effects = [], stateUpdates = 0, nativeSubscriptions = 0;
  const slots = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => {stateUpdates++; slots[i] = typeof value === 'function' ? value(slots[i]) : value;}];
    },
    useRef(initial) {const i = cursor++; if (!(i in slots)) slots[i] = {current: initial}; return slots[i];},
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const old = slots[i]; slots[i] = {deps};
        effects.push(() => {old?.cleanup?.(); slots[i].cleanup = fn();});
      }
    },
  };
  const document = {
    hidden,
    addEventListener(type, fn) {if (!documentListeners.has(type)) documentListeners.set(type, new Set()); documentListeners.get(type).add(fn);},
    removeEventListener(type, fn) {documentListeners.get(type)?.delete(fn);},
    querySelectorAll() {return [];},
  };
  const media = {
    matches: reduced,
    addEventListener(type, fn) {assert.equal(type, 'change'); mediaListeners.add(fn);},
    removeEventListener(type, fn) {assert.equal(type, 'change'); mediaListeners.delete(fn);},
  };
  const window = {
    location: {origin: 'https://lantern.local'},
    matchMedia(query) {assert.equal(query, '(prefers-reduced-motion: reduce)'); return media;},
  };
  const scene = {id: 'synthetic-region-map'};
  const host = {closest(selector) {assert.equal(selector, '.region-map'); return scene;}};
  class Observer {
    constructor(callback) {this.callback = callback; this.target = null; this.disconnected = false; observers.push(this);}
    observe(target) {assert.equal(target, scene); this.target = target;}
    disconnect() {this.disconnected = true; this.target = null;}
    emit(isIntersecting) {if (!this.disconnected && this.target) this.callback([{isIntersecting, target: this.target}]);}
  }
  const localStorage = {
    getItem(key) {if (storageThrows) throw Error('Storage unavailable'); return storage.get(key) ?? null;},
    setItem(key, value) {if (storageThrows) throw Error('Storage unavailable'); writes.push([key, value]); storage.set(key, value);},
  };
  const globals = {window, document, localStorage, ...(intersectionAvailable ? {IntersectionObserver: Observer} : {})};
  const native = load('lib/native-host.ts', {}, globals);
  native.installHarmonyHost();
  window.__LANTERN_HARMONY__.onAppState(foreground);
  const trackedNative = {...native, subscribeNativeState(listener) {
    nativeSubscriptions++;
    const unsubscribe = native.subscribeNativeState(listener);
    return () => {nativeSubscriptions--; unsubscribe();};
  }};
  const jsx = (type, props) => ({type, props});
  const Component = load('app/learn/theme-atmosphere.tsx', {
    react, 'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'fragment'},
    'lucide-react': {Wind: 'Wind'}, '@/lib/native-host': trackedNative,
  }, globals).default;
  let props = {kind: 'water', paused: false};
  function nodes(tree) {
    const result = [], queue = [tree];
    while (queue.length) {
      const item = queue.shift();
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item)) {queue.push(...item); continue;}
      result.push(item); queue.push(item.props?.children);
    }
    return result;
  }
  function renderOnce() {
    cursor = 0;
    const tree = Component(props);
    for (const node of nodes(tree)) if (node.props?.ref) node.props.ref.current = host;
    const pending = effects; effects = []; pending.forEach(fn => fn());
    return tree;
  }
  function render(patch = {}) {
    props = {...props, ...patch};
    renderOnce();
    const all = nodes(renderOnce());
    return {layer: all.find(node => node.props?.className === 'theme-atmosphere'), button: all.find(node => node.type === 'button')};
  }
  function cleanup() {for (const slot of slots) if (slot?.cleanup) {slot.cleanup(); slot.cleanup = undefined;}}
  return {
    render, cleanup, document, writes, storage, observers,
    active(patch) {return render(patch).layer.props['data-active'];},
    toggle() {const {button} = render(); assert.equal(button.props.disabled, false); button.props.onClick(); return render();},
    setNativeForeground(value) {assert.equal(window.__LANTERN_HARMONY__.onAppState(value), true);},
    setHidden(value) {document.hidden = value; for (const fn of documentListeners.get('visibilitychange') || []) fn();},
    setReduced(value) {media.matches = value; for (const fn of mediaListeners) fn();},
    setVisible(value) {for (const observer of observers) observer.emit(value);},
    get stateUpdates() {return stateUpdates;},
    listenerCounts() {return {native: nativeSubscriptions, visibility: documentListeners.get('visibilitychange')?.size || 0, media: mediaListeners.size};},
  };
}

test('ambient motion starts off and an explicit toggle persists only its appearance preference', t => {
  const h = atmosphereHarness(); t.after(h.cleanup);
  assert.equal(h.active(), false);
  assert.equal(h.render().button.props['aria-pressed'], false);
  h.toggle(); assert.equal(h.active(), true);
  assert.deepEqual(h.writes, [['lantern-scene-motion-v1', 'on']]);
  const reloaded = atmosphereHarness({preference: h.storage.get('lantern-scene-motion-v1')}); t.after(reloaded.cleanup);
  assert.equal(reloaded.active(), true);
  h.toggle(); assert.equal(h.active(), false);
  assert.deepEqual(h.writes, [['lantern-scene-motion-v1', 'on'], ['lantern-scene-motion-v1', 'off']]);
});

test('native background pauses enabled motion even when document.hidden stays false', t => {
  const h = atmosphereHarness({preference: 'on'}); t.after(h.cleanup);
  assert.equal(h.active(), true);
  h.setNativeForeground(false);
  assert.equal(h.document.hidden, false);
  assert.equal(h.active(), false);
  assert.equal(h.render().button.props['aria-pressed'], true, 'temporary pause must retain user preference');
  h.setNativeForeground(true);
  assert.equal(h.active(), true);
  assert.deepEqual(h.writes, [], 'lifecycle changes must not write a preference or a learning event');
});

test('mounting while the native app is already backgrounded cannot start motion', t => {
  const h = atmosphereHarness({preference: 'on', foreground: false}); t.after(h.cleanup);
  assert.equal(h.document.hidden, false);
  assert.equal(h.active(), false);
  h.setNativeForeground(true); assert.equal(h.active(), true);
});

test('browser and native visibility both have to recover before motion resumes', t => {
  const h = atmosphereHarness({preference: 'on'}); t.after(h.cleanup);
  assert.equal(h.active(), true);
  h.setHidden(true); assert.equal(h.active(), false);
  h.setNativeForeground(false); assert.equal(h.active(), false);
  h.setHidden(false); assert.equal(h.active(), false, 'visible document cannot override native background');
  h.setNativeForeground(true); assert.equal(h.active(), true);
  h.setHidden(true); h.setNativeForeground(false); h.setNativeForeground(true);
  assert.equal(h.active(), false, 'native foreground cannot override a hidden document');
  h.setHidden(false); assert.equal(h.active(), true);
});

test('the focus pause prop survives theme changes and restores only an enabled scene', t => {
  const h = atmosphereHarness({preference: 'on'}); t.after(h.cleanup);
  assert.equal(h.active(), true);
  assert.equal(h.active({paused: true}), false);
  assert.equal(h.active({kind: 'snow'}), false);
  assert.equal(h.render().layer.props['data-kind'], 'snow');
  assert.equal(h.active({paused: false}), true);
  h.toggle();
  assert.equal(h.active({paused: true}), false);
  assert.equal(h.active({paused: false, kind: 'crystal'}), false, 'closing a practice dialog cannot enable a disabled preference');
});

test('reduced motion disables the toggle, pauses immediately and preserves the explicit choice', t => {
  const h = atmosphereHarness({preference: 'on', reduced: true}); t.after(h.cleanup);
  assert.equal(h.active(), false);
  assert.equal(h.render().button.props.disabled, true);
  assert.equal(h.render().button.props['aria-pressed'], true);
  h.setReduced(false);
  assert.equal(h.active(), true);
  assert.equal(h.render().button.props.disabled, false);
  h.setReduced(true); assert.equal(h.active(), false);
  assert.deepEqual(h.writes, []);
});

test('offscreen scenes pause without overriding focus pause when they become visible', t => {
  const h = atmosphereHarness({preference: 'on'}); t.after(h.cleanup);
  assert.equal(h.active(), true);
  assert.equal(h.observers.length, 1);
  assert.ok(h.observers[0].target, 'observer attaches to the actual scene after refs commit');
  h.setVisible(false); assert.equal(h.active(), false);
  h.active({paused: true});
  h.setVisible(true); assert.equal(h.active(), false);
  assert.equal(h.active({paused: false}), true);
  assert.deepEqual(h.writes, []);
});

test('unmount removes the native, document, media and observer subscriptions', () => {
  const h = atmosphereHarness({preference: 'on'});
  h.render(); h.render({kind: 'petals'}); h.render({kind: 'crystal'});
  assert.deepEqual(h.listenerCounts(), {native: 1, visibility: 1, media: 1});
  assert.equal(h.observers.length, 1, 'prop updates must not accumulate observers');
  h.cleanup();
  assert.deepEqual(h.listenerCounts(), {native: 0, visibility: 0, media: 0});
  assert.equal(h.observers[0].disconnected, true);
  const before = h.stateUpdates;
  h.setNativeForeground(false); h.setHidden(true); h.setReduced(true); h.setVisible(false);
  assert.equal(h.stateUpdates, before, 'unmounted component must not receive further state updates');
});

test('batched intersection transitions use the latest scene visibility', t => {
  const h = atmosphereHarness({preference: 'on'}); t.after(h.cleanup);
  h.render();
  h.observers[0].callback([{isIntersecting:false},{isIntersecting:true}]);
  assert.equal(h.active(), true, 'a transient collapsed layout must not leave the scene paused');
  h.observers[0].callback([{isIntersecting:true},{isIntersecting:false}]);
  assert.equal(h.active(), false);
});

test('unavailable storage still permits a session-only choice and no IntersectionObserver is tolerated', t => {
  const h = atmosphereHarness({storageThrows: true, intersectionAvailable: false}); t.after(h.cleanup);
  assert.equal(h.active(), false);
  h.toggle(); assert.equal(h.active(), true);
  h.setNativeForeground(false); assert.equal(h.active(), false);
  h.setNativeForeground(true); assert.equal(h.active(), true);
  assert.equal(h.observers.length, 0);
  assert.deepEqual(h.writes, []);
});
