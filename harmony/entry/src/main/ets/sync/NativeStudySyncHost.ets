// Experimental, default-off, not registered in product. No arbitrary HTTP API.
import { webview } from '@kit.ArkWeb';
import http from '@ohos.net.http';
import deviceInfo from '@ohos.deviceInfo';
import { AUTH_API_ORIGIN } from '../auth/AuthConfiguration';
import { COOKIE_NAME, configuredOrigin, trustedFrame, utf8Length } from '../auth/AuthPolicy';
import { TrustedOwnerLease, TrustedOwnerProvider } from '../media/VerifiedOwnerLease';
import { SyncAuthGate } from './NativeSyncHost';

interface StudyData { id: string; qid?: string; choice?: number; correct?: boolean; mode?: string; firstAttemptId?: string;
  createdAt: string; seconds?: number; date?: string; minutes?: number; load?: string; note?: string; }
interface StudyWire { id: string; owner: string; type: string; data: StudyData; }
interface StudyRequest { id: string; action: string; owner: string; wire?: StudyWire; checkpoint?: string | null; continuation?: string | null; }
interface StudyChange { kind: string; id: string; data: StudyData; }
interface StudyResult { ok?: boolean; syncProtocol?: string; schemaVersion?: number; owner?: string; hasProfile?: boolean;
  profilePolicy?: string; changes?: StudyChange[]; nextCursor?: string | null; checkpoint?: string | null; }
