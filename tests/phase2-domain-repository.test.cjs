const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const {IDBFactory,IDBObjectStore}=require('fake-indexeddb');
function load(file,imports={}){
 const exports={},code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{assert.ok(name in imports,`Unexpected import ${name}`);return imports[name];},Date,Map,Set,Error,JSON,Promise,Object,Number,Array,DataView,Uint8Array,Uint32Array,TextEncoder,structuredClone,crypto:crypto.webcrypto},{filename:file});
 return exports;
}
const canonical=load('lib/domain-command.ts');
const storage=load('lib/learning-domain-repository.ts',{'./domain-command':canonical});
const plain=value=>JSON.parse(JSON.stringify(value));
const scope={kind:'web-owner',ownerId:'alice'};
const stamp='2026-10-14T12:00:00.000Z';
const open=(factory=new IDBFactory(),who=scope,name='workflow-test')=>storage.openLearningDomainRepository(who,{factory,name});
const command=(id='command-1',prior=null,next=1,value={cursor:1})=>({commandId:id,occurredAt:stamp,payload:{intent:'test',fixedId:'legacy-1'},expected:[{collection:'sessions',id:'session-1',revision:prior}],writes:[{collection:'sessions',id:'session-1',revision:next,value}]});
const req=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});

test('canonical JSON is full, order-stable, preserves legacy strings, and SHA matches Node',()=>{
 const a={z:-0,occurredAt:'2026-01-01T08:00:00+08:00',nested:{b:'fuzzy',a:1},items:[true,null,'😀']};
 const b={items:[true,null,'😀'],nested:{a:1,b:'fuzzy'},occurredAt:'2026-01-01T08:00:00+08:00',z:0};
 assert.equal(canonical.canonicalJson(a),canonical.canonicalJson(b));
 for(const value of ['', 'abc','😀中文',canonical.canonicalJson(a),'x'.repeat(130)])assert.equal(canonical.canonicalHash(value),crypto.createHash('sha256').update(value).digest('hex'));
 const circular={};circular.self=circular;
 for(const bad of [{missing:undefined},{bad:NaN},circular,new Date(),[,,],JSON.parse('{"__proto__":{}}')])assert.throws(()=>canonical.canonicalJson(bad));
 let getterCalls=0;const sparse=Array(1);sparse.foo=1;const getter=[];Object.defineProperty(getter,'0',{get(){getterCalls++;return 1;},enumerable:true});const symbols=[1];symbols[Symbol('hidden')]=2;
 for(const bad of [sparse,getter,symbols])assert.throws(()=>canonical.canonicalJson(bad));assert.equal(getterCalls,0);
});

test('one durable transaction stores state, cursor, intent/outbox metadata, events and receipt',async()=>{
 const repository=await open();const input=command();
 input.expected.push({collection:'commands',id:'fixed-intent',revision:null},{collection:'events',id:'observation-1',revision:null},{collection:'outbox',id:'bridge-1',revision:null});
 input.writes.push({collection:'commands',id:'fixed-intent',revision:1,value:{status:'prepared',legacyPayload:{id:'legacy-1',createdAt:stamp}}},{collection:'events',id:'observation-1',revision:1,value:{kind:'metadata',rawRating:'fuzzy'}},{collection:'outbox',id:'bridge-1',revision:1,value:{status:'prepared'}});
 const result=await repository.commit(input);assert.equal(result.status,'committed');
 assert.equal((await repository.read('sessions','session-1')).value.cursor,1);
 assert.equal((await repository.read('commands','fixed-intent')).value.status,'prepared');
 assert.deepEqual(plain(result.receipt.eventIds),['observation-1']);
 assert.deepEqual(plain(await repository.getReceipt(input.commandId)),plain(result.receipt));
 assert.equal((await repository.exportBackup()).commands.length,1);repository.close();
});

test('existing identical receipt replays before checking its now-stale expected revision',async()=>{
 const repository=await open(),first=command();const saved=await repository.commit(first);
 assert.equal(saved.status,'committed');assert.equal((await repository.commit(command('advance',1,2,{cursor:2}))).status,'committed');
 const retry=await repository.commit({...first,payload:{fixedId:'legacy-1',intent:'test'}});
 assert.equal(retry.status,'replayed');assert.deepEqual(plain(retry.receipt),plain(saved.receipt));
 assert.equal((await repository.read('sessions','session-1')).revision,2);repository.close();
});

