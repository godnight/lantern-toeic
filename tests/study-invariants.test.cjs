const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = process.env.LANTERN_REVIEW_ROOT || require('node:path').resolve(__dirname, '..');
const ts = require(root + '/node_modules/typescript');

// Transpile and run the actual source. No model implementation is copied here.
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(root + '/' + file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  vm.runInNewContext(code, { exports, require: n => {
    if (!(n in imports)) throw new Error('Unexpected import: ' + n);
    return imports[n];
  }, Date, Intl, Map, Set, structuredClone, crypto: { randomUUID }, ...globals }, { filename: file });
  return exports;
}
const model = load('lib/study-model.ts');
const base = () => JSON.parse(JSON.stringify(model.EMPTY_DATA));
const attempt = (id, createdAt, correct = true) => ({ id, qid: 'test-q', choice: correct ? 0 : 1, correct, createdAt, seconds: 4, mode: 'review' });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('short sessions retain complete groups in source order and keep standalone tasks short', () => {
  const questions=JSON.parse(fs.readFileSync(root+'/content/questions.json','utf8'));
  const group=questions.filter(q=>q.part===3&&q.groupId===questions.find(x=>x.part===3).groupId);
  const last=group.at(-1);
  const attempts=[{...attempt('due-group','2026-01-01T10:00:00.000Z',false),qid:last.id}];
  assert.deepEqual(Array.from(model.chooseQuestions(questions,attempts,3,1),q=>q.id),group.map(q=>q.id));
  assert.equal(model.chooseQuestions(questions,[],2,1).length,1);
  assert.equal(model.chooseQuestions(questions,[],3,0).length,0);
});

// Small hook runner: executes the real hook, retaining React-like hook slots and
// effect cleanup across owner changes. It is a deterministic race harness, not a UI test.
function hookHarness(sharedStorage = new Map(), options = {}) {
  let slots = [], cursor = 0, effects = [], online = false, owner = 'alice';
  let latest;
  const requests = [];
  const listeners = new Map();
  const subscriber = {listeners};
  sharedStorage.subscribers ||= [];
  sharedStorage.events ||= [];
  sharedStorage.subscribers.push(subscriber);
  const localStorage = {
    get length(){return sharedStorage.size;},
    key:i=>[...sharedStorage.keys()][i] ?? null,
    getItem:k=>sharedStorage.get(k)??null,
    setItem:(k,v)=>{
      v=String(v); const oldValue=sharedStorage.get(k)??null;
      if(oldValue===v)return;
      sharedStorage.set(k,v);
      for(const receiver of sharedStorage.subscribers){if(receiver!==subscriber)sharedStorage.events.push({receiver,event:{key:k,oldValue,newValue:v}});}
    },
    removeItem:k=>sharedStorage.delete(k)
  };
  const same = (a,b) => a && b && a.length === b.length && a.every((v,i) => Object.is(v,b[i]));
  const react = {
    useState(initial) { const i=cursor++; if (!(i in slots)) slots[i]=typeof initial==='function'?initial():initial; return [slots[i], value => slots[i] = typeof value==='function'?value(slots[i]):value]; },
    useRef(initial) { const i=cursor++; if (!(i in slots)) slots[i]={current:initial}; return slots[i]; },
    useCallback(fn, deps) { const i=cursor++; if (!slots[i] || !same(slots[i].deps,deps)) slots[i]={value:fn,deps}; return slots[i].value; },
    useEffect(fn,deps) { const i=cursor++; if (!slots[i] || !same(slots[i].deps,deps)) { const old=slots[i]; slots[i]={deps}; effects.push(()=>{old?.cleanup?.(); slots[i].cleanup=fn();}); } }
  };
  const navigator = {get onLine(){return online;}};
  const study = load('lib/use-study.ts', {react, sonner: {toast:{error(){}}}, './study-model':model}, {
    navigator,
    localStorage,
    window: {addEventListener:(event,fn)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);},removeEventListener:(event,fn)=>listeners.get(event)?.delete(fn)},
    fetch:async (url, init) => {
      if (!online) throw new Error('offline');
      requests.push({owner,url,headers:new Headers(init?.headers),body:init?.body && JSON.parse(init.body)});
      if (init?.method==='POST') return {ok:new Headers(init.headers).get('x-lantern-owner')===owner};
      return {ok:true,json:async()=>({...base(),owner,hasProfile:false,...options.remote})};
    }
  });
  function render(nextOwner = owner) { owner=nextOwner; cursor=0; latest=study.useStudy(owner); const pending=effects; effects=[]; for(const run of pending)run(); return latest; }
  async function pump(limit=50){let handled=0;await flush();while(sharedStorage.events.length&&handled<limit){const {receiver,event}=sharedStorage.events.shift();for(const fn of receiver.listeners.get('storage')||[])fn(event);handled++;await flush();}return {handled,pending:sharedStorage.events.length};}
  return {render,requests,storage:sharedStorage,pump,setOnline(value){online=value;}};
}

