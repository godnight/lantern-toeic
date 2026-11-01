// TEST ONLY: opaque assertions minted through an out-of-band test Worker branch.
// No product route imports this file; no SMS, fixed code or frontend fake flag.
import {randomBytes} from 'node:crypto';
import type {PhoneProviderAssertion,PhoneVerificationProvider} from '../../lib/phone-verification';
export function createTestPhoneIssuer(){
 const assertions=new Map<string,PhoneProviderAssertion>();
 return {
  issue(context:Omit<PhoneProviderAssertion,'proofId'|'issuedAt'|'expiresAt'>&Partial<Pick<PhoneProviderAssertion,'issuedAt'|'expiresAt'>>){
   const token=randomBytes(32).toString('base64url');
   assertions.set(token,{...context,proofId:randomBytes(32).toString('base64url'),issuedAt:context.issuedAt??Date.now(),expiresAt:context.expiresAt??Date.now()+60000});
   return token;
  },
  provider:{async verify(token:string){return assertions.get(token)??null;}} satisfies PhoneVerificationProvider,
 };
}
