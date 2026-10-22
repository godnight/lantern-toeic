import {authConfiguration,authJson,readProductIdentity,sameOriginMutation,createProductSessionMaterial,productSessionResponse,productSessionTokenHash,type AuthEnvironment} from './auth-service';
import {readBoundedRequestBody,RequestBodyTooLargeError} from './request-body';
import {parseMainlandPhone} from './phone-number';
import {createPhoneVerificationBoundary} from './phone-verification';
import {createPhoneD1Store} from './phone-d1-store';
import {productionPhoneChallengeProvider} from './phone-provider';
import type {PhoneChallengeProvider,PhoneSendReceipt} from './phone-challenge-provider';
import {createPhoneChallengeStore,toChallengeContext,PhoneFlowError,type ChallengeRow,type FlowContext} from './phone-challenge-store';
export type PhoneFlowOptions=Readonly<{provider:PhoneChallengeProvider|null;providerId:string;audience:string}>;
export type PhoneFlowAction='status'|'challenge'|'bind'|'login';
const fullCapabilities={passwordLogin:true,phoneLogin:true,phoneBinding:true,passwordRecovery:false};
const iso=(ms:number)=>new Date(ms).toISOString();
function unavailable(passwordLogin:boolean,unknown=false){return authJson({code:unknown?'phone-state-unknown':'phone-unavailable',capabilities:{passwordLogin,phoneLogin:false,phoneBinding:false,passwordRecovery:false}},503);}
/** Bounds trusted adapter latency. Late provider completion cannot resume this flow. */
async function providerDeadline<T>(start:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([start(controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Provider deadline'));},10000);})]);}
 finally{if(timer!==undefined)clearTimeout(timer);}
}
async function body(request:Request):Promise<Record<string,unknown>>{
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new PhoneFlowError('invalid-phone-request',400);
 try{const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedRequestBody(request,4096)));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('object required');return value as Record<string,unknown>;}
 catch(error){if(error instanceof RequestBodyTooLargeError)throw new PhoneFlowError('invalid-phone-request',413);throw new PhoneFlowError('invalid-phone-request',400);}
}
function receipt(value:PhoneSendReceipt,row:ChallengeRow):value is Extract<PhoneSendReceipt,{status:'sent'}>{
 return value?.status==='sent'&&typeof value.providerReference==='string'&&/^[\x21-\x7e]{1,512}$/.test(value.providerReference)
  &&Number.isSafeInteger(value.issuedAt)&&Number.isSafeInteger(value.expiresAt)&&value.issuedAt>=row.issued_at-5000&&value.issuedAt<=Date.now()+5000
  &&value.expiresAt>value.issuedAt&&value.expiresAt<=row.expires_at&&value.expiresAt>=row.resend_at;
}
/** Trusted server injection only. Product routes call the hard-null factory below. */
export function createPhoneFlowService(options:PhoneFlowOptions){
 const adapter=options.provider,configured=Boolean(adapter&&typeof adapter.send==='function'&&typeof adapter.verify==='function'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.providerId)&&/^[\x21-\x7e]{1,256}$/.test(options.audience));
 return async function action(request:Request,kind:PhoneFlowAction,env:AuthEnvironment):Promise<Response>{
  const config=authConfiguration(env),available=Boolean(config&&configured);
  if(kind==='status')return authJson({capabilities:{phoneLogin:available,phoneBinding:available}});
  // Before parsing body, reading identity/DB or consuming limits. Caller/env flags
  // cannot configure a provider, and a closed product never reports a fake send.
  if(!config||!available||!adapter)return unavailable(Boolean(config));
  if(!sameOriginMutation(request,config.origin))return authJson({code:'invalid-origin'},403);
  try{
   const input=await body(request),keys=Object.keys(input).sort().join(',');
   if(kind==='challenge'?keys!=='phone,purpose':keys!=='challengeId,code,phone')throw new PhoneFlowError('invalid-phone-request',400);
   const purpose=kind==='challenge'?input.purpose:kind;
   if(purpose!=='bind'&&purpose!=='login')throw new PhoneFlowError('invalid-phone-request',400);
   const parsed=parseMainlandPhone(input.phone);if(!parsed.ok)throw new PhoneFlowError('invalid-phone-request',400);
   if(kind!=='challenge'&&(typeof input.challengeId!=='string'||!/^[A-Za-z0-9_-]{22,128}$/.test(input.challengeId)||typeof input.code!=='string'||!/^[0-9]{6}$/.test(input.code)))throw new PhoneFlowError('invalid-phone-request',400);
   const bindingUser=purpose==='bind'?await readProductIdentity(request.headers,env):null;
   if(purpose==='bind'&&!bindingUser)throw new PhoneFlowError('unauthenticated',401);
   const bindingTokenHash=productSessionTokenHash(request.headers);
   const context:FlowContext={db:config.db,purpose,phone:parsed.phone,audience:options.audience,providerId:options.providerId,bindingUser,bindingTokenHash};
   const challenges=createPhoneChallengeStore(context);
   if(kind==='challenge'){
    const row=await challenges.reserveSend();let sent:PhoneSendReceipt;
    try{sent=await providerDeadline(signal=>adapter.send(toChallengeContext(row),row.challenge_id,signal));}
    catch{await challenges.quarantine(row,'unknown');return unavailable(true,true);}
    if(sent?.status==='rejected'){await challenges.quarantine(row,'failed');return unavailable(true);}
    if(!receipt(sent,row)){await challenges.quarantine(row,'unknown');return unavailable(true,true);}
    const confirmed=await challenges.markSent(row,sent.providerReference,sent.issuedAt,sent.expiresAt);
    return authJson({challengeId:confirmed.challenge_id,expiresAt:iso(confirmed.expires_at),resendAt:iso(confirmed.resend_at),purpose:confirmed.purpose,phone:confirmed.phone},202);
   }
   const {row,ticket}=await challenges.claimVerification(input.challengeId as string);
   let assertion;
   try{assertion=await providerDeadline(signal=>adapter.verify({providerReference:row.provider_reference!,challengeId:row.challenge_id,code:input.code as string},toChallengeContext(row),signal));}
   catch{await challenges.quarantine(row,'unknown',ticket);return unavailable(true,true);}
   if(!assertion){const attemptsRemaining=await challenges.rejectCode(row,ticket);return authJson({code:'phone-invalid-code',attemptsRemaining},400);}
   const session=createProductSessionMaterial(request.headers),store=createPhoneD1Store({...context,session,challenge:{id:row.challenge_id,verificationTicket:ticket}});
   const boundary=createPhoneVerificationBoundary({provider:{verify:async()=>assertion},providerId:options.providerId,audience:options.audience,store});
   const verified=await boundary.verifyAndCommit(purpose==='bind'?{purpose,phone:parsed.phone,bindingUserId:bindingUser!.id}:{purpose,phone:parsed.phone},'server-verified-challenge');
   if(!verified.ok){
    if(verified.error==='invalid-proof'||verified.error==='invalid-request'){
     const attemptsRemaining=await challenges.rejectCode(row,ticket);return authJson({code:'phone-invalid-code',attemptsRemaining},400);
    }
    await challenges.quarantine(row,verified.error==='unavailable'?'unknown':'failed',ticket);
    if(verified.error==='unavailable')return unavailable(true,true);
    const status=verified.error==='unauthorized'?401:verified.error==='replayed'||verified.error==='binding-conflict'?409:400;
    return authJson({code:verified.error==='unauthorized'?'unauthenticated':'phone-'+verified.error},status);
   }
   const user=store.committedIdentity();if(!user||user.id!==verified.userId)return unavailable(true,true);
   if(purpose==='bind')return authJson({ok:true,user,phone:parsed.phone,capabilities:fullCapabilities});
   const response=productSessionResponse(user,session.token);
   const reply=authJson({user,capabilities:fullCapabilities});reply.headers.set('Set-Cookie',response.headers.get('set-cookie')!);return reply;
  }catch(error){
   if(error instanceof PhoneFlowError)return authJson({code:error.code,...(error.retryAt===undefined?{}:{retryAt:iso(error.retryAt)}),...(error.attemptsRemaining===undefined?{}:{attemptsRemaining:error.attemptsRemaining})},error.status);
   return unavailable(true,true);
  }
 };
}
export function phoneFlowAction(request:Request,kind:PhoneFlowAction,env:AuthEnvironment):Promise<Response>{
 return createPhoneFlowService({provider:productionPhoneChallengeProvider(),providerId:'production-unconfigured',audience:'lantern-phone-auth-v2'})(request,kind,env);
}
