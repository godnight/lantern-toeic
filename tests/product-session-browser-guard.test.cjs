// Browser lifecycle simulation of the shipped hook and StudyApp conditional
// tree. No real browser, storage, users, cookies, media or network are used.
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'};
const B={id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
const reply=(status,user)=>({status,body:{user,capabilities:{passwordLogin:true}}});
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function events(){const listeners=new Map();return {
 addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
 removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
 dispatch(type,event={}){for(const fn of [...listeners.get(type)||[]])fn(event);},
 count(){return [...listeners.values()].reduce((count,items)=>count+items.size,0);}
};}

function browserHarness(responses=[],{owner=A.id,nativeMode=false,broadcast=true,account=false,realAccountGuard=false,bus,sourceOverrides={},transport}={}){
 let slots=[],cursor=0,effects=[],tree,component,guard,mounted=false,unmounts=0,flushes=0;
 const calls=[],navigation=[],posted=[],writes=[],order=[],timers=new Map(),channels=bus||new Set(),ownedChannels=new Set();let timerId=0;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useMemo(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const previous=slots[i];slots[i]={deps};effects.push(()=>{previous?.cleanup?.();slots[i].cleanup=fn();});}}
 };
 const window={...events(),location:{origin:nativeMode?'https://lantern.local':'https://guard.example.test',assign(url){order.push('navigate');navigation.push(url);}},localStorage:{setItem(key,value){order.push('storage');writes.push({key,value});},removeItem(key){writes.push({key,removed:true});}}};
 const document={...events(),visibilityState:'visible'};
 if(broadcast)window.BroadcastChannel=class {
  constructor(name){this.name=name;this.onmessage=null;channels.add(this);ownedChannels.add(this);}
  postMessage(data){order.push('broadcast');posted.push(structuredClone(data));for(const channel of channels)if(channel!==this&&channel.name===this.name)channel.onmessage?.({data});}
  close(){channels.delete(this);ownedChannels.delete(this);}
 };
 const globals={window,document,AbortController,setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},fetch:async(url,options={})=>{
  const next=transport?transport(url,options):responses.shift();calls.push({url,options});assert.ok(next,'Unexpected fetch: '+url);if(next instanceof Error)throw next;
  const response=next.promise?await next.promise:next;if(response instanceof Error)throw response;
  if(response instanceof Response)return response;
  return {status:response.status,json:async()=>{if(response.jsonPromise)return await response.jsonPromise;if(response.jsonError)throw response.jsonError;return response.body;},ok:response.status>=200&&response.status<300};
 }};
 function load(file,imports){const exports={};vm.runInNewContext(ts.transpileModule(sourceOverrides[file]??fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>{assert.ok(name in imports,'Unexpected import: '+name);return imports[name];},...globals},{filename:file});return exports;}
 const helper=load('lib/use-product-session.ts',{react,'react-dom':{flushSync(fn){flushes++;fn();render();}}});
 const jsx=(type,props,key)=>({type,props,key});
 if(account){
  const identity=load('lib/product-identity.ts',{});
  const number=load('lib/phone-number.ts',{});
  const phone=load('lib/phone-auth-client.ts',{'./product-identity':identity,'./phone-number':number});
  // This harness inspects the parent account/session barrier. Child PhoneFlow
  // stays opaque, as StudyWorkspace does below; actual phone UI has separate
  // interactive browser-to-D1 coverage rather than fake React hook execution.
  component=load('app/account/account-form.tsx',{react,'react/jsx-runtime':{jsx,jsxs:jsx},'./phone-flow':{default:function PhoneFlow(){}},'@/lib/phone-auth-client':phone,'@/lib/use-product-session':{useProductSession(...args){guard=realAccountGuard?helper.useProductSession(...args):{status:'ready',recheck(){}};return guard;},broadcastProductSessionChange:helper.broadcastProductSessionChange}}).default;
 }else{
  const imports={react,'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/use-product-session':{useProductSession(...args){guard=helper.useProductSession(...args);return guard;}}};
  // StudyWorkspace itself remains opaque: assertions inspect whether React
  // receives that keyed component at all, without substituting guest data.
  const code=fs.readFileSync(path.join(root,'app/study-app.tsx'),'utf8');
  for(const match of code.matchAll(/from ['"]([^'"]+)['"]/g))if(!(match[1] in imports))imports[match[1]]=new Proxy({default:[]},{get(target,key){return key in target?target[key]:()=>null;}});
  const app=load('app/study-app.tsx',imports);component=props=>app.default(props);component.workspace=app.StudyWorkspace;
 }
 function nodes(value,result=[]){if(!value||typeof value!=='object')return result;if(Array.isArray(value)){value.forEach(child=>nodes(child,result));return result;}result.push(value);nodes(value.props?.children,result);return result;}
 function text(value){if(value==null||typeof value==='boolean')return '';if(Array.isArray(value))return value.map(text).join('');return typeof value==='object'?text(value.props?.children):String(value);}
 function render(){cursor=0;tree=component({owner,nativeMode});const nextMounted=nodes(tree).some(node=>node.type===component.workspace);if(mounted&&!nextMounted)unmounts++;mounted=nextMounted;const pending=effects;effects=[];pending.forEach(fn=>fn());return tree;}
 render();
 return {calls,navigation,posted,writes,order,window,document,helper,responses,
  get timerCount(){return timers.size;},get status(){return guard?.status;},get mounted(){return mounted;},get unmounts(){return unmounts;},get flushes(){return flushes;},get workspace(){return nodes(tree).find(node=>node.type===component.workspace);},
  text:()=>text(tree),render,
  async settle(){await tick();render();await tick();render();},
  signal(){const channel=new window.BroadcastChannel('lantern-product-session-v1');channel.postMessage({type:'session-changed',version:1});channel.close();},
  storage(value={type:'session-changed',version:1,nonce:'synthetic-notice'}){window.dispatch('storage',{key:'lantern-product-session-notice-v1',newValue:JSON.stringify(value)});},
  visibility(value){document.visibilityState=value;document.dispatch('visibilitychange');},
  expire(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());render();},
  retry(){guard.recheck();},
  node(type,label){const found=nodes(tree).find(node=>node.type===type&&(label===undefined||text(node)===label||node.props.id===label));assert.ok(found,'Missing '+type+': '+label);return found;},
  input(id,value){this.node('input',id).props.onChange({target:{value}});render();},
  async click(label){this.node('button',label).props.onClick();await this.settle();},
  async submit(){this.node('form').props.onSubmit({preventDefault(){}});await this.settle();},
  dispose(){slots.forEach(slot=>slot?.cleanup?.());assert.equal(timers.size,0);assert.equal(ownedChannels.size,0);}
 };
}

