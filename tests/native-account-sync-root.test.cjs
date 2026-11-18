'use strict';
// Real controller and root binding; only synthetic account and bridge fixtures.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {buildSync}=require('esbuild'),{Module}=require('node:module');
const root=path.resolve(__dirname,'..'),source="export {NativeAccountController} from './lib/native-account-controller.ts';export {attachNativeAccountSync,NATIVE_ACCOUNT_SYNC_ENABLED} from './lib/cloud-sync/native-account-root.ts';";
const built=buildSync({stdin:{contents:source,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',target:'node24',logLevel:'silent'});
const file=path.join(__dirname,'synthetic-native-root-bundle.cjs'),m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);m._compile(built.outputFiles[0].text,file);
const {NativeAccountController,attachNativeAccountSync,NATIVE_ACCOUNT_SYNC_ENABLED}=m.exports;
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},B={id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
const caps={passwordLogin:true,phoneLogin:true,passwordRecovery:false},tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture(){
 let user=A,fail=false,listener=()=>{},drain=()=>Promise.resolve(),disposed=false;const log=[];
 const transport={cancelAll(){},dispose(){},async request(action){log.push('auth:'+action);
  if(action==='session')return user?{status:200,version:2,body:{user,capabilities:caps,session:{validForMs:3600000}}}:{status:401,version:2,body:{code:'unauthenticated'}};
  if(action==='providers')return {status:200,body:{huaweiLogin:true,huaweiBinding:true}};
  if(fail)return {status:503,body:{code:'auth-state-unknown'}};
  if(action==='logout'){user=null;return {status:200,body:{ok:true}};}
  if(['login','huawei-login','phone-login'].includes(action)){user=B;return {status:200,body:{user:B,capabilities:caps}};}
  throw Error('unexpected '+action);
 }};
 const native={snapshot:async()=>user?{owner:user.id,seq:0}:null,subscribeRevocation(fn){listener=fn;return()=>{listener=()=>{};};},drain:()=>drain(),hold:async()=>{log.push('hold');},complete:async()=>{log.push('complete');},resume:async()=>{log.push('resume');},dispose(){disposed=true;log.push('dispose-port');}};
 const client={async activate(id){log.push('activate:'+id);},async cancel(){log.push('cancel');}};
 const clock={now:()=>0,set:()=>1,clear:()=>{}},account=new NativeAccountController(transport,clock);
 return {account,transport,native,client,log,setDrain(fn){drain=fn;},setFailure(value){fail=value;},get disposed(){return disposed;},revoke(){listener();}};
}
async function ready(h){h.account.start();for(let i=0;i<25&&h.account.getSnapshot().status!=='ready';i++)await tick();assert.equal(h.account.getSnapshot().status,'ready');await tick();}
test('actual Root attaches before start and disposes before account; feature is hard-disabled',()=>{
 const rootSource=fs.readFileSync(path.join(root,'mobile/src/NativeAccountRoot.tsx'),'utf8');
 assert.equal(NATIVE_ACCOUNT_SYNC_ENABLED,false);assert(rootSource.indexOf('attachNativeAccountSync(value)')<rootSource.indexOf('value.start()'));assert(rootSource.indexOf('detachSync();value.dispose()')>0);
 const h=fixture();let called=0;const detach=attachNativeAccountSync(h.account,{enabled:false,createClient(){called++;throw Error();},createPort(){called++;throw Error();}});
 h.account.start();detach();h.account.dispose();assert.equal(called,0);assert.equal(h.disposed,false);
});
test('actual Root effect attaches enabled synthetic barrier before startup and detaches on remount',async()=>{
 const rootFile=path.join(root,'mobile/src/NativeAccountRoot.tsx'),compiled=ts.transpileModule(fs.readFileSync(rootFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 let effects=[],holder=null,h=fixture();const exported={};
 const react={useState(value){return [value,()=>{}];},useRef(value){return {current:value};},useEffect(fn){effects.push(fn);}};
 const modules={'react':react,'react/jsx-runtime':{jsx:()=>null,jsxs:()=>null},'react-dom':{flushSync:fn=>fn()},
  '@/app/study-app':{__esModule:true,default:()=>null},'@/app/account/account-panel':{AccountPanel:()=>null},'@/app/learn/guest-data-recovery':{GuestDataRecovery:()=>null},
  '@/lib/native-host':{subscribeNativeState(fn){fn(true);return()=>{};},registerNativeBack(){return()=>{};}},
  '@/lib/native-auth-transport':{createNativeAuthTransport:()=>h.transport,nativePhoneClient:()=>({})},
  '@/lib/native-account-controller':{NativeAccountController,INITIAL_NATIVE_ACCOUNT_STATE:{status:'checking',message:''}},
  '@/lib/ui-theme':{applyDocumentTheme(){}},
  '@/lib/cloud-sync/native-account-root':{attachNativeAccountSync(account){holder=account;return attachNativeAccountSync(account,{enabled:true,createClient:()=>h.client,createPort:()=>h.native});}}};
 const window={addEventListener(){},removeEventListener(){}},document={visibilityState:'visible',documentElement:{dataset:{uiTheme:'paper'}},addEventListener(){},removeEventListener(){}};
 vm.runInNewContext(compiled,{exports:exported,require:name=>{assert(name in modules,name);return modules[name];},window,document,AbortController,console,setTimeout,clearTimeout},{filename:rootFile});
 exported.default();const firstCleanup=effects[0]();for(let i=0;i<20&&holder.getSnapshot().status!=='ready';i++)await tick();
 assert.equal(holder.getSnapshot().user.id,A.id);const d=deferred();h.setDrain(()=>d.promise);const old=h;
 const pending=holder.mutate('login',{username:'synthetic_b',password:'synthetic-password'});await tick();assert.equal(h.log.includes('auth:login'),false);
 firstCleanup();d.resolve();assert.equal(await pending,false);assert.equal(old.disposed,true);
 h=fixture();effects=[];holder=null;exported.default();const secondCleanup=effects[0]();
 for(let i=0;i<20&&holder.getSnapshot().status!=='ready';i++)await tick();assert.equal(holder.getSnapshot().user.id,A.id);
 assert.equal(await holder.mutate('login',{username:'synthetic_b',password:'synthetic-password'}),true);
 secondCleanup();assert.equal(h.disposed,true);old.account.dispose();h.account.dispose();
});
test('enabled without real dependencies blocks mutation before native authentication',async()=>{
 const h=fixture(),detach=attachNativeAccountSync(h.account,{enabled:true});try{
  await ready(h);assert.equal(await h.account.mutate('login',{username:'synthetic_b',password:'synthetic-password'}),false);
  assert.equal(h.log.includes('auth:login'),false);
 }finally{detach();h.account.dispose();}
});
for(const mode of ['password','huawei','phone','logout'])test('controller '+mode+' waits for bound root barrier before mutation',async()=>{
 const h=fixture(),detach=attachNativeAccountSync(h.account,{enabled:true,createClient:()=>h.client,createPort:()=>h.native});
 try{
  await ready(h);if(mode==='huawei')await h.account.getProviders();
  const d=deferred();h.setDrain(()=>d.promise);const start=h.log.length;
  const action=mode==='password'?'login':mode==='huawei'?'huawei-login':mode==='phone'?'phone-login':'logout';
  const work=mode==='password'?h.account.mutate('login',{username:'synthetic_b',password:'synthetic-password'}):mode==='huawei'?h.account.mutateHuawei('login'):mode==='phone'?h.account.mutatePhone('login',{challengeId:'c'.repeat(32),phone:'+8613800138000',code:'731428'}):h.account.mutate('logout');
  await tick();assert.equal(h.log.slice(start).includes('auth:'+action),false);assert(h.log.slice(start).includes('hold'));
  h.setDrain(()=>Promise.resolve());d.resolve();const result=await work;assert(mode==='phone'?result?.status===200:result===true);
  assert(h.log.indexOf('complete',start)>h.log.indexOf('auth:'+action,start));
 }finally{detach();h.account.dispose();assert.equal(h.disposed,true);}
});
test('failed mutation stays frozen across recheck and cleanup supports a fresh controller',async()=>{
 const h=fixture(),detach=attachNativeAccountSync(h.account,{enabled:true,createClient:()=>h.client,createPort:()=>h.native});
 try{
  await ready(h);h.setFailure(true);const before=h.log.length;
  assert.equal(await h.account.mutate('login',{username:'synthetic_b',password:'synthetic-password'}),false);
  h.account.recheck();await tick();assert.equal(h.log.slice(before).includes('complete'),false);assert.equal(h.log.slice(before).includes('resume'),false);
 }finally{detach();detach();h.account.dispose();}
 const next=fixture(),stop=attachNativeAccountSync(next.account,{enabled:true,createClient:()=>next.client,createPort:()=>next.native});
 try{await ready(next);assert.equal(next.account.getSnapshot().user.id,A.id);}finally{stop();next.account.dispose();}
});
