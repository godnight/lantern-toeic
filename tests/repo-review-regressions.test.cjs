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
  const dependencies=require('./helpers/actual-source-loader.cjs').createSourceLoader({root,imports,globals,permitLearningAccess:true});
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(root + '/' + file, 'utf8'), {
    fileName:file,compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}
  }).outputText;
  vm.runInNewContext(code, {exports, require: name => {
    if (name === '@/lib/pcm-recorder') return {createRecordingCapture:stream=>new globals.MediaRecorder(stream),captureDuration:(_rec,seconds)=>seconds,captureWarning:()=>''};
    if (name === '@/lib/recording-capture-diagnostics') return {createRecordingCaptureTrace:()=>()=>{}};
    if (name === '@/lib/recording-media-diagnostics') return {recordingMediaTrace(){}};
    if (name === '@/release-manifest.json') return {default:JSON.parse(fs.readFileSync(root + '/release-manifest.json','utf8'))};
    if (name === '@/lib/use-dialog-viewport') return load('lib/use-dialog-viewport.ts', {react: imports.react}, globals);
    if (!(name in imports)) return dependencies.resolve(name,file);
    return imports[name];
  }, Date, Intl, Map, Set, structuredClone, crypto: {randomUUID}, Blob, URL, URLSearchParams, AbortController, ...globals}, {filename: file});
  return exports;
}

function environment({reverse = false} = {}) {
  const storage = new Map(), messages = {success: [], error: []}, listeners = new Map(), backs = new Set();
  let slots = [], cursor = 0, effects = [], online = false, failWrites = false;
  let remote, latest, renderer, workspaceKey;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; const stateSlots=slots; return [slots[i], value => stateSlots[i] = typeof value === 'function' ? value(stateSlots[i]) : value];},
    useRef(initial) {const i = cursor++; if (!(i in slots)) slots[i] = {current: initial}; return slots[i];},
    useCallback(fn, deps) {const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = {value: fn, deps}; return slots[i].value;},
    useEffect(fn, deps) {const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) {const old = slots[i]; slots[i] = {deps}; effects.push(() => {old?.cleanup?.(); slots[i].cleanup = fn();});}}
  };
  react.useLayoutEffect=react.useEffect;
  const model = load('lib/study-model.ts', {});
  const backup = load('lib/study-backup.ts', {'./study-model':model,zod:require(root + '/node_modules/zod')});
  remote = structuredClone(model.EMPTY_DATA);
  const localStorage = {
    get length() {return storage.size;},
    key: i => {const keys = [...storage.keys()]; return (reverse ? keys.reverse() : keys)[i] ?? null;},
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => {if (failWrites) {const error = Error('Storage full'); error.name = 'QuotaExceededError'; throw error;} storage.set(key, String(value));},
    removeItem: key => storage.delete(key)
  };
  const toast = Object.assign(() => {}, {success: text => messages.success.push(text), error: text => messages.error.push(text), message: text => messages.error.push(text)});
  const browser = {
    HTMLElement:class HTMLElement{},requestAnimationFrame:fn=>{fn();return 1;},
    document: {querySelector:()=>null,querySelectorAll:()=>[],activeElement:null,documentElement: {dataset: {},style:{setProperty(){}}}, body:{dataset:{},style:{}}, hidden: false},
    window: {location:{search:''}, history:{state:null,pushState(state){this.state=state;},replaceState(state){this.state=state;},back(){this.state=null;listeners.get('popstate')?.({state:null});}}, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), scrollTo() {}},
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
    react, model, backup, browser, toast, messages, storage, study, render, backs,
    get latest() {return latest;},
    useStudy(owner) {latest = study.useStudy(owner); return latest;},
    setRenderer(fn) {renderer = fn;},
    replaceWorkspace(key) {if(workspaceKey===key)return;slots.forEach(slot=>slot?.cleanup?.());slots=[];cursor=0;effects=[];workspaceKey=key;},
    setOnline(value) {online = value;},
    setFailWrites(value) {failWrites = value;},
    cleanup() {slots.forEach(slot=>slot?.cleanup?.());slots=[];effects=[];}
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

