// Read-only source review probes. All data is synthetic and all DBs are in memory.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const root = path.resolve(process.env.LANTERN_REVIEW_ROOT || path.join(__dirname, '..', '..', '..', '..'));
const appRequire = createRequire(path.join(root, 'package.json'));
const ts = appRequire('typescript');
const orm = appRequire('drizzle-orm');
const {drizzle} = appRequire('drizzle-orm/sqlite-proxy');
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports, require:name=>{if(!(name in imports))throw Error(name);return imports[name];}, Date,Intl,Map,Set,JSON,structuredClone,Request,Response,Headers,FormData,File,Blob,URL,crypto:{randomUUID},...globals}, {filename:file});
  return exports;
}
function database(beforeRead) {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(name=>name.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
  const db = drizzle(async(query,params,method)=>{
    const prepared=sqlite.prepare(query);
    if(method==='run'){prepared.run(...params);return {rows:[]};}
    const rows=prepared.all(...params).map(row=>Object.values(row));
    if(beforeRead)await beforeRead(query, params);
    return {rows:method==='get'?rows[0]:rows};
  });
  return {sqlite,db};
}
const schema=load('db/schema.ts',{'drizzle-orm/sqlite-core':appRequire('drizzle-orm/sqlite-core')});
const model=load('lib/study-model.ts');
const statements=load('db/mutable-study.ts',{'drizzle-orm':orm,'./schema':schema,'../lib/study-model':model});
const auth=(owner)=>({userId:async()=>owner(),safeMutation:()=>true,privateJson:(body,status=200)=>Response.json(body,{status})});

async function recordingProbes() {
  const {sqlite,db}=database(); const objects=new Map(); let owner='alice';
  const prompts=JSON.parse(fs.readFileSync(path.join(root,'content/speaking.json'),'utf8'));
  const api=load('app/api/recordings/route.ts',{'cloudflare:workers':{env:{BUCKET:{put:async(key,bytes)=>objects.set(key,Buffer.from(bytes))}}},'drizzle-orm':orm,'@/db':{getDb:()=>db},'@/db/schema':schema,'@/lib/server-auth':auth(()=>owner),'@/content/speaking.json':{default:prompts}});
  const id=randomUUID(), meta={id,promptId:prompts[0].id,duration:2,createdAt:'2026-01-01T10:00:00.000Z'};
  const post=(text, data=meta)=>api.POST({headers:new Headers({'x-lantern-owner':owner}),formData:async()=>({get:key=>key==='audio'?new File([text],'sample.webm',{type:'audio/webm'}):JSON.stringify(data)})});
  assert.equal((await post('synthetic-original')).status,200);
  const before=sqlite.prepare('SELECT body FROM recordings WHERE id=?').get(id).body;
  assert.equal((await post('synthetic-replacement',{...meta,duration:9})).status,200);
  const after=sqlite.prepare('SELECT body FROM recordings WHERE id=?').get(id).body;
  assert.equal(after,before);
  assert.equal(objects.get('recordings/alice/'+id).toString(),'synthetic-replacement');
  console.log('PROBE RECORDING_MUTABLE_BLOB: same-owner/same-ID replacement returns 200; D1 metadata remains duration 2; R2 bytes replaced by duration-9 request.');
  owner='bob'; assert.equal((await post('synthetic-bob')).status,200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM recordings WHERE user_id=? AND id=?').get(owner,id).count,0);
  assert.equal(objects.has('recordings/bob/'+id),true);
  console.log('PROBE RECORDING_FALSE_ACK: other-owner/same-ID POST returns 200 with 0 owned D1 rows and an unreferenced owner-scoped R2 object. No cross-owner read demonstrated.');
  sqlite.close();
}
async function firstAttemptProbe() {
  let reads=0,release;const gate=new Promise(r=>release=r);
  const {sqlite,db}=database(async(query)=>{
    if(query.includes('from "attempts"')&&query.includes('"qid"')&&query.includes('limit')) {if(++reads===2)release();await gate;}
  });
  const questions=JSON.parse(fs.readFileSync(path.join(root,'content/questions.json'),'utf8'));
  const api=load('app/api/study/route.ts',{'drizzle-orm':orm,zod:appRequire('zod'),'@/db':{getDb:()=>db},'@/db/schema':schema,'@/db/mutable-study':statements,'@/lib/study-model':model,'@/lib/server-auth':auth(()=>'alice'),'@/content/questions.json':{default:questions},'@/content/resources-v2':load('content/resources-v2.ts'),'@/content/exams/catalogue.json':{default:[]}});
  const post=()=>api.POST(new Request('https://test.local/api/study',{method:'POST',headers:{'x-lantern-owner':'alice','content-type':'application/json'},body:JSON.stringify({type:'attempt',data:{id:randomUUID(),qid:questions[0].id,choice:0,seconds:2,createdAt:'2026-01-01T10:00:00.000Z'}})}));
  const responses=await Promise.all([post(),post()]);assert.deepEqual(responses.map(r=>r.status),[200,200]);
  const rows=sqlite.prepare('SELECT mode FROM attempts').all(); assert.deepEqual(rows.map(r=>r.mode),['first','first']);
  console.log('PROBE FIRST_RACE: two actual-route POSTs with concurrent empty-history reads produce 2 first rows for one owner/question. Current firstAttempts helper separately deduplicates by qid.');
  const badProfile={...model.DEFAULT_PROFILE,examDate:'2026-02-31'};
  const profileResponse=await api.POST(new Request('https://test.local/api/study',{method:'POST',headers:{'x-lantern-owner':'alice','content-type':'application/json'},body:JSON.stringify({type:'profile',data:badProfile})}));
  assert.equal(profileResponse.status,200);
  const backup=load('lib/study-backup.ts',{'./study-model':model,zod:appRequire('zod')});
  assert.throws(()=>backup.parseStudyBackup({...model.EMPTY_DATA,profile:badProfile}));
  const badCheckin={id:randomUUID(),date:'2026-02-31',minutes:1,load:'轻',note:'synthetic',createdAt:'2026-01-01T10:00:00.000Z'};
  const checkinResponse=await api.POST(new Request('https://test.local/api/study',{method:'POST',headers:{'x-lantern-owner':'alice','content-type':'application/json'},body:JSON.stringify({type:'checkin',data:badCheckin})}));
  assert.equal(checkinResponse.status,200);
  assert.throws(()=>backup.parseStudyBackup({...model.EMPTY_DATA,checkins:[badCheckin]}));
  console.log('PROBE DATE_CONTRACT: actual API accepts profile.examDate and checkin.date 2026-02-31 (200); strict study backup parser rejects both. Normal date-input route was not demonstrated to emit this value.');
  sqlite.close();
}
async function malformedSnapshotProbe() {
  const source=fs.readFileSync(path.join(root,'tests/study-invariants.test.cjs'),'utf8');
  const sandbox={exports:{},require:name=>name==='node:test'?()=>{}:name==='zod'?appRequire(name):require(name),process:{env:{LANTERN_REVIEW_ROOT:root}},__dirname:path.join(root,'tests'),Date,Intl,Map,Set,structuredClone,AbortController,FormData,Blob,File,Response,Headers,URL,Buffer,queueMicrotask,setImmediate,setTimeout,clearTimeout};
  vm.runInNewContext(source+'\nexports.hookHarness=hookHarness;',sandbox,{filename:'existing-study-harness'});
  const key='lantern-v1-alice',raw='{"data":{"schemaVersion":2,"attempts":[';
  const storage=new Map([[key,raw]]),h=sandbox.exports.hookHarness(storage);
  h.render();await new Promise(r=>setImmediate(r));
  assert.equal(h.render().ready,true);assert.equal(h.render().sync,'local');
  assert.equal(h.render().addCheckin({id:randomUUID(),date:'2026-01-01',minutes:1,load:'轻',note:'synthetic',createdAt:'2026-01-01T10:00:00.000Z'}),true);
  assert.notEqual(storage.get(key),raw);assert.equal(JSON.parse(storage.get(key)).data.attempts.length,0);
  console.log('PROBE MALFORMED_SNAPSHOT: malformed snapshot JSON becomes ready/local EMPTY_DATA; a new checkin overwrites original malformed bytes. No corruption lock or raw quarantine.');
}
(async()=>{await recordingProbes();await firstAttemptProbe();await malformedSnapshotProbe();console.log('All 5 synthetic evidence groups confirmed. No production DB/R2/browser/device touched.');})().catch(error=>{console.error(error);process.exitCode=1;});
