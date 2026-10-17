// Actual Sites identity accessor, upload route, Drizzle schema and SQLite.
// D1/R2 transport and request headers are local adapters, not production services.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {AsyncLocalStorage}=require('node:async_hooks');
const {DatabaseSync}=require('node:sqlite');
const crypto=require('node:crypto');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'../..');
const ts=require(path.join(root,'node_modules/typescript'));
function environment(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
 const objects=new Map(),calls={put:[],get:[],delete:[]},hooks={},ambient=new AsyncLocalStorage(),cache=new Map();
 function prepare(sql,params=[]){
  async function execute(method){
   await hooks.beforeSql?.(sql,params,method);
   const stmt=sqlite.prepare(sql);
   const result=method==='raw'?stmt.all(...params).map(row=>Object.values(row)):method==='all'?{results:stmt.all(...params),success:true}:method==='first'?stmt.get(...params)||null:{meta:{changes:Number(stmt.run(...params).changes)},success:true};
   await hooks.afterSql?.(sql,params,method,result);
   return result;
  }
  return {bind:(...values)=>prepare(sql,values),run:()=>execute('run'),raw:()=>execute('raw'),all:()=>execute('all'),first:()=>execute('first')};
 }
 const bucket={
  async put(key,body,options){calls.put.push(key);await hooks.beforePut?.(key);const bytes=Buffer.from(body);if(options.sha256!==crypto.createHash('sha256').update(bytes).digest('hex'))throw Error('Checksum mismatch');objects.set(key,{bytes,httpMetadata:options.httpMetadata});await hooks.afterPut?.(key);return {size:bytes.length};},
  async get(key){calls.get.push(key);await hooks.beforeGet?.(key);const value=objects.get(key);return value?{size:value.bytes.length,httpMetadata:value.httpMetadata,body:new Response(value.bytes).body,arrayBuffer:async()=>new Uint8Array(value.bytes).buffer}:null;},
  async delete(key){calls.delete.push(key);await hooks.beforeDelete?.(key);objects.delete(key);},
 };
 const env={DB:{prepare},BUCKET:bucket};
 function load(file){
  if(cache.has(file))return cache.get(file);
  if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
  const exports={};cache.set(file,exports);
  const resolve=name=>{
   if(name==='cloudflare:workers')return {env};
   if(name==='next/headers')return {headers:async()=>ambient.getStore()||new Headers()};
   if(!name.startsWith('@/')&&!name.startsWith('.'))return require(path.join(root,'node_modules',name));
   const base=name.startsWith('@/')?name.slice(2):path.posix.join(path.posix.dirname(file),name);
   const next=[base,base+'.ts',base+'/index.ts'].find(x=>fs.existsSync(path.join(root,x))&&fs.statSync(path.join(root,x)).isFile());
   if(!next)throw Error('Missing real module '+name);return load(next);
  };
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText;
  vm.runInNewContext(code,{exports,require:resolve,Date,Intl,Map,Set,Error,SyntaxError,JSON,Promise,Buffer,structuredClone,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Blob,File,FormData,URL,Request,Response,Headers,ReadableStream,AbortController,crypto:crypto.webcrypto},{filename:file});
  return exports;
 }
 const route=load('app/api/recordings/route.ts'),prompt=load('content/speaking.json')[0];
 function upload(owner,id,bytes='fixture-a',extra={},headers={}){
  const form=new FormData();form.set('meta',JSON.stringify({id,promptId:prompt.id,createdAt:'2026-01-01T00:00:00.000Z',duration:4,note:'fixture',...extra}));
  form.set('audio',new File([bytes],'fixture.webm',{type:'audio/webm'}));
  const request=new Request('https://study.test/api/recordings',{method:'POST',headers:{origin:'https://study.test','x-lantern-owner':owner,...headers},body:form});
  return ambient.run(new Headers({'oai-authenticated-user-id':owner}),()=>route.POST(request));
 }
 function get(owner,id){return ambient.run(new Headers({'oai-authenticated-user-id':owner}),()=>route.GET(new Request('https://study.test/api/recordings?id='+id)));}
 return {sqlite,objects,calls,hooks,env,upload,get,prompt,rows:()=>sqlite.prepare('SELECT * FROM recordings').all(),close:()=>sqlite.close()};
}
module.exports={environment};