// Expand the shipped pure layout/theme components so navigation is exercised
// through its real buttons. Business children remain explicit, props-preserving
// placeholders; the real recording-history component gets independent hook slots.
function createStudyApp(h, {data,keyedWorkspace=false,api={}} = {}) {
  const pureComponents = new Set();
  let workspaceComponent;
  const jsx = (type, props, key) => {if(keyedWorkspace&&type===workspaceComponent)h.replaceWorkspace(key);return (pureComponents.has(type)||type?.name==='SettingsRow') ? type(props) : ({type, props, key});};
  const stubs = new Proxy({}, {get: (_, name) => String(name)});
  const runtime = {jsx, jsxs: jsx, Fragment: 'fragment'};
  const themeModel = load('lib/ui-theme.ts', {}, h.browser);
  const themeUi = load('app/learn/ui-theme.tsx', {
    react:h.react,'react/jsx-runtime':runtime, 'lucide-react':stubs, '@/lib/ui-theme':themeModel
  }, h.browser);
  for (const component of Object.values(themeUi)) if (typeof component === 'function'&&component!==themeUi.ThemeScene) pureComponents.add(component);
  const workspace = load('app/learn/workspace-shell.tsx', {
    'react/jsx-runtime':runtime, 'lucide-react':stubs, './ui-theme':themeUi
  }, h.browser);
  for (const component of Object.values(workspace)) if (typeof component === 'function') pureComponents.add(component);
  const speaking = load('app/learn/speaking.tsx', {...require('./helpers/prepared-workspace-fixture.cjs').preparedWorkspaceImports(root),'@/lib/lesson-audio':{stopLessonAudio(){}},
    react:h.react, 'react/jsx-runtime':runtime, 'lucide-react':stubs,
    '@/components/ui/dialog':stubs, '@/components/ui/checkbox':stubs, './practice':stubs, './recording-player':{RecordingPlayer:'audio'},
    '@/lib/study-model':h.model,
    '@/lib/native-host':{registerNativeBack:()=>()=>{},isNativeForeground:()=>true,subscribeNativeState:()=>()=>{}},
    sonner:{toast:h.toast}
  }, h.browser);
  pureComponents.add(speaking.SpeakingTaskCatalog);
  const presentationImports={react:h.react,'react/jsx-runtime':runtime,'lucide-react':stubs,'./ui-theme':themeUi,'@/lib/ui-theme':themeModel,'@/lib/study-model':h.model,'./legal-pages':{PublicInfoLinks:'PublicInfoLinks'},'@/components/ui/tabs':stubs};
  const presentation={};
  for(const file of ['personal-settings','today-dashboard','practice-home']){const module=load('app/learn/'+file+'.tsx',presentationImports,h.browser);presentation['./learn/'+file]=module;for(const component of Object.values(module))if(typeof component==='function')pureComponents.add(component);}
  const imports = {
    ...presentation,'./account/account-form':{default:'AccountForm'},'./learn/legal-pages':{PublicInfoLinks:'PublicInfoLinks'},'./legal-pages':{PublicInfoLinks:'PublicInfoLinks'},
    react:h.react, 'react/jsx-runtime':runtime, 'lucide-react':stubs, sonner:{toast:h.toast},
    '@/lib/lesson-audio':{prepareProductLessonAudio:async()=>undefined,stopLessonAudio(){}},
    '@/lib/use-study':{useStudy: data ? () => ({data,ready:true,recordsReadable:true,sync:'local',issues:[],...api}) : owner => h.useStudy(owner)},
    '@/lib/study-model':h.model, '@/lib/study-backup':h.backup, '@/lib/speaking-recovery':load('lib/speaking-recovery.ts',{}),
    '@/lib/native-host':{registerNativeBack(fn){h.backs.add(fn);return()=>h.backs.delete(fn);}},
    '@/lib/ui-theme':themeModel, './learn/workspace-shell':workspace, './learn/ui-theme':themeUi,
    './learn/exam-collection':{default:'ExamCollection'}, './learn/resource-library':{default:'ResourceLibrary'},
    './learn/practice':{default:'Practice'},
    './learn/speaking':{default:'SpeakingRoom',SpeakingTaskCatalog:speaking.SpeakingTaskCatalog,SpeakingRecordingHistory:speaking.SpeakingRecordingHistory},
    './learn/recording-player':{RecordingPlayer:'RecordingPlayer'},
    './learn/vocabulary-library':{default:'VocabularyLibrary',VocabularyEntry:'VocabularyEntry',VocabularyReviewSummary:'VocabularyReviewSummary'},
    './learn/mock-exam':{default:'MockExam'}
  };
  for (const file of ['content/questions.json','content/speaking.json']) {
    imports['@/'+file]={default:JSON.parse(fs.readFileSync(root+'/'+file,'utf8'))};
  }
  for (const name of ['dialog','tabs','select','radio-group','progress','sonner']) imports['@/components/ui/'+name]=stubs;
  Object.assign(imports,require('./helpers/phase2-shell-fixture.cjs').workflowShellFixture(h.react,load('lib/practice-selection.ts',{'./study-model':h.model},h.browser)));
  imports['@/public/build-identity.json']={default:JSON.parse(fs.readFileSync(root+'/public/build-identity.json','utf8'))};
  Object.assign(imports,require('./helpers/prepared-workspace-fixture.cjs').preparedWorkspaceImports(root));
 const app = load('app/study-workspace.tsx',imports,h.browser);
  h.recovery=imports['@/lib/speaking-recovery'];
  workspaceComponent=app.StudyWorkspace;
  pureComponents.add(app.StudyWorkspace);
  // Owner-scoping probes target the exported post-verification workspace.
  // Authentication barriers are covered by the dedicated product-session tests.
  return props=>jsx(app.StudyWorkspace,props,JSON.stringify([props.nativeMode,props.owner]));
}
function dailyApp(data) {
  const h=environment(), App=createStudyApp(h,{data});
  h.setRenderer(()=>App({owner:null,nativeMode:true}));
  const render=()=>h.render();render.studyData=data;render.studyModel=h.model;return render;
}

