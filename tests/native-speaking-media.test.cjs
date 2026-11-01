'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {nativeMediaRuntime,bytes,defer,tick,until}=require('./helpers/native-media-runtime.cjs');
const MEDIA='harmony/entry/src/main/ets/media/';
test('actual native port and AAC adapter return exact bounded bytes; ACK follows only explicit local-save confirmation',async t=>{
 const h=nativeMediaRuntime();t.after(h.dispose);const {NativeAacRecorder}=h.load('lib/native-aac-recorder.ts');
 const capture=new NativeAacRecorder(15,1,()=>true),blobs=[];let stops=0;capture.ondataavailable=e=>blobs.push(e.data);capture.onstop=()=>stops++;
 await capture.start();assert.equal(capture.state,'recording');h.clock.advance(1000);capture.stop();await until(()=>blobs.length===1);
 assert.equal(stops,1);assert.equal(blobs[0].type,'audio/mp4');assert.deepEqual(new Uint8Array(await blobs[0].arrayBuffer()),h.payload);
 assert.equal(h.requests.filter(r=>r.action==='ack').length,0);assert.deepEqual(h.requests.filter(r=>r.action==='readChunk').map(r=>r.index),[0,1]);
 assert.equal(h.recorders[0].config.profile.aacProfile,0);assert.equal(h.recorders[0].config.profile.fileFormat,'m4a');assert.equal(h.recorders[0].stopCalls,1);
 await capture.confirmSaved();await capture.confirmSaved();assert.equal(h.requests.filter(r=>r.action==='ack').length,1);assert.equal(h.files.size,0);assert.equal(h.fds.size,0);
 assert.equal(h.registrations[0].methods.join(','),'open,detach');for(const r of h.requests)assert.equal(r.owner,undefined);
 const controls=h.replies.filter(r=>typeof r==='string').join('');assert(!controls.includes('/synthetic-native-cache'));assert(!controls.includes('usr_'));
});
test('format/hash corruption never emits partial bytes or a saved recording',async t=>{
 const h=nativeMediaRuntime({mutateReply:data=>{if(data instanceof ArrayBuffer){data=data.slice(0);new Uint8Array(data)[data.byteLength-1]^=1;}return data;}});t.after(h.dispose);
 const {NativeAacRecorder}=h.load('lib/native-aac-recorder.ts'),capture=new NativeAacRecorder(15,1,()=>true);let blobs=0,stops=0;capture.ondataavailable=()=>blobs++;capture.onstop=()=>stops++;
 await capture.start();h.clock.advance(1000);capture.stop();await until(()=>stops===1);assert.equal(blobs,0);assert.match(capture.captureIssue,/校验/);assert.equal(h.requests.some(r=>r.action==='ack'),false);await tick();await tick();assert.equal(h.files.size,0);
});
test('expired trusted lease detaches an in-flight chunk and prevents late bytes, ACK and another owner save',async t=>{
 const h=nativeMediaRuntime({holdFrames:true});t.after(h.dispose);let current=true;
 const {NativeAacRecorder}=h.load('lib/native-aac-recorder.ts'),capture=new NativeAacRecorder(15,1,()=>current);let blobs=0;capture.ondataavailable=()=>blobs++;
 await capture.start();h.clock.advance(1000);capture.stop();await until(()=>h.heldFrames===1);current=false;h.lease.revoke();h.releaseFrames();await tick();await tick();
 assert.equal(blobs,0);assert.equal(h.requests.some(r=>r.action==='ack'),false);assert.equal(h.files.size,0);assert.equal(h.fds.size,0);
});
test('native cleanup waits for a late AVRecorder creation and never exposes a stale result',async t=>{
 const gate=defer(),h=nativeMediaRuntime({createGate:gate});t.after(h.dispose);
 const {NativeAacRecorder}=h.load('lib/native-aac-recorder.ts');let current=true;const capture=new NativeAacRecorder(15,1,()=>current),started=capture.start().catch(error=>error);
 await until(()=>h.requests.some(r=>r.action==='start'));current=false;capture.detach();gate.resolve();await started;await tick();await tick();
 assert.equal(h.recorders.length,1);assert.equal(h.recorders[0].releaseCalls,1);assert.equal(h.files.size,0);assert.equal(h.fds.size,0);
});
test('unsupported profile and denied permission are explicit and do not create files or silently fall back',async t=>{
 for(const option of [{unsupported:true},{denied:true}]){
  const h=nativeMediaRuntime(option);t.after(h.dispose);const {NativeAacRecorder}=h.load('lib/native-aac-recorder.ts'),capture=new NativeAacRecorder(15,1,()=>true);
  await assert.rejects(capture.start(),error=>error.code===(option.denied?'PERMISSION_DENIED':'UNSUPPORTED'));capture.detach();await tick();assert.equal(h.files.size,0);
 }
});
test('binary protocol validates the exact cap, UTF8 metadata, role keys and byte count before use',t=>{
 const h=nativeMediaRuntime();t.after(h.dispose);const api=h.load('lib/native-speaking-media.ts'),payload=bytes(),base={version:1,id:randomUUID(),captureId:randomUUID(),generation:1,state:'READING',revision:3,nextChunkIndex:1,totalChunks:2,totalBytes:payload.length,sha256:h.digest,mime:'audio/mp4',durationMs:1000,index:0};
 const encoded=JSON.stringify(base).padEnd(1024,' '),frame=new ArrayBuffer(4+1024+65536),out=new Uint8Array(frame);new DataView(frame).setUint32(0,1024,true);out.set(new TextEncoder().encode(encoded),4);out.set(payload.subarray(0,65536),1028);
 assert.equal(api.decodeNativeMediaMessage(frame).bytes.length,65536);assert.throws(()=>api.decodeNativeMediaMessage(new ArrayBuffer(api.NATIVE_MEDIA_FRAME_BYTES+1)));
 const bad=frame.slice(0);new DataView(bad).setUint32(0,1025,true);assert.throws(()=>api.decodeNativeMediaMessage(bad));
 assert.throws(()=>api.decodeNativeMediaMessage(JSON.stringify({...base,index:undefined,owner:'forged'})));assert.throws(()=>api.decodeNativeMediaMessage('x'.repeat(4097)));
 assert.throws(()=>api.decodeNativeMediaMessage(JSON.stringify({...base,index:undefined,state:'ACKED'})));
});
test('native control allowlist rejects forged owner, arbitrary file/codec, extra fields and oversized detach',t=>{
 const h=nativeMediaRuntime();t.after(h.dispose);const policy=h.load(MEDIA+'SpeakingMediaPolicy.ets'),base={version:1,id:randomUUID(),action:'start',captureId:randomUUID(),generation:1,maxDurationMs:1000};
 assert.ok(policy.parseMediaRequest(JSON.stringify(base)));
 for(const extra of [{owner:'alice'},{path:'/outside'},{mime:'audio/wav'},{maxDurationMs:120001},{generation:0},{action:'resume'}])assert.equal(policy.parseMediaRequest(JSON.stringify({...base,...extra})),undefined);
 assert.equal(policy.parseMediaScope(JSON.stringify({captureId:base.captureId,generation:1,extra:1})),undefined);assert.equal(policy.parseMediaScope('x'.repeat(129)),undefined);
});

