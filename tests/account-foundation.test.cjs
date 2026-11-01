'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {environment}=require('./helpers/product-auth-harness.cjs');
const plain=v=>JSON.parse(JSON.stringify(v));
test('browser credentials match the unchanged server Unicode policy',()=>{
 const e=environment();try{const front=e.load('lib/product-identity.ts'),server=e.load('lib/password-credential.ts');
  const passwords=[' '.repeat(15),'x'.repeat(14),'x'.repeat(128),'x'.repeat(129),'🦉'.repeat(15),'🦉'.repeat(128),'e\u0301'.repeat(15),'x'.repeat(15)+'\0','x'.repeat(15)+'\ud800','x'.repeat(15)+'\udc00'];
  for(const password of passwords)assert.equal(front.validateProductCredentials(' Learner_01 ',password).ok,server.validatePassword(password).ok);
  for(const name of ['Abc',' abc ','ab','a'.repeat(33),'Ａbc','abc\u200b'])assert.equal(front.validateProductCredentials(name,' '.repeat(15)).ok,server.normalizeUsername(name).ok);
 }finally{e.close();}
});
test('HTTP session v2 returns authoritative remaining time without renewing v1 or storage',async()=>{
 const e=environment();try{const u=await e.register('budget_learner'),before=e.rows('auth_sessions');
  const old=await e.call('session','GET',{cookie:u.cookie});assert.deepEqual(Object.keys(await old.json()).sort(),['capabilities','user']);
  const response=await e.call('session','GET',{cookie:u.cookie,headers:{'X-Lantern-Session-Proof':'2'}}),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.user.id,u.id);assert.equal(body.session.version,2);assert(Number.isSafeInteger(body.session.remainingMs)&&body.session.remainingMs>0&&body.session.remainingMs<=43200000);assert.equal(response.headers.get('set-cookie'),null);assert.match(response.headers.get('vary'),/X-Lantern-Session-Proof/);assert.deepEqual(e.rows('auth_sessions'),before);
  e.sqlite.prepare('UPDATE auth_sessions SET expires_at=?').run(Date.now()-1);assert.equal((await e.call('session','GET',{cookie:u.cookie,headers:{'X-Lantern-Session-Proof':'2'}})).status,401);
 }finally{e.close();}
});
test('v2 proof is strict and elapsed time can only reduce the usable budget',()=>{
 const e=environment();try{const {readSessionProof}=e.load('lib/session-proof.ts'),body={user:{id:'usr_12345678-1234-4234-8234-123456789abc',username:'learner'},capabilities:{passwordLogin:true,phoneLogin:false,passwordRecovery:false},session:{version:2,remainingMs:1000}};
  assert.equal(readSessionProof(body,'http',25).validForMs,975);
  for(const value of [0,-1,1.5,Infinity,43200001])assert.equal(readSessionProof({...body,session:{version:2,remainingMs:value}},'http',0),null);
  assert.equal(readSessionProof(body,'http',1000),null);assert.equal(readSessionProof(body,'http',-1),null);assert.equal(readSessionProof({...body,token:'forbidden'},'http',0),null);assert.equal(readSessionProof({...body,user:{...body.user,owner:'forbidden'}},'http',0),null);assert.equal(readSessionProof({...body,session:{version:1,remainingMs:1000}},'http',0),null);
  for(const capabilities of [{...body.capabilities,cloudSync:'yes'},{...body.capabilities,owner:'x'},{passwordLogin:true}])assert.equal(readSessionProof({...body,capabilities},'http',0),null);
 }finally{e.close();}
});

test('actual access context defaults closed, checks raw owner and keeps old-proof callbacks closed',()=>{
 const {createSourceLoader}=require('./helpers/actual-source-loader.cjs'),path=require('node:path');let current=null;
 const loader=createSourceLoader({root:path.resolve(__dirname,'..'),imports:{react:{createContext:initial=>({initial}),useContext:()=>current}}});
 const {useLearningAccess,LearningAccessContext}=loader.load('lib/learning-access.tsx');assert.equal(LearningAccessContext.initial,null);assert.equal(useLearningAccess('A')(),false);
 let open=true;current={owner:'A',epoch:1,canAccess:()=>open,assertAccess:()=>open};const old=useLearningAccess('A');assert(old());assert.equal(useLearningAccess('B')(),false);open=false;current={owner:'B',epoch:2,canAccess:()=>true,assertAccess:()=>true};assert.equal(old(),false);assert(useLearningAccess('B')());
});
test('operation checks fail closed even when the timer is delayed or monotonic time rolls back',()=>{
 const e=environment();try{const {SessionDeadline}=e.load('lib/session-proof.ts');let now=100,expired=0;const tasks=new Map(),clock={now:()=>now,set:(f,ms)=>{tasks.set(f,ms);return f;},clear:f=>tasks.delete(f)};
  const gate=new SessionDeadline(100,()=>expired++,clock);assert(gate.canAccess());now=201;assert.equal(gate.assertAccess(),false);assert.equal(expired,1);assert.equal(gate.assertAccess(),false);assert.equal(expired,1);
  now=300;const next=new SessionDeadline(100,()=>expired++,clock);now=299;assert.equal(next.canAccess(),false);now=301;assert.equal(next.assertAccess(),false);assert.equal(expired,2);next.close();gate.close();
 }finally{e.close();}
});