// Reconcile the actual shipped workspace key with separate hook slots. Browser
// and React effects are controlled; study persistence still uses the real hook.
function ownerWorkspace() {
  const h=environment(), App=createStudyApp(h,{keyedWorkspace:true});
  let owner='alice', nativeMode=false;
  for(const account of ['alice','bob']) {const data=structuredClone(h.model.EMPTY_DATA);data.profile.name=account.toUpperCase();data.profile.onboarded=true;h.storage.set('lantern-v1-'+account,JSON.stringify({data}));}
  h.setRenderer(()=>App({owner,nativeMode}));
  const render=()=>{h.render();return h.render();};
  const button=(label)=>nodes(render(),n=>n.type==='button'&&textOf(n)===label)[0];
  const dialog=(title)=>nodes(render(),n=>n.type==='Dialog'&&textOf(n).includes(title))[0];
  return {h,render,button,dialog,preferences(){navigateApp(render,'profile');nodes(render(),n=>n.type==='button'&&textOf(n).startsWith('学习计划'))[0].props.onClick();},switchTo(next,nextNative=false){owner=next;nativeMode=nextNative;return render();}};
}

test('C10: owner and mode boundary removes plan drafts while same owner keeps edits',()=>{
  const app=ownerWorkspace();app.render();app.preferences();
  const plan=()=>nodes(app.render(),n=>n.type==='LearningPlanDialog')[0];
  const a=plan();assert.ok(a);assert.equal(a.props.profile.name,'ALICE');
  const {harness}=require('./helpers/plan-ui-harness.cjs');
  const editor=harness('ProfilePlanEditor',{profile:a.props.profile,readable:true,saveProfile:a.props.saveProfile,onLeave(){},onSaved(){}});
  editor.find(n=>n.type==='input'&&n.props.maxLength===40)[0].props.onChange({target:{value:'ALICE PRIVATE DRAFT'}});editor.render();
  assert.equal(editor.find(n=>n.type==='input'&&n.props.maxLength===40)[0].props.value,'ALICE PRIVATE DRAFT');assert.equal(plan().key,a.key);
  app.switchTo('bob');assert.equal(plan(),undefined);editor.unmount(); // React removes this keyed workspace and its editor.
  app.preferences();const b=plan(),next=harness('ProfilePlanEditor',{profile:b.props.profile,readable:true,saveProfile:b.props.saveProfile,onLeave(){},onSaved(){}});
  assert.equal(next.find(n=>n.type==='input'&&n.props.maxLength===40)[0].props.value,'BOB');
  app.switchTo('bob',true);assert.equal(plan(),undefined);next.unmount();
  assert.doesNotMatch(JSON.stringify([...app.h.storage]),/ALICE PRIVATE DRAFT/,'Unsaved draft never enters either account snapshot');
});

test('C10: resource checkin fields and departed completion callbacks cannot enter the next owner workspace',()=>{
  const app=ownerWorkspace();app.render();navigateApp(app.render,'resources');
  const resource=nodes(app.render(),n=>n.type==='ResourceLibrary')[0];
  resource.props.onRecord({id:'qa-alice-resource',title:'ALICE PRIVATE MATERIAL',minutes:12});
  let dialog=app.dialog('留下一点今天的收获');assert.equal(dialog.props.open,true);
  nodes(dialog,n=>n.type==='textarea')[0].props.onChange({target:{value:'ALICE PRIVATE NOTE'}});
  assert.equal(nodes(app.dialog('留下一点今天的收获'),n=>n.type==='textarea')[0].props.value,'ALICE PRIVATE NOTE');
  app.switchTo('bob');assert.equal(app.dialog('留下一点今天的收获').props.open,false);
  resource.props.onRecord({id:'qa-alice-delayed',title:'DEPARTED MATERIAL',minutes:20});
  dialog=app.dialog('留下一点今天的收获');assert.equal(dialog.props.open,false);
  assert.equal(nodes(dialog,n=>n.type==='textarea')[0].props.value,'');assert.doesNotMatch(textOf(dialog),/ALICE PRIVATE|DEPARTED MATERIAL/);
  assert.equal(JSON.parse(app.h.storage.get('lantern-v1-bob')).data.checkins.length,0);
});

test('C10: practice and speaking sessions are removed at owner change, retaining original callback owner',()=>{
  const app=ownerWorkspace();app.render();startWorkspacePractice(app.render);
  const practice=nodes(app.render(),n=>n.type==='Practice')[0];assert.ok(practice);
  app.switchTo('bob');assert.equal(nodes(app.render(),n=>n.type==='Practice').length,0);
  practice.props.onFinish(8);assert.equal(app.dialog('留下一点今天的收获').props.open,false);
  const attempt={id:'qa-departed-practice',qid:practice.props.queue[0].id,choice:0,correct:false,createdAt:new Date().toISOString(),seconds:5,mode:'first'};
  practice.props.onAttempt(attempt);
  assert.equal(JSON.parse(app.h.storage.get('lantern-v1-bob')).data.attempts.length,0,'A departed callback cannot write the replacement account');
  assert.ok(JSON.parse(app.h.storage.get('lantern-v1-alice')).data.attempts.some(a=>a.id===attempt.id),'A captured callback remains scoped to its original account');
  app.switchTo('alice');navigateApp(app.render,'train');const oral=nodes(app.render(),n=>n.type==='button'&&n.props['aria-label']==='开始'+JSON.parse(fs.readFileSync(root+'/content/speaking.json','utf8'))[0].title)[0];oral.props.onClick();
  const speaking=nodes(app.render(),n=>n.type==='SpeakingRoom')[0];assert.ok(speaking);
  app.switchTo(null,true);assert.equal(nodes(app.render(),n=>n.type==='SpeakingRoom').length,0);
  speaking.props.onFinish(9);assert.equal(app.dialog('留下一点今天的收获').props.open,false,'A departed speaking completion cannot open a new owner checkin');
  assert.equal(nodes(app.render(),n=>n.type==='Practice').length,0);
});

