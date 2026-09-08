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
  }, Date, Intl, Map, Set, structuredClone, AbortController, FormData, crypto: { randomUUID }, ...globals }, { filename: file });
  return exports;
}
const model = load('lib/study-model.ts');
const base = () => JSON.parse(JSON.stringify(model.EMPTY_DATA));
const attempt = (id, createdAt, correct = true) => ({ id, qid: 'test-q', choice: correct ? 0 : 1, correct, createdAt, seconds: 4, mode: 'review' });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('record ids remain valid when a browser exposes getRandomValues without randomUUID',()=>{
 const fallback=load('lib/study-model.ts',{}, {crypto:{getRandomValues:array=>require('node:crypto').randomFillSync(array)}});
 const ids=Array.from({length:100},()=>fallback.createId());
 for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.equal(new Set(ids).size,100);
});

test('short sessions retain complete groups in source order and keep standalone tasks short', () => {
  const questions=JSON.parse(fs.readFileSync(root+'/content/questions.json','utf8'));
  const group=questions.filter(q=>q.part===3&&q.groupId===questions.find(x=>x.part===3).groupId);
  const last=group.at(-1);
  const attempts=[{...attempt('due-group','2026-01-01T10:00:00.000Z',false),qid:last.id}];
  assert.deepEqual(Array.from(model.chooseQuestions(questions,attempts,3,1),q=>q.id),group.map(q=>q.id));
  assert.equal(model.chooseQuestions(questions,[],2,1).length,1);
  assert.equal(model.chooseQuestions(questions,[],3,0).length,0);
});

test('reviewing one due item expands its full group without adding unrelated questions',()=>{
 const questions=JSON.parse(fs.readFileSync(root+'/content/questions.json','utf8'));
 const q=questions.find(q=>q.part===6&&q.groupId);const expected=questions.filter(x=>x.part===q.part&&x.groupId===q.groupId);
 assert.deepEqual(Array.from(model.expandQuestionGroups(questions,new Set([q.id])),x=>x.id),expected.map(x=>x.id));
 assert.equal(model.expandQuestionGroups(questions,new Set()).length,0);
});

// Small hook runner: executes the real hook, retaining React-like hook slots and
// effect cleanup across owner changes. It is a deterministic race harness, not a UI test.
function hookHarness(sharedStorage = new Map(), options = {}) {
  let slots = [], cursor = 0, effects = [], online = false, owner = 'alice';
  let latest;
  const requests = [];
  const timers=new Map();let timerId=0;
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
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    indexedDB:{open(){
      const request={};
      queueMicrotask(()=>{
        request.result={
          transaction(){
            const tx={objectStore(){return {
              get(key){const item={};queueMicrotask(()=>{item.result=options.audio?.get(key);item.onsuccess?.();tx.oncomplete?.();});return item;},
              put(blob,key){options.audio?.set(key,blob);queueMicrotask(()=>tx.oncomplete?.());}
            };}};
            return tx;
          },
          close(){}
        };
        request.onsuccess?.();
      });return request;
    }},
    window: {addEventListener:(event,fn)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);},removeEventListener:(event,fn)=>listeners.get(event)?.delete(fn)},
    fetch:async (url, init) => {
      if (!online) throw new Error('offline');
      requests.push({owner,url,headers:new Headers(init?.headers),body:typeof init?.body==='string'?JSON.parse(init.body):init?.body});
      if(options.handle){const custom=await options.handle(url,init,requests.at(-1));if(custom)return custom;}
      if (init?.method==='POST') return {ok:new Headers(init.headers).get('x-lantern-owner')===owner};
      return {ok:true,json:async()=>({...base(),owner,hasProfile:false,...options.remote})};
    }
  });
  function render(nextOwner = owner) { owner=nextOwner; cursor=0; latest=study.useStudy(owner); const pending=effects; effects=[]; for(const run of pending)run(); return latest; }
  async function pump(limit=50){let handled=0;await flush();while(sharedStorage.events.length&&handled<limit){const {receiver,event}=sharedStorage.events.shift();for(const fn of receiver.listeners.get('storage')||[])fn(event);handled++;await flush();}return {handled,pending:sharedStorage.events.length};}
  return {render,requests,timers,storage:sharedStorage,pump,setOnline(value){online=value;}};
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

