// Fixed in-process server assembly. No listener, credentials or database are
// opened here; the trusted caller owns Miniflare and its persistent D1 lock.
import { prepareAccountSyncAssembly } from './assembly.candidate.mjs';
import { createLocalChannel } from './local-channel.candidate.mjs';
import { createHttpsHandler } from './https-handler.candidate.mjs';

export async function prepareCloudService({ enabled = false, mf, origin, settings = { enabled: false }, privateRoot, key, proxy, phoneKey, modelInfo } = {}) {
  if (enabled !== true) throw Error('cloud service disabled');
  const assembly = await prepareAccountSyncAssembly({ mf, origin, settings, privateRoot, key, proxy, phoneKey, modelInfo });
  const channel = createLocalChannel({ enabled: true, origin, assembly });
  try {
    const handler = createHttpsHandler({ origin, channel, syncEnabled: settings.enabled === true });
    return Object.freeze({ handler, close: () => channel.close() });
  } catch (error) { await channel.close(); throw error; }
}