test('I01: workspace recovery stays with the original owner and a processing clip cannot start a replacement session',()=>{
  const app=ownerWorkspace();app.render();const prompts=JSON.parse(fs.readFileSync(root+'/content/speaking.json','utf8'));
  const scope=JSON.stringify([false,'alice']),clip={prompt:prompts[0],meta:{id:'qa-owner-retained',promptId:prompts[0].id,title:prompts[0].title,createdAt:'2026-10-13T08:00:00Z',duration:8,mime:'audio/webm',note:''},blob:new Blob(['private Alice clip'])};
  app.h.recovery.retainSpeakingRecovery(scope,{...clip,processing:true});
  assert.equal(app.button('恢复未保存录音').props.disabled,true);
  navigateApp(app.render,'train');nodes(app.render(),n=>n.type==='button'&&n.props['aria-label']==='开始'+JSON.parse(fs.readFileSync(root+'/content/speaking.json','utf8'))[0].title)[0].props.onClick();assert.equal(nodes(app.render(),n=>n.type==='SpeakingRoom').length,0);
  app.h.recovery.retainSpeakingRecovery(scope,clip);app.switchTo('bob');assert.equal(app.button('恢复未保存录音'),undefined);assert.doesNotMatch(textOf(app.render()),/有一段口语录音尚未保存/);
  app.switchTo('alice');app.button('恢复未保存录音').props.onClick();const room=nodes(app.render(),n=>n.type==='SpeakingRoom')[0];assert.ok(room);assert.equal(room.props.recovery.blob,clip.blob);assert.equal(room.props.recovery.meta.id,clip.meta.id);
  room.props.onRelease(clip.meta.id);room.props.onClose();assert.equal(app.h.recovery.getSpeakingRecovery(scope),undefined);assert.equal(app.button('恢复未保存录音'),undefined);
});

test('I09: nested lookup preserves the same practice queue and restores its lookup trigger focus',()=>{
  const h=environment(),data=structuredClone(h.model.EMPTY_DATA);let focusCount=0,backCount=0;
  class Element{constructor(){this.isConnected=true;}focus(){focusCount++;}}
  h.browser.HTMLElement=Element;h.browser.document.activeElement=new Element();h.browser.requestAnimationFrame=fn=>fn();
  h.browser.window.history.back=()=>{backCount++;h.browser.window.history.state={lanternPracticeView:'qa-parent-practice'};};
  const App=createStudyApp(h,{data});h.setRenderer(()=>App({owner:'alice',nativeMode:false}));const render=()=>h.render();
  startWorkspacePractice(render);const before=nodes(render(),n=>n.type==='Practice')[0];
  before.props.onLookup('reservation');let practice=nodes(render(),n=>n.type==='Practice')[0],dictionary=nodes(render(),n=>n.type==='VocabularyLibrary')[0];
  assert.equal(practice.props.queue,before.props.queue);assert.equal(practice.props.lookupActive,true);assert.equal(dictionary.props.initialQuery,'reservation');assert.equal(dictionary.props.initialMode,'dictionary');
  dictionary.props.onBack();practice=nodes(render(),n=>n.type==='Practice')[0];assert.equal(practice.props.queue,before.props.queue);assert.equal(practice.props.lookupActive,false);assert.equal(backCount,1);assert.equal(focusCount,1);
});
function navigateApp(render, id) {
  if(id==='profile'){const entry=nodes(render(),n=>n.type==='button'&&n.props['aria-label']==='打开个人信息与设置')[0]||nodes(render(),n=>n.type==='button'&&textOf(n)==='我的与设置')[0];assert.ok(entry,'Actual personal entry');entry.props.onClick();return;}
  const nav=nodes(render(),n=>n.type==='nav'&&n.props['aria-label']==='桌面主导航')[0];
  const labels={today:'今日',train:'练习',resources:'资料',profile:'我的'};
  const button=nodes(nav,n=>n.type==='button'&&textOf(n)===labels[id])[0];
  assert.ok(button,'Find the real WorkspaceShell navigation button for '+id);
  button.props.onClick();
}
function startWorkspacePractice(render){navigateApp(render,'train');const start=nodes(render(),n=>n.type==='button'&&textOf(n).includes('Part 1 ·'))[0];assert.ok(start,'Actual Part 1 entry');start.props.onClick();}
// Daily recommendations are now a model contract; the redesigned Today UI routes
// to explicit Part selection instead of rendering the old three task buttons.
function dailySnapshot(render) {
 const data=render.studyData,model=render.studyModel;
 const questions=load('lib/question-catalog.ts',{}).QUESTIONS;
 const prompts=JSON.parse(fs.readFileSync(root+'/content/speaking.json','utf8'));
 const plan=model.dailyPlan(data,questions,prompts);
 return [
  {title:'Part '+plan.listeningPart,done:plan.checkedTasks[0],parts:[plan.listeningPart]},
  {title:'Part '+plan.readingPart,done:plan.checkedTasks[1],parts:[plan.readingPart]},
  {title:plan.oral.title,done:plan.checkedTasks[2],promptId:plan.oral.id},
 ];
}

