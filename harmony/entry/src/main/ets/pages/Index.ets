import { assetBytes } from '../services/AssetRange';
import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { BusinessError, systemDateTime } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { NativeDownloads } from '../NativeDownloads';
import { NativeAuthHost } from '../auth/NativeAuthHost';
import { SpeakingMediaHost } from '../media/SpeakingMediaHost';

// This is an intercepted local origin. No server or certificate is required.
const APP_ORIGIN: string = 'https://lantern.local';
const APP_URL: string = APP_ORIGIN + '/';
const SUPPORT_MAILTO: string = 'mailto:zzl1414179@qq.com';
const SUPPORT_MAILTO_SUBJECT: string = SUPPORT_MAILTO + '?subject=%E5%BE%AE%E5%85%89%E6%89%98%E4%B8%9A%E9%97%AE%E9%A2%98%E5%8F%8D%E9%A6%88';

function isSupportMailto(destination: string): boolean {
  return destination === SUPPORT_MAILTO || destination === SUPPORT_MAILTO_SUBJECT;
}

// Process-local diagnostic budget. Never inspect arbitrary URLs, header values or bodies.
const MEDIA_RANGE_LOG_LIMIT: number = 64;

class BundledRangeTrace {
  id: number = 0;
  path: string = '';
  range: string = '';
  ifRange: boolean = false;
  head: boolean = false;
  startedMs: number = -1;
}

function mediaRangeUptime(): number {
  try {
    return systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
  } catch {
    return -1;
  }
}

class BundledRangeDiagnostics {
  private count: number = 0;
  private limitReported: boolean = false;

  begin(path: string, range: string, ifRange: boolean, head: boolean): BundledRangeTrace | undefined {
    try {
      if (!/^web\/audio\/offline\/[a-f0-9]{20}\.mp3$/.test(path)) return undefined;
      if (this.count >= MEDIA_RANGE_LOG_LIMIT) {
        if (!this.limitReported) {
          this.limitReported = true;
          hilog.info(0x1001, 'LANTERN_RANGE', '%{public}s', 'v=1 phase=limit requests=64');
        }
        return undefined;
      }
      const trace: BundledRangeTrace = new BundledRangeTrace();
      trace.id = ++this.count;
      trace.path = path;
      // Keep bounded numeric byte-range syntax only; arbitrary text is never logged.
      trace.range = range === '' ? 'none' : range.length > 160 ? 'oversize' :
        /^\s*bytes=(?:\d*-\d*)(?:\s*,\s*(?:bytes=)?\d*-\d*)*\s*$/i.test(range) ?
          range.replace(/\s/g, ' ') : 'redacted';
      trace.ifRange = ifRange;
      trace.head = head;
      trace.startedMs = mediaRangeUptime();
      this.write(trace, 'request', 0, '', -1, -1);
      return trace;
    } catch {
      return undefined;
    }
  }

  ready(trace: BundledRangeTrace | undefined, code: number, contentRange: string,
    bodyBytes: number, contentLength: number): void {
    if (trace) this.write(trace, 'ready', code, contentRange, bodyBytes, contentLength);
  }

  private write(trace: BundledRangeTrace, phase: string, code: number, contentRange: string,
    bodyBytes: number, contentLength: number): void {
    try {
      const uptimeMs: number = mediaRangeUptime();
      const elapsedMs: number = trace.startedMs >= 0 && uptimeMs >= trace.startedMs ?
        uptimeMs - trace.startedMs : -1;
      hilog.info(0x1001, 'LANTERN_RANGE', '%{public}s',
        'v=1 id=' + trace.id + ' phase=' + phase + ' uptimeMs=' + uptimeMs +
        ' wallMs=' + Date.now() + ' elapsedMs=' + elapsedMs + ' path=' + trace.path +
        ' range=' + trace.range + ' ifRange=' + (trace.ifRange ? '1' : '0') +
        ' head=' + (trace.head ? '1' : '0') + ' code=' + code +
        ' contentRange=' + (contentRange === '' ? 'none' : contentRange) +
        ' bodyBytes=' + bodyBytes + ' contentLength=' + contentLength);
    } catch {
      // Clock/log failures must never alter media responses or readiness.
    }
  }
}

