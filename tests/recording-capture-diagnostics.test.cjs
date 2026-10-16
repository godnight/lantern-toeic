// Counter observations only. The real helper and exact pure Index.ets forwarder
// execute in isolated VMs; no microphone, recorder, learner data or audio bytes.
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const keys=['attempt','event','chunkCount','zeroChunks','totalBytes','lastChunkBytes','elapsedMs','mimeKind','activeTracks'].sort();
const events=['permission-request','stream-acquired','recorder-created','start','chunk','stop-request','track-release','stopped','save-start','save-ok','save-error','permission-error','start-error','recorder-error'];
const fields=()=>({chunkCount:3,zeroChunks:1,totalBytes:8,lastChunkBytes:3,elapsedMs:6000.4,mime:'audio/webm;codecs=opus',activeTracks:1});
function harness(){
 const source=path.join(root,'lib/recording-capture-diagnostics.ts'),exports={},lines=[];let sink=line=>lines.push(line);
 const code=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,console:{info:line=>sink(line)},Map,Set,JSON,Number,Math},{filename:source});
 return {create:exports.createRecordingCaptureTrace,lines,setSink(fn){sink=fn;},rows:()=>lines.map(line=>{assert.equal(line.startsWith('Recording capture '),true);const row=JSON.parse(line.slice('Recording capture '.length));assert.deepEqual(Object.keys(row).sort(),keys);return row;})};
}
test('capture helper emits only nine bounded fields and never raw MIME, recording IDs, URLs or content',()=>{
 const h=harness(),trace=h.create(),input={...fields(),mime:'audio/webm;codecs=opus;SECRET-private=recording-id',recordingId:'SECRET-id',url:'blob:SECRET-url',audio:'SECRET-content'};trace('chunk',input);const [row]=h.rows();
 assert.deepEqual(row,{attempt:1,event:'chunk',chunkCount:3,zeroChunks:1,totalBytes:8,lastChunkBytes:3,elapsedMs:6000,mimeKind:'webm-opus',activeTracks:1});assert.doesNotMatch(h.lines[0],/SECRET|recording-id|blob:|codecs|audio\/|content|url/);
});
test('capture helper preserves supplied per-event counters and sequence without inspecting or accumulating bytes',()=>{
 const h=harness(),trace=h.create();const inputs=[{chunkCount:1,zeroChunks:0,totalBytes:2,lastChunkBytes:2},{chunkCount:2,zeroChunks:1,totalBytes:2,lastChunkBytes:0},{chunkCount:3,zeroChunks:1,totalBytes:5,lastChunkBytes:3}];
 for(const input of inputs)trace('chunk',{...fields(),...input});assert.deepEqual(h.rows().map(({chunkCount,zeroChunks,totalBytes,lastChunkBytes})=>({chunkCount,zeroChunks,totalBytes,lastChunkBytes})),inputs);assert.equal(h.rows().every(row=>row.attempt===1),true);
});
test('capture MIME classification allows only broad fixed enum values',()=>{
 const h=harness(),trace=h.create(),cases=[[' AUDIO/WEBM ; codecs="opus" ','webm-opus'],['audio/webm;codecs=opus','webm-opus'],['audio/webm','webm'],['audio/webm;codecs=vp8','webm'],['audio/mp4;codecs=mp4a.40.2','mp4'],['audio/SECRET','other'],['x'.repeat(129),'other'],['','unknown'],['  ','unknown'],[null,'unknown']];
 for(const [mime] of cases)trace('recorder-created',{...fields(),mime});assert.deepEqual(h.rows().map(row=>row.mimeKind),cases.map(([,expected])=>expected));assert.doesNotMatch(h.lines.join(''),/SECRET|mp4a|vp8|xxxx/);
});
test('invalid counter types and nonfinite elapsed time are normalized without escaping the schema',()=>{
 const h=harness(),trace=h.create();trace('chunk',{chunkCount:-1,zeroChunks:1.5,totalBytes:Number.MAX_SAFE_INTEGER+1,lastChunkBytes:'3',elapsedMs:Infinity,mime:{secret:true},activeTracks:NaN});
 assert.deepEqual(h.rows()[0],{attempt:1,event:'chunk',chunkCount:0,zeroChunks:0,totalBytes:0,lastChunkBytes:0,elapsedMs:0,mimeKind:'unknown',activeTracks:0});
 trace('stopped',{...fields(),elapsedMs:-1});trace('save-ok',{...fields(),elapsedMs:100.6});assert.deepEqual(h.rows().slice(1).map(row=>row.elapsedMs),[0,101]);
});
test('throwing field getters and console sinks cannot escape or disable later capture observations',()=>{
 const h=harness(),trace=h.create(),input=fields();Object.defineProperty(input,'totalBytes',{get(){throw Error('SECRET getter');}});assert.doesNotThrow(()=>trace('chunk',input));assert.equal(h.lines.length,0);
 h.setSink(()=>{throw Error('Sink unavailable');});assert.doesNotThrow(()=>trace('stopped',fields()));const lines=[];h.setSink(line=>lines.push(line));assert.doesNotThrow(()=>trace('save-ok',fields()));assert.equal(lines.length,1);assert.doesNotMatch(lines[0],/SECRET|unavailable/);
});
test('capture attempt numbers are stable for a factory and capped at 64 without exposing identities',()=>{
 const h=harness(),traces=Array.from({length:66},()=>h.create());for(const trace of traces)trace('permission-request',fields());traces[0]('start',fields());
 const rows=h.rows();assert.deepEqual(rows.slice(0,64).map(row=>row.attempt),Array.from({length:64},(_,i)=>i+1));assert.equal(rows[64].attempt,0);assert.equal(rows[65].attempt,0);assert.equal(rows[66].attempt,1);
});
test('unknown capture events do not log or consume the 128-observation budget',()=>{
 const h=harness(),trace=h.create();for(let i=0;i<300;i++)trace('SECRET-not-allowed',fields());assert.equal(h.lines.length,0);for(let i=0;i<128;i++)trace('chunk',fields());assert.equal(h.rows().length,128);assert.equal(h.rows().some(row=>row.event==='budget'),false);
});
test('capture logging stops at 128 observations plus exactly one neutral budget marker across factories',()=>{
 const h=harness(),a=h.create(),b=h.create();for(let i=0;i<1000;i++)(i%2?a:b)('chunk',fields());const rows=h.rows();assert.equal(rows.length,129);assert.equal(rows.filter(row=>row.event==='chunk').length,128);assert.deepEqual(rows.at(-1),{attempt:0,event:'budget',chunkCount:0,zeroChunks:0,totalBytes:0,lastChunkBytes:0,elapsedMs:0,mimeKind:'unknown',activeTracks:0});
});
test('every capture stage emits a valid observation that the actual native counter forwarder accepts',()=>{
 const h=harness(),trace=h.create(),native=nativeHarness();for(const event of events)trace(event,fields());assert.deepEqual(h.rows().map(row=>row.event),events);for(const row of h.rows())assert.equal(native.forward(row),true);assert.equal(native.lines.length,events.length);
});

