// Runtime verification does not import the offline builder or esbuild.
import { createHash } from 'node:crypto';
import { parseProductionPhonePolicy } from './production-phone-preflight.candidate.mjs';

export async function verifyPinnedNativePhoneWorker({ enabled = false, bytes, sha256, policy } = {}) {
  if (enabled !== true || !Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 2 * 1024 * 1024 ||
      typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw Error('invalid pinned phone artifact');
  const config = parseProductionPhonePolicy(policy);
  if (!config.enabled || createHash('sha256').update(bytes).digest('hex') !== sha256) throw Error('phone artifact digest mismatch');
  const module = await import('data:text/javascript;base64,' + bytes.toString('base64'));
  const limits = config.limits;
  const expected = [limits.maxSendsPerUtcDay, limits.maxSendsPerMinute, limits.maxSendsPerPhoneHour, limits.maxVerificationsPerPhoneTenMinutes];
  if (!module.default || typeof module.default.fetch !== 'function' || !Array.isArray(module.LANTERN_PHONE_BUILD_BUDGET) ||
      JSON.stringify(module.LANTERN_PHONE_BUILD_BUDGET) !== JSON.stringify(expected)) throw Error('phone artifact budget mismatch');
  return module.default;
}
