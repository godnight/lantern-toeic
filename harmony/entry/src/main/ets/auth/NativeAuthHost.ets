import { webview } from '@kit.ArkWeb';
import http from '@ohos.net.http';
import deviceInfo from '@ohos.deviceInfo';
import { systemDateTime } from '@kit.BasicServicesKit';
import { AuthSessionStore } from './AuthSessionStore';
import { VerifiedOwnerLease, TrustedOwnerProvider } from '../media/VerifiedOwnerLease';
import { AUTH_API_ORIGIN } from './AuthConfiguration';
import { AuthRequest, AuthBody, AuthReply, AuthUser, AuthCookie, AuthRoute, COOKIE_NAME,
  AUTH_TIMEOUT_MS, MAX_RESPONSE_BYTES, trustedFrame, configuredOrigin, parseAuthRequest,
  utf8Length, capabilities, unavailableBody, unknownBody, unauthenticatedBody,
  parseResponseBody, publicUser, publicFailure, sessionCookie, authRoute, phoneAction,
  operationUnknownBody, phoneStatus, phoneChallenge, phoneFailure, phoneSuccessCapabilities, sessionProofBudget } from './AuthPolicy';

interface Operation {
  version?: number;
  id: string;
  action: string;
  epoch: number;
  ownerLeaseEpoch: number;
  timedOut: boolean;
  replied: boolean;
  sessionMayHaveChanged: boolean;
}

// ArkWeb compares the serialized URL port: default HTTPS is empty, not "443".
// An empty permission port skips that engine check; request() still captures the
// caller synchronously and trustedFrame/live enforce the exact local HTTPS authority.
const PROXY_PERMISSION: string = '{"javascriptProxyPermission":{"urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}],' +
  '"methodList":[{"methodName":"request","urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}]}]}}';

/** Auth-only bridge. No private API, arbitrary URL, header, filesystem or cookie API. */
export class NativeAuthHost {
  private controller: webview.WebviewController;
  private active: () => boolean;
  private store: AuthSessionStore = new AuthSessionStore();
  private ownerLease: VerifiedOwnerLease = new VerifiedOwnerLease();
  private epoch: number = 0;
  private attached: boolean = false;
  private disposed: boolean = false;
  // The Web component can recreate a host while an old native request is still
  // settling. Its lock/quarantine belongs to the process, not to that page.
  private static busy: boolean = false;
  private static quarantined: boolean = false;
  private static retryAt: number = 0;
  private seen: string[] = [];
  private network: http.HttpRequest | undefined = undefined;

  constructor(controller: webview.WebviewController, active: () => boolean) {
    this.controller = controller;
    this.active = active;
  }

  attach(): boolean {
    if (this.disposed) return false;
    try {
      // request is synchronous only long enough to capture the calling frame.
      // Its eventual result is delivered with requestId, not a proxy Promise.
      this.controller.registerJavaScriptProxy(this, 'LanternAuthHost', ['request'], [], PROXY_PERMISSION);
      this.attached = true;
      return true;
    } catch {
      this.attached = false;
      return false;
    }
  }

  invalidate(): void {
    this.ownerLease.revoke();
    this.epoch++;
    this.seen = [];
    // Do not abort merely because the page changed: that is not server rollback.
    // Busy stays held until the real HTTP and any Asset call/cleanup settle.
  }

  // Native consumers only. Only request() is on the registered JS method list.
  trustedOwnerProvider(): TrustedOwnerProvider { return this.ownerLease; }

  dispose(): void {
    this.invalidate();
    this.disposed = true;
    this.attached = false;
    try { this.controller.deleteJavaScriptRegister('LanternAuthHost'); } catch { /* Already detached. */ }
  }

