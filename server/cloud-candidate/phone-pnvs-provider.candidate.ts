/** Server-only candidate; no product route selects this provider. */
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {PhoneChallengeContext,PhoneChallengeProvider} from '../../lib/phone-challenge-provider';

type Action='SendSmsVerifyCode'|'CheckSmsVerifyCode';
type Fields=Record<string,string|number|boolean>;
export interface PnvsClient { call(action:Action,fields:Readonly<Fields>,signal:AbortSignal):Promise<unknown> }
type Credentials=Readonly<{accessKeyId:string;accessKeySecret:string;securityToken?:string}>;
const host='dypnsapi.aliyuncs.com',version='2017-05-25';
const hex=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const rec=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** ACS3 signature core. Query must already be canonical percent encoded. */
export function signAcs3Request(input:Readonly<{method:string;uri:string;query:string;headers:Readonly<Record<string,string>>;payload:string;secret:string}>):Readonly<{signedHeaders:string;signature:string}> {
 const names=Object.keys(input.headers).sort(),signedHeaders=names.join(';');
 const canonicalHeaders=names.map(name=>name+':'+input.headers[name].trim()+'\n').join('');
 const canonical=[input.method,input.uri,input.query,canonicalHeaders,signedHeaders,hex(input.payload)].join('\n');
 const signature=createHmac('sha256',input.secret).update('ACS3-HMAC-SHA256\n'+hex(canonical),'utf8').digest('hex');
 return {signedHeaders,signature};
}

/** Explicit server-only injection. Fetch is called once, with no automatic retry. */
export function createPnvsHttpClient(credentials:Credentials,fetcher:typeof fetch=fetch):PnvsClient {
 if(!credentials.accessKeyId||!credentials.accessKeySecret||/[\r\n,]/.test(credentials.accessKeyId)||typeof fetcher!=='function')throw new Error('PNVS client configuration unavailable');
 return {async call(action,fields,signal){
  if(signal.aborted)throw new Error('PNVS request aborted');
  const form=new URLSearchParams();for(const key of Object.keys(fields).sort())form.set(key,String(fields[key]));
  const payload=form.toString(),payloadHash=hex(payload);
  const headers:Record<string,string>={'host':host,'x-acs-action':action,'x-acs-content-sha256':payloadHash,'x-acs-date':new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),'x-acs-signature-nonce':randomUUID(),'x-acs-version':version};
  if(credentials.securityToken)headers['x-acs-security-token']=credentials.securityToken;
  const {signedHeaders,signature}=signAcs3Request({method:'POST',uri:'/',query:'',headers,payload,secret:credentials.accessKeySecret});
  const requestHeaders={...headers,'content-type':'application/x-www-form-urlencoded','accept':'application/json','authorization':`ACS3-HMAC-SHA256 Credential=${credentials.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`};
  // No redirects: neither credentials nor verification data may be forwarded
  // to another host. No error text/body is logged or returned to clients.
  const response=await fetcher('https://'+host+'/',{method:'POST',headers:requestHeaders,body:payload,redirect:'error',signal});
  if(!response.ok||!response.body)throw new Error('PNVS response unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>65536){await reader.cancel();throw new Error('PNVS response too large');}chunks.push(item.value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('PNVS response invalid');}
 }};
}

export type PnvsProviderOptions=Readonly<{client:PnvsClient;signature:string;templateCode:string;schemeName:string;referenceKey:string;exclusivePhoneScope:true}>;
/** Requires one consistent DB and an exclusive issuer scheme for this flow. */
export function createPnvsProvider(options:PnvsProviderOptions):PhoneChallengeProvider {
 const {client,signature,templateCode,schemeName,referenceKey,exclusivePhoneScope}=options;
 if(!client||typeof client.call!=='function'||!signature||!templateCode||!schemeName||schemeName.length>20||typeof referenceKey!=='string'||Buffer.byteLength(referenceKey,'utf8')<32||exclusivePhoneScope!==true)throw new Error('PNVS provider configuration unavailable');
 const reference=(context:Readonly<PhoneChallengeContext>)=>createHmac('sha256',referenceKey).update(JSON.stringify([context.challengeId,context.purpose,context.audience,context.phone,context.bindingUserId,context.issuedAt,context.expiresAt]),'utf8').digest('base64url');
 const valid=(context:Readonly<PhoneChallengeContext>)=>/^[A-Za-z0-9_-]{22,128}$/.test(context.challengeId)&&/^\+861[0-9]{10}$/.test(context.phone)&&Number.isSafeInteger(context.issuedAt)&&Number.isSafeInteger(context.expiresAt)&&context.expiresAt>context.issuedAt;
 const result=(v:unknown)=>{const outer=rec(v),model=rec(outer?.Model);if(!outer||outer.Code!=='OK'||outer.Success!==true||!model)throw new Error('PNVS outcome unavailable');return model;};
 return {
  async send(context,key,signal){
   if(!valid(context)||key!==context.challengeId||signal.aborted)throw new Error('Invalid PNVS challenge');
   const model=result(await client.call('SendSmsVerifyCode',{PhoneNumber:context.phone.slice(3),CountryCode:'86',SignName:signature,TemplateCode:templateCode,SchemeName:schemeName,OutId:context.challengeId,TemplateParam:JSON.stringify({code:'##code##',min:'5'}),CodeType:1,CodeLength:6,ValidTime:300,Interval:60,DuplicatePolicy:1,ReturnVerifyCode:false,AutoRetry:0},signal));
   if(model.OutId!==context.challengeId||model.VerifyCode!==undefined)throw new Error('PNVS send outcome unavailable');
   return {status:'sent',providerReference:reference(context),issuedAt:context.issuedAt,expiresAt:context.expiresAt};
  },
  async verify(input,context,signal){
   if(!valid(context)||signal.aborted||input.challengeId!==context.challengeId||!/^[0-9]{6}$/.test(input.code))return null;
   const expected=Buffer.from(reference(context)),actual=Buffer.from(input.providerReference);
   if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;
   const model=result(await client.call('CheckSmsVerifyCode',{PhoneNumber:context.phone.slice(3),CountryCode:'86',SchemeName:schemeName,OutId:context.challengeId,VerifyCode:input.code},signal));
   if(model.OutId!==context.challengeId)throw new Error('PNVS verification outcome unavailable');
   if(model.VerifyResult==='UNKNOWN')return null;
   if(model.VerifyResult!=='PASS')throw new Error('PNVS verification outcome unavailable');
   return {purpose:context.purpose,audience:context.audience,phone:context.phone,bindingUserId:context.bindingUserId,proofId:context.challengeId,issuedAt:context.issuedAt,expiresAt:context.expiresAt};
  },
 };
}
