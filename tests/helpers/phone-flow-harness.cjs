"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os'),assert=require('node:assert/strict');
async function createPhoneFlowHarness(options){
 const site=fs.realpathSync(options.site),productOnly=options.productOnly===true,candidate=productOnly?site:fs.realpathSync(options.candidate||path.resolve(__dirname,'../..'));
 const pinsOut=path.resolve(options.pinsOut||path.join(os.tmpdir(),'phone-flow-'+crypto.randomUUID()+'.json'));
 assert(!pinsOut.toLowerCase().startsWith(site.toLowerCase()+path.sep),'Pins stay outside site');
 const origin=options.origin||'https://study.test',audience=origin+'/phone-flow-test',sourcePins=new Map();
 assert.match(origin,/^https:\/\/[^/]+$/,'Tests preserve HTTPS auth origin');
 const {build}=require(path.join(site,'node_modules/esbuild')),{Miniflare,Log,LogLevel}=require(path.join(site,'node_modules/miniflare'));
const resolve=(root,relative)=>['','.ts','.tsx','.json','/index.ts'].map(s=>path.resolve(root,relative+s)).find(f=>f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile());
const plugin={name:'actual-phone-flow-source',setup(builder){
 builder.onResolve({filter:/^next\/headers$/},()=>({path:'next/headers',namespace:'no-ambient-identity'}));
 builder.onLoad({filter:/.*/,namespace:'no-ambient-identity'},()=>({contents:'export function headers(){throw new Error("Request identity required")}'}));
 builder.onResolve({filter:/^(?:@\/|\.)/},args=>{if(args.importer?.includes(path.sep+'node_modules'+path.sep))return;const root=args.importer?.startsWith(candidate+path.sep)?candidate:site;const rel=args.path.startsWith('@/')?args.path.slice(2):path.relative(root,path.resolve(args.importer?path.dirname(args.importer):site,args.path));const file=productOnly?resolve(site,rel):resolve(candidate,rel)||resolve(site,rel);if(!file)throw new Error('Resolve actual source '+rel);return {path:file};});
}};
const worker=`
import {credentialAction,sessionAction,productSessionTokenHash} from './lib/auth-service';
import {createPhoneFlowService,phoneFlowAction} from './lib/phone-flow-service';
import {POST as productionBind} from './app/api/auth/phone/bind/route';
import {POST as productionLogin} from './app/api/auth/phone/login/route';
import {GET as productionStatus} from './app/api/auth/phone/status/route';
import {POST as productionChallenge} from './app/api/auth/phone/challenge/route';
import {POST as studyPost,GET as studyGet} from './app/api/study/route';
import {createTestPhoneChallengeProvider} from './tests/helpers/test-phone-challenge-provider';
const issuer=createTestPhoneChallengeProvider(),flow=createPhoneFlowService({provider:issuer.provider,providerId:'synthetic-only',audience:${JSON.stringify(audience)}});
let fault=null,readsUnavailable=false,lastFault=null;
function environment(request,env){
 const wrap=(raw,sql)=>({_raw:raw,_sql:sql,bind(...args){return wrap(raw.bind(...args),sql)},first(...args){if(readsUnavailable)throw new Error('Synthetic reads unavailable');return raw.first(...args)},all(...args){if(readsUnavailable)throw new Error('Synthetic reads unavailable');return raw.all(...args)},run(...args){if(readsUnavailable)throw new Error('Synthetic reads unavailable');return raw.run(...args)},raw(...args){return raw.raw(...args)}});
 return {...env,DB:{prepare(sql){if(readsUnavailable)throw new Error('Synthetic reads unavailable');return wrap(env.DB.prepare(sql),sql)},async batch(statements){
  const claim=statements.some(s=>s._sql.startsWith('INSERT INTO auth_phone_proofs'));
  const reserve=statements.some(s=>s._sql.startsWith('INSERT INTO auth_phone_challenges'));
  const mark=statements.some(s=>s._sql.includes("SET state='sent',provider_reference"));
  const selected=fault;
  if((selected==='reserve-ack'&&reserve)||(selected==='send-ack'&&mark)||(selected?.startsWith('proof-')&&claim)){
   fault=null;lastFault=selected;let actual=statements.map(s=>s._raw);
   if(selected==='proof-sql')actual=[...actual.slice(0,2),env.DB.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(NULL,NULL,0,0)'),...actual.slice(2)];
   if(selected==='proof-expiry')actual=[...actual.slice(0,-2),env.DB.prepare("UPDATE auth_phone_challenges SET expires_at=0 WHERE rowid=(SELECT MAX(rowid) FROM auth_phone_challenges)"),...actual.slice(-2)];
   if(selected==='proof-revoke')await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(productSessionTokenHash(request.headers)).run();
   const result=await env.DB.batch(actual);
   if(selected==='proof-unknown')readsUnavailable=true;
   if(['reserve-ack','send-ack','proof-lost-ack','proof-unknown'].includes(selected))throw new Error('Synthetic ACK lost after actual commit');
   return result;
  }
  return env.DB.batch(statements.map(s=>s._raw));
 }}};
}
export default {async fetch(request,env){const r=new URL(request.url).pathname;
 if(r==='/__test/config'){const config=await request.json();issuer.configure(config);fault=config.fault??null;readsUnavailable=false;return Response.json({ok:true});}
 if(r==='/__test/issuer'){const {id}=await request.json();return Response.json({credential:issuer.read(id),stats:issuer.stats(),lastFault});}
 if(r==='/register')return credentialAction(request,'register',env);
 if(r==='/password-login')return credentialAction(request,'login',env);
 if(r==='/session')return sessionAction(request,'read',env);
 if(r==='/study')return request.method==='POST'?studyPost(request):studyGet(request);
 if(r==='/api/auth/phone/status')return productionStatus(request);
 if(r==='/api/auth/phone/challenge')return productionChallenge(request);
 if(r==='/api/auth/phone/bind')return productionBind(request);
 if(r==='/api/auth/phone/login')return productionLogin(request);
 if(r.startsWith('/__test/phone/'))return flow(request,r.split('/').at(-1),environment(request,env));
 return new Response('missing',{status:404});
}};`;
 const bundle=await build({stdin:{contents:worker,resolveDir:site,sourcefile:'phone-flow-worker.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['node:*','cloudflare:workers'],nodePaths:[path.join(site,'node_modules')],plugins:[plugin],metafile:true});
 for(const f of Object.keys(bundle.metafile.inputs)){if(f.startsWith('<')||f.startsWith('no-ambient-identity:'))continue;const p=path.resolve(f);if(!fs.existsSync(p)||p.includes(path.sep+'node_modules'+path.sep))continue;const raw=fs.readFileSync(p);sourcePins.set(p,{path:p,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')});}
 const mf=new Miniflare({name:'synthetic-phone-flow',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],cf:false,host:'127.0.0.1',port:0,d1Databases:{DB:'synthetic-phone-flow'},d1Persist:false,r2Persist:false,cachePersist:false,kvPersist:false,durableObjectsPersist:false,bindings:{LANTERN_AUTH_ENABLED:'true',LANTERN_AUTH_ORIGIN:origin,LANTERN_PHONE_FAKE:'true'},outboundService:()=>new Response('External denied',{status:502}),log:new Log(LogLevel.ERROR)});
 const db=await mf.getD1Database('DB');
 const migrations=fs.readdirSync(path.join(site,'drizzle')).filter(n=>/^\d+.*\.sql$/.test(n)).sort().map(n=>path.join(site,'drizzle',n));
 if(productOnly){assert.equal(migrations.length,9);assert(migrations.some(n=>n.endsWith('0008_phone_challenges.sql')));}else{assert(!migrations.some(n=>path.basename(n).startsWith('0008_')));migrations.push(path.join(candidate,'drizzle/0008_phone_challenges.sql'));}
 for(const p of migrations){const raw=fs.readFileSync(p);sourcePins.set(p,{path:p,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')});await db.batch(raw.toString('utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));}

 const dispatch=(route,body,cookie,headers={})=>mf.dispatchFetch(origin+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const writePins=()=>{for(const pin of sourcePins.values())assert.equal(crypto.createHash('sha256').update(fs.readFileSync(pin.path)).digest('hex'),pin.sha256);if(productOnly)for(const pin of sourcePins.values())assert(pin.path.startsWith(site+path.sep));fs.writeFileSync(pinsOut,JSON.stringify({pins:[...sourcePins.values()],productOnly,realLocalWorkerdD1:true,syntheticOnly:true,remote:false,realProvider:false,realSms:false,device:false},null,2)+'\n');return pinsOut;};
 return {mf,db,origin,audience,sourcePins,pinsOut,dispatch,configure:value=>dispatch('/__test/config',value),issue:async id=>(await dispatch('/__test/issuer',{id})).json(),writePins,dispose:()=>mf.dispose()};
}
module.exports={createPhoneFlowHarness};