interface Failure { code: string; }
interface Reply { id: string; status: number; body: StudyResult | Failure; }
interface Operation { input: StudyRequest; lease: TrustedOwnerLease; generation: number; cancelled: boolean; }

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
function uuid(value: string | undefined): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function owner(value: string | undefined): boolean {
  return typeof value === 'string' && /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function token(value: string | null | undefined): boolean {
  return value === null || typeof value === 'string' && /^n1\.[A-Za-z0-9_-]{2086}$/.test(value);
}
function stamp(value: string): boolean {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
}
function dataValid(kind: string, data: StudyData, outgoing: boolean): boolean {
  if (!data || !uuid(data.id) || !stamp(data.createdAt)) return false;
  if (kind === 'attempt') {
    const fields: string[] = outgoing ? (data.firstAttemptId === undefined ? ['id','qid','choice','createdAt','seconds'] : ['id','qid','choice','createdAt','seconds','firstAttemptId']) : ['id','qid','choice','correct','createdAt','seconds','mode'];
    return exact(data,fields) && typeof data.qid === 'string' && data.qid.length > 0 && data.qid.length <= 100 &&
      (!outgoing || data.firstAttemptId === undefined || uuid(data.firstAttemptId)) &&
      Number.isInteger(data.choice) && (data.choice as number) >= 0 && (data.choice as number) <= 3 &&
      Number.isInteger(data.seconds) && (data.seconds as number) >= 0 && (data.seconds as number) <= 7200 &&
      (outgoing || typeof data.correct === 'boolean' && ['first','review'].includes(data.mode as string));
  }
  if (kind === 'checkin') return exact(data,['id','date','minutes','load','note','createdAt']) &&
    typeof data.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(data.date) &&
    Number.isInteger(data.minutes) && (data.minutes as number) >= 1 && (data.minutes as number) <= 240 &&
    ['轻','刚好','重'].includes(data.load as string) && typeof data.note === 'string' && data.note.length <= 1000;
  return false;
}
function parse(raw: string): StudyRequest | undefined {
  if (typeof raw !== 'string' || utf8Length(raw) > 12288) return undefined;
  let input: StudyRequest;
  try { input = JSON.parse(raw) as StudyRequest; } catch { return undefined; }
  if (!input || !uuid(input.id) || !owner(input.owner)) return undefined;
  if (input.action === 'upload' && exact(input,['id','action','owner','wire'])) {
    const wire: StudyWire | undefined = input.wire;
    if (!wire || !exact(wire,['id','owner','type','data']) || !uuid(wire.id) || wire.owner !== input.owner ||
      !dataValid(wire.type,wire.data,true) || utf8Length(JSON.stringify(wire)) > 8192) return undefined;
    return input;
  }
  if (input.action === 'pull' && exact(input,['id','action','owner','checkpoint','continuation']) &&
    token(input.checkpoint) && token(input.continuation) && !(input.checkpoint && input.continuation)) return input;
  return undefined;
}
function responseValid(input: StudyRequest, result: StudyResult): boolean {
  if (!result) return false;
  if (input.action === 'upload') return exact(result,['ok']) && result.ok === true;
  if (!exact(result,['syncProtocol','schemaVersion','owner','hasProfile','profilePolicy','changes','nextCursor','checkpoint']) ||
    result.syncProtocol !== 'native-m2a-v1' || result.schemaVersion !== 2 || result.owner !== input.owner ||
    result.hasProfile !== false || result.profilePolicy !== 'preserve-local-when-absent' ||
    !Array.isArray(result.changes) || result.changes.length > 100 || !token(result.nextCursor) || !token(result.checkpoint) ||
    Boolean(result.nextCursor) === Boolean(result.checkpoint)) return false;
  for (const change of result.changes) {
    if (!exact(change,['kind','id','data']) || !dataValid(change.kind,change.data,false) || change.id !== change.data.id) return false;
  }
  return true;
}

export class NativeStudySyncHost {
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
  constructor(controller: webview.WebviewController, active: () => boolean, provider: TrustedOwnerProvider,
    gate: SyncAuthGate, enabled: boolean = false) {
    this.controller=controller; this.active=active; this.provider=provider; this.gate=gate; this.enabled=enabled;
    this.unsubscribe=provider.subscribe(() => this.invalidate());
  }
  attach(): boolean {
    if (this.disposed || !this.enabled || !configuredOrigin(AUTH_API_ORIGIN) || deviceInfo.sdkApiVersion < 23 ||
      !canIUse('SystemCapability.Communication.NetStack')) return false;
    try { this.controller.registerJavaScriptProxy(this,'LanternStudySyncHost',['request','cancel','drain'],[],PERMISSION);this.attached=true;return true; }
    catch { return false; }
  }
  private live(generation: number): boolean {
    if (this.disposed || !this.attached || !this.active() || generation !== this.generation) return false;
    try { return trustedFrame(this.controller.getUrl()); } catch { return false; }
  }
  private caller(): boolean {
    try { return trustedFrame(this.controller.getLastJavascriptProxyCallingFrameUrl()) && this.live(this.generation); } catch { return false; }
  }
  private current(op: Operation): boolean {
    if (op.cancelled || this.operation !== op || !this.live(op.generation)) return false;
    const lease: TrustedOwnerLease | undefined=this.provider.snapshot();
    return lease !== undefined && lease.uid===op.lease.uid && lease.authEpoch===op.lease.authEpoch &&
      lease.expiresAtUptimeMs===op.lease.expiresAtUptimeMs;
  }
  request(raw: string): void {
    if (!this.caller()) return;
    const input: StudyRequest | undefined=parse(raw), lease: TrustedOwnerLease | undefined=this.provider.snapshot();
    if (!input || !lease || input.owner!==lease.uid || this.seen.has(input.id)) return;
    if (this.seen.size>=4096) { this.send(input.id,503,{code:'request_limit'},this.generation); return; }
    this.seen.add(input.id);
    if (this.draining || this.operation !== undefined) { this.send(input.id,503,{code:'busy'},this.generation);return; }
    const op: Operation={input:input,lease:lease,generation:this.generation,cancelled:false};
    this.operation=op;this.perform(op).catch(() => {});
  }
  cancel(raw: string): void {
    if (!this.caller() || !uuid(raw)) return;
    if (this.operation?.input.id===raw) { this.operation.cancelled=true;try { this.network?.destroy(); } catch {} }
  }
  drain(raw: string): void {
    if (!this.caller() || !uuid(raw) || this.drainWaiters.length>=16 || this.drainWaiters.includes(raw)) return;
    this.draining=true;
    if (this.operation===undefined) { this.replyDrain(raw);return; }
    this.drainWaiters.push(raw);
  }
  // Native-only; the lifecycle observer resumes both bridges together.
  canResume(ownerId: string): boolean {
    const lease: TrustedOwnerLease | undefined=this.provider.snapshot();
    return this.live(this.generation) && this.operation===undefined && lease!==undefined && lease.uid===ownerId;
  }
  resumeForOwner(ownerId: string): boolean {
    if (!this.canResume(ownerId)) return false;
    this.draining=false;
    return true;
  }
  freeze(): void { this.draining=true; }
  private replyDrain(id: string): void {
    if (!this.live(this.generation)) return;
    const message: string=JSON.stringify({id:id,source:'study'}).replace(/</g,'\\u003c');
    try { this.controller.runJavaScript('(function(){if(typeof window.__lanternSyncDrainReceive==="function")window.__lanternSyncDrainReceive('+message+');})()').catch(() => {}); } catch {}
  }
  private flushDrains(): void {
    const waiting: string[]=this.drainWaiters;this.drainWaiters=[];
    waiting.forEach((id: string)=>this.replyDrain(id));
  }
  invalidate(): void {
    this.drainWaiters=[];
    this.draining=true;
    this.generation++;if (this.operation) this.operation.cancelled=true;
    try { this.network?.destroy(); } catch {} this.seen.clear();
  }
  dispose(): void {
    this.invalidate();this.disposed=true;this.unsubscribe();this.attached=false;
    try { this.controller.deleteJavaScriptRegister('LanternStudySyncHost'); } catch {}
  }
  private send(id: string,status: number,body: StudyResult | Failure,generation: number): void {
    if (!this.live(generation)) return;
    const reply: Reply={id:id,status:status,body:body};
    const safe: string=JSON.stringify(reply).replace(/</g,'\\u003c');
    try { this.controller.runJavaScript('(function(){if(typeof window.__lanternStudySyncReceive==="function")window.__lanternStudySyncReceive('+safe+');})()').catch(() => {}); } catch {}
  }
  private async perform(op: Operation): Promise<void> {
    let networkStarted: boolean=false, responseReceived: boolean=false;
    try {
      await this.gate.withSession(op.lease,async (secret: string): Promise<void> => {
        if (!this.current(op) || !/^[a-f0-9]{64}$/.test(secret)) throw new Error('unavailable');
        const input: StudyRequest=op.input, upload: boolean=input.action==='upload';
        let path: string='/api/study';
        if (!upload) {
          path+='?sync=native-m2a-v1';
          if (input.continuation) path+='&cursor='+input.continuation;
          else if (input.checkpoint) path+='&checkpoint='+input.checkpoint;
        }
        const headers: Record<string,string>={'Accept':'application/json','Origin':AUTH_API_ORIGIN,
          'Cookie':COOKIE_NAME+'='+secret,'X-Lantern-Owner':op.lease.uid};
        if (upload) headers['Content-Type']='application/json';
        const request: http.HttpRequest=http.createHttp();this.network=request;
        const options: http.HttpRequestOptions={method:upload?http.RequestMethod.POST:http.RequestMethod.GET,
          header:headers,usingCache:false,expectDataType:http.HttpDataType.STRING,connectTimeout:10000,
          readTimeout:10000,maxLimit:LIMIT,maxRedirects:0};
        if (upload) options.extraData=JSON.stringify(input.wire);
        try {
          networkStarted=true;
          const response: http.HttpResponse=await request.request(AUTH_API_ORIGIN+path,options);
          responseReceived=true;
          if (!this.current(op)) throw new Error('unavailable');
          if (response.responseCode===401 || response.responseCode===403) { this.send(input.id,401,{code:'unauthenticated'},op.generation); return; }
          if (response.responseCode===409) {
            let code: string='conflict';
            const conflictHeaders: Record<string,string | string[]>=response.header as Record<string,string | string[]>;
            if (upload && conflictHeaders && Object.keys(conflictHeaders).length<=64 && typeof response.result==='string' && utf8Length(response.result)<=LIMIT) {
              let json: boolean=false, cookie: boolean=false;
              for (const name of Object.keys(conflictHeaders)) {
                if (name.toLowerCase()==='set-cookie') cookie=true;
                if (name.toLowerCase()==='content-type') { const v: string | string[]=conflictHeaders[name];json=typeof v==='string'&&v.split(';')[0].trim().toLowerCase()==='application/json'; }
              }
              if (json && !cookie) try { const body: Failure=JSON.parse(response.result) as Failure;
                if (body && exact(body,['code']) && ['event-payload-conflict','attempt-order-unproven'].includes(body.code)) code='event_conflict';
              } catch {}
            }
            this.send(input.id,409,{code:code},op.generation); return;
          }
          if ([408,429,500,502,503,504].includes(response.responseCode)) { this.send(input.id,503,{code:'unavailable'},op.generation); return; }
          if (response.responseCode!==200 || typeof response.result!=='string' || utf8Length(response.result)>LIMIT) throw new Error('unavailable');
          const replyHeaders: Record<string,string | string[]>=response.header as Record<string,string | string[]>;
          if (!replyHeaders || Object.keys(replyHeaders).length>64) throw new Error('unavailable');
          let contentType: boolean=false;
          for (const name of Object.keys(replyHeaders)) {
            if (name.toLowerCase()==='set-cookie') throw new Error('unavailable');
            if (name.toLowerCase()==='content-type') {
              const value: string | string[]=replyHeaders[name];
              if (typeof value!=='string' || value.split(';')[0].trim().toLowerCase()!=='application/json') throw new Error('unavailable');
              contentType=true;
            }
          }
          if (!contentType) throw new Error('unavailable');
          const result: StudyResult=JSON.parse(response.result) as StudyResult;
          if (!responseValid(input,result) || !this.current(op)) throw new Error('unavailable');
          this.send(input.id,200,result,op.generation);
        } finally { try { request.destroy(); } catch {} if (this.network===request) this.network=undefined; }
      });
    } catch { if (this.current(op)) this.send(op.input.id,503,{code:networkStarted&&!responseReceived?'unavailable':'rejected'},op.generation); }
    finally { if (this.operation===op) { this.operation=undefined;this.flushDrains(); } }
  }
}