const bundledRangeDiagnostics: BundledRangeDiagnostics = new BundledRangeDiagnostics();

const PLAYBACK_CONSOLE_PREFIX: string = 'Bundled playback ';
const PLAYBACK_CONSOLE_LIMIT: number = 256;
const PLAYBACK_STAGES: string[] = ['metadata', 'paused-seek', 'confirming-progress', 'playing'];
const PLAYBACK_EVENTS: string[] = ['begin', 'load', 'loadedmetadata', 'canplay', 'progress', 'durationchange',
  'seek-request', 'seeked', 'seek-settled', 'play', 'play-resolved', 'playing', 'timeupdate', 'waiting',
  'stalled', 'abort', 'emptied', 'rejected', 'confirmed', 'confirmed-short-end', 'stop', 'pause', 'ended'];
const PLAYBACK_REASONS: string[] = ['ended-before-confirmation', 'media-error', 'startup-position',
  'playing-position', 'progress-position', 'confirmed-position', 'not-prepared-paused', 'play-rejected',
  'play-threw', 'paused-seek-position', 'source-changed', 'metadata-source', 'preparation-not-paused',
  'seek-threw', 'media-aborted', 'media-emptied', 'confirmation-timeout', 'load-threw'];
const PLAYBACK_EXCEPTIONS: string[] = ['AbortError', 'NotAllowedError', 'NotSupportedError', 'InvalidStateError',
  'IndexSizeError', 'NetworkError', 'OperationError', 'SecurityError', 'TypeError', 'Error'];

class BundledPlaybackData {
  player: number = 0;
  request: number = 0;
  stage: string = '';
  event: string = '';
  reason?: string;
  target: number = 0;
  targetPosition: number = 0;
  current: number | null = null;
  baseline: number = 0;
  readyState: number = 0;
  duration: number | null = null;
  preparedDuration: number | null = null;
  preparedPosition: number | null = null;
  firstProgressPosition: number | null = null;
  firstProgressElapsed: number | null = null;
  paused: boolean = false;
  seeking: boolean = false;
  muted: boolean = false;
  rate: number = 1;
  sourceMatches: boolean = false;
  metadataSeen: boolean = false;
  seekAssigned: boolean = false;
  seekEventSeen: boolean = false;
  seekComplete: boolean = false;
  playingSeen: boolean = false;
  interrupted: boolean = false;
  advances: number = 0;
  elapsed: number = 0;
  seekable: number[][] = [];
  events: Record<string, number> = {};
  exceptionName?: string;
  exceptionCode?: number;
}

class BundledPlaybackLog {
  v: number = 1;
  seq: number = 0;
  uptimeMs: number = -1;
  wallMs: number = 0;
  data: BundledPlaybackData = new BundledPlaybackData();
}

function playbackNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function playbackNullableNumber(value: number | null): boolean {
  return value === null || playbackNumber(value);
}

class BundledPlaybackDiagnostics {
  private count: number = 0;
  private limitReported: boolean = false;