test('same command ID with any changed immutable payload does not overwrite the original receipt',async()=>{
 const repository=await open(),input=command(),saved=await repository.commit(input);
 for(const alter of [c=>c.payload.intent='different',c=>c.occurredAt='2026-10-14T12:00:01.000Z',c=>c.writes[0].value.cursor=9]){
  const changed=plain(input);alter(changed);const outcome=await repository.commit(changed);assert.equal(outcome.status,'conflict');assert.equal(outcome.reason,'payload');
 }
 assert.deepEqual(plain(await repository.getReceipt(input.commandId)),plain(saved.receipt));
 assert.equal((await repository.list('sessions')).length,1);repository.close();
});

test('two real IndexedDB connections competing for one revision have exactly one winner',async()=>{
 const factory=new IDBFactory(),a=await open(factory),b=await open(factory);
 const outcomes=await Promise.all([a.commit(command('tab-a',null,1,{cursor:1,answer:'A'})),b.commit(command('tab-b',null,1,{cursor:1,answer:'B'}))]);
 assert.equal(outcomes.filter(row=>row.status==='committed').length,1);assert.equal(outcomes.filter(row=>row.status==='conflict').length,1);
 const winner=outcomes.find(row=>row.status==='committed');assert.equal((await a.exportBackup()).commands.length,1);assert.ok(await b.getReceipt(winner.receipt.commandId));a.close();b.close();
});

test('read-only CAS guards cover associated rows without requiring a write to each one',async()=>{
 const repository=await open();assert.equal((await repository.commit(command())).status,'committed');
 const guarded={commandId:'guarded',occurredAt:stamp,payload:{},expected:[{collection:'sessions',id:'session-1',revision:2},{collection:'days',id:'day-1',revision:null}],writes:[{collection:'days',id:'day-1',revision:1,value:{done:1}}]};
 assert.equal((await repository.commit(guarded)).status,'conflict');assert.equal(await repository.read('days','day-1'),undefined);
 guarded.expected[0].revision=1;assert.equal((await repository.commit(guarded)).status,'committed');repository.close();
});

test('scope binds every read, command, record key and restore, including anonymous web versus Harmony',async()=>{
 const factory=new IDBFactory(),scopes=[scope,{kind:'web-owner',ownerId:'bob'},{kind:'web-local',partition:'existing-device'},{kind:'harmony-device',partition:'existing-device'}];
 const repositories=await Promise.all(scopes.map(who=>open(factory,who)));
 for(let i=0;i<repositories.length;i++)assert.equal((await repositories[i].commit(command('same-id',null,1,{account:i}))).status,'committed');
 for(let i=0;i<repositories.length;i++)assert.equal((await repositories[i].read('sessions','session-1')).value.account,i);
 assert.equal((await repositories[1].restoreBackup(await repositories[0].exportBackup())).reason,'scope');
 for(const bad of [null,{kind:'web-owner',ownerId:''},{kind:'web-owner',ownerId:'alice',partition:'existing-device'},{kind:'web-local',partition:'other'},{kind:'device'}])await assert.rejects(storage.openLearningDomainRepository(bad,{factory}));
 repositories.forEach(repository=>repository.close());
});

test('an abort after a successful request rolls back all rows and the command receipt',async()=>{
 const repository=await open(),original=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value,...args){const result=original.call(this,value,...args);if(this.name==='sessions')result.addEventListener('success',()=>this.transaction.abort());return result;};
 let result;try{result=await repository.commit(command());}finally{IDBObjectStore.prototype.put=original;}
 assert.equal(result.status,'blocked');assert.equal((await repository.list('sessions')).length,0);assert.equal(await repository.getReceipt('command-1'),undefined);
 assert.equal((await repository.commit(command())).status,'committed');repository.close();
});

test('quota failure on the last write rolls state and receipt back and preserves the fixed retry payload',async()=>{
 const repository=await open(),original=IDBObjectStore.prototype.add;
 IDBObjectStore.prototype.add=function(...args){if(this.name==='receipts'){const error=new Error('Synthetic quota');error.name='QuotaExceededError';throw error;}return original.apply(this,args);};
 let result;try{result=await repository.commit(command());}finally{IDBObjectStore.prototype.add=original;}
 assert.equal(result.status,'blocked');assert.equal(result.reason,'quota');assert.equal((await repository.list('sessions')).length,0);
 assert.equal((await repository.commit(command())).status,'committed');repository.close();
});

