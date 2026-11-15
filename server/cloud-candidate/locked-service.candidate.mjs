// Trusted in-process assembly. D1 is always opened under the locked directory.
// This candidate does not apply migrations or enable external providers.
import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { buildAccountWorker } from './build-inputs.mjs';
import { openLockedD1 } from './d1-lock.candidate.mjs';
import { startProductionGateway } from './https-gateway.candidate.mjs';
import { createSwitchableD1, prepareLockedCloudService } from './switchable-d1.candidate.mjs';
import { prepareProductionPhoneAssembly } from './phone-runtime.candidate.mjs';
import { createEcsRoleCredentials } from './ecs-role-credentials.candidate.mjs';
import { createEcsMetadataTransport } from './ecs-metadata-transport.candidate.mjs';
import { validateRunnerConfig } from './runner-config.candidate.mjs';

export async function startLockedGateway({ enabled = false, lockDir, origin, certRoot, slot, bindAddress, phone, settings = { enabled: false }, privateRoot, key, proxy, phoneKey, modelInfo } = {}) {
  if (enabled !== true) throw Error('locked gateway disabled');
  const config=validateRunnerConfig({enabled,lockDir,origin,certRoot,slot,bindAddress,...(phone===undefined?{}:{phone})});
  if (process.platform !== 'linux' || typeof process.geteuid !== 'function' || process.geteuid() === 0 || typeof lockDir !== 'string' || !path.isAbsolute(lockDir)) throw Error('private non-root Linux required');
  for (const dir of [lockDir, path.join(lockDir, 'd1')]) {
    const st = await lstat(dir);
    if (!st.isDirectory() || st.isSymbolicLink() || await realpath(dir) !== dir || st.uid !== process.geteuid() || (st.mode & 0o077) !== 0) throw Error('unsafe database directory');
  }
  let ancestor = path.dirname(lockDir);
  for (;;) { const st = await lstat(ancestor); if (!st.isDirectory() || st.isSymbolicLink() || (st.uid !== 0 && st.uid !== process.geteuid()) || (st.mode & 0o022)) throw Error('unsafe database ancestor'); const next = path.dirname(ancestor); if (next === ancestor) break; ancestor = next; }
  const makeRuntime=({script,bindings={},serviceBindings}={})=>new Miniflare({ modules: true, script, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], host: '127.0.0.1', port: 0, cf: false,
    d1Databases: ['DB'], d1Persist: path.join(lockDir, 'd1'), outboundService: () => new Response(null, { status: 403 }), bindings: { LANTERN_AUTH_ENABLED: 'true', LANTERN_AUTH_ORIGIN: origin, ...bindings }, serviceBindings });
  const locked = await openLockedD1({ lockDir, openRuntime: async () => {
    const worker = await buildAccountWorker();
    return createSwitchableD1(makeRuntime({script:worker.bytes.toString()}),makeRuntime);
  },
    prepareService: async runtime => prepareLockedCloudService({runtime,origin,phone:config.phone,settings,privateRoot,key,proxy,phoneKey,modelInfo,
      buildPhone:config.phone?async mf=>{
        const {policy,roleName,privateRoot:phonePrivateRoot}=config.phone;
        const getCredentials=createEcsRoleCredentials({roleName,metadataFetch:createEcsMetadataTransport(roleName)});
        return prepareProductionPhoneAssembly({policy,accountOrigin:origin,privateRoot:phonePrivateRoot,getCredentials,pnvsFetch:fetch,mf});
      }:undefined}) });
  let gateway;
  try { gateway = await startProductionGateway({ enabled: true, origin, certRoot, slot, bindAddress, service: locked.service }); }
  catch (error) { await locked.close(); throw error; }
  let closing;
  return Object.freeze({ close() { if (!closing) closing = (async () => { await gateway.close(); await locked.close(); })(); return closing; } });
}
