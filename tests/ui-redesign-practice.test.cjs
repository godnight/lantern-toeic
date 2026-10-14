// Executes shipped Practice TSX and study-model; React hooks, widgets, clock and Native Back
// are simulated. No browser, learner storage, media, API or device acceptance is claimed.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));

function load(file, imports, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file==='app/learn/practice.tsx' && process.env.LANTERN_PRACTICE_COMPONENT ? process.env.LANTERN_PRACTICE_COMPONENT : path.join(root, file), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}
  }).outputText;
  vm.runInNewContext(code, {exports, require(name) {
    assert.ok(name in imports, 'Unexpected import: ' + name);
    return imports[name];
  }, Date, Map, Set, crypto: webcrypto, ...globals}, {filename: file});
  return exports;
}

function nodes(tree, predicate) {
  const found = [], todo = [tree];
  while (todo.length) {
    const node = todo.shift();
    if (node == null || typeof node === 'boolean') continue;
    if (Array.isArray(node)) {todo.push(...node); continue;}
    if (typeof node === 'object') {
      // Closed widget portals are not rendered. Do not mistake their controls for visible UI.
      if (node.type === 'Dialog' && node.props.open === false) continue;
      if (predicate(node)) found.push(node);
      todo.push(node.props?.children);
    }
  }
  return found;
}
function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props?.children);
}

function harness({attempts = [], outcomes = [true], queue, browser, lookup = false, durable} = {}) {
  let now = Date.parse('2026-10-13T09:00:00Z'), slots = [], cursor = 0, effects = [], tree;
  let closed = 0; const finishes = [], calls = [], saved = [], lookups = [], backs = new Map();
  class Clock extends Date {
    constructor(...args) {super(...(args.length ? args : [now]));}
    static now() {return now;}
  }
  const model = load('lib/study-model.ts', {}, {Date: Clock});
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => slots[i] = typeof value === 'function' ? value(slots[i]) : value];},
    useRef(initial) {const i = cursor++; if (!(i in slots)) slots[i] = {current: initial}; return slots[i];},
    useEffect(fn, deps) {const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) {const old = slots[i]; slots[i] = {deps,setup:fn}; effects.push(() => {old?.cleanup?.(); slots[i].cleanup = fn();});}}
  };
  const jsx = (type, props, key) => ({type, props, key});
  const stubs = new Proxy({}, {get: (_, name) => String(name)});
  const imports = {
    react, 'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'fragment'}, 'lucide-react': stubs,
    sonner: {toast: {error(){}}}, '@/lib/study-model': model,
    '@/lib/lesson-audio': {bundledLessonAudio: () => null, createBundledPlayback: () => null},
    '@/lib/native-host': {registerNativeBack(fn, priority) {backs.set(priority, fn); return () => backs.delete(priority);}}
  };
  for (const widget of ['dialog', 'tabs', 'radio-group', 'select', 'progress']) imports['@/components/ui/' + widget] = stubs;
  const Practice = load('app/learn/practice.tsx', imports, {Date: Clock, window: browser?.window || {speechSynthesis: {cancel(){}}},setTimeout:browser?.setTimeout || setTimeout,clearTimeout:browser?.clearTimeout || clearTimeout}).default;
  const questions = queue || [
    {id:'review-fixture-one', part:1, title:'Original picture', prompt:'Which scene is described?', options:['A fixture answer','B fixture answer','C fixture answer','D fixture answer'], correctIndex:1, explanation:'Original explanation fixture', evidence:'Evidence fixture', skill:'图片信息', difficulty:'起步', image:'/review-fixture-picture.svg', transcript:'The woman is opening a box.'},
    {id:'review-fixture-two', part:7, title:'Original reading', prompt:'When will the work start?', options:['At eight.','At nine.','At ten.','At noon.'], correctIndex:0, explanation:'Second explanation fixture', evidence:'At eight.', skill:'阅读依据', difficulty:'起步', passage:'Original long material fixture. '.repeat(30)}
  ];
  const props = {queue: questions, attempts, durable, lookupActive:false, onLookup:lookup?term=>{lookups.push(term);props.lookupActive=true;}:undefined, onAttempt(a) {calls.push(structuredClone(a)); const ok = outcomes[Math.min(calls.length - 1, outcomes.length - 1)]; if (ok) saved.push(structuredClone(a)); return ok;}, onClose(){closed++;}, onFinish(minutes){finishes.push(minutes);}};
  const render = () => {cursor = 0; tree = Practice(props); const pending = effects; effects = []; pending.forEach(fn => fn()); return tree;};
  const one = predicate => {const matches = nodes(tree, predicate); assert.equal(matches.length, 1, 'Expected exactly one matching control'); return matches[0];};
  const button = label => one(n => n.type === 'button' && (n.props['aria-label'] === label || textOf(n) === label));
  const click = label => {const control = button(label); assert.ok(!control.props.disabled, 'Disabled control: ' + label); control.props.onClick(); return render();};
  const choose = value => {const radio = one(n => n.type === 'RadioGroup'); assert.ok(!radio.props.disabled); radio.props.onValueChange(String(value)); return render();};
  const nativeBack = () => {assert.deepEqual([...backs.keys()], [10]); assert.equal(backs.get(10)(), true); return render();};
  render();
  return {render, one, button, click, choose, nativeBack, durable(value){props.durable=value;return render();}, calls, saved, finishes, lookups, lookupActive(value){props.lookupActive=value;return render();}, nativeResult(){const handled=backs.get(10)();render();return handled;}, strictReplay(){const active=slots.filter(slot=>slot?.setup);active.forEach(slot=>{slot.cleanup?.();slot.cleanup=undefined;});active.forEach(slot=>{slot.cleanup=slot.setup();});return render();}, get tree(){return tree;}, get closed(){return closed;}, advance(ms){now += ms;}, dismissMain(){one(n => n.type === 'Dialog' && n.props.open && nodes(n, x => x.props?.className === 'practice-dialog').length).props.onOpenChange(false); return render();}, unmount(){slots.forEach(slot => slot?.cleanup?.()); assert.equal(backs.size, 0);}};
}

