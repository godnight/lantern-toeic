import asset from '@ohos.security.asset';
import { BusinessError } from '@kit.BasicServicesKit';

// This is a safety prerequisite, not an offline-login implementation. Do not
// enable until every account entrance uses the same persisted v2 state, sync
// 401 invalidates only the remote session, explicit identity changes reliably
// revoke local access, and real Asset durability/serialization are verified.
// No remote revocation can be detected while offline; local-only access is
// bound to the last verified device identity and is not server authorization.
export const OFFLINE_OWNER_ENABLED: boolean = false;

export interface LocalOfflineOwner {
  uid: string;
  username: string;
}

interface OfflineRecord {
  version: number;
  origin: string;
  state: string;
  uid?: string;
  username?: string;
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

function text(value: Uint8Array): string {
  if (value.length > 512) throw new Error('Store unavailable');
  let out: string = '';
  for (const code of value) {
    if (code > 127) throw new Error('Store unavailable');
    out += String.fromCharCode(code);
  }
  return out;
}

function validOrigin(origin: string): boolean {
  return /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?$/.test(origin) && origin !== 'https://lantern.local';
}

function validOwner(uid: string, username: string): boolean {
  return /^usr_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uid) && /^[a-z0-9_]{3,32}$/.test(username);
}

/** Native-only identity cache. This never provides network authorization or
 * changes the live owner lease; it must not be exposed directly to ArkWeb.
 * This implementation remains disabled until lifecycle and real Asset
 * durability/serialization can be verified. */
export class OfflineOwnerFence {
  private alias: Uint8Array = ascii('lantern-product-offline-owner-v2');

  private queryMap(): asset.AssetMap {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, this.alias);
    return query;
  }

  private async write(record: OfflineRecord): Promise<void> {
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

  private async read(origin: string): Promise<OfflineRecord | undefined> {
    if (!validOrigin(origin)) throw new Error('Store unavailable');
    const query: asset.AssetMap = this.queryMap();
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    let rows: asset.AssetMap[];
    try { rows = await asset.query(query); } catch (error) {
      if ((error as BusinessError).code === 24000002) return undefined;
      throw new Error('Store unavailable');
    }
    if (rows.length !== 1) throw new Error('Store unavailable');
    const secret: asset.Value | undefined = rows[0].get(asset.Tag.SECRET);
    if (!(secret instanceof Uint8Array)) throw new Error('Store unavailable');
    let record: OfflineRecord;
    try { record = JSON.parse(text(secret)) as OfflineRecord; } catch { throw new Error('Store unavailable'); }
    if (record === null || typeof record !== 'object' || Array.isArray(record) || record.version !== 2 || record.origin !== origin) throw new Error('Store unavailable');
    const fields: string = Object.keys(record).sort().join(',');
    if (record.state === 'pending' && fields === 'origin,state,version') return record;
    if (record.state === 'stable' && fields === 'origin,state,uid,username,version' &&
      typeof record.uid === 'string' && typeof record.username === 'string' && validOwner(record.uid, record.username)) return record;
    throw new Error('Store unavailable');
  }

  async markPending(origin: string): Promise<void> {
    if (!validOrigin(origin)) throw new Error('Store unavailable');
    const record: OfflineRecord = { version: 2, origin: origin, state: 'pending' };
    await this.write(record);
  }

  // Only a native caller holding a fresh server-verified v2 lease can call
  // this. Replacing pending or a different owner additionally requires a
  // successful in-process login followed by its independent v2 proof.
  async saveVerified(origin: string, owner: LocalOfflineOwner, confirmedLogin: boolean): Promise<boolean> {
    if (!validOrigin(origin) || !owner || !validOwner(owner.uid, owner.username)) throw new Error('Store unavailable');
    const old: OfflineRecord | undefined = await this.read(origin);
    if (old !== undefined && old.state !== 'stable' && !confirmedLogin) return false;
    if (old !== undefined && old.state === 'stable' && old.uid !== owner.uid && !confirmedLogin) {
      // A server proof for another owner makes the old local selection stale.
      // Do not substitute either identity until a successful explicit login.
      await this.markPending(origin);
      return false;
    }
    const record: OfflineRecord = { version: 2, origin: origin, state: 'stable', uid: owner.uid, username: owner.username };
    await this.write(record);
    return true;
  }

  // Native-only data partition identity, never a remote session or sync lease.
  async readLocal(origin: string): Promise<LocalOfflineOwner | undefined> {
    const record: OfflineRecord | undefined = await this.read(origin);
    if (record === undefined || record.state !== 'stable' || record.uid === undefined || record.username === undefined) return undefined;
    return { uid: record.uid, username: record.username };
  }
}