  request(raw: string): void {
    // This getter MUST precede any await, timer, Promise or asynchronous dispatch.
    let frame: string;
    const epoch: number = this.epoch;
    try { frame = this.controller.getLastJavascriptProxyCallingFrameUrl(); } catch { return; }
    if (!trustedFrame(frame) || !this.live(epoch)) return;
    this.ownerLease.revoke();
    const input: AuthRequest | undefined = parseAuthRequest(raw);
    if (input === undefined) return;
    // Never send a duplicate id that could overwrite the original operation's reply.
    if (this.seen.includes(input.id)) return;
    if (this.seen.length >= 256) {
      this.send(input.id, 429, { code: 'too-many-attempts', error: '请稍后重新打开账号页。' }, epoch, input.version);
      return;
    }
    this.seen.push(input.id);
    if (!this.available()) {
      this.send(input.id, 503, unavailableBody(input.action), epoch, input.version);
      return;
    }
    if (input.action !== 'session' && input.action !== 'phone-status') {
      const now: number = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
      if (Number.isFinite(now) && now < NativeAuthHost.retryAt) {
        this.send(input.id, 429, { code: 'too-many-attempts', error: '请稍后重试。' }, epoch, input.version);
        return;
      }
    }
    if (NativeAuthHost.busy) {
      this.send(input.id, 503, operationUnknownBody(input.action), epoch, input.version);
      return;
    }
    NativeAuthHost.busy = true;
    const operation: Operation = { id: input.id, action: input.action, version: input.version, epoch: epoch, ownerLeaseEpoch: this.ownerLease.version(), timedOut: false, replied: false, sessionMayHaveChanged: false };
    this.run(input, operation).catch(() => { /* run publishes only sanitized failures. */ });
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
    return !operation.timedOut && this.live(operation.epoch);
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
    return lines;
  }

  private async fetch(action: string, body: string, token: string | undefined,
    operation: Operation): Promise<http.HttpResponse> {
    if (!this.current(operation) || !this.available()) throw new Error('Unconfirmed');
    // There is no caller supplied URL or method. Eight exact routes only.
    const route: AuthRoute | undefined = authRoute(action);
    if (route === undefined) throw new Error('Unconfirmed');
    const headers: Record<string, string> = { 'Accept': 'application/json', 'Origin': AUTH_API_ORIGIN };
    if (action === 'session' && operation.version === 2) headers['X-Lantern-Session-Proof'] = '2';
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
      if (!this.current(operation) || response.responseCode >= 300 && response.responseCode < 400 ||
        typeof response.result !== 'string' || utf8Length(response.result) > MAX_RESPONSE_BYTES) throw new Error('Unconfirmed');
      return response;
    } finally {
      try { request.destroy(); } catch { /* This request belongs to this operation. */ }
      if (this.network === request) this.network = undefined;
    }
  }

  private async run(input: AuthRequest, operation: Operation): Promise<void> {
    const timer: number = setTimeout(() => {
      if (!this.current(operation)) return;
      operation.timedOut = true;
      operation.replied = true;
      // A UI deadline is not HTTP completion. Keep the operation slot until the
      // real native request/Asset operation settles, even after publishing 503.
      this.send(operation.id, 503, operationUnknownBody(input.action), operation.epoch, operation.version);
    }, AUTH_TIMEOUT_MS);
    try {
      let token: string | undefined = undefined;
      if (NativeAuthHost.quarantined) await this.store.clear();
      else token = await this.store.load(AUTH_API_ORIGIN);
      if (!this.current(operation)) return;
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
      const started: number = input.version === 2 ? systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false) : 0;
      if (input.version === 2 && (!Number.isFinite(started) || started < 0)) throw new Error('Unconfirmed');
      const response: http.HttpResponse = await this.fetch(input.action, body, token, operation);
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
      // A challenge has only one success shape/status; 200 cannot mean sent.
      if (input.action === 'phone-challenge') throw new Error('Unconfirmed');
      if (input.action === 'logout') {
        const cookie: AuthCookie | undefined = sessionCookie(lines);
        if (!cookie || cookie.token !== '' || cookie.maxAge !== 0 || payload.ok !== true) throw new Error('Unconfirmed');
        await this.store.clear();
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
        if (this.current(operation)) this.ownerLease.publishVerifiedV2(user.id, ended, validForMs, operation.ownerLeaseEpoch);
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
        const cookie: AuthCookie | undefined = sessionCookie(lines);
        if (!cookie || cookie.token === '' || cookie.maxAge < 1) throw new Error('Unconfirmed');
        if (!this.current(operation)) return;
        await this.store.save(AUTH_API_ORIGIN, cookie.token, cookie.maxAge);
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
