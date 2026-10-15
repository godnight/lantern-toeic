const assert=require('node:assert/strict'),test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..'),ts=require(path.join(root,'node_modules/typescript'));
const {IDBFactory,IDBObjectStore}=require('fake-indexeddb');
function load(file,imports={},globals={}){
 const exports={},code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{assert.ok(name in imports,`Unexpected import ${name}`);return imports[name];},Date,Intl,Map,Set,Error,JSON,Promise,Object,Number,Array,DataView,Uint8Array,Uint32Array,TextEncoder,structuredClone,crypto:crypto.webcrypto,...globals},{filename:file});return exports;
}
const canonical=load('lib/domain-command.ts'),storage=load('lib/learning-domain-repository.ts',{'./domain-command':canonical}),model=load('lib/study-model.ts');
const training=load('lib/practice-training.ts',{'./domain-command':canonical});
const workflow=load('lib/practice-workflow.ts',{'./domain-command':canonical,'./learning-domain-repository':storage,'./study-model':model,'./practice-training':training});
const plain=value=>JSON.parse(JSON.stringify(value));
const question=(id,extra={})=>({id,part:1,title:id,prompt:'Choose one.',options:['A','B','C','D'],correctIndex:0,explanation:'Because A.',evidence:'A',skill:'detail',difficulty:'basic',...extra});
const questions=[question('a',{transcript:'Hello there. Welcome back.'}),question('b',{transcript:'Another one.'}),question('c',{part:3,groupId:'talk',transcript:'Shared first. Shared second.'}),question('d',{part:3,groupId:'talk',transcript:'Shared first. Shared second.'})];
const scope={kind:'web-owner',ownerId:'alice'},stamp='2026-10-14T23:59:59.000Z',draft={minutes:8,load:'刚好',note:'one manual confirmation'};
function legacy(){
 const attempts=new Map(),checkins=new Map(),state={attemptWrites:0,checkinWrites:0,attemptMode:'ok',checkinMode:'ok',readError:false};
 const read=(map,id)=>{if(state.readError)throw Error('journal-unavailable');return map.has(id)?plain(map.get(id)):undefined;};
 const write=(map,value,kind)=>{state[kind+'Writes']++;const mode=state[kind+'Mode'];if(mode==='fail')return false;if(mode==='throw')throw Error('legacy-write-failed');if(map.has(value.id)&&!canonical.canonicalJson(map.get(value.id)).includes('irrelevant')&&canonical.canonicalJson(map.get(value.id))!==canonical.canonicalJson(value))return false;map.set(value.id,plain(value));if(mode==='throw-after')throw Error('response-lost');return mode!=='false-after';};
 return {attempts,checkins,state,adapter:{addAttempt:value=>write(attempts,value,'attempt'),addCheckin:value=>write(checkins,value,'checkin'),readAttempt:id=>read(attempts,id),readCheckin:id=>read(checkins,id)}};
}
async function setup(options={}){
 const factory=options.factory||new IDBFactory(),facts=options.facts||legacy();
 const value=await workflow.createPracticeWorkflow({scope:options.scope||scope,questions:options.questions||questions,timezone:'Asia/Shanghai',factory,name:'practice-test',legacy:facts.adapter,now:options.now||(()=>new Date(stamp)),...options});
 return {value,factory,facts};
}
async function start(value,queue=[questions[0]],options={}){const result=await value.start(queue,{unitIds:[...new Set(queue.map(q=>q.groupId?`group:${q.part}:${q.groupId}`:`question:${q.id}`))],...options});assert.ok(['started','restored'].includes(result.status),JSON.stringify(result));return result.sessionId;}
async function session(value,id){return (await value.readProjection()).sessions.find(item=>item.id===id);}
async function complete(value,id,count=1){for(let cursor=0;cursor<count;cursor++){assert.ok(['applied','replayed'].includes((await value.submit(id,0,12,cursor)).status));assert.ok(['applied','replayed'].includes((await value.next(id,cursor)).status));}}

