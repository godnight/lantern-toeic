import { webview } from '@kit.ArkWeb';
import http from '@ohos.net.http';
import deviceInfo from '@ohos.deviceInfo';
import { systemDateTime } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import { HuaweiAccountProvider, HuaweiAuthorization } from './HuaweiAccountProvider';
import { AuthSessionStore } from './AuthSessionStore';
import { OfflineOwnerFence, LocalOfflineOwner, OFFLINE_OWNER_ENABLED } from './OfflineOwnerFence';
import { VolatileOwnerFence, VolatileOwnerRead, VOLATILE_OWNER_ENABLED } from './VolatileOwnerFence';
import { TrustedOwnerLease, VerifiedOwnerLease, TrustedOwnerProvider } from '../media/VerifiedOwnerLease';
import { SyncAuthGate } from '../sync/NativeSyncHost';
import { NativeTransitionEvidence } from '../sync/NativeTransitionEvidence';
import { AUTH_API_ORIGIN } from './AuthConfiguration';
import { COLD_START_PREFETCH_ENABLED } from './ColdStartConfiguration';
import { AuthRequest, AuthBody, AuthReply, AuthUser, AuthCookie, AuthRoute, COOKIE_NAME,
  AUTH_TIMEOUT_MS, MAX_RESPONSE_BYTES, trustedFrame, configuredOrigin, parseAuthRequest,
  utf8Length, capabilities, unavailableBody, unknownBody, unauthenticatedBody,
  parseResponseBody, publicUser, publicFailure, sessionCookie, productCookieLines, authRoute, phoneAction,
  operationUnknownBody, phoneStatus, phoneChallenge, phoneFailure, phoneSuccessCapabilities, sessionProofBudget,
  huaweiProviders, huaweiFailure, PERSISTENT_SESSION_ENABLED } from './AuthPolicy';

interface Operation {
  version?: number;
  id: string;
  action: string;
  epoch: number;
  ownerLeaseEpoch: number;
  timedOut: boolean;
  replied: boolean;
  sessionMayHaveChanged: boolean;
  transitionStart: number;
  transitionProof: number;
  volatileEpoch: number;
  coldProcessVersion?: number;
  huawei?: boolean;
  huaweiSdkStarted?: boolean;
  cold?: boolean;
}
interface ColdFlight {
  epoch: number;
  processVersion: number;
  active: () => boolean;
  token?: string;
  response?: http.HttpResponse;
  started: number;
  promise: Promise<void>;
  timer?: number;
}
interface LocalLease {
  uid: string;
  generation: number;
  resumeOnly: boolean;
  volatileVersion: number;
}
interface LocalLeaseCheck {
  uid: string;
  generation: number;
}

// ArkWeb compares the serialized URL port: default HTTPS is empty, not "443".
// An empty permission port skips that engine check; request() still captures the
// caller synchronously and trustedFrame/live enforce the exact local HTTPS authority.
const PROXY_PERMISSION: string = '{"javascriptProxyPermission":{"urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}],' +
  '"methodList":[{"methodName":"request","urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}]}]}}';
const LOCAL_PROXY_PERMISSION: string = '{"javascriptProxyPermission":{"urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}],' +
  '"methodList":[{"methodName":"request","urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}]},' +
  '{"methodName":"isLocalActive","urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}]}]}}';

/** Auth-only bridge. No private API, arbitrary URL, header, filesystem or cookie API. */
export class NativeAuthHost implements SyncAuthGate, NativeTransitionEvidence {
  private controller: webview.WebviewController;
  private active: () => boolean;
  private store: AuthSessionStore = new AuthSessionStore();
  private offlineOwnerFence: OfflineOwnerFence = new OfflineOwnerFence();
  private ownerLease: VerifiedOwnerLease = new VerifiedOwnerLease();
  private epoch: number = 0;
  private attached: boolean = false;
  private disposed: boolean = false;
  // The Web component can recreate a host while an old native request is still
  // settling. Its lock/quarantine belongs to the process, not to that page.
  private static busy: boolean = false;
  private static quarantined: boolean = false;
  private static offlineOwnerPoisoned: boolean = false;
  private static localGeneration: number = 0;
  private localLease: LocalLease | undefined = undefined;
  private static retryAt: number = 0;
  private static coldVersion: number = 0;
  private static coldPoisoned: boolean = false;
  private static coldHosts: NativeAuthHost[] = [];
  private cold: ColdFlight | undefined = undefined;
  private seen: string[] = [];
  private network: http.HttpRequest | undefined = undefined;
  private context: (() => common.UIAbilityContext) | undefined;
  private huaweiOperation: Operation | undefined = undefined;
  private foregroundWaiter: (() => void) | undefined = undefined;
  // Native-only evidence for an account-change barrier; never registered on ArkWeb.
  private syncTransitionStarted: number = 0;
  private syncTransitionPending: number = 0;
  private syncTransitionConfirmed: number = 0;
  private syncTransitionAction: string = '';
  private syncTransitionExpectedOwner: string | null = null;
  private syncTransitionOwner: string | null = null;
  private syncTransitionLeaseEpoch: number = -1;

  constructor(controller: webview.WebviewController, active: () => boolean, context?: () => common.UIAbilityContext) {
    this.controller = controller;
    this.active = active;
    this.context = context;
  }

  attach(): boolean {
    if (this.disposed) return false;
    try {
      // request is synchronous only long enough to capture the calling frame.
      // Its eventual result is delivered with requestId, not a proxy Promise.
      const localEnabled: boolean = OFFLINE_OWNER_ENABLED || VOLATILE_OWNER_ENABLED;
      this.controller.registerJavaScriptProxy(this, 'LanternAuthHost', localEnabled ? ['request', 'isLocalActive'] : ['request'], [], localEnabled ? LOCAL_PROXY_PERMISSION : PROXY_PERMISSION);
      this.attached = true;
      if (COLD_START_PREFETCH_ENABLED && !NativeAuthHost.coldHosts.includes(this)) NativeAuthHost.coldHosts.push(this);
      return true;
    } catch {
      this.attached = false;
      return false;
    }
  }

  private invalidateColdStart(): void {
    if (!COLD_START_PREFETCH_ENABLED) return;
    if (this.cold?.timer !== undefined) clearTimeout(this.cold.timer);
    this.cold = undefined;
    if (NativeAuthHost.coldVersion >= Number.MAX_SAFE_INTEGER) NativeAuthHost.coldPoisoned = true;
    else NativeAuthHost.coldVersion++;
  }

