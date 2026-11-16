import asset from '@ohos.security.asset';
import { BusinessError } from '@kit.BasicServicesKit';

// This is a safety prerequisite, not an offline-login implementation. Do not
// enable until every account entrance uses the same persisted v2 state and
// actual Asset durability/serialization have been established on devices.
export const OFFLINE_OWNER_ENABLED: boolean = false;

interface PendingOfflineRecord {
  version: number;
  origin: string;
  state: string;
}

function ascii(value: string): Uint8Array {
  const out: Uint8Array = new Uint8Array(value.length);
  for (let i: number = 0; i < value.length; i++) {
    const code: number = value.charCodeAt(i);
    if (code > 127) throw new Error('Store unavailable');
    out[i] = code;
  }
  return out;
}

/** Native-only pre-mutation fence. It deliberately cannot publish an owner,
 * remove a marker or interpret v1 credentials. It must not be exposed to JS.
 * A caller must not issue the account operation when this method fails. */
export class OfflineOwnerFence {
  private alias: Uint8Array = ascii('lantern-product-offline-owner-v2');

  private queryMap(): asset.AssetMap {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, this.alias);
    return query;
  }

  async markPending(origin: string): Promise<void> {
    if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?$/.test(origin) ||
      origin === 'https://lantern.local') throw new Error('Store unavailable');
    const record: PendingOfflineRecord = { version: 2, origin: origin, state: 'pending' };
    const secret: Uint8Array = ascii(JSON.stringify(record));
    const attributes: asset.AssetMap = this.queryMap();
    attributes.set(asset.Tag.SECRET, secret);
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_UNLOCKED);
    attributes.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER);
    try {
      await asset.add(attributes);
    } catch (error) {
      if ((error as BusinessError).code !== 24000003) throw new Error('Store unavailable');
      const changed: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      changed.set(asset.Tag.SECRET, secret);
      try { await asset.update(this.queryMap(), changed); } catch { throw new Error('Store unavailable'); }
    }
  }
}