test('failed save retains the same answer and attempt identity; retry gates feedback and next question', () => {
  const h = harness({outcomes:[false,false,true]}); h.advance(12000); h.choose(1); h.click('确认答案');
  const original = h.calls[0];
  assert.equal(h.one(n => n.type === 'RadioGroup').props.value, '1');
  assert.equal(h.one(n => n.type === 'Progress').props.value, 0);
  assert.match(textOf(h.one(n => n.props?.role === 'alert')), /待保存 B/);
  assert.equal(nodes(h.tree, n => n.props?.className === 'answer-feedback').length, 0);
  assert.equal(nodes(h.tree, n => n.type === 'button' && textOf(n) === '下一题').length, 0);
  assert.equal(h.saved.length, 0);
  h.advance(30000); h.click('重试保存答案'); h.advance(50000); h.click('重试保存答案');
  assert.deepEqual(h.calls, [original, original, original], 'Retry must reuse id, occurrence time, choice and elapsed time');
  assert.equal(h.saved.length, 1);
  assert.equal(h.one(n => n.type === 'RadioGroup').props.disabled, true);
  assert.equal(h.one(n => n.type === 'Progress').props.value, 50);
  assert.match(textOf(h.one(n => n.props?.className === 'answer-feedback')), /判断正确/);
  h.click('下一题');
  assert.match(textOf(h.one(n => n.type === 'DialogDescription')), /已提交 1 题/);
  assert.equal(h.one(n => n.type === 'RadioGroup').props.value, ''); h.unmount();
});

test('changing an unsaved answer discards only that draft, then creates a fresh attempt', () => {
  const h = harness({outcomes:[false,true]}); h.choose(1); h.click('确认答案'); const failed = h.calls[0];
  h.advance(4000); h.choose(0);
  assert.equal(nodes(h.tree, n => n.props?.role === 'alert').length, 0);
  h.click('确认答案');
  assert.notEqual(h.calls[1].id, failed.id); assert.equal(h.calls[1].choice, 0);
  assert.equal(h.calls[1].correct, false); assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].id, h.calls[1].id); assert.equal(h.one(n => n.type === 'Progress').props.value, 50); h.unmount();
});

