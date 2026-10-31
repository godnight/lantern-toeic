'use strict';
// Deterministic client protocol/barrier tests, not evidence of real authentication.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const ROOT=path.resolve(process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..')),SITE=ROOT,req=createRequire(path.join(SITE,'package.json'));
const ts=req('typescript'),cache=new Map();
const plain=value=>JSON.parse(JSON.stringify(value));
function load(relative){
  const file=path.resolve(ROOT,relative);
  assert(file.startsWith(ROOT+path.sep),'Product module escaped root');
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,strict:true,esModuleInterop:true}});
  vm.runInNewContext(output.outputText,{exports,require(name){assert(name.startsWith('.'),'Only real candidate source imports');
    return load(path.relative(ROOT,path.resolve(path.dirname(file),name+'.ts')));},
    Map,Set,Promise,Error,JSON,Object,Array,Number,String,Boolean,RegExp,AbortController,setTimeout,clearTimeout},{filename:file});
  return exports;
}
const identity=load('lib/product-identity.ts'),transportModule=load('lib/native-auth-transport.ts');
const {NativeAccountController}=load('lib/native-account-controller.ts');
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'};
const B={id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
const caps={passwordLogin:true,phoneLogin:false};
const session=user=>({status:200,body:{user,capabilities:caps,session:{validForMs:3600000}}});
const guest={status:401,body:{code:'unauthenticated'}};
const closed={status:503,body:{code:'native-auth-unavailable',capabilities:{passwordLogin:false,phoneLogin:false}}};
const credentials={username:'synthetic_b',password:'only-synthetic-test-password'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){
  let now=0,next=0;const pending=new Map();
  return {now:()=>now,set(fn,ms){const id=++next;pending.set(id,{fn,at:now+ms});return id;},clear(id){pending.delete(id);},
    advance(ms){now+=ms;for(const [id,item] of [...pending])if(item.at<=now){pending.delete(id);item.fn();}},get size(){return pending.size;}};
}
function bridge(options={}){
  const calls=[],timer=clock(),target={location:{origin:options.origin||'https://lantern.local'},crypto:{randomUUID:()=>crypto.randomUUID()}};
  target.self=target;target.top=options.frame?{}:target;
  if(!options.missing)target.LanternAuthHost={request(raw){const request=JSON.parse(raw);calls.push(request);options.onCall?.(request);}};
  const transport=transportModule.createNativeAuthTransport(target,timer);
  function reply(index,value){const request=calls[index];assert(request,'Expected pending native request');const result=plain(value);if(request.version!==2&&result.body?.session)delete result.body.session;target.__lanternAuthReceive?.({id:request.id,...request.version===2?{version:2}:{},...result});}
  return {target,transport,calls,timer,reply};
}
function controller(options={}){
  const harness=bridge(options),value=new NativeAccountController(harness.transport,harness.timer),states=[];
  value.subscribe((state,synchronous)=>states.push({state:plain(state),synchronous}));
  return {...harness,value,states};
}
async function initial(h,value=session(A)){h.value.start();h.reply(0,value);await tick();return h.value.getSnapshot();}

test('register/login navigation succeeds only after the independent live session proof',async()=>{
 for(const action of ['register','login']){
  const h=controller();
  try{
   await initial(h,guest);let settled=false;
   const pending=h.value.mutate(action,credentials).then(result=>{settled=true;return result;});
   h.reply(1,{status:200,body:{user:A,capabilities:caps}});await tick();
   assert.equal(settled,false,'Mutation JSON alone must not permit navigation');
   assert.equal(h.value.getSnapshot().status,'checking');assert.equal(h.calls[2].version,2);
   h.reply(2,session(B));assert.equal(await pending,true);
   const state=h.value.getSnapshot();assert.equal(state.user.id,B.id);assert.equal(state.access.owner,B.id);assert(state.access.canAccess());
  }finally{h.value.dispose();}
 }
});

test('rejected credentials cannot report navigation success through a valid old account',async()=>{
 const h=controller();
 try{
  const previous=await initial(h);const pending=h.value.mutate('login',credentials);
  h.reply(1,{status:401,body:{code:'invalid-credentials'}});await tick();h.reply(2,session(A));
  assert.equal(await pending,false);assert.equal(h.value.getSnapshot().user.id,A.id);
  assert.equal(previous.access.canAccess(),false);assert(h.value.getSnapshot().access.canAccess());
 }finally{h.value.dispose();}
});

test('missing, invalid, unknown or superseded confirmation cannot report navigation success',async()=>{
 for(const proof of [guest,{status:200,body:{user:B,capabilities:caps}},{status:503,body:{code:'auth-state-unknown'}}]){
  const h=controller();
  try{await initial(h,guest);const pending=h.value.mutate('login',credentials);h.reply(1,{status:200,body:{ok:true}});await tick();h.reply(2,proof);assert.equal(await pending,false);}finally{h.value.dispose();}
 }
 const h=controller();
 try{
  await initial(h,guest);const pending=h.value.mutate('login',credentials);h.reply(1,{status:200,body:{ok:true}});await tick();
  h.value.suspend();assert.equal(await pending,false);h.reply(2,session(B));await tick();assert.equal(h.value.getSnapshot().status,'blocked');
 }finally{h.value.dispose();}
});

test('logout success requires independently confirmed absence of the session',async()=>{
 for(const proof of [guest,session(A)]){
  const h=controller();
  try{await initial(h);const pending=h.value.mutate('logout');h.reply(1,{status:200,body:{ok:true}});await tick();h.reply(2,proof);assert.equal(await pending,proof===guest);}finally{h.value.dispose();}
 }
});

test('v2 old-host silence and missing metadata fail closed without fallback',async()=>{
 const old=controller();old.value.start();assert.equal(old.calls[0].version,2);old.timer.advance(15000);await tick();assert.equal(old.value.getSnapshot().status,'blocked');assert.equal(old.calls.length,1);old.value.dispose();
 const missing=controller();missing.value.start();missing.reply(0,{status:200,body:{user:A,capabilities:caps}});await tick();assert.equal(missing.value.getSnapshot().status,'blocked');missing.value.dispose();
});

test('foreground resume and a simultaneous recheck share the initial pending session proof',async()=>{
  for(const result of [guest,session(A)]){
    const h=controller();
    try{
      h.value.start();h.value.resume();h.value.recheck();h.value.resume();
      assert.equal(h.calls.length,1,'Repeated foreground/click events must not cancel the live native request');
      assert.equal(h.value.getSnapshot().status,'checking');
      h.reply(0,result);await tick();
      assert.equal(h.value.getSnapshot().status,'ready');
      assert.equal(h.value.getSnapshot().user?.id??null,result.body.user?.id??null);
      assert.equal(h.calls.length,1);
    }finally{h.value.dispose();}
  }
});

test('foreground resume and recheck cannot cancel a mutation or its independent session proof',async()=>{
  const h=controller();let pending;
  try{
    const prior=await initial(h),oldAccess=prior.access;
    pending=h.value.mutate('login',credentials);
    h.value.resume();h.value.recheck();h.value.resume();
    assert.equal(h.calls.length,2);assert.equal(h.value.getSnapshot().status,'checking');assert.equal(oldAccess.canAccess(),false);
    h.reply(1,session(B));await tick();
    assert.equal(h.calls.length,3);assert.equal(h.calls[2].action,'session');
    h.value.recheck();h.value.resume();assert.equal(h.calls.length,3);assert.equal(oldAccess.canAccess(),false);
    h.reply(2,session(B));await pending;
    assert.equal(h.value.getSnapshot().user.id,B.id);assert.equal(oldAccess.canAccess(),false);
  }finally{h.value.dispose();await pending;}
});

test('unknown mutation hold survives lifecycle; explicit proof opens B while old A access stays closed',async()=>{
 const h=controller();const state=await initial(h),oldAccess=state.access;const pending=h.value.mutate('login',credentials);h.reply(1,{status:503,body:{code:'auth-state-unknown'}});await pending;
 h.value.suspend();h.value.resume();await tick();assert.equal(h.calls.length,2);assert.equal(h.value.getSnapshot().status,'blocked');assert.equal(oldAccess.assertAccess(),false);
 h.value.recheck();h.reply(2,session(B));await tick();const next=h.value.getSnapshot();assert.equal(next.user.id,B.id);assert(next.access.canAccess());assert.equal(oldAccess.assertAccess(),false);assert.equal(h.value.getSnapshot().user.id,B.id);h.value.dispose();
});

test('public identity is canonical usr_UUIDv4 and contains no editable owner or secret fields',()=>{
  assert.deepEqual(plain(identity.parseProductIdentity(A)),A);
  for(const invalid of [{...A,id:'usr_'+Array(37).join('-')},{...A,id:A.id.toUpperCase()},{...A,id:A.id.replace('-4111-','-0111-')},
    {...A,id:A.id.replace('-8111-','-7111-')},{...A,id:'owner'},{...A,username:'ABC'},{...A,username:'ab'},{...A,token:'secret'},null,[]])
    assert.equal(identity.parseProductIdentity(invalid),null);
});

test('credential rules preserve password whitespace and count Unicode code points',()=>{
  const valid=identity.validateProductCredentials('  User_Name  ',' '.repeat(15));assert.equal(valid.ok,true);
  assert.deepEqual(plain(valid.credentials),{username:'user_name',password:' '.repeat(15)});
  assert.equal(identity.validateProductCredentials('user','😀'.repeat(15)).ok,true);
  for(const args of [['用户_abc','x'.repeat(20)],['user\u00a0','x'.repeat(20)],['ab','x'.repeat(20)],['a'.repeat(33),'x'.repeat(20)],
    ['user','x'.repeat(7)],['user','😀'.repeat(129)],['user','x'.repeat(15),'X'.repeat(15)]])
    assert.equal(identity.validateProductCredentials(...args).ok,false);
});

test('untrusted origin, child frame and missing bridge are explicit closed without network or native request',async()=>{
  for(const options of [{origin:'http://lantern.local'},{origin:'https://elsewhere.test'},{frame:true},{missing:true}]){
    const h=bridge(options);const result=await h.transport.request('session');assert.equal(result.status,503);
    assert.equal(result.body.code,'native-auth-unavailable');assert.equal(result.body.capabilities.passwordLogin,false);
    assert.equal(h.calls.length,0);h.transport.dispose();
  }
});

test('bridge accepts only exact action/body shapes, never owner/url/header/token requests',async()=>{
  const h=bridge();
  for(const [action,body] of [['fetch',undefined],['session',{owner:A.id}],['logout',{}],['login',{...credentials,owner:A.id}],
    ['login',{...credentials,token:'fake'}],['register',{username:'abc'}]]){
    await assert.rejects(h.transport.request(action,body),error=>error.code==='protocol');
  }
  assert.equal(h.calls.length,0);assert.equal(h.timer.size,0);h.transport.dispose();
});

test('request15s deadline settles once; late and wrong-id callbacks cannot complete it',async()=>{
  const h=bridge(),pending=h.transport.request('session');
  let done=false;pending.then(()=>{done=true;},()=>{done=true;});
  h.target.__lanternAuthReceive({id:crypto.randomUUID(),...session(A)});await tick();assert.equal(done,false);
  h.timer.advance(14999);await tick();assert.equal(done,false);
  h.timer.advance(1);await assert.rejects(pending,error=>error.code==='timeout');
  h.reply(0,session(A));await tick();assert.equal(h.timer.size,0);h.transport.dispose();
});

test('all mutation actions share one pending lock, released only after completion/cancellation',async()=>{
  const h=bridge(),first=h.transport.request('login',credentials);
  await assert.rejects(h.transport.request('logout'),error=>error.code==='mutation-busy');assert.equal(h.calls.length,1);
  h.reply(0,session(B));await first;
  const next=h.transport.request('logout');assert.equal(h.calls.length,2);h.reply(1,{status:200,body:{ok:true}});await next;
  assert.equal(h.timer.size,0);h.transport.dispose();
});

test('AbortSignal and dispose cancel complete pending operations and remove the global receiver',async()=>{
  const h=bridge(),abort=new AbortController(),first=h.transport.request('session',undefined,abort.signal);
  abort.abort();await assert.rejects(first,error=>error.code==='superseded');h.reply(0,session(A));
  const second=h.transport.request('session');h.transport.dispose();await assert.rejects(second,error=>error.code==='disposed');
  assert.equal(h.timer.size,0);assert.equal(h.target.__lanternAuthReceive,undefined);
  await assert.rejects(h.transport.request('session'),error=>error.code==='disposed');
});

test('malformed public replies and token-bearing native callbacks fail closed',async()=>{
  for(const body of [{...session(A).body,token:'not-permitted'},{user:{...A,sessionToken:'not-permitted'},capabilities:caps},
    {user:{...A,id:'owner-a'},capabilities:caps},{capabilities:{passwordLogin:'true'}}]){
    const h=bridge(),pending=h.transport.request('session');h.reply(0,{status:200,body});
    await assert.rejects(pending,error=>error.code==='protocol');h.transport.dispose();
  }
});

test('only explicit initial unavailable with passwordLogin false permits device guest',async()=>{
  for(const value of [closed,{status:503,body:{code:'auth-disabled',capabilities:{passwordLogin:false,phoneLogin:false}}}]){
    const h=controller();const state=await initial(h,value);assert.equal(state.status,'ready');assert.equal(state.user,null);
    assert.equal(state.unavailable,true);h.value.dispose();
  }
  for(const value of [{status:503,body:{code:'auth-state-unknown',capabilities:{passwordLogin:false,phoneLogin:false}}},
    {status:503,body:{code:'native-auth-unavailable'}},{status:503,body:{code:'auth-disabled',capabilities:caps}},
    {status:401,body:{code:'invalid-credentials'}},{status:200,body:{user:A,capabilities:{passwordLogin:false,phoneLogin:false}}}]){
    const h=controller();assert.equal((await initial(h,value)).status,'blocked');h.value.dispose();
  }
});

test('mutation begins with synchronous unmount gate before any native call; mutation user never picks owner',async()=>{
  const order=[];let mounted=false,h;
  h=controller({onCall:request=>{if(request.action==='login')assert.equal(mounted,false,'Old workspace still mounted at native mutation');order.push('bridge:'+request.action);}});
  h.value.subscribe((state,synchronous)=>{if(state.status!=='ready'){mounted=false;if(synchronous)order.push('sync-unmount');}else mounted=true;});
  await initial(h);assert.equal(mounted,true);
  const pending=h.value.mutate('login',credentials);assert.equal(h.value.getSnapshot().status,'checking');
  assert(order.indexOf('sync-unmount')<order.indexOf('bridge:login'));
  h.reply(1,session(B));await tick();assert.equal(h.value.getSnapshot().status,'checking');assert.equal(h.calls[2].action,'session');
  h.reply(2,session(A));await pending;assert.deepEqual(plain(h.value.getSnapshot().user),A,'Only independent session selectsA');
  assert(!h.states.some(row=>row.state.status==='ready'&&row.state.user?.id===B.id));h.value.dispose();
});

test('independent session proof can selectB after mutation, with no owner self-report in the request',async()=>{
  const h=controller();await initial(h);const pending=h.value.mutate('register',credentials);h.reply(1,{status:200,body:{ok:true}});
  await tick();h.reply(2,session(B));await pending;assert.deepEqual(plain(h.value.getSnapshot().user),B);
  assert.deepEqual(Object.keys(h.calls[1]).sort(),['action','body','id']);assert.deepEqual(Object.keys(h.calls[1].body).sort(),['password','username']);
  assert(!JSON.stringify(h.value.getSnapshot()).includes(credentials.password));h.value.dispose();
});

test('unknown mutation timeout remains blocked and starts no automatic speculative session probe',async()=>{
  const h=controller();await initial(h);const pending=h.value.mutate('login',credentials);h.timer.advance(15000);await pending;
  assert.equal(h.value.getSnapshot().status,'blocked');assert.equal(h.calls.length,2);
  h.reply(1,session(B));await tick();assert.equal(h.value.getSnapshot().status,'blocked');
  h.value.recheck();assert.equal(h.calls[2].action,'session');h.reply(2,session(A));await tick();assert.equal(h.value.getSnapshot().user.id,A.id);
  h.value.dispose();
});

test('a session probe that never replies expires with no mounted identity and rejects all late responses',async()=>{
  const h=controller();h.value.start();h.timer.advance(15000);await tick();assert.equal(h.value.getSnapshot().status,'blocked');
  h.reply(0,session(A));await tick();assert.equal(h.value.getSnapshot().status,'blocked');assert.equal(h.timer.size,0);h.value.dispose();
});

test('actual suspend invalidates the pending proof; resume revalidates without reviving old owner access',async()=>{
  const h=controller();
  try{
    const prior=await initial(h),oldAccess=prior.access;
    h.value.recheck();assert.equal(h.value.getSnapshot().status,'checking');
    h.value.suspend();assert.equal(h.value.getSnapshot().status,'blocked');assert.equal(oldAccess.canAccess(),false);
    h.value.resume();h.value.resume();h.value.recheck();assert.equal(h.calls.length,3);
    h.reply(1,session(A));await tick();assert.equal(h.value.getSnapshot().status,'checking');assert.equal(oldAccess.canAccess(),false);
    h.reply(2,session(B));await tick();assert.equal(h.value.getSnapshot().user.id,B.id);assert.equal(oldAccess.canAccess(),false);
  }finally{h.value.dispose();}
});

test('suspend during mutation keeps its late success from selecting any partition',async()=>{
  const h=controller();await initial(h);const pending=h.value.mutate('login',credentials);h.value.suspend();
  h.reply(1,session(B));await pending;await tick();assert.equal(h.value.getSnapshot().status,'blocked');assert.equal(h.calls.length,2);
  h.value.recheck();h.reply(2,session(B));await tick();assert.equal(h.value.getSnapshot().user.id,B.id);h.value.dispose();
});

test('closed or unknown503 cannot demote a previously verified account to device guest',async()=>{
  const h=controller();await initial(h);h.value.recheck();h.reply(1,closed);await tick();assert.equal(h.value.getSnapshot().status,'blocked');
  h.value.dispose();
});

test('logout user/mutationbody cannot clear owner; only an independent401 confirms guest',async()=>{
  const h=controller();await initial(h);const pending=h.value.mutate('logout');h.reply(1,{status:200,body:{ok:true}});
  await tick();assert.equal(h.value.getSnapshot().status,'checking');h.reply(2,guest);await pending;
  assert.equal(h.value.getSnapshot().status,'ready');assert.equal(h.value.getSnapshot().user,null);h.value.dispose();
});

test('failed login may return to a positively confirmed guest but explicit closed after a mutation stays blocked',async()=>{
  const h=controller();await initial(h,guest);const pending=h.value.mutate('login',credentials);
  h.reply(1,{status:401,body:{code:'invalid-credentials'}});await tick();h.reply(2,guest);await pending;
  assert.equal(h.value.getSnapshot().status,'ready');assert.equal(h.value.getSnapshot().user,null);assert(h.value.getSnapshot().message);
  const second=h.value.mutate('login',credentials);h.reply(3,{status:200,body:{ok:true}});await tick();h.reply(4,closed);await second;
  assert.equal(h.value.getSnapshot().status,'blocked');h.value.dispose();
});

test('unmount/dispose invalidates controller continuations and leaves no pending timer or callback',async()=>{
  const h=controller();await initial(h);const pending=h.value.mutate('login',credentials),count=h.states.length;
  h.value.dispose();h.reply(1,session(B));await pending;await tick();assert.equal(h.states.length,count);
  assert.equal(h.timer.size,0);assert.equal(h.target.__lanternAuthReceive,undefined);
});

test('production core TypeScript typechecks independently without changing or writing site',()=>{
  const files=['product-identity.ts','native-auth-transport.ts','native-account-controller.ts'].map(name=>path.join(ROOT,'lib',name));
  const program=ts.createProgram(files,{noEmit:true,strict:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
    lib:['lib.es2022.d.ts','lib.dom.d.ts'],skipLibCheck:true,types:[]});
  const errors=ts.getPreEmitDiagnostics(program).filter(row=>row.category===ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>ROOT,getNewLine:()=> '\n'}));
});

