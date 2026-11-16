import asset from '@ohos.security.asset';
import { BusinessError } from '@kit.BasicServicesKit';
import { AUTH_MIGRATION_ENABLED, AUTH_MIGRATION_OLD_ORIGIN, AUTH_MIGRATION_NEW_ORIGIN } from './AuthMigrationConfiguration';

interface StoredSession {
  version: number;
  origin: string;
  token: string;
  expiresAt: number;
  issuedAt?: number;
}

// Native-only candidate input. An Asset record does not contain a trusted
// owner; a token alone is not proof that the migrated account is the same.
export interface LegacyMigrationSession {
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
  // A long-format credential hidden by a rollback must survive automatic
  // unauthenticated probes. Explicit logout may still revoke and clear it.
  private preserveDormant: boolean = false;

  hasDormantPersistent(): boolean { return this.preserveDormant; }

  private queryMap(): asset.AssetMap {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, this.alias);
    return query;
  }

  /**
   * Disabled, non-destructive migration candidate. Not called by the host or
   * exposed to ArkWeb. A future integration must first prove the deployed
   * token-to-owner mapping, independently verify a v2 session at the fixed
   * target without redirects, and atomically fence logout/account changes.
   * Existing load()/clear() behavior is intentionally unchanged; this method
   * alone does not prevent the host from clearing a mismatched-origin record.
   */
  async peekMigrationLegacy(targetOrigin: string): Promise<LegacyMigrationSession | undefined> {
    if (!AUTH_MIGRATION_ENABLED || targetOrigin !== AUTH_MIGRATION_NEW_ORIGIN) return undefined;
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
    let record: StoredSession;
    try { record = JSON.parse(text(secret)) as StoredSession; } catch { throw new Error('Store unavailable'); }
    if (record === null || typeof record !== 'object' || record.version !== 1 ||
      typeof record.origin !== 'string' || typeof record.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(record.token) || typeof record.expiresAt !== 'number' ||
      !Number.isSafeInteger(record.expiresAt)) throw new Error('Store unavailable');
    const now: number = Date.now();
    if (record.origin !== AUTH_MIGRATION_OLD_ORIGIN || !Number.isSafeInteger(now) ||
      record.expiresAt <= now || record.expiresAt - now > 43200000) return undefined;
    return { token: record.token, expiresAt: record.expiresAt };
  }

  async load(origin: string, allowPersistent: boolean = false, preserveOnFailure: boolean = false): Promise<string | undefined> {
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
    if (record === null || typeof record !== 'object' || (record.version !== 1 && record.version !== 2) ||
      typeof record.origin !== 'string' || typeof record.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(record.token) || typeof record.expiresAt !== 'number' ||
      !Number.isFinite(record.expiresAt)) throw new Error('Store unavailable');
    // This candidate understands v2 but old releases sharing this alias do not.
    // Keep it disabled until an independently reviewed downgrade path exists.
    if (record.version === 2) {
      if (!allowPersistent) { this.preserveDormant = true; return undefined; }
      this.preserveDormant = preserveOnFailure;
      const now: number = Date.now();
      const issuedAt: number = record.issuedAt === undefined ? -1 : record.issuedAt;
      if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || !Number.isSafeInteger(record.expiresAt) ||
        !Number.isSafeInteger(now) || (!preserveOnFailure && issuedAt > now) || record.expiresAt - issuedAt > 2592000000 ||
        record.expiresAt <= issuedAt) throw new Error('Store unavailable');
      if (preserveOnFailure) {
        // Identity mutations may submit an expired bearer only for server-side
        // revocation/rotation, never as an account proof. The device clock can
        // be wrong, so expiry alone cannot establish that the server revoked it.
        if (record.origin !== origin) throw new Error('Store unavailable');
        return record.token;
      }
    }
    if (record.origin !== origin || record.expiresAt <= Date.now()) {
      await this.clear();
      return undefined;
    }
    return record.token;
  }

  async save(origin: string, token: string, maxAge: number, allowPersistent: boolean = false): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(token) || !Number.isInteger(maxAge) || maxAge < 1 || maxAge > (allowPersistent ? 2592000 : 43200)) {
      throw new Error('Store unavailable');
    }
    const now: number = Date.now();
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(now + maxAge * 1000)) throw new Error('Store unavailable');
    const record: StoredSession = maxAge > 43200
      ? { version: 2, origin: origin, token: token, issuedAt: now, expiresAt: now + maxAge * 1000 }
      : { version: 1, origin: origin, token: token, expiresAt: now + maxAge * 1000 };
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
    this.preserveDormant = false;
  }

  async clear(explicitLogout: boolean = false): Promise<void> {
    if (this.preserveDormant && !explicitLogout) return;
    try {
      await asset.remove(this.queryMap());
    } catch (error) {
      if ((error as BusinessError).code !== 24000002) throw new Error('Store unavailable');
    }
    this.preserveDormant = false;
  }
}
