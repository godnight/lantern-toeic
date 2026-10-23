const test=require('node:test'),assert=require('node:assert/strict');
const {environment,migrate,syntheticLegacy,ORIGIN,sha}=require('./helpers/sites-legacy-readonly-harness.cjs');
const tables=['profiles','attempts','checkins','recordings','question_marks','resource_tasks','vocabulary_events','exam_library'];
const facts=e=>JSON.stringify(Object.fromEntries(tables.map(t=>[t,e.rows(t)])));
const owner='usr_00000000-0000-4000-8000-000000000001',cookie='__Host-lantern-session='+'1'.repeat(64);
function setup(t,extra=0){
 const e=environment();t.after(()=>e.close());const legacy=syntheticLegacy(e,'sites-synthetic-old-owner',0);
 for(let i=0;i<extra;i++)e.sqlite.prepare('INSERT INTO checkins VALUES(?,?,?,?)').run('old-check-'+String(i).padStart(4,'0'),legacy,'{"note":"original fact"}','2026-01-01');
 migrate(e);e.sqlite.prepare('INSERT INTO auth_users VALUES(?,?,?)').run(owner,'synthetic_new_user',1);e.sqlite.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(sha('1'.repeat(64)),owner,1,Date.now()+100000);
 e.sqlite.prepare('INSERT INTO profiles VALUES(?,?,?)').run(owner,'{"name":"Synthetic new profile"}','2026-01-02');
 const batch=e.d1.batch.bind(e.d1),batches=[];e.d1.batch=async statements=>{const result=await batch(statements);batches.push({statements:statements.length,inserted:result.slice(1,7).reduce((n,r)=>n+Number(r.meta.changes??0),0)});return result;};
 const route=e.load('app/api/study/route.ts');const call=(headers={cookie})=>route.GET(new Request(ORIGIN+'/api/study?sync=pages-v1',{headers}));return {e,call,batches};
}
test('authenticated small legacy database initializes once and returns only verified product owner facts',async t=>{
 const {e,call,batches}=setup(t),before=facts(e);assert.equal(e.rows('study_sync_clock').length,0);const response=await call();assert.equal(response.status,200);const body=await response.json();assert.equal(body.owner,owner);assert.equal(body.changes.length,1);assert.equal(body.changes[0].data.name,'Synthetic new profile');assert.equal(body.checkpoint.owner,owner);assert.equal(batches.length,1);assert(batches[0].inserted<=600);assert.equal(e.rows('study_sync_clock')[0].ready,1);assert.equal(facts(e),before);
});
test('large legacy partition advances at most one bounded batch per request and keeps original 503 until complete',async t=>{
 const {e,call,batches}=setup(t,301),before=facts(e);for(let i=0;i<3;i++){const r=await call();assert.equal(r.status,503);assert.equal((await r.json()).error,'同步索引尚未准备完成');assert.equal(e.rows('study_sync_clock')[0].ready,0);assert.equal(batches.length,i+1);assert(batches[i].inserted<=600);}
 const ready=await call();assert.equal(ready.status,200);const body=await ready.json();assert.equal(body.owner,owner);assert.equal(body.changes.length,1);assert.equal(batches.length,4);assert.equal(e.rows('study_sync_clock')[0].ready,1);assert.equal(facts(e),before);
});
test('already-ready sync skips initialization and preserves derived index, clock and original rows',async t=>{
 const {e,call,batches}=setup(t);assert.equal((await call()).status,200);const before=facts(e),clock=JSON.stringify(e.rows('study_sync_clock')),index=JSON.stringify(e.rows('study_sync_index'));const count=batches.length,queries=e.queries.length;assert.equal((await call()).status,200);assert.equal(batches.length,count);assert(!e.queries.slice(queries).some(x=>/^INSERT|^UPDATE/i.test(x.sql.trim())));assert.equal(facts(e),before);assert.equal(JSON.stringify(e.rows('study_sync_clock')),clock);assert.equal(JSON.stringify(e.rows('study_sync_index')),index);
});
test('anonymous or invalid session never initializes; transaction failure returns 503 and authenticated retry recovers',async t=>{
 const {e,call,batches}=setup(t),before=facts(e);e.ambient({'oai-authenticated-user-id':'sites-synthetic-old-owner','oai-authenticated-user-email':'synthetic@example.invalid'});
 for(const headers of [{},{'oai-authenticated-user-id':'sites-synthetic-old-owner'},{cookie:'__Host-lantern-session='+'0'.repeat(64)}])assert.equal((await call(headers)).status,401);
 assert.equal(batches.length,0);assert.equal(e.rows('study_sync_clock').length,0);e.fault(3);assert.equal((await call()).status,503);assert.equal(e.rows('study_sync_clock').length,0);assert.equal(facts(e),before);e.fault(-1);assert.equal((await call()).status,200);assert.equal(batches.length,1);assert.equal(facts(e),before);
});
