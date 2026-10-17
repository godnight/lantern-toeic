'use strict';

// Execute personal Sites routes/SQLite with a synthetic platform identity header.
// No direct import of the proposed helper: old-source RED is behavioral.
const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const root=path.resolve(process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..'));
const {environment,ORIGIN,plain}=require(path.join(root,'tests/helpers/sites-route-harness.cjs'));
const caps={study:200000,vocabulary:100000,recordings:13000000};
const tables=['profiles','attempts','checkins','recordings','question_marks','resource_tasks','vocabulary_events','exam_library'];
const stamp='2026-10-15T10:00:00.000Z';
const marker='汉🙂';
const audio=Buffer.from('synthetic bytes only; not a real recording');
const boundary='----lantern-r-route-synthetic';

function seed(e,user){
 const model=e.load('lib/study-model.ts'),qid=e.load('content/questions.json')[0].id;
 const profile={...plain(model.DEFAULT_PROFILE),name:'retained '+user.username,examDate:'2028-02-29'};
 e.sqlite.prepare('INSERT INTO profiles(user_id,body,updated_at) VALUES(?,?,?)').run(user.id,JSON.stringify(profile),stamp);
 const attemptId=randomUUID(),checkinId=randomUUID(),recordingId=randomUUID(),taskId=randomUUID(),mutationId=randomUUID();
 e.sqlite.prepare('INSERT INTO attempts(id,user_id,qid,choice,correct,created_at,seconds,mode) VALUES(?,?,?,?,?,?,?,?)').run(attemptId,user.id,qid,0,0,stamp,1,'first');
 const checkin={id:checkinId,date:'2026-10-15',minutes:1,load:'轻',note:'preserve exact '+marker,createdAt:stamp};
 e.sqlite.prepare('INSERT INTO checkins(id,user_id,body,created_at) VALUES(?,?,?,?)').run(checkinId,user.id,JSON.stringify(checkin),stamp);
 const key='seed-recordings/'+user.id+'/'+recordingId;
 e.sqlite.prepare('INSERT INTO recordings(id,user_id,object_key,body,created_at) VALUES(?,?,?,?,?)').run(recordingId,user.id,key,JSON.stringify({id:recordingId,note:'retained metadata'}),stamp);
 e.objects.set(key,{bytes:Buffer.from('retained object '+marker),httpMetadata:{contentType:'audio/webm',cacheControl:'private'}});
 const mark={qid,flagged:true,reason:'timing',note:'retained',revision:1,mutationId,updatedAt:stamp};
 e.sqlite.prepare('INSERT INTO question_marks(user_id,entity_id,body,revision,cancelled,mutation_id) VALUES(?,?,?,?,?,?)').run(user.id,qid,JSON.stringify(mark),1,0,mutationId);
 const task={id:taskId,resourceId:'retained',plannedDate:'2026-10-15',status:'planned',minutes:1,checkinId:null,revision:1,mutationId,updatedAt:stamp};
 e.sqlite.prepare('INSERT INTO resource_tasks(user_id,entity_id,body,revision,cancelled,mutation_id) VALUES(?,?,?,?,?,?)').run(user.id,taskId,JSON.stringify(task),1,0,mutationId);
 const event={id:randomUUID(),wordId:'retained-word',createdAt:stamp,type:'review',grade:'again'};
 e.sqlite.prepare('INSERT INTO vocabulary_events(user_id,event_id,body) VALUES(?,?,?)').run(user.id,event.id,JSON.stringify(event));
 const examId=randomUUID(),examKey='seed-exams/'+user.id+'/'+examId;
 e.sqlite.prepare('INSERT INTO exam_library(id,user_id,object_key,manifest,bytes,sha256,state,created_at) VALUES(?,?,?,?,?,?,?,?)').run(examId,user.id,examKey,JSON.stringify({id:examId,note:'retained manifest'}),3,'0'.repeat(64),'ready',stamp);
 e.objects.set(examKey,{bytes:Buffer.from([0,128,255]),httpMetadata:{contentType:'application/json'}});
}
async function setup(t){
 const e=environment();t.after(()=>e.close());
 const alice=await e.register('alice'),bob=await e.register('bob');seed(e,alice);seed(e,bob);
 return {e,alice,bob};
}
function snapshot(e){return {rows:Object.fromEntries(tables.map(name=>[name,e.rows(name)])),
 objects:[...e.objects].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>({key,bytes:Buffer.from(value.bytes).toString('hex'),httpMetadata:plain(value.httpMetadata??null)})),
 puts:e.storage.puts,deletes:e.storage.deletes};}
