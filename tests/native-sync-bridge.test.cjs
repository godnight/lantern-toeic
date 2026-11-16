'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const ts=createRequire(path.join(root,'package.json'))('typescript');
const owner='usr_00000000-0000-4000-8000-000000000001';
const event={id:'review-1',wordId:'word-1',createdAt:'2026-01-01T10:00:00.000Z',type:'review',grade:'remembered'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function compile(file,imports,timer=setTimeout){const exports={};const out=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});vm.runInNewContext(out.outputText,{exports,require:n=>{if(!(n in imports))throw Error('unexpected import '+n);return imports[n];},canIUse:()=>true,Date,JSON,Object,Array,Number,Math,String,Error,Promise,Set,Map,setTimeout:timer,clearTimeout},{filename:file});return exports;}
function setup(kind){
 const vocab=kind==='vocabulary',callback=vocab?'__lanternSyncReceive':'__lanternStudySyncReceive',hostName=vocab?'LanternSyncHost':'LanternStudySyncHost';
 const lease={uid:owner,authEpoch:1,expiresAtUptimeMs:1000};let release,started;let calls=0;
 const entered=new Promise(resolve=>{started=resolve;});
 const http={RequestMethod:{POST:'POST',GET:'GET'},HttpDataType:{STRING:'STRING'},createHttp:()=>({request(){calls++;started();return new Promise(resolve=>{release=resolve;});},destroy(){}})};
 const imports={'@kit.ArkWeb':{},'@ohos.net.http':{__esModule:true,default:http},'@ohos.deviceInfo':{__esModule:true,default:{sdkApiVersion:23}},'../auth/AuthConfiguration':{AUTH_API_ORIGIN:'https://sync.invalid'},'../auth/AuthPolicy':{COOKIE_NAME:'__Host-lantern-session',configuredOrigin:()=>true,trustedFrame:url=>url==='https://lantern.local/',utf8Length:s=>Buffer.byteLength(s)},'../media/VerifiedOwnerLease':{},'./NativeSyncHost':{}};
 const {NativeSyncHost,NativeStudySyncHost}=compile(path.join(root,'harmony/entry/src/main/ets/sync',vocab?'NativeSyncHost.ets':'NativeStudySyncHost.ets'),imports);
 const target={location:{origin:'https://lantern.local'},crypto:{randomUUID}};
 const controller={registerJavaScriptProxy(){},deleteJavaScriptRegister(){},getLastJavascriptProxyCallingFrameUrl:()=> 'https://lantern.local/',getUrl:()=> 'https://lantern.local/',async runJavaScript(script){vm.runInNewContext(script,{window:{[callback]:value=>target[callback]?.(value)}});}};
 const provider={snapshot:()=>lease,subscribe:()=>()=>{}},gate={async withSession(l,fn){assert.equal(l,lease);await fn('a'.repeat(64));}};
 const host=new (vocab?NativeSyncHost:NativeStudySyncHost)(controller,()=>true,provider,gate,true);assert.equal(host.attach(),true);assert.equal(host.resumeForOwner(owner),true);
 target[hostName]={request:raw=>host.request(raw),cancel:id=>host.cancel(id)};
 const transport=vocab?compile(path.join(root,'lib/native-sync-transport.ts'),{}).createNativeSyncTransport(target):compile(path.join(root,'lib/native-study-transport.ts'),{}).createNativeStudyTransport(target);
 function request(signal){return vocab?transport.append({owner,event},signal):transport.pull({owner,checkpoint:null,continuation:null,signal});}
 return {host,target,transport,request,entered,release:(status=503,body='{}',headers={'content-type':'application/json'})=>release({responseCode:status,header:headers,result:body}),calls:()=>calls,close(){transport.dispose();host.dispose();}};
}
for(const kind of ['vocabulary','study']){
 test(kind+' native busy is distinct and has no automatic retry promise',async()=>{
  const f=setup(kind);try{
   const first=f.request(new AbortController().signal);await f.entered;
   await assert.rejects(f.request(new AbortController().signal),err=>err.code==='NATIVE_BUSY'&&err.safeToRetry!==true);
   assert.equal(f.calls(),1);f.release();await assert.rejects(first,err=>err.code==='NATIVE_TRANSIENT'&&err.safeToRetry!==true);
  }finally{f.close();}
 });
 test(kind+' request limit rejects promptly without making a network request',async()=>{
  const f=setup(kind);try{
   for(let i=0;i<4096;i++)f.host.seen.add('synthetic-'+i);
   await assert.rejects(f.request(new AbortController().signal),err=>err.code==='NATIVE_REQUEST_LIMIT'&&err.safeToRetry!==true);
   assert.equal(f.calls(),0);assert.equal(f.host.seen.size,4096);
  }finally{f.close();}
 });
 test(kind+' malformed busy replies cannot authorize a retry',async()=>{
  const f=setup(kind);try{
   let captured;f.target[kind==='vocabulary'?'LanternSyncHost':'LanternStudySyncHost'].request=raw=>{captured=JSON.parse(raw);};
   for(const body of [{code:'busy',extra:true},{code:'busy',safeToRetry:true},{code:'unknown'}]){
    const p=f.request(new AbortController().signal);f.target[kind==='vocabulary'?'__lanternSyncReceive':'__lanternStudySyncReceive']({id:captured.id,status:503,body});
    await assert.rejects(p,err=>err.code===undefined&&err.safeToRetry!==true);
   }
  }finally{f.close();}
 });
 test(kind+' keeps authorization and conflict distinct from temporary outages',async()=>{
  for(const [status,code] of [[401,'NATIVE_AUTH'],[403,'NATIVE_AUTH'],[409,'NATIVE_CONFLICT']]){
   const f=setup(kind);try{const pending=f.request(new AbortController().signal);await f.entered;f.release(status);await assert.rejects(pending,err=>err.code===code&&err.safeToRetry!==true);}
   finally{f.close();}
  }
 });
 test(kind+' does not mark rejected or malformed server replies as transient',async()=>{
  for(const status of [200,400,422]){
   const f=setup(kind);try{const pending=f.request(new AbortController().signal);await f.entered;f.release(status);await assert.rejects(pending,err=>err.code===undefined&&err.safeToRetry!==true);}
   finally{f.close();}
  }
 });
 test(kind+' classifies temporary throttling and server failures for bounded retries',async()=>{
  for(const status of [408,429,500,502,503,504]){
   const f=setup(kind);try{const pending=f.request(new AbortController().signal);await f.entered;f.release(status);await assert.rejects(pending,err=>err.code==='NATIVE_TRANSIENT'&&err.safeToRetry!==true);}
   finally{f.close();}
  }
 });
}