test('submitted count and score advance once per saved question, preserving first versus review mode', () => {
  const prior = {id:'prior',qid:'review-fixture-one',choice:0,correct:false,createdAt:'2026-10-12T08:00:00Z',seconds:10,mode:'first'};
  const attempts = [prior], h = harness({attempts}); h.choose(1); h.click('确认答案');
  assert.equal(h.calls[0].mode, 'review'); h.click('下一题'); h.choose(1); h.click('确认答案');
  assert.equal(h.calls[1].mode, 'first');
  assert.equal(h.one(n => n.type === 'Progress').props.value, 100);
  assert.match(textOf(h.one(n => n.type === 'DialogDescription')), /已提交 2 题/);
  h.click('完成本组');
  assert.match(textOf(h.one(n => n.props?.className === 'session-complete')), /1 \/ 2 题/);
  assert.equal(h.calls.length, 2); assert.deepEqual(attempts, [prior]);
  assert.equal(h.finishes.length, 0, 'Finishing questions must not invent a checkin'); h.unmount();
});

test('Dialog close and Native Back use the exit guard without advancing or losing an unsaved choice', () => {
  const h = harness({outcomes:[false]}); h.choose(1); h.click('确认答案'); h.dismissMain();
  assert.equal(h.closed, 0); assert.match(textOf(h.tree), /先结束这组练习/);
  h.click('继续练习'); h.nativeBack(); assert.equal(h.closed, 0);
  h.nativeBack();
  assert.equal(nodes(h.tree, n => n.type === 'DialogTitle' && textOf(n) === '先结束这组练习？').length, 0);
  assert.equal(h.one(n => n.type === 'RadioGroup').props.value, '1');
  assert.equal(h.one(n => n.type === 'Progress').props.value, 0); assert.equal(h.calls.length, 1); h.unmount();
});

test('Native Back closes the enlarged picture before opening exit confirmation', () => {
  const h = harness(); h.choose(2); h.click('放大本题配图');
  assert.equal(nodes(h.tree, n => n.props?.className === 'practice-image-dialog').length, 1);
  h.nativeBack(); assert.equal(h.closed, 0);
  assert.equal(nodes(h.tree, n => n.props?.className === 'practice-image-dialog').length, 0);
  assert.equal(nodes(h.tree, n => n.type === 'DialogTitle' && textOf(n) === '先结束这组练习？').length, 0);
  assert.equal(h.one(n => n.type === 'RadioGroup').props.value, '2');
  h.nativeBack(); h.click('结束并返回'); assert.equal(h.closed, 1);
  assert.equal(h.calls.length, 0); assert.equal(h.finishes.length, 0); h.unmount();
});

test('explicit exit after a failed save preserves only durable answers and creates no learning time', () => {
  const h = harness({outcomes:[true,false]}); h.choose(1); h.click('确认答案'); h.click('下一题'); h.choose(0); h.click('确认答案');
  h.dismissMain(); h.click('结束并返回'); assert.equal(h.closed, 1);
  assert.equal(h.saved.length, 1); assert.equal(h.saved[0].qid, 'review-fixture-one');
  assert.equal(h.calls.length, 2); assert.equal(h.finishes.length, 0); h.unmount();
});

test('learning-time handoff happens only through the explicit completed-session action', () => {
  const h = harness(); h.choose(1); h.click('确认答案'); h.click('下一题'); h.choose(0); h.click('确认答案'); h.click('完成本组');
  h.advance(120000); h.click('记录时间与收获'); assert.deepEqual(h.finishes, [2]);
  assert.equal(h.saved.length, 2); assert.equal(h.closed, 0); h.unmount();
});

test('dictation remains post-save feedback and does not create a second question attempt', () => {
  const h = harness(); h.choose(1); h.click('确认答案');
  const textarea = h.one(n => n.type === 'textarea' && n.props['aria-label'] === '听写答案');
  textarea.props.onChange({target:{value:'the woman is opening a box'}}); h.render(); h.click('核对听写');
  assert.match(textOf(h.tree), /听写正确/); assert.equal(h.calls.length, 1); assert.equal(h.finishes.length, 0); h.unmount();
});

