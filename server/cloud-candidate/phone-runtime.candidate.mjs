// Integration candidate. Importing or preparing it never opens a socket,
// obtains cloud credentials, starts a service, or sends a message. The caller
// must provide an audited server-only PNVS client, protected configuration,
// exclusive account DB, and complete migration/production lifecycle handling.
import path from 'node:path';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {parseProductionPhonePolicy,validateLimiterCompatibility,readProductionReferenceKey,validatePhoneDatabaseState} from './production-phone-preflight.candidate.mjs';
import {createRestrictedPnvsOutbound} from './production-pnvs-outbound.candidate.mjs';
import {createRefreshingPnvsClient} from './ecs-role-credentials.candidate.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const site=root;
const {build}=createRequire(path.join(root,'package.json'))('esbuild');
const q=p=>JSON.stringify(p.replaceAll('\\','/'));
const endpoint='https://lantern-pnvs.internal/call';
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...keys].sort().join(',');
const sendKeys=['PhoneNumber','CountryCode','SignName','TemplateCode','SchemeName','OutId','TemplateParam','CodeType','CodeLength','ValidTime','Interval','DuplicatePolicy','ReturnVerifyCode','AutoRetry'];
const checkKeys=['PhoneNumber','CountryCode','SchemeName','OutId','VerifyCode'];

function validFields(action,f,config){
 if(!exact(f,action==='SendSmsVerifyCode'?sendKeys:checkKeys)||typeof f.PhoneNumber!=='string'||!/^1[0-9]{10}$/.test(f.PhoneNumber)||f.CountryCode!=='86'||
    f.SchemeName!==config.schemeName||typeof f.OutId!=='string'||!/^[A-Za-z0-9_-]{22,128}$/.test(f.OutId))return false;
 if(action==='CheckSmsVerifyCode')return typeof f.VerifyCode==='string'&&/^[0-9]{6}$/.test(f.VerifyCode);
 if(f.SignName!==config.signature||!Object.values(config.templates).includes(f.TemplateCode)||
    f.CodeType!==1||f.CodeLength!==6||f.ValidTime!==300||f.Interval!==60||f.DuplicatePolicy!==1||f.ReturnVerifyCode!==false||f.AutoRetry!==0)return false;
 try{if(typeof f.TemplateParam!=='string')return false;const p=JSON.parse(f.TemplateParam);return exact(p,['code','min'])&&p.code==='##code##'&&p.min==='5';}catch{return false;}
}
async function bounded(request,max){
 if(!request.body)return Buffer.alloc(0);const reader=request.body.getReader(),chunks=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){await reader.cancel();throw Error('request too large');}chunks.push(part.value);}}
 finally{reader.releaseLock();}return Buffer.concat(chunks);
}

/** The credential getter must return short-lived STS credentials and must
 * never send/verify an SMS. TLS fetch is injected by the service owner; the
 * restricted transport fixes the destination and never follows redirects. */
export async function createServerPnvsCaller({enabled=false,getCredentials,pnvsFetch}={}){
 if(enabled!==true||typeof getCredentials!=='function'||typeof pnvsFetch!=='function')throw Error('PNVS caller disabled');
 const output=await build({entryPoints:[path.join(here,'phone-pnvs-provider.candidate.ts')],bundle:true,write:false,format:'esm',platform:'node',target:'node20',external:['node:*']});
 const {createPnvsHttpClient}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].contents).toString('base64'));
 const restricted=createRestrictedPnvsOutbound({enabled:true,fetchImpl:pnvsFetch});
 const secureCredentials=async()=>{
  const value=await getCredentials();
  if(!value||typeof value.accessKeyId!=='string'||!value.accessKeyId||typeof value.accessKeySecret!=='string'||!value.accessKeySecret||typeof value.securityToken!=='string'||!value.securityToken||
     !Number.isFinite(value.expiration)||value.expiration-Date.now()<=60000)throw Error('credential unavailable');
  return value;
 };
 const client=createRefreshingPnvsClient({getCredentials:secureCredentials,makeClient:createPnvsHttpClient,pnvsFetch:(url,init)=>restricted(new Request(url,init))});
 return (action,fields,signal)=>client.call(action,fields,signal);
}

/** `pnvsCall` is an injected, audited SERVER callback. It must retrieve short-
 * lived credentials safely, verify TLS to the fixed PNVS endpoint, disallow
 * redirects and retries, and must not log input, output or credentials. */
export function createPhoneServiceBinding({policy,pnvsCall}={}){
 const config=parseProductionPhonePolicy(policy);
 if(!config.enabled||typeof pnvsCall!=='function')throw Error('phone runtime disabled');
 return async request=>{
  if(request.url!==endpoint||request.method!=='POST'||request.headers.get('content-type')!=='application/json')return new Response(null,{status:403});
  try{
   const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(request,8192)));
   if(!exact(payload,['action','fields'])||!['SendSmsVerifyCode','CheckSmsVerifyCode'].includes(payload.action)||!validFields(payload.action,payload.fields,config))return new Response(null,{status:403});
   const value=await pnvsCall(payload.action,payload.fields,request.signal);
   const encoded=JSON.stringify(value);if(typeof encoded!=='string'||Buffer.byteLength(encoded)>65536)throw Error('invalid response');
   return new Response(encoded,{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }catch{return new Response(null,{status:503,headers:{'cache-control':'no-store'}});}
 };
}

/** Build a worker without secrets in source. Returned bindings must only be
 * passed to the local server runtime; this does not start or publish it. */
