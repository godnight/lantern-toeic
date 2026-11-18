// Experimental composition only: it does not open a server or load any
// configuration, credentials, keys or database. Never deploy this candidate.
// Bundling must resolve the project's TypeScript sources and the auth worker.
import { createPhoneFlowService } from './phone-registration-flow.candidate.ts';
import { createPnvsProvider } from './phone-pnvs-provider.candidate.ts';
// Use the reviewed gate which normalizes CRLF pairs only. The earlier candidate
// compares raw sqlite_schema text and rejects the verified 20075 migration.
import { createPhoneGateway } from './phone-gateway.candidate.mjs';
import { createPreflightProvider } from './phone-preflight-provider.candidate.mjs';
import { readBoundedRequestBody } from '../../lib/request-body.ts';

/** Caller must supply a trusted issuer factory and side-effect-free credential
 * lookup. There is no default network client or real credential discovery.
 * A deployment requires its own audited, stable private configuration,
 * durable DB, lifecycle supervision and safe request policy. */
export function createPhoneCloudCandidate({base,enabled=false,getCredentials,makeClient,signature,templates={},schemeName,referenceKey,audience}={}) {
 if(enabled!==true)throw new TypeError('phone cloud candidate disabled');
 if(typeof getCredentials!=='function'||typeof makeClient!=='function')throw new TypeError('trusted credential and client factories required');
 // Only the reviewed gifted templates are accepted. Missing or mis-matched
 // configuration disables that purpose rather than silently using the other.
 const active={login:templates?.login==='100001',bind:templates?.bind==='100004'};
 const providers=Object.fromEntries(Object.keys(active).filter(k=>active[k]).map(purpose=>[purpose,createPreflightProvider({getCredentials,makeProvider:credentials=>createPnvsProvider({
  client:makeClient(credentials),signature,templateCode:templates[purpose],schemeName,referenceKey,exclusivePhoneScope:true,
 })})]));
 const provider={
  send:(context,key,signal)=>providers[context.purpose]?.send(context,key,signal) ?? Promise.resolve({status:'rejected'}),
  verify:(input,context,signal)=>providers[context.purpose]?.verify(input,context,signal) ?? Promise.reject(Error('phone purpose unavailable')),
 };
 const rawFlow=createPhoneFlowService({provider,providerId:'pnvs',audience,allowPhoneRegistration:true});
 const closed=()=>Response.json({code:'phone-unavailable'},{status:503,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 const filterCapabilities=async response=>{
  if(!response.headers.get('content-type')?.includes('application/json'))return response;
  const value=await response.clone().json().catch(()=>null);
  if(!value?.capabilities)return response;
  if(!active.login)value.capabilities.phoneLogin=false;
  if(!active.bind)value.capabilities.phoneBinding=false;
  const headers=new Headers(response.headers);headers.delete('content-length');
  return new Response(JSON.stringify(value),{status:response.status,statusText:response.statusText,headers});
 };
 const flow=async(request,kind,env)=>{
  if(kind==='login'&&!active.login||kind==='bind'&&!active.bind)return closed();
  if(kind==='challenge'){
   try {
    const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedRequestBody(request.clone(),4096)));
    if((payload?.purpose==='login'&&!active.login)||(payload?.purpose==='bind'&&!active.bind))return closed();
   } catch { /* Original flow validates malformed/oversized requests. */ }
  }
  return filterCapabilities(await rawFlow(request,kind,env));
 };
 const gateway=createPhoneGateway({base,enabled:true,provider,flow});
 return {async fetch(request,env,ctx){return filterCapabilities(await gateway.fetch(request,env,ctx));}};
}
