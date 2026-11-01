// Real hook code with synthetic private storage and deterministic IDB failures.
// No learner storage, recording or device is accessed by these probes.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const {createSourceLoader}=require(path.join(root,'tests/helpers/actual-source-loader.cjs'));
function load(file,imports={},globals={}){
 return createSourceLoader({root,imports,globals:{queueMicrotask,...globals}}).load(file);
}
const model = load('lib/study-model.ts');
const backup = load('lib/study-backup.ts', {'./study-model':model,zod:require(path.join(root,'node_modules/zod'))});
const main = 'lantern-v1-alice';
const stamp = '2026-10-14T10:00:00.000Z';
const attempt = {id:'11111111-1111-4111-8111-111111111111',qid:'synthetic-q',choice:0,correct:true,createdAt:stamp,seconds:3,mode:'first'};
const checkin = {id:'22222222-2222-4222-8222-222222222222',date:'2026-10-14',minutes:5,load:'轻',note:'Fixture only',createdAt:stamp};
const recording = {id:'33333333-3333-4333-8333-333333333333',promptId:'synthetic-prompt',title:'Fixture',createdAt:stamp,duration:2,mime:'audio/webm',uploaded:false};
const plain = value => JSON.parse(JSON.stringify(value));
function snapshot(overrides={}) {return JSON.stringify({data:{...structuredClone(model.EMPTY_DATA),...overrides}});}

function audioDB({events=['complete'],syncFailure,txError=new Error('synthetic IDB failure')}={}) {
  const probe={closes:0,puts:[],transactions:0};
  const indexedDB={open(){
    const request={};
    queueMicrotask(()=>{
      request.result={
        close(){probe.closes++;},
        transaction(){
          probe.transactions++;
          if(syncFailure==='transaction')throw txError;
          const tx={error:txError,objectStore(){
            if(syncFailure==='objectStore')throw txError;
            return {put(blob,key){
              if(syncFailure==='put')throw txError;
              probe.puts.push({blob,key});
              queueMicrotask(()=>events.forEach(event=>tx['on'+event]?.()));
            }};
          }};
          return tx;
        }
      };
      request.onsuccess?.();
    });
    return request;
  }};
  return {indexedDB,probe};
}

function harness(storage = new Map(), options = {}) {
  let slots=[],cursor=0,effects=[],owner='alice',online=false;
  const errors=[],writes=[],requests=[],listeners=new Map(),timers=new Map();let timerId=0;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},
    useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useCallback(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn,deps};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}
  };
  const localStorage={
    get length(){return storage.size;},key:i=>[...storage.keys()][i]??null,
    getItem(key){options.onGet?.(key,storage);return storage.get(key)??null;},
    setItem(key,value){options.beforeSet?.(key,value,storage);writes.push(key);storage.set(key,String(value));options.afterSet?.(key,value,storage);},
    removeItem(key){options.beforeRemove?.(key,storage);storage.delete(key);}
  };
  const hook=load('lib/use-study.ts',{react,sonner:{toast:{error:message=>errors.push(message)}},'./study-model':model,'./study-backup':backup},{
    localStorage,navigator:{get onLine(){return online;}},indexedDB:options.indexedDB,
    window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,init)=>{requests.push({url,init});return options.fetch?options.fetch(url,init):{ok:true,json:async()=>({...structuredClone(model.EMPTY_DATA),owner,hasProfile:true})};}
  });
  const render=(nextOwner=owner)=>{owner=nextOwner;cursor=0;const api=hook.useStudy(owner);const batch=effects;effects=[];batch.forEach(fn=>fn());return api;};
  return {hook,render,storage,writes,errors,requests,timers,online(value){online=value;},event(name,event={}){listeners.get(name)?.(event);},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}

test('corrupt initial snapshot is blocked, preserves every byte and cannot create replacement records',async()=>{
  for(const raw of ['{"data":', '', 'null', '[]', '{}', '{"data":null}']){
    const bob=snapshot({checkins:[checkin]});
    const storage=new Map([[main,raw],['lantern-v1-bob',bob]]);const h=harness(storage);
    h.render();const api=h.render();
    assert.equal(api.ready,true);assert.equal(api.recordsReadable,false,JSON.stringify(raw));assert.equal(api.sync,'blocked');
    assert.equal(api.addAttempt(attempt),false);assert.equal(api.addCheckin(checkin),false);
    assert.equal(api.saveTheme('hollow'),false);assert.equal(api.saveProfile({...api.data.profile,name:'Must not save'}),false);
    assert.equal(api.restoreBackup(backup.createStudyBackup({...structuredClone(model.EMPTY_DATA),checkins:[checkin]})),false);
    await assert.rejects(api.addRecording(recording,new Blob(['synthetic'])));
    await api.syncNow();h.event('focus');await tick();
    assert.equal(storage.get(main),raw);assert.equal(storage.get('lantern-v1-bob'),bob);assert.equal(h.writes.length,0);assert.equal(h.requests.length,0);
    h.unmount();
  }
});