test('chronologically first answer survives reverse delivery and merge', () => {
  const local=base(), remote=base();
  local.attempts=[attempt('later','2026-09-07T10:01:00.000Z',true)];
  remote.attempts=[attempt('first','2026-09-07T10:00:00.000Z',false)];
  const selected=model.firstAttempts(model.mergeData(local,remote).attempts);
  assert.equal(selected.length,1);
  assert.equal(selected[0].id,'first');
  assert.equal(selected[0].correct,false);
});

test('switching account never uploads another account pending operations', async () => {
  const h=hookHarness();
  let api=h.render('alice'); await flush();
  api.addAttempt(attempt(randomUUID(),'2026-09-07T10:00:00.000Z')); await flush();
  h.setOnline(true);
  h.render('bob'); await flush(); await flush();
  const leaks=h.requests.filter(r=>r.owner==='bob' && r.body?.type==='attempt');
  assert.equal(leaks.length,0,'Alice pending attempt must not be POSTed under Bob session');
});

test('two offline tabs preserve both pending attempts after reload', async () => {
  const storage=new Map();
  const first=hookHarness(storage), second=hookHarness(storage);
  const a=first.render('alice'), b=second.render('alice'); await flush();
  a.addAttempt(attempt('tab-a','2026-09-07T10:00:00.000Z')); await flush();
  b.addAttempt(attempt('tab-b','2026-09-07T10:01:00.000Z')); await flush();
  const reloaded=hookHarness(storage); reloaded.render('alice'); await flush();
  const data=reloaded.render('alice').data;
  assert.deepEqual([...data.attempts.map(x=>x.id)].sort(),['tab-a','tab-b']);
});

test('storage events converge when two tabs share a synchronized attempt', async () => {
  const storage=new Map();
  const original={...attempt('synchronized-q','2026-09-07T10:00:00.000Z'),mode:'first'};
  // A second device can already have submitted this question: the API corrects
  // the local 'first' label to 'review'. Both copies represent the same attempt.
  const remote={attempts:[{...original,mode:'review'}]};
  const first=hookHarness(storage,{remote}), second=hookHarness(storage,{remote});
  const api=first.render('alice'); second.render('alice'); await flush();
  api.addAttempt(original); await flush();
  first.setOnline(true);second.setOnline(true);
  await first.render().syncNow();
  await second.render().syncNow();
  const convergence=await first.pump(80);
  assert.equal(convergence.pending,0,'Storage events must settle, not alternate journal and server snapshots forever');
  assert.ok(first.requests.length+second.requests.length<30,'One change must not trigger an unbounded GET sync loop');
});

test('immediate repetitions do not count as spaced retrieval successes', () => {
  const initial=Date.parse('2026-09-07T10:00:00.000Z');
  const attempts=Array.from({length:5},(_,i)=>attempt(String(i),new Date(initial+i*10000).toISOString()));
  const schedule=model.reviewSchedule(attempts,initial+50000)[0];
  assert.ok(schedule.due <= initial + 2*86400000,'Five answers in 40 seconds must not postpone review for 30 days');
});

test('uploading an offline recording retains the date the practice occurred', async () => {
  let stored;
  const prompts=JSON.parse(fs.readFileSync(root+'/content/speaking.json','utf8'));
  const auth={userId:async()=>'alice',safeMutation:()=>true,privateJson:(body,status=200)=>({body,status})};
  const route=load('app/api/recordings/route.ts',{
    'cloudflare:workers':{env:{BUCKET:{put:async()=>{}}}},
    'drizzle-orm':{eq(){},and(){}},
    '@/db':{getDb:()=>({insert:()=>({values:row=>({onConflictDoNothing:async()=>{stored=row;}})})})},
    '@/db/schema':{recordings:{}},
    '@/lib/server-auth':auth,
    '@/content/speaking.json':{default:prompts}
  },{File,Response});
  const meta={id:randomUUID(),promptId:prompts[0].id,duration:20,createdAt:'2026-09-01T12:00:00.000Z'};
  const file=new File(['audio data'],'sample.webm',{type:'audio/webm'});
  const result=await route.POST({headers:new Headers({'x-lantern-owner':'alice'}),formData:async()=>({get:key=>key==='audio'?file:JSON.stringify(meta)})});
  assert.equal(result.status,200);
  assert.equal(JSON.parse(stored.body).createdAt,meta.createdAt,'Sync day must not replace original recording date');
});