const FROZEN_ACCOUNT_SHA='f3bd825677ef8381c9629ea1346fba2d3808f8fe642ee22e790224707b619b38';
function frozenAccount(){
 const bytes=fs.readFileSync(path.join(root,'tests/fixtures/account-form-c9146e4.tsx.txt'));
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),FROZEN_ACCOUNT_SHA);
 assert.equal(bytes.length,12898);assert.equal(bytes.includes(13),false,'Fixture is the exact LF git-show byte sequence');assert.equal(bytes.at(-1),10);
 return {'app/account/account-form.tsx':bytes.toString('utf8')};
}
function stalledBody(){
 let controller,closed=false;
 const response=new Response(new ReadableStream({start(value){controller=value;controller.enqueue(new TextEncoder().encode('{"user":'));}}),{status:200,headers:{'content-type':'application/json'}});
 return {response,get closed(){return closed;},finish(user=B){if(closed)return;closed=true;controller.enqueue(new TextEncoder().encode(JSON.stringify(user)+'}'));controller.close();},break(){if(closed)return;closed=true;controller.enqueue(new TextEncoder().encode('invalid JSON}'));controller.close();}};
}
async function mutationScenario(mode,mutation,{sourceOverrides={}}={}){
 const bus=new Set(),selfProbe=deferred(),otherProbe=deferred();let started=false,currentSelf=selfProbe,currentMutation=mutation;
 const other=browserHarness([],{bus,transport:()=>started?otherProbe:reply(200,A)});await other.settle();
 const account=browserHarness([],{account:true,realAccountGuard:true,bus,sourceOverrides,transport(url){
  if(url==='/api/auth/session')return started?currentSelf:reply(200,A);
  assert.equal(url,'/api/auth/'+mode);started=true;return currentMutation;
 }});await account.settle();assert.equal(other.mounted,true);assert.equal(account.status,'ready');
 await account.click('切换账号');await account.click('继续选择账号');if(mode==='register')await account.click('注册新账号');
 account.input('account-username',B.username);account.input('account-password','synthetic password 123');if(mode==='register')account.input('account-password-confirmation','synthetic password 123');
 await account.submit();
 return {account,other,selfProbe,otherProbe,setSelf(value){currentSelf=value;},setMutation(value){currentMutation=value;},dispose(){account.dispose();other.dispose();}};
}

