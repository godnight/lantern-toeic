import {localProfile,trustedLocalTls,localViteOptions,assertLocalEnvironment} from './profile.mjs';

// Direct Vite invocation must pass the same strict trust preflight as the runner.
export default async function(){
 const profile=localProfile();
 await assertLocalEnvironment();
 const httpsOptions=await trustedLocalTls();
 return localViteOptions(profile,httpsOptions);
}