test('an earlier recording save cannot mark the current recording as saved', async () => {
  let slots=[],cursor=0,effects=[];
  const deferred=[];
  const react={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},
    useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((x,j)=>!Object.is(x,slots[i].deps[j]))){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}
  };
  class Recorder {
    static isTypeSupported(){return true;}
    constructor(){this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['sample audio'],{type:'audio/webm'})});void this.onstop?.();}
  }
  const jsx=(type,props)=>({type,props});
  const stub=new Proxy({},{get:(_,name)=>String(name)});
  const Room=load('app/learn/speaking.tsx',{
    react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':stub,
    '@/components/ui/dialog':stub,'@/components/ui/checkbox':stub,
    sonner:{toast:Object.assign(()=>{},{error(){},success(){}})},'./practice':stub,'@/lib/native-host':load('lib/native-host.ts')
  },{Blob,URL,MediaRecorder:Recorder,window:{MediaRecorder:Recorder},document:{hidden:false,addEventListener(){},removeEventListener(){}},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}},setInterval:()=>1,clearInterval(){}}).default;
  const prompt=JSON.parse(fs.readFileSync(root+'/content/speaking.json','utf8'))[0];
  function render(){cursor=0;const tree=Room({prompt,onClose(){},onFinish(){},onSave:()=>new Promise(resolve=>deferred.push(resolve))});const pending=effects;effects=[];pending.forEach(fn=>fn());return tree;}
  function textOf(node){if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(textOf).join('');return textOf(node.props?.children);}
  function button(tree,label){const nodes=[tree];while(nodes.length){const node=nodes.shift();if(!node)continue;if(Array.isArray(node)){nodes.push(...node);continue;}if(node.type==='button'&&textOf(node).includes(label))return node;nodes.push(node.props?.children);}throw Error('Missing button '+label);}
  await button(render(),'开始准备').props.onClick();
  button(render(),'准备好了').props.onClick();
  button(render(),'结束录音').props.onClick();
  assert.equal(deferred.length,1);
  const repeat=button(render(),'再说一次');
  if(repeat.props.disabled){deferred[0]();await flush();return;}
  await repeat.props.onClick();
  button(render(),'准备好了').props.onClick();
  button(render(),'结束录音').props.onClick();
  assert.equal(deferred.length,2);
  deferred[0]();await flush();
  assert.equal(button(render(),'记录收获').props.disabled,true,'Recording 2 is still saving; recording 1 completion must not enable Finish');
  deferred[1]();await flush();
});


test('background recording stop preserves elapsed time and pending save completion', async () => {
  let slots=[],cursor=0,effects=[],stopTask,saveComplete;
  const startTime=Date.parse('2026-09-07T10:00:00.000Z');
  let clock=startTime;
  const saved=[];
  class ClockDate extends Date { static now(){return clock;} }
  const react={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},
    useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((x,j)=>!Object.is(x,slots[i].deps[j]))){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}
  };
  class Recorder {
    static isTypeSupported(){return true;}
    constructor(){this.state='inactive';this.mimeType='audio/webm';}
    start(){this.state='recording';}
    // Browsers enqueue data/stop events; suspension can delay their delivery.
    stop(){this.state='inactive';stopTask=()=>{this.ondataavailable?.({data:new Blob(['sample audio'],{type:'audio/webm'})});return this.onstop?.();};}
  }
  const document={hidden:false,addEventListener(type,fn){if(type==='visibilitychange')this.onVisibility=fn;},removeEventListener(){}};
  const jsx=(type,props)=>({type,props});
  const stub=new Proxy({},{get:(_,name)=>String(name)});
  const Room=load('app/learn/speaking.tsx',{
    react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':stub,
    '@/components/ui/dialog':stub,'@/components/ui/checkbox':stub,
    sonner:{toast:Object.assign(()=>{},{error(){},success(){}})},'./practice':stub,'@/lib/native-host':load('lib/native-host.ts')
  },{Date:ClockDate,Blob,URL,MediaRecorder:Recorder,window:{MediaRecorder:Recorder},document,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}},setInterval:()=>1,clearInterval(){}}).default;
  const prompt=JSON.parse(fs.readFileSync(root+'/content/speaking.json','utf8'))[0];
  function render(){cursor=0;const tree=Room({prompt,onClose(){},onFinish(){},onSave:meta=>{saved.push(meta);return new Promise(resolve=>saveComplete=resolve);}});const pending=effects;effects=[];pending.forEach(fn=>fn());return tree;}
  function textOf(node){if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(textOf).join('');return textOf(node.props?.children);}
  function button(tree,label){const nodes=[tree];while(nodes.length){const node=nodes.shift();if(!node)continue;if(Array.isArray(node)){nodes.push(...node);continue;}if(node.type==='button'&&textOf(node).includes(label))return node;nodes.push(node.props?.children);}throw Error('Missing button '+label);}
  await button(render(),'开始准备').props.onClick();
  button(render(),'准备好了').props.onClick();render();
  clock=startTime+5000;document.hidden=true;document.onVisibility();
  clock=startTime+305000;const persisted=stopTask();
  assert.equal(saved[0].duration,5,'Suspended time after stop must not inflate the clip or exceed the upload limit');
  assert.equal(saved[0].createdAt,new Date(startTime).toISOString(),'Clip must retain its recording start time');
  assert.equal(button(render(),'记录收获').props.disabled,true);
  document.hidden=false;document.onVisibility();
  document.hidden=true;document.onVisibility();
  saveComplete();await persisted;
  assert.equal(button(render(),'记录收获').props.disabled,false,'Hiding an already completed recording must not invalidate its pending save');
});
