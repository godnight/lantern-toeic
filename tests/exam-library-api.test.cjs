// Real application modules + real SQLite SQL. R2/network and authenticated gateway are test doubles.
// This proves behavior and race handling, not a deployed Sites/R2 upload or phone download.
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const fixture=require(path.join(root,'tests/fixtures/synthetic-exam.cjs'));
const plain=v=>JSON.parse(JSON.stringify(v));
function load(file,imports={},globals={}){
 const exports={},code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{if(!Object.hasOwn(imports,name))return require('./helpers/actual-source-loader.cjs').createSourceLoader({root,imports,globals:globals}).resolve(name,file);return imports[name];},Date,Map,Set,Error,JSON,Promise,structuredClone,TextEncoder,TextDecoder,Uint8Array,Uint32Array,ArrayBuffer,Blob,File,URL,Request,Response,Headers,ReadableStream,AbortController,atob,btoa,crypto:crypto.webcrypto,...globals},{filename:file});return exports;
}
const model=load('lib/exam-model.ts'),library=load('lib/exam-library.ts',{'@/lib/exam-model':model},{indexedDB:new (require('fake-indexeddb').IDBFactory)()});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function sample(id='cloud-structure-only'){
 const exam=fixture(id),body=JSON.stringify(exam),bytes=Buffer.byteLength(body);
 return {body,manifest:{examId:exam.id,version:exam.version,title:exam.title,bytes,sha256:sha(body)}};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function environment(){
 const sqlite=new DatabaseSync(':memory:');for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));
 const state={uid:'alice',putCalls:0,deleteCalls:0,sqlCalls:0,failPut:false,failAfterPut:false,failDelete:false,failCommit:false,putGate:null,entered:deferred()};
 const objects=new Map();
 const db={prepare(sql){return {bind(...args){const statement=sqlite.prepare(sql);return {
  async first(){state.sqlCalls++;return statement.get(...args)||null;},
  async all(){state.sqlCalls++;return {results:statement.all(...args)};},
  async run(){state.sqlCalls++;if(state.failCommit&&sql.includes("SET state = 'ready'"))throw Error('Simulated D1 commit failure');const result=statement.run(...args);return {meta:{changes:Number(result.changes)}};}
 };}};}};
 const bucket={async put(key,stream,options){
  state.putCalls++;state.entered.resolve();if(state.putGate)await state.putGate.promise;
  if(state.failPut)throw Error('Simulated R2 unavailable');
  const bytes=Buffer.from(await new Response(stream).arrayBuffer());assert.ok(options.sha256,'The app must request checksum verification');
  if(sha(bytes)!==options.sha256)throw Error('Simulated R2 SHA256 mismatch');
  objects.set(key,{bytes,options});if(state.failAfterPut)throw Error('Ambiguous R2 failure after persistence');
  return {size:bytes.length,checksums:{sha256:Uint8Array.from(Buffer.from(options.sha256,'hex')).buffer}};
 },async get(key){const object=objects.get(key);return object?{size:object.bytes.length,body:new Response(object.bytes).body}:null;},async delete(key){state.deleteCalls++;if(state.failDelete)throw Error('Simulated R2 delete failure');objects.delete(key);}};
 const auth={userId:async()=>state.uid,safeMutation(request){const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin;},privateJson(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});}};
 const env={DB:db,BUCKET:bucket};
 const route=load('app/api/exam-library/route.ts',{'cloudflare:workers':{env},'@/lib/server-auth':auth,'@/lib/exam-library':library});
 function request(method='GET',id='',data=sample(),headerChanges={}){
  const headers={'x-lantern-owner':state.uid||'alice',origin:'https://study.test',...headerChanges};
  if(method==='POST'){headers['Content-Type']='application/json';headers['x-exam-manifest']=encodeURIComponent(JSON.stringify(data.manifest));headers['Content-Length']=String(Buffer.byteLength(data.body));Object.assign(headers,headerChanges);}
  for(const key of Object.keys(headers))if(headers[key]===undefined)delete headers[key];
  return new Request('https://study.test/api/exam-library'+(id?'?id='+id:''),{method,headers,...(method==='POST'?{body:data.body}:{})});
 }
 function seed(count,bytes=10,uid='alice'){
  const insert=sqlite.prepare('INSERT INTO exam_library(id,user_id,object_key,manifest,bytes,sha256,state,created_at) VALUES(?,?,?,?,?,?,?,?)');
  for(let i=0;i<count;i++){const id=crypto.randomUUID(),manifest={...sample('seed-'+i).manifest,bytes,sha256:sha(id)};insert.run(id,uid,'private/'+uid+'/'+id,JSON.stringify(manifest),bytes,manifest.sha256,'ready',new Date().toISOString());}
 }
 return {state,objects,sqlite,route,request,seed,env,rows(){return sqlite.prepare('SELECT * FROM exam_library ORDER BY id').all();},close(){sqlite.close();}};
}
test('missing authentication, wrong owner and cross-origin mutation never access storage',async()=>{
 const e=environment();e.state.uid=null;assert.equal((await e.route.GET(e.request())).status,401);assert.equal((await e.route.POST(e.request('POST'))).status,401);
 e.state.uid='alice';assert.equal((await e.route.POST(e.request('POST','',sample(),{'x-lantern-owner':'bob'}))).status,409);
 assert.equal((await e.route.GET(e.request('GET','',sample(),{'x-lantern-owner':'bob'}))).status,409);
 assert.equal((await e.route.POST(e.request('POST','',sample(),{origin:'https://elsewhere.test'}))).status,403);
 assert.equal(e.state.sqlCalls,0);assert.equal(e.state.putCalls,0);e.close();
});
test('upload rejects invalid manifest, absent length and wrong media type before reservation',async()=>{
 const e=environment(),valid=sample();
 const changes=[{'x-exam-manifest':'%ZZ'},{'x-exam-manifest':encodeURIComponent(JSON.stringify({...valid.manifest,bytes:model.EXAM_LIMITS.importBytes+1}))},{'Content-Length':undefined},{'Content-Length':'1'},{'Content-Type':'text/html'}];
 for(const headers of changes)assert.equal((await e.route.POST(e.request('POST','',valid,headers))).status,400);
 assert.equal(e.rows().length,0);assert.equal(e.state.putCalls,0);e.close();
});
test('streamed upload is private, checksum protected, idempotent and downloadable by its owner',async()=>{
 const e=environment(),data=sample();assert.equal((await e.route.POST(e.request('POST','',data))).status,200);
 const row=e.rows()[0];assert.equal(row.state,'ready');assert.match(row.object_key,/^exam-library\/alice\//);
 assert.equal((await e.route.POST(e.request('POST','',data))).status,200);assert.equal(e.rows().length,1);assert.equal(e.state.putCalls,1);
 const listing=await (await e.route.GET(e.request())).json();assert.equal(listing.items.length,1);assert.equal('object_key'in listing.items[0],false);assert.equal('user_id'in listing.items[0],false);
 const response=await e.route.GET(e.request('GET',row.id));assert.match(response.headers.get('cache-control'),/private/);assert.match(response.headers.get('cache-control'),/no-store/);assert.match(response.headers.get('cache-control'),/no-transform/);
 assert.match(response.headers.get('content-disposition'),/^attachment/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(await library.checkedLibraryDownload(response,listing.items[0]),data.body);e.close();
});
test('another owner cannot list, download or delete an existing private object',async()=>{
 const e=environment();await e.route.POST(e.request('POST'));const row=e.rows()[0];e.state.uid='bob';
 assert.deepEqual((await (await e.route.GET(e.request())).json()).items,[]);assert.equal((await e.route.GET(e.request('GET',row.id))).status,404);
 assert.equal((await e.route.DELETE(e.request('DELETE',row.id))).status,200);assert.equal(e.rows().length,1);assert.equal(e.objects.size,1);e.close();
});
test('same-hash concurrent uploads reserve once and do not delete the winning object',async()=>{
 const e=environment();e.state.putGate=deferred();const first=e.route.POST(e.request('POST'));await e.state.entered.promise;
 assert.equal((await e.route.POST(e.request('POST'))).status,409);assert.equal(e.rows().length,1);
 e.state.putGate.resolve();assert.equal((await first).status,200);assert.equal(e.objects.size,1);assert.equal(e.rows()[0].state,'ready');e.close();
});
test('atomic count reservation permits only one of two uploads at the final slot',async()=>{
 const e=environment();e.seed(31);const result=await Promise.all([e.route.POST(e.request('POST','',sample('one'))),e.route.POST(e.request('POST','',sample('two')))]);
 assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);assert.equal(e.rows().length,32);assert.equal(e.state.putCalls,1);e.close();
});
test('atomic byte reservation includes pending uploads and cannot overshoot 2 GiB',async()=>{
 const e=environment(),one=sample('one'),two=sample('two'),size=Math.max(one.manifest.bytes,two.manifest.bytes),limit=library.EXAM_LIBRARY_LIMITS.bytes;
 e.seed(21,96*1024*1024);e.seed(1,limit-21*96*1024*1024-size-5);
 const result=await Promise.all([e.route.POST(e.request('POST','',one)),e.route.POST(e.request('POST','',two))]);
 assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);assert.ok(e.rows().reduce((n,r)=>n+r.bytes,0)<=limit);assert.equal(e.state.putCalls,1);e.close();
});
for(const failure of ['failPut','failAfterPut','failCommit'])test(`${failure} leaves no ready catalog or orphaned object`,async()=>{
 const e=environment();e.state[failure]=true;assert.equal((await e.route.POST(e.request('POST'))).status,503);assert.equal(e.rows().length,0);assert.equal(e.objects.size,0);e.close();
});
test('R2 checksum mismatch rejects an upload without retaining quota reservation',async()=>{
 const e=environment(),data=sample();data.manifest.sha256='0'.repeat(64);assert.equal((await e.route.POST(e.request('POST','',data))).status,503);assert.equal(e.rows().length,0);assert.equal(e.objects.size,0);e.close();
});
test('failed cleanup keeps a visible reservation and DELETE retry removes it',async()=>{
 const e=environment();e.state.failAfterPut=true;e.state.failDelete=true;
 assert.equal((await e.route.POST(e.request('POST'))).status,503);assert.equal(e.rows().length,1);assert.equal(e.objects.size,1);
 const row=e.rows()[0];assert.notEqual(row.state,'ready');assert.equal((await e.route.GET(e.request('GET',row.id))).status,404);
 e.state.failDelete=false;assert.equal((await e.route.DELETE(e.request('DELETE',row.id))).status,200);assert.equal(e.rows().length,0);assert.equal(e.objects.size,0);e.close();
});
test('failed object deletion creates a hidden-from-download tombstone and is retryable',async()=>{
 const e=environment();await e.route.POST(e.request('POST'));const row=e.rows()[0];e.state.failDelete=true;
 assert.equal((await e.route.DELETE(e.request('DELETE',row.id))).status,503);assert.equal(e.rows()[0].state,'deleting');assert.equal((await e.route.GET(e.request('GET',row.id))).status,404);
 e.state.failDelete=false;assert.equal((await e.route.DELETE(e.request('DELETE',row.id))).status,200);assert.equal(e.rows().length,0);assert.equal(e.objects.size,0);e.close();
});
test('deleting while upload awaits R2 prevents late completion from publishing or orphaning bytes',async()=>{
 const e=environment();e.state.putGate=deferred();const upload=e.route.POST(e.request('POST'));await e.state.entered.promise;const row=e.rows()[0];
 assert.equal((await e.route.DELETE(e.request('DELETE',row.id))).status,200);e.state.putGate.resolve();assert.equal((await upload).status,503);
 assert.equal(e.rows().length,0);assert.equal(e.objects.size,0);e.close();
});
test('missing or wrong-sized R2 objects never return a successful download',async()=>{
 const e=environment();await e.route.POST(e.request('POST'));const row=e.rows()[0],object=e.objects.get(row.object_key);
 e.objects.delete(row.object_key);assert.equal((await e.route.GET(e.request('GET',row.id))).status,503);
 e.objects.set(row.object_key,{...object,bytes:Buffer.from('truncated')});assert.equal((await e.route.GET(e.request('GET',row.id))).status,503);e.close();
});
function download(body,item,headers={}){return new Response(body,{headers:{'content-type':'application/json','content-length':String(item.bytes),...headers}});}
test('download uses decoded bytes and checksum when Content-Length is absent or content is encoded',async()=>{
 const data=sample(),item={...data.manifest,id:crypto.randomUUID(),state:'ready',createdAt:new Date().toISOString()};
 assert.equal(await library.checkedLibraryDownload(new Response(data.body,{headers:{'content-type':'application/json'}}),item),data.body);
 assert.equal(await library.checkedLibraryDownload(download(data.body,item,{'content-length':'100','content-encoding':'gzip'}),item),data.body);
});
test('download rejects truncation, overlong stream, wrong checksum and wrong catalog identity',async()=>{
 const data=sample(),item={...data.manifest,id:crypto.randomUUID(),state:'ready',createdAt:new Date().toISOString()};
 await assert.rejects(library.checkedLibraryDownload(download(data.body.slice(0,-1),item),item),/不完整/);
 await assert.rejects(library.checkedLibraryDownload(download(data.body+' ',item),item),/超过/);
 await assert.rejects(library.checkedLibraryDownload(download(data.body,item),{...item,sha256:'0'.repeat(64)}),/校验/);
 await assert.rejects(library.checkedLibraryDownload(download(data.body,item),{...item,title:'wrong title'}),/目录/);
 await assert.rejects(library.checkedLibraryDownload(new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),item),/登录/);
});
test('correct checksums do not bypass real complete-exam parsing',async()=>{
 const body=JSON.stringify({kind:'lantern-toeic-exam',schemaVersion:1}),item={...sample().manifest,bytes:Buffer.byteLength(body),sha256:sha(body),id:crypto.randomUUID(),state:'ready',createdAt:new Date().toISOString()};
 await assert.rejects(library.checkedLibraryDownload(download(body,item),item));
});
