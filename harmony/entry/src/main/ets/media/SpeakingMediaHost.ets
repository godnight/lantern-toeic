import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { systemDateTime } from '@kit.BasicServicesKit';
import { utf8Length } from '../auth/AuthPolicy';
import { TrustedOwnerProvider } from './VerifiedOwnerLease';
import { AVRecorderCapture } from './AVRecorderCapture';
import { SpeakingMediaSession } from './SpeakingMediaSession';
import { MediaReply, MediaRequest, MediaScope, mediaId, parseMediaRequest, parseMediaScope,
  MEDIA_CONTROL_BYTES, MEDIA_METADATA_BYTES, MEDIA_CHUNK_BYTES, MEDIA_FRAME_BYTES } from './SpeakingMediaPolicy';

const APP_ORIGIN: string = 'https://lantern.local';
const PROXY_PERMISSION: string = '{"javascriptProxyPermission":{"urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":"/"}],' +
  '"methodList":[{"methodName":"open","urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":"/"}]},' +
  '{"methodName":"detach","urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":"/"}]}]}}';
interface PortRequest { version: number; nonce: string; }
function mainDocument(url: string): boolean { return /^https:\/\/lantern\.local\/?(?:[?#][^\s]*)?$/.test(url); }

/** Independent media port; never uses AuthHost request/response or console logs.
 * The sole transferred capability is issued to the exact packaged main origin.
 * Index additionally forbids child frames/embedding on packaged HTML responses. */
export class SpeakingMediaHost {
  private controller: webview.WebviewController;
  private context: () => common.UIAbilityContext;
  private active: () => boolean;
  private provider: TrustedOwnerProvider;
  private attached: boolean = false;
  private disposed: boolean = false;
  private sequence: number = 0;
  private port: webview.WebMessagePort | undefined = undefined;
  private offered: webview.WebMessagePort | undefined = undefined;
  private session: SpeakingMediaSession | undefined = undefined;
  private seen: Set<string> = new Set<string>();
  private unsubscribe: () => void;

  constructor(controller: webview.WebviewController, context: () => common.UIAbilityContext,
    active: () => boolean, provider: TrustedOwnerProvider) {
    this.controller = controller; this.context = context; this.active = active; this.provider = provider;
    this.unsubscribe = provider.subscribe(() => this.invalidate());
  }

  attach(): boolean {
    if (this.disposed) return false;
    try {
      this.controller.registerJavaScriptProxy(this, 'LanternSpeakingHost', ['open', 'detach'], [], PROXY_PERMISSION);
      this.attached = true; return true;
    } catch { this.attached = false; return false; }
  }

  private documentLive(sequence: number): boolean {
    if (this.disposed || !this.attached || sequence !== this.sequence || !this.active()) return false;
    try { return mainDocument(this.controller.getUrl()); } catch { return false; }
  }

  private trustedCaller(): boolean {
    // Capture synchronously before parsing, callbacks, timers or any await.
    let frame: string;
    try { frame = this.controller.getLastJavascriptProxyCallingFrameUrl(); } catch { return false; }
    return mainDocument(frame) && this.documentLive(this.sequence);
  }

  open(raw: string): string {
    if (!this.trustedCaller() || this.provider.snapshot() === undefined ||
      typeof raw !== 'string' || raw.length > 128 || utf8Length(raw) > 128) return 'UNSUPPORTED';
    let request: PortRequest;
    try { request = JSON.parse(raw) as PortRequest; } catch { return 'UNSUPPORTED'; }
    if (!request || typeof request !== 'object' || Array.isArray(request) || request.version !== 1 ||
      Object.keys(request).sort().join(',') !== 'nonce,version' || !mediaId(request.nonce)) return 'UNSUPPORTED';
    if (this.session?.busy()) return 'BUSY';
    this.invalidate();
    const sequence: number = this.sequence;
    try {
      const ports: webview.WebMessagePort[] = this.controller.createWebMessagePorts(false);
      if (ports.length !== 2) { ports.forEach((port: webview.WebMessagePort) => port.close()); return 'UNSUPPORTED'; }
      this.port = ports[0]; this.offered = ports[1];
      this.session = new SpeakingMediaSession(this.provider, () => this.documentLive(sequence),
        () => new AVRecorderCapture(this.context()),
        () => systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false),
        (reply: MediaReply, bytes?: ArrayBuffer): boolean => this.send(sequence, reply, bytes));
      const session: SpeakingMediaSession = this.session;
      this.port.onMessageEvent((message: webview.WebMessage) => {
        if (!this.documentLive(sequence) || this.provider.snapshot() === undefined) return;
        if (typeof message !== 'string') { this.invalidate(); return; }
        const input: MediaRequest | undefined = parseMediaRequest(message);
        if (input === undefined || this.seen.has(input.id)) return;
        if (this.seen.size >= 4096) { this.invalidate(); return; }
        this.seen.add(input.id);
        session.dispatch(input).catch(() => {
          this.send(sequence, { version: 1, id: input.id, captureId: input.captureId,
            generation: input.generation, state: 'UNKNOWN_CAPTURE', revision: 0, errorCode: 'READ_FAILED' });
        });
      });
      if (!this.documentLive(sequence) || this.provider.snapshot() === undefined) { this.invalidate(); return 'UNSUPPORTED'; }
      this.controller.postMessage('LANTERN_SPEAKING_PORT_V1:' + request.nonce, [this.offered], APP_ORIGIN);
      return 'OFFERED';
    } catch { this.invalidate(); return 'UNSUPPORTED'; }
  }

  detach(raw: string): void {
    if (!this.trustedCaller() || this.provider.snapshot() === undefined) return;
    const scope: MediaScope | undefined = parseMediaScope(raw);
    if (scope !== undefined) this.session?.detach(scope);
  }

  private send(sequence: number, reply: MediaReply, bytes?: ArrayBuffer): boolean {
    if (!this.documentLive(sequence) || this.provider.snapshot() === undefined || this.port === undefined) return false;
    const metadata: string = JSON.stringify(reply);
    if (metadata.length > (bytes === undefined ? MEDIA_CONTROL_BYTES : MEDIA_METADATA_BYTES) ||
      utf8Length(metadata) > (bytes === undefined ? MEDIA_CONTROL_BYTES : MEDIA_METADATA_BYTES)) return false;
    try {
      if (bytes === undefined) this.port.postMessageEvent(metadata);
      else {
        if (bytes.byteLength < 1 || bytes.byteLength > MEDIA_CHUNK_BYTES) return false;
        // All protocol fields are fixed ASCII enums, UUID/hash, MIME or numbers.
        // This avoids an unbounded JSON/base64 audio representation.
        const frame: ArrayBuffer = new ArrayBuffer(4 + metadata.length + bytes.byteLength);
        if (frame.byteLength > MEDIA_FRAME_BYTES) return false;
        const output: Uint8Array = new Uint8Array(frame);
        new DataView(frame).setUint32(0, metadata.length, true);
        for (let i: number = 0; i < metadata.length; i++) {
          const code: number = metadata.charCodeAt(i); if (code > 127) return false;
          output[i + 4] = code;
        }
        output.set(new Uint8Array(bytes), 4 + metadata.length);
        this.port.postMessageEvent(frame);
      }
      return true;
    } catch { this.invalidate(); return false; }
  }

  invalidate(): void {
    this.sequence++;
    this.session?.invalidate(); this.session = undefined;
    try { this.port?.close(); } catch { /* Already detached. */ }
    try { this.offered?.close(); } catch { /* Already transferred/closed. */ }
    this.port = undefined; this.offered = undefined; this.seen.clear();
  }

  dispose(): void {
    this.invalidate(); this.disposed = true; this.attached = false; this.unsubscribe();
    try { this.controller.deleteJavaScriptRegister('LanternSpeakingHost'); } catch { /* Already detached. */ }
  }
}