  private currentCold(cold: ColdFlight): boolean {
    if (!COLD_START_PREFETCH_ENABLED || NativeAuthHost.coldPoisoned || NativeAuthHost.quarantined ||
      this.disposed || !this.attached || this.cold !== cold || this.epoch !== cold.epoch ||
      NativeAuthHost.coldVersion !== cold.processVersion) return false;
    try { return cold.active(); } catch { return false; }
  }

  // Native-only, never part of the ArkWeb proxy. The caller must bind active()
  // to one expected main-document generation and the foreground lifecycle.
  beginColdStartCandidate(active: () => boolean): void {
    if (!COLD_START_PREFETCH_ENABLED || NativeAuthHost.coldPoisoned || NativeAuthHost.busy ||
      NativeAuthHost.quarantined || !this.attached || this.disposed || !this.available() || this.cold !== undefined) return;
    const cold: ColdFlight = { epoch: this.epoch, processVersion: NativeAuthHost.coldVersion,
      active: active, started: 0, promise: Promise.resolve() };
    this.cold = cold;
    if (!this.currentCold(cold)) { this.cold = undefined; return; }
    const operation: Operation = { id: '', action: 'session', version: 2, epoch: cold.epoch,
      ownerLeaseEpoch: this.ownerLease.version(), timedOut: false, replied: false, sessionMayHaveChanged: false,
      transitionStart: 0, transitionProof: 0, volatileEpoch: VolatileOwnerFence.version(), cold: true };
    NativeAuthHost.busy = true;
    cold.promise = (async (): Promise<void> => {
      try {
        const token: string | undefined = await this.store.peekColdStartCandidate(AUTH_API_ORIGIN);
        if (!this.currentCold(cold) || token === undefined) return;
        const started: number = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
        if (!Number.isFinite(started) || started < 0) return;
        const response: http.HttpResponse = await this.fetch('session', '{}', token, operation);
        const ended: number = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
        if (!this.currentCold(cold) || !Number.isFinite(ended) || ended < started || ended - started > 5000 ||
          response.responseCode !== 200 || this.cookieHeaders(response).length !== 0) return;
        cold.token = token;
        cold.response = response;
        cold.started = started;
        // Drop the in-memory credential and response even if the page never
        // asks for a session. A stale timer cannot clear a different flight.
        cold.timer = setTimeout(() => {
          if (this.cold === cold) this.invalidateColdStart();
        }, Math.max(1, 5000 - Math.floor(ended - started)));
      } catch { /* Prefetch failure is not a session result. The page probes normally. */ }
      finally { NativeAuthHost.busy = false; }
    })();
  }

  private takeColdStart(token: string | undefined, now: number): ColdFlight | undefined {
    const cold: ColdFlight | undefined = this.cold;
    const usable: boolean = cold !== undefined && this.currentCold(cold) && token !== undefined &&
      cold.token === token && cold.response !== undefined && Number.isFinite(now) && now >= cold.started && now - cold.started <= 5000;
    if (cold?.timer !== undefined) clearTimeout(cold.timer);
    this.cold = undefined;
    return usable ? cold : undefined;
  }

  private async awaitColdStart(input: AuthRequest, epoch: number, cold: ColdFlight): Promise<void> {
    const started: number = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
    const ownerLeaseEpoch: number = this.ownerLease.version();
    if (!Number.isFinite(started) || started < 0) { this.send(input.id, 503, operationUnknownBody(input.action), epoch, input.version); return; }
    let expired: boolean = false;
    const timer: number = setTimeout(() => {
      expired = true;
      this.invalidateColdStart();
      this.send(input.id, 503, operationUnknownBody(input.action), epoch, input.version);
    }, AUTH_TIMEOUT_MS);
    try { await cold.promise; } finally { clearTimeout(timer); }
    if (expired || !this.live(epoch)) return;
    // A competing account action may have been rejected by the lock after it
    // already revoked the owner. Never turn that old join into a fresh probe.
    if (!this.currentCold(cold) || this.ownerLease.version() !== ownerLeaseEpoch) {
      this.send(input.id, 503, operationUnknownBody(input.action), epoch, input.version);
      return;
    }
    const now: number = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
    if (!Number.isFinite(now) || now < started || now - started >= AUTH_TIMEOUT_MS) {
      this.send(input.id, 503, operationUnknownBody(input.action), epoch, input.version);
      return;
    }
    this.dispatch(input, epoch, AUTH_TIMEOUT_MS - Math.floor(now - started));
  }

  invalidate(preserveVolatile: boolean = false): void {
    this.invalidateColdStart();
    this.ownerLease.revoke();
    if (OFFLINE_OWNER_ENABLED || VOLATILE_OWNER_ENABLED) this.revokeLocal();
    if (VOLATILE_OWNER_ENABLED && !preserveVolatile) VolatileOwnerFence.clear();
    this.epoch++;
    this.seen = [];
    this.wakeForeground();
    // Do not abort merely because the page changed: that is not server rollback.
    // Busy stays held until the real HTTP and any Asset call/cleanup settle.
  }

  // Called only by Index, never exposed on the JavaScript proxy. A real document
  // navigation/dispose still uses invalidate(), including during an SDK dialog.
  onForegroundChanged(foreground: boolean): void {
    this.ownerLease.revoke();
    if (OFFLINE_OWNER_ENABLED || VOLATILE_OWNER_ENABLED) this.revokeLocal();
    if (this.huaweiOperation !== undefined && (!OFFLINE_OWNER_ENABLED || this.huaweiOperation.huaweiSdkStarted === true) && this.current(this.huaweiOperation)) {
      if (foreground) this.wakeForeground();
      return;
    }
    this.invalidate(true);
  }

  private wakeForeground(): void {
    const wake: (() => void) | undefined = this.foregroundWaiter;
    this.foregroundWaiter = undefined;
    if (wake !== undefined) wake();
  }

  private async awaitForeground(operation: Operation): Promise<void> {
    while (this.current(operation) && !this.active()) {
      await new Promise<void>((resolve: () => void) => { this.foregroundWaiter = resolve; });
    }
    if (!this.current(operation) || !this.active()) throw new Error('Unconfirmed');
  }

  // Native consumers only. Only request() is on the registered JS method list.
  trustedOwnerProvider(): TrustedOwnerProvider { return this.ownerLease; }

  private revokeLocal(): void {
    this.localLease = undefined;
    if (NativeAuthHost.localGeneration < Number.MAX_SAFE_INTEGER) NativeAuthHost.localGeneration++;
  }