for(const mode of ['login','register'])test(`AUTH-REV-BARRIER negative control ${mode}: frozen 200 headers and a real stalled JSON stream leave visible A mounted`,async t=>{
 const body=stalledBody(),s=await mutationScenario(mode,body.response,{sourceOverrides:frozenAccount()});
 t.after(()=>{body.finish();s.dispose();});
 assert.equal(body.response.bodyUsed,true);assert.equal(body.closed,false);assert.equal(s.account.status,'ready');assert.equal(s.other.mounted,true);
 assert.equal(s.account.posted.length,0);assert.equal(s.account.timerCount,0);assert.deepEqual(s.account.navigation,[]);
 s.account.expire();s.other.expire();await s.account.settle();await s.other.settle();assert.equal(s.other.mounted,true);
 t.diagnostic(JSON.stringify({result:'VULNERABILITY_REPRODUCED',mode,sourceSha256:FROZEN_ACCOUNT_SHA,bodyUsed:true,bodyStillOpen:!body.closed,visibleAWorkspaceMounted:s.other.mounted,notices:s.account.posted.length}));
 body.finish(B);await s.account.settle();await s.other.settle();assert.equal(s.account.posted.length,1);assert.equal(s.other.mounted,false);assert.deepEqual(s.account.navigation,['/']);
});

for(const mode of ['login','register'])test(`AUTH-REV-BARRIER fixed ${mode}: 200 headers suspend both pages before a real JSON stream settles`,async t=>{
 const body=stalledBody(),s=await mutationScenario(mode,body.response);t.after(()=>{body.finish();s.dispose();});
 assert.equal(body.closed,false);assert.equal(s.account.status,'checking');assert.equal(s.other.status,'checking');assert.equal(s.other.mounted,false);
 assert.doesNotMatch(s.account.text(),/synthetic_a/);assert.equal(s.account.posted.length,1);assert.deepEqual(s.account.navigation,[]);
 assert.ok(s.account.calls.some(call=>call.url==='/api/auth/session'&&call.options.signal&&!call.options.signal.aborted),'An independent live session probe starts while the mutation body remains open');
 s.selfProbe.resolve(reply(200,B));s.otherProbe.resolve(reply(200,B));await s.account.settle();await s.other.settle();
 assert.equal(body.closed,false);assert.deepEqual(s.account.navigation,['/']);assert.deepEqual(s.other.navigation,['/']);assert.equal(s.other.mounted,false);
 body.finish(A);await s.account.settle();await s.other.settle();assert.deepEqual(s.account.navigation,['/']);assert.equal(s.account.posted.length,1);assert.equal(s.other.mounted,false);
});

