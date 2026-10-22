'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const site = fs.realpathSync(process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '../..'));
const req = createRequire(path.join(site, 'package.json'));
const ts = req('typescript');
const idb = req('fake-indexeddb');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const allPins = new Map();

function createRuntime({ react, globals = {} } = {}) {
  const cache = new Map();
  function load(relative) {
    let file = path.resolve(site, relative);
    if (!file.startsWith(site + path.sep)) throw new Error('Source escaped the explicit site root');
    if (!path.extname(file)) file = ['.ts', '.tsx', '.json', '/index.ts'].map(extension => file + extension).find(candidate => fs.existsSync(candidate));
    assert.ok(file, 'Resolve product module ' + relative);
    if (cache.has(file)) return cache.get(file);
    const bytes = fs.readFileSync(file);
    const pin = { path: file, relative: path.relative(site, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha(bytes) };
    const prior = allPins.get(file);
    if (prior) assert.equal(prior.sha256, pin.sha256, 'Actual source changed during this run');
    allPins.set(file, pin);
    if (file.endsWith('.json')) { const value = JSON.parse(bytes); cache.set(file, value); return value; }
    const exports = {}; cache.set(file, exports);
    const compiled = ts.transpileModule(bytes.toString('utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
    assert.equal(compiled.diagnostics?.some(value => value.category === ts.DiagnosticCategory.Error) || false, false, 'Actual TypeScript transpiles');
    function imports(name) {
      if (name === 'react') { assert.ok(react, 'React hook harness must be explicit'); return react; }
      if (name === 'sonner') return { toast: { error() {}, success() {}, message() {} } };
      if (!name.startsWith('.') && !name.startsWith('@/')) return req(name);
      return load(path.relative(site, name.startsWith('@/') ? path.join(site, name.slice(2)) : path.resolve(path.dirname(file), name)));
    }
    vm.runInNewContext(compiled.outputText, { exports, require: imports, Date, Intl, Map, Set, Promise, Error, RangeError, TypeError, SyntaxError, JSON, Number, Object, Array, Math, RegExp, Uint8Array, Uint32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, structuredClone, crypto: crypto.webcrypto, setTimeout, clearTimeout, setInterval, clearInterval, Request, Response, Headers, Blob, File, FormData, URL, URLSearchParams, AbortController, DOMException, ReadableStream, performance, atob, btoa, ...globals }, { filename: file });
    return exports;
  }
  return { load };
}

function memoryStorage() {
  const map = new Map();
  return { get length() { return map.size; }, key(index) { return [...map.keys()][index] ?? null; }, getItem(key) { return map.get(String(key)) ?? null; }, setItem(key, value) { map.set(String(key), String(value)); }, removeItem(key) { map.delete(String(key)); }, clear() { map.clear(); } };
}

function hookHarness(componentFactory, props, { storage = memoryStorage(), transport, factory = new idb.IDBFactory() } = {}) {
  let slots = [], cursor = 0, effects = [], dirty = false, disposed = false, value;
  let currentProps = props;
  const listeners = new Map(), timers = new Map(), calls = [];
  let timerId = 0;
  const equal = (left, right) => left && right && left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { if (disposed) return; const result = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(result, slots[index])) { slots[index] = result; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(work, dependencies) { const index = cursor++; if (!slots[index] || !equal(slots[index].dependencies, dependencies)) { const previous = slots[index]; slots[index] = { dependencies, effectSlot: true }; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = work(); }); } },
    useCallback(work, dependencies) { const index = cursor++; if (!slots[index] || !equal(slots[index].dependencies, dependencies)) slots[index] = { dependencies, work }; return slots[index].work; },
  };
  const window = {
    location: { origin: 'https://lantern.local', search: '' }, localStorage: storage,
    addEventListener(type, work) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(work); },
    removeEventListener(type, work) { listeners.get(type)?.delete(work); },
    dispatchEvent(event) { for (const work of [...listeners.get(event.type) || []]) work(event); return true; },
  };
  const globals = {
    window, localStorage: storage, navigator: { onLine: true }, indexedDB: factory, IDBKeyRange: idb.IDBKeyRange,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    setTimeout(work) { const id = ++timerId; timers.set(id, work); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval(work) { const id = ++timerId; timers.set(id, work); return id; }, clearInterval(id) { timers.delete(id); },
    fetch(url, options = {}) { calls.push({ url, options }); return transport ? transport(url, options) : Promise.reject(new Error('Unexpected network attempt in native local-only test')); },
  };
  const runtime = createRuntime({ react, globals });
  const component = componentFactory(runtime);
  function render(next = currentProps) {
    currentProps = next; cursor = 0; dirty = false;
    value = component(currentProps);
    const pending = effects; effects = []; pending.forEach(work => work());
    return value;
  }
  render();
  return {
    runtime, storage, calls, factory, get value() { return value; }, render,
    signal(type) { window.dispatchEvent({ type }); },
    async settle(predicate = () => !dirty) {
      for (let index = 0; index < 300; index += 1) {
        if (dirty) render();
        await new Promise(resolve => setImmediate(resolve));
        if (!dirty && predicate(value)) return;
      }
      throw new Error('Synthetic hook scheduler did not settle');
    },
    dispose() { slots.filter(slot => slot?.effectSlot).forEach(slot => slot.cleanup?.()); disposed = true; assert.equal(timers.size, 0, 'Hook cleanup releases all synthetic timers'); },
  };
}

function stablePins() {
  for (const pin of allPins.values()) assert.equal(sha(fs.readFileSync(pin.path)), pin.sha256, 'Actual loaded source stayed stable: ' + pin.relative);
  return [...allPins.values()].sort((left, right) => left.relative.localeCompare(right.relative));
}

module.exports = { site, req, idb, plain, createRuntime, hookHarness, memoryStorage, stablePins };