test('one malformed metadata record cannot erase healthy snapshot data or its journal',async()=>{
 const data=base();data.attempts=[attempt('healthy','2026-09-07T10:00:00.000Z')];
 const storage=new Map([['lantern-v1-alice',JSON.stringify({data})],['lantern-v1-alice:profile','{broken'],['lantern-v1-alice:recording:bad','{broken'],['lantern-v1-alice:op:extra',JSON.stringify({id:'extra',owner:'alice',type:'attempt',data:attempt('journal','2026-09-07T10:00:00.000Z')})]]);
 const h=hookHarness(storage);h.render();await flush();assert.equal(h.render().data.attempts.length,2);assert.equal(storage.get('lantern-v1-alice:recording:bad'),'{broken','Leave malformed raw bytes available for recovery');
});

test('a native missing recording cannot fall through to a nonexistent cloud playback endpoint',async()=>{
 const h=hookHarness(new Map(),{audio:new Map()});const api=h.render(null);await flush();
 await assert.rejects(api.recordingUrl({id:'missing',uploaded:true}),/找不到这段本机录音/);
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

test('a rejected operation stays local and does not block later records or retry on focus', async () => {
  const h=hookHarness(new Map(),{handle:async(url,init,request)=>request.body?.type==='attempt'?{ok:false,status:400}:undefined});
  let api=h.render();await flush();api.addAttempt(attempt('bad-record','2026-09-07T10:00:00.000Z'));
  api.addCheckin({id:'good-checkin',date:'2026-09-07',minutes:5,load:'轻',note:'',createdAt:'2026-09-07T10:00:00.000Z'});
  h.setOnline(true);await api.syncNow();api=h.render();
  assert.equal(api.issues.length,1);assert.equal(api.issues[0].status,'blocked');
  const opId=api.issues[0].id;assert.ok(h.storage.get('lantern-v1-alice:op:'+opId));assert.equal(h.storage.has('lantern-v1-alice:ack:'+opId),false);
  assert.ok(h.requests.some(r=>r.body?.type==='checkin'));const before=h.requests.filter(r=>r.body?.type==='attempt').length;
  await api.syncNow();assert.equal(h.requests.filter(r=>r.body?.type==='attempt').length,before);
});

test('transient retries survive reload, respect backoff and stop after three attempts', async () => {
  const storage=new Map();const handle=async(url,init)=>init?.method==='POST'?{ok:false,status:503}:undefined;
  const h=hookHarness(storage,{handle});let api=h.render();await flush();api.addAttempt(attempt('retry-record','2026-09-07T10:00:00.000Z'));
  h.setOnline(true);await api.syncNow();let issue=h.render().issues[0];assert.equal(issue.attempts,1);
  await api.syncNow();assert.equal(h.requests.filter(r=>r.body?.type==='attempt').length,1);
  for(let n=2;n<=3;n++){storage.set('lantern-v1-alice:sync:op:'+issue.id,JSON.stringify({...issue,nextRetryAt:0}));await api.syncNow();issue=h.render().issues[0];assert.equal(issue.attempts,n);}
  assert.equal(issue.status,'blocked');const reloaded=hookHarness(storage,{handle});reloaded.setOnline(true);reloaded.render();await flush();await flush();
  assert.equal(reloaded.requests.filter(r=>r.body?.type==='attempt').length,0);
  api=h.render();api.retryIssue(issue);await flush();await flush();assert.equal(h.render().issues[0].attempts,1);
});

test('missing local audio stays visible while a valid recording uploads', async () => {
  const storage=new Map();const audio=new Map([['lantern-v1-alice:good-audio',new Blob(['sound'],{type:'audio/webm'})]]);
  const h=hookHarness(storage,{audio});h.render();await flush();
  for(const id of ['missing-audio','good-audio'])storage.set('lantern-v1-alice:recording:'+id,JSON.stringify({id,title:id,promptId:'test',createdAt:'2026-09-07T10:00:00.000Z',duration:2,uploaded:false}));
  h.setOnline(true);await h.render().syncNow();const api=h.render();
  assert.equal(h.requests.filter(r=>r.url==='/api/recordings').length,1);
  assert.ok(api.issues.some(x=>x.id==='missing-audio'&&x.status==='missing'));
  assert.equal(api.data.recordings.find(r=>r.id==='good-audio').uploaded,true);assert.notEqual(api.sync,'synced');
});

test('recording queued during remote refresh triggers another pass without another user event', async () => {
  let release,started;const entered=new Promise(resolve=>{started=resolve;});const waiting=new Promise(resolve=>{release=resolve;});let hold=true;
  const audio=new Map();const h=hookHarness(new Map(),{audio,handle:async(url,init)=>{if(!init?.method&&hold){hold=false;started();await waiting;}}});
  let api=h.render();await flush();h.setOnline(true);const pass=api.syncNow();await entered;
  await api.addRecording({id:'late-audio',title:'Late recording',promptId:'test',createdAt:'2026-09-07T10:00:00.000Z',duration:2,uploaded:false},new Blob(['sound'],{type:'audio/webm'}));
  release();await pass;api=h.render();assert.equal(api.data.recordings.find(r=>r.id==='late-audio').uploaded,true);
  assert.equal(h.requests.filter(r=>r.url==='/api/recordings').length,1);
});

test('remote audio acknowledgement repairs independent metadata and removes a missing-blob error', async () => {
  const rec={id:'remote-audio',title:'Remote recording',promptId:'test',createdAt:'2026-09-07T10:00:00.000Z',duration:2,uploaded:true};
  const storage=new Map([['lantern-v1-alice:recording:'+rec.id,JSON.stringify({...rec,uploaded:false})]]);
  const h=hookHarness(storage,{audio:new Map(),remote:{recordings:[rec]}});h.render();await flush();h.setOnline(true);await h.render().syncNow();
  assert.equal(JSON.parse(storage.get('lantern-v1-alice:recording:'+rec.id)).uploaded,true);assert.equal(h.render().issues.length,0);
  await h.render().syncNow();assert.equal(h.requests.filter(r=>r.url==='/api/recordings').length,0);
});

test('an account rejection stops later requests and cannot leak into the next account', async () => {
  const h=hookHarness(new Map(),{handle:async(url,init)=>init?.method==='POST'?{ok:false,status:409}:undefined});
  let api=h.render();await flush();api.addAttempt(attempt('a','2026-09-07T10:00:00.000Z'));api.addAttempt(attempt('b','2026-09-07T10:00:00.000Z'));
  h.setOnline(true);await api.syncNow();assert.equal(h.requests.filter(r=>r.body).length,1);assert.equal(h.render().issues[0].status,'auth');
  await api.syncNow();assert.equal(h.requests.filter(r=>r.body).length,1);
  h.render('bob');await flush();await flush();assert.equal(h.requests.filter(r=>r.owner==='bob'&&r.body).length,0);
});

test('late failure state for an acknowledged operation cannot keep polling or surface an error', async () => {
  const storage=new Map([['lantern-v1-alice:ack:done','1'],['lantern-v1-alice:sync:op:done',JSON.stringify({kind:'op',id:'done',status:'waiting',attempts:1,nextRetryAt:0,reason:'late failure'})]]);
  const h=hookHarness(storage);h.render();await flush();h.setOnline(true);await h.render().syncNow();
  assert.equal(h.render().issues.length,0);assert.equal(h.render().sync,'synced');
  assert.equal(h.timers.size,0,'An already acknowledged item must not schedule another pass');
});

test('the request timeout remains active while the GET response body is stalled', async () => {
  let started;const bodyStarted=new Promise(resolve=>{started=resolve;});
  const h=hookHarness(new Map(),{handle:async(url,init)=>({ok:true,json:()=>new Promise((resolve,reject)=>{started();init.signal.addEventListener('abort',()=>reject(Error('aborted')));})})});
  h.render();await flush();h.setOnline(true);const pass=h.render().syncNow();await bodyStarted;
  const timeout=[...h.timers.values()].find(t=>t.ms===25000);assert.ok(timeout,'Body parsing still has an abort timer');timeout.fn();await pass;
  assert.equal(h.render().issues[0].status,'waiting');assert.notEqual(h.render().sync,'loading');
});

test('very long Retry-After cannot overflow into a rapid timer', async () => {
  const h=hookHarness(new Map(),{handle:async(url,init)=>init?.method==='POST'?{ok:false,status:429,headers:new Headers({'Retry-After':'9000000'})}:undefined});
  const api=h.render();await flush();api.addAttempt(attempt('limited','2026-09-07T10:00:00.000Z'));h.setOnline(true);await api.syncNow();
  const timers=[...h.timers.values()];assert.equal(timers.length,1);assert.equal(timers[0].ms,2147483647);
});

test('invalid recording metadata and malformed multipart are permanent input failures', async () => {
  const route=load('app/api/recordings/route.ts',{
    'cloudflare:workers':{env:{}},'drizzle-orm':{eq(){},and(){}},'@/db':{getDb(){throw Error('Storage must not be reached');}},'@/db/schema':{recordings:{}},
    '@/lib/server-auth':{userId:async()=>'alice',safeMutation:()=>true,privateJson:(body,status=200)=>({body,status})},'@/content/speaking.json':{default:[]}
  },{File,Response});
  const headers=new Headers({'x-lantern-owner':'alice'});
  for(const metadata of ['null','[1]','{bad json']){
    const result=await route.POST({headers,formData:async()=>({get:()=>metadata})});assert.equal(result.status,400);
  }
  assert.equal((await route.POST({headers,formData:async()=>{throw new TypeError('bad multipart');}})).status,400);
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
    '@/lib/study-model':model,
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
    '@/lib/study-model':model,
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

// Append to tests/study-invariants.test.cjs after hookHarness has been defined.
// Uses shipped use-study.ts through the existing VM hook harness.
test('a late GET cannot roll back a newer profile already acknowledged by another tab', async () => {
  const data = base();
  data.profile.name = 'Older';
  const storage = new Map([
    ['lantern-v1-alice', JSON.stringify({data})],
    ['lantern-v1-alice:profile', JSON.stringify(data.profile)]
  ]);
  const server = {...base(), hasProfile: true, profile: {...data.profile}};
  let releaseOldRead, enteredOldRead;
  const waiting = new Promise(resolve => {releaseOldRead = resolve;});
  const entered = new Promise(resolve => {enteredOldRead = resolve;});
  let hold = true;
  const first = hookHarness(storage, {handle: async (url, init) => {
    if (!init?.method && hold) {
      hold = false;
      const captured = structuredClone(server);
      enteredOldRead();
      await waiting;
      return {ok: true, json: async () => ({...captured, owner: 'alice'})};
    }
    return {ok: true, json: async () => ({...server, owner: 'alice'})};
  }});
  const second = hookHarness(storage, {handle: async (url, init, request) => {
    if (init?.method === 'POST') {
      if (request.body.type === 'profile') server.profile = request.body.data;
      return {ok: true};
    }
    return {ok: true, json: async () => ({...server, owner: 'alice'})};
  }});
  first.render(); second.render(); await flush();
  first.setOnline(true);
  const staleRead = first.render().syncNow();
  await entered;
  // Leave storage-event delivery delayed, as it may be in a throttled tab.
  // Durable storage, not the first tab's stale React state, is the authority here.
  const secondApi = second.render();
  secondApi.saveProfile({...secondApi.data.profile, name: 'Newest', dailyMinutes: 45});
  second.setOnline(true);
  await second.render().syncNow();
  assert.equal(JSON.parse(storage.get('lantern-v1-alice:profile')).name, 'Newest');
  assert.equal(server.profile.name, 'Newest');
  const profileOps = [...storage.entries()]
    .filter(([key]) => key.startsWith('lantern-v1-alice:op:'))
    .map(([, raw]) => JSON.parse(raw))
    .filter(op => op.type === 'profile');
  assert.ok(profileOps.length > 0);
  assert.ok(profileOps.every(op => storage.has('lantern-v1-alice:ack:' + op.id)),
    'No pending profile operation remains to protect the latest setting');
  releaseOldRead();
  await staleRead;
  assert.equal(JSON.parse(storage.get('lantern-v1-alice:profile')).name, 'Newest');
  assert.equal(first.render().data.profile.name, 'Newest');
  assert.equal(first.render().data.profile.dailyMinutes, 45);
  assert.equal(server.profile.name, 'Newest');
  assert.equal(first.requests.length, 1,
    'Ignoring one stale profile should not create an additional GET or upload');
  assert.equal(first.timers.size, 0,
    'Profile freshness protection alone must not create a polling loop');
});