function unchanged(e,before,label){assert.deepEqual(snapshot(e),before,label+': full business rows/R2 bytes/metadata/put-delete counters changed');}
function foreignRows(e,owner){return Object.fromEntries(tables.map(name=>[name,e.rows(name).filter(row=>row.user_id!==owner)]));}

function payload(e,route,bob,target,options={}){
 let bytes,contentType='application/json',spec={route};
 if(route==='study'){
  spec.profile={...plain(e.load('lib/study-model.ts').DEFAULT_PROFILE),name:'bounded '+marker,examDate:'2028-02-29'};
  const value={type:'profile',data:{...spec.profile,userId:bob.id},owner:bob.id,padding:marker};
  const base=Buffer.byteLength(JSON.stringify(value));if(target!==undefined){assert.ok(target>=base);value.padding+='x'.repeat(target-base);}
  bytes=Buffer.from(JSON.stringify(value));
 }else if(route==='vocabulary'){
  spec.event={id:randomUUID(),wordId:'bounded-word',createdAt:stamp,type:'review',grade:'remembered'};
  const value={kind:'lantern-vocabulary',schemaVersion:1,events:[{...spec.event,userId:bob.id}],owner:bob.id,padding:marker};
  const base=Buffer.byteLength(JSON.stringify(value));if(target!==undefined){assert.ok(target>=base);value.padding+='x'.repeat(target-base);}
  bytes=Buffer.from(JSON.stringify(value));
 }else{
  spec.meta={id:randomUUID(),promptId:e.load('content/speaking.json')[0].id,createdAt:stamp,duration:1,userId:bob.id,note:'bounded '+marker};
  spec.audio=options.audioBytes??audio;contentType='multipart/form-data; boundary='+boundary;
  const prefix=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="meta"\r\n\r\n'+JSON.stringify(spec.meta)+'\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="audio"; filename="synthetic.webm"\r\nContent-Type: audio/webm\r\n\r\n'),spec.audio,
   Buffer.from('\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="ignored-padding"\r\n\r\n'+marker)]);
  const suffix=Buffer.from('\r\n--'+boundary+'--\r\n');
  const base=prefix.length+suffix.length;const fill=target===undefined?0:target-base;assert.ok(fill>=0);
  bytes=Buffer.concat([prefix,Buffer.alloc(fill,120),suffix]);
 }
 if(target!==undefined)assert.equal(bytes.length,target,'Fixture must be exact UTF-8 byte length');
 return {...spec,bytes,contentType};
}

