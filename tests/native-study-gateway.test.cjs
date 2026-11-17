'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {environment:makeEnvironment, plain, ORIGIN} = require('./helpers/product-auth-harness.cjs');
// Synthetic test key only; no key is embedded or provisioned in product code.
const environment = () => {const e=makeEnvironment();e.env.LANTERN_M2A_CURSOR_KEY='11'.repeat(32);return e;};

const userRequest = (e,user,method,options={}) => e.request('study',method,{cookie:user?.cookie,owner:user?.id,...options});
const syntheticAttempt = q => ({id:randomUUID(),qid:q.id,choice:0,createdAt:new Date().toISOString(),seconds:1});

test('candidate is closed by default and requires real session, origin and matching owner',async t=>{
 const e=environment();t.after(()=>e.close());const alice=await e.register('gate_alice');const bob=await e.register('gate_bob');
 const {createNativeStudyGateway}=e.load('worker/native-study-gateway.ts');
 const make=options=>createNativeStudyGateway({env:e.env,backend:e.routes.study,...options});
 assert.equal((await make()(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1'}))).status,503);
 const missingKey=make({enabled:true,env:{...e.env,LANTERN_M2A_CURSOR_KEY:undefined}});
 assert.equal((await missingKey(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1'}))).status,503);
 const handle=make({enabled:true});
 assert.equal((await e.call('study','GET',{cookie:alice.cookie,query:'?sync=pages-v1'})).status,200);
 assert.equal((await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1',headers:{origin:null}}))).status,200,'Native GET may omit Origin');
 assert.equal((await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1',headers:{origin:'https://outside.test'}}))).status,403);
 assert.equal((await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1',headers:{'sec-fetch-site':'cross-site'}}))).status,403);
 assert.equal((await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1',headers:{origin:null,'sec-fetch-site':'same-site'}}))).status,403);
 assert.equal((await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1',headers:{origin:null,'sec-fetch-site':'invalid'}}))).status,403);
 assert.equal((await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1',headers:{origin:null,'sec-fetch-site':'same-origin'}}))).status,200);
 assert.equal((await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1',headers:{origin:null,'sec-fetch-site':'none'}}))).status,200);
 assert.equal((await handle(userRequest(e,null,'GET',{query:'?sync=native-m2a-v1',headers:{'x-oai-user-id':alice.id}}))).status,401);
 assert.equal((await handle(userRequest(e,alice,'GET',{owner:bob.id,query:'?sync=native-m2a-v1'}))).status,409);
 assert.equal((await handle(userRequest(e,alice,'POST',{headers:{origin:'https://outside.test'},body:{type:'checkin',data:{}}}))).status,403);
 assert.equal((await handle(new Request('https://outside.test/api/study?sync=native-m2a-v1',{headers:{cookie:alice.cookie,'x-lantern-owner':alice.id}}))).status,503);
 assert.equal((await handle(new Request(ORIGIN+'/api/recordings',{headers:{cookie:alice.cookie,'x-lantern-owner':alice.id}}))).status,404);
 assert.equal((await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1&userId='+bob.id}))).status,400);
 assert.equal((await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1&sync=native-m2a-v1'}))).status,400);
 assert.equal((await handle(userRequest(e,alice,'GET',{cookie:alice.cookie+'; '+alice.cookie,query:'?sync=native-m2a-v1'}))).status,401);
});

test('real application session and D1 handlers retain owner isolation and idempotence',async t=>{
 const e=environment();t.after(()=>e.close());const alice=await e.register('gate_alice2');const bob=await e.register('gate_bob2');
 const handle=e.load('worker/native-study-gateway.ts').createNativeStudyGateway({enabled:true,env:e.env,backend:e.routes.study});
 // Initialize the synthetic derived index through the existing trusted Web
 // service. The candidate itself must never initialize or migrate storage.
 assert.equal((await e.call('study','GET',{cookie:alice.cookie,query:'?sync=pages-v1'})).status,200);
 const profile=plain(e.load('lib/study-model.ts').DEFAULT_PROFILE);profile.name='Synthetic Alice';
 const post=(user,type,data)=>handle(userRequest(e,user,'POST',{body:{type,data}}));
 assert.equal((await post(alice,'profile',profile)).status,503);
 assert.equal((await e.call('study','POST',{cookie:alice.cookie,owner:alice.id,body:{type:'profile',data:profile}})).status,200);
 const q=e.load('content/questions.json')[0],a=syntheticAttempt(q);
 assert.equal((await post(alice,'attempt',a)).status,200);
 assert.equal((await post(alice,'attempt',a)).status,200);
 assert.equal((await post(alice,'attempt',{...a,choice:(a.choice+1)%q.options.length})).status,409);
 const b=syntheticAttempt(q),journal={id:randomUUID(),owner:alice.id,type:'attempt',data:{...b,correct:false,mode:'first'}};
 assert.equal((await handle(userRequest(e,alice,'POST',{body:journal}))).status,200);
 const saved=e.sqlite.prepare('SELECT correct,mode FROM attempts WHERE id=?').get(b.id);
 assert.equal(saved.correct,Number(b.choice===q.correctIndex));assert.equal(saved.mode,'review');
 assert.equal((await handle(userRequest(e,alice,'POST',{body:{...journal,owner:bob.id}}))).status,409);
 const aPage=await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1'}));assert.equal(aPage.status,200);assert.match(aPage.headers.get('cache-control'),/no-store/);
 const aData=await aPage.json();assert.equal(aData.owner,alice.id);assert.equal(aData.changes.filter(x=>x.kind==='attempt').length,2);
 assert.equal(aData.syncProtocol,'native-m2a-v1');assert.equal(typeof aData.checkpoint,'string');
 assert.equal(aData.changes.find(x=>x.kind==='attempt').data.id,a.id);assert.equal(aData.changes.find(x=>x.kind==='profile').data.name,'Synthetic Alice');
 const bPage=await handle(userRequest(e,bob,'GET',{query:'?sync=native-m2a-v1'}));assert.equal(bPage.status,200);assert.equal((await bPage.json()).changes.length,0);
 await e.call('logout','POST',{cookie:alice.cookie});assert.equal((await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1'}))).status,401);
});

test('scoped native pagination rejects Web checkpoints and other owners without leaking recording identifiers',async t=>{
 const e=environment();t.after(()=>e.close());const alice=await e.register('gate_pages_a');const bob=await e.register('gate_pages_b');
 const handle=e.load('worker/native-study-gateway.ts').createNativeStudyGateway({enabled:true,env:e.env,backend:e.routes.study});
 assert.equal((await e.call('study','GET',{cookie:alice.cookie,query:'?sync=pages-v1'})).status,200);
 const add=e.sqlite.prepare('INSERT INTO checkins(id,user_id,body,created_at) VALUES(?,?,?,?)');
 const createdAt='2026-01-01T00:00:00.000Z';let targetId;
 for(let i=0;i<102;i++){const id=randomUUID();targetId=id;add.run(id,alice.id,JSON.stringify({id,date:'2026-01-01',minutes:1,load:'轻',note:'',createdAt}),createdAt);}
 const id=randomUUID();e.sqlite.prepare('INSERT INTO recordings(id,user_id,object_key,body,created_at) VALUES(?,?,?,?,?)').run(id,alice.id,'private/audio',JSON.stringify({id,promptId:'p',title:'private',createdAt,duration:1,mime:'audio/wav'}),createdAt);
 const first=await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1'}));assert.equal(first.status,200);
 const p=await first.json();assert.equal(p.changes.length,100);assert.equal(p.checkpoint,null);assert.ok(p.nextCursor);
 assert.match(p.nextCursor,/^n1\.[A-Za-z0-9_-]+$/);assert.equal(p.nextCursor.length,2089);
 assert.ok(p.changes.every(change=>!('revision' in change)),'global revisions are never returned');
 assert.equal((await handle(userRequest(e,bob,'GET',{query:'?sync=native-m2a-v1&cursor='+encodeURIComponent(p.nextCursor)}))).status,409);
 assert.equal((await e.call('study','GET',{cookie:alice.cookie,query:'?sync=pages-v1&cursor='+encodeURIComponent(p.nextCursor)})).status,400,'Web must reject native cursor');
 const last=await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1&cursor='+encodeURIComponent(p.nextCursor)}));assert.equal(last.status,200);
 const q=await last.json();assert.equal(q.changes.length,2);assert.equal(q.changes.at(-1).id,targetId);assert.equal(typeof q.checkpoint,'string');
 const nativeCheckpoint=q.checkpoint;
 const upToDate=await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1&checkpoint='+nativeCheckpoint}));assert.equal(upToDate.status,200);assert.deepEqual((await upToDate.json()).changes,[]);
 assert.equal(nativeCheckpoint.length,2089);assert.equal((await e.call('study','GET',{cookie:alice.cookie,query:'?sync=pages-v1&checkpoint='+nativeCheckpoint})).status,400,'Web must reject native checkpoint');
 let webData=await (await e.call('study','GET',{cookie:alice.cookie,query:'?sync=pages-v1'})).json();
 while(webData.nextCursor)webData=await (await e.call('study','GET',{cookie:alice.cookie,query:'?sync=pages-v1&cursor='+encodeURIComponent(webData.nextCursor)})).json();
 assert.ok(webData.checkpoint);
 const webCheckpoint=Buffer.from(JSON.stringify(webData.checkpoint)).toString('base64url');
 const mismatch=await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1&checkpoint='+webCheckpoint}));assert.equal(mismatch.status,409);assert.equal((await mismatch.json()).resetRequired,true);
 assert.equal((await handle(userRequest(e,alice,'GET',{query:'?sync=pages-v1'}))).status,400);
});

test('server-secret encrypted fixed-size tokens hide other owners activity and fail closed on tampering or rotation',async t=>{
 const e=environment();t.after(()=>e.close());const alice=await e.register('gate_secret_a');const bob=await e.register('gate_secret_b');
 assert.equal((await e.call('study','GET',{cookie:alice.cookie,query:'?sync=pages-v1'})).status,200);
 const handle=e.load('worker/native-study-gateway.ts').createNativeStudyGateway({enabled:true,env:e.env,backend:e.routes.study});
 const read=()=>handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1'}));
 const before=await (await read()).json();assert.deepEqual(before.changes,[]);assert.equal(before.hasProfile,false);assert.equal(before.profilePolicy,'preserve-local-when-absent');assert.equal(before.checkpoint.length,2089);
 const createdAt='2026-01-01T00:00:00.000Z',id=randomUUID();
 e.sqlite.prepare('INSERT INTO recordings(id,user_id,object_key,body,created_at) VALUES(?,?,?,?,?)').run(id,bob.id,'private/audio',JSON.stringify({id,promptId:'secret',title:'private',createdAt,duration:1,mime:'audio/wav'}),createdAt);
 const after=await (await read()).json();assert.deepEqual(after.changes,[]);assert.equal(after.checkpoint.length,before.checkpoint.length);
 assert.notEqual(after.checkpoint,before.checkpoint,'fresh random nonce for each token');
 assert.doesNotMatch(JSON.stringify({...after,checkpoint:'opaque'}),/revision|private\/audio|secret|audio\/wav/);
 const cross=await handle(userRequest(e,bob,'GET',{query:'?sync=native-m2a-v1&checkpoint='+encodeURIComponent(after.checkpoint)}));assert.equal(cross.status,409);
 const i=15,tampered=after.checkpoint.slice(0,i)+(after.checkpoint[i]==='A'?'B':'A')+after.checkpoint.slice(i+1);
 const bad=await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1&checkpoint='+encodeURIComponent(tampered)}));assert.equal(bad.status,409);assert.equal((await bad.json()).resetRequired,true);
 e.env.LANTERN_M2A_CURSOR_KEY='22'.repeat(32);
 const rotated=await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1&checkpoint='+encodeURIComponent(after.checkpoint)}));assert.equal(rotated.status,409);assert.equal((await rotated.json()).resetRequired,true);
});

test('M2a reads five kinds while four conflict-safe write kinds preserve validation',async t=>{
 const e=environment();t.after(()=>e.close());const alice=await e.register('gate_types_a');
 assert.equal((await e.call('study','GET',{cookie:alice.cookie,query:'?sync=pages-v1'})).status,200);
 const handle=e.load('worker/native-study-gateway.ts').createNativeStudyGateway({enabled:true,env:e.env,backend:e.routes.study});
 const q=e.load('content/questions.json')[0],resource=e.load('content/resources-v2.ts').resources[0];const now=new Date().toISOString();
 const rows=[['profile',plain(e.load('lib/study-model.ts').DEFAULT_PROFILE)],['attempt',syntheticAttempt(q)],['checkin',{id:randomUUID(),date:'2026-01-01',minutes:5,load:'轻',note:'',createdAt:now}],['questionMark',{qid:q.id,flagged:true,reason:null,note:'',revision:1,mutationId:randomUUID(),updatedAt:now}],['resourceTask',{id:randomUUID(),resourceId:resource.id,plannedDate:'2026-01-01',status:'planned',minutes:5,checkinId:null,revision:1,mutationId:randomUUID(),updatedAt:now}]];
 const [profile]=rows;assert.equal((await handle(userRequest(e,alice,'POST',{body:{type:profile[0],data:profile[1]}}))).status,503);
 assert.equal((await e.call('study','POST',{cookie:alice.cookie,owner:alice.id,body:{type:profile[0],data:profile[1]}})).status,200);
 for(const [type,data] of rows.slice(1))assert.equal((await handle(userRequest(e,alice,'POST',{body:{type,data}}))).status,200,type);
 const r=await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1'}));assert.equal(r.status,200);
 assert.deepEqual(new Set((await r.json()).changes.map(x=>x.kind)),new Set(rows.map(x=>x[0])));
});

test('unready index fails closed and bounded pages retain all permitted records',async t=>{
 const e=environment();t.after(()=>e.close());const alice=await e.register('gate_bounds_a');
 const handle=e.load('worker/native-study-gateway.ts').createNativeStudyGateway({enabled:true,env:e.env,backend:e.routes.study});
 assert.equal((await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1'}))).status,503);
 assert.equal(e.sqlite.prepare('SELECT count(*) n FROM study_sync_clock').get().n,0,'candidate does not initialize or migrate storage');
 assert.equal((await e.call('study','GET',{cookie:alice.cookie,query:'?sync=pages-v1'})).status,200);
 const insert=e.sqlite.prepare('INSERT INTO checkins(id,user_id,body,created_at) VALUES(?,?,?,?)'),ids=new Set();
 const createdAt='2026-01-01T00:00:00.000Z';
 for(let i=0;i<102;i++){const id=randomUUID();ids.add(id);insert.run(id,alice.id,JSON.stringify({id,date:'2026-01-01',minutes:1,load:'轻',note:'学'.repeat(1000),createdAt}),createdAt);}
 let next=null,pages=0;const seen=new Set();
 do{
  const r=await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1'+(next?'&cursor='+encodeURIComponent(next):'')}));assert.equal(r.status,200);
  const raw=await r.text();assert.ok(Buffer.byteLength(raw)<=256*1024);
  const p=JSON.parse(raw);for(const change of p.changes){assert.ok(!seen.has(change.id));seen.add(change.id);}
  next=p.nextCursor;pages++;assert.ok(pages<5);
 }while(next);
 assert.ok(pages>=2);assert.deepEqual(seen,ids);
});

test('stale profile replay is blocked until an atomic conflict contract exists',async t=>{
 const e=environment();t.after(()=>e.close());const alice=await e.register('gate_profile_a');
 const profile=plain(e.load('lib/study-model.ts').DEFAULT_PROFILE);
 const web=(value)=>e.call('study','POST',{cookie:alice.cookie,owner:alice.id,body:{type:'profile',data:value}});
 assert.equal((await web({...profile,name:'Earlier'})).status,200);
 const stale={...profile,name:'Stale device'};assert.equal((await web({...profile,name:'Newer device'})).status,200);
 const handle=e.load('worker/native-study-gateway.ts').createNativeStudyGateway({enabled:true,env:e.env,backend:e.routes.study});
 const response=await handle(userRequest(e,alice,'POST',{body:{type:'profile',data:stale}}));
 assert.equal(response.status,503);assert.equal((await response.json()).code,'profile-sync-not-ready');
 assert.equal(JSON.parse(e.sqlite.prepare('SELECT body FROM profiles WHERE user_id=?').get(alice.id).body).name,'Newer device');
});

test('private-media and unsupported mutation kinds are never forwarded; byte limits are enforced',async t=>{
 const e=environment();t.after(()=>e.close());const alice=await e.register('gate_alice3');let calls=0;
 const backend={GET:e.routes.study.GET,POST:async r=>{calls++;return e.routes.study.POST(r)}};
 const handle=e.load('worker/native-study-gateway.ts').createNativeStudyGateway({enabled:true,env:e.env,backend});
 for(const type of ['recording','recordingAudio','exam','vocabulary','theme','syncState']){
  const r=await handle(userRequest(e,alice,'POST',{body:{type,data:{id:'synthetic',audio:'never-send'}}}));assert.equal(r.status,400,type);
 }
 const extra=await handle(userRequest(e,alice,'POST',{body:{type:'profile',data:{},recordings:['private']}}));assert.equal(extra.status,400);
 const hiddenAudio=await handle(userRequest(e,alice,'POST',{body:{type:'checkin',data:{id:randomUUID(),date:'2026-01-01',minutes:1,load:'轻',note:'',createdAt:new Date().toISOString(),audio:'private'}}}));assert.equal(hiddenAudio.status,400);
 const large=await handle(userRequest(e,alice,'POST',{body:JSON.stringify({type:'checkin',data:{note:'x'.repeat(9000)}}),headers:{'content-type':'application/json'}}));assert.equal(large.status,413);
 assert.equal(calls,0);
});

test('private recording rows are excluded in SQL and never appear in data or cursor',async t=>{
 const e=environment();t.after(()=>e.close());const alice=await e.register('gate_alice4');
 const handle=e.load('worker/native-study-gateway.ts').createNativeStudyGateway({enabled:true,env:e.env,backend:e.routes.study});
 const insert=e.sqlite.prepare('INSERT INTO recordings(id,user_id,object_key,body,created_at) VALUES(?,?,?,?,?)');
 for(let i=0;i<102;i++){
  const id=randomUUID(),createdAt='2026-01-01T00:00:00.000Z';
  insert.run(id,alice.id,'private/audio/'+id,JSON.stringify({id,promptId:'private-prompt',title:'never-export-recording-title',createdAt,duration:1,mime:'audio/wav'}),createdAt);
 }
 assert.equal((await e.call('study','GET',{cookie:alice.cookie,query:'?sync=pages-v1'})).status,200);
 let next=null,pages=0;do{
  const r=await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1'+(next?'&cursor='+encodeURIComponent(next):'')}));
  assert.equal(r.status,200);const text=await r.text();assert.doesNotMatch(text,/never-export-recording-title|private-prompt|audio\/wav|private\/audio/);
  const page=JSON.parse(text);assert.deepEqual(page.changes,[]);next=page.nextCursor;pages++;
  assert.ok(pages<5);
 }while(next);
 assert.equal(pages,1);
});

test('malformed write responses and unexpected stored profile fields fail closed',async t=>{
 const e=environment();t.after(()=>e.close());const alice=await e.register('gate_alice5');const bob=await e.register('gate_bob5');
 const {createNativeStudyGateway}=e.load('worker/native-study-gateway.ts');
 assert.equal((await e.call('study','GET',{cookie:alice.cookie,query:'?sync=pages-v1'})).status,200);
 const backend={POST:async()=>Response.json({ok:true,private:'never'})};
 const handle=createNativeStudyGateway({enabled:true,env:e.env,backend});
 const profile={...plain(e.load('lib/study-model.ts').DEFAULT_PROFILE),privateRecording:'must-not-leak'};
 e.sqlite.prepare('INSERT INTO profiles(user_id,body,updated_at) VALUES(?,?,?)').run(alice.id,JSON.stringify(profile),'2026-01-01T00:00:00.000Z');
 const r=await handle(userRequest(e,alice,'GET',{query:'?sync=native-m2a-v1'}));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/must-not-leak/);
 delete profile.privateRecording;
 assert.equal((await handle(userRequest(e,alice,'POST',{body:{type:'attempt',data:syntheticAttempt(e.load('content/questions.json')[0])}}))).status,503);
});