test('recording dates follow the configured timezone across UTC day boundaries', () => {
  const model=load('lib/study-model.ts',{}), data=structuredClone(model.EMPTY_DATA);
  const createdAt='2026-10-10T16:30:00.000Z';
  data.recordings.push({id:randomUUID(),promptId:'s1',title:'Timezone recording',createdAt,duration:24,mime:'audio/mp4'});
  const render=dailyApp(data); navigateApp(render,'train');
  // A separate hook environment preserves the component boundary, as React does.
  const history=environment(), jsx=(type,props)=>({type,props}), stubs=new Proxy({},{get:(_,name)=>String(name)});
  const actualHistory=load('app/learn/speaking.tsx',{...require('./helpers/prepared-workspace-fixture.cjs').preparedWorkspaceImports(root),'@/lib/lesson-audio':{stopLessonAudio(){}},
    react:history.react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':stubs,
    '@/components/ui/dialog':stubs,'@/components/ui/checkbox':stubs,'./practice':stubs,'./recording-player':{RecordingPlayer:'audio'},
    '@/lib/study-model':history.model,'@/lib/native-host':{registerNativeBack:()=>()=>{},isNativeForeground:()=>true,subscribeNativeState:()=>()=>{}},sonner:{toast:history.toast}
  },history.browser).SpeakingRecordingHistory;
  for(const [timezone,expected] of [['Asia/Shanghai','10月11日 00:30'],['America/Los_Angeles','10月10日 09:30'],['UTC','10月10日 16:30']]){
    data.profile.timezone=timezone;
    const list=nodes(render(),n=>typeof n.type==='function'&&n.type.name==='SpeakingRecordingHistory')[0];
    assert.ok(list,'StudyApp passes its actual recordings and timezone into history');
    history.setRenderer(()=>actualHistory(list.props));
    const row=nodes(history.render(),n=>n.type==='article'&&n.props.className==='speaking-recording-item')[0];
    assert.ok(textOf(row).includes(expected+' · 24 秒 · M4A · 本机录音'),timezone);
    assert.equal(data.recordings[0].createdAt,createdAt,'Formatting preserves the original recording timestamp');
  }
});

test('I04: shared player retry rereads the original recording and remounts an unchanged cloud URL',async()=>{
  const h=environment(),data=structuredClone(h.model.EMPTY_DATA),requests=[];
  const recording={id:'qa-cloud-media-error',promptId:'s1',title:'Existing cloud recording',createdAt:'2026-10-13T08:00:00Z',duration:24,mime:'audio/webm',uploaded:true};data.recordings=[recording];
  const App=createStudyApp(h,{data,api:{recordingUrl:async r=>{requests.push(r);return '/api/recordings/'+r.id;}}});h.setRenderer(()=>App({owner:'alice',nativeMode:false}));const render=()=>h.render();
  navigateApp(render,'train');nodes(render(),n=>n.type==='Tabs')[0].props.onValueChange('speaking');
  await nodes(render(),n=>typeof n.type==='function'&&n.type.name==='SpeakingRecordingHistory')[0].props.onPlay(recording);
  const firstAudio=nodes(render(),n=>n.type==='RecordingPlayer')[0];assert.ok(firstAudio);assert.equal(firstAudio.props.autoPlay,true);
  assert.equal(data.recordings[0],recording);assert.equal(data.recordings.length,1);
  await firstAudio.props.onRetry();await tick();
  const retryAudio=nodes(render(),n=>n.type==='RecordingPlayer')[0];assert.equal(requests.length,2);assert.equal(requests[1],recording);assert.equal(retryAudio.props.src,firstAudio.props.src);assert.notEqual(retryAudio.key,firstAudio.key,'The unchanged cloud URL must mount a fresh audio element');assert.equal(data.recordings[0],recording);
});

