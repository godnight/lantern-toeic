'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'worker/local-candidate-media-manifest.json'),'utf8'));
const oldManifest=JSON.parse(fs.readFileSync(path.join(root,'worker/natural-media-manifest.json'),'utf8'));
function load(file,imports){
 const result=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
 assert.equal((result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 const exports={};vm.runInNewContext(result.outputText,{exports,require(name){assert(Object.hasOwn(imports,name),'Unexpected import '+name);return imports[name];},Request,Response,Headers,URL,AbortController,Uint8Array,crypto:webcrypto,setTimeout,clearTimeout,fetch(){throw Error('Unexpected network');}},{filename:file});return exports;
}
const local=load('worker/local-candidate-media.ts',{'./local-candidate-media-manifest.json':manifest});
const proxy=load('worker/natural-media-proxy.ts',{'./natural-media-manifest.json':oldManifest});
const bytes=row=>fs.readFileSync(path.join(root,'public',...row.path.slice(1).split('/')));
const req=(p,init)=>new Request('https://private.example'+p,init);
function fixture(overrides={}){
 const calls=[],rows=new Map(manifest.entries.map(row=>[row.path,row]));
 return {calls,assets:{async fetch(request){calls.push(request);if(overrides.fetch)return overrides.fetch(request);const row=rows.get(new URL(request.url).pathname);assert(row);return new Response(bytes(row),{headers:{'Content-Type':row.contentType}});}}};
}
test('all 14 real candidate assets are verified and served privately without forwarding user data',async()=>{
 const f=fixture();assert.equal(manifest.entries.length,14);
 for(const row of manifest.entries){
  const actual=bytes(row);assert.equal(actual.length,row.bytes);assert.equal(createHash('sha256').update(actual).digest('hex'),row.sha256);
  const response=await local.handleLocalCandidateMedia(req(row.path+'?secret=1',{headers:{Cookie:'session=secret',Authorization:'Bearer secret'}}),f.assets);
  assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),actual);
  assert.equal(response.headers.get('content-type'),row.contentType);assert.equal(response.headers.get('content-length'),String(row.bytes));
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('etag'),'"sha256-'+row.sha256+'"');
  const upstream=f.calls.at(-1);assert.equal(upstream.url,'https://private.example'+row.path);assert.equal(upstream.method,'GET');assert.equal(upstream.headers.has('cookie'),false);assert.equal(upstream.headers.has('authorization'),false);
 }
});
test('HEAD and range responses verify full file, return exact requested bytes, and reject bad ranges',async()=>{
 const row=manifest.entries.find(e=>e.contentType==='audio/mpeg'),original=bytes(row),f=fixture();
 let response=await local.handleLocalCandidateMedia(req(row.path,{method:'HEAD'}),f.assets);
 assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,0);assert.equal(f.calls[0].method,'GET');
 for(const [range,start,end] of [['bytes=2-5',2,5],['bytes=-4',row.bytes-4,row.bytes-1],['bytes=3-',3,row.bytes-1]]){
  response=await local.handleLocalCandidateMedia(req(row.path,{headers:{Range:range}}),f.assets);assert.equal(response.status,206);
  assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${row.bytes}`);assert.deepEqual(Buffer.from(await response.arrayBuffer()),original.subarray(start,end+1));
 }
 response=await local.handleLocalCandidateMedia(req(row.path,{headers:{Range:'bytes=999999999-', 'If-Range':'different'}}),f.assets);assert.equal(response.status,200);
 const previous=f.calls.length;response=await local.handleLocalCandidateMedia(req(row.path,{headers:{Range:'bytes=0-1,3-4'}}),f.assets);assert.equal(response.status,416);assert.equal(f.calls.length,previous);
 response=await local.handleLocalCandidateMedia(req(row.path,{method:'POST'}),f.assets);assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET, HEAD');
});
test('rejects corrupted, truncated, oversized, mistyped and wrong-length assets before delivery',async()=>{
 const row=manifest.entries[0],original=bytes(row),mutated=Buffer.from(original);mutated[0]^=1;
 for(const [data,type,length] of [[mutated,row.contentType,null],[original.subarray(1),row.contentType,null],[Buffer.concat([original,Buffer.from([0])]),row.contentType,null],[original,'text/html',null],[original,row.contentType,'1']]){
  const f=fixture({fetch:async()=>new Response(data,{headers:{'Content-Type':type,...(length?{'Content-Length':length}:{})}})});
  const response=await local.handleLocalCandidateMedia(req(row.path,{headers:{Range:'bytes=0-1'}}),f.assets);assert.equal(response.status,502);assert.equal(response.headers.get('cache-control'),'private, no-store');
 }
});
test('invalid manifest and incomplete candidate rejected; exact unknown path is not intercepted',async()=>{
 for(const mutate of [m=>m.entries.pop(),m=>m.entries.push(m.entries[0]),m=>m.entries[0].sha256='0'.repeat(64),m=>m.status='PUBLIC']){
  const copy=structuredClone(manifest);mutate(copy);assert.throws(()=>local.createLocalCandidateMediaHandler(copy));
 }
 const f=fixture();assert.equal(await local.handleLocalCandidateMedia(req('/audio/natural/v040-natural-572f7490ce71/not-in-manifest.mp3'),f.assets),null);assert.equal(f.calls.length,0);
});
test('actual Worker routes candidate to ASSETS and leaves legacy upstream and unknown paths unchanged',async()=>{
 const f=fixture(),old=oldManifest.entries.find(e=>e.contentType==='audio/mpeg'),source=bytes(old),calls=[];
 const publicHandler=proxy.createNaturalMediaHandler(oldManifest,async request=>{calls.push(request);return new Response(source,{headers:{'Content-Type':old.contentType,'Content-Length':String(old.bytes)}});});
 const worker=load('worker/index.ts',{'./local-candidate-media':local,'./natural-media-proxy':{handleNaturalMediaRequest:publicHandler},'vinext/server/app-router-entry':{fetch:async()=>new Response('app')},'vinext/server/image-optimization':{DEFAULT_DEVICE_SIZES:[],DEFAULT_IMAGE_SIZES:[],handleImageOptimization(){throw Error('unexpected');}}}).default;
 const env={ASSETS:f.assets},ctx={};let response=await worker.fetch(req(manifest.entries[0].path),env,ctx);assert.equal(response.status,200);assert.equal(calls.length,0);assert.equal(f.calls.length,1);
 response=await worker.fetch(req(old.path),env,ctx);assert.equal(response.status,200);assert.equal(calls.length,1);assert.equal(calls[0].url,proxy.NATURAL_MEDIA_UPSTREAM_BASE+old.path);assert.equal(f.calls.length,1);
 response=await worker.fetch(req('/audio/natural/v040-natural-572f7490ce71/unknown.mp3'),env,ctx);assert.equal(response.status,404);assert.equal(calls.length,1);assert.equal(f.calls.length,1);
});
test('timeout fails closed when the asset binding never resolves',async()=>{
 const handler=local.createLocalCandidateMediaHandler(manifest,10),f=fixture({fetch:()=>new Promise(()=>{})});
 const response=await handler(req(manifest.entries[0].path),f.assets);assert.equal(response.status,502);assert.equal(f.calls[0].signal.aborted,true);
});
test('stalled asset body is cancelled on timeout and corrupt HEAD fails closed',async()=>{
 const row=manifest.entries[0];let cancelled=false;
 const stalled=fixture({fetch:async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}}),{headers:{'Content-Type':row.contentType}})});
 const handler=local.createLocalCandidateMediaHandler(manifest,10),response=await handler(req(row.path),stalled.assets);
 assert.equal(response.status,502);assert.equal(cancelled,true);
 const corrupt=fixture({fetch:async()=>new Response(bytes(row).subarray(1),{headers:{'Content-Type':row.contentType}})});
 const head=await handler(req(row.path,{method:'HEAD'}),corrupt.assets);assert.equal(head.status,502);assert.equal((await head.arrayBuffer()).byteLength,0);
});
