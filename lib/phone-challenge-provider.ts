import type {PhoneProviderAssertion,PhoneProviderExpectation} from './phone-verification';

export interface PhoneChallengeContext extends PhoneProviderExpectation {
 readonly challengeId:string;
 readonly issuedAt:number;
 readonly expiresAt:number;
}
export type PhoneSendReceipt=Readonly<{status:'sent';providerReference:string;issuedAt:number;expiresAt:number}>|Readonly<{status:'rejected'}>;
/** Operator-owned server adapter, never selected by requests or environment flags.
 * send must use the random challengeId as its provider idempotency key, bind the
 * entire context and code, and only report sent after a real issuer receipt.
 * verify must bind reference+challenge+purpose+audience+phone+user; proofId is
 * stable for that challenge, never regenerated for a retry. Adapters must forward AbortSignal to real I/O; abort/timeout is ambiguous,
 * not proof of provider rollback and must never trigger an automatic resend.
 * Codes are neither
 * returned nor stored by this product. Provider/network ambiguity throws.
 */
export interface PhoneChallengeProvider {
 send(context:Readonly<PhoneChallengeContext>,idempotencyKey:string,signal:AbortSignal):Promise<PhoneSendReceipt>;
 verify(input:Readonly<{providerReference:string;challengeId:string;code:string}>,expected:Readonly<PhoneChallengeContext>,signal:AbortSignal):Promise<PhoneProviderAssertion|null>;
}