// The owner executes unchanged recording reads; only URL creation/retirement is
// observed. These synthetic URLs never enter learner storage or a media device.
function recordingOwnerFixture(read) {
  const h=environment(),data=structuredClone(h.model.EMPTY_DATA),revoked=[],requests=[];
  const recording={id:'url-owner-recording',promptId:'s1',title:'Owned recording URL',createdAt:'2026-10-13T08:00:00Z',duration:6,mime:'audio/webm'};
  data.recordings=[recording];
  h.browser.URL={revokeObjectURL:url=>revoked.push(url),createObjectURL(){throw Error('The URL must come from the recording repository');}};
  const App=createStudyApp(h,{data,api:{recordingUrl:async r=>{requests.push(r);return read(r,requests.length);}}});
  h.setRenderer(()=>App({owner:'alice',nativeMode:false}));const render=()=>h.render();
  navigateApp(render,'train');nodes(render(),n=>n.type==='Tabs')[0].props.onValueChange('speaking');render();
  const history=()=>nodes(render(),n=>typeof n.type==='function'&&n.type.name==='SpeakingRecordingHistory')[0];
  const player=()=>nodes(render(),n=>n.type==='RecordingPlayer')[0];
  const close=()=>{const dialog=nodes(render(),n=>n.type==='Dialog'&&n.props.open&&nodes(n,x=>x.type==='RecordingPlayer').length)[0];assert.ok(dialog);dialog.props.onOpenChange(false);render();};
  return {h,data,recording,revoked,requests,render,history,player,close};
}
test('history owns Blob URL by URL value: unchanged-URL request remount does not revoke a mounted URL',async t=>{
  const f=recordingOwnerFixture(()=> 'blob:owned-same');t.after(()=>f.h.cleanup());
  await f.history().props.onPlay(f.recording);const first=f.player();await first.props.onRetry();const second=f.player();
  assert.notEqual(second.key,first.key);assert.equal(second.props.src,first.props.src);assert.deepEqual(f.revoked,[]);
  assert.equal(f.requests.length,2);assert.equal(f.requests[0],f.recording);assert.equal(f.requests[1],f.recording);
  f.close();assert.deepEqual(f.revoked,['blob:owned-same']);f.h.cleanup();assert.deepEqual(f.revoked,['blob:owned-same']);
});
test('history replaces a Blob URL exactly once and unmount releases only the final owned URL',async()=>{
  const f=recordingOwnerFixture((r,n)=>'blob:owned-'+n);
  await f.history().props.onPlay(f.recording);const first=f.player();await first.props.onRetry();
  assert.equal(f.player().props.src,'blob:owned-2');assert.deepEqual(f.revoked,['blob:owned-1']);
  f.render();f.render();assert.deepEqual(f.revoked,['blob:owned-1'],'Ordinary rerenders do not retire the active URL');
  f.h.cleanup();assert.deepEqual(f.revoked,['blob:owned-1','blob:owned-2']);
});
test('native Back closes history with one URL retirement and later unmount does not double-release',async()=>{
  const f=recordingOwnerFixture(()=> 'blob:back-owned');await f.history().props.onPlay(f.recording);f.player();
  assert.equal([...f.h.backs].at(-1)(),true);f.render();assert.equal(f.player(),undefined);
  assert.deepEqual(f.revoked,['blob:back-owned']);f.h.cleanup();assert.deepEqual(f.revoked,['blob:back-owned']);
});
test('out-of-order recording reads release the obsolete unpublished Blob without replacing the newer player',async t=>{
  const pending=[];const f=recordingOwnerFixture(()=>new Promise(resolve=>pending.push(resolve)));t.after(()=>f.h.cleanup());
  const oldRead=f.history().props.onPlay(f.recording),newRead=f.history().props.onPlay(f.recording);
  pending[1]('blob:published-new');await newRead;const current=f.player();pending[0]('blob:unpublished-old');await assert.rejects(oldRead,/已取消/);
  assert.equal(f.player().props.src,'blob:published-new');assert.equal(f.player().key,current.key);assert.deepEqual(f.revoked,['blob:unpublished-old']);
});
test('recording URL resolved after workspace unmount is retired without exposing a player or changing records',async()=>{
  let resolve;const f=recordingOwnerFixture(()=>new Promise(yes=>resolve=yes));const before=JSON.stringify(f.data);
  const reading=f.history().props.onPlay(f.recording);f.h.cleanup();resolve('blob:unmounted-read');await assert.rejects(reading,/已取消/);
  assert.deepEqual(f.revoked,['blob:unmounted-read']);assert.equal(JSON.stringify(f.data),before);
});
test('cloud recording URLs are never revoked on replacement, close or owner unmount',async()=>{
  const f=recordingOwnerFixture((r,n)=>'/api/recordings/'+r.id+'?read='+n);await f.history().props.onPlay(f.recording);await f.player().props.onRetry();f.close();f.h.cleanup();
  assert.deepEqual(f.revoked,[]);assert.equal(f.data.recordings.length,1);assert.equal(f.data.recordings[0],f.recording);
});
for(const closeBy of ['dialog','Back'])for(const outcome of ['success','failure'])test(`history retry pending then ${closeBy}: obsolete ${outcome} cannot reopen playback or issue a stale error`,async t=>{
  let resolve,reject;const f=recordingOwnerFixture((r,n)=>n===1?'blob:before-close':new Promise((yes,no)=>{resolve=yes;reject=no;}));t.after(()=>f.h.cleanup());
  await f.history().props.onPlay(f.recording);const old=f.player(),retry=old.props.onRetry();f.render();
  if(closeBy==='dialog')f.close();else{assert.equal([...f.h.backs].at(-1)(),true);f.render();}
  assert.equal(f.player(),undefined);const errors=f.h.messages.error.slice();assert.deepEqual(f.revoked,['blob:before-close']);
  if(outcome==='success'){resolve('blob:retry-after-close');await assert.rejects(retry,/已取消/);assert.deepEqual(f.revoked,['blob:before-close','blob:retry-after-close']);}
  else{reject(Error('obsolete repository failure'));await assert.rejects(retry,/obsolete repository failure/);assert.deepEqual(f.revoked,['blob:before-close']);}
  assert.equal(f.player(),undefined);assert.deepEqual(f.h.messages.error,errors);assert.equal(f.data.recordings[0],f.recording);assert.equal(f.requests.length,2);
});
for(const boundary of ['navigation','training-tab'])for(const outcome of ['success','failure'])test(`pending history read across ${boundary} leave-and-return rejects obsolete ${outcome} despite returning to the same page`,async t=>{
  let resolve,reject;const f=recordingOwnerFixture(()=>new Promise((yes,no)=>{resolve=yes;reject=no;}));t.after(()=>f.h.cleanup());const before=JSON.stringify(f.data);
  const oldRead=f.history().props.onPlay(f.recording);
  if(boundary==='navigation'){navigateApp(f.render,'today');f.render();navigateApp(f.render,'train');f.render();}
  else{nodes(f.render(),n=>n.type==='Tabs')[0].props.onValueChange('lr');f.render();nodes(f.render(),n=>n.type==='Tabs')[0].props.onValueChange('speaking');f.render();}
  assert.ok(f.history(),'Returned to the same current history surface');assert.equal(f.player(),undefined);const errors=f.h.messages.error.slice();
  if(outcome==='success'){resolve('blob:obsolete-'+boundary);await assert.rejects(oldRead,/已取消/);assert.deepEqual(f.revoked,['blob:obsolete-'+boundary]);}
  else{reject(Error('obsolete ABA read failure'));await assert.rejects(oldRead,/obsolete ABA read failure/);assert.deepEqual(f.revoked,[]);}
  assert.equal(f.player(),undefined);assert.deepEqual(f.h.messages.error,errors);assert.equal(JSON.stringify(f.data),before);assert.equal(f.requests.length,1);
});