async function preparePhoneRuntime({policy,referenceKey,pnvsCall}={}){
 const config=parseProductionPhonePolicy(policy);
 if(!config.enabled||!Buffer.isBuffer(referenceKey)||referenceKey.length!==32||typeof pnvsCall!=='function')throw Error('phone runtime disabled or incomplete');
 const limits=config.limits,limiter={lifetimeMs:300000,cooldownMs:60000,maxAttempts:5,
  sendPhone:{span:3600000,max:limits.maxSendsPerPhoneHour},sendGlobal:{span:60000,max:limits.maxSendsPerMinute},
  sendGlobalDaily:{span:86400000,max:limits.maxSendsPerUtcDay},verifyPhone:{span:600000,max:limits.maxVerificationsPerPhoneTenMinutes},verifyGlobal:{span:60000,max:100}};
 validateLimiterCompatibility(config,limiter);
 const source=`
 import base from ${q(path.join(here,'auth-worker.ts'))};
 import {createPhoneCloudCandidate} from ${q(path.join(here,'phone-cloud-composition.candidate.mjs'))};
 export default {async fetch(request,env,ctx){
  const config=env.LANTERN_PHONE_CONFIG,service=env.LANTERN_PNVS_RPC;
  if(!config||!service||typeof service.fetch!=='function')return new Response(null,{status:503});
  const app=createPhoneCloudCandidate({base,enabled:true,getCredentials:async()=>({ready:true}),
   makeClient:()=>({async call(action,fields,signal){
    const result=await service.fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,fields}),signal});
    if(!result.ok)throw Error('PNVS unavailable');return result.json();
   }}),...config});
  return app.fetch(request,env,ctx);
 }};`;
 const overrides=new Map([[path.join(here,'phone-limiter.candidate.ts'),path.join(here,'phone-limiter.candidate.ts')]]);
 const result=await build({stdin:{contents:source,resolveDir:site,loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['node:*','cloudflare:workers'],nodePaths:[path.join(site,'node_modules')],plugins:[{name:'audited-phone-inputs',setup(b){b.onLoad({filter:/\.ts$/},a=>{const p=overrides.get(a.path);if(!p)return;let contents=fs.readFileSync(p,'utf8');if(p===path.join(here,'phone-limiter.candidate.ts')){
  const pattern=/^export const PHONE_FLOW_POLICY=Object\.freeze\([^\r\n]+\);$/gm;
  if((contents.match(pattern)||[]).length!==1)throw Error('limiter source changed');
  contents=contents.replace(pattern,`export const PHONE_FLOW_POLICY=Object.freeze(${JSON.stringify(limiter)});`);
 }return {contents,loader:'ts',resolveDir:path.dirname(a.path)};});}}]});
 const binding=createPhoneServiceBinding({policy:config,pnvsCall});
 return Object.freeze({script:result.outputFiles[0].text,
  bindings:Object.freeze({LANTERN_PHONE_CONFIG:Object.freeze({signature:config.signature,templates:config.templates,schemeName:config.schemeName,referenceKey:referenceKey.toString('hex'),audience:config.origin+'/phone'})}),
  serviceBindings:Object.freeze({LANTERN_PNVS_RPC:binding}),limits:Object.freeze({...limits})});
}

/** Intended integration entry for the account-service owner. The caller is
 * still responsible for obtaining policy from a protected config file,
 * authenticating the ECS metadata transport, opening/locking D1, and reading
 * the ledger/schema from that same database after reviewed migrations. An
 * absent/disabled policy does not read any key or
 * construct a provider. This function does not start or deploy anything. */
export async function prepareProductionPhoneAssembly({policy,accountOrigin,privateRoot,getCredentials,pnvsFetch,mf}={}){
 const config=parseProductionPhonePolicy(policy);
 if(!config.enabled)return Object.freeze({enabled:false});
 if(config.origin!==accountOrigin)throw Error('phone/account origin mismatch');
 if(typeof getCredentials!=='function'||typeof pnvsFetch!=='function')throw Error('phone credentials or transport unavailable');
 if(!mf||typeof mf.getD1Database!=='function')throw Error('phone database unavailable');
 const db=await mf.getD1Database('DB');
 const ledgerRows=(await db.prepare("SELECT name,sha FROM _lantern_local_migrations WHERE name IN ('0007_phone_auth.sql','0008_phone_challenges.sql') ORDER BY name").all()).results;
 const schemaRows=(await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name IN ('auth_phone_bindings','auth_phone_proofs','auth_phone_proofs_expiry','auth_phone_challenges','auth_phone_challenges_expiry','auth_phone_flow_buckets','auth_phone_flow_cooldowns','auth_phone_flow_operations') ORDER BY name").all()).results;
 validatePhoneDatabaseState({ledgerRows,schemaRows});
 const saved=await db.prepare('SELECT policy FROM _lantern_phone_policy WHERE singleton=1').first();
 const limits=config.limits,expectedPolicy=JSON.stringify([limits.maxSendsPerUtcDay,limits.maxSendsPerMinute,limits.maxSendsPerPhoneHour,limits.maxVerificationsPerPhoneTenMinutes]);
 if(saved?.policy!==expectedPolicy)throw Error('phone budget policy mismatch');
 const key=await readProductionReferenceKey(config.referenceKeyFile,privateRoot);
 try{
  const pnvsCall=await createServerPnvsCaller({enabled:true,getCredentials,pnvsFetch});
  const runtime=await preparePhoneRuntime({policy:config,referenceKey:key,pnvsCall});
  return Object.freeze({enabled:true,...runtime});
 }finally{key.fill(0);}
}