  forward(message: string): boolean {
    try {
      if (message.length > 4096 || !message.startsWith(PLAYBACK_CONSOLE_PREFIX)) return false;
      const input = JSON.parse(message.substring(PLAYBACK_CONSOLE_PREFIX.length)) as BundledPlaybackData;
      if (input === null || typeof input !== 'object' || Array.isArray(input) ||
        !PLAYBACK_STAGES.includes(input.stage) || !PLAYBACK_EVENTS.includes(input.event)) return false;
      if (!Number.isSafeInteger(input.player) || input.player < 1 ||
        !Number.isSafeInteger(input.request) || input.request < 1 ||
        !playbackNumber(input.target) || !playbackNumber(input.targetPosition) ||
        !playbackNumber(input.baseline) || !playbackNumber(input.elapsed) ||
        !Number.isSafeInteger(input.readyState) || input.readyState < 0 || input.readyState > 4 ||
        !Number.isSafeInteger(input.advances) || input.advances < 0 ||
        !playbackNumber(input.rate) || input.rate <= 0 || input.rate > 16 ||
        !playbackNullableNumber(input.current) || !playbackNullableNumber(input.duration) ||
        !playbackNullableNumber(input.preparedDuration) ||
        !playbackNullableNumber(input.preparedPosition) || !playbackNullableNumber(input.firstProgressPosition) ||
        !playbackNullableNumber(input.firstProgressElapsed)) return false;
      if (typeof input.paused !== 'boolean' || typeof input.seeking !== 'boolean' ||
        typeof input.muted !== 'boolean' || typeof input.sourceMatches !== 'boolean' ||
        typeof input.metadataSeen !== 'boolean' || typeof input.seekAssigned !== 'boolean' ||
        typeof input.seekEventSeen !== 'boolean' || typeof input.seekComplete !== 'boolean' ||
        typeof input.playingSeen !== 'boolean' || typeof input.interrupted !== 'boolean') return false;
      if (!Array.isArray(input.seekable) || input.seekable.length > 8 || input.events === null ||
        typeof input.events !== 'object' || Array.isArray(input.events)) return false;
      const output: BundledPlaybackData = new BundledPlaybackData();
      for (const range of input.seekable) {
        if (!Array.isArray(range) || range.length !== 2 || !playbackNumber(range[0]) ||
          !playbackNumber(range[1]) || range[1] < range[0]) return false;
        output.seekable.push([range[0], range[1]]);
      }
      for (const event of PLAYBACK_EVENTS) {
        const count: number | undefined = input.events[event];
        if (count === undefined) continue;
        if (!Number.isSafeInteger(count) || count < 0 || count > 1000000) return false;
        output.events[event] = count;
      }
      // Rebuild every field; never log the parsed object, its unknown keys, or its arbitrary strings.
      output.player = input.player;
      output.request = input.request;
      output.stage = input.stage;
      output.event = input.event;
      if (input.event === 'rejected' && PLAYBACK_REASONS.includes(input.reason ?? '')) output.reason = input.reason;
      output.target = input.target;
      output.targetPosition = input.targetPosition;
      output.current = input.current;
      output.baseline = input.baseline;
      output.readyState = input.readyState;
      output.duration = input.duration;
      output.preparedDuration = input.preparedDuration;
      output.preparedPosition = input.preparedPosition;
      output.firstProgressPosition = input.firstProgressPosition;
      output.firstProgressElapsed = input.firstProgressElapsed;
      output.paused = input.paused;
      output.seeking = input.seeking;
      output.muted = input.muted;
      output.rate = input.rate;
      output.sourceMatches = input.sourceMatches;
      output.metadataSeen = input.metadataSeen;
      output.seekAssigned = input.seekAssigned;
      output.seekEventSeen = input.seekEventSeen;
      output.seekComplete = input.seekComplete;
      output.playingSeen = input.playingSeen;
      output.interrupted = input.interrupted;
      output.advances = input.advances;
      output.elapsed = input.elapsed;
      if (PLAYBACK_EXCEPTIONS.includes(input.exceptionName ?? '')) output.exceptionName = input.exceptionName;
      if (typeof input.exceptionCode === 'number' && Number.isFinite(input.exceptionCode)) output.exceptionCode = input.exceptionCode;
      if (this.count >= PLAYBACK_CONSOLE_LIMIT) {
        if (!this.limitReported) {
          this.limitReported = true;
          this.write('v=1 phase=limit messages=256');
        }
        return true;
      }
      const log: BundledPlaybackLog = new BundledPlaybackLog();
      log.seq = ++this.count;
      log.uptimeMs = mediaRangeUptime();
      log.wallMs = Date.now();
      log.data = output;
      this.write(JSON.stringify(log));
      return true;
    } catch {
      return false;
    }
  }

  private write(message: string): void {
    try {
      hilog.info(0x1001, 'LANTERN_PLAYBACK', '%{public}s', message);
    } catch {
      // Handled diagnostics stay handled even if the native log sink is unavailable.
    }
  }
}