const drafts=load('lib/practice-training-draft.ts',{'./practice-training':training,'./study-model':model});
const writeFor=(state,change={},operationId=crypto.randomUUID())=>({operationId,occurredAt:stamp,expectedHash:training.trainingHash(state.training),training:{...plain(state.training),...change}});
const changeMaterial=(state,patch)=>({...plain(state.training),materials:state.training.materials.map((m,i)=>i===0?{...plain(m),...patch}:plain(m))});
const validate=backup=>workflow.validatePracticeWorkflowBackup(backup,questions,storage.workflowScopeKey(scope));

test('v1 remains byte-compatible until an explicit training edit; deep work is locked before submission',async()=>{
 const {value,facts}=await setup(),id=await start(value),raw=plain((await value.repository.read('sessions',id)).value),state=await session(value,id);
 assert.equal(raw.schemaVersion,1);assert.equal('training'in raw,false);assert.equal(state.training.materials.length,1);
 const op=writeFor(state);op.training=changeMaterial(state,{step:'dictation',dictationDraft:'Hello'});
 assert.equal((await value.updateTraining(id,op)).status,'blocked');assert.deepEqual(plain((await value.repository.read('sessions',id)).value),raw);assert.equal(facts.attempts.size,0);value.close();
});
test('draft, check binding, step and TTS sentence survive restart without changing original facts',async()=>{
 const a=await setup(),id=await start(a.value);await a.value.submit(id,0,17,0);const state=await session(a.value,id),before=plain((await a.value.repository.read('sessions',id)).value),facts=plain([...a.facts.attempts.values()]);
 const op=writeFor(state);op.training=changeMaterial(state,{step:'dictation',dictationDraft:'Hello there.',checkedDraft:'Hello there.',audio:{trackId:'sentence:0',sourceId:'tts:'+canonical.canonicalHash('Hello there.'),kind:'tts',capability:'sentence',positionSeconds:0,rate:0.85}});
 assert.equal((await a.value.updateTraining(id,op)).status,'updated');a.value.close();
 const b=await setup({factory:a.factory,facts:a.facts}),after=plain((await b.value.repository.read('sessions',id)).value);assert.equal(after.schemaVersion,2);assert.deepEqual(after.training,op.training);delete after.training;after.schemaVersion=1;assert.deepEqual(after,before);assert.deepEqual(plain([...b.facts.attempts.values()]),facts);assert.equal(b.facts.checkins.size,0);b.value.close();
});
test('editing a checked draft must clear its check; skip is not completion',async()=>{
 const {value}=await setup(),id=await start(value);await value.submit(id,0,3,0);let state=await session(value,id),op=writeFor(state);op.training=changeMaterial(state,{dictationDraft:'Hello',checkedDraft:'Hello',step:'dictation'});assert.equal((await value.updateTraining(id,op)).status,'updated');
 state=await session(value,id);op=writeFor(state);op.training=changeMaterial(state,{dictationDraft:'Edited'});assert.equal((await value.updateTraining(id,op)).status,'blocked');op={...op,operationId:crypto.randomUUID(),training:changeMaterial(state,{dictationDraft:'Edited',checkedDraft:null,dictationSkipped:true,listeningStatus:'skipped',step:'listen'})};assert.equal((await value.updateTraining(id,op)).status,'updated');assert.equal((await session(value,id)).training.materials[0].checkedDraft,null);value.close();
});
test('shared material is saved once; viewing an old answer never rewinds the answering cursor',async()=>{
 const {value,facts}=await setup(),id=await start(value,[questions[2],questions[3]]);await value.submit(id,0,3,0);let state=await session(value,id);assert.equal(state.training.materials.length,1);let op=writeFor(state);op.training=changeMaterial(state,{dictationDraft:'Shared draft',step:'listen'});assert.equal((await value.updateTraining(id,op)).status,'updated');assert.equal((await value.next(id,0)).status,'applied');
 state=await session(value,id);assert.equal(state.training.materials[0].dictationDraft,'Shared draft');assert.equal(state.training.viewIndex,1);assert.equal(state.training.materials[0].step,'answer');op=writeFor(state,{viewIndex:0});op.training.materials[0].step='dictation';assert.equal((await value.updateTraining(id,op)).status,'updated');assert.equal((await session(value,id)).cursor,1);assert.equal(facts.attempts.size,1);op=writeFor(await session(value,id),{viewIndex:2});assert.equal((await value.updateTraining(id,op)).status,'blocked');value.close();
});
test('same group with different material text has independent state and unlock checks',async()=>{
 const changed=[{...questions[2]},{...questions[3],transcript:'Different text.'}],a=await setup({questions:changed}),id=await start(a.value,changed);await a.value.submit(id,0,3,0);const state=await session(a.value,id);assert.equal(state.training.materials.length,2);const op=writeFor(state);op.training.materials[1].dictationDraft='not answered';assert.equal((await a.value.updateTraining(id,op)).status,'blocked');a.value.close();
});
test('lost commit response retries the exact command after cursor advances without rolling it back',async()=>{
 const {value,facts}=await setup(),id=await start(value,[questions[0],questions[1]]);await value.submit(id,0,4,0);const state=await session(value,id),op=writeFor(state);op.training=changeMaterial(state,{dictationDraft:'Saved once'});const original=value.repository.commit.bind(value.repository);let lose=true;
 value.repository.commit=async input=>{const result=await original(input);if(lose&&input.commandId==='practice-training:'+op.operationId){lose=false;return {status:'unknown',reason:'lost-response'};}return result;};
 assert.equal((await value.updateTraining(id,op)).status,'unknown');assert.equal((await value.next(id,0)).status,'applied');assert.equal((await value.updateTraining(id,op)).status,'replayed');assert.equal((await session(value,id)).cursor,1);assert.equal(facts.attempts.size,1);assert.equal((await value.updateTraining(id,{...op,training:changeMaterial(state,{dictationDraft:'Changed payload'})})).status,'conflict');value.close();
});
test('two IDB connections cannot overwrite each other with the same expected training hash',async()=>{
 const a=await setup(),id=await start(a.value);await a.value.submit(id,0,3,0);const b=await setup({factory:a.factory,facts:a.facts}),state=await session(a.value,id),one=writeFor(state),two=writeFor(state);one.training=changeMaterial(state,{dictationDraft:'A'});two.training=changeMaterial(state,{dictationDraft:'B'});
 const results=await Promise.all([a.value.updateTraining(id,one),b.value.updateTraining(id,two)]);assert.equal(results.filter(r=>r.status==='updated').length,1);assert.equal(results.filter(r=>r.status==='conflict').length,1);assert.equal(a.facts.attempts.size,1);a.value.close();b.value.close();
});
test('training IDB abort leaves original session and fact untouched, then exact retry succeeds',async()=>{
 const {value,facts}=await setup(),id=await start(value);await value.submit(id,0,3,0);const state=await session(value,id),op=writeFor(state),original=IDBObjectStore.prototype.put;op.training=changeMaterial(state,{dictationDraft:'retry me'});
 IDBObjectStore.prototype.put=function(data,...args){const result=original.call(this,data,...args);if(this.name==='sessions'&&data.id===id&&data.value.schemaVersion===2)result.addEventListener('success',()=>this.transaction.abort());return result;};
 try{assert.equal((await value.updateTraining(id,op)).status,'blocked');}finally{IDBObjectStore.prototype.put=original;}
 assert.equal((await value.repository.read('sessions',id)).value.schemaVersion,1);assert.equal((await value.updateTraining(id,op)).status,'updated');assert.equal(facts.attempts.size,1);value.close();
});
test('mixed v1/v2 backup validates every historical receipt and restores twice without score creation',async()=>{
 const a=await setup(),id=await start(a.value);await a.value.submit(id,0,3,0);const op=writeFor(await session(a.value,id));op.training=changeMaterial(await session(a.value,id),{dictationDraft:'backup draft'});await a.value.updateTraining(id,op);await complete(a.value,id);await a.value.settle(id,draft);await start(a.value,[questions[1]]);const backup=plain(await a.value.repository.exportBackup());assert.doesNotThrow(()=>validate(backup));
 const b=await setup({facts:a.facts});assert.equal((await b.value.repository.restoreBackup(backup)).status,'committed');assert.equal((await b.value.repository.restoreBackup(backup)).status,'replayed');assert.doesNotThrow(()=>validate(backup));assert.equal((await session(b.value,id)).training.materials[0].dictationDraft,'backup draft');assert.equal(b.facts.attempts.size,1);assert.equal(b.facts.checkins.size,1);
 const c=await setup();await c.value.repository.restoreBackup(backup);assert.equal((await session(c.value,id)).steps[0].status,'reference-unverified');assert.equal(c.facts.attempts.size,0);c.value.close();a.value.close();b.value.close();
});
test('training backup rejects stale check, unknown fields, missing prior revision and changed learning facts',async()=>{
 const {value}=await setup(),id=await start(value);await value.submit(id,0,3,0);const op=writeFor(await session(value,id));op.training=changeMaterial(await session(value,id),{dictationDraft:'draft'});await value.updateTraining(id,op);const backup=plain(await value.repository.exportBackup());
 const stale=plain(backup);stale.records.sessions.find(r=>r.id===id).value.training.materials[0].checkedDraft='other';assert.throws(()=>validate(stale));
 const unknown=plain(backup);unknown.records.sessions.find(r=>r.id===id).value.training.autoplay=true;assert.throws(()=>validate(unknown));
 const missing=plain(backup),receipt=missing.commands.find(r=>r.command.commandId==='practice-training:'+op.operationId),previous=receipt.command.writes[0].revision-1;missing.commands=missing.commands.filter(r=>!r.command.writes.some(w=>w.id===id&&w.revision===previous));assert.throws(()=>validate(missing),/practice-training-changed-learning-facts/);
 const bad=plain(backup),cmd=bad.commands.find(r=>r.command.commandId==='practice-training:'+op.operationId);cmd.command.writes[0].value.steps[0].initialSeen=true;assert.throws(()=>validate(bad));value.close();
});

