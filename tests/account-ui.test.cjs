const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const React=require('react'),jsx=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..'),loader=createSourceLoader({root,imports:{react:React,'react/jsx-runtime':jsx,'../learn/legal-pages':{PublicInfoLinks:()=>null}}});
const identity=loader.load('lib/product-identity.ts'),{AccountPanel,accountNotice}=loader.load('app/account/account-panel.tsx');
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'};
const ready={status:'ready',user:null,capabilities:{passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false},unavailable:false,message:'',access:{owner:null,epoch:1,canAccess:()=>true,assertAccess:()=>true}};
const props={onSubmit:async()=>{},onRecheck(){},onLogout(){},onEnter(){}};
test('field failures identify the first invalid field without changing credential rules',()=>{
 assert.equal(identity.validateProductCredentials('坏名','x'.repeat(15),'x'.repeat(15)).field,'username');
 assert.equal(identity.validateProductCredentials('learner','x'.repeat(7),'x'.repeat(7)).field,'password');
 for(const length of [8,15,128])assert.equal(identity.validateProductCredentials('learner','x'.repeat(length),'x'.repeat(length)).ok,true);
 assert.equal(identity.validateProductCredentials('learner','x'.repeat(129)).field,'password');
 assert.equal(identity.validateProductCredentials('learner','x'.repeat(15),'y'.repeat(15)).field,'confirmation');
 assert.deepEqual({...identity.validateProductCredentials(' Learner ',' '.repeat(15),' '.repeat(15)).credentials},{username:'learner',password:' '.repeat(15)});
});
test('anonymous form has one title, short action and rules in account explanation',()=>{
 const html=renderToStaticMarkup(React.createElement(AccountPanel,{...props,state:ready}));assert.equal((html.match(/<h1/g)||[]).length,1);assert(!html.includes('<h2'));assert.match(html,/>注册<\/button>/);assert.match(html,/<details><summary>账号说明<\/summary>/);assert(!html.includes('安全返回'));assert(!html.includes('注册并核对账号'));
});
test('unknown notice protects data without internal terminology or a success claim',()=>{
 const state={status:'blocked',message:'账号操作结果尚未确认，本机分区已锁定。请显式联网重新核对；不会自动重发。'};
 const html=renderToStaticMarkup(React.createElement(AccountPanel,{...props,state}));assert.match(html,/上次操作的结果还未确认，请重新核对账号后继续/);assert(!html.includes('注册失败'));assert.match(html,/重新核对账号/);assert(!/分区|显式|已成功/.test(html));assert.equal(accountNotice({...ready,user:A,message:'当前身份已重新核对；这不确认原账号操作结果。'},'register'),'已确认当前账号；之前操作的结果仍未确认。');
});

test('Huawei actions require a native capability and preserve the password form',()=>{
 const render=extra=>renderToStaticMarkup(React.createElement(AccountPanel,{...props,state:ready,...extra}));
 for(const extra of [{},{huawei:{login:false,binding:false,onLogin(){},onBind(){}}}])assert(!render(extra).includes('华为账号'));
 const actions={login:true,binding:true,onLogin(){},onBind(){}};
 const guest=render({huawei:actions});assert.match(guest,/>华为账号登录<\/button>/);assert(!guest.includes('绑定华为账号'));assert.match(guest,/name="username"/);assert.match(guest,/name="password"/);
 const member=render({state:{...ready,user:A},huawei:actions});assert.match(member,/>绑定华为账号<\/button>/);assert.match(member,/保留现有学习记录与登录方式，不会合并其他微光账号/);assert(!member.includes('>华为账号登录</button>'));
 for(const state of [{status:'checking',message:'华为账号授权进行中，旧学习分区已暂停。'},{status:'blocked',message:'账号身份待重新核对，学习分区已暂停。'},{...ready,unavailable:true}]){
  const html=render({state,huawei:actions});assert(!html.includes('>华为账号登录</button>'));assert(!html.includes('>绑定华为账号</button>'));
 }
});

test('Huawei notices identify cancellation and conflict without inventing login success',()=>{
 assert.equal(accountNotice({status:'checking',message:'华为账号授权进行中，旧学习分区已暂停。'},'login'),'请在华为账号窗口完成授权。');
 for(const message of ['华为账号授权已取消。','该华为账号已绑定其他微光账号，请使用原账号登录。','华为账号操作未获确认，请稍后重试。','华为账号已绑定，学习记录仍属于当前账号。'])assert.equal(accountNotice({...ready,message},'login'),message);
 assert.equal(accountNotice({...ready,message:'华为原始返回任意私密信息'},'login'),'请核对当前账号后继续。');
 assert.equal(accountNotice({status:'blocked',message:'华为账号操作结果尚未确认，学习分区已锁定。请显式重新核对账号；不会自动重发。'},'login'),'操作结果尚未确认，学习记录已暂时保护。');
});
test('verified identity metadata is matching proof memory only, never a raw owner or nickname',()=>{
 let current=null;const l=createSourceLoader({root,imports:{react:{createContext:initial=>({initial}),useContext:()=>current}}}),m=l.load('lib/learning-access.tsx');assert.equal(m.useVerifiedLearningAccount(A.id),null);
 current={owner:A.id,user:A,epoch:7,canAccess:()=>true};assert.equal(m.useVerifiedLearningAccount(A.id).user.username,A.username);assert.equal(m.useVerifiedLearningAccount('other'),null);current={owner:A.id,epoch:7,canAccess:()=>true};assert.equal(m.useVerifiedLearningAccount(A.id),null);current={owner:A.id,user:A,epoch:7,canAccess:()=>false};assert.equal(m.useVerifiedLearningAccount(A.id),null);
});
