import {randomInt,randomBytes} from 'node:crypto';
import type {PhoneChallengeContext,PhoneChallengeProvider} from '../../lib/phone-challenge-provider';
import type {PhoneProviderAssertion} from '../../lib/phone-verification';
/** Test-only OOB issuer. Product modules must never import this file. */
export function createTestPhoneChallengeProvider(){
 type Entry={context:PhoneChallengeContext;reference:string;code:string;proofId:string};
 const entries=new Map<string,Entry>();let sendMode='ok',verifyMode='ok',sendCalls=0,verifyCalls=0,delayMs=0,abortCount=0;
 const wait=()=>new Promise<void>(resolve=>setTimeout(resolve,delayMs));
 const provider:PhoneChallengeProvider={
  async send(context,key,signal){
   signal.addEventListener('abort',()=>abortCount++,{once:true});if(sendMode==='hung')await new Promise(()=>{});if(sendMode==='late')await new Promise(resolve=>setTimeout(resolve,10050));
   sendCalls++;await wait();if(sendMode==='reject')return {status:'rejected'};
   if(key!==context.challengeId)throw new Error('Test requires exact idempotency key');
   let entry=entries.get(key);
   if(entry&&JSON.stringify(entry.context)!==JSON.stringify(context))throw new Error('Test idempotency context conflict');
   if(!entry){entry={context:{...context},reference:randomBytes(24).toString('base64url'),code:String(randomInt(1000000)).padStart(6,'0'),proofId:randomBytes(24).toString('base64url')};entries.set(key,entry);}
   if(sendMode==='unknown')throw new Error('Synthetic ambiguous send after issuer accepted');
   return {status:'sent',providerReference:entry.reference,issuedAt:context.issuedAt,expiresAt:context.expiresAt};
  },
  async verify(input,expected,signal){
   signal.addEventListener('abort',()=>abortCount++,{once:true});if(verifyMode==='hung')await new Promise(()=>{});if(verifyMode==='late')await new Promise(resolve=>setTimeout(resolve,10050));
   verifyCalls++;await wait();if(verifyMode==='unknown')throw new Error('Synthetic ambiguous verification');
   const e=entries.get(input.challengeId);
   if(!e||input.providerReference!==e.reference||input.code!==e.code||JSON.stringify(e.context)!==JSON.stringify(expected))return null;
   const result:PhoneProviderAssertion={purpose:expected.purpose,audience:expected.audience,phone:expected.phone,bindingUserId:expected.bindingUserId,proofId:e.proofId,issuedAt:expected.issuedAt,expiresAt:expected.expiresAt};
   if(verifyMode==='wrong-purpose')return {...result,purpose:expected.purpose==='bind'?'login':'bind'};
   if(verifyMode==='wrong-audience')return {...result,audience:'wrong'};
   return result;
  },
 };
 return {provider,read(id:string){const e=entries.get(id);return e?{code:e.code,...e.context}:null;},configure(value:{send?:string;verify?:string;delayMs?:number}){sendMode=value.send??'ok';verifyMode=value.verify??'ok';delayMs=value.delayMs??0;},stats(){return {sendCalls,verifyCalls,issued:entries.size,abortCount};}};
}
