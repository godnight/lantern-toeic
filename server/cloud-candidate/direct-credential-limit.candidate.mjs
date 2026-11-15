// Optional protection for one directly exposed ECS HTTPS process. Never use
// forwarded headers or this policy behind an HTTP/TCP proxy: in that case the
// peer is the proxy, not the client. State is deliberately local to a process.
import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

// Must match auth-service's fixed-window credential budgets (100 / 20).
export const DIRECT_CREDENTIAL_WINDOW_MS = 15 * 60 * 1000;

export function validateDirectCredentialPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'credentialsPerWindow,maxSources,mode,registrationsPerWindow' ||
      value.mode !== 'direct' || !Number.isSafeInteger(value.credentialsPerWindow) || value.credentialsPerWindow < 1 || value.credentialsPerWindow >= 100 ||
      !Number.isSafeInteger(value.registrationsPerWindow) || value.registrationsPerWindow < 1 || value.registrationsPerWindow >= 20 ||
      value.registrationsPerWindow > value.credentialsPerWindow || !Number.isSafeInteger(value.maxSources) || value.maxSources < 1 || value.maxSources > 16384) {
    throw Error('invalid direct credential policy');
  }
  return Object.freeze({ ...value });
}

// Kernel-provided addresses only. IPv4-mapped IPv6 aliases share the IPv4
// budget; IPv6 hosts share a /64 to reduce privacy-address rotation bypass.
export function directSourceGroup(address) {
  if (typeof address !== 'string' || address.length > 64 || address.includes('%')) return null;
  const family = isIP(address);
  if (family === 4) return 'v4:' + address;
  if (family !== 6) return null;
  let literal;
  try { literal = new URL('http://[' + address + ']/').hostname.slice(1, -1); } catch { return null; }
  const split = literal.split('::');
  if (split.length > 2) return null;
  const left = split[0] ? split[0].split(':') : [];
  const right = split[1] ? split[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (split.length === 1 && missing !== 0) || (split.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right].map(x => parseInt(x, 16));
  if (words.length !== 8 || words.some(x => !Number.isInteger(x) || x < 0 || x > 65535)) return null;
  if (words.slice(0, 5).every(x => x === 0) && words[5] === 65535) {
    return 'v4:' + [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.');
  }
  return 'v6/64:' + words.slice(0, 4).map(x => x.toString(16).padStart(4, '0')).join(':');
}

export function createDirectCredentialLimiter(policy, { now = Date.now } = {}) {
  const settings = validateDirectCredentialPolicy(policy);
  if (typeof now !== 'function') throw Error('invalid clock');
  const key = randomBytes(32), sources = new Map();
  let highWindow = null;
  return Object.freeze({
    reserve(address, action) {
      if (!['login', 'register'].includes(action)) throw Error('invalid credential action');
      const group = directSourceGroup(address), time = now();
      if (!group || !Number.isSafeInteger(time) || time < 0) return { allowed: false, retryAfter: 1 };
      const window = Math.floor(time / DIRECT_CREDENTIAL_WINDOW_MS) * DIRECT_CREDENTIAL_WINDOW_MS;
      // Backward wall-clock changes never reset budgets or reopen a full map.
      if (highWindow === null || window > highWindow) { sources.clear(); highWindow = window; }
      const retryAfter = Math.max(1, Math.min(900, Math.ceil((highWindow + DIRECT_CREDENTIAL_WINDOW_MS - time) / 1000)));
      const fingerprint = createHmac('sha256', key).update(group).digest('hex');
      let entry = sources.get(fingerprint);
      // Never evict a live entry when full: eviction lets a changing source
      // reset another source's limits. New sources fail closed until rollover.
      if (!entry) {
        if (sources.size >= settings.maxSources) return { allowed: false, retryAfter };
        entry = { credentials: 0, registrations: 0 };
        sources.set(fingerprint, entry);
      }
      if (entry.credentials >= settings.credentialsPerWindow ||
          (action === 'register' && entry.registrations >= settings.registrationsPerWindow)) return { allowed: false, retryAfter };
      entry.credentials++;
      if (action === 'register') entry.registrations++;
      let refunded = false;
      return { allowed: true, refundBusy() {
        if (refunded) return;
        refunded = true;
        // Late responses cannot credit a newer window or another entry.
        if (sources.get(fingerprint) !== entry) return;
        entry.credentials--;
        if (action === 'register') entry.registrations--;
        // A source with no spent or pending attempts has no live quota to
        // protect; freeing it prevents bursts of busy responses filling the map.
        if (entry.credentials === 0 && entry.registrations === 0) sources.delete(fingerprint);
      } };
    },
  });
}
