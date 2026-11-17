// Execute only the real diagnostic module. No media playback, bridge, device,
// network, private recording, URL allocation or database is involved.
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const source=path.join(root,'lib/recording-media-diagnostics.ts');
const keys=['source','request','event','current','duration','ready','network','errorCode','paused','ended','seeking','sourceKind'].sort();
function harness(){
 const lines=[];let sink=line=>lines.push(line);const exports={};
 const code=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,console:{info:line=>sink(line)},Map,Set,Number,JSON},{filename:source});
 return {trace:exports.recordingMediaTrace,lines,rows:()=>lines.map(line=>{assert.equal(line.startsWith('Recording playback '),true);const value=JSON.parse(line.slice('Recording playback '.length));assert.deepEqual(Object.keys(value).sort(),keys);return value;}),setSink(fn){sink=fn;}};
}
const media=()=>({currentTime:1.25,duration:6,readyState:4,networkState:1,error:null,paused:false,ended:false,seeking:false});
test('diagnostic contains only the fixed numeric/state schema and never URL/id/message/recording content',()=>{
 const h=harness(),audio=media();audio.error={code:3,message:'SECRET-error-blob:recording-id-user-content'};audio.src='SECRET-media-src';audio.title='SECRET-title';audio.recordingId='SECRET-id';
 h.trace('error','blob:SECRET-source-recording-id',audio,7);const [row]=h.rows();assert.deepEqual(row,{source:1,request:7,event:'error',current:1.25,duration:6,ready:4,network:1,errorCode:3,paused:false,ended:false,seeking:false,sourceKind:'blob'});
 assert.doesNotMatch(h.lines[0],/SECRET|blob:|recording-id|message|title|stack|src/);
});
test('missing and throwing media getters yield bounded defaults without throwing or touching playback methods',()=>{
 const h=harness(),audio={play(){throw Error('Must never play');},pause(){throw Error('Must never pause');},load(){throw Error('Must never load');}};
 for(const key of ['currentTime','duration','readyState','networkState','error','paused','ended','seeking'])Object.defineProperty(audio,key,{get(){throw Error('Getter secret');}});
 assert.doesNotThrow(()=>h.trace('loadedmetadata','blob:original',audio));const [row]=h.rows();assert.deepEqual(row,{source:1,request:0,event:'loadedmetadata',current:null,duration:null,ready:0,network:0,errorCode:null,paused:true,ended:false,seeking:false,sourceKind:'blob'});assert.doesNotMatch(h.lines[0],/secret|Getter/);
});
test('throwing log sink is absorbed and later diagnostic calls remain usable',()=>{
 const h=harness();h.setSink(()=>{throw Error('Sink unavailable');});assert.doesNotThrow(()=>h.trace('playing','blob:sink',media(),1));const lines=[];h.setSink(line=>lines.push(line));assert.doesNotThrow(()=>h.trace('pause','blob:sink',media(),1));assert.equal(lines.length,1);assert.equal(JSON.parse(lines[0].slice('Recording playback '.length)).source,1);
});
test('nonfinite, fractional and invalid typed values cannot escape the diagnostic schema',()=>{
 const h=harness();h.trace('durationchange','blob:finite',{currentTime:Infinity,duration:NaN,readyState:1.5,networkState:99,error:{code:-1},paused:'false',ended:1,seeking:{}},Infinity);
 const [row]=h.rows();assert.equal(row.current,null);assert.equal(row.duration,null);assert.equal(row.ready,0);assert.equal(row.network,0);assert.equal(row.errorCode,null);assert.equal(row.request,0);assert.equal(row.paused,true);assert.equal(row.ended,false);assert.equal(row.seeking,false);
});
test('an unapproved event is ignored without consuming the 128-record diagnostic budget',()=>{
 const h=harness();for(let i=0;i<200;i++)h.trace('SECRET-bad-event','blob:SECRET');assert.equal(h.lines.length,0);for(let i=0;i<128;i++)h.trace('playing','blob:same',media(),1);assert.equal(h.rows().length,128);assert.equal(h.rows().some(row=>row.event==='budget'),false);
});
test('all instrumented reading/media/lifecycle stages, including loadstart and timeupdate, pass the fixed schema',()=>{
 const h=harness(),events=['reading','source-ready','url-attached','url-released','url-discarded','loadedmetadata','durationchange','canplay','play','playing','pause','ended','error','waiting','stalled','timeout','retry','retired','global-stop','native-background','loadstart','timeupdate'];
 for(const event of events)h.trace(event,'blob:stages',media(),4);const rows=h.rows();assert.deepEqual(rows.map(row=>row.event),events);assert.equal(rows.every(row=>row.source===1&&row.request===4),true);
 const native=nativeHarness();for(const row of rows)assert.equal(native.forward(row),true);assert.equal(native.captured.length,events.length);
});
test('the module logs at most 128 observations plus exactly one content-free budget marker',()=>{
 const h=harness();for(let i=0;i<1000;i++)h.trace('playing','blob:budget',media(),i);const rows=h.rows();assert.equal(rows.length,129);assert.equal(rows.filter(row=>row.event==='playing').length,128);assert.equal(rows.filter(row=>row.event==='budget').length,1);
 assert.deepEqual(rows.at(-1),{source:0,request:0,event:'budget',current:null,duration:null,ready:0,network:0,errorCode:null,paused:true,ended:false,seeking:false,sourceKind:'none'});
});
test('process-local source numbers stay stable, differ between sources, and stop mapping beyond 64 entries',()=>{
 const h=harness();for(let i=1;i<=65;i++)h.trace('reading','blob:source-'+i);h.trace('error','blob:source-1');h.trace('reading','');h.trace('reading','x'.repeat(4097));
 const rows=h.rows();assert.deepEqual(rows.slice(0,64).map(row=>row.source),Array.from({length:64},(_,i)=>i+1));assert.equal(rows[64].source,0);assert.equal(rows[65].source,1);assert.equal(rows[66].source,0);assert.equal(rows[67].source,0);assert.doesNotMatch(h.lines.join(''),/blob:|source-1|xxxx/);
});
test('source classification reports only broad kinds and cannot expose private URLs',()=>{
 const h=harness(),cases=[['blob:private','blob'],['https://lantern.local/audio/private.webm','local'],['file:///private','local'],['/api/recordings/private','local'],['https://media.example/private?token=secret','remote'],['//media.example/private','remote'],['javascript:secret','none'],['','none']];
 for(const [src] of cases)h.trace('source-ready',src);assert.deepEqual(h.rows().map(row=>row.sourceKind),cases.map(([,kind])=>kind));assert.doesNotMatch(h.lines.join(''),/private|secret|token|example|lantern\.local/);
});

