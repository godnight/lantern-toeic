import { systemDateTime } from '@kit.BasicServicesKit';

export interface TrustedOwnerLease {
  uid: string;
  authEpoch: number;
  expiresAtUptimeMs: number;
}
export interface TrustedOwnerProvider {
  snapshot(): TrustedOwnerLease | undefined;
  subscribe(listener: () => void): () => void;
}

/** Native process memory only. Never registered with ArkWeb or serialized.
 * Only the auth host may publish a fully verified v2 session proof. */
export class VerifiedOwnerLease implements TrustedOwnerProvider {
  private value: TrustedOwnerLease | undefined = undefined;
  private epoch: number = 0;
  private lastNow: number = 0;
  private timer: number = -1;
  private listeners: Set<() => void> = new Set<() => void>();
  private clock: () => number;

  constructor(clock: () => number = () => systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false)) {
    this.clock = clock;
  }

  version(): number { return this.epoch; }

  snapshot(): TrustedOwnerLease | undefined {
    const value: TrustedOwnerLease | undefined = this.value;
    if (value === undefined) return undefined;
    let now: number;
    try { now = this.clock(); } catch { this.revoke(); return undefined; }
    if (!Number.isFinite(now) || now < this.lastNow || now >= value.expiresAtUptimeMs) {
      this.revoke();
      return undefined;
    }
    this.lastNow = now;
    return { uid: value.uid, authEpoch: value.authEpoch, expiresAtUptimeMs: value.expiresAtUptimeMs };
  }

  publishVerifiedV2(uid: string, proofEndedAt: number, validForMs: number, expectedEpoch: number): boolean {
    // A stale proof must not revoke or replace a newer identity either.
    if (expectedEpoch !== this.epoch || this.epoch >= Number.MAX_SAFE_INTEGER) return false;
    let now: number;
    try { now = this.clock(); } catch { this.revoke(); return false; }
    const deadline: number = proofEndedAt + validForMs;
    if (!/^usr_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uid) ||
      !Number.isFinite(now) || now < this.lastNow || !Number.isFinite(proofEndedAt) ||
      proofEndedAt < 0 || proofEndedAt > now || !Number.isSafeInteger(validForMs) ||
      validForMs <= 0 || validForMs > 43200000 || !Number.isFinite(deadline) || deadline <= now) {
      this.revoke();
      return false;
    }
    const previous: TrustedOwnerLease | undefined = this.value;
    if (previous !== undefined && previous.uid !== uid) { this.revoke(); return false; }
    // Do not add time spent publishing, or extend a repeated proof.
    const expires: number = previous === undefined ? deadline : Math.min(previous.expiresAtUptimeMs, deadline);
    this.lastNow = now;
    this.value = { uid: uid, authEpoch: this.epoch, expiresAtUptimeMs: expires };
    this.arm();
    return true;
  }

  revoke(): void {
    this.value = undefined;
    if (this.epoch < Number.MAX_SAFE_INTEGER) this.epoch++;
    if (this.timer !== -1) { clearTimeout(this.timer); this.timer = -1; }
    this.listeners.forEach((listener: () => void) => {
      try { listener(); } catch { /* A consumer cannot prevent synchronous invalidation. */ }
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private arm(): void {
    if (this.timer !== -1) clearTimeout(this.timer);
    const value: TrustedOwnerLease | undefined = this.value;
    if (value === undefined) return;
    this.timer = setTimeout(() => {
      this.timer = -1;
      if (this.snapshot() !== undefined) this.arm();
    }, Math.max(1, Math.ceil(value.expiresAtUptimeMs - this.lastNow)));
  }
}