test('backup restore is idempotent and imported receipts remain unverified without replaying intent',async()=>{
 const source=await open(),input=command();assert.equal((await source.commit(input)).status,'committed');
 const pending={commandId:'prepare-2',occurredAt:stamp,payload:{fixedEvent:{id:'event-2',createdAt:stamp}},expected:[{collection:'commands',id:'pending-2',revision:null}],writes:[{collection:'commands',id:'pending-2',revision:1,value:{status:'prepared',activeCommandId:'answer-2'}}]};
 await source.commit(pending);const backup=await source.exportBackup(),target=await open();
 const first=await target.restoreBackup(backup);assert.equal(first.status,'committed');assert.equal(first.addedRecords,2);assert.equal(first.addedCommands,2);assert.equal(first.requiresReferenceVerification,true);
 const second=await target.restoreBackup(backup);assert.equal(second.status,'replayed');assert.equal(second.addedRecords,0);assert.equal(second.addedCommands,0);
 assert.equal(await target.getReceipt(input.commandId),undefined);assert.equal((await target.readCommand(input.commandId)).provenance,'restored-unverified');
 assert.equal((await target.commit(input)).reason,'reference-unverified');assert.equal((await target.read('commands','pending-2')).value.status,'prepared');
 const originalReceipt=await source.getReceipt(input.commandId);assert.equal((await source.restoreBackup(backup)).status,'replayed');assert.deepEqual(plain(await source.getReceipt(input.commandId)),plain(originalReceipt));
 source.close();target.close();
});

test('full backup validation rejects future schema, malformed/duplicate IDs and changed command payload before a write',async()=>{
 const source=await open();await source.commit(command());const backup=plain(await source.exportBackup()),target=await open();
 for(const alter of [b=>b.schemaVersion=2,b=>b.records.sessions.push(b.records.sessions[0]),b=>b.records.sessions[0].revision=0,b=>b.commands[0].command.payload.intent='tampered',b=>b.records.days=[{id:'new-day',revision:1,value:{ok:undefined}}]]){
  const bad=structuredClone(backup);alter(bad);assert.equal((await target.restoreBackup(bad)).status,'blocked');assert.equal((await target.list('sessions')).length,0);assert.equal((await target.list('days')).length,0);
 }
 source.close();target.close();
});

test('a late restore collision rejects the entire merge and does not overwrite existing local data',async()=>{
 const source=await open();await source.commit(command());const backup=plain(await source.exportBackup()),target=await open();
 await target.commit(command('different',null,1,{cursor:99}));backup.records.plans.push({id:'new-plan',revision:1,value:{goal:15}});
 const before=plain(await target.exportBackup());assert.equal((await target.restoreBackup(backup)).status,'conflict');assert.deepEqual(plain(await target.exportBackup()),before);assert.equal(await target.read('plans','new-plan'),undefined);source.close();target.close();
});

test('a failure during restore writes aborts preceding additions and receipt imports',async()=>{
 const source=await open();await source.commit(command());const backup=plain(await source.exportBackup());backup.records.plans.push({id:'new-plan',revision:1,value:{goal:15}});
 const target=await open(),original=IDBObjectStore.prototype.add;
 IDBObjectStore.prototype.add=function(...args){if(this.name==='sessions')throw Error('Synthetic restore failure');return original.apply(this,args);};
 let result;try{result=await target.restoreBackup(backup);}finally{IDBObjectStore.prototype.add=original;}
 assert.equal(result.status,'blocked');assert.equal((await target.list('plans')).length,0);assert.equal((await target.list('sessions')).length,0);assert.equal(await target.getReceipt('command-1'),undefined);source.close();target.close();
});