// Execute the exact pure diagnostic block from Index.ets via TypeScript erasure.
// This is JS logic evidence, not an ArkTS compiler or on-device assertion.
function nativeHarness(){
 const file=path.join(root,'harmony/entry/src/main/ets/pages/Index.ets'),source=fs.readFileSync(file,'utf8');
 const start=source.indexOf('const RECORDING_CONSOLE_PREFIX'),end=source.indexOf('function isAppUrl',start);assert.ok(start>=0&&end>start);
 const captured=[];let failSink=false;const code=ts.transpileModule(source.slice(start,end)+'\nglobalThis.__RecordingDiagnostics = RecordingPlaybackDiagnostics;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const sandbox={mediaRangeUptime:()=>123.5,Date,JSON,Number,hilog:{info(...args){if(failSink)throw Error('Synthetic unavailable hilog');captured.push(args);}}};vm.runInNewContext(code,sandbox,{filename:file+'#recording-diagnostics'});
 const instance=new sandbox.__RecordingDiagnostics();return {captured,forward:input=>instance.forward(typeof input==='string'?input:'Recording playback '+JSON.stringify(input)),failSink(){failSink=true;}};
}
function nativeRow(){return {source:1,request:2,event:'loadedmetadata',current:0,duration:6,ready:1,network:2,errorCode:null,paused:true,ended:false,seeking:false,sourceKind:'blob'};}
test('native diagnostic executes strict validation and rebuilds only its fixed typed payload',()=>{
 const h=nativeHarness(),row=nativeRow();assert.equal(h.forward(row),true);assert.equal(h.captured.length,1);const [domain,tag,format,message]=h.captured[0];assert.equal(domain,0x1001);assert.equal(tag,'LANTERN_RECORDING');assert.equal(format,'%{public}s');const log=JSON.parse(message);assert.deepEqual(log.data,row);assert.equal(log.seq,1);assert.equal(log.uptimeMs,123.5);assert.equal(log.v,1);assert.equal(Number.isFinite(log.wallMs),true);assert.deepEqual(Object.keys(log.data).sort(),keys);
});
test('native diagnostic rejects extra/missing fields, ranges, types, non-schema strings and hostile payloads',()=>{
 const h=nativeHarness(),row=nativeRow(),cases=[null,[],{...row,src:'blob:SECRET'},{...row,event:'SECRET-url'},{...row,sourceKind:'https://SECRET'},{...row,source:65},{...row,source:-1},{...row,source:1.5},{...row,request:-1},{...row,request:1.5},{...row,current:'0'},{...row,duration:{}},{...row,ready:5},{...row,network:4},{...row,errorCode:0},{...row,errorCode:1.5},{...row,paused:'true'},{...row,ended:0},{...row,seeking:null}];
 const missing={...row};delete missing.duration;cases.push(missing);for(const input of cases)assert.equal(h.forward(input),false,JSON.stringify(input));
 assert.equal(h.forward('Recording playback '+JSON.stringify({...row,current:1e309})),true,'JSON Infinity becomes allowed null rather than an infinite metric');
 assert.equal(h.forward('Recording playback {"source":1,"request":2,"event":"error","current":1e999,"duration":6,"ready":1,"network":2,"errorCode":3,"paused":true,"ended":false,"seeking":false,"sourceKind":"blob"}'),false);
 assert.equal(h.forward('Recording playback {'+ 'x'.repeat(2049)),false);assert.equal(h.forward('Bundled playback '+JSON.stringify(row)),false);assert.equal(h.forward('Recording playback not JSON'),false);
 assert.equal(h.captured.length,1);assert.doesNotMatch(JSON.stringify(h.captured),/SECRET/);
});
test('native log budget is bounded and only a fully neutral renderer budget marker is accepted',()=>{
 const h=nativeHarness();for(let i=0;i<1000;i++)assert.equal(h.forward(nativeRow()),true);assert.equal(h.captured.length,129);assert.equal(h.captured.at(-1)[3],'v=1 phase=limit messages=128');assert.equal(h.captured.filter(args=>args[3].includes('phase=limit')).length,1);
 const other=nativeHarness(),budget={source:0,request:0,event:'budget',current:null,duration:null,ready:0,network:0,errorCode:null,paused:true,ended:false,seeking:false,sourceKind:'none'};
 for(const patch of [{source:1},{request:1},{current:0},{duration:0},{ready:1},{network:1},{errorCode:1},{paused:false},{ended:true},{seeking:true},{sourceKind:'blob'}])assert.equal(other.forward({...budget,...patch}),false);
 assert.equal(other.forward(budget),true);assert.equal(other.forward(budget),true);assert.equal(other.captured.length,1);assert.equal(other.captured[0][3],'v=1 phase=limit messages=128');
});
test('native hilog sink failure never escapes the isolated diagnostic function',()=>{
 const h=nativeHarness();h.failSink();assert.doesNotThrow(()=>assert.equal(h.forward(nativeRow()),true));assert.equal(h.captured.length,0);
});
test('actual native console route requires trusted readiness and routes capture then recording then bundled observations',()=>{
 const file=path.join(root,'harmony/entry/src/main/ets/pages/Index.ets'),source=fs.readFileSync(file,'utf8');
 const start=source.indexOf('private playbackConsole('),end=source.indexOf('  private invalidateBridge(',start);assert.ok(start>=0&&end>start);
 const body=source.slice(start,end).replace('private playbackConsole(','function playbackConsole('),calls=[];let capture=false,recording=false,bundled=true;
 const sandbox={nativeCaptureDiagnostics:{forward(text){calls.push(['capture',text]);return capture;}},recordingPlaybackDiagnostics:{forward(text){calls.push(['recording',text]);return recording;}},bundledPlaybackDiagnostics:{forward(text){calls.push(['bundled',text]);return bundled;}}};
 vm.runInNewContext(ts.transpileModule(body+'\nglobalThis.__route=playbackConsole;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,sandbox,{filename:file+'#playbackConsole'});
 const context={pageReady:false,isTrustedDocument:()=>true},message={getMessage(){calls.push(['getMessage']);return 'synthetic schema-only observation';}};
 assert.equal(sandbox.__route.call(context,message),false);assert.deepEqual(calls,[]);context.pageReady=true;context.isTrustedDocument=()=>false;assert.equal(sandbox.__route.call(context,message),false);assert.deepEqual(calls,[]);
 context.isTrustedDocument=()=>true;capture=true;assert.equal(sandbox.__route.call(context,message),true);assert.deepEqual(calls.map(row=>row[0]),['getMessage','capture']);calls.length=0;capture=false;recording=true;assert.equal(sandbox.__route.call(context,message),true);assert.deepEqual(calls.map(row=>row[0]),['getMessage','capture','recording']);calls.length=0;recording=false;assert.equal(sandbox.__route.call(context,message),true);assert.deepEqual(calls.map(row=>row[0]),['getMessage','capture','recording','bundled']);bundled=false;assert.equal(sandbox.__route.call(context,{getMessage(){throw Error('Failed native message');}}),false);
});
