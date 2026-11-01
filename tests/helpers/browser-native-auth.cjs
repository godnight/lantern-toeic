'use strict';
// Browser QA adapter: actual ETS Host/policy, controlled OS HTTP/Asset ports.
// It does not set React account state, loosen trusted origins or expose tokens.
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {hostRuntime,response}=require('./native-auth-host-runtime.cjs');
const NATIVE_ORIGIN='https://lantern.local';
const NATIVE_QA_USER=Object.freeze({id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_browser_qa'});
const caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false};

async function installNativeAccountFixture(context,{user=NATIVE_QA_USER,report}={}){
 assert.match(user.id,/^usr_[0-9a-f-]{36}$/);
 const token=randomBytes(32).toString('hex'),hosts=new Map();
 const evidence={owner:user.id,origin:NATIVE_ORIGIN,host:'Actual ETS NativeAuthHost; controlled OS HTTP/Asset ports',sessionProofVersion:2,verifiedPages:0,sessionRequests:0,providerRequests:0};
 if(report){report.nativeAccounts??=[];report.nativeAccounts.push(evidence);}
 await context.exposeBinding('__lanternQaNativeRequest',async({page},raw)=>{
  assert.equal(new URL(page.url()).origin,NATIVE_ORIGIN,'Native account bridge must remain on the actual trusted origin');
  let h=hosts.get(page);
  if(!h){
   h=hostRuntime({initialToken:token,dispatch:async(url,options)=>{
    assert.equal(new URL(url).origin,'https://auth.test');
    assert.equal(options.method,'GET','These learning regressions must not mutate authentication');
    const pathname=new URL(url).pathname;
    if(pathname==='/api/auth/session'){
     evidence.sessionRequests++;
     assert.equal(options.header.Cookie,'__Host-lantern-session='+token);
     assert.equal(options.header['X-Lantern-Session-Proof'],'2','Independent session proof is required before learning');
     return response(200,{user,capabilities:caps,session:{version:2,remainingMs:43200000}});
    }
    if(pathname==='/api/auth/providers'){evidence.providerRequests++;return response(200,{huaweiLogin:false,huaweiBinding:false});}
    throw Error('Unexpected authentication route in learning regression: '+pathname);
   }});
   hosts.set(page,h);
   // ArkWeb pageBegin invalidates document navigations, not same-document
   // replaceState/hash changes emitted as Playwright framenavigated events.
   page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())h.host.invalidate();});
   page.on('close',()=>{h.dispose();hosts.delete(page);});
  }
  h.setFrame(page.url());
  return h.invoke(JSON.parse(raw));
 });
 await context.addInitScript(()=>{
  window.LanternAuthHost={request(raw){
   void window.__lanternQaNativeRequest(raw).then(reply=>window.__lanternAuthReceive?.(reply));
  }};
 });
 context.on('close',()=>{for(const h of hosts.values())h.dispose();hosts.clear();});
 return {assertVerified(page){
  const h=hosts.get(page);assert(h,'The page must have used the real native Host');
  assert(h.requests.some(r=>r.path==='/api/auth/session'&&r.proof==='2'&&r.hasCookie),'Missing independent native session proof');
  assert.equal(h.host.trustedOwnerProvider().snapshot()?.uid,user.id,'The native owner lease must match fixture data');
  evidence.verifiedPages++;
 },evidence};
}

async function fulfillNativePreview(route,previewOrigin){
 const url=new URL(route.request().url()),backend=new URL(previewOrigin);
 assert.equal(url.origin,NATIVE_ORIGIN);
 assert.equal(backend.protocol,'http:');assert.equal(backend.hostname,'127.0.0.1');
 assert(!url.pathname.startsWith('/api/'),'Native authentication must use the native bridge, never browser HTTP');
 const result=await route.fetch({url:previewOrigin+url.pathname+url.search,maxRedirects:0,timeout:30000});
 return route.fulfill({response:result});
}
module.exports={NATIVE_ORIGIN,NATIVE_QA_USER,installNativeAccountFixture,fulfillNativePreview};