for(const part of [1,5]) test(`daily Part ${part} task keeps its title after an answer and remount`,()=>{
  const model=load('lib/study-model.ts',{}),data=structuredClone(model.EMPTY_DATA),render=dailyApp(data),index=part===1?0:1;
  const original=dailySnapshot(render)[index];
  assert.ok(original.parts.includes(part),'The shipped action actually opens the recommended Part');
  assert.equal(original.done,false);
  data.attempts.push({id:randomUUID(),qid:`p${part}-01`,choice:0,correct:true,createdAt:new Date().toISOString(),seconds:12,mode:'first'});
  const after=dailySnapshot(render)[index];
  assert.equal(after.title,original.title,'Completing a task must not replace its visible title');
  assert.deepEqual(after.parts,original.parts,'Same-day answers must not recommend a different Part');
  assert.equal(after.done,true,'The actual UI marks this recommended task completed');
  const restarted=dailySnapshot(dailyApp(data))[index];
  assert.equal(restarted.title,original.title,'Restarting on the same day preserves the task');
  assert.deepEqual(restarted.parts,original.parts); assert.equal(restarted.done,true);
});

test('daily speaking task stays on the saved prompt rather than marking the next prompt done',()=>{
  const model=load('lib/study-model.ts',{}),data=structuredClone(model.EMPTY_DATA);
  const prompts=JSON.parse(fs.readFileSync(root+'/content/speaking.json','utf8')),render=dailyApp(data),original=dailySnapshot(render)[2];
  assert.equal(original.promptId,prompts[0].id); assert.equal(original.done,false);
  data.recordings.push({id:randomUUID(),promptId:prompts[0].id,title:prompts[0].title,createdAt:new Date().toISOString(),duration:10,mime:'audio/mp4'});
  const after=dailySnapshot(render)[2];
  assert.equal(after.title,original.title);assert.equal(after.promptId,original.promptId);assert.equal(after.done,true);
  assert.deepEqual(dailySnapshot(dailyApp(data))[2],after,'Same-day remount retains prompt and completed state');
});

