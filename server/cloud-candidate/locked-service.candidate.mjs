// Trusted in-process assembly. D1 is always opened under the locked directory.
// This candidate does not apply migrations or enable external providers.
import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { buildAccountWorker } from './build-inputs.mjs';
import { verifyAccountDatabase } from './account-db-preflight.candidate.mjs';
import { openLockedD1 } from './d1-lock.candidate.mjs';
import { prepareCloudService } from './service.candidate.mjs';
import { startProductionGateway } from './https-gateway.candidate.mjs';

export async function startLockedGateway({ enabled = false, lockDir, origin, certRoot, slot, bindAddress, settings = { enabled: false }, privateRoot, key, proxy, phoneKey, modelInfo } = {}) {
  if (enabled !== true) throw Error('locked gateway disabled');
  if (process.platform !== 'linux' || typeof process.geteuid !== 'function' || process.geteuid() === 0 || typeof lockDir !== 'string' || !path.isAbsolute(lockDir)) throw Error('private non-root Linux required');
  for (const dir of [lockDir, path.join(lockDir, 'd1')]) {
    const st = await lstat(dir);
    if (!st.isDirectory() || st.isSymbolicLink() || await realpath(dir) !== dir || st.uid !== process.geteuid() || (st.mode & 0o077) !== 0) throw Error('unsafe database directory');
  }
  let ancestor = path.dirname(lockDir);
  for (;;) { const st = await lstat(ancestor); if (!st.isDirectory() || st.isSymbolicLink() || (st.uid !== 0 && st.uid !== process.geteuid()) || (st.mode & 0o022)) throw Error('unsafe database ancestor'); const next = path.dirname(ancestor); if (next === ancestor) break; ancestor = next; }
  const locked = await openLockedD1({ lockDir, openRuntime: async () => {
    const worker = await buildAccountWorker();
    const mf = new Miniflare({ modules: true, script: worker.bytes.toString(), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], host: '127.0.0.1', port: 0, cf: false,
      d1Databases: ['DB'], d1Persist: path.join(lockDir, 'd1'), outboundService: () => new Response(null, { status: 403 }), bindings: { LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin } });
    return mf;
  },
    prepareService: async mf => { await verifyAccountDatabase(await mf.getD1Database('DB')); return prepareCloudService({ enabled: true, mf, origin, settings, privateRoot, key, proxy, phoneKey, modelInfo }); } });
  let gateway;
  try { gateway = await startProductionGateway({ enabled: true, origin, certRoot, slot, bindAddress, service: locked.service }); }
  catch (error) { await locked.close(); throw error; }
  let closing;
  return Object.freeze({ close() { if (!closing) closing = (async () => { await gateway.close(); await locked.close(); })(); return closing; } });
}