test('native study bridge accepts the optional first-attempt anchor and rejects malformed anchors',async()=>{
 for(const valid of [true,false]){
  const f=setup('study'),id=randomUUID(),wire={id:randomUUID(),owner,type:'attempt',data:{id,qid:'q',choice:0,createdAt:'2026-01-01T10:00:00.000Z',seconds:3,firstAttemptId:valid?id:'bad'}};
  try{
   const abort=new AbortController(),result=f.transport.upload({owner,wire,signal:abort.signal});
   if(valid){await f.entered;assert.equal(f.calls(),1);f.release();await assert.rejects(result,err=>err.code==='NATIVE_TRANSIENT');}
   else{await tick();assert.equal(f.calls(),0);abort.abort();await assert.rejects(result);}
  }finally{f.close();}
 }
});
test('only exact authenticated upload conflict codes become record-scoped conflicts',async()=>{
 for(const kind of ['vocabulary','study'])for(const scenario of ['event','generic','extra','cookie']){
  const f=setup(kind),id=randomUUID(),wire={id:randomUUID(),owner,type:'attempt',data:{id,qid:'q',choice:0,createdAt:'2026-01-01T10:00:00.000Z',seconds:3,firstAttemptId:id}};
  try{
   const pending=kind==='vocabulary'?f.request(new AbortController().signal):f.transport.upload({owner,wire,signal:new AbortController().signal});await f.entered;
   const body=scenario==='generic'?{error:'owner mismatch'}:scenario==='extra'?{code:'event-payload-conflict',extra:true}:{code:'event-payload-conflict'};
   f.release(409,JSON.stringify(body),scenario==='cookie'?{'content-type':'application/json','set-cookie':'bad'}:{'content-type':'application/json'});
   await assert.rejects(pending,e=>e.code===(scenario==='event'?'NATIVE_EVENT_CONFLICT':'NATIVE_CONFLICT'));
  }finally{f.close();}
 }
});
test('native adapter timeout cancels the request and is retryable without confusing session cancellation',async()=>{
 for(const kind of ['vocabulary','study']){
  const vocab=kind==='vocabulary',host=vocab?'LanternSyncHost':'LanternStudySyncHost',cancelled=[];
  const target={location:{origin:'https://lantern.local'},crypto:{randomUUID},[host]:{request(){},cancel(id){cancelled.push(id);}}};
  const module=compile(path.join(root,'lib',vocab?'native-sync-transport.ts':'native-study-transport.ts'),{},(fn,ms)=>setTimeout(fn,ms===15000?5:ms));
  const transport=vocab?module.createNativeSyncTransport(target):module.createNativeStudyTransport(target);
  try{
   const pending=vocab?transport.append({owner,event},new AbortController().signal):transport.pull({owner,checkpoint:null,continuation:null,signal:new AbortController().signal});
   await assert.rejects(pending,e=>e.code==='NATIVE_TRANSIENT');assert.equal(cancelled.length,1);
   const abort=new AbortController(),cancel=vocab?transport.append({owner,event},abort.signal):transport.pull({owner,checkpoint:null,continuation:null,signal:abort.signal});abort.abort();
   await assert.rejects(cancel,e=>e.code===undefined);assert.equal(cancelled.length,2);
  }finally{transport.dispose();}
 }
});
