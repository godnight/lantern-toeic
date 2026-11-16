// Isolated candidate for loading separately protected phone policy and Worker.
// No network, credentials, database or server are started by this module.
import path from 'node:path';
import { readNativeAccountConfig, readRootControlled, validateNativeAccountConfig } from './native-account-config.candidate.mjs';
import { parseProductionPhonePolicy } from './production-phone-preflight.candidate.mjs';
import { verifyPinnedNativePhoneWorker } from './native-phone-verification.candidate.mjs';

const within = (parent, child) => { const p = path.relative(parent, child); return p === '' || (!p.startsWith('..' + path.sep) && p !== '..' && !path.isAbsolute(p)); };

export function validateProtectedNativePhoneConfig(value, accountConfig) {
  const account = validateNativeAccountConfig(accountConfig);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'policy,workerSha256' ||
      typeof value.workerSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.workerSha256)) throw Error('invalid protected phone configuration');
  const policy = parseProductionPhonePolicy(value.policy);
  if (!policy.enabled || policy.origin !== account.origin ||
      policy.referenceKeyFile !== path.join(account.lockDir, 'phone-reference-key')) throw Error('phone policy does not match protected account');
  return Object.freeze({ policy, workerSha256: value.workerSha256 });
}

// Root must independently select/review both files and protect their contents.
// This helper does not establish build provenance, provider access or runtime
// lifecycle; it is not connected to the account gateway.
export async function loadProtectedNativePhoneCandidate({ enabled = false, accountConfigFile, phoneConfigFile } = {}) {
  if (enabled !== true) throw Error('protected phone candidate disabled');
  const account = await readNativeAccountConfig({ enabled: true, file: accountConfigFile });
  if (typeof phoneConfigFile !== 'string' || !path.isAbsolute(phoneConfigFile) || path.resolve(phoneConfigFile) !== phoneConfigFile ||
      path.basename(phoneConfigFile) !== 'phone-config.json') throw Error('invalid protected phone configuration path');
  const phoneRoot = path.dirname(phoneConfigFile);
  const separate = [account.lockDir, account.certRoot, account.workerRoot, path.dirname(accountConfigFile),
    ...(account.huawei ? [path.dirname(account.huawei.secretFile)] : [])];
  if (separate.some(root => within(root, phoneRoot) || within(phoneRoot, root))) throw Error('overlapping protected paths');
  const raw = await readRootControlled(phoneConfigFile, 4096);
  const phone = validateProtectedNativePhoneConfig(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)), account);
  const bytes = await readRootControlled(path.join(account.workerRoot, 'phone-worker.mjs'), 2 * 1024 * 1024);
  const worker = await verifyPinnedNativePhoneWorker({ enabled: true, bytes, sha256: phone.workerSha256, policy: phone.policy });
  return Object.freeze({ account, policy: phone.policy, worker });
}