const snapshot=text=>({viewIndex:0,materials:[{unitId:'question:a',materialHash:'a'.repeat(64),step:'dictation',dictationDraft:text,checkedDraft:null,dictationSkipped:false,listeningStatus:'pending',audio:null}]});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
test('consecutive successful draft saves ignore stale projections and keep the newest input',async()=>{
 let revision=1;const d=new drafts.PracticeTrainingDraft(snapshot('A'),async()=>({status:'updated',sessionId:'s',revision:++revision}),undefined,undefined,revision);d.edit(snapshot('B'));assert.equal(await d.flush(),true);d.edit(snapshot('C'));assert.equal(await d.flush(),true);d.sync(snapshot('A'),1);assert.equal(d.value.materials[0].dictationDraft,'C');assert.equal(d.status,'saved');
});
test('unknown draft retry keeps frozen ID/time/payload while later input gets a new operation',async()=>{
 const calls=[];let revision=1;const d=new drafts.PracticeTrainingDraft(snapshot('A'),async write=>{calls.push(plain(write));return calls.length===1?{status:'unknown',sessionId:'s',reason:'lost'}:{status:'updated',sessionId:'s',revision:++revision};},undefined,undefined,revision);d.edit(snapshot('B'));assert.equal(await d.flush(),false);d.edit(snapshot('C'));assert.equal(d.status,'unknown');assert.equal(calls.length,1);assert.equal(await d.flush(),true);assert.deepEqual(calls[0],calls[1]);assert.notEqual(calls[1].operationId,calls[2].operationId);assert.equal(d.value.materials[0].dictationDraft,'C');assert.equal(d.status,'saved');
});
test('automatic save writes one snapshot; explicit drain rechecks composition before every write',async()=>{
 const gate=deferred(),calls=[];let composing=false;const d=new drafts.PracticeTrainingDraft(snapshot('A'),async w=>{calls.push(w);return calls.length===1?gate.promise:{status:'updated',sessionId:'s',revision:3};},undefined,undefined,1,()=>!composing);d.edit(snapshot('B'));const saving=d.flush();composing=true;d.edit(snapshot('C'));gate.resolve({status:'updated',sessionId:'s',revision:2});assert.equal(await saving,false);assert.equal(calls.length,1);assert.equal(d.value.materials[0].dictationDraft,'C');composing=false;assert.equal(await d.flush(),true);assert.equal(calls.length,2);
 const next=deferred();let count=0;const single=new drafts.PracticeTrainingDraft(snapshot('A'),async()=>{count++;return next.promise;});single.edit(snapshot('B'));const once=single.flush(false,false);single.edit(snapshot('C'));next.resolve({status:'updated',sessionId:'s',revision:1});assert.equal(await once,true);assert.equal(count,1);assert.equal(single.status,'dirty');
});
test('a newer remote before an old response wins unless unsaved local input requires explicit conflict',async()=>{
 for(const edited of [false,true]){const gate=deferred(),d=new drafts.PracticeTrainingDraft(snapshot('A'),()=>gate.promise,undefined,undefined,1);d.edit(snapshot('B'));const pending=d.flush(false,false);d.sync(snapshot('remote C'),3);if(edited)d.edit(snapshot('local D'));gate.resolve({status:'updated',sessionId:'s',revision:2});assert.equal(await pending,!edited);assert.equal(d.value.materials[0].dictationDraft,edited?'local D':'remote C');assert.equal(d.status,edited?'conflict':'saved');}
});

