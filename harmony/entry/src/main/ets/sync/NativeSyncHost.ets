// Candidate only; place beside app's auth/media modules only after review.
// Does not register itself and is disabled unless native integration opts in.
import { webview } from '@kit.ArkWeb';
import http from '@ohos.net.http';
import deviceInfo from '@ohos.deviceInfo';
import { AUTH_API_ORIGIN } from '../auth/AuthConfiguration';
import { COOKIE_NAME, configuredOrigin, trustedFrame, utf8Length } from '../auth/AuthPolicy';
import { TrustedOwnerLease, TrustedOwnerProvider } from '../media/VerifiedOwnerLease';

// Implemented by the auth host's shared, process-wide coordinator, NOT by JS.
// It must serialize auth mutations, honor auth quarantine and validate the
// lease before loading the Asset token and until the callback settles.
export interface SyncAuthGate {
  withSession(lease: TrustedOwnerLease, work: (token: string) => Promise<void>): Promise<void>;
}
interface SyncEvent { id: string; wordId: string; createdAt: string; type: string;
  grade?: string; starred?: boolean; revision?: number; reviewId?: string; reviewHash?: string; }
interface SyncRequest { id: string; action: string; owner: string; event?: SyncEvent;
  pageSize?: number; snapshot?: string; cursor?: string; }
interface SyncBody { owner: string; event?: SyncEvent; pageSize?: number; snapshot?: string; cursor?: string; }
interface SyncResult { ok?: boolean; owner: string; id: string; upper?: number; cursor?: string;
  events?: SyncEvent[]; next?: string | null; }
interface SyncReply { id: string; status: number; body: SyncResult | SyncFailure; }
interface SyncFailure { code: string; }
interface Operation { input: SyncRequest; lease: TrustedOwnerLease; generation: number; cancelled: boolean; }

const LIMIT: number = 262144;
const PERMISSION: string = '{"javascriptProxyPermission":{"urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}],' +
  '"methodList":[{"methodName":"request","urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}]},' +
  '{"methodName":"cancel","urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}]},' +
  '{"methodName":"drain","urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}]}]}}';
