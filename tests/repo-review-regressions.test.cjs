const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = process.env.LANTERN_REVIEW_ROOT || require('node:path').resolve(__dirname, '..');
const ts = require(root + '/node_modules/typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));

// Executes repository modules. Only browser, React hooks and network I/O are simulated.
function load(file, imports, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(root + '/' + file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}
  }).outputText;
  vm.runInNewContext(code, {exports, require: name => {
    if (!(name in imports)) throw Error('Unexpected import: ' + name);
    return imports[name];
  }, Date, Intl, Map, Set, structuredClone, crypto: {randomUUID}, Blob, URL, AbortController, ...globals}, {filename: file});
  return exports;
}

function environment({reverse = false} = {}) {
  const storage = new Map(), messages = {success: [], error: []}, listeners = new Map();
  let slots = [], cursor = 0, effects = [], online = false, failWrites = false;
  let remote, latest, renderer;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => slots[i] = typeof value === 'function' ? value(slots[i]) : value];},
    useRef(initial) {const i = cursor++; if (!(i in slots)) slots[i] = {current: initial}; return slots[i];},
    useCallback(fn, deps) {const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = {value: fn, deps}; return slots[i].value;},
    useEffect(fn, deps) {const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) {const old = slots[i]; slots[i] = {deps}; effects.push(() => {old?.cleanup?.(); slots[i].cleanup = fn();});}}
  };
  const model = load('lib/study-model.ts', {});
  remote = structuredClone(model.EMPTY_DATA);
  const localStorage = {
    get length() {return storage.size;},
    key: i => {const keys = [...storage.keys()]; return (reverse ? keys.reverse() : keys)[i] ?? null;},
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => {if (failWrites) {const error = Error('Storage full'); error.name = 'QuotaExceededError'; throw error;} storage.set(key, String(value));},
    removeItem: key => storage.delete(key)
  };
  const toast = Object.assign(() => {}, {success: text => messages.success.push(text), error: text => messages.error.push(text)});
  const browser = {
    document: {documentElement: {dataset: {},style:{setProperty(){}}}, hidden: false},
    window: {addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), scrollTo() {}},
    navigator: {get onLine() {return online;}},
    localStorage, setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
    fetch: async (url, init) => {
      if (!online) throw Error('offline');
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body);
        if (body.type === 'profile') remote.profile = body.data;
        return {ok: true};
      }
      return {ok: true, json: async () => ({...structuredClone(remote), owner: 'alice', hasProfile: true})};
    }
  };
  const study = load('lib/use-study.ts', {react, sonner: {toast}, './study-model': model}, browser);
  const render = () => {cursor = 0; const value = renderer(); const pending = effects; effects = []; pending.forEach(run => run()); return value;};
  return {
    react, model, browser, toast, messages, storage, study, render,
    get latest() {return latest;},
    useStudy(owner) {latest = study.useStudy(owner); return latest;},
    setRenderer(fn) {renderer = fn;},
    setOnline(value) {online = value;},
    setFailWrites(value) {failWrites = value;}
  };
}

function nodes(tree, predicate) {
  const queue = [tree], found = [];
  while (queue.length) {
    const node = queue.shift();
    if (!node) continue;
    if (Array.isArray(node)) {queue.push(...node); continue;}
    if (typeof node === 'object') {if (predicate(node)) found.push(node); queue.push(node.props?.children);}
  }
  return found;
}
function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props?.children);
}

test('offline profile changes preserve newest settings independently of Storage.key order', async () => {
  const h = environment({reverse: true});
  h.setRenderer(() => h.useStudy('alice'));
  h.render(); await tick();
  let api = h.render();
  api.saveProfile({...api.data.profile, name: 'Older', dailyMinutes: 15}); await tick();
  api = h.render();
  api.saveProfile({...api.data.profile, name: 'Latest', dailyMinutes: 45}); await tick();
  h.setOnline(true); await h.render().syncNow();
  assert.equal(h.render().data.profile.name, 'Latest');
  assert.equal(h.render().data.profile.dailyMinutes, 45);
});

