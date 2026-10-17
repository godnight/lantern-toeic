const test=require('node:test'),assert=require('node:assert/strict');
const {environment}=require('./helpers/recording-storage-harness.cjs');
const id='00000000-0000-4000-8000-000000000047';
function fixture(t){const e=environment();t.after(()=>e.close());return e;}
function snapshot(e){return JSON.stringify({rows:e.rows(),objects:[...e.objects].map(([key,value])=>[key,value.bytes.toString('hex'),value.httpMetadata])});}
function gate(){let enter,release;return {entered:new Promise(r=>{enter=r;}),wait:new Promise(r=>{release=r;}),enter:()=>enter(),release:()=>release()};}
async function status(p){return (await p).status;}

test('same content retry is idempotent and retains the original practice date and object',async t=>{
 const e=fixture(t);assert.equal(await status(e.upload('alice',id)),200);const saved=snapshot(e);
 assert.equal(await status(e.upload('alice',id)),200);assert.equal(snapshot(e),saved);assert.equal(e.calls.put.length,1);
 const row=e.rows()[0],meta=JSON.parse(row.body);assert.equal(meta.createdAt,'2026-01-01T00:00:00.000Z');assert.match(row.object_key,/^recordings\/alice\/[^/]+\/[^/]+$/);
 assert.equal(await (await e.get('alice',id)).text(),'fixture-a');
});
test('same ID with changed bytes or immutable metadata returns 422 without touching the winner',async t=>{
 const e=fixture(t);await e.upload('alice',id);const saved=snapshot(e);
 for(const [bytes,extra] of [['fixture-b',{}],['fixture-a',{duration:9}],['fixture-a',{note:'changed'}],['fixture-a',{createdAt:'2026-01-02T00:00:00.000Z'}]])assert.equal(await status(e.upload('alice',id,bytes,extra)),422);
 assert.equal(snapshot(e),saved);assert.equal(e.calls.put.length,1);assert.equal(e.calls.delete.length,0);
});
test('an existing foreign ID is rejected before R2 writes and remains unreadable to the other owner',async t=>{
 const e=fixture(t);await e.upload('alice',id);const saved=snapshot(e);
 assert.equal(await status(e.upload('bob',id)),422);assert.equal(await status(e.get('bob',id)),404);assert.equal(snapshot(e),saved);assert.equal(e.calls.put.length,1);
});
test('legacy fixed object keys remain readable and support only identical retries',async t=>{
 const e=fixture(t),key=`recordings/alice/${id}`,meta={id,promptId:e.prompt.id,title:e.prompt.title,duration:4,createdAt:'2026-01-01T00:00:00.000Z',uploadedAt:'2026-01-02T00:00:00Z',mime:'audio/webm',note:'fixture'};
 e.objects.set(key,{bytes:Buffer.from('fixture-a'),httpMetadata:{contentType:'audio/webm'}});
 e.sqlite.prepare('INSERT INTO recordings VALUES(?,?,?,?,?)').run(id,'alice',key,JSON.stringify(meta),meta.createdAt);const before=snapshot(e);
 assert.equal(await status(e.upload('alice',id)),200);assert.equal(await status(e.upload('alice',id,'fixture-b')),422);assert.equal(snapshot(e),before);assert.equal(e.calls.put.length,0);assert.equal(await (await e.get('alice',id)).text(),'fixture-a');
});
test('missing existing object is not acknowledged or silently replaced',async t=>{
 const e=fixture(t);await e.upload('alice',id);e.objects.clear();const row=e.rows()[0];assert.equal(await status(e.upload('alice',id)),503);assert.deepEqual(e.rows()[0],row);assert.equal(e.calls.put.length,1);
});
test('R2 failures before commit and after commit with lost ACK leave no row and only clean their own key',async t=>{
 for(const hook of ['beforePut','afterPut']){const e=fixture(t);e.hooks[hook]=()=>{throw Error('R2 unavailable');};assert.equal(await status(e.upload('alice',id)),503);assert.equal(e.rows().length,0);assert.equal(e.objects.size,0);assert.equal(e.calls.delete.length,1);}
});
test('R2 readback mismatch cannot create or acknowledge a recording',async t=>{
 const e=fixture(t);e.hooks.afterPut=key=>{e.objects.get(key).bytes=Buffer.from('corrupted');};assert.equal(await status(e.upload('alice',id)),503);assert.equal(e.rows().length,0);assert.equal(e.objects.size,0);
});
test('D1 insert failure with an uncertain outcome retains its private object and retry succeeds',async t=>{
 const e=fixture(t);e.hooks.beforeSql=sql=>{if(/^insert/i.test(sql))throw Error('D1 rejected');};assert.equal(await status(e.upload('alice',id)),503);assert.equal(e.rows().length,0);assert.equal(e.objects.size,1);assert.equal(e.calls.delete.length,0);delete e.hooks.beforeSql;assert.equal(await status(e.upload('alice',id)),200);
});
test('D1 committed but lost ACK is resolved by winner readback without deleting its object',async t=>{
 const e=fixture(t);e.hooks.afterSql=sql=>{if(/^insert/i.test(sql))throw Error('Lost insert ACK');};assert.equal(await status(e.upload('alice',id)),200);assert.equal(e.rows().length,1);assert.equal(e.objects.size,1);assert.equal(e.calls.delete.length,0);assert.equal(await status(e.upload('alice',id)),200);
});
test('unknown insert outcome and failed readback preserve a possibly committed winner; next retry resolves it',async t=>{
 const e=fixture(t);let inserted=false;e.hooks.afterSql=sql=>{if(/^insert/i.test(sql)){inserted=true;throw Error('Lost ACK');}};e.hooks.beforeSql=sql=>{if(inserted&&/^select/i.test(sql))throw Error('Read unavailable');};
 assert.equal(await status(e.upload('alice',id)),503);assert.equal(e.rows().length,1);assert.equal(e.objects.size,1);assert.equal(e.calls.delete.length,0);delete e.hooks.beforeSql;delete e.hooks.afterSql;assert.equal(await status(e.upload('alice',id)),200);assert.equal(e.calls.put.length,1);
});
test('lost insert ACK and temporarily absent readback cannot delete an already committed recording',async t=>{
 const e=fixture(t);let inserted=false;
 e.hooks.afterSql=(sql,params,method,result)=>{
  if(/^insert/i.test(sql)){inserted=true;throw Error('Lost ACK');}
  if(inserted&&/^select/i.test(sql)&&Array.isArray(result))result.length=0;
  if(inserted&&/^select/i.test(sql)&&Array.isArray(result?.results))result.results.length=0;
 };
 assert.equal(await status(e.upload('alice',id)),503);assert.equal(e.rows().length,1);assert.equal(e.objects.size,1);assert.equal(e.calls.delete.length,0);
 delete e.hooks.afterSql;assert.equal(await (await e.get('alice',id)).text(),'fixture-a');assert.equal(await status(e.upload('alice',id)),200);assert.equal(e.calls.put.length,1);
});
for(const mode of ['same-owner-same-content','same-owner-different-content','cross-owner'])test('concurrent '+mode+' preserves the committed winner and cleans only the loser key',async t=>{
 const e=fixture(t),g=gate();let blocked=true;e.hooks.beforePut=async()=>{if(blocked){blocked=false;g.enter();await g.wait;}};
 const a=e.upload('alice',id);await g.entered;const owner=mode==='cross-owner'?'bob':'alice',bytes=mode==='same-owner-same-content'?'fixture-a':'fixture-b';
 const b=await e.upload(owner,id,bytes);assert.equal(b.status,200);const winner=e.rows()[0];g.release();assert.equal((await a).status,mode==='same-owner-same-content'?200:422);
 assert.deepEqual(e.rows(),[winner]);assert.equal(e.objects.size,1);assert.equal(e.objects.get(winner.object_key).bytes.toString(),bytes);assert.equal(e.calls.delete.length,1);assert.notEqual(e.calls.delete[0],winner.object_key);
});
test('loser cleanup failure cannot damage a cross-owner winner or turn conflict into success',async t=>{
 const e=fixture(t),g=gate();let blocked=true;e.hooks.beforePut=async()=>{if(blocked){blocked=false;g.enter();await g.wait;}};e.hooks.beforeDelete=()=>{throw Error('Cleanup outage');};
 const a=e.upload('alice',id);await g.entered;assert.equal(await status(e.upload('bob',id,'fixture-b')),200);const winner=e.rows()[0];g.release();assert.equal(await status(a),422);assert.deepEqual(e.rows(),[winner]);assert.equal(e.objects.size,2);assert.equal(await (await e.get('bob',id)).text(),'fixture-b');assert.equal(await status(e.get('alice',id)),404);assert.notEqual(e.calls.delete[0],winner.object_key);
});
test('existing owner and Origin gates run before storage access',async t=>{
 const e=fixture(t);assert.equal(await status(e.upload('alice',id,'fixture-a',{}, {'x-lantern-owner':'bob'})),409);assert.equal(await status(e.upload('alice',id,'fixture-a',{}, {origin:'https://foreign.test'})),403);assert.equal(e.calls.put.length,0);assert.equal(e.rows().length,0);
});