test('stale SSR product owner stays unmounted until a same-ID server response',async()=>{
 const pending=deferred(),h=browserHarness([pending]);
 assert.equal(h.status,'checking');assert.equal(h.mounted,false);assert.equal(h.calls.length,1);assert.doesNotMatch(h.text(),/synthetic_a/);
 pending.resolve(reply(200,A));await h.settle();assert.equal(h.status,'ready');assert.equal(h.mounted,true);assert.equal(h.workspace.key,JSON.stringify([false,A.id]));
 assert.equal(h.calls[0].options.credentials,'same-origin');assert.equal(h.calls[0].options.cache,'no-store');h.dispose();
});

test('mutation JSON cannot select B while independent session evidence is unavailable',async t=>{
 const s=await mutationScenario('login',reply(200,B));t.after(()=>s.dispose());
 assert.equal(s.account.status,'checking');assert.equal(s.other.mounted,false);assert.deepEqual(s.account.navigation,[]);
 s.selfProbe.resolve(reply(503));s.otherProbe.resolve(reply(503));await s.account.settle();await s.other.settle();
 assert.equal(s.account.status,'error');assert.equal(s.other.status,'error');assert.equal(s.other.mounted,false);assert.deepEqual(s.account.navigation,[]);assert.equal(s.account.posted.length,1);
});

test('server-confirmed 401 can navigate before a late malformed mutation body without a second notification',async t=>{
 const body=stalledBody(),s=await mutationScenario('register',body.response);t.after(()=>{body.finish();s.dispose();});
 s.selfProbe.resolve(reply(401));s.otherProbe.resolve(reply(401));await s.account.settle();await s.other.settle();
 assert.equal(body.closed,false);assert.deepEqual(s.account.navigation,['/']);assert.deepEqual(s.other.navigation,['/']);
 body.break();await s.account.settle();await s.other.settle();assert.deepEqual(s.account.navigation,['/']);assert.equal(s.account.posted.length,1);assert.equal(s.other.mounted,false);
});

test('an independent session body hang times out and late A cannot revive either covered page',async t=>{
 const sessionBody=stalledBody(),s=await mutationScenario('login',reply(200,B));t.after(()=>{sessionBody.finish();s.dispose();});
 s.selfProbe.resolve(sessionBody.response);await s.account.settle();assert.equal(sessionBody.closed,false);assert.equal(s.account.status,'checking');
 s.account.expire();s.other.expire();await s.account.settle();await s.other.settle();
 assert.equal(s.account.status,'error');assert.equal(s.other.status,'error');assert.equal(s.other.mounted,false);assert.deepEqual(s.account.navigation,[]);
 sessionBody.finish(A);s.otherProbe.resolve(reply(200,A));await s.account.settle();await s.other.settle();
 assert.equal(s.account.status,'error');assert.equal(s.other.mounted,false);assert.deepEqual(s.account.navigation,[]);assert.equal(s.account.posted.length,1);
});

for(const stage of ['fetch','body'])test(`whole mutation ${stage} deadline aborts an uncooperative promise and independently checks the session`,async t=>{
 const head=deferred(),body=stalledBody(),s=await mutationScenario('login',stage==='fetch'?head:body.response);t.after(()=>{body.finish();s.dispose();});
 const mutation=s.account.calls.find(call=>call.url==='/api/auth/login');
 if(stage==='fetch'){assert.equal(s.account.posted.length,0);assert.equal(s.other.mounted,true);}else{assert.equal(s.account.posted.length,1);assert.equal(s.other.mounted,false);}
 const fresh=stage==='body'?deferred():null;if(fresh)s.setSelf(fresh);
 s.account.expire();await s.account.settle();await s.other.settle();
 assert.equal(mutation.options.signal.aborted,true);assert.equal(s.other.mounted,false);assert.deepEqual(s.account.navigation,[]);
 assert.equal(s.account.posted.length,1,'A deadline must not send a second notice after the 200-header notice');
 s.selfProbe.resolve(reply(200,A));s.otherProbe.resolve(reply(200,A));await s.account.settle();await s.other.settle();
 if(stage==='body'){
  assert.equal(s.account.status,'checking','The old pre-deadline probe is stale and cannot answer the fresh post-deadline probe');
  fresh.resolve(reply(200,A));await s.account.settle();
 }
 // Independent same-A evidence can restore the old partition; the hung
 // transport must no longer own busy and prevent a subsequent operation.
 assert.equal(s.account.status,'ready');assert.equal(s.account.node('input','account-password').props.disabled,false);
 const notices=s.account.posted.length,calls=s.account.calls.length;
 if(stage==='fetch')head.resolve(reply(200,B));else body.finish(B);
 await s.account.settle();await s.other.settle();assert.equal(s.account.posted.length,notices);assert.equal(s.account.calls.length,calls);assert.deepEqual(s.account.navigation,[]);
});