const bundledPlaybackDiagnostics: BundledPlaybackDiagnostics = new BundledPlaybackDiagnostics();

const RECORDING_CONSOLE_PREFIX: string = 'Recording playback ';
const RECORDING_CONSOLE_LIMIT: number = 128;
const RECORDING_EVENTS: string[] = ['reading', 'source-ready', 'url-attached', 'url-released', 'url-discarded',
  'loadstart', 'loadedmetadata', 'durationchange', 'canplay', 'play', 'playing', 'timeupdate', 'pause', 'ended', 'error', 'waiting',
  'stalled', 'timeout', 'retry', 'retired', 'global-stop', 'native-background', 'budget'];
const RECORDING_KEYS: string[] = ['source', 'request', 'event', 'current', 'duration', 'ready', 'network',
  'errorCode', 'paused', 'ended', 'seeking', 'sourceKind'];
const RECORDING_SOURCE_KINDS: string[] = ['blob', 'local', 'remote', 'none'];

class RecordingPlaybackData {
  source: number = 0;
  request: number = 0;
  event: string = '';
  current: number | null = null;
  duration: number | null = null;
  ready: number = 0;
  network: number = 0;
  errorCode: number | null = null;
  paused: boolean = true;
  ended: boolean = false;
  seeking: boolean = false;
  sourceKind: string = 'none';
}

class RecordingPlaybackLog {
  v: number = 1;
  seq: number = 0;
  uptimeMs: number = -1;
  wallMs: number = 0;
  data: RecordingPlaybackData = new RecordingPlaybackData();
}

function recordingNullableNumber(value: number | null): boolean {
  return value === null || typeof value === 'number' && Number.isFinite(value);
}

class RecordingPlaybackDiagnostics {
  private count: number = 0;
  private limitReported: boolean = false;

  forward(message: string): boolean {
    try {
      if (message.length > 2048 || !message.startsWith(RECORDING_CONSOLE_PREFIX)) return false;
      const input = JSON.parse(message.substring(RECORDING_CONSOLE_PREFIX.length)) as RecordingPlaybackData;
      if (input === null || typeof input !== 'object' || Array.isArray(input)) return false;
      const keys: string[] = Object.keys(input);
      if (keys.length !== RECORDING_KEYS.length || keys.some((key: string) => !RECORDING_KEYS.includes(key))) return false;
      if (!RECORDING_EVENTS.includes(input.event) || !RECORDING_SOURCE_KINDS.includes(input.sourceKind) ||
        !Number.isSafeInteger(input.source) || input.source < 0 || input.source > 64 ||
        !Number.isSafeInteger(input.request) || input.request < 0 ||
        !recordingNullableNumber(input.current) || !recordingNullableNumber(input.duration) ||
        !Number.isSafeInteger(input.ready) || input.ready < 0 || input.ready > 4 ||
        !Number.isSafeInteger(input.network) || input.network < 0 || input.network > 3 ||
        !(input.errorCode === null || Number.isSafeInteger(input.errorCode) && input.errorCode > 0) ||
        typeof input.paused !== 'boolean' || typeof input.ended !== 'boolean' ||
        typeof input.seeking !== 'boolean') return false;
      if (input.event === 'budget' && (input.source !== 0 || input.request !== 0 || input.current !== null ||
        input.duration !== null || input.ready !== 0 || input.network !== 0 || input.errorCode !== null ||
        !input.paused || input.ended || input.seeking || input.sourceKind !== 'none')) return false;
      if (input.event === 'budget' || this.count >= RECORDING_CONSOLE_LIMIT) {
        if (!this.limitReported) {
          this.limitReported = true;
          this.write('v=1 phase=limit messages=128');
        }
        return true;
      }
      // Rebuild only validated fields; the parsed object and any arbitrary strings are never logged.
      const output: RecordingPlaybackData = new RecordingPlaybackData();
      output.source = input.source;
      output.request = input.request;
      output.event = input.event;
      output.current = input.current;
      output.duration = input.duration;
      output.ready = input.ready;
      output.network = input.network;
      output.errorCode = input.errorCode;
      output.paused = input.paused;
      output.ended = input.ended;
      output.seeking = input.seeking;
      output.sourceKind = input.sourceKind;
      const log: RecordingPlaybackLog = new RecordingPlaybackLog();
      log.seq = ++this.count;
      log.uptimeMs = mediaRangeUptime();
      log.wallMs = Date.now();
      log.data = output;
      this.write(JSON.stringify(log));
      return true;
    } catch {
      return false;
    }
  }

