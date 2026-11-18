const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const {build}=require(path.join(root,'node_modules/esbuild'));
const {Miniflare,Log,LogLevel}=require(path.join(root,'node_modules/miniflare'));
const origin='https://study.test';

test('real local workerd D1/R2 verifies product sessions and immutable recording uploads', {timeout:60000},async t=>{
 const result=await build({stdin:{contents:`
  import {credentialAction} from './lib/auth-service';
  import {POST,GET} from './app/api/recordings/route';
  export default {fetch(request,env){
   if(new URL(request.url).pathname==='/register')return credentialAction(request,'register',env);
   return request.method==='POST'?POST(request):GET(request);
  }};`,resolveDir:root,sourcefile:'account-recording-runtime-worker.ts',loader:'ts'},
  bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['node:*','cloudflare:workers'],
  plugins:[{name:'no-ambient-browser-identity',setup(builder){
   builder.onResolve({filter:/^next\/headers$/},()=>({path:'next/headers',namespace:'runtime-test'}));
   builder.onLoad({filter:/.*/,namespace:'runtime-test'},()=>({contents:'export function headers(){throw new Error("This route must authenticate its actual request")}'}));
  }}]});
 const mf=new Miniflare({name:'account-recording-runtime',modules:true,script:result.outputFiles[0].text,
  compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],cf:false,host:'127.0.0.1',port:0,
  d1Databases:{DB:'account-recording-runtime-only'},d1Persist:false,r2Buckets:{BUCKET:'account-recording-runtime-only'},r2Persist:false,
  bindings:{LANTERN_AUTH_ENABLED:'true',LANTERN_AUTH_ORIGIN:origin},log:new Log(LogLevel.ERROR),
  outboundService:()=>new Response('External requests disabled',{status:502})});
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');
 for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(x=>/^\d+.*\.sql$/.test(x)).sort()){
  const sql=fs.readFileSync(path.join(root,'drizzle',name),'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean);
  await db.batch(sql.map(x=>db.prepare(x)));
 }
 async function register(username){
  const response=await mf.dispatchFetch(origin+'/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username,password:'Synthetic local recording runtime only 2026!'})});
  assert.equal(response.status,200);return {cookie:response.headers.get('set-cookie').split(';')[0],...(await response.json()).user};
 }
 const alice=await register('recording_a'),bob=await register('recording_b'),id='00000000-0000-4000-8000-000000000047';
 const prompt=JSON.parse(fs.readFileSync(path.join(root,'content/speaking.json'),'utf8'))[0];
 const meta={id,promptId:prompt.id,createdAt:'2026-01-01T00:00:00.000Z',duration:4,note:'synthetic only'};
 async function upload(user,bytes='fixture-a',extra={},headers={}){
  const form=new FormData();form.set('meta',JSON.stringify({...meta,...extra}));form.set('audio',new Blob([bytes],{type:'audio/wav'}),'synthetic.wav');
  // Encode Node's FormData through its Request implementation before crossing
  // into Miniflare's independent fetch implementation (which has its own class).
  const encoded=new Request(origin+'/api/recordings',{method:'POST',body:form});
  return mf.dispatchFetch(encoded.url,{method:'POST',headers:{'Content-Type':encoded.headers.get('content-type'),Origin:origin,Cookie:user.cookie,'X-Lantern-Owner':user.id,...headers},body:await encoded.arrayBuffer()});
 }
 const get=user=>mf.dispatchFetch(origin+'/api/recordings?id='+id,{headers:{Cookie:user.cookie}});
 const first=await upload(alice);assert.equal(first.status,200,await first.text());
 const row=await db.prepare('SELECT * FROM recordings WHERE id=?').bind(id).first();assert.equal(row.user_id,alice.id);
 assert.ok(row.object_key.startsWith('recordings/'+alice.id+'/'+id+'/'));
 assert.equal((await upload(alice)).status,200);
 assert.equal((await upload(alice,'changed-bytes')).status,422);
 assert.equal((await upload(alice,'fixture-a',{duration:9})).status,422);
 assert.equal((await upload(bob)).status,422);
 assert.equal((await upload(alice,'fixture-a',{}, {'X-Lantern-Owner':bob.id})).status,409);
 assert.equal((await upload(alice,'fixture-a',{}, {Origin:'https://foreign.test'})).status,403);
 assert.equal((await upload(alice,'fixture-a',{}, {Cookie:''})).status,401);
 const owned=await get(alice);assert.equal(owned.status,200);assert.equal(owned.headers.get('content-type'),'audio/wav');assert.equal(await owned.text(),'fixture-a');
 assert.equal((await get(bob)).status,404);
 assert.deepEqual(await db.prepare('SELECT * FROM recordings WHERE id=?').bind(id).first(),row);
 const objects=await bucket.list();assert.equal(objects.objects.length,1);assert.equal(objects.objects[0].key,row.object_key);
 assert.equal(await (await bucket.get(row.object_key)).text(),'fixture-a');
 t.diagnostic('Actual production auth + recording route; real local workerd, D1 and R2. Synthetic bytes, no external service, browser TLS, microphone, cloud latency or native device claim.');
});
