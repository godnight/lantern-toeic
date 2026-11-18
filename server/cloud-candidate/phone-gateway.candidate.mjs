// Isolation candidate only. A production runtime must explicitly provide an
// audited provider, stable origin/audience, migration policy and backup plan.
import { createPhoneSchemaGate } from './phone-schema-gate.candidate.mjs';

const routes = Object.freeze({
  '/api/auth/phone/status': ['GET', 'status'],
  '/api/auth/phone/challenge': ['POST', 'challenge'],
  '/api/auth/phone/login': ['POST', 'login'],
  '/api/auth/phone/bind': ['POST', 'bind'],
});

export function createPhoneGateway({ base, enabled = false, provider, flow } = {}) {
  if (!base || typeof base.fetch !== 'function') throw new TypeError('base auth worker required');
  const guarded = createPhoneSchemaGate({ enabled, provider, flow });
  return {
    async fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      const route = routes[path];
      if (!route) {
        const original = await base.fetch(request, env, ctx);
        if (path !== '/api/auth/session' || request.method !== 'GET' || original.status !== 200) return original;
        // Preserve the complete original session response unless the same
        // gate used for real phone operations reports the service ready.
        try {
          const readiness = await guarded(request, 'status', env);
          const status = await readiness.json();
          if (status?.capabilities?.phoneLogin !== true) return original;
          const json = await original.clone().json();
          if (!json?.capabilities || typeof json.capabilities.phoneLogin !== 'boolean') return original;
          json.capabilities.phoneLogin = true;
          const headers = new Headers(original.headers);
          headers.delete('content-length');
          return new Response(JSON.stringify(json), { status: original.status, statusText: original.statusText, headers });
        } catch { return original; }
      }
      const [method, action] = route;
      if (request.method !== method) {
        return Response.json({ code: 'method-not-allowed' }, {
          status: 405,
          headers: { Allow: method, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
        });
      }
      return guarded(request, action, env);
    },
  };
}
