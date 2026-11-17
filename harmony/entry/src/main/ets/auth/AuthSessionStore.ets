import asset from '@ohos.security.asset';
import { BusinessError } from '@kit.BasicServicesKit';

interface StoredSession {
  version: number;
  origin: string;
  token: string;
  expiresAt: number;
}

function ascii(value: string): Uint8Array {
  const out: Uint8Array = new Uint8Array(value.length);
  for (let i: number = 0; i < value.length; i++) {
    const unit: number = value.charCodeAt(i);
    if (unit > 127) throw new Error('Store unavailable');
    out[i] = unit;
  }
  return out;
}

function text(value: Uint8Array): string {
  if (value.length > 1024) throw new Error('Store unavailable');
  let out: string = '';
  for (const unit of value) {
    if (unit > 127) throw new Error('Store unavailable');
    out += String.fromCharCode(unit);
  }
  return out;
}

/** Token, expiry and endpoint binding remain in OS Asset Store, never in Web storage. */
export class AuthSessionStore {
  private alias: Uint8Array = ascii('lantern-product-auth-session-v1');

  private queryMap(): asset.AssetMap {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, this.alias);
    return query;
  }

  async load(origin: string): Promise<string | undefined> {
    const query: asset.AssetMap = this.queryMap();
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    let rows: asset.AssetMap[];
    try {
      rows = await asset.query(query);
    } catch (error) {
      if ((error as BusinessError).code === 24000002) return undefined;
      throw new Error('Store unavailable');
    }
    if (rows.length !== 1) throw new Error('Store unavailable');
    const secret: asset.Value | undefined = rows[0].get(asset.Tag.SECRET);
    if (!(secret instanceof Uint8Array)) throw new Error('Store unavailable');
    const record: StoredSession = JSON.parse(text(secret)) as StoredSession;
    if (record === null || typeof record !== 'object' || record.version !== 1 ||
      typeof record.origin !== 'string' || typeof record.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(record.token) || typeof record.expiresAt !== 'number' ||
      !Number.isFinite(record.expiresAt)) throw new Error('Store unavailable');
    if (record.origin !== origin || record.expiresAt <= Date.now()) {
      await this.clear();
      return undefined;
    }
    return record.token;
  }

  async save(origin: string, token: string, maxAge: number): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(token) || !Number.isInteger(maxAge) || maxAge < 1 || maxAge > 43200) {
      throw new Error('Store unavailable');
    }
    const record: StoredSession = { version: 1, origin: origin, token: token, expiresAt: Date.now() + maxAge * 1000 };
    const secret: Uint8Array = ascii(JSON.stringify(record));
    const attributes: asset.AssetMap = this.queryMap();
    attributes.set(asset.Tag.SECRET, secret);
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_UNLOCKED);
    attributes.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER);
    // Omit IS_PERSISTENT: do not retain after uninstall or request persistent-data permission.
    try {
      await asset.add(attributes);
    } catch (error) {
      if ((error as BusinessError).code !== 24000003) throw new Error('Store unavailable');
      const changed: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      changed.set(asset.Tag.SECRET, secret);
      await asset.update(this.queryMap(), changed);
    }
  }

  async clear(): Promise<void> {
    try {
      await asset.remove(this.queryMap());
    } catch (error) {
      if ((error as BusinessError).code !== 24000002) throw new Error('Store unavailable');
    }
  }
}
