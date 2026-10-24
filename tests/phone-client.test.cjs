'use strict';
// Protocol/controller tests use public no-token bridge replies; not real authentication.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),ROOT=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..'),SITE=ROOT,req=createRequire(path.join(SITE,'package.json'));
const ts=req('typescript'),cache=new Map(),plain=v=>JSON.parse(JSON.stringify(v)),tick=()=>new Promise(r=>setImmediate(r));
function load(relative){const file=path.resolve(ROOT,relative);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 const out=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,strict:true,esModuleInterop:true}}).outputText;
 vm.runInNewContext(out,{exports,require(n){assert(n.startsWith('.'));return load(path.relative(ROOT,path.resolve(path.dirname(file),n+'.ts')));},Map,Set,Promise,Error,JSON,Object,Array,Number,String,Boolean,RegExp,Date,AbortController,setTimeout,clearTimeout},{filename:file});return exports;}
const phone=load('lib/phone-auth-client.ts'),native=load('lib/native-auth-transport.ts'),{NativeAccountController}=load('lib/native-account-controller.ts');
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},B={id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
const caps={passwordLogin:true,phoneLogin:true,passwordRecovery:false,cloudSync:false},session=user=>({status:200,body:{user,capabilities:caps}}),guest={status:401,body:{code:'unauthenticated'}};
const number='+8613800138000',verification=()=>({challengeId:'c'.repeat(32),phone:number,code:'731428'});
const challenge=(purpose='login')=>({challengeId:'c'.repeat(32),phone:number,purpose,expiresAt:new Date(Date.now()+300000).toISOString(),resendAt:new Date(Date.now()+60000).toISOString()});
function bridge(){const calls=[],timers=new Map();let next=0;const target={location:{origin:'https://lantern.local'},crypto:{randomUUID:()=>crypto.randomUUID()},LanternAuthHost:{request(raw){calls.push(JSON.parse(raw));}}};target.top=target.self=target;
 const transport=native.createNativeAuthTransport(target,{set(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},clear(id){timers.delete(id);}});
 const value=new NativeAccountController(transport);return {calls,target,transport,value,timers,reply(i,r){target.__lanternAuthReceive?.({id:calls[i].id,...plain(r)});},expire(){for(const [,v] of [...timers])v.fn();}};}
async function initial(h,proof=session(A)){h.value.start();h.reply(0,proof);await tick();}

test('mainland input normalizes only ASCII11 digit +86 numbers',()=>{
 assert.equal(phone.normalizeMainlandPhone('13800138000'),number);assert.equal(phone.normalizeMainlandPhone(' +8613800138000 '),number);
 for(const text of ['138-0013-8000','+86 13800138000','+86-138-0013-8000'])assert.equal(phone.normalizeMainlandPhone(text),number);
 for(const text of ['10000005560','11000005560','12000005560'])assert.equal(phone.normalizeMainlandPhone(text),'+86'+text);
 const shared=load('lib/phone-number.ts');for(const text of ['138-0013-8000','+86 10000005560','+8612000005560','\u00a013800138000','13800138000\u3000','+1 13800138000']){const p=shared.parseMainlandPhone(text);assert.equal(phone.normalizeMainlandPhone(text),p.ok?p.phone:null);}
 for(const v of ['+1'+number,'１３８００１３８０００','1380013800','8613800138000','\u00a013800138000','13800138000\u3000','\t13800138000'])assert.equal(phone.normalizeMainlandPhone(v),null);
 assert(phone.validPhoneVerification(verification()));for(const change of [{code:'１２３４５６'},{code:'12345'},{owner:A.id},{phone:'13800138000'},{token:'forbidden'}])assert(!phone.validPhoneVerification({...verification(),...change}));
});
test('independent phone capability contract allows password-independent false/false and separate bind/login',()=>{
 for(const pair of [[false,false],[true,false],[false,true]])assert.deepEqual(plain(phone.parsePhoneCapabilities({capabilities:{phoneLogin:pair[0],phoneBinding:pair[1]}})),{phoneLogin:pair[0],phoneBinding:pair[1]});
 for(const v of [{capabilities:{phoneLogin:true}},{capabilities:{phoneLogin:1,phoneBinding:true}},{capabilities:{phoneLogin:true,phoneBinding:true,passwordLogin:true}},{capabilities:{phoneLogin:true,phoneBinding:true},user:A}])assert.equal(phone.parsePhoneCapabilities(v),null);
});
test('202 challenge requires matching purpose/phone, valid unexpired ISO times and exact public fields',()=>{
 const c=challenge();assert(phone.parsePhoneChallenge(c,'login',number));
 for(const bad of [{...c,code:'731428'},{...c,providerHandle:'forbidden'},{...c,purpose:'bind'},{...c,phone:'+8613900139000'},{...c,expiresAt:new Date(Date.now()-1).toISOString()},{...c,resendAt:new Date(Date.now()+600000).toISOString()}])assert.equal(phone.parsePhoneChallenge(bad,'login',number),null);
 assert.throws(()=>phone.parsePhonePublicReply('challenge',{status:200,body:c}));
});
test('public error attempts and retry time are bounded; server strings cannot become arbitrary UI messages',()=>{
 const outcome=phone.parsePhoneOutcome({status:401,body:{code:'invalid-code',error:'731428 is not echoed',attemptsRemaining:4,retryAt:new Date().toISOString()}});
 assert.equal(outcome.attemptsRemaining,4);assert(!phone.phoneOutcomeMessage(outcome).includes('731428'));
 for(const body of [{code:'123456'},{code:'invalid-code',attemptsRemaining:6},{code:'invalid-code',attemptsRemaining:-1},{code:'invalid-code',retryAt:'tomorrow'},{code:'invalid-code',token:'forbidden'},{code:'invalid-code',capabilities:{providerHandle:true}}])assert.throws(()=>phone.parsePhoneOutcome({status:401,body}));
});
test('native phone status is a nonmutation and challenge shares the password mutation lock',async()=>{
 const h=bridge(),status=h.transport.request('phone-status'),send=h.transport.request('phone-challenge',{purpose:'login',phone:number});
 await assert.rejects(h.transport.request('login',{username:'synthetic_a',password:'synthetic-password-only'}),e=>e.code==='mutation-busy');
 h.reply(0,{status:200,body:{capabilities:{phoneLogin:true,phoneBinding:false}}});await status;
 h.reply(1,{status:202,body:challenge()});await send;assert.equal(h.timers.size,0);h.value.dispose();
});
test('fixed native phone request schema rejects owner, endpoint, token and nonASCII code',async()=>{
 const h=bridge();for(const [action,body] of [['phone-status',{}],['phone-challenge',{purpose:'login',phone:number,owner:A.id}],['phone-challenge',{purpose:'recover',phone:number}],['phone-bind',{...verification(),code:'１２３４５６'}],['phone-login',{...verification(),endpoint:'/elsewhere'}]])await assert.rejects(h.transport.request(action,body),e=>e.code==='protocol');
 assert.equal(h.calls.length,0);h.value.dispose();
});
test('native bridge rejects token/code/provider fields in phone callbacks and accepts phoneLogin true success',async()=>{
 for(const extra of [{token:'forbidden'},{providerHandle:'forbidden'},{code:'731428'}]){const h=bridge(),pending=h.transport.request('phone-login',verification());h.reply(0,{status:200,body:{...session(B).body,...extra}});await assert.rejects(pending,e=>e.code==='protocol');h.value.dispose();}
 const h=bridge(),pending=h.transport.request('phone-login',verification());h.reply(0,session(B));assert.equal((await pending).body.capabilities.phoneLogin,true);h.value.dispose();
});
test('phone login synchronously removes old view and only independent sessionA selects owner despite bodyB',async()=>{
 const h=bridge();await initial(h,guest);let mounted=true;h.value.subscribe((s,sync)=>{if(s.status==='checking'){assert(sync||!mounted);mounted=false;}});
 const pending=h.value.mutatePhone('login',verification());assert.equal(mounted,false);assert.equal(h.calls[1].action,'phone-login');
 h.reply(1,session(B));await tick();assert.equal(h.calls[2].action,'session');assert.equal(h.value.getSnapshot().status,'checking');h.reply(2,session(A));const result=await pending;
 assert.equal(result.status,200);assert.equal(h.value.getSnapshot().user.id,A.id);assert(!JSON.stringify(h.value.getSnapshot()).includes('731428'));h.value.dispose();
});
test('phone bind preserves stable usr and blocks a different independently verified account',async()=>{
 const h=bridge();await initial(h);const pending=h.value.mutatePhone('bind',verification());h.reply(1,{status:200,body:{...session(B).body,ok:true,phone:number}});await tick();h.reply(2,session(B));assert.equal(await pending,undefined);assert.equal(h.value.getSnapshot().status,'blocked');h.value.dispose();
});
test('phone bind same stable usr succeeds without changing the username/password contract',async()=>{
 const h=bridge();await initial(h);const pending=h.value.mutatePhone('bind',verification());h.reply(1,{status:200,body:{...session(A).body,ok:true,phone:number}});await tick();h.reply(2,session(A));assert.equal((await pending).status,200);assert.equal(h.value.getSnapshot().user.id,A.id);h.value.dispose();
});
test('phone login success without authenticated session proof remains blocked',async()=>{
 const h=bridge();await initial(h,guest);const pending=h.value.mutatePhone('login',verification());h.reply(1,session(B));await tick();h.reply(2,guest);assert.equal(await pending,undefined);assert.equal(h.value.getSnapshot().status,'blocked');h.value.dispose();
});
test('invalid-code error preserves attempts and original owner only after independent session',async()=>{
 const h=bridge();await initial(h);const pending=h.value.mutatePhone('bind',verification());h.reply(1,{status:401,body:{code:'invalid-code',attemptsRemaining:4}});await tick();assert.equal(h.value.getSnapshot().status,'checking');h.reply(2,session(A));const outcome=await pending;assert.equal(outcome.attemptsRemaining,4);assert.equal(h.value.getSnapshot().user.id,A.id);h.value.dispose();
});
test('unknown phone mutation timeout and late callback do not select owner or probe automatically',async()=>{
 const h=bridge();await initial(h,guest);const pending=h.value.mutatePhone('login',verification());h.expire();await pending;assert.equal(h.value.getSnapshot().status,'blocked');assert.equal(h.calls.length,2);
 h.reply(1,session(B));await tick();assert.equal(h.value.getSnapshot().status,'blocked');h.value.recheck();h.reply(2,session(A));await tick();assert.equal(h.value.getSnapshot().user.id,A.id);h.value.dispose();
});
test('explicit unknown503 phone result remains blocked until manual session recheck',async()=>{
 const h=bridge();await initial(h);const pending=h.value.mutatePhone('bind',verification());h.reply(1,{status:503,body:{code:'auth-state-unknown'}});await pending;
 assert.equal(h.value.getSnapshot().status,'blocked');assert.equal(h.calls.length,2);h.reply(1,{status:200,body:{...session(A).body,ok:true,phone:number}});await tick();assert.equal(h.value.getSnapshot().status,'blocked');
 h.value.recheck();h.reply(2,session(A));await tick();assert.equal(h.value.getSnapshot().user.id,A.id);h.value.dispose();
});
test('page leave/suspend invalidates an in-flight phone verification and ignores old success',async()=>{
 const h=bridge();await initial(h);const pending=h.value.mutatePhone('bind',verification());h.value.suspend();h.reply(1,{status:200,body:{...session(A).body,ok:true,phone:number}});await pending;assert.equal(h.value.getSnapshot().status,'blocked');assert.equal(h.calls.length,2);h.value.dispose();
});
test('Web phone adapter uses fixed paths/methods and credentials without owner fields',async()=>{
 const calls=[],adapter=phone.createWebPhoneTransport(async(url,options)=>{calls.push({url,options});const action=url.split('/').at(-1);return {status:action==='status'?200:action==='challenge'?202:200,json:async()=>action==='status'?{capabilities:{phoneLogin:true,phoneBinding:true}}:action==='challenge'?challenge('bind'):{...session(A).body,ok:true,phone:number}};});
 await adapter.request('status');await adapter.request('challenge',{purpose:'bind',phone:number});await adapter.mutate('bind',verification());
 assert.deepEqual(calls.map(c=>c.url),['/api/auth/phone/status','/api/auth/phone/challenge','/api/auth/phone/bind']);assert.deepEqual(calls.map(c=>c.options.method),['GET','POST','POST']);
 for(const row of calls){assert.equal(row.options.credentials,'same-origin');assert.equal(row.options.cache,'no-store');assert(!Object.hasOwn(row.options,'owner'));}
 assert.deepEqual(Object.keys(JSON.parse(calls[2].options.body)).sort(),['challengeId','code','phone']);
});
test('Web complete body-reader operation cancels promptly and ignores a late successful reader',async()=>{
 let read;const abort=new AbortController(),adapter=phone.createWebPhoneTransport(async()=>({status:202,json:()=>new Promise(resolve=>{read=resolve;})}));
 const pending=adapter.request('challenge',{purpose:'login',phone:number},abort.signal);await tick();abort.abort();await assert.rejects(pending,e=>e.code==='superseded');read(challenge());await tick();
});
test('missing native bridge is explicit phone capability closed and produces no request',async()=>{
 const target={location:{origin:'http://127.0.0.1'},crypto:{randomUUID:()=>crypto.randomUUID()}},transport=native.createNativeAuthTransport(target);
 const reply=await native.nativePhoneClient(transport).request('status');assert.equal(reply.status,503);assert.deepEqual(plain(reply.body.capabilities),{phoneLogin:false,phoneBinding:false});transport.dispose();
});
test('actual React PhoneFlow initially probes capability and never renders a fake sending or login success',()=>{
 const React=req('react'),{renderToStaticMarkup}=req('react-dom/server'),exports={},file=path.join(ROOT,'app/account/phone-flow.tsx');
 const out=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInNewContext(out,{exports,require:n=>n==='@/lib/phone-auth-client'?phone:req(n),Date,setTimeout,clearTimeout,setInterval,clearInterval,AbortController});
 for(const purpose of ['bind','login']){const html=renderToStaticMarkup(React.createElement(exports.default,{purpose,transport:{request(){throw Error('Effects must not pretend to run during SSR');}},onMutation:async()=>{}}));
  assert(html.includes('正在核对手机号服务能力'));assert(!html.includes('<form'));assert(!html.includes('发送请求已获确认'));assert(!html.includes('已由服务器验证'));}
});
test('all new client and real React source typechecks with candidate-first aliases and no source writes',()=>{
 const roots=['app/account/account-form.tsx','app/account/phone-flow.tsx','mobile/src/NativeAccountRoot.tsx'].map(p=>path.join(ROOT,p));
 const program=ts.createProgram(roots,{noEmit:true,strict:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,resolveJsonModule:true,allowJs:true,skipLibCheck:true,types:['node'],typeRoots:[path.join(SITE,'node_modules/@types')],baseUrl:ROOT,paths:{'@/*':[path.join(ROOT,'*'),path.join(SITE,'*')]},lib:['lib.es2022.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts']});
 const errors=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error);assert.equal(errors.length,0,ts.formatDiagnostics(errors,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>ROOT,getNewLine:()=> '\n'}));
});
test('real native-host Back contract stays unchanged; Root owns popstate and priority account handler',()=>{
 const source=fs.readFileSync(path.join(SITE,'lib/native-host.ts'),'utf8'),exports={},listeners={},target={location:{origin:'https://lantern.local'}};
 const out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(out,{exports,window:target,document:{visibilityState:'visible',addEventListener:(k,f)=>listeners[k]=f},Set,Map,console,setTimeout,clearTimeout});exports.installHarmonyHost();assert.equal(target.__LANTERN_HARMONY__.onBackPress(),true);
 let called=0;const unsubscribe=exports.registerNativeBack(()=>{called++;return true;},100);assert.equal(target.__LANTERN_HARMONY__.onBackPress(),true);assert.equal(called,1);unsubscribe();
 const root=fs.readFileSync(path.join(ROOT,'mobile/src/NativeAccountRoot.tsx'),'utf8');assert(root.includes("window.addEventListener('popstate',pop)"));assert(root.includes('registerNativeBack(()=>{closeRef.current();return true;},100)'));assert(root.includes("if(state.status!=='ready')return"));
});