test('corruption found before a save blocks all writes and survives a reload',()=>{
  const h=harness(new Map([[main,snapshot({attempts:[attempt]})]]));h.render();const api=h.render();
  const raw='{"data": {"attempts": [truncated';h.storage.set(main,raw);
  assert.equal(api.addCheckin(checkin),false);assert.equal(h.render().recordsReadable,false);assert.equal(h.render().sync,'blocked');
  assert.equal(h.storage.get(main),raw);assert.equal(h.writes.length,0);h.unmount();
  const reloaded=harness(h.storage);reloaded.render();assert.equal(reloaded.render().recordsReadable,false);assert.equal(h.storage.get(main),raw);reloaded.unmount();
});

test('persist rechecks after journal write and never replaces a newly corrupt main snapshot',()=>{
  const raw='{"data": "lost tail';const other=snapshot({checkins:[checkin]});
  const h=harness(new Map([[main,snapshot()],['lantern-v1-bob',other]]),{afterSet(key,value,storage){if(key.startsWith(main+':op:'))storage.set(main,raw);}});
  h.render();const api=h.render();assert.equal(api.addAttempt(attempt),false);
  assert.equal(h.storage.get(main),raw);assert.equal(h.storage.get('lantern-v1-bob'),other);
  assert.equal(h.writes.includes(main),false);assert.equal(h.render().recordsReadable,false);assert.equal(h.render().sync,'blocked');
  assert.equal(h.render().data.attempts.length,0,'Failed persistence is not projected as success');h.unmount();
});

test('a snapshot corrupted while remote GET is pending blocks late writes and retries',async()=>{
  let release,entered;const started=new Promise(resolve=>{entered=resolve;});
  const wait=new Promise(resolve=>{release=resolve;});const other=snapshot({checkins:[checkin]});
  const h=harness(new Map([[main,snapshot()],['lantern-v1-bob',other]]),{fetch:async()=>{entered();await wait;return {ok:true,json:async()=>({...structuredClone(model.EMPTY_DATA),owner:'alice',hasProfile:true,checkins:[checkin]})};}});
  h.render();h.online(true);const pass=h.render().syncNow();await started;
  const raw='{"data":';h.storage.set(main,raw);const writes=h.writes.length;release();await pass;
  assert.equal(h.storage.get(main),raw);assert.equal(h.storage.get('lantern-v1-bob'),other);assert.equal(h.writes.length,writes);
  assert.equal(h.render().recordsReadable,false);assert.equal(h.render().sync,'blocked');assert.equal(h.timers.size,0);h.unmount();
});

test('explicit retry or storage refresh can revalidate repaired bytes without deleting or replacing them',async()=>{
  for(const recover of ['sync','storage']){
    const h=harness(new Map([[main,'{"data":']]));h.render();assert.equal(h.render().recordsReadable,false);
    const repaired=snapshot({attempts:[attempt]});h.storage.set(main,repaired);
    if(recover==='sync')await h.render().syncNow();else h.event('storage',{key:main});
    const api=h.render();assert.equal(api.recordsReadable,true);assert.equal(api.sync,'local');assert.equal(api.data.attempts[0].id,attempt.id);
    assert.equal(h.storage.get(main),repaired);assert.equal(h.writes.length,0);h.unmount();
  }
});

test('future schema protection remains read-only and owner switching isolates recovery',async()=>{
  const raw=snapshot({schemaVersion:999});const bob=snapshot({checkins:[checkin]});
  const h=harness(new Map([[main,raw],['lantern-v1-bob',bob]]));h.render();await h.render().syncNow();
  assert.equal(h.render().recordsReadable,false);assert.equal(h.render().sync,'blocked');assert.equal(h.storage.get(main),raw);
  h.render('bob');const api=h.render();assert.equal(api.recordsReadable,true);assert.equal(api.data.checkins[0].id,checkin.id);
  assert.equal(api.addAttempt({...attempt,id:'44444444-4444-4444-8444-444444444444'}),true);
  assert.equal(h.storage.get(main),raw);assert.ok(h.writes.every(key=>key.startsWith('lantern-v1-bob')));h.unmount();
});

test('a future remote schema stays blocked even when its durable guard cannot be written',async()=>{
  const original=snapshot({attempts:[attempt]});
  const h=harness(new Map([[main,original]]),{beforeSet(key){if(key===main+':required-schema')throw new Error('Synthetic quota');},fetch:async()=>({ok:true,json:async()=>({...structuredClone(model.EMPTY_DATA),schemaVersion:999,owner:'alice',hasProfile:true})})});
  h.render();h.online(true);await h.render().syncNow();const writes=h.writes.length;await h.render().syncNow();h.event('storage',{key:main});await h.render().syncNow();
  assert.equal(h.render().recordsReadable,false);assert.equal(h.render().sync,'blocked');assert.equal(h.writes.length,writes);
  assert.deepEqual(JSON.parse(h.storage.get(main)).data.attempts,[attempt]);h.unmount();
});