async function channel(h){const api=h.load('lib/native-speaking-media.ts'),connection=await api.connectNativeSpeakingMedia(()=>true);return new api.NativeMediaChannel(connection,randomUUID(),1,()=>true);}
test('stop intent survives timeout; cancel is TOO_LATE, query is read-only, and chunk retry is identical',async t=>{
 const gate=defer(),h=nativeMediaRuntime({stopGate:gate});t.after(h.dispose);const c=await channel(h);await c.request('start',{maxDurationMs:120000});h.clock.advance(1000);
 const stopping=c.request('stop').catch(e=>e);await until(()=>h.recorders[0].stopCalls===1);h.clock.advance(30001);assert.equal((await stopping).unknownResult,true);
 assert.equal((await c.request('query')).reply.state,'FINALIZING');assert.equal((await c.request('cancel')).reply.result,'TOO_LATE');
 for(let i=0;i<3;i++)assert.equal((await c.request('query')).reply.state,'FINALIZING');assert.equal(h.recorders[0].stopCalls,1);
 gate.resolve();await tick();await tick();const ready=(await c.request('query')).reply;assert.equal(ready.state,'READY');assert.equal(ready.durationMs,1000);
 const first=await c.request('readChunk',{index:0}),again=await c.request('readChunk',{index:0});assert.deepEqual(first.bytes,again.bytes);
 const early=await c.request('ack',{blobSha256:h.digest,byteLength:h.payload.length});assert.equal(early.reply.result,'CONFLICT');assert.equal(h.files.size,1);
 await c.request('readChunk',{index:1});assert.equal((await c.request('ack',{blobSha256:'0'.repeat(64),byteLength:h.payload.length})).reply.result,'CONFLICT');
 assert.equal((await c.request('ack',{blobSha256:h.digest,byteLength:h.payload.length})).reply.state,'ACKED');assert.equal(h.files.size,0);assert.equal(h.recorders[0].stopCalls,1);c.close();
});
test('query covers READING and ACKED without renewing the handle deadline',async t=>{
 const h=nativeMediaRuntime();t.after(h.dispose);const c=await channel(h);await c.request('start',{maxDurationMs:120000});h.clock.advance(1000);await c.request('stop');await c.request('readChunk',{index:0});
 for(let i=0;i<3;i++){h.clock.advance(30000);assert.equal((await c.request('query')).reply.state,'READING');}
 h.clock.advance(30000);await tick();await tick();assert.equal((await c.request('query')).reply.state,'EXPIRED');assert.equal(h.files.size,0);c.close();
});

