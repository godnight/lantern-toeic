// Creates an HTTP handler only; the caller controls the HTTPS listener.
import { validDomainOrigin } from './domain-policy.candidate.mjs';
const fixed = new Map([
  ['/health', 'GET'], ['/api/auth/register', 'POST'], ['/api/auth/login', 'POST'],
  ['/api/auth/session', 'GET'], ['/api/auth/logout', 'POST'], ['/api/auth/providers', 'GET'],
  ['/api/auth/huawei/login', 'POST'], ['/api/auth/huawei/bind', 'POST'],
]);
const phone = new Map([['/api/auth/phone/status', 'GET'], ['/api/auth/phone/challenge', 'POST'], ['/api/auth/phone/login', 'POST'], ['/api/auth/phone/bind', 'POST']]);
const sync = new Map([['/candidate/sync/append', 'POST'], ['/candidate/sync/snapshot', 'POST'], ['/candidate/sync/page', 'POST']]);
const singletons = new Set(['host', 'origin', 'cookie', 'content-type', 'content-length', 'transfer-encoding', 'sec-fetch-site', 'x-lantern-session-proof', 'x-lantern-owner']);
const pass = ['origin', 'cookie', 'content-type', 'sec-fetch-site', 'x-lantern-session-proof', 'x-lantern-owner'];
const fail = (res, status) => { if (res.headersSent) return res.destroy(); res.writeHead(status, { 'cache-control': 'no-store', 'connection': 'close' }); res.end(); };

export function createHttpsHandler({ origin, channel, phoneEnabled = false, syncEnabled = false } = {}) {
  if (!validDomainOrigin(origin) || !channel || typeof channel.dispatch !== 'function' || typeof phoneEnabled !== 'boolean' || typeof syncEnabled !== 'boolean') throw Error('invalid gateway configuration');
  const host = new URL(origin).host;
  return async function handler(req, res) {
    try {
      const seen = new Set();
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i].toLowerCase();
        if ((singletons.has(name) && seen.has(name)) || name.startsWith('x-lantern-proxy-') || name === 'forwarded' || name.startsWith('x-forwarded-') || name === 'x-real-ip') return fail(res, 400);
        seen.add(name);
      }
      if (req.headers.host !== host || req.socket.servername !== host) return fail(res, 403);
      const url = new URL(req.url, origin);
      if (url.origin !== origin || !req.url.startsWith('/') || req.url.startsWith('//')) return fail(res, 404);
      const expected = fixed.get(url.pathname) || (phoneEnabled && phone.get(url.pathname)) ||
        (syncEnabled && (sync.get(url.pathname) || (url.pathname === '/api/study' && (req.method === 'GET' || req.method === 'POST') ? req.method : false)));
      if (!expected || req.method !== expected || (url.search && !(syncEnabled && url.pathname === '/api/study' && req.method === 'GET'))) return fail(res, 404);
      if ((req.headers.origin && req.headers.origin !== origin) || (req.method === 'POST' && req.headers.origin !== origin) || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return fail(res, 403);
      const parts = []; let size = 0;
      for await (const part of req) { size += part.length; if (size > 8192) return fail(res, 413); parts.push(part); }
      const headers = {}; for (const name of pass) if (req.headers[name]) headers[name] = req.headers[name];
      const body = Buffer.concat(parts), request = new Request(origin + url.pathname + url.search, { method: req.method, headers, ...(body.length ? { body } : {}) });
      const reply = await channel.dispatch(request), bytes = Buffer.from(await reply.arrayBuffer());
      const output = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
      const cookies = reply.headers.getSetCookie(); if (cookies.length) output['set-cookie'] = cookies;
      res.writeHead(reply.status, output); res.end(bytes);
    } catch { fail(res, 503); }
  };
}