test('a mutation body deadline rechecks locally after an earlier same-A probe, and late body cannot release the new barrier',async t=>{
 const body=stalledBody(),s=await mutationScenario('login',body.response);t.after(()=>{body.finish();s.dispose();});
 s.selfProbe.resolve(reply(200,A));s.otherProbe.resolve(reply(200,A));await s.account.settle();await s.other.settle();
 assert.equal(body.closed,false);assert.equal(s.account.status,'ready');assert.equal(s.other.mounted,true);assert.equal(s.account.posted.length,1);
 const beforeProbes=s.account.calls.filter(call=>call.url==='/api/auth/session').length,fresh=deferred();s.setSelf(fresh);
 s.account.expire();await s.account.settle();
 assert.equal(s.account.status,'checking');assert.doesNotMatch(s.account.text(),/synthetic_a/);
 assert.equal(s.account.calls.filter(call=>call.url==='/api/auth/session').length,beforeProbes+1,'The post-deadline probe is distinct from the earlier same-A proof');
 assert.equal(s.account.posted.length,1,'The whole-operation deadline does not repeat the cross-tab notice');
 fresh.resolve(reply(503));await s.account.settle();assert.equal(s.account.status,'error');assert.deepEqual(s.account.navigation,[]);
 body.finish(B);await s.account.settle();assert.equal(s.account.status,'error');assert.equal(s.account.posted.length,1);assert.deepEqual(s.account.navigation,[]);
});

test('unmount aborts pending mutation and session work, and late body/probe results have no navigation or notification effects',async()=>{
 const body=stalledBody(),s=await mutationScenario('login',body.response),mutation=s.account.calls.find(call=>call.url==='/api/auth/login');
 const notices=s.account.posted.length,calls=s.account.calls.length;
 s.dispose();assert.equal(mutation.options.signal.aborted,true);assert.equal(s.account.timerCount,0);assert.equal(s.other.timerCount,0);
 body.finish(B);s.selfProbe.resolve(reply(200,B));s.otherProbe.resolve(reply(200,B));await s.account.settle();await s.other.settle();
 assert.equal(s.account.posted.length,notices);assert.equal(s.account.calls.length,calls);assert.deepEqual(s.account.navigation,[]);assert.deepEqual(s.other.navigation,[]);
});

test('a timed-out old mutation cannot affect a retried operation or its newer independent probe',async t=>{
 const oldHead=deferred(),s=await mutationScenario('login',oldHead);t.after(()=>s.dispose());
 s.account.expire();await s.account.settle();s.selfProbe.resolve(reply(200,A));s.otherProbe.resolve(reply(200,A));await s.account.settle();await s.other.settle();
 assert.equal(s.account.status,'ready');const nextProbe=deferred(),nextHead=deferred();s.setSelf(nextProbe);s.setMutation(nextHead);
 s.account.input('account-password','synthetic password 123');await s.account.submit();assert.equal(s.account.calls.filter(call=>call.url==='/api/auth/login').length,2);
 const notices=s.account.posted.length;
 oldHead.resolve(reply(200,B));await s.account.settle();assert.equal(s.account.posted.length,notices);assert.deepEqual(s.account.navigation,[]);
 nextHead.resolve(reply(200,A));await s.account.settle();assert.equal(s.account.status,'checking');assert.equal(s.account.posted.length,notices+1);
 nextProbe.resolve(reply(200,B));await s.account.settle();assert.deepEqual(s.account.navigation,['/']);
});