  private write(message: string): void {
    try {
      hilog.info(0x1001, 'LANTERN_RECORDING', '%{public}s', message);
    } catch {
      // A diagnostic sink failure never changes the recording player or trusted console routing.
    }
  }
}

const recordingPlaybackDiagnostics: RecordingPlaybackDiagnostics = new RecordingPlaybackDiagnostics();

const CAPTURE_CONSOLE_PREFIX: string = 'Recording capture ';
const CAPTURE_CONSOLE_LIMIT: number = 128;
const CAPTURE_EVENTS: string[] = ['permission-request', 'stream-acquired', 'recorder-created', 'start',
  'chunk', 'stop-request', 'track-release', 'stopped', 'save-start', 'save-ok', 'save-error',
  'permission-error', 'start-error', 'recorder-error', 'budget'];
const CAPTURE_KEYS: string[] = ['attempt', 'event', 'chunkCount', 'zeroChunks', 'totalBytes',
  'lastChunkBytes', 'elapsedMs', 'mimeKind', 'activeTracks'];
const CAPTURE_MIME_KINDS: string[] = ['webm-opus', 'webm', 'mp4', 'other', 'unknown'];

class NativeCaptureData {
  attempt: number = 0;
  event: string = '';
  chunkCount: number = 0;
  zeroChunks: number = 0;
  totalBytes: number = 0;
  lastChunkBytes: number = 0;
  elapsedMs: number = 0;
  mimeKind: string = 'unknown';
  activeTracks: number = 0;
}

class NativeCaptureLog {
  v: number = 1;
  seq: number = 0;
  uptimeMs: number = -1;
  wallMs: number = 0;
  data: NativeCaptureData = new NativeCaptureData();
}

function captureInteger(value: number): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

class NativeCaptureDiagnostics {
  private count: number = 0;
  private limitReported: boolean = false;

  forward(message: string): boolean {
    try {
      if (message.length > 2048 || !message.startsWith(CAPTURE_CONSOLE_PREFIX)) return false;
      const input = JSON.parse(message.substring(CAPTURE_CONSOLE_PREFIX.length)) as NativeCaptureData;
      if (input === null || typeof input !== 'object' || Array.isArray(input)) return false;
      const keys: string[] = Object.keys(input);
      if (keys.length !== CAPTURE_KEYS.length || keys.some((key: string) => !CAPTURE_KEYS.includes(key))) return false;
      if (!CAPTURE_EVENTS.includes(input.event) || !CAPTURE_MIME_KINDS.includes(input.mimeKind) ||
        !captureInteger(input.attempt) || input.attempt > 64 ||
        !captureInteger(input.chunkCount) || !captureInteger(input.zeroChunks) ||
        !captureInteger(input.totalBytes) || !captureInteger(input.lastChunkBytes) ||
        !captureInteger(input.activeTracks) || typeof input.elapsedMs !== 'number' ||
        !Number.isFinite(input.elapsedMs) || input.elapsedMs < 0) return false;
      if (input.event === 'budget' && (input.attempt !== 0 || input.chunkCount !== 0 || input.zeroChunks !== 0 ||
        input.totalBytes !== 0 || input.lastChunkBytes !== 0 || input.elapsedMs !== 0 ||
        input.mimeKind !== 'unknown' || input.activeTracks !== 0)) return false;
      if (input.event === 'budget' || this.count >= CAPTURE_CONSOLE_LIMIT) {
        if (!this.limitReported) {
          this.limitReported = true;
          this.write('v=1 phase=limit messages=128');
        }
        return true;
      }
      // Rebuild only the fixed validated counters and enums; never forward arbitrary strings.
      const output: NativeCaptureData = new NativeCaptureData();
      output.attempt = input.attempt;
      output.event = input.event;
      output.chunkCount = input.chunkCount;
      output.zeroChunks = input.zeroChunks;
      output.totalBytes = input.totalBytes;
      output.lastChunkBytes = input.lastChunkBytes;
      output.elapsedMs = input.elapsedMs;
      output.mimeKind = input.mimeKind;
      output.activeTracks = input.activeTracks;
      const log: NativeCaptureLog = new NativeCaptureLog();
      log.seq = ++this.count;
      log.uptimeMs = mediaRangeUptime();
      log.wallMs = Date.now();
      log.data = output;
      this.write(JSON.stringify(log));
      return true;
    } catch {
      return false;
    }
  }

