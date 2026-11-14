'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const {environment}=require('./helpers/product-auth-harness.cjs');
const root=path.resolve(__dirname,'..'),loader=createSourceLoader({root});
const native=loader.load('lib/native-study-m2a.ts'),model=loader.load('lib/study-model.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),owner='usr_00000000-0000-4000-8000-000000000001',other='usr_00000000-0000-4000-8000-000000000002';
const tok=ch=>'n1.'+ch.repeat(2086), date='2026-01-01T10:00:00.000Z';
const lease=(who=owner)=>({owner:who,signal:new AbortController().signal,isCurrent:()=>true});
const data=()=>{const d=plain(model.EMPTY_DATA);d.profile={...d.profile,name:'Local name',theme:'hollow'};d.recordings=[{id:randomUUID(),promptId:'private',title:'local-only',createdAt:date,duration:8,mime:'audio/wav'}];return d;};
const snapshot=(overrides={})=>({version:1,stateVersion:0,owner,data:data(),download:{checkpoint:null,continuation:null,pendingProfiles:[]},pendingOperations:[],uploadAcks:[],...overrides});
const request=s=>({owner:s.owner,stateVersion:s.stateVersion,checkpoint:s.download.checkpoint,continuation:s.download.continuation});
const project=(s,p,l)=>native.projectNativeStudyPage(s,p,request(s),l);
const page=(overrides={})=>({syncProtocol:'native-m2a-v1',schemaVersion:2,owner,hasProfile:false,profilePolicy:'preserve-local-when-absent',changes:[],nextCursor:null,checkpoint:tok('A'),...overrides});
const attempt=(overrides={})=>({id:randomUUID(),qid:'synthetic-q',choice:0,correct:false,createdAt:date,seconds:3,mode:'first',...overrides});
const checkin=(overrides={})=>({id:randomUUID(),date:'2026-01-01',minutes:4,load:'轻',note:'',createdAt:date,...overrides});
const mark=(overrides={})=>({qid:'synthetic-q',flagged:true,reason:null,note:'',revision:1,mutationId:randomUUID(),updatedAt:date,...overrides});
const task=(overrides={})=>({id:randomUUID(),resourceId:'synthetic-resource',plannedDate:'2026-01-01',status:'planned',minutes:5,checkinId:null,revision:1,mutationId:randomUUID(),updatedAt:date,...overrides});

test('missing profile preserves local settings and private recording; remote settings are held for review',()=>{
 const start=snapshot(),before=JSON.stringify(start),empty=project(start,page(),lease());
 assert.equal(JSON.stringify(start),before);assert.deepEqual(plain(empty.data.profile),plain(start.data.profile));assert.deepEqual(plain(empty.data.recordings),plain(start.data.recordings));
 const remote={...start.data.profile,name:'Remote name',theme:'paper'},next=project(empty,page({hasProfile:true,changes:[{kind:'profile',id:owner,data:remote}],checkpoint:tok('B')}),lease());
 assert.deepEqual(plain(next.data.profile),plain(start.data.profile));assert.deepEqual(plain(next.download.pendingProfiles),[remote]);
 const repeated=project(next,page({hasProfile:true,changes:[{kind:'profile',id:owner,data:remote}],checkpoint:tok('C')}),lease());
 assert.equal(repeated.download.pendingProfiles.length,1);assert.equal(repeated.download.checkpoint,tok('C'));
});

test('page replay, immutable conflicts, mutable revision order and local-only data',()=>{
 const first=attempt(),oldMark=mark(),oldTask=task(),start=snapshot();start.data.attempts=[first];start.data.questionMarks=[oldMark];start.data.resourceTasks=[oldTask];
 const server={...first,correct:true,mode:'review'},check=checkin(),newMark={...oldMark,revision:2,mutationId:randomUUID(),note:'newer'},staleTask={...oldTask,status:'completed'};
 const payload=page({changes:[{kind:'attempt',id:first.id,data:server},{kind:'checkin',id:check.id,data:check},{kind:'questionMark',id:newMark.qid,data:newMark},{kind:'resourceTask',id:staleTask.id,data:staleTask}]});
 const out=project(start,payload,lease());assert.equal(out.data.attempts[0].correct,true);assert.equal(out.data.attempts[0].mode,'review');assert.equal(out.data.checkins.length,1);
 assert.equal(out.data.questionMarks[0].revision,2);assert.equal(out.data.resourceTasks[0].revision,1);assert.deepEqual(plain(out.data.recordings),plain(start.data.recordings));
 const again=project(out,payload,lease());assert.equal(again.data.attempts.length,1);assert.equal(again.data.checkins.length,1);
 const before=JSON.stringify(start),bad=page({changes:[{kind:'attempt',id:first.id,data:{...server,choice:1}}]});
 assert.throws(()=>project(start,bad,lease()));assert.equal(JSON.stringify(start),before);
});

test('projection produces an independent copy and replay with a fresh token is idempotent',()=>{
 const event=checkin(),op={id:randomUUID(),owner,type:'checkin',data:event},start=snapshot({pendingOperations:[op]});
 const payload=page({changes:[{kind:'checkin',id:event.id,data:event}]}),out=project(start,payload,lease());
 const replay=project(out,page({changes:payload.changes,checkpoint:tok('B')}),lease());
 assert.equal(replay.data.checkins.length,1);
 out.data.recordings[0].title='changed after projection';out.pendingOperations[0].data.note='changed after projection';
 out.uploadAcks.push({id:op.id,fingerprint:'a'.repeat(64)});
 assert.equal(start.data.recordings[0].title,'local-only');assert.equal(start.pendingOperations[0].data.note,'');assert.equal(start.uploadAcks.length,0);
});

test('native page is strict, owner-bound, size-limited and cannot carry recordings or Web tokens',()=>{
 const start=snapshot();for(const change of [
  {kind:'recording',id:'r',data:{id:'r'}},
  {kind:'checkin',id:'x',data:{...checkin(),audio:'private'}},
  {kind:'profile',id:owner,data:start.data.profile},
 ])assert.throws(()=>project(start,page({changes:[change]}),lease()));
 assert.throws(()=>project(start,page({owner:other}),lease()));
 assert.throws(()=>project(start,page({syncProtocol:'pages-v1'}),lease()));
 assert.throws(()=>project(start,page({checkpoint:'eyJ2ZXJzaW9uIjoxfQ'}),lease()));
 assert.throws(()=>project(start,page({checkpoint:tok('A'),nextCursor:tok('B')}),lease()));
 assert.throws(()=>project(start,page({changes:Array.from({length:101},()=>({kind:'checkin',id:'x',data:checkin()}))}),lease()));
 assert.throws(()=>project(start,page({changes:[],extra:'recording'}),lease()));
});

test('continuation and checkpoint progress are separate from upload acknowledgements',async()=>{
 const a=attempt(),op={id:randomUUID(),owner,type:'attempt',data:a},start=snapshot({pendingOperations:[op]});
 const projected=project(start,page({nextCursor:tok('B'),checkpoint:null}),lease());
 assert.equal(projected.download.checkpoint,null);assert.equal(projected.download.continuation,tok('B'));assert.equal(projected.uploadAcks.length,0);
 assert.throws(()=>project(projected,page({nextCursor:tok('B'),checkpoint:null}),lease()));
 const finished=project(projected,page({checkpoint:tok('C')}),lease());assert.equal(finished.download.checkpoint,tok('C'));assert.equal(finished.download.continuation,null);
 const prepared=await native.prepareNativeUpload(op,lease());assert.equal('correct' in prepared.wire.data,false);assert.equal('mode' in prepared.wire.data,false);assert.match(prepared.fingerprint,/^[0-9a-f]{64}$/);
 const acked=await native.acknowledgeNativeUpload(finished,prepared,{status:200,body:{ok:true}},lease());
 assert.equal(acked.uploadAcks.length,1);assert.equal(acked.pendingOperations.length,1,'ack does not delete the durable journal');assert.equal(acked.download.checkpoint,tok('C'));
 const replay=await native.acknowledgeNativeUpload(acked,prepared,{status:200,body:{ok:true}},lease());assert.deepEqual(plain(replay),plain(acked),'replay is idempotent');assert.notEqual(replay,acked,'replay must not alias input');
 await assert.rejects(native.acknowledgeNativeUpload(finished,prepared,{status:500,body:{ok:true}},lease()));
 await assert.rejects(native.acknowledgeNativeUpload({...finished,pendingOperations:[{...op,data:{...a,choice:1}}]},prepared,{status:200,body:{ok:true}},lease()));
 await assert.rejects(native.acknowledgeNativeUpload({...finished,pendingOperations:[op,op]},prepared,{status:200,body:{ok:true}},lease()));
});

test('response must match the original request state across initial, continued, and completed rounds',()=>{
 const initial=snapshot(),initialRequest=request(initial);
 const midway=native.projectNativeStudyPage(initial,page({nextCursor:tok('B'),checkpoint:null}),initialRequest,lease());
 assert.equal(midway.stateVersion,1);const before=JSON.stringify(midway);
 // A late final response from the initial request cannot finish the continued round.
 assert.throws(()=>native.projectNativeStudyPage(midway,page({checkpoint:tok('C')}),initialRequest,lease()));
 assert.equal(JSON.stringify(midway),before);
 const continuationRequest=request(midway),completed=native.projectNativeStudyPage(midway,page({checkpoint:tok('C')}),continuationRequest,lease());
 assert.equal(completed.stateVersion,2);assert.equal(completed.download.continuation,null);assert.equal(completed.download.checkpoint,tok('C'));
 assert.throws(()=>native.projectNativeStudyPage(completed,page({checkpoint:tok('D')}),continuationRequest,lease()));
 const nextRequest=request(completed),localChange={...completed,stateVersion:completed.stateVersion+1};
 assert.throws(()=>native.projectNativeStudyPage(localChange,page({checkpoint:tok('D')}),nextRequest,lease()));
 assert.throws(()=>native.projectNativeStudyPage(completed,page({checkpoint:tok('D')}),{...nextRequest,checkpoint:null},lease()));
 const next=native.projectNativeStudyPage(completed,page({checkpoint:tok('D')}),nextRequest,lease());assert.equal(next.download.checkpoint,tok('D'));
});

test('profile/theme/audio/exam/wordcard uploads are disallowed and a session fence is mandatory',async()=>{
 const start=snapshot(),a=attempt(),op={id:randomUUID(),owner,type:'attempt',data:a};
 for(const type of ['profile','theme','recording','exam','vocabulary','wordcard'])await assert.rejects(native.prepareNativeUpload({...op,type},lease()));
 await assert.rejects(native.prepareNativeUpload({...op,owner:other},lease()));
 const controller=new AbortController();controller.abort();const stopped={owner,signal:controller.signal,isCurrent:()=>true};
 const before=JSON.stringify(start);assert.throws(()=>project(start,page(),stopped));assert.equal(JSON.stringify(start),before);
 let n=0;const changed={owner,signal:new AbortController().signal,isCurrent:()=>++n===1};assert.throws(()=>project(start,page(),changed));assert.equal(JSON.stringify(start),before);
});

test('session abort while hashing prevents both upload preparation and acknowledgement',async()=>{
 const op={id:randomUUID(),owner,type:'attempt',data:attempt()},before=snapshot({pendingOperations:[op]});
 const controller=new AbortController(),active={owner,signal:controller.signal,isCurrent:()=>true};
 const preparing=native.prepareNativeUpload(op,active);controller.abort();await assert.rejects(preparing);
 const prepared=await native.prepareNativeUpload(op,lease()),otherController=new AbortController();
 const acknowledging=native.acknowledgeNativeUpload(before,prepared,{status:200,body:{ok:true}},{owner,signal:otherController.signal,isCurrent:()=>true});
 otherController.abort();await assert.rejects(acknowledging);assert.equal(before.uploadAcks.length,0);assert.equal(before.pendingOperations.length,1);
});

test('concurrent mutation during digest rejects the old acknowledgement and preserves the journal',async()=>{
 const op={id:randomUUID(),owner,type:'attempt',data:attempt({choice:0})},before=snapshot({pendingOperations:[op]});
 const sent=await native.prepareNativeUpload(op,lease());
 const pending=native.acknowledgeNativeUpload(before,sent,{status:200,body:{ok:true}},lease());
 before.pendingOperations[0].data.choice=1;
 await assert.rejects(pending);assert.equal(before.pendingOperations[0].data.choice,1);assert.equal(before.uploadAcks.length,0);
 const operation={...op,data:{...op.data,choice:0}},preparing=native.prepareNativeUpload(operation,lease());
 operation.data.choice=1;await assert.rejects(preparing);
 const stable={...op,data:{...op.data,choice:0}},stableSnapshot=snapshot({pendingOperations:[stable]}),mutableSent=await native.prepareNativeUpload(stable,lease());
 const inFlight=native.acknowledgeNativeUpload(stableSnapshot,mutableSent,{status:200,body:{ok:true}},lease());
 mutableSent.wire.data.choice=1;await assert.rejects(inFlight);assert.equal(stableSnapshot.uploadAcks.length,0);
});

test('real candidate gateway response can be projected without copying private recordings',async t=>{
 const e=environment();t.after(()=>e.close());e.env.LANTERN_M2A_CURSOR_KEY='11'.repeat(32);const user=await e.register('synthetic_native_projection');
 assert.equal((await e.call('study','GET',{cookie:user.cookie,query:'?sync=pages-v1'})).status,200);
 const event=checkin();assert.equal((await e.call('study','POST',{cookie:user.cookie,owner:user.id,body:{type:'checkin',data:event}})).status,200);
 const gateway=e.load('worker/native-study-gateway.ts').createNativeStudyGateway({enabled:true,env:e.env,backend:e.routes.study});
 const req=e.request('study','GET',{cookie:user.cookie,owner:user.id,query:'?sync=native-m2a-v1'}),response=await gateway(req);assert.equal(response.status,200);
 const local=snapshot({owner:user.id}),before=plain(local.data.profile),priorRecordings=plain(local.data.recordings),projected=project(local,await response.json(),lease(user.id));
 assert.deepEqual(plain(projected.data.profile),before);assert.deepEqual(plain(projected.data.recordings),priorRecordings);assert.equal(projected.data.checkins[0].id,event.id);assert.match(projected.download.checkpoint,/^n1\./);
});