test('picture and long passage use the material/response layout without changing question content', () => {
  const h = harness();
  assert.match(h.one(n => n.props?.className?.startsWith('question-scroll')).props.className, /practice-with-material/);
  h.choose(1); h.click('确认答案'); h.click('下一题');
  const passage = h.one(n => n.props?.className === 'passage'); assert.equal(passage.props.lang, 'en');
  assert.equal(textOf(passage), 'Original long material fixture. '.repeat(30));
  assert.equal(nodes(h.tree, n => n.props?.className === 'practice-response').length, 1); h.unmount();
});

// History adapter deliberately queues navigation after cleanup timers, matching
// history.back() asynchronous traversal; widgets/ReactDOM are still simulated.
function browserHarness(initial={lanternWorkspaceView:'search',lanternVocabularyView:{token:'fixture-detail',view:'detail'}}) {
  let stateIndex=1,timerId=0,pushCalls=0,backCalls=0;const entries=[{lanternWorkspaceView:'resources'},structuredClone(initial)];
  const listeners=[],timers=new Map(),navigation=[],dispatched=[];
  const document={getElementById:()=>({focus(){}}),createElement:()=>({click(){}})};
  const window={scrollY:380,speechSynthesis:{cancel(){}},matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),
    scrollTo(x,y){this.scrollY=typeof x==='object'?x.top:y;},
    addEventListener(type,fn,capture=false){listeners.push({type,fn,capture:!!capture});},
    removeEventListener(type,fn){const index=listeners.findIndex(item=>item.type===type&&item.fn===fn);if(index>=0)listeners.splice(index,1);},
    history:{get state(){return entries[stateIndex];},pushState(state){pushCalls++;entries.splice(stateIndex+1);entries.push(structuredClone(state));stateIndex++;},
      replaceState(state){entries[stateIndex]=structuredClone(state);},back(){backCalls++;navigation.push(()=>{if(!stateIndex)return;stateIndex--;dispatch('popstate',{state:structuredClone(entries[stateIndex])});});}}
  };
  function dispatch(type,values={}) {let stopped=false;const event={...values,stopImmediatePropagation(){stopped=true;},preventDefault(){}};
    for(const item of [...listeners].filter(item=>item.type===type).sort((a,b)=>Number(b.capture)-Number(a.capture))){item.fn(event);if(stopped)break;}dispatched.push({type,state:event.state,stopped});event.wasStopped=stopped;return event;}
  const b={window,document,dispatch,setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    flushTimers(){const batch=[...timers.values()];timers.clear();batch.forEach(fn=>fn());},
    flushHistory(){let count=0;while(navigation.length){assert.ok(++count<30,'History traversal did not settle');navigation.shift()();}},
    flush(){this.flushTimers();this.flushHistory();},get pushCalls(){return pushCalls;},get backCalls(){return backCalls;},get depth(){return entries.length;},get index(){return stateIndex;},get popListeners(){return listeners.filter(item=>item.type==='popstate').length;},dispatched};
  return b;
}

test('StrictMode replay retains one Practice entry and never opens an exit confirmation on mount',()=>{
  const browser=browserHarness(),h=harness({browser});const token=browser.window.history.state.lanternPracticeView;
  assert.ok(token);h.strictReplay();browser.flush();h.render();
  assert.equal(browser.pushCalls,1);assert.equal(browser.backCalls,0);assert.equal(browser.popListeners,1);
  assert.equal(browser.window.history.state.lanternPracticeView,token);
  assert.equal(nodes(h.tree,n=>n.type==='DialogTitle'&&textOf(n)==='先结束这组练习？').length,0);
  assert.equal(h.closed,0);assert.equal(h.calls.length,0);h.unmount();browser.flush();
  assert.equal(browser.backCalls,1);assert.equal(browser.window.history.state.lanternPracticeView,undefined);assert.equal(browser.window.history.state.lanternVocabularyView.token,'fixture-detail');
});

