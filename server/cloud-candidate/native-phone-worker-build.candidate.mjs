// Offline build/verification candidate only. It neither writes an artifact nor
// loads secrets, opens a listener, reads a database, or starts production.
// The trusted caller must separately protect the artifact and expected digest.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseProductionPhonePolicy, validateLimiterCompatibility } from './production-phone-preflight.candidate.mjs';
export { verifyPinnedNativePhoneWorker } from './native-phone-verification.candidate.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const here = path.join(root, 'server/cloud-candidate');
const limiterPath = path.join(here, 'phone-limiter.candidate.ts');
const budget = config => [config.limits.maxSendsPerUtcDay, config.limits.maxSendsPerMinute, config.limits.maxSendsPerPhoneHour, config.limits.maxVerificationsPerPhoneTenMinutes];

/** Build the fixed repository inputs in memory. This is intended to be run
 * offline by a trusted build owner; no config, key or network is consulted. */
export async function buildNativePhoneWorker({ enabled = false, policy } = {}) {
  if (enabled !== true) throw Error('native phone build disabled');
  const config = parseProductionPhonePolicy(policy);
  if (!config.enabled) throw Error('native phone build disabled');
  const limits = config.limits;
  const limiter = { lifetimeMs: 300000, cooldownMs: 60000, maxAttempts: 5,
    sendPhone: { span: 3600000, max: limits.maxSendsPerPhoneHour }, sendGlobal: { span: 60000, max: limits.maxSendsPerMinute },
    sendGlobalDaily: { span: 86400000, max: limits.maxSendsPerUtcDay }, verifyPhone: { span: 600000, max: limits.maxVerificationsPerPhoneTenMinutes },
    verifyGlobal: { span: 60000, max: 100 } };
  validateLimiterCompatibility(config, limiter);
  const source = `export const LANTERN_PHONE_BUILD_BUDGET=Object.freeze(${JSON.stringify(budget(config))});
import base from './server/cloud-candidate/auth-worker.ts';
import {createPhoneCloudCandidate} from './server/cloud-candidate/phone-cloud-composition.candidate.mjs';
export default {fetch(request,env,ctx) {
 const config=env.LANTERN_PHONE_CONFIG, service=env.LANTERN_PNVS_RPC;
 if (!config || !service || typeof service.fetch !== 'function') return new Response(null,{status:503});
 const app=createPhoneCloudCandidate({base,enabled:true,getCredentials:async()=>({ready:true}),
  makeClient:()=>({async call(action,fields,signal){
   const r=await service.fetch('https://lantern-pnvs.internal/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,fields}),signal});
   if(!r.ok)throw Error('provider unavailable');return r.json();
  }}),...config});
 return app.fetch(request,env,ctx);
}};`;
  const result = await build({ absWorkingDir: root, stdin: { contents: source, resolveDir: root, loader: 'ts' }, bundle: true, write: false,
    format: 'esm', platform: 'neutral', target: 'es2022', external: ['node:*', 'cloudflare:workers'],
    plugins: [{ name: 'fixed-phone-budget', setup(b) { b.onLoad({ filter: /phone-limiter\.candidate\.ts$/ }, async args => {
      if (path.resolve(args.path) !== limiterPath) throw Error('unexpected limiter source');
      const contents = await readFile(limiterPath, 'utf8');
      const pattern = /^export const PHONE_FLOW_POLICY=Object\.freeze\([^\r\n]+\);$/gm;
      if ((contents.match(pattern) ?? []).length !== 1) throw Error('limiter source changed');
      return { contents: contents.replace(pattern, `export const PHONE_FLOW_POLICY=Object.freeze(${JSON.stringify(limiter)});`), loader: 'ts', resolveDir: here };
    }); } }] });
  const bytes = Buffer.from(result.outputFiles[0].contents), sha256 = createHash('sha256').update(bytes).digest('hex');
  return Object.freeze({ bytes, sha256, budget: Object.freeze(budget(config)) });
}

