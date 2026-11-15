'use strict';
// Actual ETS/TS source executed with synthetic OS, network and ArkWeb ports.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{randomUUID}=require('node:crypto');
const ts=require('typescript'),{hostRuntime,response}=require('./helpers/native-auth-host-runtime.cjs');
const {buildSync}=require('esbuild'),{Module}=require('node:module');
const root=path.resolve(__dirname,'..'),syncDir=path.join(root,'harmony/entry/src/main/ets/sync'),owner='usr_aaaaaaaa-1111-4111-8111-111111111111';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function compile(file,imports){const exports={},out=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});vm.runInNewContext(out.outputText,{exports,require:n=>{if(!(n in imports))throw Error('unexpected import '+n);return imports[n];},canIUse:()=>true,Date,JSON,Object,Array,Number,Math,String,Error,Promise,Set,Map,setTimeout,clearTimeout},{filename:file});return exports;}
function fixture(dispatch){
 const auth=hostRuntime({initialToken:'a'.repeat(64),dispatch}),provider=auth.host.trustedOwnerProvider(),target={location:{origin:'https://lantern.local'},crypto:{randomUUID}},calls=[],replies=[];
 let frame='https://lantern.local/',release,started;const entered=new Promise(resolve=>{started=resolve;});
 const http={RequestMethod:{POST:'POST',GET:'GET'},HttpDataType:{STRING:'STRING'},createHttp:()=>({async request(url,options){calls.push({url,options});started();return new Promise(resolve=>{release=resolve;});},destroy(){}})};
 const controller={registerJavaScriptProxy(instance,name,methods){target[name]=Object.fromEntries(methods.map(method=>[method,instance[method].bind(instance)]));},deleteJavaScriptRegister(name){delete target[name];},getLastJavascriptProxyCallingFrameUrl:()=>frame,getUrl:()=> 'https://lantern.local/',async runJavaScript(script){vm.runInNewContext(script,{window:target});}};
 const imports={'@kit.ArkWeb':{},'@ohos.net.http':{__esModule:true,default:http},'@ohos.deviceInfo':{__esModule:true,default:{sdkApiVersion:23}},'../auth/AuthConfiguration':{AUTH_API_ORIGIN:'https://synthetic.invalid'},'../auth/AuthPolicy':{COOKIE_NAME:'__Host-lantern-session',configuredOrigin:()=>true,trustedFrame:url=>url==='https://lantern.local/',utf8Length:s=>Buffer.byteLength(s)},'../media/VerifiedOwnerLease':{},'./NativeSyncHost':{},'./NativeStudySyncHost':{}};
 const Sync=compile(path.join(syncDir,'NativeSyncHost.ets'),imports).NativeSyncHost,Study=compile(path.join(syncDir,'NativeStudySyncHost.ets'),imports).NativeStudySyncHost;
 const Observer=compile(path.join(syncDir,'NativeLifecycleObserver.ets'),imports).NativeLifecycleObserver;
 const sync=new Sync(controller,()=>true,provider,auth.host,true),study=new Study(controller,()=>true,provider,auth.host,true),observer=new Observer(controller,provider,()=>true,sync,study,true);
 assert.equal(sync.attach(),true);assert.equal(study.attach(),true);assert.equal(observer.attach(),true);
 assert.equal(auth.host.ownerLease.publishVerifiedV2(owner,0,1000,auth.host.ownerLease.version()),true);
 target.__lanternSyncReceive=value=>replies.push(value);target.__lanternStudySyncReceive=value=>replies.push(value);
 const port=compile(path.join(root,'lib/cloud-sync/native-lifecycle-port.ts'),{}).createNativeSyncLeasePort(target,40);
 return {auth,provider,target,sync,study,observer,port,calls,replies,entered,setFrame(value){frame=value;},release:()=>release({responseCode:200,header:{'content-type':'application/json'},result:JSON.stringify({id:randomUUID(),owner,upper:0,cursor:'start'})}),close(){port.dispose();observer.dispose();sync.dispose();study.dispose();auth.dispose();}};
}
test('native hold freezes both bridges, drains the shared lock and survives lease revocation',async()=>{
 const f=fixture();try{
  assert.deepEqual(JSON.parse(JSON.stringify(await f.port.snapshot())),{owner,seq:0});await f.port.resume();
  f.target.LanternSyncHost.request(JSON.stringify({id:randomUUID(),action:'snapshot',owner,pageSize:1}));await f.entered;assert.equal(f.calls.length,1);
  await f.port.hold();let drained=false;const wait=f.port.drain().then(()=>{drained=true;});wait.catch(()=>{});await tick();assert.equal(drained,false);
  const next=randomUUID();f.target.LanternStudySyncHost.request(JSON.stringify({id:next,action:'pull',owner,checkpoint:null,continuation:null}));
  await tick();assert.equal(f.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.replies.at(-1))),{id:next,status:503,body:{code:'busy'}});
  f.release();await wait;assert.equal(drained,true);
  await assert.rejects(f.port.resume(),/timeout/); // same owner lease cannot undo account-change hold
  let revoked=0;f.port.subscribeRevocation(()=>{revoked++;});f.auth.host.ownerLease.revoke();assert.equal(revoked,1);
  assert.equal(f.auth.host.ownerLease.publishVerifiedV2(owner,0,1000,f.auth.host.ownerLease.version()),true);
  assert.deepEqual(JSON.parse(JSON.stringify(await f.port.snapshot())),{owner,seq:1});await assert.rejects(f.port.resume(),/timeout/);
  assert.equal(JSON.stringify(f.replies).includes('a'.repeat(64)),false);
 }finally{f.close();}
});
test('untrusted frame and forged or stale replies do not grant a lease',async()=>{
 const f=fixture();try{
  f.setFrame('https://lantern.local.evil/');await assert.rejects(f.port.snapshot(),/timeout/);f.setFrame('https://lantern.local/');
  assert.deepEqual(JSON.parse(JSON.stringify(await f.port.snapshot())),{owner,seq:0});
  f.target.__lanternLifecycleReceive({kind:'revoked',seq:2});
  await assert.rejects(f.port.snapshot(),/unavailable/);
 }finally{f.close();}
});
test('observer cannot register while feature is disabled and disposal invalidates both bridges',()=>{
 let registered=0,invalidated=0,unsubscribed=0;
 const controller={registerJavaScriptProxy(){registered++;},deleteJavaScriptRegister(){},getUrl:()=> 'https://lantern.local/'};
 const provider={snapshot:()=>undefined,subscribe:()=>()=>{unsubscribed++;}},bridge={invalidate(){invalidated++;}};
 const imports={'@kit.ArkWeb':{},'../auth/AuthPolicy':{trustedFrame:()=>true},'../media/VerifiedOwnerLease':{},'./NativeSyncHost':{},'./NativeStudySyncHost':{}};
 const Observer=compile(path.join(syncDir,'NativeLifecycleObserver.ets'),imports).NativeLifecycleObserver,observer=new Observer(controller,provider,()=>true,bridge,bridge);
 assert.equal(observer.attach(),false);assert.equal(registered,0);observer.dispose();observer.dispose();assert.equal(invalidated,2);assert.equal(unsubscribed,1);
});
test('real account controller session recheck cannot clear a held pair of real native bridges',async()=>{
 const user={id:owner,username:'synthetic_a'},caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false};
 const f=fixture(async()=>response(200,{user,capabilities:caps,session:{version:2,remainingMs:1000}}));
 const source="export {NativeAccountController} from './lib/native-account-controller.ts'; export {createNativeSyncLifecycle} from './lib/cloud-sync/native-lifecycle.ts';";
 const built=buildSync({stdin:{contents:source,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',target:'node24',logLevel:'silent'});
 const file=path.join(__dirname,'native-lifecycle-recheck.cjs'),m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(built.outputFiles[0].text,file);
 const transport={cancelAll(){},dispose(){},request(action,body,_timeout,version){return f.auth.invoke({id:randomUUID(),action,body,version});}};
 const clock={now:()=>0,set:()=>1,clear:()=>{}},account=new m.exports.NativeAccountController(transport,clock);
 const adapter=m.exports.createNativeSyncLifecycle(account,{async cancel(){},async activate(){}},f.port,{nativeTimeoutMs:500});
 try{
  account.start();for(let i=0;i<30&&account.getSnapshot().status!=='ready';i++)await tick();
  await adapter.settled();assert.equal(adapter.status().owner,owner);
  await adapter.prepareAccountChange();
  account.recheck();for(let i=0;i<30&&account.getSnapshot().status!=='ready';i++)await tick();
  assert.equal(account.getSnapshot().status,'ready');assert.equal(f.auth.requests.filter(r=>r.path.endsWith('/session')).length,2);
  await adapter.settled();assert.equal(adapter.status().phase,'blocked');
  for(const [host,action] of [[f.target.LanternSyncHost,'snapshot'],[f.target.LanternStudySyncHost,'pull']]){
   const id=randomUUID();host.request(JSON.stringify(action==='snapshot'?{id,action,owner,pageSize:1}:{id,action,owner,checkpoint:null,continuation:null}));
   await tick();assert.deepEqual(JSON.parse(JSON.stringify(f.replies.at(-1))),{id,status:503,body:{code:'busy'}});
  }
  assert.equal(f.calls.length,0);await assert.rejects(f.port.resume(),/timeout/);
 }finally{adapter.dispose();account.dispose();f.close();}
});
test('actual controller, lease port and both native bridges drain before a prepared logout',async()=>{
 const f=fixture(),source="export {NativeAccountController} from './lib/native-account-controller.ts'; export {createNativeSyncLifecycle} from './lib/cloud-sync/native-lifecycle.ts';";
 const built=buildSync({stdin:{contents:source,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',target:'node24',logLevel:'silent'});
 const file=path.join(__dirname,'native-lifecycle-composed.cjs'),m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(built.outputFiles[0].text,file);
 const {NativeAccountController,createNativeSyncLifecycle}=m.exports,user={id:owner,username:'synthetic_a'},calls=[];let current=user;
 const transport={cancelAll(){},dispose(){},async request(action){calls.push(action);if(action==='session')return current?{status:200,version:2,body:{user:current,capabilities:{passwordLogin:true,phoneLogin:false},session:{validForMs:1000}}}:{status:401,body:{code:'unauthenticated'}};if(action==='logout'){f.auth.host.ownerLease.revoke();current=null;return {status:200,body:{}};}throw Error('unexpected');}};
 const clock={now:()=>0,set:()=>1,clear:()=>{}},account=new NativeAccountController(transport,clock),client={async cancel(){},async activate(){}},adapter=createNativeSyncLifecycle(account,client,f.port,{nativeTimeoutMs:500});
 try{
  account.start();for(let i=0;i<10&&account.getSnapshot().status!=='ready';i++)await tick();await adapter.settled();assert.equal(adapter.status().owner,owner);
  f.target.LanternSyncHost.request(JSON.stringify({id:randomUUID(),action:'snapshot',owner,pageSize:1}));await f.entered;
  const before=calls.length;let prepared=false;const preparing=adapter.prepareAccountChange().then(()=>{prepared=true;});preparing.catch(()=>{});await tick();assert.equal(prepared,false);assert.equal(calls.length,before);
  f.release();await preparing;assert.equal(prepared,true);assert.equal(await account.mutate('logout'),true);await adapter.settled();assert.equal(adapter.status().phase,'blocked');
  assert.equal(JSON.stringify(f.replies).includes('a'.repeat(64)),false);
 }finally{adapter.dispose();account.dispose();f.close();}
});
