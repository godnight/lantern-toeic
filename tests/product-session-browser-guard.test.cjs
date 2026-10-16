// Browser lifecycle simulation of the shipped hook and StudyApp conditional
// tree. No real browser, storage, users, cookies, media or network are used.
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
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

function browserHarness(responses=[],{owner=A.id,nativeMode=false,broadcast=true,account=false,realAccountGuard=false,bus}={}){
 let slots=[],cursor=0,effects=[],tree,component,guard,mounted=false,unmounts=0,flushes=0;
 const calls=[],navigation=[],posted=[],writes=[],order=[],timers=new Map(),channels=bus||new Set(),ownedChannels=new Set();let timerId=0;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
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
  const next=responses.shift();calls.push({url,options});assert.ok(next,'Unexpected fetch: '+url);if(next instanceof Error)throw next;
  const response=next.promise?await next.promise:next;if(response instanceof Error)throw response;
  return {status:response.status,json:async()=>{if(response.jsonError)throw response.jsonError;return response.body;},ok:response.status>=200&&response.status<300};
 }};
 function load(file,imports){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>{assert.ok(name in imports,'Unexpected import: '+name);return imports[name];},...globals},{filename:file});return exports;}
 const helper=load('lib/use-product-session.ts',{react,'react-dom':{flushSync(fn){flushes++;fn();render();}}});
 const jsx=(type,props,key)=>({type,props,key});
 if(account){
  component=load('app/account/account-form.tsx',{react,'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/use-product-session':{useProductSession(...args){guard=realAccountGuard?helper.useProductSession(...args):{status:'ready',recheck(){}};return guard;},broadcastProductSessionChange:helper.broadcastProductSessionChange}}).default;
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
  get status(){return guard?.status;},get mounted(){return mounted;},get unmounts(){return unmounts;},get flushes(){return flushes;},get workspace(){return nodes(tree).find(node=>node.type===component.workspace);},
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

test('stale SSR product owner stays unmounted until a same-ID server response',async()=>{
 const pending=deferred(),h=browserHarness([pending]);
 assert.equal(h.status,'checking');assert.equal(h.mounted,false);assert.equal(h.calls.length,1);assert.doesNotMatch(h.text(),/synthetic_a/);
 pending.resolve(reply(200,A));await h.settle();assert.equal(h.status,'ready');assert.equal(h.mounted,true);assert.equal(h.workspace.key,JSON.stringify([false,A.id]));
 assert.equal(h.calls[0].options.credentials,'same-origin');assert.equal(h.calls[0].options.cache,'no-store');h.dispose();
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
 pending.resolve(reply(503));await h.settle();assert.equal(h.status,'error');assert.equal(h.mounted,false);assert.deepEqual(h.navigation,[]);assert.match(h.text(),/不会转为访客或清空原记录/);
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
 const h=browserHarness([reply(401),reply(200,B)],{owner:null,account:true});await h.settle();
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
 const register=browserHarness([reply(401),reply(200,B)],{owner:null,account:true});await register.settle();await register.click('注册新账号');register.input('account-username',B.username);register.input('account-password','synthetic password 123');register.input('account-password-confirmation','synthetic password 123');await register.submit();assert.equal(register.posted.length,1);assert.deepEqual(register.navigation,['/']);register.dispose();
 const logout=browserHarness([reply(200,A),reply(503),reply(200)],{account:true});await logout.settle();await logout.click('退出当前账号');await logout.click('继续退出');assert.equal(logout.posted.length,0);assert.deepEqual(logout.navigation,[]);
 await logout.click('继续退出');assert.equal(logout.posted.length,1);assert.deepEqual(logout.navigation,['/']);logout.dispose();
});