test('absolute lifetime expires a still-finalizing capture and reclaims late bytes without freeing its live recorder early',async t=>{
 const gate=defer(),h=nativeMediaRuntime({stopGate:gate});t.after(h.dispose);const c=await channel(h);
 await c.request('start',{maxDurationMs:120000});h.clock.advance(1000);const stopping=c.request('stop').catch(e=>e);
 await until(()=>h.recorders[0].stopCalls===1);h.clock.advance(600000);assert.equal((await stopping).unknownResult,true);
 assert.equal((await c.request('query')).reply.state,'EXPIRED');assert.equal(h.window.LanternSpeakingHost.open(JSON.stringify({version:1,nonce:randomUUID()})),'BUSY');
 gate.resolve();await until(()=>h.files.size===0&&h.recorders[0].releaseCalls===1);await tick();
 assert.equal((await c.request('query')).reply.state,'EXPIRED');assert.equal(h.recorders[0].stopCalls,1);assert.equal(h.replies.some(r=>r instanceof ArrayBuffer),false);c.close();
});

test('actual backup roundtrip preserves optional native format metadata and old WAV records without inventing audio',()=>{
 const loader=require('./helpers/actual-source-loader.cjs').createSourceLoader({root:require('node:path').resolve(__dirname,'..')});
 const model=loader.load('lib/study-model.ts'),backup=loader.load('lib/study-backup.ts'),data=structuredClone(model.EMPTY_DATA);
 data.recordings=[{id:randomUUID(),promptId:'speaking-1',title:'Native fixture',duration:1,createdAt:'2026-10-29T00:00:00.000Z',mime:'audio/mp4',captureImplementation:'harmony-avrecorder-aac'},
 {id:randomUUID(),promptId:'speaking-1',title:'Legacy fixture',duration:1,createdAt:'2026-10-29T00:00:00.000Z',mime:'audio/wav'}];
 const exported=backup.createStudyBackup(data),restored=backup.parseStudyBackup(JSON.stringify(exported));
 assert.equal(exported.audioIncluded,false);assert.equal(restored.recordings[0].captureImplementation,'harmony-avrecorder-aac');assert.equal(restored.recordings[0].mime,'audio/mp4');
 assert.equal(restored.recordings[1].mime,'audio/wav');assert.equal(Object.hasOwn(restored.recordings[1],'captureImplementation'),false);
 assert.throws(()=>backup.parseStudyBackup({...exported,recordings:[{...data.recordings[0],captureImplementation:'untrusted'}]}));
});
test('cleanup failure never produces ACKED or frees the slot; a matching detach may retry deletion',async t=>{
 const h=nativeMediaRuntime();t.after(h.dispose);const c=await channel(h);await c.request('start',{maxDurationMs:120000});h.clock.advance(1000);await c.request('stop');await c.request('readChunk',{index:0});await c.request('readChunk',{index:1});h.options.cleanupFailure=true;
 await assert.rejects(c.request('ack',{blobSha256:h.digest,byteLength:h.payload.length}),e=>e.code==='WRITE_FAILED');assert.equal(h.files.size,1);
 assert.equal(h.window.LanternSpeakingHost.open(JSON.stringify({version:1,nonce:randomUUID()})),'BUSY');
 h.options.cleanupFailure=false;h.window.LanternSpeakingHost.detach(JSON.stringify({captureId:c.captureId,generation:1}));await tick();await tick();assert.equal(h.files.size,0);await assert.rejects(c.request('query'),e=>e.code==='WRITE_FAILED');c.close();
});
test('wrong capture detach cannot cancel the current slot, and a previous capture never cancels a new one',async t=>{
 const h=nativeMediaRuntime();t.after(h.dispose);const first=await channel(h);await first.request('start',{maxDurationMs:120000});
 h.window.LanternSpeakingHost.detach(JSON.stringify({captureId:randomUUID(),generation:1}));assert.equal(h.recorders[0].stopCalls,0);
 const old=first.captureId;await first.request('cancel');first.close();const second=await channel(h);await second.request('start',{maxDurationMs:120000});
 h.window.LanternSpeakingHost.detach(JSON.stringify({captureId:old,generation:1}));assert.equal(h.recorders[1].stopCalls,0);assert.equal((await second.request('query')).reply.state,'STARTED');await second.request('cancel');second.close();
});
test('main-document and trusted lease gates reject other frames, paths and forged JS owner data',t=>{
 const h=nativeMediaRuntime();t.after(h.dispose);const raw=JSON.stringify({version:1,nonce:randomUUID()});
 for(const frame of ['https://evil.test/','https://lantern.local/audio/file','http://lantern.local/']){h.setFrame(frame);assert.equal(h.window.LanternSpeakingHost.open(raw),'UNSUPPORTED');}
 h.setFrame('https://lantern.local/');assert.equal(h.window.LanternSpeakingHost.open(JSON.stringify({version:1,nonce:randomUUID(),owner:'forged'})),'UNSUPPORTED');h.lease.revoke();assert.equal(h.window.LanternSpeakingHost.open(raw),'UNSUPPORTED');assert.equal(h.recorders.length,0);
});