  // Synchronous, native-validated local data lease. It never grants a token,
  // remote owner lease, account mutation or cloud synchronization authority.
  isLocalActive(raw: string): boolean {
    if (!(OFFLINE_OWNER_ENABLED || VOLATILE_OWNER_ENABLED) || typeof raw !== 'string' || raw.length > 256 || NativeAuthHost.offlineOwnerPoisoned || NativeAuthHost.quarantined) return false;
    let frame: string;
    try { frame = this.controller.getLastJavascriptProxyCallingFrameUrl(); } catch { return false; }
    if (!trustedFrame(frame) || !this.live(this.epoch)) return false;
    let check: LocalLeaseCheck;
    try { check = JSON.parse(raw) as LocalLeaseCheck; } catch { return false; }
    const lease: LocalLease | undefined = this.localLease;
    const volatileOwner: VolatileOwnerRead | undefined = lease?.resumeOnly ? VolatileOwnerFence.read(AUTH_API_ORIGIN, systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false)) : undefined;
    return check !== null && typeof check === 'object' && !Array.isArray(check) && Object.keys(check).sort().join(',') === 'generation,uid' &&
      lease !== undefined && (!lease.resumeOnly || volatileOwner !== undefined && volatileOwner.uid === lease.uid && lease.volatileVersion === VolatileOwnerFence.version()) &&
      check.uid === lease.uid && check.generation === lease.generation && lease.generation === NativeAuthHost.localGeneration;
  }

  private async issueLocal(input: AuthRequest, epoch: number): Promise<void> {
    if (!(OFFLINE_OWNER_ENABLED || VOLATILE_OWNER_ENABLED) || NativeAuthHost.busy || NativeAuthHost.quarantined || NativeAuthHost.offlineOwnerPoisoned ||
      deviceInfo.sdkApiVersion < 23 || OFFLINE_OWNER_ENABLED && !canIUse('SystemCapability.Security.Asset')) {
      this.send(input.id, 503, { code: 'local-unavailable' }, epoch);
      return;
    }
    const generation: number = NativeAuthHost.localGeneration;
    NativeAuthHost.busy = true;
    try {
      const resumeOnly: boolean = VOLATILE_OWNER_ENABLED && !OFFLINE_OWNER_ENABLED;
      const volatileVersion: number = VolatileOwnerFence.version();
      const memory: VolatileOwnerRead | undefined = resumeOnly ? VolatileOwnerFence.read(AUTH_API_ORIGIN, systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false)) : undefined;
      const owner: LocalOfflineOwner | undefined = resumeOnly ? memory : await this.offlineOwnerFence.readLocal(AUTH_API_ORIGIN);
      if (!this.live(epoch) || generation !== NativeAuthHost.localGeneration || resumeOnly && volatileVersion !== VolatileOwnerFence.version()) return;
      if (owner === undefined) { this.revokeLocal(); this.send(input.id, 401, { code: 'local-unavailable' }, epoch); return; }
      if (NativeAuthHost.localGeneration >= Number.MAX_SAFE_INTEGER) throw new Error('Unconfirmed');
      const next: number = ++NativeAuthHost.localGeneration;
      this.localLease = { uid: owner.uid, generation: next, resumeOnly: resumeOnly, volatileVersion: volatileVersion };
      if (resumeOnly && memory !== undefined) this.send(input.id, 200, { user: { id: owner.uid, username: owner.username }, local: { scope: 'local-study-only', generation: next, resumeOnly: true, validForMs: memory.validForMs } }, epoch);
      else this.send(input.id, 200, { user: { id: owner.uid, username: owner.username }, local: { scope: 'local-study-only', generation: next } }, epoch);
    } catch { this.revokeLocal(); this.send(input.id, 503, { code: 'local-unavailable' }, epoch); }
    finally { NativeAuthHost.busy = false; }
  }

  // Native-only candidate. No JS proxy method and no remote/session lease is
  // issued. A future consumer must separately enforce revocation during use.
  async readLocalOfflineOwnerCandidate(): Promise<LocalOfflineOwner | undefined> {
    const epoch: number = this.epoch;
    if (!OFFLINE_OWNER_ENABLED || NativeAuthHost.busy || NativeAuthHost.quarantined || NativeAuthHost.offlineOwnerPoisoned || !this.live(epoch)) return undefined;
    NativeAuthHost.busy = true;
    try {
      const owner: LocalOfflineOwner | undefined = await this.offlineOwnerFence.readLocal(AUTH_API_ORIGIN);
      return this.live(epoch) && !NativeAuthHost.quarantined && !NativeAuthHost.offlineOwnerPoisoned ? owner : undefined;
    } catch { return undefined; } finally { NativeAuthHost.busy = false; }
  }

  syncTransitionVersion(): number { return this.syncTransitionStarted; }
  syncTransitionConfirmedAfter(start: number): boolean {
    if (this.syncTransitionConfirmed <= start || this.syncTransitionConfirmed !== this.syncTransitionStarted ||
      NativeAuthHost.busy || NativeAuthHost.quarantined || !this.live(this.epoch)) return false;
    const lease: TrustedOwnerLease | undefined = this.ownerLease.snapshot();
    return this.syncTransitionOwner === null ? lease === undefined && this.ownerLease.version() === this.syncTransitionLeaseEpoch : lease !== undefined && lease.uid === this.syncTransitionOwner &&
      lease.authEpoch === this.syncTransitionLeaseEpoch;
  }

  // Native-only: not registered as a JavaScript proxy method. Shares the auth
  // operation lock and validates the verified lease before and after work.
  async withSession(lease: TrustedOwnerLease, work: (token: string) => Promise<void>): Promise<void> {
    const epoch: number = this.epoch;
    const same: () => boolean = () => {
      if (!this.live(epoch) || !this.available() || NativeAuthHost.quarantined) return false;
      const current: TrustedOwnerLease | undefined = this.ownerLease.snapshot();
      return current !== undefined && current.uid === lease.uid && current.authEpoch === lease.authEpoch &&
        current.expiresAtUptimeMs === lease.expiresAtUptimeMs;
    };
    if (!same() || NativeAuthHost.busy) throw new Error('Unconfirmed');
    NativeAuthHost.busy = true;
    try {
      if (!same()) throw new Error('Unconfirmed');
      const token: string | undefined = await this.store.load(AUTH_API_ORIGIN, PERSISTENT_SESSION_ENABLED);
      if (!same() || token === undefined || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Unconfirmed');
      await work(token);
      if (!same()) throw new Error('Unconfirmed');
    } finally {
      NativeAuthHost.busy = false;
    }
  }

  dispose(): void {
    this.invalidate();
    this.disposed = true;
    this.attached = false;
    if (COLD_START_PREFETCH_ENABLED) NativeAuthHost.coldHosts = NativeAuthHost.coldHosts.filter((host: NativeAuthHost) => host !== this);
    try { this.controller.deleteJavaScriptRegister('LanternAuthHost'); } catch { /* Already detached. */ }
  }

  request(raw: string): void {
    // This getter MUST precede any await, timer, Promise or asynchronous dispatch.
    let frame: string;
    const epoch: number = this.epoch;
    try { frame = this.controller.getLastJavascriptProxyCallingFrameUrl(); } catch { return; }
    if (!trustedFrame(frame) || !this.live(epoch)) return;
    const input: AuthRequest | undefined = parseAuthRequest(raw, OFFLINE_OWNER_ENABLED || VOLATILE_OWNER_ENABLED);
    const identityRequest: boolean = input !== undefined && ['register', 'login', 'logout', 'phone-login', 'phone-bind', 'huawei-login', 'huawei-bind'].includes(input.action);
    if (COLD_START_PREFETCH_ENABLED && (input === undefined || identityRequest)) {
      // A different Host can own a lease while the process-wide auth slot is
      // busy. Revoke all of them synchronously on account-change intent.
      for (const host of NativeAuthHost.coldHosts) {
        host.ownerLease.revoke();
        if (OFFLINE_OWNER_ENABLED || VOLATILE_OWNER_ENABLED) host.revokeLocal();
      }
    }
    if (input === undefined || identityRequest) this.invalidateColdStart();
    if (input === undefined) { this.ownerLease.revoke(); if (VOLATILE_OWNER_ENABLED) { VolatileOwnerFence.clear(); this.revokeLocal(); } return; }
    // Discovery has no identity effect. In particular, reading it immediately
    // after a verified cold-start session must not disable native media access.
    if (input.action !== 'providers' && input.action !== 'local-session') this.ownerLease.revoke();
    if ((OFFLINE_OWNER_ENABLED || VOLATILE_OWNER_ENABLED) && ['register', 'login', 'logout', 'phone-login', 'phone-bind', 'huawei-login', 'huawei-bind'].includes(input.action)) {
      this.revokeLocal();
      if (VOLATILE_OWNER_ENABLED) VolatileOwnerFence.clear();
    }
    // Never send a duplicate id that could overwrite the original operation's reply.
    if (this.seen.includes(input.id)) return;
    if (this.seen.length >= 256) {
      this.send(input.id, 429, { code: 'too-many-attempts', error: '请稍后重新打开账号页。' }, epoch, input.version);
      return;
    }
    this.seen.push(input.id);
    if (input.action === 'local-session') {
      this.issueLocal(input, epoch).catch(() => {});
      return;
    }
    if (!this.available()) {
      this.send(input.id, 503, unavailableBody(input.action), epoch, input.version);
      return;
    }
    if (input.action !== 'session' && input.action !== 'phone-status' && input.action !== 'providers') {
      const now: number = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
      if (Number.isFinite(now) && now < NativeAuthHost.retryAt) {
        this.send(input.id, 429, { code: 'too-many-attempts', error: '请稍后重试。' }, epoch, input.version);
        return;
      }
    }
    if (NativeAuthHost.busy) {
      const cold: ColdFlight | undefined = this.cold;
      if (COLD_START_PREFETCH_ENABLED && input.action === 'session' && input.version === 2 &&
        cold !== undefined && this.currentCold(cold)) {
        this.awaitColdStart(input, epoch, cold).catch(() => {});
        return;
      }
      this.send(input.id, 503, operationUnknownBody(input.action), epoch, input.version);
      return;
    }
    this.dispatch(input, epoch);
  }

  private dispatch(input: AuthRequest, epoch: number, timeoutMs: number = AUTH_TIMEOUT_MS): void {
    if (!this.live(epoch) || NativeAuthHost.busy || !this.available()) {
      this.send(input.id, 503, operationUnknownBody(input.action), epoch, input.version);
      return;
    }
    NativeAuthHost.busy = true;
    let transitionStart: number = 0;
    let transitionProof: number = 0;
    if (['register', 'login', 'logout', 'phone-login', 'phone-bind', 'huawei-login', 'huawei-bind'].includes(input.action)) {
      if (this.syncTransitionStarted >= Number.MAX_SAFE_INTEGER) { NativeAuthHost.busy = false; return; }
      transitionStart = ++this.syncTransitionStarted;
      this.syncTransitionPending = 0;
    }
    if (input.action === 'session' && this.syncTransitionPending > 0) {
      if (input.version === 2) transitionProof = this.syncTransitionPending;
      // Only the first independent proof attempt after mutation can complete it.
      // Timeout, failure or a later ordinary recheck must leave the hold latched.
      this.syncTransitionPending = 0;
    }
    const operation: Operation = { id: input.id, action: input.action, version: input.version, epoch: epoch, ownerLeaseEpoch: this.ownerLease.version(), timedOut: false, replied: false, sessionMayHaveChanged: false, transitionStart: transitionStart, transitionProof: transitionProof, volatileEpoch: VolatileOwnerFence.version(), coldProcessVersion: NativeAuthHost.coldVersion };
    if (input.action === 'huawei-login' || input.action === 'huawei-bind') {
      operation.huawei = true;
      this.huaweiOperation = operation;
      this.runHuawei(input, operation).catch(() => {});
      return;
    }
    this.run(input, operation, timeoutMs).catch(() => { /* run publishes only sanitized failures. */ });
  }

  private available(): boolean {
    return deviceInfo.sdkApiVersion >= 23 && configuredOrigin(AUTH_API_ORIGIN) &&
      canIUse('SystemCapability.Communication.NetStack') && canIUse('SystemCapability.Security.Asset');
  }

  private live(epoch: number): boolean {
    if (this.disposed || !this.attached || epoch !== this.epoch || !this.active()) return false;
    try { return trustedFrame(this.controller.getUrl()); } catch { return false; }
  }

  private current(operation: Operation): boolean {
    if (operation.timedOut) return false;
    if (operation.cold === true) {
      const cold: ColdFlight | undefined = this.cold;
      return cold !== undefined && operation.epoch === cold.epoch && this.currentCold(cold);
    }
    if (operation.huawei === true && (!OFFLINE_OWNER_ENABLED || operation.huaweiSdkStarted === true) && this.huaweiOperation === operation) {
      if (this.disposed || !this.attached || operation.epoch !== this.epoch) return false;
      try { return trustedFrame(this.controller.getUrl()); } catch { return false; }
    }
    return this.live(operation.epoch);
  }

  private send(id: string, status: number, body: AuthBody, epoch: number, version?: number): void {
    if (!this.live(epoch)) return;
    const reply: AuthReply = { id: id, status: status, body: body };
    if (version === 2) reply.version = 2;
    const safe: string = JSON.stringify(reply).replace(/</g, '\\u003c');
    try {
      this.controller.runJavaScript('(function(){if(typeof window.__lanternAuthReceive==="function")' +
        'window.__lanternAuthReceive(' + safe + ');})()').catch(() => {});
    } catch { /* No secret, response body or script is logged. */ }
  }

  private finish(operation: Operation, status: number, body: AuthBody): void {
    if (operation.replied || !this.current(operation)) return;
    operation.replied = true;
    if (operation.transitionStart > 0 && operation.transitionStart === this.syncTransitionStarted && status === 200) {
      this.syncTransitionPending = operation.transitionStart;
      this.syncTransitionAction = operation.action;
      this.syncTransitionExpectedOwner = body.user?.id ?? null;
    } else if (operation.action === 'session' && operation.version === 2 &&
      operation.transitionProof === this.syncTransitionStarted && operation.transitionProof > 0) {
      const lease: TrustedOwnerLease | undefined = this.ownerLease.snapshot();
      if ((status === 200 && lease !== undefined && this.syncTransitionAction !== 'logout') ||
        (status === 401 && body.code === 'unauthenticated' && lease === undefined && this.syncTransitionAction === 'logout')) {
        this.syncTransitionOwner = lease?.uid ?? null;
        this.syncTransitionLeaseEpoch = lease?.authEpoch ?? this.ownerLease.version();
        this.syncTransitionConfirmed = operation.transitionProof;
      }
    }
    this.send(operation.id, status, body, operation.epoch, operation.version);
  }

  private cookieHeaders(response: http.HttpResponse): string[] {
    const headers: Record<string, string | string[]> = response.header as Record<string, string | string[]>;
    const keys: string[] = Object.keys(headers);
    if (keys.length > 64) throw new Error('Unconfirmed');
    const lines: string[] = [];
    let contentType: boolean = false;
    for (const key of keys) {
      const value: string | string[] = headers[key];
      if (key.toLowerCase() === 'content-type') {
        if (typeof value !== 'string' || value.length > 256 ||
          value.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('Unconfirmed');
        contentType = true;
      }
      if (key.toLowerCase() === 'set-cookie') {
        if (typeof value === 'string') lines.push(value);
        else if (Array.isArray(value) && value.length <= 16) {
          for (const line of value) {
            if (typeof line !== 'string') throw new Error('Unconfirmed');
            lines.push(line);
          }
        } else throw new Error('Unconfirmed');
      }
    }
    if (!contentType) throw new Error('Unconfirmed');
    const selected: string[] | undefined = productCookieLines(lines);
    if (selected === undefined) throw new Error('Unconfirmed');
    return selected;
  }

  private async fetch(action: string, body: string, token: string | undefined,
    operation: Operation, proof: boolean = false): Promise<http.HttpResponse> {
    if (operation.huawei === true) await this.awaitForeground(operation);
    if (!this.current(operation) || !this.available()) throw new Error('Unconfirmed');
    // There is no caller supplied URL or method, only the fixed policy routes.
    const route: AuthRoute | undefined = authRoute(action);
    if (route === undefined) throw new Error('Unconfirmed');
    const headers: Record<string, string> = { 'Accept': 'application/json', 'Origin': AUTH_API_ORIGIN };
    if (PERSISTENT_SESSION_ENABLED && ['register', 'login', 'huawei-login', 'phone-login'].includes(action)) {
      headers['X-Lantern-Session-Policy'] = 'persistent-v1';
    }
    if (action === 'session' && (operation.version === 2 || proof)) headers['X-Lantern-Session-Proof'] = '2';
    if (route.method === 'POST') headers['Content-Type'] = 'application/json';
    if (token !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Unconfirmed');
      headers['Cookie'] = COOKIE_NAME + '=' + token;
    }
    const request: http.HttpRequest = http.createHttp();
    this.network = request;
    const options: http.HttpRequestOptions = {
      method: route.method === 'GET' ? http.RequestMethod.GET : http.RequestMethod.POST,
      header: headers, usingCache: false, expectDataType: http.HttpDataType.STRING,
      connectTimeout: 10000, readTimeout: 10000, maxLimit: MAX_RESPONSE_BYTES,
      // Executed only under the runtime API23 guard. Compile SDK must include API23+.
      maxRedirects: 0
    };
    if (route.method === 'POST') options.extraData = body;
    try {
      const response: http.HttpResponse = await request.request(AUTH_API_ORIGIN + route.path, options);
      if (operation.huawei === true) await this.awaitForeground(operation);
      if (!this.current(operation) || response.responseCode >= 300 && response.responseCode < 400 ||
        typeof response.result !== 'string' || utf8Length(response.result) > MAX_RESPONSE_BYTES) throw new Error('Unconfirmed');
      return response;
    } finally {
      try { request.destroy(); } catch { /* This request belongs to this operation. */ }
      if (this.network === request) this.network = undefined;
    }
  }

  private huaweiAvailable(): boolean {
    return this.context !== undefined && HuaweiAccountProvider.available();
  }

  private async huaweiSession(token: string | undefined, operation: Operation): Promise<AuthUser> {
    if (token === undefined) throw new Error('Unconfirmed');
    const started: number = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
    const response: http.HttpResponse = await this.fetch('session', '', token, operation, true);
    if (this.cookieHeaders(response).length !== 0 || response.responseCode !== 200) throw new Error('Unconfirmed');
    const payload: AuthBody = parseResponseBody(response.result as string);
    const user: AuthUser | undefined = publicUser(payload);
    const remaining: number = sessionProofBudget(payload);
    const ended: number = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
    if (!user || !Number.isFinite(started) || started < 0 || !Number.isFinite(ended) || ended < started || remaining <= ended - started) throw new Error('Unconfirmed');
    return user;
  }

  private async runHuawei(input: AuthRequest, operation: Operation): Promise<void> {
    let timer: number = -1;
    const arm: (milliseconds: number, sdk: boolean) => void = (milliseconds: number, sdk: boolean) => {
      if (timer !== -1) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!this.current(operation)) return;
        operation.timedOut = true;
        operation.replied = true;
        this.wakeForeground();
        this.send(operation.id, sdk ? 408 : 503, sdk ? { code: 'huawei-timeout', error: '华为账号授权已超时，请重试。' } : unknownBody(), operation.epoch);
      }, milliseconds);
    };
    arm(AUTH_TIMEOUT_MS, false);
    try {
      // A future offline identity must be invalidated before any operation
      // that can alter it. This gate is not enabled or used for offline entry.
      if (OFFLINE_OWNER_ENABLED && operation.transitionStart > 0) {
        try { await this.offlineOwnerFence.markPending(AUTH_API_ORIGIN); }
        catch { NativeAuthHost.offlineOwnerPoisoned = true; throw new Error('Unconfirmed'); }
        if (!this.current(operation)) return;
      }
      if (!this.huaweiAvailable() || this.context === undefined) {
        this.finish(operation, 503, { code: 'huawei-unavailable', error: '此设备暂不支持华为账号登录。' });
        return;
      }
      let token: string | undefined = undefined;
      if (NativeAuthHost.quarantined) {
        await this.store.load(AUTH_API_ORIGIN, false);
        if (this.store.hasDormantPersistent() && input.action === 'huawei-login') {
          token = await this.store.load(AUTH_API_ORIGIN, true, true);
          if (token === undefined) throw new Error('Unconfirmed');
        } else await this.store.clear();
      } else token = await this.store.load(AUTH_API_ORIGIN,
        PERSISTENT_SESSION_ENABLED || input.action === 'huawei-login',
        input.action === 'huawei-login');
      if (!this.current(operation)) return;
      const providerReply: http.HttpResponse = await this.fetch('providers', '', input.action === 'huawei-login' ? undefined : token, operation);
      if (this.cookieHeaders(providerReply).length !== 0 || providerReply.responseCode !== 200) throw new Error('Unconfirmed');
      const providers: AuthBody = huaweiProviders(parseResponseBody(providerReply.result as string), true);
      if (input.action === 'huawei-bind' ? providers.huaweiBinding !== true : providers.huaweiLogin !== true) {
        this.finish(operation, 503, { code: 'huawei-unavailable', error: '华为账号登录暂不可用。' });
        return;
      }
      const bindingUser: AuthUser | undefined = input.action === 'huawei-bind' ? await this.huaweiSession(token, operation) : undefined;
      if (!this.current(operation)) return;
      arm(180000, true);
      operation.huaweiSdkStarted = true;
      const authorization: HuaweiAuthorization = await new HuaweiAccountProvider().authorize(this.context());
      if (!this.current(operation)) return;
      await this.awaitForeground(operation);
      if (authorization.code === undefined) {
        this.finish(operation, 400, { code: authorization.failure === 'huawei-cancelled' ? 'huawei-cancelled' : 'huawei-authorization-failed', error: authorization.failure === 'huawei-cancelled' ? '已取消华为账号授权。' : '华为账号授权未完成，请重试。' });
        return;
      }
      // SDK time is separate from the network/Asset budget. Never resend this code.
      arm(AUTH_TIMEOUT_MS, false);
      operation.sessionMayHaveChanged = true;
      const response: http.HttpResponse = await this.fetch(input.action, JSON.stringify({ code: authorization.code }), token, operation);
      authorization.code = undefined;
      const lines: string[] = this.cookieHeaders(response);
      const payload: AuthBody = parseResponseBody(response.result as string);
      if (response.responseCode !== 200) {
        if (lines.length !== 0) throw new Error('Unconfirmed');
        const failure: AuthReply = huaweiFailure(response.responseCode, payload);
        if (failure.body.code !== 'auth-state-unknown') operation.sessionMayHaveChanged = false;
        this.finish(operation, failure.status, failure.body);
        return;
      }
      const user: AuthUser | undefined = publicUser(payload);
      if (!user) throw new Error('Unconfirmed');
      if (input.action === 'huawei-bind') {
        if (lines.length !== 0 || payload.ok !== true || !bindingUser || user.id !== bindingUser.id) throw new Error('Unconfirmed');
        const confirmed: AuthUser = await this.huaweiSession(token, operation);
        if (confirmed.id !== bindingUser.id) throw new Error('Unconfirmed');
        operation.sessionMayHaveChanged = false;
        NativeAuthHost.quarantined = false;
        this.finish(operation, 200, { ok: true, user: confirmed });
      } else {
        const cookie: AuthCookie | undefined = sessionCookie(lines, PERSISTENT_SESSION_ENABLED);
        if (!cookie || cookie.token === '' || cookie.maxAge < 1 || payload.capabilities?.passwordLogin !== true || !this.current(operation)) throw new Error('Unconfirmed');
        await this.store.save(AUTH_API_ORIGIN, cookie.token, cookie.maxAge, PERSISTENT_SESSION_ENABLED);
        const confirmed: AuthUser = await this.huaweiSession(cookie.token, operation);
        if (confirmed.id !== user.id) throw new Error('Unconfirmed');
        operation.sessionMayHaveChanged = false;
        NativeAuthHost.quarantined = false;
        this.finish(operation, 200, { user: confirmed, capabilities: capabilities(true) });
      }
    } catch {
      if (operation.sessionMayHaveChanged) NativeAuthHost.quarantined = true;
      this.finish(operation, 503, unknownBody());
    } finally {
      if (timer !== -1) clearTimeout(timer);
      if (operation.sessionMayHaveChanged) {
        NativeAuthHost.quarantined = true;
        try { await this.store.clear(); } catch {}
      }
      if (this.huaweiOperation === operation) this.huaweiOperation = undefined;
      this.wakeForeground();
      NativeAuthHost.busy = false;
    }
  }

  private async run(input: AuthRequest, operation: Operation, timeoutMs: number = AUTH_TIMEOUT_MS): Promise<void> {
    const timer: number = setTimeout(() => {
      if (!this.current(operation)) return;
      operation.timedOut = true;
      operation.replied = true;
      // A UI deadline is not HTTP completion. Keep the operation slot until the
      // real native request/Asset operation settles, even after publishing 503.
      this.send(operation.id, 503, operationUnknownBody(input.action), operation.epoch, operation.version);
    }, timeoutMs);
    try {
      if (OFFLINE_OWNER_ENABLED && operation.transitionStart > 0) {
        try { await this.offlineOwnerFence.markPending(AUTH_API_ORIGIN); }
        catch { NativeAuthHost.offlineOwnerPoisoned = true; throw new Error('Unconfirmed'); }
        if (!this.current(operation)) return;
      }
      let token: string | undefined = undefined;
      const explicitIdentity: boolean = ['register', 'login', 'logout', 'phone-login'].includes(input.action);
      if (NativeAuthHost.quarantined) {
        // Re-read Asset because quarantine outlives individual Host/store objects.
        // A v2 token is usable only for an explicit rotation or revocation.
        await this.store.load(AUTH_API_ORIGIN, false);
        if (this.store.hasDormantPersistent() && explicitIdentity) {
          token = await this.store.load(AUTH_API_ORIGIN, true, true);
          if (token === undefined) throw new Error('Unconfirmed');
        } else await this.store.clear();
      } else {
        token = await this.store.load(AUTH_API_ORIGIN, PERSISTENT_SESSION_ENABLED || explicitIdentity, explicitIdentity);
      }
      if (!this.current(operation)) return;
      if (COLD_START_PREFETCH_ENABLED && input.action === 'session' && operation.coldProcessVersion !== NativeAuthHost.coldVersion) throw new Error('Unconfirmed');
      let bindingUser: AuthUser | undefined = undefined;
      if (input.action === 'phone-bind') {
        // The old owner comes only from a fresh server proof using this host's
        // private cookie. No JS body/userId can pick a binding owner.
        const before: http.HttpResponse = await this.fetch('session', '', token, operation);
        if (this.cookieHeaders(before).length !== 0) {
          NativeAuthHost.quarantined = true;
          await this.store.clear();
          throw new Error('Unconfirmed');
        }
        const existing: AuthBody = parseResponseBody(before.result as string);
        if (before.responseCode !== 200) {
          if (before.responseCode === 401) {
            await this.store.clear();
            NativeAuthHost.quarantined = false;
          }
          const rejected: AuthReply = publicFailure(before.responseCode, existing);
          this.finish(operation, rejected.status, rejected.body);
          return;
        }
        bindingUser = publicUser(existing);
        if (!bindingUser || token === undefined || existing.capabilities?.passwordLogin !== true) throw new Error('Unconfirmed');
      }
      // Even an empty store probes the real service. Local absence must not hide
      // backend auth-disabled, transport failures, or manufacture server evidence.
      const body: string = input.body === undefined ? '{}' : JSON.stringify(input.body);
      const identityMutation: boolean = ['register', 'login', 'logout', 'phone-bind', 'phone-login'].includes(input.action);
      if (identityMutation) operation.sessionMayHaveChanged = true;
      let started: number = input.version === 2 ? systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false) : 0;
      if (input.version === 2 && (!Number.isFinite(started) || started < 0)) throw new Error('Unconfirmed');
      const cached: ColdFlight | undefined = input.action === 'session' && input.version === 2 ? this.takeColdStart(token, started) : undefined;
      if (cached !== undefined) started = cached.started;
      const response: http.HttpResponse = cached?.response ?? await this.fetch(input.action, body, token, operation);
      if (COLD_START_PREFETCH_ENABLED && input.action === 'session' && operation.coldProcessVersion !== NativeAuthHost.coldVersion) throw new Error('Unconfirmed');
      const lines: string[] = this.cookieHeaders(response);
      const payload: AuthBody = parseResponseBody(response.result as string);
      if (response.responseCode === 429) {
        const headers: Record<string, string | string[]> = response.header as Record<string, string | string[]>;
        const names: string[] = Object.keys(headers).filter((key: string) => key.toLowerCase() === 'retry-after');
        const value: string | string[] | undefined = names.length === 1 ? headers[names[0]] : undefined;
        if (typeof value === 'string' && /^[0-9]{1,5}$/.test(value)) {
          const seconds: number = Number(value);
          const now: number = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
          if (Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86400 && Number.isFinite(now) && now >= 0) NativeAuthHost.retryAt = now + seconds * 1000;
        }
      }
      // The fixed backend never rotates cookies on session/rejection. Treat an
      // unexpected rotation as unknown instead of proving an obsolete token.
      const cookieAllowed: boolean = response.responseCode === 200 && ['register', 'login', 'logout', 'phone-login'].includes(input.action);
      if (!cookieAllowed && lines.length !== 0) {
        NativeAuthHost.quarantined = true;
        await this.store.clear();
        throw new Error('Unconfirmed');
      }
      if (input.action === 'phone-challenge' && response.responseCode === 202) {
        if (input.body === undefined) throw new Error('Unconfirmed');
        this.finish(operation, 202, phoneChallenge(payload, input.body));
        return;
      }
      if (response.responseCode !== 200) {
        // Explicit credential rejection does not revoke an otherwise valid old session.
        if (input.action === 'session' && response.responseCode === 401 && VOLATILE_OWNER_ENABLED) { VolatileOwnerFence.clear(); this.revokeLocal(); }
        if (input.action === 'session' && response.responseCode === 401) await this.store.clear();
        if (input.action === 'session' && response.responseCode === 401) NativeAuthHost.quarantined = false;
        const failure: AuthReply = phoneAction(input.action) ? phoneFailure(response.responseCode, payload) : publicFailure(response.responseCode, payload);
        // Only recognized phone rejections/closed-provider responses prove that
        // this request did not mutate. An unexpected protocol keeps quarantine.
        const rejected: boolean = phoneAction(input.action) ? failure.status === response.responseCode &&
          (failure.body.code === 'phone-unavailable' || [400, 401, 409, 410, 429].includes(failure.status)) :
          [400, 401, 403, 409, 413, 429].includes(response.responseCode);
        if (rejected) operation.sessionMayHaveChanged = false;
        if (operation.sessionMayHaveChanged) NativeAuthHost.quarantined = true;
        this.finish(operation, failure.status, failure.body);
        return;
      }
      if (input.action === 'phone-status') {
        this.finish(operation, 200, phoneStatus(payload));
        return;
      }
      if (input.action === 'providers') {
        this.finish(operation, 200, huaweiProviders(payload, this.huaweiAvailable()));
        return;
      }
      // A challenge has only one success shape/status; 200 cannot mean sent.
      if (input.action === 'phone-challenge') throw new Error('Unconfirmed');
      if (input.action === 'logout') {
        const cookie: AuthCookie | undefined = sessionCookie(lines, PERSISTENT_SESSION_ENABLED);
        if (!cookie || cookie.token !== '' || cookie.maxAge !== 0 || payload.ok !== true) throw new Error('Unconfirmed');
        await this.store.clear(true);
        if (!this.current(operation)) return;
        operation.sessionMayHaveChanged = false;
        NativeAuthHost.quarantined = false;
        this.finish(operation, 200, { ok: true, capabilities: capabilities(true) });
        return;
      }
      let user: AuthUser | undefined = publicUser(payload);
      if (!user || payload.capabilities?.passwordLogin !== true) throw new Error('Unconfirmed');
      if (input.action === 'session' && token === undefined) throw new Error('Unconfirmed');
      if (input.version === 2) {
        const remaining: number = sessionProofBudget(payload);
        const ended: number = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
        const validForMs: number = Math.floor(remaining - (ended - started));
        if (!Number.isFinite(ended) || ended < started || !Number.isSafeInteger(validForMs) || validForMs <= 0 || validForMs > 43200000) throw new Error('Unconfirmed');
        operation.sessionMayHaveChanged = false;
        NativeAuthHost.quarantined = false;
        // This branch is the existing strict v2 session proof. Preserve its wire
        // reply and project only the remaining monotonic lifetime to native media.
        const published: boolean = this.current(operation) && this.ownerLease.publishVerifiedV2(user.id, ended, validForMs, operation.ownerLeaseEpoch);
        // A concurrent request can revoke the native lease while this request
        // is in flight, even when that concurrent request is rejected as busy.
        // Do not let the web layer select an owner whose lease was not issued.
        if (!published) throw new Error('Unconfirmed');
        if (VOLATILE_OWNER_ENABLED && !VolatileOwnerFence.publish(AUTH_API_ORIGIN, { uid: user.id, username: user.username }, ended, validForMs, operation.volatileEpoch)) {
          this.ownerLease.revoke(); this.revokeLocal(); throw new Error('Unconfirmed');
        }
        if (OFFLINE_OWNER_ENABLED && published && !NativeAuthHost.offlineOwnerPoisoned) {
          const proof: TrustedOwnerLease | undefined = this.ownerLease.snapshot();
          if (proof !== undefined && proof.uid === user.id) {
            if (this.localLease !== undefined && this.localLease.uid !== proof.uid) this.revokeLocal();
            const confirmedLogin: boolean = operation.transitionProof > 0 && operation.transitionProof === this.syncTransitionStarted &&
              ['register', 'login', 'phone-login', 'huawei-login'].includes(this.syncTransitionAction) &&
              this.syncTransitionExpectedOwner === proof.uid;
            let saved: boolean = false;
            try {
              saved = await this.offlineOwnerFence.saveVerified(AUTH_API_ORIGIN, { uid: proof.uid, username: user.username }, confirmedLogin);
              const after: TrustedOwnerLease | undefined = this.ownerLease.snapshot();
              if (!this.current(operation) || after === undefined || after.uid !== proof.uid || after.authEpoch !== proof.authEpoch) {
                await this.offlineOwnerFence.markPending(AUTH_API_ORIGIN);
                return;
              }
            } catch {
              NativeAuthHost.offlineOwnerPoisoned = true;
              this.ownerLease.revoke();
              this.revokeLocal();
              try { await this.offlineOwnerFence.markPending(AUTH_API_ORIGIN); } catch {}
              throw new Error('Unconfirmed');
            }
            if (!saved) { this.ownerLease.revoke(); this.revokeLocal(); throw new Error('Unconfirmed'); }
          }
        }
        if (COLD_START_PREFETCH_ENABLED && input.action === 'session' && operation.coldProcessVersion !== NativeAuthHost.coldVersion) {
          this.ownerLease.revoke(); this.revokeLocal(); throw new Error('Unconfirmed');
        }
        this.finish(operation, 200, { user: user, capabilities: capabilities(true), session: { validForMs: validForMs } });
        return;
      }
      if (input.action === 'phone-bind') {
        if (!bindingUser || user.id !== bindingUser.id || payload.ok !== true || payload.phone !== input.body?.phone) throw new Error('Unconfirmed');
        const proof: http.HttpResponse = await this.fetch('session', '', token, operation);
        if (this.cookieHeaders(proof).length !== 0) throw new Error('Unconfirmed');
        const confirmed: AuthBody = parseResponseBody(proof.result as string);
        const same: AuthUser | undefined = publicUser(confirmed);
        if (proof.responseCode !== 200 || !same || same.id !== bindingUser.id || confirmed.capabilities?.passwordLogin !== true) throw new Error('Unconfirmed');
        operation.sessionMayHaveChanged = false;
        NativeAuthHost.quarantined = false;
        this.finish(operation, 200, { ok: true, user: same, phone: payload.phone, capabilities: phoneSuccessCapabilities(payload) });
        return;
      }
      if (input.action !== 'session') {
        const cookie: AuthCookie | undefined = sessionCookie(lines, PERSISTENT_SESSION_ENABLED);
        if (!cookie || cookie.token === '' || cookie.maxAge < 1) throw new Error('Unconfirmed');
        if (!this.current(operation)) return;
        await this.store.save(AUTH_API_ORIGIN, cookie.token, cookie.maxAge, PERSISTENT_SESSION_ENABLED);
        if (!this.current(operation)) return;
        // The mutation JSON never selects an identity by itself.
        const proof: http.HttpResponse = await this.fetch('session', '', cookie.token, operation);
        if (this.cookieHeaders(proof).length !== 0) throw new Error('Unconfirmed');
        const confirmed: AuthBody = parseResponseBody(proof.result as string);
        const same: AuthUser | undefined = publicUser(confirmed);
        if (proof.responseCode !== 200 || !same || same.id !== user.id ||
          confirmed.capabilities?.passwordLogin !== true) throw new Error('Unconfirmed');
        user = same;
      }
      operation.sessionMayHaveChanged = false;
      NativeAuthHost.quarantined = false;
      this.finish(operation, 200, { user: user, capabilities: input.action === 'phone-login' ? phoneSuccessCapabilities(payload) : capabilities(true) });
    } catch {
      if (operation.sessionMayHaveChanged) NativeAuthHost.quarantined = true;
      this.finish(operation, 503, operationUnknownBody(input.action));
    } finally {
      clearTimeout(timer);
      // A late asset write after a timeout/navigation must not resurrect a session.
      // Keep the operation slot until cleanup settles; never free it merely on abort.
      if (operation.sessionMayHaveChanged) {
        NativeAuthHost.quarantined = true;
        try { await this.store.clear(); } catch { /* Future session probes must still use the real Asset API. */ }
      }
      NativeAuthHost.busy = false;
    }
  }
}