test('missing snapshots initialize and valid legacy records and backups retain IDs, times and account scope',()=>{
  const legacy={...structuredClone(model.EMPTY_DATA),attempts:[attempt],checkins:[checkin],recordings:[recording]};
  delete legacy.schemaVersion;delete legacy.questionMarks;delete legacy.resourceTasks;
  const h=harness(new Map([[main,JSON.stringify({data:legacy})]]));h.render();let api=h.render();assert.equal(api.recordsReadable,true);
  const restored=backup.createStudyBackup({...structuredClone(model.EMPTY_DATA),checkins:[checkin]});
  assert.equal(api.restoreBackup(restored),true);api=h.render();
  for(const field of ['attempts','checkins','recordings'])assert.deepEqual(plain(api.data[field]),legacy[field]);h.unmount();
  const empty=harness();empty.render();assert.equal(empty.render().addAttempt(attempt),true);assert.equal(empty.render().data.attempts[0].id,attempt.id);empty.unmount();
});

test('quota failure cannot report a successful save or replace the prior snapshot',()=>{
  for(const stage of ['journal','summary']){
    const original=snapshot();const h=harness(new Map([[main,original]]),{beforeSet(key){if(stage==='journal'?key.startsWith(main+':op:'):key===main){const error=new Error('Synthetic storage full');error.name='QuotaExceededError';throw error;}}});
    h.render();const api=h.render();assert.equal(api.addAttempt(attempt),false,stage);
    assert.equal(h.storage.get(main),original);assert.equal(h.render().data.attempts.length,0);assert.ok(h.errors.length);h.unmount();
  }
});

test('quota during synchronization remains blocked until a successful explicit retry',async()=>{
  let full=true;const original=snapshot({attempts:[attempt]});
  const h=harness(new Map([[main,original]]),{beforeSet(key){if(full&&key===main){const error=new Error('Synthetic storage full');error.name='QuotaExceededError';throw error;}}});
  h.render();h.online(true);await h.render().syncNow();
  assert.equal(h.render().sync,'blocked');assert.equal(h.storage.get(main),original);assert.equal(h.render().recordsReadable,true);assert.equal(h.timers.size,0);
  full=false;await h.render().syncNow();assert.equal(h.render().sync,'synced');assert.equal(h.render().data.attempts[0].id,attempt.id);h.unmount();
});

for(const events of [['abort'],['error'],['error','abort','complete'],['complete','error','abort','complete']]){
  test('putAudio settles once and closes once on '+events.join('/'),async()=>{
    const {indexedDB,probe}=audioDB({events});const h=harness(new Map(),{indexedDB});let resolved=0,rejected=0;
    const blob=new Blob(['synthetic'],{type:'audio/webm'});
    const pending=h.hook.putAudio(main+':'+recording.id,blob).then(()=>{resolved++;return 'resolved';},()=>{rejected++;return 'rejected';});
    const result=await Promise.race([pending,tick().then(()=> 'pending')]);
    assert.equal(result,events[0]==='complete'?'resolved':'rejected');assert.equal(resolved+rejected,1);assert.equal(probe.closes,1);
    assert.equal(probe.puts[0].blob,blob);assert.equal(probe.puts[0].key,main+':'+recording.id);
  });
}

for(const syncFailure of ['transaction','objectStore','put']){
  test('putAudio rejects and closes after synchronous '+syncFailure+' failure',async()=>{
    const {indexedDB,probe}=audioDB({syncFailure});const h=harness(new Map(),{indexedDB});
    await assert.rejects(h.hook.putAudio(main+':'+recording.id,new Blob(['synthetic'])),/synthetic IDB failure/);
    assert.equal(probe.closes,1);
  });
}

test('recording metadata is never saved after an abort-only Blob failure and retry keeps the original identity',async()=>{
  const events=['abort'];const {indexedDB,probe}=audioDB({events});const h=harness(new Map([[main,snapshot()]]),{indexedDB});h.render();
  const blob=new Blob(['synthetic'],{type:'audio/webm'});
  const failed=h.render().addRecording(recording,blob).then(()=> 'resolved',()=> 'rejected');
  assert.equal(await Promise.race([failed,tick().then(()=> 'pending')]),'rejected');assert.equal(h.writes.length,0);assert.equal(h.render().data.recordings.length,0);
  events.splice(0,events.length,'complete');await h.render().addRecording(recording,blob);
  assert.deepEqual(plain(h.render().data.recordings),[recording]);assert.equal(probe.closes,2);assert.equal(probe.puts[1].blob,blob);
  assert.deepEqual(JSON.parse(h.storage.get(main+':recording:'+recording.id)),recording);h.unmount();
});
