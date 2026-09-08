import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { BusinessError } from '@kit.BasicServicesKit';

// This is an intercepted local origin. No server or certificate is required.
const APP_ORIGIN: string = 'https://lantern.local';
const APP_URL: string = APP_ORIGIN + '/';

function isAppUrl(value: string): boolean {
  return value === APP_ORIGIN || value.startsWith(APP_URL);
}

function localPath(value: string): string | null {
  if (!isAppUrl(value)) {
    return null;
  }
  try {
    const relative: string = value.substring(APP_ORIGIN.length).split(/[?#]/)[0];
    const decoded: string = decodeURIComponent(relative);
    if (decoded.includes('\\') || decoded.includes('\u0000')) {
      return null;
    }
    const segments: string[] = decoded.split('/');
    if (segments.some((part: string) => part === '..' || part === '.')) {
      return null;
    }
    return decoded === '' || decoded === '/' ? 'web/index.html' : 'web' + decoded;
  } catch {
    return null;
  }
}

function mimeType(path: string): string {
  const extension: string = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
  switch (extension) {
    case 'html': return 'text/html';
    case 'js': case 'mjs': return 'application/javascript';
    case 'css': return 'text/css';
    case 'json': case 'map': return 'application/json';
    case 'svg': return 'image/svg+xml';
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'ico': return 'image/x-icon';
    case 'woff': return 'font/woff';
    case 'woff2': return 'font/woff2';
    case 'mp3': return 'audio/mpeg';
    case 'm4a': return 'audio/mp4';
    case 'wav': return 'audio/wav';
    case 'ogg': return 'audio/ogg';
    case 'webm': return 'audio/webm';
    case 'wasm': return 'application/wasm';
    case 'txt': return 'text/plain';
    default: return 'application/octet-stream';
  }
}

@Entry
@Component
struct Index {
  @StorageLink('lanternForeground') @Watch('onForegroundChanged')
  private foreground: boolean = false;
  @State private pageReady: boolean = false;
  @State private bridgeReady: boolean = false;
  @State private backPending: boolean = false;
  private controller: webview.WebviewController = new webview.WebviewController();
  private attached: boolean = false;
  private alive: boolean = false;
  private documentGeneration: number = 0;
  private lifecycleGeneration: number = 0;
  private bridgeSequence: number = 0;
  private bridgeRetryTimer: number = -1;
  private backSequence: number = 0;
  private backTimer: number = -1;
  private lastExitBackAt: number = 0;
  private osPermissionBusy: boolean = false;
  private pendingMicrophone: PermissionRequest | undefined = undefined;
  private lastExternalUrl: string = '';
  private lastExternalAt: number = 0;

  aboutToAppear(): void {
    this.alive = true;
  }

  aboutToDisappear(): void {
    this.alive = false;
    this.lifecycleGeneration++;
    this.documentGeneration++;
    this.invalidateBridge();
    this.cancelBack();
    this.denyPendingMicrophone();
  }

  private context(): common.UIAbilityContext {
    return this.getUIContext().getHostContext() as common.UIAbilityContext;
  }

  private toast(message: string): void {
    if (!this.alive || !this.foreground) {
      return;
    }
    try {
      this.getUIContext().getPromptAction().showToast({ message: message, duration: 1800 });
    } catch {
      console.warn('Unable to display native notification');
    }
  }

  private isTrustedDocument(): boolean {
    if (!this.alive || !this.attached) {
      return false;
    }
    try {
      return isAppUrl(this.controller.getUrl());
    } catch {
      return false;
    }
  }

  private invalidateBridge(): void {
    this.bridgeReady = false;
    this.bridgeSequence++;
    if (this.bridgeRetryTimer !== -1) {
      clearTimeout(this.bridgeRetryTimer);
      this.bridgeRetryTimer = -1;
    }
  }

  private onForegroundChanged(): void {
    // @Watch runs synchronously. Even a background/foreground round trip
    // invalidates every earlier permission and Back callback.
    this.lifecycleGeneration++;
    this.cancelBack();
    this.denyPendingMicrophone();
    this.startBridgeSync();
    if (this.attached) {
      try {
        if (this.foreground) {
          this.controller.onActive();
        } else {
          // onInactive does not suspend JavaScript; recording finalization may run.
          this.controller.onInactive();
        }
      } catch {
        console.warn('Web activity update could not be delivered');
      }
    }
  }

  private startBridgeSync(): void {
    this.invalidateBridge();
    if (!this.pageReady || !this.isTrustedDocument()) {
      return;
    }
    this.syncBridge(this.bridgeSequence, this.documentGeneration, this.lifecycleGeneration, 0);
  }

  private syncBridge(sequence: number, document: number, lifecycle: number, attempt: number): void {
    if (sequence !== this.bridgeSequence || document !== this.documentGeneration ||
      lifecycle !== this.lifecycleGeneration || !this.pageReady || !this.isTrustedDocument()) {
      return;
    }
    const script: string = '(function(){try{' +
      'var b=window.__LANTERN_HARMONY__;' +
      'if(!b||typeof b.onAppState!=="function"||typeof b.onBackPress!=="function")return false;' +
      'return b.onAppState(' + (this.foreground ? 'true' : 'false') + ')===true;' +
      '}catch(e){return false;}})()';
    try {
      this.controller.runJavaScript(script, (error: BusinessError, result: string) => {
        if (sequence !== this.bridgeSequence || document !== this.documentGeneration ||
          lifecycle !== this.lifecycleGeneration || !this.isTrustedDocument()) {
          return;
        }
        if (!error && result === 'true') {
          this.bridgeReady = true;
          return;
        }
        this.retryBridge(sequence, document, lifecycle, attempt);
      });
    } catch {
      this.retryBridge(sequence, document, lifecycle, attempt);
    }
  }

  private retryBridge(sequence: number, document: number, lifecycle: number, attempt: number): void {
    if (attempt >= 19) {
      this.toast('页面尚未就绪，请稍后再试');
      return;
    }
    this.bridgeRetryTimer = setTimeout(() => {
      this.bridgeRetryTimer = -1;
      this.syncBridge(sequence, document, lifecycle, attempt + 1);
    }, 100);
  }

  private pageBegin(): void {
    this.documentGeneration++;
    this.pageReady = false;
    this.invalidateBridge();
    this.cancelBack();
    this.denyPendingMicrophone();
  }

  private pageEnd(url: string): void {
    // onPageEnd concerns the main frame. Check the event and current URL.
    this.pageReady = isAppUrl(url) && this.isTrustedDocument();
    this.startBridgeSync();
  }

  private errorResponse(code: number, reason: string): WebResourceResponse {
    const response: WebResourceResponse = new WebResourceResponse();
    response.setResponseCode(code);
    response.setReasonMessage(reason);
    response.setResponseMimeType('text/plain');
    response.setResponseEncoding('utf-8');
    response.setResponseData(reason);
    return response;
  }

  private async readAsset(response: WebResourceResponse, path: string): Promise<void> {
    try {
      const data: Uint8Array = await this.context().resourceManager.getRawFileContent(path);
      // WebResourceResponse accepts ArrayBuffer, not Uint8Array. Preserve exact bounds.
      const bytes: ArrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      response.setResponseData(bytes);
      response.setResponseMimeType(mimeType(path));
      response.setResponseEncoding('utf-8');
      response.setResponseCode(200);
      response.setReasonMessage('OK');
      response.setResponseHeader([
        { headerKey: 'Cache-Control', headerValue: 'no-store' },
        { headerKey: 'X-Content-Type-Options', headerValue: 'nosniff' }
      ]);
    } catch {
      // A missing bundled resource must never fall through to a network request.
      response.setResponseData('Bundled resource not found');
      response.setResponseMimeType('text/plain');
      response.setResponseEncoding('utf-8');
      response.setResponseCode(404);
      response.setReasonMessage('Not Found');
    } finally {
      response.setResponseIsReady(true);
    }
  }

  private intercept(request: WebResourceRequest): WebResourceResponse | null {
    const requestedUrl: string = request.getRequestUrl();
    if (!isAppUrl(requestedUrl)) {
      return null;
    }
    const path: string | null = localPath(requestedUrl);
    if (path === null) {
      return this.errorResponse(400, 'Bad Request');
    }
    if (request.getRequestMethod() !== 'GET') {
      return this.errorResponse(405, 'Method Not Allowed');
    }
    const response: WebResourceResponse = new WebResourceResponse();
    response.setResponseIsReady(false);
    this.readAsset(response, path);
    return response;
  }

  private denyPendingMicrophone(): void {
    const request: PermissionRequest | undefined = this.pendingMicrophone;
    this.pendingMicrophone = undefined;
    if (request) {
      try {
        request.deny();
      } catch {
        console.warn('Web microphone request already ended');
      }
    }
  }

  private async requestMicrophone(request: PermissionRequest): Promise<void> {
    const origin: string = request.getOrigin();
    const resources: string[] = request.getAccessibleResource();
    if ((origin !== APP_ORIGIN && origin !== APP_URL) || !this.foreground ||
      !this.pageReady || !this.bridgeReady || !this.isTrustedDocument() ||
      this.osPermissionBusy || resources.length !== 1 ||
      resources[0] !== ProtectedResourceType.AUDIO_CAPTURE) {
      request.deny();
      return;
    }
    const document: number = this.documentGeneration;
    const lifecycle: number = this.lifecycleGeneration;
    this.osPermissionBusy = true;
    this.pendingMicrophone = request;
    try {
      const result = await abilityAccessCtrl.createAtManager()
        .requestPermissionsFromUser(this.context(), ['ohos.permission.MICROPHONE']);
      // Backgrounding can already have denied this exact request. Never answer twice.
      if (this.pendingMicrophone !== request) {
        return;
      }
      this.pendingMicrophone = undefined;
      if (this.foreground && this.alive && this.pageReady && this.bridgeReady &&
        AppStorage.get<boolean>('lanternForeground') === true &&
        document === this.documentGeneration && lifecycle === this.lifecycleGeneration &&
        this.isTrustedDocument() && result.authResults.length === 1 && result.authResults[0] === 0) {
        request.grant([ProtectedResourceType.AUDIO_CAPTURE]);
      } else {
        request.deny();
      }
    } catch {
      if (this.pendingMicrophone === request) {
        this.denyPendingMicrophone();
      }
    } finally {
      // Remains busy until the OS request settles, even if the Web request was cancelled.
      this.osPermissionBusy = false;
    }
  }

  private openExternal(destination: string): void {
    if (!this.foreground || !this.pageReady || !this.bridgeReady || !this.isTrustedDocument() ||
      isAppUrl(destination) || !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?(?:[/?#]|$)/i.test(destination)) {
      return;
    }
    const now: number = Date.now();
    if (this.lastExternalUrl === destination && now - this.lastExternalAt < 1000) {
      return;
    }
    this.lastExternalUrl = destination;
    this.lastExternalAt = now;
    this.lastExitBackAt = 0;
    try {
      this.context().openLink(destination).catch((error: BusinessError) => {
        this.toast('暂时无法打开链接');
        console.warn('Unable to open external link: ' + error.code);
      });
    } catch {
      this.toast('暂时无法打开链接');
    }
  }

  private handleNavigation(request: WebResourceRequest): boolean {
    const destination: string = request.getRequestUrl();
    if (isAppUrl(destination)) {
      return false;
    }
    if (request.isMainFrame() && request.isRequestGesture()) {
      this.openExternal(destination);
    }
    return true;
  }

  private handleNewWindow(event: OnWindowNewEvent): void {
    // Acknowledge every popup request, including rejected requests, or ArkWeb may block.
    event.handler.setWebController(null);
    if (event.isUserTrigger) {
      this.openExternal(event.targetUrl);
    }
  }

  private cancelBack(): void {
    this.backSequence++;
    this.backPending = false;
    this.lastExitBackAt = 0;
    if (this.backTimer !== -1) {
      clearTimeout(this.backTimer);
      this.backTimer = -1;
    }
  }

  private failedBack(): void {
    this.cancelBack();
    this.toast('页面暂未响应，请稍后再试');
  }

  private finishBack(): void {
    try {
      if (this.controller.accessBackward()) {
        this.lastExitBackAt = 0;
        this.controller.backward();
        return;
      }
      const now: number = Date.now();
      if (this.lastExitBackAt > 0 && now - this.lastExitBackAt <= 2000) {
        this.lastExitBackAt = 0;
        this.context().terminateSelf().catch((error: BusinessError) => {
          this.toast('暂时无法退出，请稍后再试');
          console.warn('Unable to terminate ability: ' + error.code);
        });
        return;
      }
      this.lastExitBackAt = now;
      this.toast('再按一次返回退出');
    } catch {
      this.failedBack();
    }
  }

  onBackPress(): boolean {
    if (!this.foreground || this.backPending) {
      return true;
    }
    if (!this.pageReady || !this.bridgeReady || !this.isTrustedDocument()) {
      this.lastExitBackAt = 0;
      this.startBridgeSync();
      this.toast('页面尚未就绪，请稍后再试');
      return true;
    }
    this.backPending = true;
    const sequence: number = ++this.backSequence;
    const document: number = this.documentGeneration;
    const lifecycle: number = this.lifecycleGeneration;
    this.backTimer = setTimeout(() => {
      if (sequence === this.backSequence) {
        this.failedBack();
      }
    }, 1500);
    const script: string = '(function(){try{' +
      'var b=window.__LANTERN_HARMONY__;' +
      'if(!b||typeof b.onBackPress!=="function")return null;' +
      'var r=b.onBackPress();return typeof r==="boolean"?r:null;' +
      '}catch(e){return null;}})()';
    try {
      this.controller.runJavaScript(script, (error: BusinessError, result: string) => {
        if (sequence !== this.backSequence || document !== this.documentGeneration ||
          lifecycle !== this.lifecycleGeneration || !this.alive || !this.foreground) {
          return;
        }
        if (this.backTimer !== -1) {
          clearTimeout(this.backTimer);
          this.backTimer = -1;
        }
        this.backPending = false;
        if (error || !this.isTrustedDocument() || (result !== 'true' && result !== 'false')) {
          this.failedBack();
          return;
        }
        if (result === 'true') {
          this.lastExitBackAt = 0;
          return;
        }
        // Only an explicit, synchronous JS false permits native navigation or exit.
        this.finishBack();
      });
    } catch {
      this.failedBack();
    }
    // The asynchronous decision owns this Back press. Never let the system exit early.
    return true;
  }

  build() {
    Column() {
      Web({ src: APP_URL, controller: this.controller })
        .width('100%')
        .height('100%')
        .enabled(this.foreground && this.pageReady && this.bridgeReady && !this.backPending)
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(false)
        .mixedMode(MixedMode.None)
        .geolocationAccess(false)
        .multiWindowAccess(true)
        .allowWindowOpenMethod(false)
        .mediaPlayGestureAccess(true)
        .onControllerAttached(() => {
          this.attached = true;
        })
        .onPageBegin(() => this.pageBegin())
        .onPageEnd((event) => this.pageEnd(event.url))
        .onInterceptRequest((event) => this.intercept(event.request))
        .onLoadIntercept((event) => this.handleNavigation(event.data))
        .onWindowNew((event) => this.handleNewWindow(event))
        .onPermissionRequest((event) => {
          this.requestMicrophone(event.request);
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F4F0E7')
  }
}