test('cross-tab notice synchronously unmounts the original owner and ID change only navigates',async()=>{
 const pending=deferred(),h=browserHarness([reply(200,A),pending]);await h.settle();assert.equal(h.mounted,true);
 h.signal();assert.equal(h.status,'checking');assert.equal(h.mounted,false);assert.equal(h.unmounts,1);assert.ok(h.flushes>0);assert.deepEqual(h.navigation,[]);
 pending.resolve(reply(200,B));await h.settle();assert.equal(h.status,'redirecting');assert.equal(h.mounted,false);assert.deepEqual(h.navigation,['/']);assert.deepEqual(h.writes,[]);h.dispose();
});

test('pagehide removes the old component before BFCache and persisted pageshow revalidates 401',async()=>{
 const pending=deferred(),h=browserHarness([reply(200,A),pending]);await h.settle();
 h.window.dispatch('pagehide');assert.equal(h.mounted,false);assert.equal(h.status,'checking');assert.equal(h.calls.length,1);
 h.window.dispatch('pageshow',{persisted:true});assert.equal(h.calls.length,2);assert.equal(h.mounted,false);
 pending.resolve(reply(401));await h.settle();assert.deepEqual(h.navigation,['/']);assert.equal(h.status,'redirecting');assert.equal(h.mounted,false);h.dispose();
});

test('initial guest remains usable, while resumed unknown 503 stays covered until confirmed 401',async()=>{
 const pending=deferred(),h=browserHarness([pending,reply(401)],{owner:null});await h.settle();assert.equal(h.calls.length,0);assert.equal(h.mounted,true);
 h.window.dispatch('pagehide');h.window.dispatch('pageshow',{persisted:true});assert.equal(h.mounted,false);
 pending.resolve(reply(503));await h.settle();assert.equal(h.status,'error');assert.equal(h.mounted,false);assert.deepEqual(h.navigation,[]);assert.match(h.text(),/学习视图保持暂停，已保存内容仍在原分区/);
 h.retry();await h.settle();assert.equal(h.status,'ready');assert.equal(h.workspace.key,JSON.stringify([false,null]));assert.deepEqual(h.writes,[]);h.dispose();
});

test('explicit disabled capability preserves only the existing guest, never a prior product owner',async()=>{
 const disabled={status:503,body:{code:'auth-disabled',capabilities:{passwordLogin:false}}};
 const guest=browserHarness([disabled],{owner:null});await guest.settle();guest.visibility('hidden');assert.equal(guest.mounted,false);guest.visibility('visible');await guest.settle();assert.equal(guest.status,'ready');assert.equal(guest.workspace.props.owner,null);assert.deepEqual(guest.navigation,[]);assert.deepEqual(guest.writes,[]);guest.dispose();
 const account=browserHarness([reply(200,A),disabled]);await account.settle();account.window.dispatch('focus');assert.equal(account.mounted,false);await account.settle();assert.equal(account.status,'error');assert.equal(account.mounted,false);assert.deepEqual(account.navigation,[]);account.dispose();
});

test('visibility and focus suspend views, ignore aborted late probes and retain unknown errors',async()=>{
 const late=deferred(),h=browserHarness([reply(200,A),late,reply(200,A),new Error('synthetic offline'),reply(200,A)]);await h.settle();
 h.visibility('hidden');assert.equal(h.mounted,false);assert.equal(h.calls.length,1);
 h.visibility('visible');assert.equal(h.calls.length,2);h.visibility('hidden');assert.equal(h.calls[1].options.signal.aborted,true);
 late.resolve(reply(200,A));await h.settle();assert.equal(h.mounted,false);assert.equal(h.status,'checking');
 h.visibility('visible');await h.settle();assert.equal(h.mounted,true);
 h.window.dispatch('focus');assert.equal(h.mounted,false);await h.settle();assert.equal(h.status,'error');assert.deepEqual(h.navigation,[]);
 h.retry();await h.settle();assert.equal(h.mounted,true);assert.equal(h.workspace.props.owner,A.id);h.dispose();
});