test('storage quota failure keeps resource checkin open without a false success message', async () => {
  const h = environment();
  const jsx = (type, props) => ({type, props});
  const stubs = new Proxy({}, {get: (_, name) => String(name)});
  const imports = {
    react: h.react, 'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'fragment'},
    'lucide-react': stubs, sonner: {toast: h.toast},
    '@/lib/use-study': {useStudy: owner => h.useStudy(owner)}, '@/lib/study-model': h.model,
    '@/lib/native-host': {registerNativeBack: () => () => {}},
    '@/content/questions.json': {default: JSON.parse(fs.readFileSync(root + '/content/questions.json'))},
    '@/content/speaking.json': {default: JSON.parse(fs.readFileSync(root + '/content/speaking.json'))},
    './learn/exam-collection':{},'./learn/resource-library': {default: 'ResourceLibrary'}, './learn/practice': {default: 'Practice'}, './learn/speaking': {default: 'SpeakingRoom'},
    './learn/theme-library': {default:()=>null},
    '@/art/themes.json': {default:JSON.parse(fs.readFileSync(root+'/art/themes.json','utf8'))},
  };
  for (const name of ['sidebar', 'dialog', 'tabs', 'select', 'radio-group', 'progress', 'sonner']) imports['@/components/ui/' + name] = stubs;
  const StudyApp = load('app/study-app.tsx', imports, h.browser).default;
  h.setRenderer(() => StudyApp({owner: null, nativeMode: true}));
  h.render(); await tick();
  let tree = h.render();
  const libraryButton = nodes(tree, n => n.type === 'button' && textOf(n).includes('学习书库'))[0];
  assert.ok(libraryButton, 'Find the actual mobile navigation control');
  libraryButton.props.onClick(); tree = h.render();
  const library = nodes(tree, n => n.type === 'ResourceLibrary')[0];
  library.props.onRecord({id: 'review-resource', title: 'Review resource', minutes: 5});
  tree = h.render();
  const dialog = nodes(tree, n => n.type === 'Dialog' && n.props.open && textOf(n).includes('实际学习分钟'))[0];
  const textarea = nodes(dialog, n => n.type === 'textarea')[0];
  textarea.props.onChange({target: {value: 'Keep my takeaway when storage fails'}});
  tree = h.render();
  const openDialog = nodes(tree, n => n.type === 'Dialog' && n.props.open && textOf(n).includes('实际学习分钟'))[0];
  const form = nodes(openDialog, n => n.type === 'form')[0];
  h.messages.success.length = 0; h.setFailWrites(true);
  await form.props.onSubmit({preventDefault() {}});
  tree = h.render();
  assert.equal(h.latest.data.checkins.length, 0, 'The simulated storage write did fail');
  assert.equal(h.messages.success.length, 0, 'Failed persistence must not report a saved checkin');
  const retained = nodes(tree, n => n.type === 'Dialog' && n.props.open && textOf(n).includes('实际学习分钟'))[0];
  assert.ok(retained, 'Leave the draft open for retry');
  assert.equal(nodes(retained, n => n.type === 'textarea')[0].props.value, 'Keep my takeaway when storage fails');
});

