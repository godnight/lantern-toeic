const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..'),ts=require(path.join(root,'node_modules/typescript'));
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});return exports;}
const boundary=load('lib/account-boundary.ts');
test('identity capability remains unknown until readable and never turns native owner into a product session',()=>{
 assert.equal(boundary.identityView(false,'alice',false,7).status,'unknown');
 assert.equal(boundary.identityView(true,'alice',true,8).status,'guest');
 const legacy=boundary.identityView(true,'owner-opaque-123',false,9);assert.equal(legacy.status,'legacy-session');assert.equal(legacy.maskedLabel,'ow…23');assert.equal(legacy.generation,9);
 const product='usr_12345678-1234-4234-8234-123456789abc';assert.equal(boundary.identityView(true,product,false).status,'product-session');assert.equal(boundary.identityView(true,product,true).status,'guest');
 assert.equal(Object.values(boundary.ACCOUNT_CAPABILITIES).some(Boolean),false);assert.equal(boundary.MIGRATION_CONTRACT.writesEnabled,false);
});

// Execute actual client component handlers against synthetic fetch responses.
// No browser storage, cookies, real users or network requests are involved.
const uiTick=()=>new Promise(resolve=>setImmediate(resolve));
function accountUi(responses=[],native=false,file='app/account/account-form.tsx'){
 let slots=[],cursor=0,effects=[],tree;
 const calls=[],navigations=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const previous=slots[i];slots[i]={deps};effects.push(()=>{previous?.cleanup?.();slots[i].cleanup=fn();});}}
 };
 const jsx=(type,props)=>({type,props});
 const imports={react,'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/account-boundary':boundary,'@/content/source-index.json':{default:{entries:[]}}};
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,require(name){assert.ok(name in imports,'Unexpected client import: '+name);return imports[name];},AbortController,
  window:{location:{origin:native?'https://lantern.local':'https://accounts.example.test',assign:url=>navigations.push(url)}},
  fetch:async(url,options={})=>{calls.push({url,options});const response=responses.shift();assert.ok(response,'Unexpected request: '+url);if(response instanceof Error)throw response;return {status:response.status,ok:response.status>=200&&response.status<300,json:async()=>response.body};}
 });
 function walk(value,result=[]){if(!value)return result;if(Array.isArray(value)){value.forEach(child=>walk(child,result));return result;}if(typeof value==='object'){result.push(value);walk(value.props?.children,result);}return result;}
 function text(value){if(value===null||value===undefined||typeof value==='boolean')return '';if(Array.isArray(value))return value.map(text).join('');return typeof value==='object'?text(value.props?.children):String(value);}
 const props={owner:null,nativeMode:native,readable:true,data:{profile:{name:'合成昵称'},attempts:[],checkins:[],recordings:[]},onBackups(){},onSettings(){},onSync(){}};
 function render(){cursor=0;tree=file.includes('account-center')?exports.AccountCenter(props):exports.default();const pending=effects;effects=[];pending.forEach(effect=>effect());return tree;}
 function node(type,label){const found=walk(tree).find(item=>item.type===type&&(label===undefined||text(item)===label||item.props?.id===label));assert.ok(found,'Missing '+type+': '+label);return found;}
 render();
 return {calls,navigations,props,render,all:()=>walk(tree),text:()=>text(tree),node,async settle(){await uiTick();render();await uiTick();render();},async click(label){await node('button',label).props.onClick();await this.settle();},input(id,value){node('input',id).props.onChange({target:{value}});render();},async submit(){node('form').props.onSubmit({preventDefault(){}});await this.settle();}};
}
const userA={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'};
const userB={id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
const sessionResponse=user=>({status:200,body:{user,capabilities:{passwordLogin:true,phoneLogin:false,passwordRecovery:false}}});
test('account form remains closed for disabled, unconfirmed and native sessions',async()=>{
 for(const response of [{status:503},{status:200,body:{user:userA,capabilities:{passwordLogin:false}}},new Error('synthetic offline')]){
  const ui=accountUi([response]);await ui.settle();assert.equal(ui.all().some(item=>item.type==='form'),false);assert.deepEqual(ui.navigations,[]);assert.equal(ui.calls.length,1);
 }
 const native=accountUi([],true);await native.settle();assert.equal(native.calls.length,0);assert.match(native.text(),/鸿蒙原生版/);assert.equal(native.all().some(item=>item.type==='form'),false);
});
test('account switching can be cancelled and only server success navigates to the new owner',async()=>{
 const ui=accountUi([sessionResponse(userA),{status:401,body:{debug:'must not show account existence'}},{status:200,body:{user:userB}}]);await ui.settle();
 await ui.click('切换账号');await ui.click('取消');assert.equal(ui.calls.length,1);assert.equal(ui.all().some(item=>item.type==='form'),false);assert.match(ui.text(),/synthetic_a/);
 await ui.click('切换账号');assert.match(ui.text(),/草稿和录音/);await ui.click('继续选择账号');ui.input('account-username',' Synthetic_B ');ui.input('account-password','synthetic password 123');await ui.submit();
 assert.deepEqual(ui.navigations,[]);assert.match(ui.text(),/已由服务器验证：synthetic_a/);assert.match(ui.text(),/登录失败，请检查用户名和密码/);assert.doesNotMatch(ui.text(),/must not show/);assert.equal(ui.node('input','account-password').props.value,'');
 ui.input('account-password','synthetic password 123');await ui.submit();assert.deepEqual(ui.navigations,['/']);
 for(const call of ui.calls.slice(1)){assert.equal(call.url,'/api/auth/login');assert.equal(call.options.credentials,'same-origin');assert.deepEqual(JSON.parse(call.options.body),{username:' Synthetic_B ',password:'synthetic password 123'});}
});
test('registration validates confirmation and never turns a malformed success into a login',async()=>{
 const ui=accountUi([{status:401},{status:200,body:{user:{id:'client-claimed-owner',username:'synthetic_b'}}}]);await ui.settle();await ui.click('注册新账号');
 ui.input('account-username','synthetic_b');ui.input('account-password','synthetic password 123');ui.input('account-password-confirmation','different password 123');await ui.submit();assert.equal(ui.calls.length,1);assert.match(ui.text(),/两次输入的密码不一致/);
 ui.input('account-password-confirmation','synthetic password 123');await ui.submit();assert.equal(ui.calls[1].url,'/api/auth/register');assert.deepEqual(ui.navigations,[]);assert.match(ui.text(),/请求结果未能确认/);
});
test('logout requires an affirmative continuation and preserves the account when rejected',async()=>{
 const ui=accountUi([sessionResponse(userA),{status:503},{status:200}]);await ui.settle();await ui.click('退出当前账号');await ui.click('取消');assert.equal(ui.calls.length,1);
 await ui.click('退出当前账号');await ui.click('继续退出');assert.match(ui.text(),/退出未获服务器确认/);assert.match(ui.text(),/synthetic_a/);assert.deepEqual(ui.navigations,[]);
 await ui.click('继续退出');assert.deepEqual(ui.navigations,['/']);assert.equal(ui.calls[1].url,'/api/auth/logout');assert.equal(ui.calls[1].options.body,'{}');assert.equal(ui.calls[1].options.credentials,'same-origin');
});
test('account center presents product identity correctly and keeps the account entry out of native mode',async()=>{
 const ui=accountUi([],false,'app/learn/account-center.tsx');ui.props.owner=userA.id;ui.render();assert.match(ui.text(),/微光账号会话/);assert.doesNotMatch(ui.text(),/旧站记录分区/);assert.equal(ui.all().some(item=>item.type==='a'&&item.props.href==='/account'),false);
 await ui.click('前往账号页');assert.ok(ui.all().some(item=>item.type==='a'&&item.props.href==='/account'));await ui.click('取消');assert.equal(ui.all().some(item=>item.type==='a'&&item.props.href==='/account'),false);
 const native=accountUi([],true,'app/learn/account-center.tsx');assert.equal(native.all().some(item=>item.type==='a'&&item.props.href==='/account'),false);assert.doesNotMatch(native.text(),/前往账号页/);
});
test('recovery actions distinguish authentication, permission, identity and event payload conflict',()=>{
 for(const [httpStatus,kind] of [[401,'login'],[403,'permission'],[409,'identity'],[422,'conflict'],[0,'retry'],[503,'retry']])assert.equal(boundary.syncRecovery({httpStatus}).kind,kind);
 assert.equal(boundary.syncRecovery({status:'auth'}).kind,'identity');assert.equal(boundary.syncRecovery({status:'missing',httpStatus:0}).kind,'retry');
});
test('public gate fails closed for pending rights and an unreviewed generated artifact',()=>{
 const run=spawnSync(process.execPath,[path.join(root,'scripts/check-public-distribution.mjs'),'--target','web','--artifact-root',path.join(root,'public/project-information')],{cwd:root,encoding:'utf8'});
 assert.equal(run.status,1,run.stderr);const result=JSON.parse(run.stdout);assert.equal(result.eligible,false);assert.ok(result.issues.some(issue=>issue.startsWith('themes:')));assert.ok(result.issues.some(issue=>issue.includes('No reviewed file allowlist entry')));assert.ok(result.checkedFiles>=3);
});
