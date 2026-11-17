import type {PhoneVerificationProvider} from './phone-verification';

/** No production issuer is configured. No environment/request flag selects fake. */
export function productionPhoneVerificationProvider():PhoneVerificationProvider|null {
 return null;
}

import type {PhoneChallengeProvider} from './phone-challenge-provider';
/** No SMS provider, credentials, network endpoint or fake switch is configured. */
export function productionPhoneChallengeProvider():PhoneChallengeProvider|null { return null; }