test('actual React server render of the real NativeAccountRoot stays behind the initial identity barrier',()=>{
  const React=req('react'),{renderToStaticMarkup}=req('react-dom/server'),modules=new Map();
  function sourceModule(input){
    let file=path.resolve(input);assert(file.startsWith(ROOT+path.sep),'Product SSR module escaped root');if(!path.extname(file))file=['.ts','.tsx','.json'].map(ext=>file+ext).find(candidate=>fs.existsSync(candidate))||file;
    if(modules.has(file))return modules.get(file);
    if(file.endsWith('.json')){const value=JSON.parse(fs.readFileSync(file));modules.set(file,value);return value;}
    if(file.endsWith('.css')){fs.readFileSync(file);const style={};modules.set(file,style);return style;}
    const exports={};modules.set(file,exports);
    const out=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,
      target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    function imports(name){
      if(!name.startsWith('.')&&!name.startsWith('@/'))return req(name);
      let target=name.startsWith('@/')?path.join(ROOT,name.slice(2)):path.resolve(path.dirname(file),name);
      if(!['','.ts','.tsx','.json','.cjs','.js','.mjs','.css'].includes(path.extname(target)))throw Error('Non-code candidate import');
      if(!['.ts','.tsx','.json'].some(ext=>fs.existsSync(target+ext))&&!fs.existsSync(target)){
        const relative=name.startsWith('@/')?name.slice(2):path.relative(ROOT,target);target=path.join(SITE,relative);
      }
      if(['.cjs','.js','.mjs'].includes(path.extname(target)))return req(target);
      return sourceModule(target);
    }
    vm.runInNewContext(out,{exports,require:imports,process,console,Date,Intl,Map,Set,WeakMap,WeakSet,Promise,Error,TypeError,RangeError,
      JSON,Number,Object,Array,Math,RegExp,Symbol,Uint8Array,Uint32Array,ArrayBuffer,DataView,TextEncoder,TextDecoder,structuredClone,
      crypto:crypto.webcrypto,setTimeout,clearTimeout,setInterval,clearInterval,Request,Response,Headers,Blob,URL,AbortController,
      performance,DOMException,ReadableStream},{filename:file});return exports;
  }
  const Root=sourceModule(path.join(ROOT,'mobile/src/NativeAccountRoot.tsx')).default;
  const html=renderToStaticMarkup(React.createElement(Root));assert(html.includes('正在确认账号'));
  assert(!html.includes('workspace-mobile-nav'));assert(!html.includes('当前未登录'));assert(!html.includes('synthetic_a'));
});
