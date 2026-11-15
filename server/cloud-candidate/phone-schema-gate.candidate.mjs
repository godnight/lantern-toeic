// NON-PRODUCTION CANDIDATE. Callers must keep schema changes offline while
// requests are enabled and must provide a single, trusted DB/provider pair.
import {createHash} from 'node:crypto';

// Fingerprint of the exact eight sqlite_schema entries created by the reviewed
// 0007_phone_auth.sql and 0008_phone_challenges.sql migration pair.
// The same reviewed SQL with CRLF pairs normalized to LF, nothing else changed.
const EXPECTED='f9a2f9a8034e9daaee26a8813839a9f4923ac7abf56f5580b0c89002edffe1b9';
const QUERY="SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name IN ('auth_phone_bindings','auth_phone_proofs','auth_phone_proofs_expiry','auth_phone_challenges','auth_phone_challenges_expiry','auth_phone_flow_buckets','auth_phone_flow_cooldowns','auth_phone_flow_operations') ORDER BY name";

export function createPhoneSchemaGate({enabled=false,provider,flow}={}) {
 const configured=enabled===true&&provider&&typeof provider.send==='function'&&typeof provider.verify==='function'&&typeof flow==='function';
 return async (request,kind,env)=>{
  let ready=false;
  if(configured&&env?.DB){
   try {
    const rows=await env.DB.prepare(QUERY).all();
    // Project into a predictable key order rather than trusting result object layout.
    const entries=rows.results.map(({type,name,tbl_name,sql})=>({type,name,tbl_name,sql:typeof sql==='string'?sql.replace(/\r\n/g,'\n'):sql}));
    ready=entries.length===8&&createHash('sha256').update(JSON.stringify(entries)).digest('hex')===EXPECTED;
   } catch { ready=false; }
  }
  if(!ready){
   const capabilities={phoneLogin:false,phoneBinding:false};
   return Response.json(kind==='status'?{capabilities}:{code:'phone-unavailable',capabilities},{status:kind==='status'?200:503,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
  }
  return flow(request,kind,env);
 };
}
