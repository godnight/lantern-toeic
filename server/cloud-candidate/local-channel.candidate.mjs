// This channel is in-process only. It does not open a socket or load keys.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const selected = ['origin', 'cookie', 'content-type', 'sec-fetch-site', 'x-lantern-session-proof', 'x-lantern-session-policy', 'x-lantern-owner'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const mac = (key, payload) => createHmac('sha256', key).update(JSON.stringify(payload)).digest();
export function signEnvelope(key, type, value) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !['request', 'response'].includes(type)) throw Error('invalid envelope key');
  return mac(key, ['lantern-local-v1', type, value]);
}
export function verifyEnvelope(key, type, value, signature) {
  if (!Buffer.isBuffer(signature) || signature.length !== 32) return false;
  return timingSafeEqual(signEnvelope(key, type, value), signature);
}
export function createRequestEnvelopeVerifier(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('invalid envelope key');
  const seen = new Map();
  return (value, signature, body) => {
    if (!Array.isArray(value) || value.length !== 6 || !Buffer.isBuffer(body)) throw Error('invalid channel request');
    const [, , timestamp, nonce, , bodyHash] = value;
    if (!verifyEnvelope(key, 'request', value, signature) || bodyHash !== digest(body) ||
        !Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 30000 || typeof nonce !== 'string' || !/^[a-f0-9]{32}$/.test(nonce)) throw Error('invalid channel request');
    for (const [id, expires] of seen) if (expires < Date.now()) seen.delete(id);
    if (seen.has(nonce) || seen.size >= 8192) throw Error('channel replay');
    seen.set(nonce, timestamp + 30000);
  };
}
async function bounded(stream, limit) {
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader(), chunks = []; let size = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength;
    if (size > limit) { await reader.cancel(); throw Error('body too large'); } chunks.push(item.value); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function createLocalChannel({ enabled = false, origin, assembly } = {}) {
  if (enabled !== true) throw Error('channel disabled');
  if (!assembly || typeof assembly.fetch !== 'function' || typeof origin !== 'string' || new URL(origin).origin !== origin || !origin.startsWith('https://')) throw Error('invalid channel');
  const key = randomBytes(32), verify = createRequestEnvelopeVerifier(key); let closed = false, active = 0, drained, closing;
  async function receive(value, signature, body) {
    const [method, route, , nonce, headers] = value;
    verify(value, signature, body);
    const response = await assembly.fetch(new Request(origin + route, { method, headers, ...(body.length ? { body } : {}) }));
    const bytes = await bounded(response.body, route.startsWith('/api/study') || route.startsWith('/candidate/sync/') ? 262144 : 16384);
    const cookies = response.headers.getSetCookie(), output = [nonce, response.status, digest(bytes), cookies];
    return { output, signature: signEnvelope(key, 'response', output), bytes };
  }
  return Object.freeze({
    async dispatch(request) {
      if (closed || new URL(request.url).origin !== origin) throw Error('channel unavailable');
      active++;
      try {
        const url = new URL(request.url), headers = {};
        for (const name of selected) { const value = request.headers.get(name); if (value !== null) headers[name] = value; }
        const body = await bounded(request.body, 8192), nonce = randomBytes(16).toString('hex');
        const message = [request.method, url.pathname + url.search, Date.now(), nonce, headers, digest(body)];
        const result = await receive(message, signEnvelope(key, 'request', message), body);
        if (!verifyEnvelope(key, 'response', result.output, result.signature) || result.output[0] !== nonce || result.output[2] !== digest(result.bytes) || !Array.isArray(result.output[3]) || result.output[3].some(cookie => typeof cookie !== 'string')) throw Error('invalid channel response');
        const outputHeaders = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
        for (const cookie of result.output[3]) outputHeaders.append('set-cookie', cookie);
        return new Response(result.bytes, { status: result.output[1], headers: outputHeaders });
      } finally { active--; if (!active && drained) { drained(); drained = undefined; } }
    },
    close() { if (!closing) { closed = true; closing = (async () => { if (active) await new Promise(resolve => { drained = resolve; }); key.fill(0); })(); } return closing; },
  });
}
