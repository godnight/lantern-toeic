import { webview } from '@kit.ArkWeb';
import { trustedFrame } from '../auth/AuthPolicy';
import { TrustedOwnerLease, TrustedOwnerProvider } from '../media/VerifiedOwnerLease';
import { NativeSyncHost } from './NativeSyncHost';
import { NativeStudySyncHost } from './NativeStudySyncHost';

interface LifecycleMessage { kind: string; seq: number; id?: string; owner?: string | null; }
const PERMISSION: string = '{"javascriptProxyPermission":{"urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}],' +
  '"methodList":[{"methodName":"snapshot","urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}]},' +
  '{"methodName":"hold","urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}]},' +
  '{"methodName":"resume","urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":""}]}]}}';

// The observer transmits only a verified owner identifier and a revocation
// sequence. It never reads or sends the Asset token and starts disabled.
export class NativeLifecycleObserver {
  private controller: webview.WebviewController;
  private provider: TrustedOwnerProvider;
  private active: () => boolean;
  private enabled: boolean;
  private sync: NativeSyncHost;
  private study: NativeStudySyncHost;
  private accountChangePending: boolean = false;
  private unsubscribe: () => void;
  private attached: boolean = false;
  private disposed: boolean = false;
  private seq: number = 0;
  constructor(controller: webview.WebviewController, provider: TrustedOwnerProvider, active: () => boolean,
    sync: NativeSyncHost, study: NativeStudySyncHost, enabled: boolean = false) {
    this.controller=controller;this.provider=provider;this.active=active;this.enabled=enabled;
    this.sync=sync;this.study=study;
    this.unsubscribe=provider.subscribe(() => this.revoked());
  }
  attach(): boolean {
    if (this.disposed || !this.enabled) return false;
    try { this.controller.registerJavaScriptProxy(this,'LanternLifecycleHost',['snapshot','hold','resume'],[],PERMISSION);this.attached=true;return true; }
    catch { return false; }
  }
  private live(): boolean {
    if (this.disposed || !this.attached || !this.active()) return false;
    try { return trustedFrame(this.controller.getUrl()); } catch { return false; }
  }
  private send(message: LifecycleMessage): void {
    if (!this.live()) return;
    const safe: string=JSON.stringify(message).replace(/</g,'\\u003c');
    try { this.controller.runJavaScript('(function(){if(typeof window.__lanternLifecycleReceive==="function")window.__lanternLifecycleReceive('+safe+');})()').catch(() => {}); } catch {}
  }
  private revoked(): void {
    if (this.seq >= Number.MAX_SAFE_INTEGER) { this.dispose();return; }
    // Session refresh also revokes the lease; it is not evidence that an
    // account mutation completed. A hold remains latched across revocations.
    this.seq++;this.send({kind:'revoked',seq:this.seq});
  }
  private caller(id: string): boolean {
    let frame: string;
    try { frame=this.controller.getLastJavascriptProxyCallingFrameUrl(); } catch { return false; }
    return trustedFrame(frame)&&this.live()&&typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  }
  snapshot(id: string): void {
    if(!this.caller(id))return;
    const lease: TrustedOwnerLease | undefined=this.provider.snapshot();
    this.send({kind:'snapshot',seq:this.seq,id:id,owner:lease?.uid ?? null});
  }
  // Freeze both queues synchronously. Until an explicit verified account-change
  // completion protocol is wired, the hold remains latched for this observer.
  hold(id: string): void {
    if(!this.caller(id))return;
    this.sync.freeze();this.study.freeze();this.accountChangePending=true;
    this.send({kind:'held',seq:this.seq,id:id});
  }
  resume(id: string): void {
    if(!this.caller(id)||this.accountChangePending)return;
    const lease: TrustedOwnerLease | undefined=this.provider.snapshot();
    if(lease===undefined||!this.sync.canResume(lease.uid)||!this.study.canResume(lease.uid))return;
    try {
      if(!this.sync.resumeForOwner(lease.uid)||!this.study.resumeForOwner(lease.uid))throw new Error('unavailable');
      this.send({kind:'resumed',seq:this.seq,id:id});
    } catch { this.sync.freeze();this.study.freeze(); }
  }
  dispose(): void {
    if(this.disposed)return;this.disposed=true;this.attached=false;
    this.sync.invalidate();this.study.invalidate();this.unsubscribe();
    try { this.controller.deleteJavaScriptRegister('LanternLifecycleHost'); } catch {}
  }
}
