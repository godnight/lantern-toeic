// In-process dispatch only. This does not create a listener or Miniflare.
// The sync adapter is created here with the same Miniflare instance as auth.
import { prepareProductionSyncRuntime } from './production-sync-runtime.candidate.mjs';
const syncPaths = new Set(['/candidate/sync/append', '/candidate/sync/snapshot', '/candidate/sync/page', '/api/study']);
export async function prepareAccountSyncAssembly({ mf, origin, settings = { enabled: false }, privateRoot, key, proxy, phoneKey, modelInfo } = {}) {
  if (!mf || typeof mf.dispatchFetch !== 'function' || typeof origin !== 'string' ||
      !origin.startsWith('https://') || new URL(origin).origin !== origin) throw Error('invalid account assembly');
  const sync = settings?.enabled === false && Object.keys(settings).length === 1 ? null :
    await prepareProductionSyncRuntime({ settings, mf, origin, privateRoot, key, proxy, phoneKey, modelInfo });
  return Object.freeze({
    async fetch(request) {
      const url = new URL(request.url);
      if (url.origin !== origin) return new Response(null, { status: 403 });
      if (syncPaths.has(url.pathname)) return sync ? sync.fetch(request) : new Response(null, { status: 404 });
      // Miniflare uses a separate Request implementation, so pass standard
      // primitives and bound the body before crossing that boundary.
      const chunks = [];
      let size = 0;
      if (request.body) {
        const reader = request.body.getReader();
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 8192) { await reader.cancel(); return new Response(null, { status: 413 }); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
      }
      return mf.dispatchFetch(request.url, { method: request.method, headers: Object.fromEntries(request.headers),
        ...(size ? { body: Buffer.concat(chunks) } : {}) });
    },
  });
}
