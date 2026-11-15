// Controlled, disabled-by-default composition for exercising the real phone
// Worker against an existing SQLite D1 adapter. No listener, migrations,
// credentials or production startup are provided by this module. It must not
// be used as a deployment entry point.
import { parseProductionPhonePolicy } from './production-phone-preflight.candidate.mjs';
import { buildNativePhoneWorker, verifyPinnedNativePhoneWorker } from './native-phone-worker-build.candidate.mjs';
import { verifyPhoneDatabase, createPhoneServiceBinding } from './phone-runtime.candidate.mjs';
import { verifyAccountDatabase } from './account-db-preflight.candidate.mjs';
import { createNativeHuaweiOutbound } from './native-huawei-outbound.candidate.mjs';

/** The owner must supply an exclusive, previously opened DB and trusted server
 * callback. This provides no credential lookup and does not enable live SMS.
 * A real entry point still needs protected config, key custody, DB lifecycle,
 * private provider transport and deployment review. */
export async function prepareNativePhoneCandidate({ enabled = false, db, policy, accountOrigin, referenceKey, pnvsCall, huawei } = {}) {
  if (enabled !== true) return Object.freeze({ enabled: false });
  const config = parseProductionPhonePolicy(policy);
  if (!config.enabled || config.origin !== accountOrigin || !db || typeof db.prepare !== 'function' ||
      !Buffer.isBuffer(referenceKey) || referenceKey.length !== 32 || typeof pnvsCall !== 'function') throw Error('incomplete native phone candidate');
  // The caller must obtain these values from protected server-only sources.
  // Never spread arbitrary environment bindings or default to global fetch.
  let huaweiBindings = {};
  if (huawei !== undefined) {
    if (!huawei || typeof huawei !== 'object' || Array.isArray(huawei) ||
        Object.keys(huawei).sort().join(',') !== 'clientId,clientSecret,fetchImpl' ||
        typeof huawei.clientId !== 'string' || !/^\d{1,64}$/.test(huawei.clientId) ||
        typeof huawei.clientSecret !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(huawei.clientSecret) ||
        typeof huawei.fetchImpl !== 'function') throw Error('invalid Huawei candidate configuration');
    huaweiBindings = { LANTERN_HUAWEI_CLIENT_ID: huawei.clientId, LANTERN_HUAWEI_CLIENT_SECRET: huawei.clientSecret,
      LANTERN_HUAWEI_OUTBOUND: createNativeHuaweiOutbound({ enabled: true, clientId: huawei.clientId, fetchImpl: huawei.fetchImpl }) };
  }
  // Both checks inspect the actual database used by every subsequent request.
  await verifyAccountDatabase(db);
  await verifyPhoneDatabase({ mf: { async getD1Database(name) { if (name !== 'DB') throw Error('unknown database'); return db; } }, policy: config });
  const artifact = await buildNativePhoneWorker({ enabled: true, policy: config });
  const { sha256 } = artifact;
  const worker = await verifyPinnedNativePhoneWorker({ enabled: true, bytes: artifact.bytes, sha256, policy: config });
  if (!worker || typeof worker.fetch !== 'function') throw Error('invalid phone worker');
  const binding = createPhoneServiceBinding({ policy: config, pnvsCall });
  const phoneConfig = Object.freeze({ signature: config.signature, templates: config.templates, schemeName: config.schemeName,
    referenceKey: referenceKey.toString('hex'), audience: config.origin + '/phone' });
  const env = Object.freeze({ DB: db, LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: config.origin,
    ...huaweiBindings, LANTERN_PHONE_CONFIG: phoneConfig, LANTERN_PNVS_RPC: Object.freeze({ fetch(url, init) { return binding(new Request(url, init)); } }) });
  return Object.freeze({ enabled: true, sha256, fetch(request) { return worker.fetch(request, env); } });
}