  private write(message: string): void {
    try {
      hilog.info(0x1001, 'LANTERN_CAPTURE', '%{public}s', message);
    } catch {
      // Diagnostic sink failures cannot change capture or trusted console routing.
    }
  }
}

const nativeCaptureDiagnostics: NativeCaptureDiagnostics = new NativeCaptureDiagnostics();

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
  private downloads: NativeDownloads | undefined = undefined;
  private authHost: NativeAuthHost | undefined = undefined;
  private speakingMedia: SpeakingMediaHost | undefined = undefined;
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
    this.speakingMedia?.dispose();
    this.speakingMedia = undefined;
    this.authHost?.dispose();
    this.authHost = undefined;
    this.alive = false;
    this.downloads?.invalidate();
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

  private playbackConsole(message: ConsoleMessage): boolean {
    try {
      if (!this.pageReady || !this.isTrustedDocument()) return false;
      const text: string = message.getMessage();
      if (nativeCaptureDiagnostics.forward(text)) return true;
      if (recordingPlaybackDiagnostics.forward(text)) return true;
      return bundledPlaybackDiagnostics.forward(text);
    } catch {
      return false;
    }
  }

  private invalidateBridge(): void {
    this.speakingMedia?.invalidate();
    this.bridgeReady = false;
    this.bridgeSequence++;
    if (this.bridgeRetryTimer !== -1) {
      clearTimeout(this.bridgeRetryTimer);
      this.bridgeRetryTimer = -1;
    }
  }

  private onForegroundChanged(): void {
    this.authHost?.invalidate();
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
    this.authHost?.invalidate();
    this.downloads?.invalidate();
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

  private async readAsset(response: WebResourceResponse, path: string, range: string, head: boolean,
    trace: BundledRangeTrace | undefined): Promise<void> {
    let diagnosticCode: number = 404;
    let diagnosticContentRange: string = '';
    let diagnosticBodyBytes: number = 'Bundled resource not found'.length;
    let diagnosticContentLength: number = -1;
    try {
      // Complete packaged short clips before returning so ArkWeb uses the synchronous binary
      // response path. Document assets retain the asynchronous loading path.
      const media: boolean = /^web\/audio\/offline\/[a-f0-9]{20}\.mp3$/.test(path);
      const data: Uint8Array = media ? this.context().resourceManager.getRawFileContentSync(path) :
        await this.context().resourceManager.getRawFileContent(path);
      const selected = assetBytes(data, range, head);
      const headers: Header[] = [
        { headerKey: 'Cache-Control', headerValue: 'no-store' },
        { headerKey: 'X-Content-Type-Options', headerValue: 'nosniff' },
        { headerKey: 'Accept-Ranges', headerValue: 'bytes' },
        { headerKey: 'Content-Length', headerValue: String(selected.length) }
      ];
      if (path === 'web/index.html') {
        headers.push({ headerKey: 'Content-Security-Policy',
          headerValue: "frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'" });
      }
      if (selected.contentRange !== '') {
        headers.push({ headerKey: 'Content-Range', headerValue: selected.contentRange });
      }
      response.setResponseData(selected.body);
      response.setResponseMimeType(mimeType(path));
      response.setResponseEncoding('utf-8');
      response.setResponseCode(selected.code);
      response.setReasonMessage(selected.reason);
      response.setResponseHeader(headers);
      diagnosticCode = selected.code;
      diagnosticContentRange = selected.contentRange;
      diagnosticBodyBytes = selected.body.byteLength;
      diagnosticContentLength = selected.length;
    } catch {
      response.setResponseData('Bundled resource not found');
      response.setResponseMimeType('text/plain');
      response.setResponseEncoding('utf-8');
      response.setResponseCode(404);
      response.setReasonMessage('Not Found');
    } finally {
      response.setResponseIsReady(true);
      bundledRangeDiagnostics.ready(trace, diagnosticCode, diagnosticContentRange,
        diagnosticBodyBytes, diagnosticContentLength);
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
    const method: string = request.getRequestMethod();
    if (method !== 'GET' && method !== 'HEAD') {
      const denied: WebResourceResponse = this.errorResponse(405, 'Method Not Allowed');
      denied.setResponseHeader([{ headerKey: 'Allow', headerValue: 'GET, HEAD' }]);
      return denied;
    }
    let range: string = '';
    let ifRange: boolean = false;
    const headers: Header[] = request.getRequestHeader();
    for (const header of headers) {
      if (header.headerKey.toLowerCase() === 'if-range') { ifRange = true; }
      if (header.headerKey.toLowerCase() === 'range') {
        range = range === '' ? header.headerValue : range + ',' + header.headerValue;
      }
    }
    const response: WebResourceResponse = new WebResourceResponse();
    response.setResponseIsReady(false);
    const trace: BundledRangeTrace | undefined = bundledRangeDiagnostics.begin(path, range, ifRange, method === 'HEAD');
    this.readAsset(response, path, ifRange ? '' : range, method === 'HEAD', trace);
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
    const supportMail: boolean = isSupportMailto(destination);
    if (!this.foreground || !this.pageReady || !this.bridgeReady || !this.isTrustedDocument() ||
      isAppUrl(destination) || (!supportMail && !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?(?:[/?#]|$)/i.test(destination))) {
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
      if (supportMail) {
        this.context().startAbility({ action: 'ohos.want.action.sendToData', uri: destination })
          .catch((_error: BusinessError) => this.toast('未能打开邮件应用，请复制邮箱后发送'));
        return;
      }
      this.context().openLink(destination).catch((error: BusinessError) => {
        this.toast('暂时无法打开链接');
        console.warn('Unable to open external link: ' + error.code);
      });
    } catch {
      this.toast(supportMail ? '未能打开邮件应用，请复制邮箱后发送' : '暂时无法打开链接');
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
          this.speakingMedia?.dispose();
          this.speakingMedia = undefined;
          this.authHost?.dispose();
          this.authHost = new NativeAuthHost(this.controller,
            () => this.alive && this.foreground && this.pageReady && this.isTrustedDocument());
          if (!this.authHost.attach()) this.authHost = undefined;
          if (this.authHost !== undefined) {
            this.speakingMedia = new SpeakingMediaHost(this.controller, () => this.context(),
              () => this.alive && this.foreground && this.pageReady && this.bridgeReady && this.isTrustedDocument(),
              this.authHost.trustedOwnerProvider());
            if (!this.speakingMedia.attach()) { this.speakingMedia.dispose(); this.speakingMedia = undefined; }
          }
          this.downloads?.invalidate();
          this.downloads = new NativeDownloads(() => this.context(),
            () => this.foreground && this.pageReady && this.bridgeReady && this.isTrustedDocument(),
            (message: string) => this.toast(message));
          if (!this.downloads.attach(this.controller)) this.downloads = undefined;
        })
        .onPageBegin(() => this.pageBegin())
        .onPageEnd((event) => this.pageEnd(event.url))
        .onConsole((event) => this.playbackConsole(event.message))
        // SDK 18 documents null as pass-through, but its callback type omits null.
        // Keep that runtime behavior for blob audio and other non-bundled resources.
        .onInterceptRequest((event) => this.intercept(event.request)!)
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
