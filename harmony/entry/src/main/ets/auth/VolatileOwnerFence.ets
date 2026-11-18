// A process-only candidate. It never stores credentials or grants a remote
// session. Production activation requires the native and page gates together.
export const VOLATILE_OWNER_ENABLED: boolean = false;

export interface VolatileOwner { uid: string; username: string; }
export interface VolatileOwnerRead { uid: string; username: string; validForMs: number; }
interface Entry { origin: string; uid: string; username: string; expires: number; last: number; }

/** Shared across hosts so a mutation in one document revokes every candidate. */
export class VolatileOwnerFence {
  private static entry: Entry | undefined = undefined;
  private static revision: number = 0;
  static version(): number { return VolatileOwnerFence.revision; }
  static clear(): void {
    VolatileOwnerFence.entry = undefined;
    if (VolatileOwnerFence.revision < Number.MAX_SAFE_INTEGER) VolatileOwnerFence.revision++;
  }
  // Only call after a successful native verified-owner lease publication.
  static publish(origin: string, owner: VolatileOwner, now: number, validForMs: number, expected: number): boolean {
    if (expected !== VolatileOwnerFence.revision || expected >= Number.MAX_SAFE_INTEGER ||
      !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?$/.test(origin) ||
      !/^usr_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(owner.uid) ||
      !/^[a-z0-9_]{3,32}$/.test(owner.username) || !Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(validForMs) || validForMs <= 0 || validForMs > 43200000 ||
      !Number.isSafeInteger(now + validForMs)) return false;
    if (VolatileOwnerFence.entry !== undefined && now < VolatileOwnerFence.entry.last) {
      VolatileOwnerFence.clear();
      return false;
    }
    VolatileOwnerFence.revision++;
    VolatileOwnerFence.entry = { origin: origin, uid: owner.uid, username: owner.username, expires: now + validForMs, last: now };
    return true;
  }
  static read(origin: string, now: number): VolatileOwnerRead | undefined {
    const value: Entry | undefined = VolatileOwnerFence.entry;
    if (value === undefined) return undefined;
    if (origin !== value.origin || !Number.isSafeInteger(now) || now < value.last || now >= value.expires) {
      VolatileOwnerFence.clear();
      return undefined;
    }
    value.last = now;
    return { uid: value.uid, username: value.username, validForMs: value.expires - now };
  }
}