test('conflict retry merges only edited fields, preserving another window material and same-field alternatives',async()=>{
 const base=snapshot('A');base.materials.push({...plain(base.materials[0]),unitId:'question:b',materialHash:'b'.repeat(64),dictationDraft:'B'});
 const remote=plain(base);remote.materials[0].dictationDraft='remote A';remote.materials[0].listeningStatus='confirmed';
 const local=plain(base);local.materials[1].dictationDraft='local B';let count=0,written;
 const d=new drafts.PracticeTrainingDraft(base,async write=>{written=plain(write);return ++count===1?{status:'conflict',reason:'changed'}:{status:'updated',sessionId:'s',revision:3};},undefined,undefined,1);d.edit(local);assert.equal(await d.flush(),false);d.sync(remote,2);assert.equal(d.conflicts.length,0);assert.equal(await d.flush(true),true);assert.equal(written.training.materials[0].dictationDraft,'remote A');assert.equal(written.training.materials[0].listeningStatus,'confirmed');assert.equal(written.training.materials[1].dictationDraft,'local B');
 const sameField=plain(base);sameField.materials[0].dictationDraft='local A';const conflict=new drafts.PracticeTrainingDraft(base,async()=>({status:'conflict',reason:'changed'}),undefined,undefined,1);conflict.edit(sameField);await conflict.flush();conflict.sync(remote,2);assert.equal(conflict.status,'conflict');assert.equal(conflict.conflicts[0].local.dictationDraft,'local A');assert.equal(conflict.conflicts[0].remote.dictationDraft,'remote A');conflict.acceptRemote();assert.equal(conflict.value.materials[0].dictationDraft,'remote A');assert.equal(conflict.status,'saved');
});
test('three-way draft edit clears a remotely checked binding instead of carrying a false check',()=>{
 const base=snapshot('same'),local=snapshot('edited'),remote=snapshot('same');remote.materials[0].checkedDraft='same';const result=training.mergePracticeTraining(base,local,remote);assert.equal(result.training.materials[0].dictationDraft,'edited');assert.equal(result.training.materials[0].checkedDraft,null);
});


test('already-converged merge clears conflict without a redundant write',async()=>{
 const base=snapshot('A'),local=snapshot('X'),remote=snapshot('X');remote.materials[0].listeningStatus='confirmed';let calls=0;const d=new drafts.PracticeTrainingDraft(base,async()=>{calls++;return {status:'conflict',reason:'changed'};},undefined,undefined,1);d.edit(local);await d.flush();d.sync(remote,2);assert.equal(await d.flush(true),true);assert.equal(d.status,'saved');assert.equal(d.reason,'');assert.equal(calls,1);assert.deepEqual(plain(d.value),plain(remote));
});
test('checking and skipping the same draft are an explicit semantic conflict with both intents retained',()=>{
 const base=snapshot('D'),local=snapshot('D'),remote=snapshot('D');local.materials[0].checkedDraft='D';remote.materials[0].dictationSkipped=true;const result=training.mergePracticeTraining(base,local,remote);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].local.checkedDraft,'D');assert.equal(result.conflicts[0].remote.dictationSkipped,true);assert.equal(result.training.materials[0].checkedDraft,'D');assert.equal(result.training.materials[0].dictationSkipped,false);
});