test('StrictMode replay followed by immediate final unmount releases the owned history entry exactly once',()=>{
  const browser=browserHarness(),h=harness({browser});h.strictReplay();h.unmount();
  assert.equal(browser.backCalls,0,'Traversal waits until cleanup can distinguish replay from final unmount');browser.flush();
  assert.equal(browser.backCalls,1,'Multiple delayed replay/final cleanups must not issue two asynchronous traversals');
  assert.equal(browser.window.history.state.lanternWorkspaceView,'search');
  assert.equal(browser.window.history.state.lanternVocabularyView.token,'fixture-detail');assert.equal(browser.popListeners,0);
  assert.equal(h.closed,0);assert.equal(h.calls.length,0);assert.equal(h.finishes.length,0);
});

test('Browser Back closes picture then exit confirmation while retaining the same failed choice and history token',()=>{
  const browser=browserHarness(),h=harness({browser,outcomes:[false]});h.choose(1);h.click('确认答案');h.click('放大本题配图');
  const token=browser.window.history.state.lanternPracticeView;let bubblePops=0;
  browser.window.addEventListener('popstate',()=>bubblePops++);
  browser.window.history.back();browser.flushHistory();h.render();
  assert.equal(nodes(h.tree,n=>n.props?.className==='practice-image-dialog').length,0);
  assert.equal(nodes(h.tree,n=>n.type==='DialogTitle'&&textOf(n)==='先结束这组练习？').length,0);
  assert.equal(browser.window.history.state.lanternPracticeView,token);assert.equal(bubblePops,0);
  browser.window.history.back();browser.flushHistory();h.render();assert.match(textOf(h.tree),/先结束这组练习/);assert.equal(h.closed,0);
  browser.window.history.back();browser.flushHistory();h.render();
  assert.equal(nodes(h.tree,n=>n.type==='DialogTitle'&&textOf(n)==='先结束这组练习？').length,0);
  assert.equal(h.one(n=>n.type==='RadioGroup').props.value,'1');assert.equal(h.one(n=>n.type==='Progress').props.value,0);
  assert.equal(h.saved.length,0);assert.equal(h.calls.length,1);assert.equal(h.finishes.length,0);assert.equal(bubblePops,0);
  h.unmount();browser.flush();assert.equal(browser.window.history.state.lanternVocabularyView.token,'fixture-detail');assert.equal(browser.popListeners,1);
});

test('final Practice cleanup cannot traverse a replacement destination that no longer owns its token',()=>{
  const browser=browserHarness(),h=harness({browser});h.unmount();
  browser.window.history.replaceState({lanternWorkspaceView:'settings'});browser.flush();
  assert.equal(browser.backCalls,0);assert.equal(browser.window.history.state.lanternWorkspaceView,'settings');assert.equal(browser.popListeners,0);
});

