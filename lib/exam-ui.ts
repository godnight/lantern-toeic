import {LISTENING_MS, createAssetUrl, getListeningDurationMs, type ExamAsset, type ExamAttempt, type ExamPackage} from '@/lib/exam-model';
import type {ExamRepository} from '@/lib/exam-storage';

export class StaleExamOwner extends Error {
  constructor() { super('模考页面或账号范围已关闭'); this.name = 'StaleExamOwner'; }
}

/** One immutable owner and one FIFO for answers, ticks, background and submission. */
export class ExamUiSession {
  private closed = false;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly repository: ExamRepository, readonly ownerId: string) {
    if (repository.ownerId !== ownerId) throw new Error('模考存储账号不匹配');
  }
  assertActive() { if (this.closed) throw new StaleExamOwner(); }
  run<T>(work: (repository: ExamRepository) => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      this.assertActive();
      const value = await work(this.repository);
      this.assertActive();
      return value;
    });
    this.tail = result.catch(() => {});
    return result;
  }
  close() { if (!this.closed) { this.closed = true; this.repository.close(); } }
}

/** Only the exit path may turn a storage failure into an explicit leave option. */
export async function trySaveExamExit(saveInterruption: () => Promise<unknown>): Promise<boolean> {
  try { await saveInterruption(); return true; }
  catch (error) {
    if (error instanceof StaleExamOwner) throw error;
    return false;
  }
}

/** Never decrement a UI counter or restart a deadline on remount. */
export function remainingMs(attempt: ExamAttempt, now: number): number {
  if (attempt.status === 'submitted') return 0;
  return Math.max(0, (attempt.status === 'listening' ? attempt.listeningDeadline : attempt.readingDeadline)
    - Math.max(now, attempt.lastObservedAt));
}
export function audioOffsetSeconds(attempt: ExamAttempt, now: number, duration: number): number {
  return Math.min(Math.max(0, duration), Math.max(0, (Math.max(now, attempt.lastObservedAt) - attempt.startedAt) / 1000));
}
export function clockText(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}


/** Metadata is a compatibility gate, not proof of a complete or correctly paired recording. */
export function checkExamAudioDuration(durationSeconds: number, declaredMs: number | undefined,
  effectiveMs: number): {ready: boolean; error: string} {
  try {
    if (getListeningDurationMs(declaredMs === undefined ? {} : {listeningDurationMs: declaredMs}) !== effectiveMs) {
      return {ready: false, error: '题包听力时长声明与计时不一致，请重新核对题包。'};
    }
  } catch {
    return {ready: false, error: '题包听力时长声明无效，请重新核对题包。'};
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return {ready: false, error: '音频时长尚未读取或无效，请重试加载。'};
  }
  const measuredMs = durationSeconds * 1000;
  if (declaredMs === undefined) {
    return measuredMs <= LISTENING_MS ? {ready: true, error: ''} :
      {ready: false, error: '音频超过旧题包的 45:00 听力时限，不能开始新考试。请核对完整音轨后制作带时长声明的新版本。'};
  }
  const gap = declaredMs - measuredMs;
  return gap >= 0 && gap <= 1500 ? {ready: true, error: ''} :
    {ready: false, error: '音频实测时长与本套声明不符，不能开始新考试或恢复播放。请核对音轨与题包版本；已有考试截止不变。'};
}

/** Restores src after StrictMode's setup → cleanup → setup probe. */
export function attachExamMedia(player: HTMLAudioElement | null, url: string): () => void {
  if (player && url && player.getAttribute('src') !== url) {
    player.setAttribute('src', url);
    player.load();
  }
  // Keep the element itself: React can clear the ref before passive cleanup.
  return () => {
    if (player) {player.pause(); player.removeAttribute('src'); player.load();}
  };
}

/** Actual decode gate; the package validator's file-header checks are not enough. */
export function verifyExamImage(url: string, signal: AbortSignal, options: {
  createImage?: () => HTMLImageElement; timeoutMs?: number;
} = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {reject(new StaleExamOwner()); return;}
    const image = options.createImage ? options.createImage() : new Image();
    let settled = false, decoding = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      image.onload = null; image.onerror = null; image.removeAttribute('src');
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new StaleExamOwner());
    const timer = setTimeout(() => finish(new Error('材料图片解析超时，未通过开考预检。')), options.timeoutMs ?? 15_000);
    signal.addEventListener('abort', abort, {once: true});
    image.onerror = () => finish(new Error('材料图片无法解码，请核对题包；未通过开考预检。'));
    image.onload = () => {
      if (settled || decoding) return;
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {finish(new Error('材料图片没有可显示的尺寸。')); return;}
      decoding = true;
      // Some ArkWeb versions have no decode(); a successful load with dimensions is the fallback.
      Promise.resolve().then(() => typeof image.decode === 'function' ? image.decode() : undefined)
        .then(() => finish(), () => finish(new Error('材料图片解码失败，请替换损坏文件。')));
    };
    image.src = url;
  });
}

