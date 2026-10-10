import {createAssetUrl, type ExamAttempt, type ExamPackage} from '@/lib/exam-model';
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