test('practicing other Parts and prompts does not complete the recommended daily tasks',()=>{
  const model=load('lib/study-model.ts',{}),data=structuredClone(model.EMPTY_DATA);
  const prompts=JSON.parse(fs.readFileSync(root+'/content/speaking.json','utf8')),render=dailyApp(data),before=dailySnapshot(render);
  for(const part of [2,6])data.attempts.push({id:randomUUID(),qid:`p${part}-01`,choice:0,correct:true,createdAt:new Date().toISOString(),seconds:12,mode:'first'});
  data.recordings.push({id:randomUUID(),promptId:prompts[1].id,title:prompts[1].title,createdAt:new Date().toISOString(),duration:10,mime:'audio/mp4'});
  const after=dailySnapshot(render);assert.deepEqual(after,before);
  for(const task of after)assert.equal(task.done,false,'Unrelated tasks never receive the visible completion marker');
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
  assert.equal(model.dailyPlan(data, questions, prompts, '2026-09-19').recommendation.focusPart, null,'One error is insufficient evidence for a weakness');
  const evidenceQuestions=Array.from({length:10},(_,i)=>({id:'focus-'+i,part:1}));
  data.attempts=evidenceQuestions.map(q=>({id:randomUUID(),qid:q.id,choice:0,correct:false,createdAt:'2026-09-19T06:59:00Z',seconds:12,mode:'first'}));
  assert.equal(model.dailyPlan(data,[...questions,...evidenceQuestions],prompts,'2026-09-19').listeningPart,1,'Sufficient first-answer errors retain the focus Part');
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
  const open = nodes(tree,n=>n.type==='button'&&textOf(n)==='打开原图')[0];
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
  const StudyApp = createStudyApp(h);
  h.setRenderer(() => StudyApp({owner: null, nativeMode: true}));
  h.render(); await tick();
  let tree = h.render();
  navigateApp(()=>h.render(),'resources'); tree=h.render();
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

test('M1 access guidance keeps Web and native learning local', async () => {
  const createApp = h => createStudyApp(h);
  const openInstall = (h, StudyApp, owner, nativeMode) => {
    h.setRenderer(() => StudyApp({owner, nativeMode}));
    h.render();
    let tree = h.render();
    navigateApp(()=>h.render(),'profile');tree=h.render();
    nodes(tree,n=>n.type==='button'&&textOf(n)==='关于微光')[0].props.onClick();tree=h.render();
    const button=nodes(tree,n=>n.type==='button'&&textOf(n)==='设备与离线使用')[0];
    assert.ok(button,'Find the actual device-installation control');button.props.onClick();
    tree = h.render();
    return nodes(tree, n => n.type === 'Dialog' && n.props.open && textOf(n).includes(nativeMode ? '鸿蒙本机学习' : '鸿蒙桌面'))[0];
  };

  const web = environment();
  const webDialog = openInstall(web, createApp(web), 'alice', false);
  assert.match(textOf(webDialog), /HarmonyOS \/ 鸿蒙/);
  assert.doesNotMatch(textOf(webDialog), /Android|iPhone/);
  assert.match(textOf(webDialog), /当前账号使用本机数据/);assert.doesNotMatch(textOf(webDialog),/ChatGPT 账号/);
  assert.match(textOf(webDialog), /不自动上传/);assert.match(textOf(webDialog),/暂未启用跨设备同步/);

  const native = environment();
  const nativeDialog = openInstall(native, createApp(native), null, true);
  assert.match(textOf(nativeDialog), /本机模式/);
  const onlineLink = nodes(nativeDialog, n => n.type === 'a' && textOf(n).includes('打开网页版'))[0];
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
  assert.match(fs.readFileSync(root + '/docs/rfcs/0002-phone-auth-and-online-data.md', 'utf8'), /等待外部配置/);
});


test('native full exam opens in an isolated view with stable local scope and returns to training', () => {
  const model = load('lib/study-model.ts', {}), data = structuredClone(model.EMPTY_DATA);
  const render = dailyApp(data, {fullTree:true});
  navigateApp(render,'train');
  nodes(render(), n => n.type === 'button' && textOf(n).includes('完整听读模考'))[0].props.onClick();
  const tree = render(), exam = nodes(tree, n => n.type === 'MockExam')[0];
  assert.equal(exam.props.ownerId, 'harmony-local-device');
  assert.equal(nodes(tree, n => n.type === 'nav').length, 0, 'No surrounding navigation may silently unmount an active exam');
  exam.props.onClose();
  assert.equal(nodes(render(), n => n.type === 'MockExam').length, 0);
  assert.ok(nodes(render(), n => n.type === 'button' && textOf(n).includes('完整听读模考')).length);
});

// Append to tests/repo-review-regressions.test.cjs, reusing its existing
// environment(), tick(), and real useStudy hook loader. This is not standalone.
// Uses synthetic data only and does not require a browser or cloud endpoint.
for (const theme of ['hollow', 'silk', 'paper', 'crystal']) {
  test(`theme ${theme} survives the independent profile key, a theme switch and cold reload without losing records`, async () => {
    const h = environment();
    const original = structuredClone(h.model.EMPTY_DATA);
    original.profile = {...original.profile, name: 'Synthetic theme QA', theme: 'hollow'};
    original.attempts = [
      {id: randomUUID(), qid: 'p1-01', choice: 1, correct: false, createdAt: '2026-01-01T10:00:00.000Z', seconds: 12, mode: 'first'},
      {id: randomUUID(), qid: 'p1-01', choice: 0, correct: true, createdAt: '2026-01-02T10:00:00.000Z', seconds: 8, mode: 'review'},
    ];
    original.checkins = [{id: randomUUID(), date: '2026-01-01', minutes: 5, load: '轻', note: 'keep resource note', createdAt: '2026-01-01T10:00:00.000Z'}];
    original.recordings = [{id: randomUUID(), promptId: 'speaking-1', title: 'Synthetic recording', createdAt: '2026-01-01T10:00:00.000Z', duration: 7, mime: 'audio/webm', uploaded: true}];
    const key = 'lantern-v1-alice';
    h.storage.set(key, JSON.stringify({data: original}));
    h.storage.set(key + ':profile', JSON.stringify({...original.profile, theme}));
    h.setRenderer(() => h.useStudy('alice'));
    h.render(); await tick();
    let api = h.render();
    assert.equal(api.data.profile.theme, theme, 'standalone profile wins over stale snapshot');
    const selected = theme === 'crystal' ? 'paper' : 'crystal';
    assert.equal(api.saveProfile({...api.data.profile, theme: selected}), true);
    await tick();
    const reloaded = environment();
    for (const [key, value] of h.storage) reloaded.storage.set(key, value);
    reloaded.setRenderer(() => reloaded.useStudy('alice'));
    reloaded.render(); await tick();
    const result = reloaded.render().data;
    assert.equal(result.profile.theme, selected);
    for (const key of ['attempts', 'checkins', 'recordings', 'questionMarks', 'resourceTasks']) {
      assert.equal(JSON.stringify(result[key]), JSON.stringify(original[key]), key + ' must remain byte-equivalent');
    }
  });
}