export class ExamAssetUrls {
  private urls = new Map<string, string>();
  private closed = false;
  constructor(private exam: ExamPackage,
    private create: (exam: ExamPackage, id: string) => string = createAssetUrl,
    private revoke: (url: string) => void = url => URL.revokeObjectURL(url)) {}
  get(id: string) {
    if (this.closed) throw new StaleExamOwner();
    const existing = this.urls.get(id);
    if (existing) return existing;
    const url = this.create(this.exam, id);
    this.urls.set(id, url);
    return url;
  }
  close() { if (!this.closed) { this.closed = true; this.urls.forEach(this.revoke); this.urls.clear(); } }
}


export type ExamAssetLease = {url: string; release: () => void};

/** Schema-1 compatibility adapter. Decode only the requested asset, in 64 KiB
 * base64 slices. This still produces a complete Blob; it is not disk streaming.
 * The r2 Blob repository can replace this function via ExamAssetLeases.readAsset.
 */
export function examAssetBlob(asset: ExamAsset): Blob {
  const text = asset.base64;
  const maximum = asset.mime.startsWith('image/') ? 6 * 1024 ** 2 : 50 * 1024 ** 2;
  if (!text.length || text.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('素材 base64 无效');
  const length = text.length / 4 * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0);
  if (length > maximum || btoa(atob(text.slice(-4))) !== text.slice(-4)) throw new Error('素材大小或填充位无效');
  const parts: ArrayBuffer[] = [];
  for (let offset = 0; offset < text.length; offset += 64 * 1024) {
    const binary = atob(text.slice(offset, offset + 64 * 1024));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    parts.push(bytes.buffer);
  }
  return new Blob(parts, {type: asset.mime});
}

type AssetLeaseEntry = {refs: number; bytes: number; url?: string; promise: Promise<string>};

/** Runtime port of the PM lazy-assets reference. No speculative loads or LRU
 * eviction of live media. A final release or owner close immediately revokes.
 */
export class ExamAssetLeases {
  private entries = new Map<string, AssetLeaseEntry>();
  private closed = false;
  private bytes = 0;
  private readonly create: (blob: Blob) => string;
  private readonly revoke: (url: string) => void;
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  constructor(private readonly readAsset: (id: string) => Promise<Blob>, options: {
    create?: (blob: Blob) => string; revoke?: (url: string) => void;
    maxBytes?: number; maxEntries?: number;
  } = {}) {
    this.create = options.create ?? (blob => URL.createObjectURL(blob));
    this.revoke = options.revoke ?? (url => URL.revokeObjectURL(url));
    this.maxBytes = options.maxBytes ?? 64 * 1024 ** 2;
    this.maxEntries = options.maxEntries ?? 16;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || !Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) throw new Error('素材租约限额无效');
  }
  async acquire(id: string): Promise<ExamAssetLease> {
    if (this.closed) throw new StaleExamOwner();
    let entry = this.entries.get(id);
    if (!entry) {
      if (this.entries.size >= this.maxEntries) throw new Error('请先释放不用的材料，再加载新素材');
      const created: AssetLeaseEntry = {refs: 0, bytes: 0, promise: Promise.resolve('')};
      entry = created;
      this.entries.set(id, created);
      created.promise = Promise.resolve().then(() => {
        if (this.closed || this.entries.get(id) !== created) throw new StaleExamOwner();
        return this.readAsset(id);
      }).then(blob => {
        if (this.closed || this.entries.get(id) !== created) throw new StaleExamOwner();
        if (!(blob instanceof Blob)) throw new Error('题包素材不存在');
        if (blob.size > this.maxBytes - this.bytes) throw new Error('当前材料超出活跃素材限额，请先释放不用的材料');
        const url = this.create(blob);
        if (this.closed || this.entries.get(id) !== created) {this.remove(url); throw new StaleExamOwner();}
        created.url = url; created.bytes = blob.size; this.bytes += blob.size;
        return url;
      }).catch(error => {if (this.entries.get(id) === created) this.entries.delete(id); throw error;});
    }
    entry.refs++;
    const url = await entry.promise;
    if (this.closed || this.entries.get(id) !== entry) throw new StaleExamOwner();
    let released = false;
    return {url, release: () => {
      if (released) return;
      released = true;
      if (--entry.refs === 0 && this.entries.get(id) === entry) {
        this.entries.delete(id); this.bytes -= entry.bytes;
        if (entry.url !== undefined) this.remove(entry.url);
      }
    }};
  }
  private remove(url: string) {detachExamMediaUrl(url); this.revoke(url);}
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.entries.values()) if (entry.url !== undefined) this.remove(entry.url);
    this.entries.clear(); this.bytes = 0;
  }
}

/** Owner cleanup can precede child effect cleanup, so close also detaches DOM users. */
export function detachExamMediaUrl(url: string, media?: Iterable<HTMLMediaElement | HTMLImageElement>) {
  const players = media ?? (typeof document === 'undefined' ? [] : document.querySelectorAll<HTMLMediaElement | HTMLImageElement>('audio,video,img'));
  for (const player of players) if (player.getAttribute('src') === url) {
    if ('pause' in player) player.pause();
    player.removeAttribute('src');
    if ('load' in player) player.load();
  }
}
/** Detach a live player before the URL's last lease can be revoked. */
export function releaseExamAssetLease(lease: ExamAssetLease, media?: Iterable<HTMLMediaElement | HTMLImageElement>) {
  detachExamMediaUrl(lease.url, media);
  lease.release();
}
