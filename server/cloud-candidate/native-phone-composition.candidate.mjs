// Controlled, disabled-by-default composition for exercising the real phone
// Worker against an existing SQLite D1 adapter. No listener, migrations,
// credentials or production startup are provided by this module. It must not
// be used as a deployment entry point.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseProductionPhonePolicy, validateLimiterCompatibility } from './production-phone-preflight.candidate.mjs';
import { verifyPhoneDatabase, createPhoneServiceBinding } from './phone-runtime.candidate.mjs';
import { verifyAccountDatabase } from './account-db-preflight.candidate.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const here = path.join(root, 'server/cloud-candidate');
const limiterPath = path.join(here, 'phone-limiter.candidate.ts');

/** The owner must supply an exclusive, previously opened DB and trusted server
 * callback. This provides no credential lookup and does not enable live SMS.
 * A real entry point still needs protected config, key custody, DB lifecycle,
 * private provider transport and deployment review. */
export async function prepareNativePhoneCandidate({ enabled = false, db, policy, accountOrigin, referenceKey, pnvsCall } = {}) {
  if (enabled !== true) return Object.freeze({ enabled: false });
  const config = parseProductionPhonePolicy(policy);
  if (!config.enabled || config.origin !== accountOrigin || !db || typeof db.prepare !== 'function' ||
      !Buffer.isBuffer(referenceKey) || referenceKey.length !== 32 || typeof pnvsCall !== 'function') throw Error('incomplete native phone candidate');
  // Both checks inspect the actual database used by every subsequent request.
  await verifyAccountDatabase(db);
  await verifyPhoneDatabase({ mf: { async getD1Database(name) { if (name !== 'DB') throw Error('unknown database'); return db; } }, policy: config });
  const limits = config.limits;
  const limiter = { lifetimeMs: 300000, cooldownMs: 60000, maxAttempts: 5,
    sendPhone: { span: 3600000, max: limits.maxSendsPerPhoneHour }, sendGlobal: { span: 60000, max: limits.maxSendsPerMinute },
    sendGlobalDaily: { span: 86400000, max: limits.maxSendsPerUtcDay }, verifyPhone: { span: 600000, max: limits.maxVerificationsPerPhoneTenMinutes },
    verifyGlobal: { span: 60000, max: 100 } };
  validateLimiterCompatibility(config, limiter);
  const source = `import base from './server/cloud-candidate/auth-worker.ts';
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
  const worker = (await import('data:text/javascript;base64,' + bytes.toString('base64'))).default;
  if (!worker || typeof worker.fetch !== 'function') throw Error('invalid phone worker');
  const binding = createPhoneServiceBinding({ policy: config, pnvsCall });
  const phoneConfig = Object.freeze({ signature: config.signature, templates: config.templates, schemeName: config.schemeName,
    referenceKey: referenceKey.toString('hex'), audience: config.origin + '/phone' });
  const env = Object.freeze({ DB: db, LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: config.origin,
    LANTERN_PHONE_CONFIG: phoneConfig, LANTERN_PNVS_RPC: Object.freeze({ fetch(url, init) { return binding(new Request(url, init)); } }) });
  return Object.freeze({ enabled: true, sha256, fetch(request) { return worker.fetch(request, env); } });
}
