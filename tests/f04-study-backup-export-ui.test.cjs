'use strict';

// Run with LANTERN_REVIEW_ROOT=<site> node --test <this file>.
// Actual StudyWorkspace + study-backup/model + pure navigation components execute.
// Browser I/O, useStudy and unrelated business children are explicitly simulated.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');

assert.ok(process.env.LANTERN_REVIEW_ROOT, 'Set LANTERN_REVIEW_ROOT to the exact site under test.');
const root = path.resolve(process.env.LANTERN_REVIEW_ROOT);
const ts = require(path.join(root, 'node_modules/typescript'));
const genericError = '备份暂时无法生成，当前记录未改。';
const successMessage = '学习记录备份已生成，请确认文件已保存。';
const entries = [
  {name:'resources', label:'导出听读与口语记录', route:['资料']},
  {name:'backups', label:'导出学习记录', route:['外观与偏好','管理备份']},
];

function load(file, imports = {}, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions:{
    module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX,
  }}).outputText;
  vm.runInNewContext(code, {exports, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import in ${file}: ${name}`);
    return imports[name];
  }, Date, Intl, Map, Set, structuredClone, crypto:{randomUUID}, Blob, URL,
  URLSearchParams, AbortController, ...globals}, {filename:file});
  return exports;
}

const model = load('lib/study-model.ts');
const backup = load('lib/study-backup.ts', {
  './study-model':model, zod:require(path.join(root,'node_modules/zod')),
});
const plain = value => JSON.parse(JSON.stringify(value));
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function fixture(kind = 'valid') {
  const data = structuredClone(model.EMPTY_DATA);
  Object.assign(data.profile, {name:'F04 synthetic learner', examDate:'2026-10-31', onboarded:true});
  data.attempts.push({id:'10000000-0000-4000-8000-000000000001',qid:'synthetic-q',choice:0,
    correct:true,createdAt:'2026-10-15T10:00:00.000Z',seconds:8,mode:'first'});
  data.checkins.push({id:'20000000-0000-4000-8000-000000000002',date:'2026-10-15',
    minutes:5,load:'刚好',note:'synthetic note',createdAt:'2026-10-15T10:01:00.000Z'});
  data.recordings.push({id:'30000000-0000-4000-8000-000000000003',promptId:'synthetic-p',
    title:'metadata only',createdAt:'2026-10-15T10:02:00.000Z',duration:0.12,mime:'audio/webm',uploaded:false});
  if (kind === 'profile') data.profile.examDate = '2026-02-30';
  if (kind === 'checkin') data.checkins[0].date = '2026-02-30';
  return deepFreeze(data);
}
function nodes(tree, predicate) {
  const queue = [tree], result = [];
  while (queue.length) {
    const node = queue.shift();
    if (!node) continue;
    if (Array.isArray(node)) {queue.push(...node);continue;}
    if (typeof node === 'object') {
      if (predicate(node)) result.push(node);
      queue.push(node.props?.children);
    }
  }
  return result;
}
function textOf(value) {
  if (value == null || typeof value === 'boolean') return '';
  if (Array.isArray(value)) return value.map(textOf).join('');
  return typeof value === 'object' ? textOf(value.props?.children) : String(value);
}

function workspace(data, {failDownload = false} = {}) {
  let slots = [], cursor = 0, effects = [], tree, sequence = 0;
  const same = (a,b) => a && b && a.length === b.length && a.every((v,i)=>Object.is(v,b[i]));
  const react = {
    useState(initial) {const i=cursor++;if (!(i in slots)) slots[i]=typeof initial==='function'?initial():initial;
      return [slots[i], value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useRef(initial) {const i=cursor++;if (!(i in slots)) slots[i]={current:initial};return slots[i];},
    useCallback(fn,deps) {const i=cursor++;if (!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn,deps};return slots[i].value;},
    useEffect(fn,deps) {const i=cursor++;if (!slots[i]||!same(slots[i].deps,deps)) {
      const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}},
  };
  const messages = {success:[],error:[]}, events = [], downloads = [], blobs = new Map();
  const storage = new Map([['f04-synthetic-study', JSON.stringify({data})],['f04-unrelated','keep-exact']]);
  const before = {data:JSON.stringify(data), storage:JSON.stringify([...storage])};
  const localStorage = {
    getItem:key=>storage.get(key)??null, key:i=>[...storage.keys()][i]??null,
    get length(){return storage.size;},
    setItem(key,value){events.push(['storage-write',key]);storage.set(key,String(value));},
    removeItem(key){events.push(['storage-remove',key]);storage.delete(key);},
    clear(){events.push(['storage-clear']);storage.clear();},
  };
  const toast = Object.assign(()=>{}, {
    success:message=>messages.success.push(message), error:message=>messages.error.push(message),
    message:message=>messages.error.push(message),
  });
  class SyntheticURL extends URL {
    static createObjectURL(blob) {
      events.push(['create-object-url']);
      if (failDownload) throw Error('synthetic download failure');
      const url=`blob:f04-synthetic-${++sequence}`;blobs.set(url,blob);return url;
    }
    static revokeObjectURL(url){events.push(['revoke-object-url',url]);}
  }
  const document = {
    documentElement:{dataset:{},style:{setProperty(){}}},body:{dataset:{},style:{}},hidden:false,
    querySelector:()=>null,querySelectorAll:()=>[],
    createElement(tag) {
      assert.equal(tag,'a','Only the real saveFile download anchor is permitted.');
      return {href:'',download:'',click(){downloads.push({name:this.download,blob:blobs.get(this.href)});}};
    },
  };
  const browser = {document,localStorage,URL:SyntheticURL,
    window:{location:{search:'',origin:'https://f04.invalid'},scrollY:0,
      history:{state:null,pushState(value){this.state=value;},replaceState(value){this.state=value;}},
      addEventListener(){},removeEventListener(){},scrollTo(){}},
    navigator:{onLine:false},setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},
    requestAnimationFrame:fn=>fn(),HTMLElement:class {},fetch(){throw Error('No network allowed in F04 synthetic UI tests');},
  };
  const pure = new Set(), jsx = (type,props,key)=>pure.has(type)?type(props):({type,props,key});
  const runtime = {jsx,jsxs:jsx,Fragment:'fragment'};
  const stubs = new Proxy({}, {get:(_,name)=>String(name)});
  const theme = load('lib/ui-theme.ts', {}, browser);
  const themeUi = load('app/learn/ui-theme.tsx', {
    'react/jsx-runtime':runtime,'lucide-react':stubs,'@/lib/ui-theme':theme,
  }, browser);
  Object.values(themeUi).filter(value=>typeof value==='function').forEach(value=>pure.add(value));
  const shell = load('app/learn/workspace-shell.tsx', {
    'react/jsx-runtime':runtime,'lucide-react':stubs,'./ui-theme':themeUi,
  }, browser);
  Object.values(shell).filter(value=>typeof value==='function').forEach(value=>pure.add(value));
  const mutation = name => (...args)=>{events.push(['study-mutation',name,args]);throw Error(`Unexpected study mutation: ${name}`);};
  const api = {data,ready:true,recordsReadable:true,sync:'local',issues:[],remoteReadState:'confirmed',
    profileSetup:'confirmed',timezoneSource:'profile',
    ...Object.fromEntries(['syncNow','recheckSession','retryIssue','skipProfileSetup','saveProfile','saveTheme',
      'addAttempt','addCheckin','addRecording'].map(name=>[name,mutation(name)])),
    readAttempt:async()=>null,readCheckin:async()=>null,recordingUrl:async()=>{throw Error('No recording reads allowed');},
  };
  const imports = {
    react,'react/jsx-runtime':runtime,'lucide-react':stubs,sonner:{toast},
    '@/lib/use-study':{useStudy:()=>api},'@/lib/study-model':model,'@/lib/study-backup':backup,
    '@/lib/native-host':{registerNativeBack:()=>()=>{}},'@/lib/ui-theme':theme,
    '@/lib/speaking-recovery':{getSpeakingRecovery:()=>null,hasSpeakingRecovery:()=>false,
      retainSpeakingRecovery(){},releaseSpeakingRecovery(){},subscribeSpeakingRecovery:()=>()=>{}},
    '@/lib/account-boundary':load('lib/account-boundary.ts'),
    '@/lib/use-product-session':{useProductSession:()=>({status:'ready',recheck(){}})},
    '@/lib/lesson-audio':{stopLessonAudio(){}},
    './learn/workspace-shell':shell,'./learn/ui-theme':themeUi,
    './learn/exam-collection':{default:'ExamCollection'},'./learn/resource-library':{default:'ResourceLibrary'},
    './learn/practice':{default:'Practice'},'./learn/speaking':{default:'SpeakingRoom',
      SpeakingTaskCatalog:'SpeakingTaskCatalog',SpeakingRecordingHistory:'SpeakingRecordingHistory'},
    './learn/vocabulary-library':{default:'VocabularyLibrary',VocabularyEntry:'VocabularyEntry',VocabularyReviewSummary:'VocabularyReviewSummary'},
    './learn/mock-exam':{default:'MockExam'},
    './learn/account-center':{FirstVisit:'FirstVisit',AccountCenter:'AccountCenter',SaveAndSync:'SaveAndSync',AboutProject:'AboutProject'},
  };
  for (const file of ['content/questions.json','content/speaking.json','public/build-identity.json','release-manifest.json']) {
    imports['@/'+file]={default:JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))};
  }
  for (const name of ['dialog','tabs','select','radio-group','progress','sonner'])imports['@/components/ui/'+name]=stubs;
  const selection=load('lib/practice-selection.ts',{'./study-model':model},browser);
  Object.assign(imports,require(path.join(root,'tests/helpers/phase2-shell-fixture.cjs')).workflowShellFixture(react,selection));
  const app=load('app/study-app.tsx',imports,browser);
  function render(){cursor=0;tree=app.StudyWorkspace({owner:null,nativeMode:true});const pending=effects;effects=[];pending.forEach(run=>run());return tree;}
  function button(label){const found=nodes(tree,node=>node.type==='button'&&textOf(node)===label)[0];assert.ok(found,`Missing real UI button: ${label}`);return found;}
  function preserved(){assert.equal(JSON.stringify(data),before.data,'Input study data changed.');
    assert.equal(JSON.stringify([...storage]),before.storage,'Synthetic storage changed.');
    assert.equal(events.some(([event])=>event.startsWith('storage-')||event==='study-mutation'),false,'Export invoked a persistence mutation.');}
  render();render();
  return {messages,events,downloads,button,render,preserved,
    async click(label){const selected=button(label);assert.notEqual(selected.props.disabled,true,`${label} unexpectedly disabled`);
      assert.equal(typeof selected.props.onClick,'function',`${label} is not wired`);await selected.props.onClick();render();},
    async open(entry){for(const label of entry.route)await this.click(label);button(entry.label);},
  };
}

for (const entry of entries) {
  test(`F04 ${entry.name}: valid export is strict-readable, successful, and read-only`,async()=>{
    const data=fixture(),ui=workspace(data);await ui.open(entry);await ui.click(entry.label);
    assert.equal(ui.downloads.length,1);assert.equal(ui.downloads[0].name,'lantern-my-study-records.json');
    const raw=await ui.downloads[0].blob.text(),decoded=JSON.parse(raw);
    assert.equal(decoded.audioIncluded,false);assert.equal(decoded.version,'2.0.0');
    assert.ok(Number.isFinite(Date.parse(decoded.exportedAt)),'Export must retain an ISO timestamp.');
    assert.deepEqual(plain(backup.parseStudyBackup(raw)),plain(data),'The actual strict reader must accept all exported study facts.');
    assert.deepEqual(ui.messages.success,[successMessage]);assert.deepEqual(ui.messages.error,[]);ui.preserved();
  });
  for (const kind of ['profile','checkin']) {
    test(`F04 ${entry.name}: legacy invalid ${kind} date shows its specific error and never downloads`,async()=>{
      const data=fixture(kind),ui=workspace(data);await ui.open(entry);
      await assert.doesNotReject(()=>ui.click(entry.label),'UI must catch date errors rather than leak an event-handler exception.');
      assert.equal(ui.downloads.length,0,'Invalid dates must not generate a backup download.');
      assert.equal(ui.events.some(([event])=>event==='create-object-url'),false,'saveFile was reached for invalid data.');
      assert.deepEqual(ui.messages.success,[]);assert.equal(ui.messages.error.length,1);
      assert.equal(typeof backup.StudyBackupDateError,'function','Actual backup module must expose the typed date error.');
      let expected;try{backup.createStudyBackup(data);}catch(error){expected=error;}
      assert.ok(expected instanceof backup.StudyBackupDateError,'Actual backup module must reject the invalid date.');
      assert.ok(expected.message&&expected.message!==genericError,'Date error must be specific.');
      assert.equal(ui.messages.error[0],expected.message,'UI must surface the actual typed date error message.');ui.preserved();
    });
  }
  test(`F04 ${entry.name}: generic download failure keeps the existing fallback and never reports success`,async()=>{
    const data=fixture(),ui=workspace(data,{failDownload:true});await ui.open(entry);
    await assert.doesNotReject(()=>ui.click(entry.label));
    assert.equal(ui.events.filter(([event])=>event==='create-object-url').length,1,'Real saveFile path must be exercised.');
    assert.equal(ui.downloads.length,0);assert.deepEqual(ui.messages.success,[]);
    assert.deepEqual(ui.messages.error,[genericError]);ui.preserved();
  });
}