test('storage fallback only invalidates identity and malformed 200/timeouts never become guests',async()=>{
 const never=deferred(),h=browserHarness([reply(200,A),{status:200,body:{user:{id:'client-fabricated-owner'}}},never],{broadcast:false});await h.settle();
 h.storage({type:'unrelated',version:1});assert.equal(h.calls.length,1);
 h.storage();assert.equal(h.mounted,false);await h.settle();assert.equal(h.status,'error');assert.deepEqual(h.navigation,[]);
 h.retry();assert.equal(h.calls.length,3);h.expire();assert.equal(h.status,'error');assert.equal(h.calls[2].options.signal.aborted,true);
 never.resolve(reply(200,A));await h.settle();assert.equal(h.mounted,false);assert.deepEqual(h.writes,[]);h.dispose();
});

test('native does not subscribe, fetch or broadcast product sessions',async()=>{
 const h=browserHarness([],{nativeMode:true});await h.settle();h.window.dispatch('focus');h.window.dispatch('pageshow',{persisted:true});h.visibility('hidden');h.visibility('visible');h.helper.broadcastProductSessionChange();
 assert.equal(h.status,'ready');assert.equal(h.mounted,true);assert.equal(h.calls.length,0);assert.equal(h.window.count(),0);assert.equal(h.document.count(),0);assert.deepEqual(h.writes,[]);assert.deepEqual(h.posted,[]);h.dispose();
});

test('successful auth sends only invalidation before navigation',async()=>{
 let submitted=false;
 const h=browserHarness([],{owner:null,account:true,realAccountGuard:true,transport(url){if(url==='/api/auth/session')return submitted?reply(200,B):reply(401);submitted=true;return reply(200,B);}});await h.settle();
 h.input('account-username',B.username);h.input('account-password','synthetic password 123');await h.submit();assert.deepEqual(h.posted,[{type:'session-changed',version:1}]);assert.deepEqual(h.navigation,['/']);assert.ok(h.order.indexOf('broadcast')<h.order.indexOf('navigate'));
 const value=JSON.parse(h.writes[0].value);assert.deepEqual(Object.keys(value).sort(),['nonce','type','version']);assert.equal(h.writes[1].removed,true);assert.doesNotMatch(h.writes[0].value,/synthetic|usr_|password|token/i);h.dispose();
});

for(const mode of ['login','register'])for(const failure of ['body-after-200','fetch-uncertain'])test(`${mode} ${failure} invalidates self and other tabs without assuming the mutation failed`,async()=>{
 const bus=new Set(),otherProbe=deferred(),firstSelfProbe=deferred(),selfProbe=deferred();
 const other=browserHarness([reply(200,A),otherProbe],{bus});await other.settle();assert.equal(other.mounted,true);
 // A 200 response can already have changed the cookie even if JSON is cut off;
 // a rejected fetch can likewise follow a mutation committed by the server.
 const uncertain=failure==='body-after-200'?{status:200,jsonError:new Error('synthetic truncated body after Set-Cookie')}:new Error('synthetic connection lost after possible commit');
 const account=browserHarness([reply(200,A),reply(200,A),uncertain,firstSelfProbe,selfProbe],{account:true,realAccountGuard:true,bus});await account.settle();assert.equal(account.status,'ready');assert.match(account.text(),/synthetic_a/);
 await account.click('切换账号');await account.click('继续选择账号');if(mode==='register')await account.click('注册新账号');
 account.input('account-username',B.username);account.input('account-password','synthetic password 123');if(mode==='register')account.input('account-password-confirmation','synthetic password 123');await account.submit();
 assert.deepEqual(account.posted,[{type:'session-changed',version:1}]);assert.equal(account.status,'checking');assert.equal(other.status,'checking');assert.equal(other.mounted,false);assert.doesNotMatch(account.text(),/synthetic_a/);assert.match(account.text(),/请求结果未能确认/);assert.deepEqual(account.navigation,[]);assert.deepEqual(other.navigation,[]);
 assert.equal(account.calls[3].options.signal.aborted,true,'explicit self recheck supersedes the same-document broadcast probe');
 selfProbe.resolve(reply(503));otherProbe.resolve(reply(503));await account.settle();await other.settle();assert.equal(account.status,'error');assert.equal(other.status,'error');assert.equal(other.mounted,false);assert.match(account.text(),/请求结果未能确认/);assert.deepEqual(account.navigation,[]);
 firstSelfProbe.resolve(reply(200,A));await account.settle();assert.equal(account.status,'error','late pre-invalidation identity cannot restore old A');
 assert.deepEqual(Object.keys(JSON.parse(account.writes[0].value)).sort(),['nonce','type','version']);assert.doesNotMatch(account.writes[0].value,/synthetic|usr_|password|token/i);account.dispose();other.dispose();
});