// The first UTF-8 marker is cut inside both the Han character and emoji.
// All other chunks are <=64KiB. No decoding occurs in this stream fixture.
function chunksFor(bytes){
 const at=bytes.indexOf(Buffer.from(marker));
 const cuts=[0,bytes.length];if(at>=0)cuts.push(at+1,at+4);
 for(let n=65536;n<bytes.length;n+=65536)cuts.push(n);
 const sorted=[...new Set(cuts.filter(n=>n>=0&&n<=bytes.length))].sort((a,b)=>a-b);
 return sorted.slice(1).map((end,i)=>bytes.subarray(sorted[i],end));
}
function streamed(route,user,spec,{length,gate,errorAt,cancelNever=false}={}){
 const stats={pulls:0,bytes:0,cancels:0,readerCalls:0,bodyMethods:[]};
 const chunks=chunksFor(spec.bytes);let index=0;
 const body=new ReadableStream({
  start(controller){if(errorAt==='immediate')controller.error(Error('synthetic immediate body read failure'));},
  pull(controller){stats.pulls++;
   if(errorAt==='middle'&&index===1){controller.error(Error('synthetic interrupted body'));return;}
   if(index===chunks.length){controller.close();return;}
   const part=chunks[index++];stats.bytes+=part.byteLength;controller.enqueue(new Uint8Array(part));
  },
  cancel(){stats.cancels++;if(cancelNever)return new Promise(()=>{});},
 },{highWaterMark:0});
 const headers=new Headers({'content-type':spec.contentType,origin:ORIGIN,cookie:user.cookie,'x-lantern-owner':user.id});
 if(length!==undefined)headers.set('content-length',length);
 if(gate==='no-session')headers.delete('cookie');
 if(gate==='wrong-owner')headers.set('x-lantern-owner','usr_ffffffff-ffff-4fff-8fff-ffffffffffff');
 if(gate==='bad-origin')headers.set('origin','https://foreign.invalid');
 if(gate==='cross-site')headers.set('sec-fetch-site','cross-site');
 const request=new Request(ORIGIN+'/api/'+route,{method:'POST',headers,body,duplex:'half'});
 for(const name of ['json','text','formData']){
  const original=request[name].bind(request);
  Object.defineProperty(request,name,{value(...args){stats.bodyMethods.push(name);return original(...args);}});
 }
 const reader=request.body.getReader.bind(request.body);
 Object.defineProperty(request.body,'getReader',{value(...args){stats.readerCalls++;return reader(...args);}});
 return {request,stats,chunks};
}
async function rejected(e,route,probe,status,before,label){
 let response;try{
  await assert.doesNotReject(async()=>{response=await e.routes[route].POST(probe.request);},label+': route leaked a body exception');
  assert.equal(response.status,status,label);assert.match(response.headers.get('cache-control'),/private/);
 }finally{unchanged(e,before,label);}
 return response;
}
async function accepted(e,route,probe,spec,alice,bob,before){
 const foreign=foreignRows(e,alice.id),response=await e.routes[route].POST(probe.request);
 assert.equal(response.status,200,route+' legal exact-byte request');assert.equal((await response.json()).ok,true);
 assert.deepEqual(foreignRows(e,alice.id),foreign,'Forged payload owner changed foreign rows');
 if(route==='study'){
  const row=e.rows('profiles').find(row=>row.user_id===alice.id);assert.deepEqual(JSON.parse(row.body),spec.profile);
 }else if(route==='vocabulary'){
  const row=e.rows('vocabulary_events').find(row=>row.event_id===spec.event.id);assert.ok(row);assert.equal(row.user_id,alice.id);
  assert.deepEqual(JSON.parse(row.body),spec.event);
 }else{
  const row=e.rows('recordings').find(row=>row.id===spec.meta.id);assert.ok(row);assert.equal(row.user_id,alice.id);
  assert.ok(row.object_key.startsWith('recordings/'+alice.id+'/'+spec.meta.id+'/'));
  assert.match(row.object_key.split('/').at(-1),/^[a-f0-9-]{36}$/);
  assert.deepEqual(e.objects.get(row.object_key).bytes,spec.audio);
  assert.equal(JSON.parse(row.body).createdAt,stamp);assert.equal(e.storage.puts-before.puts,1);
 }
 assert.equal(e.storage.deletes-before.deletes,0);assert.notEqual(alice.id,bob.id);
}

