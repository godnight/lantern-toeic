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
  const backup = load('lib/study-backup.ts', {'./study-model':model,zod:require('zod')});
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
  const study = load('lib/use-study.ts', {react, sonner: {toast}, './study-model': model,'./study-backup':backup}, browser);
  const render = () => {cursor = 0; const value = renderer(); const pending = effects; effects = []; pending.forEach(run => run()); return value;};
  return {
    react, model, backup, browser, toast, messages, storage, study, render,
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

function dailyApp(data) {
  const h = environment();
  const jsx = (type, props) => ({type, props});
  const stubs = new Proxy({}, {get: (_, name) => String(name)});
  const imports = {
    react: h.react, 'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'fragment'},
    'lucide-react': stubs, sonner: {toast: h.toast},
    '@/lib/use-study': {useStudy: () => ({data, ready: true, sync: 'local', issues: []})},
    '@/lib/study-model': h.model, '@/lib/study-backup': h.backup,
    '@/lib/native-host': {registerNativeBack: () => () => {}},
    './learn/exam-collection': {}, './learn/resource-library': {}, './learn/practice': {},
    './learn/speaking': {}, './learn/theme-library': {}
  };
  for (const file of ['content/questions.json', 'content/speaking.json', 'art/map-scenes.json', 'art/themes.json']) {
    imports['@/' + file] = {default: JSON.parse(fs.readFileSync(root + '/' + file, 'utf8'))};
  }
  for (const name of ['sidebar', 'dialog', 'tabs', 'select', 'radio-group', 'progress', 'sonner']) imports['@/components/ui/' + name] = stubs;
  const App = load('app/study-app.tsx', imports, h.browser).default;
  h.setRenderer(() => App({owner: null, nativeMode: true}));
  return () => nodes(h.render(), n => n.type === 'button' && n.props.className?.startsWith('task-row'));
}

for (const part of [1, 5]) test(`daily Part ${part} task keeps its title after an answer and remount`, () => {
  const model = load('lib/study-model.ts', {}), data = structuredClone(model.EMPTY_DATA);
  const render = dailyApp(data), index = part === 1 ? 0 : 1;
  const original = textOf(render()[index]);
  data.attempts.push({id: randomUUID(), qid: `p${part}-01`, choice: 0, correct: true, createdAt: new Date().toISOString(), seconds: 12, mode: 'first'});
  const after = render()[index];
  assert.equal(textOf(after), original, 'Completing a task must not replace it with a newly recommended task');
  assert.match(after.props.className, /task-done/);
  assert.equal(textOf(dailyApp(data)()[index]), original, 'Restarting on the same day preserves the task');
});

test('daily speaking task stays on the saved prompt rather than marking the next prompt done', () => {
  const model = load('lib/study-model.ts', {}), data = structuredClone(model.EMPTY_DATA);
  const prompts = JSON.parse(fs.readFileSync(root + '/content/speaking.json', 'utf8'));
  const render = dailyApp(data), original = textOf(render()[2]);
  data.recordings.push({id: randomUUID(), promptId: prompts[0].id, title: prompts[0].title, createdAt: new Date().toISOString(), duration: 10, mime: 'audio/mp4'});
  assert.equal(textOf(render()[2]), original);
  assert.match(render()[2].props.className, /task-done/);
});

test('practicing other Parts and prompts does not complete the recommended daily tasks', () => {
  const model = load('lib/study-model.ts', {}), data = structuredClone(model.EMPTY_DATA);
  const prompts = JSON.parse(fs.readFileSync(root + '/content/speaking.json', 'utf8'));
  const render = dailyApp(data), before = render().map(textOf);
  for (const part of [2, 6]) data.attempts.push({id: randomUUID(), qid: `p${part}-01`, choice: 0, correct: true, createdAt: new Date().toISOString(), seconds: 12, mode: 'first'});
  data.recordings.push({id: randomUUID(), promptId: prompts[1].id, title: prompts[1].title, createdAt: new Date().toISOString(), duration: 10, mime: 'audio/mp4'});
  const after = render();
  assert.deepEqual(after.map(textOf), before);
  for (const task of after) assert.doesNotMatch(task.props.className, /task-done/);
});

test('daily recommendations advance at the configured local midnight and retain weak Parts', () => {
  const model = load('lib/study-model.ts', {}), data = structuredClone(model.EMPTY_DATA);
  const questions = JSON.parse(fs.readFileSync(root + '/content/questions.json', 'utf8'));
  const prompts = JSON.parse(fs.readFileSync(root + '/content/speaking.json', 'utf8'));
  data.profile.timezone = 'America/Los_Angeles';
  data.attempts.push({id: randomUUID(), qid: 'p1-01', choice: 0, correct: true, createdAt: '2026-09-19T06:59:00Z', seconds: 12, mode: 'first'});
  data.recordings.push({id: randomUUID(), promptId: prompts[0].id, title: prompts[0].title, createdAt: '2026-09-19T06:59:00Z', duration: 10, mime: 'audio/mp4'});
  const before = model.dailyPlan(data, questions, prompts, '2026-09-18');
  assert.equal(before.listeningPart, 1);
  assert.equal(before.oral.id, prompts[0].id);
  assert.deepEqual(Array.from(before.checkedTasks), [true, false, true]);
  const after = model.dailyPlan(data, questions, prompts, '2026-09-19');
  assert.equal(after.listeningPart, 2);
  assert.equal(after.oral.id, prompts[1].id);
  assert.deepEqual(Array.from(after.checkedTasks), [false, false, false]);
  data.attempts[0].correct = false;
  assert.equal(model.dailyPlan(data, questions, prompts, '2026-09-19').listeningPart, 1);
});

test('theme originals preview in the app and native Back closes the image before leaving the library', () => {
  const h = environment(), jsx = (type, props) => ({type, props});
  const stubs = new Proxy({}, {get: (_, name) => String(name)}), backs = new Map();
  const Library = load('app/learn/theme-library.tsx', {
    react:h.react, 'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'}, 'lucide-react':stubs,
    '@/components/ui/tabs':stubs, '@/components/ui/dialog':stubs,
    '@/lib/native-host':{registerNativeBack:(fn,priority)=>{backs.set(priority,fn);return ()=>backs.delete(priority);}},
    '@/art/themes.json':{default:JSON.parse(fs.readFileSync(root+'/art/themes.json','utf8'))},
    '@/art/references.json':{default:JSON.parse(fs.readFileSync(root+'/art/references.json','utf8'))}
  }, h.browser).default;
  h.setRenderer(()=>Library({selected:'hollow',onApply(){},onBack(){}}));
  let tree = h.render();
  assert.equal(nodes(tree,n=>n.type==='a'&&n.props.href?.startsWith('/images/')&&n.props.target==='_blank').length,0);
  const open = nodes(tree,n=>n.type==='button'&&textOf(n)==='��ԭͼ')[0];
  assert.ok(open); open.props.onClick(); tree=h.render();
  const dialog=nodes(tree,n=>n.type==='Dialog'&&n.props.open)[0];
  assert.ok(dialog); assert.ok(nodes(dialog,n=>n.type==='img'&&n.props.src.startsWith('/images/')).length);
  assert.equal(backs.get(50)(),true); tree=h.render();
  assert.equal(nodes(tree,n=>n.type==='Dialog'&&n.props.open).length,0);
  assert.equal(backs.get(50)(),false);
});

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
    '@/lib/use-study': {useStudy: owner => h.useStudy(owner)}, '@/lib/study-model': h.model, '@/lib/study-backup': h.backup,
    '@/lib/native-host': {registerNativeBack: () => () => {}},
    '@/content/questions.json': {default: JSON.parse(fs.readFileSync(root + '/content/questions.json'))},
    '@/content/speaking.json': {default: JSON.parse(fs.readFileSync(root + '/content/speaking.json'))},
    './learn/exam-collection':{},'./learn/resource-library': {default: 'ResourceLibrary'}, './learn/practice': {default: 'Practice'}, './learn/speaking': {default: 'SpeakingRoom'},
    './learn/theme-library': {default:()=>null},
    '@/art/map-scenes.json': {default: JSON.parse(fs.readFileSync(root+'/art/map-scenes.json','utf8'))},
    '@/art/themes.json': {default:JSON.parse(fs.readFileSync(root+'/art/themes.json','utf8'))},
  };
  for (const name of ['sidebar', 'dialog', 'tabs', 'select', 'radio-group', 'progress', 'sonner']) imports['@/components/ui/' + name] = stubs;
  const StudyApp = load('app/study-app.tsx', imports, h.browser).default;
  h.setRenderer(() => StudyApp({owner: null, nativeMode: true}));
  h.render(); await tick();
  let tree = h.render();
  const libraryButton = nodes(tree, n => n.type === 'button' && textOf(n).includes('ѧϰ���'))[0];
  assert.ok(libraryButton, 'Find the actual mobile navigation control');
  libraryButton.props.onClick(); tree = h.render();
  const library = nodes(tree, n => n.type === 'ResourceLibrary')[0];
  library.props.onRecord({id: 'review-resource', title: 'Review resource', minutes: 5});
  tree = h.render();
  const dialog = nodes(tree, n => n.type === 'Dialog' && n.props.open && textOf(n).includes('ʵ��ѧϰ����'))[0];
  const textarea = nodes(dialog, n => n.type === 'textarea')[0];
  textarea.props.onChange({target: {value: 'Keep my takeaway when storage fails'}});
  tree = h.render();
  const openDialog = nodes(tree, n => n.type === 'Dialog' && n.props.open && textOf(n).includes('ʵ��ѧϰ����'))[0];
  const form = nodes(openDialog, n => n.type === 'form')[0];
  h.messages.success.length = 0; h.setFailWrites(true);
  await form.props.onSubmit({preventDefault() {}});
  tree = h.render();
  assert.equal(h.latest.data.checkins.length, 0, 'The simulated storage write did fail');
  assert.equal(h.messages.success.length, 0, 'Failed persistence must not report a saved checkin');
  const retained = nodes(tree, n => n.type === 'Dialog' && n.props.open && textOf(n).includes('ʵ��ѧϰ����'))[0];
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
      '@/lib/use-study': {useStudy: owner => h.useStudy(owner)}, '@/lib/study-model': h.model, '@/lib/study-backup': h.backup,
      '@/lib/native-host': {registerNativeBack: () => () => {}},
      '@/content/questions.json': {default: JSON.parse(fs.readFileSync(root + '/content/questions.json'))},
      '@/content/speaking.json': {default: JSON.parse(fs.readFileSync(root + '/content/speaking.json'))},
      './learn/exam-collection': {}, './learn/resource-library': {default: 'ResourceLibrary'}, './learn/practice': {default: 'Practice'}, './learn/speaking': {default: 'SpeakingRoom'},
      './learn/theme-library': {default: () => null},
      '@/art/map-scenes.json': {default: JSON.parse(fs.readFileSync(root+'/art/map-scenes.json','utf8'))},
    '@/art/themes.json': {default: JSON.parse(fs.readFileSync(root + '/art/themes.json', 'utf8'))},
    };
    for (const name of ['sidebar', 'dialog', 'tabs', 'select', 'radio-group', 'progress', 'sonner']) imports['@/components/ui/' + name] = stubs;
    return load('app/study-app.tsx', imports, h.browser).default;
  };
  const openInstall = (h, StudyApp, owner, nativeMode) => {
    h.setRenderer(() => StudyApp({owner, nativeMode}));
    h.render();
    let tree = h.render();
    const button = nodes(tree, n => n.type === 'button' && n.props?.['aria-label'] === '��װ�ֻ�Ӧ��')[0];
    assert.ok(button, 'Find the mobile access control');
    button.props.onClick();
    tree = h.render();
    return nodes(tree, n => n.type === 'Dialog' && n.props.open && textOf(n).includes(nativeMode ? 'ԭ��Ԥ��' : '��������'))[0];
  };

  const web = environment();
  const webDialog = openInstall(web, createApp(web), 'alice', false);
  assert.match(textOf(webDialog), /HarmonyOS \/ ����/);
  assert.doesNotMatch(textOf(webDialog), /Android|iPhone/);
  assert.match(textOf(webDialog), /ChatGPT �˺�/);
  assert.match(textOf(webDialog), /�˺�ͬ���ѿ���/);

  const native = environment();
  const nativeDialog = openInstall(native, createApp(native), null, true);
  assert.match(textOf(nativeDialog), /����ģʽ/);
  const onlineLink = nodes(nativeDialog, n => n.type === 'a' && textOf(n).includes('��ͬ����ҳ��'))[0];
  assert.equal(onlineLink.props.href, 'https://lantern-toeic-godnight.zhuangzeliang.chatgpt.site');
  assert.equal(onlineLink.props.rel, 'noopener noreferrer');
});

test('active native maintenance is Harmony-only and phone auth remains fail-closed', () => {
  for (const removed of ['mobile/android', 'mobile/ios', 'mobile/capacitor.config.ts', '.github/workflows/android-debug.yml', '.github/workflows/ios-simulator.yml']) {
    assert.equal(fs.existsSync(root + '/' + removed), false, removed + ' must remain removed');
  }
  assert.doesNotMatch(fs.readFileSync(root + '/mobile/package.json', 'utf8'), /capacitor|cap (?:sync|open)/);
  assert.match(fs.readFileSync(root + '/harmony/entry/src/main/module.json5', 'utf8'), /ohos\.permission\.INTERNET/);
  assert.match(fs.readFileSync(root + '/harmony/.gitignore', 'utf8'), /agconnect-services\.json/);
  assert.match(fs.readFileSync(root + '/docs/rfcs/0002-phone-auth-and-online-data.md', 'utf8'), /�ȴ��ⲿ����/);
});