// Execute actual VocabularyLibrary with its own hook slots and the shared queued
// history surface. No lookup/mark/grade/storage/network writes are permitted here.
function vocabularyHistoryHarness(browser) {
  let slots=[],cursor=0,effects=[],tree,blocked=false,backHandler,questionId;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
  const hooks={useId(){const i=cursor++;if(!(i in slots))slots[i]='qa-practice-words-'+i;return slots[i];},useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},
    useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useMemo(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn(),deps};return slots[i].value;},
    useDeferredValue:value=>value,
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
  const study=load('lib/study-model.ts',{}),vocab=load('lib/vocabulary-model.ts',{'./study-model':study}),dict=load('lib/dictionary-model.ts',{'./vocabulary-model':vocab});
  const jsx=(type,props)=>({type,props}),stubs=new Proxy({},{get:(_,name)=>String(name)});
  const imports={react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':stubs,sonner:{toast:{success(){},error(){}}},
    '@/lib/native-host':{registerNativeBack:fn=>{backHandler=fn;return()=>{backHandler=null;};}},'@/lib/vocabulary-model':vocab,'@/lib/dictionary-model':dict,
    '@/lib/lesson-audio':{bundledLessonAudio:()=>null},'./practice':{SpeechPlayer:'SpeechPlayer'},
    '@/lib/load-dictionary':{loadDictionary(){throw Error('Scene fixture must not fetch dictionary');}},
    '@/lib/use-vocabulary':{useVocabulary:()=>({events:[],ready:true,error:'',sync:'fixture-only',mark(){throw Error('No mark writes');},review(){throw Error('No review writes');}})}};
  for(const name of ['vocabulary','vocabulary-expansion','questions','dictionary-metadata'])imports['@/content/'+name+'.json']={default:JSON.parse(fs.readFileSync(path.join(root,'content',name+'.json'),'utf8'))};
  imports['./interactive-example']=load('app/learn/interactive-example.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'}});
  const component=load('app/learn/vocabulary-library.tsx',imports,{window:browser.window,document:browser.document,requestAnimationFrame:fn=>fn(),setInterval:()=>1,clearInterval(){},setTimeout:browser.setTimeout,clearTimeout:browser.clearTimeout}).default;
  function render(){for(let i=0;i<2;i++){cursor=0;tree=component({owner:null,initialMode:'learn',overlayBlocked:blocked,onQuestion:id=>{questionId=id;}});const batch=effects;effects=[];batch.forEach(fn=>fn());}return tree;}
  render();
  return {render,get tree(){return tree;},get questionId(){return questionId;},back:()=>backHandler(),block(value){blocked=value;render();},
    search(value){nodes(tree,n=>n.type==='input'&&n.props.type==='search')[0].props.onChange({target:{value}});render();},
    open(word){const button=nodes(tree,n=>n.props?.className==='word-open'&&textOf(n).startsWith(word))[0];assert.ok(button);button.props.onClick();render();},
    question(){const button=nodes(tree,n=>n.type==='button'&&textOf(n).startsWith('Part '))[0];assert.ok(button);button.props.onClick();},
    unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}

test('actual word detail survives Practice StrictMode, guarded Browser/Native/Escape and final return before list restoration',()=>{
  const browser=browserHarness({lanternWorkspaceView:'search'}),words=vocabularyHistoryHarness(browser);
  words.search('timetable');words.open('timetable');const detailToken=browser.window.history.state.lanternVocabularyView.token;
  assert.match(textOf(words.tree),/返回结果/);words.question();assert.ok(words.questionId);
  const all=JSON.parse(fs.readFileSync(path.join(root,'content/questions.json'),'utf8')),model=load('lib/study-model.ts',{});
  words.block(true);const practice=harness({browser,queue:model.expandQuestionGroups(all,new Set([words.questionId])),outcomes:[false]});
  practice.strictReplay();browser.flush();practice.render();
  assert.equal(nodes(practice.tree,n=>n.type==='DialogTitle'&&textOf(n)==='先结束这组练习？').length,0);
  assert.equal(words.back(),false,'Higher-priority word handler must defer to foreground Practice');practice.nativeBack();practice.click('继续练习');
  const escape=browser.dispatch('keydown',{key:'Escape'});assert.equal(escape.wasStopped,false,'Word capture must not consume Escape while Practice owns the overlay');
  practice.dismissMain();practice.click('继续练习');
  browser.window.history.back();browser.flushHistory();practice.render();words.render();assert.match(textOf(practice.tree),/先结束这组练习/);
  assert.equal(nodes(words.tree,n=>n.props?.['data-vocabulary-detail']==='true').length,1);assert.equal(practice.closed,0);
  practice.click('结束并返回');assert.equal(practice.closed,1);practice.unmount();words.block(false);browser.flush();words.render();
  assert.equal(browser.window.history.state.lanternPracticeView,undefined);assert.equal(browser.window.history.state.lanternVocabularyView.token,detailToken);
  assert.equal(nodes(words.tree,n=>n.props?.['data-vocabulary-detail']==='true').length,1);assert.equal(nodes(words.tree,n=>n.type==='input'&&n.props.type==='search').length,0);
  assert.equal(practice.calls.length,0);assert.equal(practice.finishes.length,0);
  assert.equal(words.back(),true);browser.flushHistory();words.render();
  assert.equal(nodes(words.tree,n=>n.props?.['data-vocabulary-detail']==='true').length,0);
  assert.equal(nodes(words.tree,n=>n.type==='input'&&n.props.type==='search')[0].props.value,'timetable');words.unmount();
});


