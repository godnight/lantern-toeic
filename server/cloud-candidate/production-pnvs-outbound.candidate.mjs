// Review-only: does not select a network client or open sockets on import.
// The injected fetch must be the trusted runtime's TLS-verifying transport.
const endpoint='https://dypnsapi.aliyuncs.com/';
const actions=new Set(['SendSmsVerifyCode','CheckSmsVerifyCode']);
const signedHeaders=['host','authorization','content-type','accept','x-acs-action','x-acs-content-sha256','x-acs-date','x-acs-signature-nonce','x-acs-version','x-acs-security-token'];
async function readBounded(stream,max){
 if(!stream)return Buffer.alloc(0);const reader=stream.getReader(),parts=[];let size=0;
 try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>max){await reader.cancel();throw Error('size');}parts.push(item.value);}}
 finally{reader.releaseLock();}return Buffer.concat(parts);
}
export function createRestrictedPnvsOutbound({enabled=false,fetchImpl}={}){
 if(enabled!==true||typeof fetchImpl!=='function')throw Error('PNVS outbound disabled');
 return async request=>{
  const action=request.headers.get('x-acs-action');
  if(request.method!=='POST'||request.url!==endpoint||!actions.has(action)||request.headers.get('host')!=='dypnsapi.aliyuncs.com'||
    request.headers.get('content-type')!=='application/x-www-form-urlencoded'||!request.headers.get('authorization')?.startsWith('ACS3-HMAC-SHA256 ')||
    !request.headers.get('x-acs-security-token')||!request.headers.get('x-acs-signature-nonce')||!request.headers.get('x-acs-date')||
    request.headers.get('x-acs-version')!=='2017-05-25'||!request.headers.get('x-acs-content-sha256'))return new Response(null,{status:403});
  try{
   const body=await readBounded(request.body,8192),headers={};for(const name of signedHeaders){const value=request.headers.get(name);if(value!==null)headers[name]=value;}
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(12000)]);
   const result=await fetchImpl(endpoint,{method:'POST',headers,body,redirect:'manual',signal});
   if(result.status>=300&&result.status<400)return new Response(null,{status:502});
   const bytes=await readBounded(result.body,65536);
   return new Response(bytes,{status:result.status,headers:{'content-type':'application/json'}});
  }catch{return new Response(null,{status:502});}
 };
}
