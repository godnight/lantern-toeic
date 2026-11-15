'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const ts=createRequire(path.join(root,'package.json'))('typescript');
const owner='usr_00000000-0000-4000-8000-000000000001';
const event={id:'review-1',wordId:'word-1',createdAt:'2026-01-01T10:00:00.000Z',type:'review',grade:'remembered'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function compile(file,imports){const exports={};const out=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});vm.runInNewContext(out.outputText,{exports,require:n=>{if(!(n in imports))throw Error('unexpected import '+n);return imports[n];},canIUse:()=>true,Date,JSON,Object,Array,Number,Math,String,Error,Promise,Set,Map,setTimeout,clearTimeout},{filename:file});return exports;}
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
 return {host,target,transport,request,entered,release:()=>release({responseCode:503,header:{'content-type':'application/json'},result:'{}'}),calls:()=>calls,close(){transport.dispose();host.dispose();}};
}
for(const kind of ['vocabulary','study']){
 test(kind+' native busy is distinct and has no automatic retry promise',async()=>{
  const f=setup(kind);try{
   const first=f.request(new AbortController().signal);await f.entered;
   await assert.rejects(f.request(new AbortController().signal),err=>err.code==='NATIVE_BUSY'&&err.safeToRetry!==true);
   assert.equal(f.calls(),1);f.release();await assert.rejects(first,err=>err.code===undefined&&err.safeToRetry!==true);
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
}
