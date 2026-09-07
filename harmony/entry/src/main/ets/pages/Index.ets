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
  private controller: webview.WebviewController = new webview.WebviewController();
  private requestingMicrophone: boolean = false;
  private active: boolean = false;

  aboutToAppear(): void {
    this.active = true;
  }

  aboutToDisappear(): void {
    this.active = false;
  }

  private context(): common.UIAbilityContext {
    return this.getUIContext().getHostContext() as common.UIAbilityContext;
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

  private async requestMicrophone(request: PermissionRequest): Promise<void> {
    const origin: string = request.getOrigin();
    const resources: string[] = request.getAccessibleResource();
    if ((origin !== APP_ORIGIN && origin !== APP_URL) || !this.active ||
      this.requestingMicrophone || resources.length !== 1 ||
      resources[0] !== ProtectedResourceType.AUDIO_CAPTURE) {
      request.deny();
      return;
    }
    this.requestingMicrophone = true;
    try {
      const result = await abilityAccessCtrl.createAtManager()
        .requestPermissionsFromUser(this.context(), ['ohos.permission.MICROPHONE']);
      if (this.active && result.authResults.length === 1 && result.authResults[0] === 0) {
        request.grant([ProtectedResourceType.AUDIO_CAPTURE]);
      } else {
        request.deny();
      }
    } catch {
      request.deny();
    } finally {
      this.requestingMicrophone = false;
    }
  }

  private handleNavigation(request: WebResourceRequest): boolean {
    const destination: string = request.getRequestUrl();
    if (isAppUrl(destination)) {
      return false;
    }
    // External HTTPS links opened by a tap leave the trusted app Web component.
    // Other schemes, frames and script-triggered redirects remain blocked.
    if (request.isMainFrame() && request.isRequestGesture() &&
      /^https:\/\/[a-z0-9.-]+(?::[0-9]+)?(?:[/?#]|$)/i.test(destination)) {
      this.context().openLink(destination).catch((error: BusinessError) => {
        console.warn('Unable to open external link: ' + error.code);
      });
    }
    return true;
  }

  onBackPress(): boolean {
    try {
      if (this.controller.accessBackward()) {
        this.controller.backward();
        return true;
      }
    } catch {
      // Before Web attachment, allow the system to handle Back.
    }
    return false;
  }

  build() {
    Column() {
      Web({ src: APP_URL, controller: this.controller })
        .width('100%')
        .height('100%')
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(false)
        .mixedMode(MixedMode.None)
        .geolocationAccess(false)
        .multiWindowAccess(false)
        .mediaPlayGestureAccess(true)
        .onInterceptRequest((event) => this.intercept(event.request))
        .onLoadIntercept((event) => this.handleNavigation(event.data))
        .onPermissionRequest((event) => {
          this.requestMicrophone(event.request);
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F4F0E7')
  }
}