// Exact pure ArkTS block with TypeScript annotations erased: logic evidence only.
function nativeHarness(){
 const file=path.join(root,'harmony/entry/src/main/ets/pages/Index.ets'),source=fs.readFileSync(file,'utf8');const start=source.indexOf('const CAPTURE_CONSOLE_PREFIX'),mark=source.indexOf('const nativeCaptureDiagnostics:',start),end=source.indexOf('\n',mark);assert.ok(start>=0&&mark>start&&end>mark);
 const lines=[];let fail=false;const code=ts.transpileModule(source.slice(start,end)+'\nglobalThis.__NativeCaptureDiagnostics=NativeCaptureDiagnostics;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const sandbox={JSON,Number,Date,mediaRangeUptime:()=>123.5,hilog:{info(...args){if(fail)throw Error('Sink unavailable');lines.push(args);}}};vm.runInNewContext(code,sandbox,{filename:file+'#capture-diagnostics'});const instance=new sandbox.__NativeCaptureDiagnostics();return {lines,failSink(){fail=true;},forward:value=>instance.forward(typeof value==='string'?value:'Recording capture '+JSON.stringify(value))};
}
function row(){return {attempt:1,event:'chunk',chunkCount:3,zeroChunks:1,totalBytes:8,lastChunkBytes:3,elapsedMs:6000,mimeKind:'webm-opus',activeTracks:1};}
test('native capture forwarder rebuilds only the validated schema with bounded wrapper metadata',()=>{
 const h=nativeHarness();assert.equal(h.forward(row()),true);assert.equal(h.lines.length,1);const [domain,tag,format,message]=h.lines[0],log=JSON.parse(message);assert.equal(domain,0x1001);assert.equal(tag,'LANTERN_CAPTURE');assert.equal(format,'%{public}s');assert.deepEqual(log.data,row());assert.equal(log.seq,1);assert.equal(log.uptimeMs,123.5);assert.equal(log.v,1);assert.equal(Number.isFinite(log.wallMs),true);assert.deepEqual(Object.keys(log.data).sort(),keys);
});
test('native capture forwarder rejects extra/missing fields, invalid ranges, types, raw MIME and malformed input',()=>{
 const h=nativeHarness(),valid=row(),bad=[null,[],{...valid,url:'SECRET'},{...valid,event:'SECRET'},{...valid,mimeKind:'audio/webm;SECRET'},{...valid,attempt:65},{...valid,attempt:-1},{...valid,attempt:1.5},{...valid,chunkCount:-1},{...valid,zeroChunks:0.5},{...valid,totalBytes:Number.MAX_SAFE_INTEGER+1},{...valid,lastChunkBytes:'3'},{...valid,activeTracks:null},{...valid,elapsedMs:-1},{...valid,elapsedMs:'6000'}];const missing={...valid};delete missing.totalBytes;bad.push(missing);for(const value of bad)assert.equal(h.forward(value),false,JSON.stringify(value));
 assert.equal(h.forward('Recording capture '+JSON.stringify(valid).replace('"elapsedMs":6000','"elapsedMs":1e999')),false);assert.equal(h.forward('Recording capture invalid JSON'),false);assert.equal(h.forward('Recording capture '+ 'x'.repeat(2049)),false);assert.equal(h.forward('Recording playback '+JSON.stringify(valid)),false);assert.equal(h.lines.length,0);
});
test('native capture budget is 128 plus one limit marker and accepts only the neutral renderer marker',()=>{
 const h=nativeHarness();for(let i=0;i<1000;i++)assert.equal(h.forward(row()),true);assert.equal(h.lines.length,129);assert.equal(h.lines.at(-1)[3],'v=1 phase=limit messages=128');
 const other=nativeHarness(),budget={attempt:0,event:'budget',chunkCount:0,zeroChunks:0,totalBytes:0,lastChunkBytes:0,elapsedMs:0,mimeKind:'unknown',activeTracks:0};
 for(const patch of [{attempt:1},{chunkCount:1},{zeroChunks:1},{totalBytes:1},{lastChunkBytes:1},{elapsedMs:1},{mimeKind:'webm'},{activeTracks:1}])assert.equal(other.forward({...budget,...patch}),false);
 assert.equal(other.forward(budget),true);assert.equal(other.forward(budget),true);assert.equal(other.lines.length,1);assert.equal(other.lines[0][3],'v=1 phase=limit messages=128');
});
test('native capture hilog exceptions never escape the diagnostic observation',()=>{
 const h=nativeHarness();h.failSink();assert.doesNotThrow(()=>assert.equal(h.forward(row()),true));assert.equal(h.lines.length,0);
});
