import { webview } from '@kit.ArkWeb';
import { ThemeWindowController } from './ThemeWindow';

const PROXY_PERMISSION: string = '{"javascriptProxyPermission":{"urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":"/"}],' +
  '"methodList":[{"methodName":"apply","urlPermissionList":' +
  '[{"scheme":"https","host":"lantern.local","port":"","path":"/"}]}]}}';

function mainDocument(url: string): boolean {
  return /^https:\/\/lantern\.local\/?(?:[?#][^\s]*)?$/.test(url);
}

/** Theme-only bridge. No arbitrary color, account, filesystem or URL API. */
export class NativeThemeHost {
  private attached: boolean = false;
  private disposed: boolean = false;
  private controller: webview.WebviewController;
  private active: () => boolean;
  private target: ThemeWindowController;

  constructor(controller: webview.WebviewController, active: () => boolean, target: ThemeWindowController) {
    this.controller = controller; this.active = active; this.target = target;
  }

  attach(): boolean {
    if (this.disposed) return false;
    try {
      this.controller.registerJavaScriptProxy(this, 'LanternThemeHost', ['apply'], [], PROXY_PERMISSION);
      this.attached = true;
      return true;
    } catch { return false; }
  }

  apply(theme: string): string {
    if (this.disposed || !this.attached || !this.active()) return 'REJECTED';
    let frame: string;
    let current: string;
    try {
      // Read caller synchronously, before parsing or scheduling any work.
      frame = this.controller.getLastJavascriptProxyCallingFrameUrl();
      current = this.controller.getUrl();
    } catch { return 'REJECTED'; }
    if (!mainDocument(frame) || !mainDocument(current) || frame !== current ||
      typeof theme !== 'string' || theme.length > 16) return 'REJECTED';
    return this.target.accept(theme) ? 'ACCEPTED' : 'REJECTED';
  }

  invalidate(): void { this.target.invalidate(); }

  dispose(): void {
    this.invalidate(); this.disposed = true; this.attached = false;
    try { this.controller.deleteJavaScriptRegister('LanternThemeHost'); } catch { /* Already detached. */ }
  }
}
