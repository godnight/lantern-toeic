// Actual v2 hook/controller/web transport, synthetic browser ports only.
const test=require('node:test'),assert=require('node:assert/strict');
const {browser,deferred}=require('./helpers/web-session-runtime.cjs');
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},B={id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
const proof=(user,ms=1000)=>({status:200,body:{user,capabilities:{passwordLogin:true,phoneLogin:false,passwordRecovery:false},session:{version:2,remainingMs:ms}}});

test('stale SSR owner stays closed until exact v2 same-owner proof, without identity in requests',async()=>{
 const pending=deferred(),h=browser({owner:A.id,responses:[pending]});try{assert(!h.mounted());pending.resolve(proof(A));await h.flush();assert(h.mounted());assert.equal(h.calls[0].options.headers['X-Lantern-Session-Proof'],'2');assert.equal(h.calls[0].options.body,undefined);}finally{await h.dispose();}
});
test('old server 200 without proof and malformed budgets never fall back to a fabricated 12h',async()=>{
 for(const response of [{status:200,body:{user:A,capabilities:{passwordLogin:true,phoneLogin:false}}},proof(A,0),proof(A,43200001)]){const h=browser({owner:A.id,responses:[response]});try{await h.flush();assert.equal(h.value.status,'error');assert(!h.mounted());}finally{await h.dispose();}}
});
test('different UID or server 401 only navigates to a new server-owned page, never mounts the old one',async()=>{
 for(const response of [proof(B),{status:401,body:{code:'unauthenticated'}}]){const h=browser({owner:A.id,responses:[response]});try{await h.flush();assert.deepEqual(h.navigation,['/']);assert(!h.mounted());}finally{await h.dispose();}}
});
test('cross-tab hold suspends synchronously; focus and visibility cannot clear unknown mutation hold',async()=>{
 const bus=new Set(),a=browser({owner:A.id,bus,responses:[proof(A)]}),b=browser({owner:A.id,bus,responses:[proof(A)]});try{await a.flush();await b.flush();assert(a.mounted()&&b.mounted());a.loader.load('lib/web-auth-transport.ts').setAuthResultHold(true);assert(!a.mounted()&&!b.mounted());const n=b.calls.length;b.window.emit('focus');b.document.emit('visibilitychange');await b.flush();assert.equal(b.calls.length,n);b.queue.push(proof(B));b.value.recheck();await b.flush();assert.deepEqual(b.navigation,['/']);assert(!b.mounted());assert(!JSON.stringify(a.posts).includes(A.id));}finally{await a.dispose();await b.dispose();}
});
test('full-body session timeout is bounded; a late A body cannot revive the covered workspace',async()=>{
 const body=deferred(),h=browser({owner:A.id,responses:[{status:200,jsonPromise:body.promise}]});try{await h.flush();h.advance(15000);await h.flush();assert.equal(h.value.status,'error');body.resolve(proof(A).body);await h.flush();assert(!h.mounted());}finally{await h.dispose();}
});
test('wall clock changes do not extend the budget and operation guards close before a delayed timer',async()=>{
 const h=browser({owner:A.id,responses:[proof(A,100)]});try{await h.flush();const access=h.value.access;h.wall(-100000000);h.advance(99,false);assert(access.canAccess());h.advance(2,false);assert.equal(access.assertAccess(),false);assert(!h.mounted());assert.equal(h.value.status,'error');}finally{await h.dispose();}
});
test('pagehide closes old proof; unknown resume cannot restore old A and stale callbacks are ignored',async()=>{
 const pending=deferred(),h=browser({owner:A.id,responses:[proof(A),pending]});try{await h.flush();const old=h.value.access;h.window.emit('pagehide');assert(!old.canAccess());h.window.emit('pageshow');await h.flush();h.queue.push(proof(B));h.value.recheck();await h.flush();pending.resolve(proof(A));await h.flush();assert.deepEqual(h.navigation,['/']);assert(!old.canAccess());}finally{await h.dispose();}
});
test('unknown credential mutation waits for explicit recheck, which proves current identity rather than original intent',async()=>{
 const h=browser({responses:[proof(A),{status:503,body:{code:'auth-unavailable'}},proof(B)]});const {NativeAccountController}=h.loader.load('lib/native-account-controller.ts'),web=h.loader.load('lib/web-auth-transport.ts'),c=new NativeAccountController(web.createWebAuthTransport());try{
 // Dispose the hook's initial anonymous probe so the explicit panel controller owns the remaining flow.
 await h.flush();h.queue.splice(0,h.queue.length,proof(A),{status:503,body:{code:'auth-unavailable'}},proof(B));c.start();await h.flush();assert.equal(c.getSnapshot().user.id,A.id);await c.mutate('login',{username:'synthetic_b',password:'Synthetic only password 42!'});assert.equal(c.getSnapshot().status,'blocked');const n=h.calls.length;c.resume();await h.flush();assert.equal(h.calls.length,n);web.setAuthResultHold(false,false,false);c.recheck();await h.flush();assert.equal(c.getSnapshot().user.id,B.id);assert.match(c.getSnapshot().message,/不确认原账号操作/);
 }finally{c.dispose();await h.dispose();}
});
test('verified Retry-After prevents another credential request without inventing a wait for missing headers',async()=>{
 const h=browser({responses:[{status:401,body:{code:'unauthenticated'}}]});await h.flush();const t=h.loader.load('lib/web-auth-transport.ts').createWebAuthTransport();try{h.queue.push({status:429,headers:{'Retry-After':'1'},body:{code:'too-many-attempts'}});await t.request('login',{username:'synthetic_a',password:'Synthetic only password 42!'});const n=h.calls.length;assert.equal((await t.request('login',{username:'synthetic_a',password:'Synthetic only password 42!'})).status,429);assert.equal(h.calls.length,n);}finally{t.dispose();await h.dispose();}
});
