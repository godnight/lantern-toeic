'use strict';
// Actual ETS policy/host logic; only OS HTTP/Asset/ArkWeb ports are simulated.
// No ArkTS compiler, system Asset, device, TLS trust or external network is used.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const ROOT=path.resolve(__dirname,'../..'),DIR='harmony/entry/src/main/ets/auth/';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function hostRuntime({origin='https://auth.test',dispatch,initialToken,frame='https://lantern.local/',clearFailure=false}={}){
 let now=0,token=initialToken,attached=false,active=true,next=0,saves=0,clears=0;
 const timers=new Map(),replies=[],requests=[],pending=new Map(),modules=new Map();
 const store={async load(){return token;},async save(_origin,value){saves++;token=value;},async clear(){clears++;if(clearFailure)throw Error('Synthetic Asset failure');token=undefined;}};
 const http={RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:'STRING'},createHttp:()=>({async request(url,options){requests.push({path:new URL(url).pathname,method:options.method,proof:options.header['X-Lantern-Session-Proof'],hasCookie:!!options.header.Cookie});return dispatch?dispatch(url,options,{advance:ms=>now+=ms}):{responseCode:503,result:'{}',header:{'content-type':'application/json'}};},destroy(){}})};
 const imports={'@ohos.net.http':{__esModule:true,default:http},'@ohos.deviceInfo':{__esModule:true,default:{sdkApiVersion:23}},'@kit.ArkWeb':{},'@kit.BasicServicesKit':{systemDateTime:{TimeType:{STARTUP:1},getUptime:()=>now}},'./AuthSessionStore':{AuthSessionStore:class{load=store.load;save=store.save;clear=store.clear;}},'./AuthConfiguration':{AUTH_API_ORIGIN:origin}};
 function load(name){if(modules.has(name))return modules.get(name);const exports={};modules.set(name,exports);const out=ts.transpileModule(fs.readFileSync(path.join(ROOT,DIR+name+'.ets'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;vm.runInNewContext(out,{exports,require:id=>imports[id]??load(id.replace('./','')),canIUse:()=>true,Date,JSON,Object,Array,Number,Math,String,Error,Promise,Set,Map,setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)},{filename:name+'.ets'});return exports;}
 const controller={registerJavaScriptProxy(){attached=true;},deleteJavaScriptRegister(){attached=false;},getLastJavascriptProxyCallingFrameUrl:()=>frame,getUrl:()=>frame,async runJavaScript(script){vm.runInNewContext(script,{window:{__lanternAuthReceive(reply){replies.push(reply);const finish=pending.get(reply.id);pending.delete(reply.id);finish?.(reply);}}});}};
 const {NativeAuthHost}=load('NativeAuthHost'),host=new NativeAuthHost(controller,()=>active);host.attach();
 return {host,requests,replies,store,send(raw){host.request(typeof raw==='string'?raw:JSON.stringify(raw));},invoke(request){return new Promise(resolve=>{pending.set(request.id,resolve);host.request(JSON.stringify(request));});},advance(ms){now+=ms;},setTime(value){now=value;},expire(){for(const [id,t]of [...timers])if(t.ms===15000){timers.delete(id);t.fn();}},get saves(){return saves;},get clears(){return clears;},async settle(){for(let i=0;i<20;i++)await tick();},dispose(){active=false;host.dispose();timers.clear();pending.clear();},load};
}
const response=(status,body,headers={})=>({responseCode:status,result:JSON.stringify(body),header:{'content-type':'application/json',...headers}});
exports.hostRuntime=hostRuntime;exports.response=response;