test('future database versions and unavailable backends fail closed without memory fallback or touching old DBs',async()=>{
 const factory=new IDBFactory(),future=await req(factory.open('workflow-test',2));future.close();
 const repository=await open(factory);assert.equal((await repository.commit(command())).reason,'schema');await assert.rejects(repository.read('sessions','session-1'));repository.close();
 const unavailable=await storage.openLearningDomainRepository(scope,{factory:{open(){throw Error('IndexedDB denied');}},name:'denied'});assert.equal((await unavailable.commit(command())).reason,'unavailable');
 const noBackend=await storage.openLearningDomainRepository(scope);assert.equal((await noBackend.commit(command())).status,'blocked');unavailable.close();noBackend.close();
 const databases=await factory.databases();assert.deepEqual(databases.map(db=>db.name),['workflow-test']);
});

test('corrupt stored envelopes block new writes instead of treating corrupt state as absent',async()=>{
 const factory=new IDBFactory(),repository=await open(factory);await repository.commit(command());
 const db=await req(factory.open('workflow-test',1)),tx=db.transaction('sessions','readwrite');
 const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=reject;});
 tx.objectStore('sessions').put({scopeKey:storage.workflowScopeKey(scope),id:'session-1',schemaVersion:1,revision:1,value:{cursor:9},canonicalValue:'{"cursor":1}'});await done;db.close();
 assert.equal((await repository.commit(command('next',1,2))).reason,'corrupt');assert.equal(await repository.getReceipt('next'),undefined);await assert.rejects(repository.exportBackup());repository.close();
});

test('scope is a frozen clone, so caller mutation cannot relabel another scope backup',async()=>{
 const mutable={kind:'web-owner',ownerId:'alice'},repository=await open(new IDBFactory(),mutable);await repository.commit(command());
 mutable.ownerId='bob';try{repository.scope.ownerId='bob';}catch{/* Frozen scope may throw in strict clients. */}
 assert.equal(Object.isFrozen(repository.scope),true);assert.equal((await repository.exportBackup()).scope.ownerId,'alice');repository.close();
});

test('opaque imported applied rows without any receipts are unverified and cannot become CAS authority',async()=>{
 const source=await open(),backup=plain(await source.exportBackup());source.close();
 backup.records.sessions.push({id:'session-1',revision:1,value:{cursor:4,status:'completed'}});backup.records.commands.push({id:'fake-applied',revision:1,value:{status:'applied'}});
 const target=await open(),result=await target.restoreBackup(JSON.stringify(backup));assert.equal(result.requiresReferenceVerification,true);
 assert.equal((await target.read('sessions','session-1')).provenance,'restored-unverified');assert.equal((await target.commit(command('next',1,2))).reason,'reference-unverified');
 assert.equal((await target.restoreBackup(backup)).requiresReferenceVerification,true);assert.equal((await target.list('commands'))[0].value.status,'applied');target.close();
});

test('explicit reference reconciliation keeps original command ID/payload and never executes it again',async()=>{
 const source=await open(),input=command();await source.commit(input);const backup=plain(await source.exportBackup()),target=await open();await target.restoreBackup(backup);
 const restored=await target.readCommand(input.commandId),row=await target.read('sessions','session-1');
 assert.equal((await target.confirmRestored({records:[],commands:[{commandId:input.commandId,canonicalPayload:restored.canonicalPayload}]})).reason,'reference-unverified');
 const confirmation={records:[{collection:'sessions',id:row.id,revision:row.revision,value:row.value}],commands:[{commandId:input.commandId,canonicalPayload:restored.canonicalPayload}]};
 const bad=plain(confirmation);bad.records[0].value.cursor=99;assert.equal((await target.confirmRestored(bad)).status,'conflict');assert.equal(await target.getReceipt(input.commandId),undefined);
 const result=await target.confirmRestored(confirmation);assert.equal(result.status,'committed');assert.equal(result.confirmedRecords,1);assert.equal(result.confirmedCommands,1);
 assert.equal((await target.commit(input)).status,'replayed');assert.equal((await target.read('sessions','session-1')).value.cursor,1);assert.equal((await target.confirmRestored(confirmation)).status,'replayed');
 assert.equal((await target.commit(command('next',1,2,{cursor:2}))).status,'committed');source.close();target.close();
});