function lookupQuestions() {
  return [
    {id:'lookup-fixture-one',part:3,prompt:'Which detail is correct?',options:['A original','B original','C original','D original'],correctIndex:1,
      explanation:'Original lookup explanation',evidence:'The reservation is confirmed.',skill:'细节依据',difficulty:'起步',image:'/lookup-fixture-original.svg',
      passage:'Unchanged source material for lookup return.',transcript:'The reservation is confirmed.',vocabulary:[{word:'reservation',meaning:'预约',example:'Please confirm the reservation.'}]},
    {id:'lookup-fixture-two',part:5,prompt:'Second original question',options:['A','B','C','D'],correctIndex:0,explanation:'Second original explanation',evidence:'A',skill:'语法',difficulty:'起步'}
  ];
}

test('I09: lookup is absent before a durable answer and after save failure, then sends only the submitted expression',()=>{
  const h=harness({queue:lookupQuestions(),lookup:true,outcomes:[false,true]});
  assert.equal(nodes(h.tree,n=>n.type==='button'&&n.props['aria-label']==='查词 reservation').length,0);
  h.choose(1);h.click('确认答案');assert.equal(h.saved.length,0);
  assert.equal(nodes(h.tree,n=>n.type==='button'&&n.props['aria-label']==='查词 reservation').length,0);
  assert.deepEqual(h.lookups,[]);h.click('重试保存答案');h.click('查词 reservation');
  assert.deepEqual(h.lookups,['reservation']);assert.equal(h.saved.length,1);assert.equal(h.calls.length,2);
  assert.equal(h.one(n=>n.type==='RadioGroup').props.disabled,true);assert.equal(h.closed,0);assert.equal(h.finishes.length,0);h.unmount();
});

test('I09: controlled lookup leaves Practice mounted with identical question, answer, material, dictation and image state on return',()=>{
  const questions=lookupQuestions(),original=structuredClone(questions),h=harness({queue:questions,lookup:true});
  h.choose(1);h.click('确认答案');const answer=structuredClone(h.saved[0]);
  h.one(n=>n.type==='textarea'&&n.props['aria-label']==='听写答案').props.onChange({target:{value:'the reservation is confirmed'}});h.render();h.click('核对听写');
  const main=h.one(n=>n.props?.className==='question-scroll practice-with-material');
  assert.equal(main.key,'lookup-fixture-one');
  h.click('查词 reservation');h.dismissMain();assert.equal(h.closed,0);
  assert.equal(nodes(h.tree,n=>n.type==='DialogTitle'&&textOf(n)==='先结束这组练习？').length,0);
  assert.equal(h.nativeResult(),false,'Nested dictionary owns Native Back while active');
  assert.equal(h.one(n=>n.props?.className==='question-scroll practice-with-material').key,main.key);
  assert.equal(nodes(h.tree,n=>n.type==='Dialog'&&n.props.open).length,1,'Main Practice remains open');
  h.lookupActive(false);
  assert.equal(h.one(n=>n.type==='RadioGroup').props.value,'1');assert.equal(h.one(n=>n.type==='Progress').props.value,50);
  assert.equal(h.one(n=>n.type==='textarea'&&n.props['aria-label']==='听写答案').props.value,'the reservation is confirmed');
  assert.match(textOf(h.tree),/听写正确/);assert.equal(textOf(h.one(n=>n.props?.className==='passage')),original[0].passage);
  assert.equal(h.one(n=>n.props?.className==='question-image').props.src,original[0].image);
  assert.deepEqual(h.saved,[answer]);assert.deepEqual(questions,original);assert.equal(h.calls.length,1);assert.equal(h.finishes.length,0);
  h.click('放大本题配图');h.nativeBack();assert.equal(nodes(h.tree,n=>n.props?.className==='practice-image-dialog').length,0);
  h.click('下一题');assert.match(textOf(h.tree),/2 \/ 2 · 已提交 1 题/);h.unmount();
});