test('uncertain logout invalidates self and other tabs, and waits for server identity evidence',async()=>{
 const bus=new Set(),otherProbe=deferred(),firstSelfProbe=deferred(),selfProbe=deferred();
 const other=browserHarness([reply(200,A),otherProbe],{bus});await other.settle();
 const account=browserHarness([reply(200,A),reply(200,A),new Error('synthetic lost logout response'),firstSelfProbe,selfProbe],{account:true,realAccountGuard:true,bus});await account.settle();await account.click('退出当前账号');await account.click('继续退出');
 assert.equal(account.status,'checking');assert.equal(other.status,'checking');assert.equal(other.mounted,false);assert.doesNotMatch(account.text(),/synthetic_a/);assert.match(account.text(),/退出结果未能确认/);assert.deepEqual(account.navigation,[]);assert.deepEqual(other.navigation,[]);assert.deepEqual(account.posted,[{type:'session-changed',version:1}]);
 assert.equal(account.calls[3].options.signal.aborted,true);
 selfProbe.resolve(reply(401));otherProbe.resolve(reply(401));await account.settle();await other.settle();assert.equal(account.status,'redirecting');assert.equal(other.status,'redirecting');assert.deepEqual(account.navigation,['/']);assert.deepEqual(other.navigation,['/']);assert.match(account.text(),/退出结果未能确认/);
 firstSelfProbe.resolve(reply(200,A));await account.settle();assert.equal(account.status,'redirecting');account.dispose();other.dispose();
});

test('successful registration and logout also notify, and rejected logout does not',async()=>{
 let registered=false;
 const register=browserHarness([],{owner:null,account:true,realAccountGuard:true,transport(url){if(url==='/api/auth/session')return registered?reply(200,B):reply(401);registered=true;return reply(200,B);}});await register.settle();await register.click('注册新账号');register.input('account-username',B.username);register.input('account-password','synthetic password 123');register.input('account-password-confirmation','synthetic password 123');await register.submit();assert.equal(register.posted.length,1);assert.deepEqual(register.navigation,['/']);register.dispose();
 let logoutAttempts=0,loggedOut=false;
 const logout=browserHarness([],{account:true,realAccountGuard:true,transport(url){if(url==='/api/auth/session')return loggedOut?reply(401):reply(200,A);if(++logoutAttempts===1)return reply(503);loggedOut=true;return {status:200,body:{ok:true}};}});await logout.settle();await logout.click('退出当前账号');await logout.click('继续退出');assert.equal(logout.posted.length,0);assert.deepEqual(logout.navigation,[]);
 await logout.click('继续退出');assert.equal(logout.posted.length,1);assert.deepEqual(logout.navigation,['/']);logout.dispose();
});