test('metadata rows can be explicitly validated independently of still-unverified technical receipts',async()=>{
 const source=await open();await source.commit(command());const target=await open();await target.restoreBackup(await source.exportBackup());const row=await target.read('sessions','session-1');
 assert.equal((await target.confirmRestored({records:[{collection:'sessions',id:row.id,revision:row.revision,value:row.value}],commands:[]})).status,'committed');
 assert.equal(await target.getReceipt('command-1'),undefined);assert.equal((await target.commit(command('next',1,2))).status,'committed');source.close();target.close();
});

test('confirmation is atomic across collections that happen to have identical row IDs and values',async()=>{
 const source=await open(),input={commandId:'pair',occurredAt:stamp,payload:{},expected:['plans','days'].map(collection=>({collection,id:'same',revision:null})),writes:['plans','days'].map(collection=>({collection,id:'same',revision:1,value:{shared:true}}))};
 await source.commit(input);const target=await open();await target.restoreBackup(await source.exportBackup());
 const records=[];for(const collection of ['plans','days']){const row=await target.read(collection,'same');records.push({collection,id:row.id,revision:row.revision,value:row.value});}
 assert.equal((await target.confirmRestored({records,commands:[]})).confirmedRecords,2);for(const collection of ['plans','days'])assert.equal((await target.read(collection,'same')).provenance,'local');source.close();target.close();
});

test('same-version incompatible schema/index stays blocked without destructive upgrade',async()=>{
 const factory=new IDBFactory(),request=factory.open('workflow-test',1);
 request.onupgradeneeded=()=>{for(const name of [...storage.DOMAIN_COLLECTIONS,'receipts']){const store=request.result.createObjectStore(name,{keyPath:['scopeKey','id']});store.createIndex('scope','scopeKey',{unique:true});}};
 const db=await req(request);db.close();const repository=await open(factory);assert.equal((await repository.commit(command())).reason,'schema');repository.close();
 const untouched=await req(factory.open('workflow-test',1));assert.equal(untouched.transaction('plans').objectStore('plans').index('scope').unique,true);untouched.close();
});

test('simultaneous retries of the same fixed ID yield one commit and one exact replay',async()=>{
 const factory=new IDBFactory(),a=await open(factory),b=await open(factory),input=command();
 const outcomes=await Promise.all([a.commit(input),b.commit(input)]);assert.deepEqual(outcomes.map(row=>row.status).sort(),['committed','replayed']);assert.deepEqual(plain(outcomes[0].receipt),plain(outcomes[1].receipt));
 assert.equal((await a.exportBackup()).commands.length,1);a.close();b.close();
});

test('confirmation quota failure keeps both restored data and original receipt unverified',async()=>{
 const source=await open();await source.commit(command());const target=await open();await target.restoreBackup(await source.exportBackup());
 const row=await target.read('sessions','session-1'),intent=await target.readCommand('command-1'),input={records:[{collection:'sessions',id:row.id,revision:row.revision,value:row.value}],commands:[{commandId:'command-1',canonicalPayload:intent.canonicalPayload}]};
 const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='receipts'){const error=new Error('quota while confirming');error.name='QuotaExceededError';throw error;}return original.apply(this,args);};
 let result;try{result=await target.confirmRestored(input);}finally{IDBObjectStore.prototype.put=original;}
 assert.equal(result.reason,'quota');assert.equal((await target.read('sessions','session-1')).provenance,'restored-unverified');assert.equal(await target.getReceipt('command-1'),undefined);
 assert.equal((await target.confirmRestored(input)).status,'committed');source.close();target.close();
});

test('the default new workflow database neither upgrades nor edits an existing audio database',async()=>{
 const factory=new IDBFactory(),legacyRequest=factory.open('lantern-audio',3);legacyRequest.onupgradeneeded=()=>legacyRequest.result.createObjectStore('audio');const legacy=await req(legacyRequest);
 const tx=legacy.transaction('audio','readwrite'),done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=reject;});tx.objectStore('audio').put({privateFixture:'keep-exact'},'fixture');await done;
 const repository=await storage.openLearningDomainRepository(scope,{factory});assert.equal((await repository.commit(command())).status,'committed');
 assert.equal(legacy.version,3);assert.deepEqual(await req(legacy.transaction('audio').objectStore('audio').get('fixture')),{privateFixture:'keep-exact'});
 assert.deepEqual((await factory.databases()).map(db=>db.name).sort(),['lantern-audio','lantern-workflow-v1']);repository.close();legacy.close();
});