test('I09: Practice history capture yields during nested lookup and resumes its original guard after controlled return',()=>{
  const browser=browserHarness(),h=harness({queue:lookupQuestions(),lookup:true,browser});h.choose(1);h.click('确认答案');
  const token=browser.window.history.state.lanternPracticeView;
  h.click('查词 reservation');browser.window.history.pushState({...browser.window.history.state,lanternNestedLookup:'test-only'},'');
  const pushes=browser.pushCalls;let parentReturns=0;browser.window.addEventListener('popstate',()=>parentReturns++);
  browser.window.history.back();browser.flushHistory();h.render();
  assert.equal(parentReturns,1,'Root/dictionary return handler receives the nested traversal');assert.equal(browser.pushCalls,pushes);
  assert.equal(browser.window.history.state.lanternPracticeView,token);assert.equal(h.closed,0);
  assert.equal(nodes(h.tree,n=>n.type==='DialogTitle'&&textOf(n)==='先结束这组练习？').length,0);
  h.lookupActive(false);browser.window.history.back();browser.flushHistory();h.render();
  assert.equal(parentReturns,1,'Practice regains capture ownership after lookup return');assert.match(textOf(h.tree),/先结束这组练习/);
  assert.equal(h.one(n=>n.type==='RadioGroup').props.value,'1');assert.equal(h.saved.length,1);assert.equal(h.calls.length,1);
  h.click('继续练习');h.unmount();browser.flush();
});

test('I09: repeated lookup does not advance the question or create attempts/checkins while lookup is active',()=>{
  const h=harness({queue:lookupQuestions(),lookup:true});h.choose(1);h.click('确认答案');
  const staleNext=h.button('下一题');h.click('查词 reservation');
  staleNext.props.onClick();h.render();assert.deepEqual(h.lookups,['reservation']);
  assert.match(textOf(h.one(n=>n.type==='DialogDescription')),/1 \/ 2 · 已提交 1 题/);
  assert.equal(h.button('查词 reservation').props.disabled,true);assert.equal(h.calls.length,1);assert.equal(h.finishes.length,0);
  h.lookupActive(false);h.click('查词 reservation');assert.deepEqual(h.lookups,['reservation','reservation']);
  assert.equal(h.saved.length,1);h.unmount();
});


test('durable feedback stays hidden until confirmed, then a failed cursor write retains the saved answer',async()=>{
 const submissions=[],advances=[];
 const state={cursor:0,choice:null,submitted:false,finished:false,correct:0,busy:false,submit:async(choice,seconds)=>{submissions.push({choice,seconds});return false;},next:async()=>{advances.push(0);return false;}};
 const h=harness({durable:state});h.choose(1);h.click('确认答案');await new Promise(resolve=>setImmediate(resolve));h.render();
 assert.equal(submissions.length,1);assert.equal(nodes(h.tree,n=>n.props?.className==='answer-feedback').length,0);assert.equal(h.calls.length,0);
 h.durable({...state,choice:1});assert.equal(h.one(n=>n.type==='RadioGroup').props.disabled,true);assert.equal(h.one(n=>n.type==='RadioGroup').props.value,'1');
 h.durable({...state,choice:1,submitted:true,correct:1});assert.equal(nodes(h.tree,n=>n.props?.className==='answer-feedback').length,1);
 h.click('下一题');await new Promise(resolve=>setImmediate(resolve));h.render();assert.equal(advances.length,1);assert.match(textOf(h.tree),/下一步尚未保存/);assert.equal(h.one(n=>n.type==='RadioGroup').props.value,'1');
 h.unmount();
});

test('an already-visible durable session whose legacy reference becomes unverified fails closed and Native Back returns',()=>{
 const state={cursor:0,choice:1,submitted:true,finished:false,correct:1,busy:false,submit:async()=>true,next:async()=>true};
 const h=harness({durable:state});assert.equal(nodes(h.tree,n=>n.props?.className==='answer-feedback').length,1);
 h.durable({...state,submitted:false,blocked:'Legacy reference missing'});assert.match(textOf(h.tree),/这组记录还需要核对/);assert.equal(nodes(h.tree,n=>n.props?.className==='answer-feedback').length,0);
 h.nativeBack();assert.equal(h.closed,1);assert.equal(h.calls.length,0);assert.equal(h.finishes.length,0);h.unmount();
});