for(const route of Object.keys(caps))test('R-ROUTE '+route+': exact UTF-8 bounds, headers, read failures, and authorization',async t=>{
 const {e,alice,bob}=await setup(t),cap=caps[route];
 for(const boundaryCase of [
  {name:'cap-1 absent length',size:cap-1},
  {name:'cap with forged-large length',size:cap,length:'999999999'},
  {name:'cap+1 absent length',size:cap+1},
  {name:'cap+1 forged-small length',size:cap+1,length:'1'},
 ])await t.test(boundaryCase.name,async()=>{
  const spec=payload(e,route,bob,boundaryCase.size),probe=streamed(route,alice,spec,{length:boundaryCase.length}),before=snapshot(e);
  assert.ok(probe.chunks.length>1);assert.ok(spec.bytes.includes(Buffer.from(marker)));
  // The JSON fixture is deliberately fewer JS code units than wire bytes.
  if(route!=='recordings')assert.ok(spec.bytes.toString('utf8').length<spec.bytes.length);
  if(boundaryCase.size>cap){await rejected(e,route,probe,413,before,boundaryCase.name);
   assert.equal(probe.stats.bodyMethods.includes('formData'),false,'Overflow must be rejected before unbounded multipart parsing');
  }else await accepted(e,route,probe,spec,alice,bob,before);
 });
 for(const length of ['not-a-number','-1','Infinity'])await t.test('untrusted length '+length,async()=>{
  const spec=payload(e,route,bob),probe=streamed(route,alice,spec,{length}),before=snapshot(e);
  await accepted(e,route,probe,spec,alice,bob,before);
 });
 for(const errorAt of ['immediate','middle'])await t.test('stream read error '+errorAt+' is 503, not malformed 400',async()=>{
  const spec=payload(e,route,bob),probe=streamed(route,alice,spec,{errorAt}),before=snapshot(e);
  await rejected(e,route,probe,503,before,errorAt);
 });
 await t.test('fully readable malformed body retains 400',async()=>{
  const spec=payload(e,route,bob);spec.bytes=Buffer.from(route==='recordings'?'not a multipart form':'{');
  await rejected(e,route,streamed(route,alice,spec),400,snapshot(e),'malformed format');
 });
 for(const [gate,status]of [['no-session',401],['wrong-owner',409],['bad-origin',403],['cross-site',403]])await t.test('gate '+gate+' precedes all reads',async()=>{
  const spec=payload(e,route,bob),probe=streamed(route,alice,spec,{gate}),before=snapshot(e);
  await rejected(e,route,probe,status,before,gate);
  assert.equal(probe.stats.pulls,0);assert.equal(probe.stats.bytes,0);assert.equal(probe.stats.readerCalls,0);
  assert.deepEqual(probe.stats.bodyMethods,[],'Authorization gate called a body parser');
 });
});

test('R-ROUTE bounded study requests retain the F04 profile/checkin date gate',async t=>{
 const {e,alice,bob}=await setup(t),model=e.load('lib/study-model.ts');
 const cases=[{type:'profile',data:{...plain(model.DEFAULT_PROFILE),name:'invalid synthetic',examDate:'2026-02-30'}},
  {type:'checkin',data:{id:randomUUID(),date:'2026-02-30',minutes:1,load:'轻',note:'synthetic',createdAt:stamp}}];
 for(const value of cases)await t.test(value.type,async()=>{
  const spec={bytes:Buffer.from(JSON.stringify(value)),contentType:'application/json'};
  await rejected(e,'study',streamed('study',alice,spec),400,snapshot(e),'F04 '+value.type);
 });
 assert.notEqual(alice.id,bob.id);
});

test('R-ROUTE multipart overall cap does not replace the existing 12000000-byte audio rule',async t=>{
 const {e,alice,bob}=await setup(t),spec=payload(e,'recordings',bob,undefined,{audioBytes:Buffer.alloc(12000001,120)});
 assert.ok(spec.bytes.length<caps.recordings,'This must isolate the file rule, not overall size');
 await rejected(e,'recordings',streamed('recordings',alice,spec),400,snapshot(e),'existing audio-file limit');
});

test('R-ROUTE overflow cancellation is attempted without awaiting a never-settling source cancel',async t=>{
 const {e,alice,bob}=await setup(t),spec=payload(e,'study',bob,caps.study+1),probe=streamed('study',alice,spec,{cancelNever:true});
 const before=snapshot(e);let timer;
 try{
  const outcome=await Promise.race([e.routes.study.POST(probe.request).then(response=>({response})),new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),2000);})]);
  assert.equal(outcome.timeout,undefined,'Route awaited an untrusted cancellation promise');
  assert.equal(outcome.response.status,413);assert.ok(probe.stats.cancels>=1,'Overflow did not attempt source cancellation');
 }finally{clearTimeout(timer);unchanged(e,before,'nonblocking cancellation');}
});