test('mobile access guidance distinguishes synchronized PWA and local native modes', async () => {
  const createApp = h => {
    const jsx = (type, props) => ({type, props});
    const stubs = new Proxy({}, {get: (_, name) => String(name)});
    const imports = {
      react: h.react, 'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'fragment'},
      'lucide-react': stubs, sonner: {toast: h.toast},
      '@/lib/use-study': {useStudy: owner => h.useStudy(owner)}, '@/lib/study-model': h.model,
      '@/lib/native-host': {registerNativeBack: () => () => {}},
      '@/content/questions.json': {default: JSON.parse(fs.readFileSync(root + '/content/questions.json'))},
      '@/content/speaking.json': {default: JSON.parse(fs.readFileSync(root + '/content/speaking.json'))},
      './learn/exam-collection': {}, './learn/resource-library': {default: 'ResourceLibrary'}, './learn/practice': {default: 'Practice'}, './learn/speaking': {default: 'SpeakingRoom'},
      './learn/theme-library': {default: () => null},
      '@/art/themes.json': {default: JSON.parse(fs.readFileSync(root + '/art/themes.json', 'utf8'))},
    };
    for (const name of ['sidebar', 'dialog', 'tabs', 'select', 'radio-group', 'progress', 'sonner']) imports['@/components/ui/' + name] = stubs;
    return load('app/study-app.tsx', imports, h.browser).default;
  };
  const openInstall = (h, StudyApp, owner, nativeMode) => {
    h.setRenderer(() => StudyApp({owner, nativeMode}));
    h.render();
    let tree = h.render();
    const button = nodes(tree, n => n.type === 'button' && n.props?.['aria-label'] === '安装手机应用')[0];
    assert.ok(button, 'Find the mobile access control');
    button.props.onClick();
    tree = h.render();
    return nodes(tree, n => n.type === 'Dialog' && n.props.open && textOf(n).includes(nativeMode ? '原生预览' : '鸿蒙桌面'))[0];
  };

  const web = environment();
  const webDialog = openInstall(web, createApp(web), 'alice', false);
  assert.match(textOf(webDialog), /HarmonyOS \/ 鸿蒙/);
  assert.doesNotMatch(textOf(webDialog), /Android|iPhone/);
  assert.match(textOf(webDialog), /ChatGPT 账号/);
  assert.match(textOf(webDialog), /账号同步已开启/);

  const native = environment();
  const nativeDialog = openInstall(native, createApp(native), null, true);
  assert.match(textOf(nativeDialog), /本机模式/);
  const onlineLink = nodes(nativeDialog, n => n.type === 'a' && textOf(n).includes('打开同步网页版'))[0];
  assert.equal(onlineLink.props.href, 'https://lantern-toeic-godnight.zhuangzeliang.chatgpt.site');
  assert.equal(onlineLink.props.rel, 'noopener noreferrer');
});

test('active native maintenance is Harmony-only and phone auth remains fail-closed', () => {
  const androidWorkflow = fs.readFileSync(root + '/.github/workflows/android-debug.yml', 'utf8');
  const iosWorkflow = fs.readFileSync(root + '/.github/workflows/ios-simulator.yml', 'utf8');
  for (const workflow of [androidWorkflow, iosWorkflow]) {
    assert.match(workflow, /Archived .* build|Archived Android debug APK/);
    assert.match(workflow, /on:\n  workflow_dispatch:/);
    assert.doesNotMatch(workflow, /\n  (?:push|pull_request):/);
  }
  const androidBuild = fs.readFileSync(root + '/mobile/android/app/build.gradle', 'utf8');
  const iosBuild = fs.readFileSync(root + '/mobile/ios/App/App.xcodeproj/project.pbxproj', 'utf8');
  assert.match(androidBuild, /versionCode 4\s+versionName "0\.2\.3"/);
  assert.match(iosBuild, /CURRENT_PROJECT_VERSION = 4;/);
  assert.match(iosBuild, /MARKETING_VERSION = 0\.2\.3;/);
  assert.match(fs.readFileSync(root + '/harmony/entry/src/main/module.json5', 'utf8'), /ohos\.permission\.INTERNET/);
  assert.match(fs.readFileSync(root + '/harmony/.gitignore', 'utf8'), /agconnect-services\.json/);
  assert.match(fs.readFileSync(root + '/docs/rfcs/0002-phone-auth-and-online-data.md', 'utf8'), /等待外部配置/);
});
