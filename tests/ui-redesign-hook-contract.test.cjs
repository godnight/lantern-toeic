// Contract probes for UI integration. Real hook/model/theme modules execute against
// private in-memory fixtures; this does not alter learner storage or add a hook signal.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const tick = () => new Promise(resolve => setImmediate(resolve));
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports,require(name){if(!Object.hasOwn(imports,name))return require('./helpers/actual-source-loader.cjs').createSourceLoader({root,imports,globals:globals}).resolve(name,file);return imports[name];},Date,Map,Set,structuredClone,crypto:webcrypto,Blob,URL,AbortController,...globals}, {filename:file});
  return exports;
}
const model = load('lib/study-model.ts');
const backup = load('lib/study-backup.ts', {'./study-model':model,zod:require(path.join(root,'node_modules/zod'))});

function hookHarness(storage = new Map(), {online = false} = {}) {
  let slots = [], cursor = 0, effects = [], owner = 'alice';
  const errors = [], writes = [], listeners = new Map();
  const same = (a,b) => a && b && a.length===b.length && a.every((v,i)=>Object.is(v,b[i]));
  const react = {
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},
    useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useCallback(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn,deps};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}
  };
  const localStorage = {get length(){return storage.size;},key:i=>[...storage.keys()][i]??null,getItem:key=>storage.get(key)??null,setItem(key,value){writes.push(key);storage.set(key,String(value));},removeItem:key=>storage.delete(key)};
  const hook = load('lib/use-study.ts', {react,sonner:{toast:{error:message=>errors.push(message)}},'./study-model':model,'./study-backup':backup}, {
    localStorage,navigator:{onLine:online},window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},
    setTimeout:()=>1,clearTimeout(){},fetch:async()=>({ok:true,json:async()=>({...structuredClone(model.EMPTY_DATA),owner,hasProfile:true})})
  });
  const render = (nextOwner=owner) => {owner=nextOwner;cursor=0;const value=hook.useStudy(owner);const batch=effects;effects=[];batch.forEach(fn=>fn());return value;};
  return {render,storage,writes,errors,unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
const issue = {id:'rejected-fixture',kind:'op',status:'blocked',attempts:3,nextRetryAt:0,reason:'Fixture upload rejected'};

test('new users get paper while every explicit persisted theme survives migration unchanged', () => {
  assert.equal(model.DEFAULT_PROFILE.theme, 'paper');
  assert.equal(model.migrateStudyData(null).profile.theme, 'paper');
  for (const theme of ['paper','crystal','hollow','silk']) {
    const original=structuredClone(model.EMPTY_DATA);original.profile={...original.profile,name:'Existing learner fixture',theme};
    assert.equal(model.migrateStudyData(original).profile.theme,theme);
    assert.equal(original.profile.theme,theme);
  }
});

test('document theme projection uses existing persisted IDs and changes only html/body appearance', () => {
  const html={dataset:{},style:{}},body={dataset:{},style:{}};
  const themes=load('lib/ui-theme.ts', {}, {document:{documentElement:html,body},localStorage:{getItem(){throw Error('Theme projection must not read storage');},setItem(){throw Error('Theme projection must not persist');}}});
  for (const [persisted,display] of Object.entries({paper:'day',crystal:'night',hollow:'hollow',silk:'silk'})) {
    themes.applyDocumentTheme(persisted);
    assert.equal(html.dataset.uiTheme,display);assert.equal(body.dataset.uiTheme,display);
    assert.equal(html.style.colorScheme,persisted==='paper'?'light':'dark');
    assert.equal(body.style.colorScheme,html.style.colorScheme);
  }
});

test('local future-schema read failure finishes ready but exposes blocked sync without a session issue', () => {
  const original=JSON.stringify({data:model.EMPTY_DATA});
  const storage=new Map([['lantern-v1-alice',original],['lantern-v1-alice:required-schema',JSON.stringify({schemaVersion:999})]]);
  const h=hookHarness(storage);h.render();const api=h.render();
  assert.equal(api.ready,true);assert.equal(api.sync,'blocked');assert.equal(api.issues.length,0);
  assert.equal(api.recordsReadable,false,'Readable must reflect the existing private readOnly guard');
  assert.equal(api.addAttempt({id:'must-not-save',qid:'q-fixture',choice:0,correct:true,createdAt:new Date().toISOString(),seconds:2,mode:'first'}),false);
  assert.equal(api.saveTheme('silk'),false);assert.equal(h.writes.length,0);
  assert.equal(storage.get('lantern-v1-alice'),original);
  assert.equal(api.data.attempts.length,0,'These are empty placeholders, not proof the original snapshot was readable');h.unmount();
});

test('owner read failure may retain prior issue rows, so issue kind alone cannot prove records readable', () => {
  const storage=new Map([['lantern-v1-alice:sync:op:'+issue.id,JSON.stringify(issue)],['lantern-v1-bob:required-schema',JSON.stringify({schemaVersion:999})]]);
  const h=hookHarness(storage);h.render('alice');assert.equal(h.render().issues[0].kind,'op');
  const switching=h.render('bob');
  assert.equal(switching.recordsReadable,false,'The first render of a new owner must not expose the previous owner snapshot as readable');
  const api=h.render('bob');
  assert.equal(api.ready,true);assert.equal(api.sync,'blocked');assert.equal(api.issues.length,1);
  assert.equal(api.issues[0].kind,'op');assert.equal(api.issues.some(item=>item.kind==='session'&&item.status!=='waiting'),false);
  assert.equal(api.recordsReadable,false);
  assert.equal(api.saveTheme('silk'),false);assert.equal(h.writes.length,0);h.unmount();
});

test('recordsReadable keeps valid local records accessible when a single upload is blocked', async () => {
  const original=structuredClone(model.EMPTY_DATA);original.checkins=[{id:'checkin-fixture',date:'2026-10-13',minutes:5,load:'刚好',note:'Readable fixture',createdAt:'2026-10-13T09:00:00Z'}];
  const storage=new Map([['lantern-v1-alice',JSON.stringify({data:original})],['lantern-v1-alice:sync:op:'+issue.id,JSON.stringify(issue)]]);
  const h=hookHarness(storage,{online:true});h.render();await tick();await tick();const api=h.render();
  assert.equal(api.ready,true);assert.equal(api.sync,'blocked');assert.equal(api.issues[0].kind,'op');
  assert.equal(api.recordsReadable,true,'A rejected upload must not make a valid local snapshot unreadable');
  assert.equal(api.data.checkins.length,1);assert.equal(api.data.checkins[0].note,'Readable fixture');h.unmount();
});