function exact(value: Object, names: string[]): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === names.sort().join(',');
}
function id(value: string | undefined): boolean {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
}
function cursor(value: string | undefined): boolean {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
function owner(value: string): boolean {
  return typeof value === 'string' && /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function uuid(value: string | undefined): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function validEvent(event: SyncEvent | undefined): boolean {
  if (event === undefined || event === null || typeof event !== 'object' || Array.isArray(event)) return false;
  const keys: string[] = event.type === 'review' ? ['id','wordId','createdAt','type','grade'] :
    event.type === 'mark' ? ['id','wordId','createdAt','type','starred','revision'] :
    event.type === 'review-correction' ? ['id','wordId','createdAt','type','reviewId','reviewHash','grade'] : [];
  if (keys.length === 0 || !exact(event,keys) || !id(event.id) || !id(event.wordId) ||
    typeof event.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(event.createdAt) ||
    !Number.isFinite(Date.parse(event.createdAt))) return false;
  if (event.type === 'mark') return typeof event.starred === 'boolean' && Number.isSafeInteger(event.revision) && (event.revision as number) >= 1;
  if (event.grade !== 'remembered' && event.grade !== 'again') return false;
  if (event.type === 'review-correction') return event.grade === 'again' && event.reviewId !== event.id && id(event.reviewId) && typeof event.reviewHash === 'string' && /^[a-f0-9]{64}$/.test(event.reviewHash);
  return true;
}
function parse(raw: string): SyncRequest | undefined {
  if (typeof raw !== 'string' || utf8Length(raw) > 8192) return undefined;
  let input: SyncRequest;
  try { input = JSON.parse(raw) as SyncRequest; } catch { return undefined; }
  if (!input || !uuid(input.id) || !owner(input.owner)) return undefined;
  if (input.action === 'append' && exact(input,['id','action','owner','event']) && validEvent(input.event)) return input;
  if (input.action === 'snapshot' && exact(input,['id','action','owner','pageSize']) &&
    Number.isInteger(input.pageSize) && (input.pageSize as number) >= 1 && (input.pageSize as number) <= 100) return input;
  if (input.action === 'page' && exact(input,['id','action','owner','snapshot','cursor']) && uuid(input.snapshot) && cursor(input.cursor)) return input;
  return undefined;
}
function resultValid(input: SyncRequest, output: SyncResult): boolean {
  if (!output || output.owner !== input.owner) return false;
  if (input.action === 'append') return exact(output,['ok','owner','id']) && output.ok === true && output.id === input.event?.id;
  if (input.action === 'snapshot') return exact(output,['id','owner','upper','cursor']) && uuid(output.id) &&
    Number.isSafeInteger(output.upper) && (output.upper as number) >= 0 && cursor(output.cursor);
  return exact(output,['owner','id','upper','cursor','events','next']) && output.id === input.snapshot &&
    output.cursor === input.cursor && Number.isSafeInteger(output.upper) && (output.upper as number) >= 0 &&
    Array.isArray(output.events) && output.events.length <= 100 && output.events.every(validEvent) &&
    (output.next === null || cursor(output.next as string)) && output.next !== output.cursor;
}
function path(action: string): string {
  if (action === 'append') return '/candidate/sync/append';
  if (action === 'snapshot') return '/candidate/sync/snapshot';
  if (action === 'page') return '/candidate/sync/page';
  throw new Error('invalid operation');
}

export class NativeSyncHost {
  private controller: webview.WebviewController;
  private active: () => boolean;
  private provider: TrustedOwnerProvider;
  private gate: SyncAuthGate;
  private enabled: boolean;
  private attached: boolean = false;
  private disposed: boolean = false;
  private generation: number = 0;
  private operation: Operation | undefined = undefined;
  private network: http.HttpRequest | undefined = undefined;
  private unsubscribe: () => void;
  private seen: Set<string> = new Set<string>();
  private drainWaiters: string[] = [];
  private draining: boolean = true;
  constructor(controller: webview.WebviewController, active: () => boolean,
    provider: TrustedOwnerProvider, gate: SyncAuthGate, enabled: boolean = false) {
    this.controller = controller; this.active = active; this.provider = provider; this.gate = gate; this.enabled = enabled;
    this.unsubscribe = provider.subscribe(() => this.invalidate());
  }
  attach(): boolean {
    if (this.disposed || !this.enabled || !configuredOrigin(AUTH_API_ORIGIN) || deviceInfo.sdkApiVersion < 23 ||
      !canIUse('SystemCapability.Communication.NetStack')) return false;
    try { this.controller.registerJavaScriptProxy(this,'LanternSyncHost',['request','cancel','drain'],[],PERMISSION); this.attached = true; return true; }
    catch { return false; }
  }
  private live(generation: number): boolean {
    if (this.disposed || !this.attached || !this.active() || generation !== this.generation) return false;
    try { return trustedFrame(this.controller.getUrl()); } catch { return false; }
  }
  private caller(): boolean {
    try { return trustedFrame(this.controller.getLastJavascriptProxyCallingFrameUrl()) && this.live(this.generation); }
    catch { return false; }
  }
  private current(op: Operation): boolean {
    if (op.cancelled || this.operation !== op || !this.live(op.generation)) return false;
    const lease: TrustedOwnerLease | undefined = this.provider.snapshot();
    return lease !== undefined && lease.uid === op.lease.uid && lease.authEpoch === op.lease.authEpoch &&
      lease.expiresAtUptimeMs === op.lease.expiresAtUptimeMs;
  }
  request(raw: string): void {
    if (!this.caller()) return;
    const input: SyncRequest | undefined = parse(raw);
    const lease: TrustedOwnerLease | undefined = this.provider.snapshot();
    if (!input || !lease || input.owner !== lease.uid || this.seen.has(input.id)) return;
    if (this.seen.size >= 4096) { this.send(input.id,503,{code:'request_limit'},this.generation); return; }
    this.seen.add(input.id);
    if (this.draining || this.operation !== undefined) { this.send(input.id,503,{code:'busy'},this.generation); return; }
    const op: Operation = { input: input, lease: lease, generation: this.generation, cancelled: false };
    this.operation = op;
    this.perform(op).catch(() => {});
  }
  cancel(raw: string): void {
    if (!this.caller() || typeof raw !== 'string' || !uuid(raw)) return;
    if (this.operation?.input.id === raw) { this.operation.cancelled = true; try { this.network?.destroy(); } catch {} }
  }
  // Confirmation is sent only after the in-flight native operation has left
  // the shared auth gate. Cancellation itself is not server-side rollback.
  drain(raw: string): void {
    if (!this.caller() || !uuid(raw) || this.drainWaiters.length >= 16 || this.drainWaiters.includes(raw)) return;
    this.draining = true;
    if (this.operation === undefined) { this.replyDrain(raw); return; }
    this.drainWaiters.push(raw);
  }
  // Native-only: never included in the JavaScript proxy method list. The
  // lifecycle observer resumes both bridges together after checking one lease.
  canResume(ownerId: string): boolean {
    const lease: TrustedOwnerLease | undefined = this.provider.snapshot();
    return this.live(this.generation) && this.operation === undefined && lease !== undefined && lease.uid === ownerId;
  }
  resumeForOwner(ownerId: string): boolean {
    if (!this.canResume(ownerId)) return false;
    this.draining = false;
    return true;
  }
  freeze(): void { this.draining = true; }
  private replyDrain(idValue: string): void {
    if (!this.live(this.generation)) return;
    const message: string = JSON.stringify({id:idValue,source:'vocabulary'}).replace(/</g,'\\u003c');
    try { this.controller.runJavaScript('(function(){if(typeof window.__lanternSyncDrainReceive==="function")window.__lanternSyncDrainReceive('+message+');})()').catch(() => {}); } catch {}
  }
  private flushDrains(): void {
    const waiting: string[] = this.drainWaiters; this.drainWaiters = [];
    waiting.forEach((idValue: string) => this.replyDrain(idValue));
  }
  invalidate(): void {
    this.drainWaiters = [];
    this.draining = true;
    this.generation++;
    if (this.operation) this.operation.cancelled = true;
    try { this.network?.destroy(); } catch {}
    this.seen.clear();
  }
  dispose(): void {
    this.invalidate(); this.disposed = true; this.unsubscribe(); this.attached = false;
    try { this.controller.deleteJavaScriptRegister('LanternSyncHost'); } catch {}
  }
  private send(idValue: string, status: number, body: SyncResult | SyncFailure, generation: number): void {
    if (!this.live(generation)) return;
    const message: SyncReply = {id:idValue,status:status,body:body};
    const safe: string = JSON.stringify(message).replace(/</g,'\\u003c');
    try { this.controller.runJavaScript('(function(){if(typeof window.__lanternSyncReceive==="function")window.__lanternSyncReceive(' + safe + ');})()').catch(() => {}); } catch {}
  }
  private async perform(op: Operation): Promise<void> {
    try {
      await this.gate.withSession(op.lease, async (token: string): Promise<void> => {
        if (!this.current(op) || !/^[a-f0-9]{64}$/.test(token)) throw new Error('unavailable');
        const input: SyncRequest = op.input;
        const body: SyncBody = {owner:op.lease.uid};
        if (input.action === 'append') body.event = input.event;
        else if (input.action === 'snapshot') body.pageSize = input.pageSize;
        else { body.snapshot = input.snapshot; body.cursor = input.cursor; }
        const request: http.HttpRequest = http.createHttp(); this.network = request;
        const options: http.HttpRequestOptions = { method:http.RequestMethod.POST,
          header:{'Accept':'application/json','Content-Type':'application/json','Origin':AUTH_API_ORIGIN,'Cookie':COOKIE_NAME + '=' + token},
          extraData:JSON.stringify(body), usingCache:false, expectDataType:http.HttpDataType.STRING,
          connectTimeout:10000, readTimeout:10000, maxLimit:LIMIT, maxRedirects:0 };
        try {
          const response: http.HttpResponse = await request.request(AUTH_API_ORIGIN + path(input.action),options);
          if (!this.current(op) || response.responseCode !== 200 || typeof response.result !== 'string' || utf8Length(response.result) > LIMIT) throw new Error('unavailable');
          const headers: Record<string,string | string[]> = response.header as Record<string,string | string[]>;
          let contentType: boolean = false;
          if (!headers || Object.keys(headers).length > 64) throw new Error('unavailable');
          for (const name of Object.keys(headers)) {
            if (name.toLowerCase() === 'set-cookie') throw new Error('unavailable');
            if (name.toLowerCase() === 'content-type') {
              const value: string | string[] = headers[name];
              if (typeof value !== 'string' || value.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('unavailable');
              contentType = true;
            }
          }
          if (!contentType) throw new Error('unavailable');
          const output: SyncResult = JSON.parse(response.result) as SyncResult;
          if (!resultValid(input,output) || !this.current(op)) throw new Error('unavailable');
          this.send(input.id,200,output,op.generation);
        } finally { try { request.destroy(); } catch {} if (this.network === request) this.network = undefined; }
      });
    } catch { if (this.current(op)) this.send(op.input.id,503,{code:'unavailable'},op.generation); }
    finally { if (this.operation === op) { this.operation = undefined; this.flushDrains(); } }
  }
}
