/** Reference implementation. User originals in lantern-audio are never accessed. */
export type RecordingRef = {id: string; revision?: string; mime?: string};
export type CacheEntry = {
  key: string; owner: string; recordingId: string; revision: string;
  blob: Blob; bytes: number; storedAt: number; lastUsedAt: number;
};
export type CacheLimits = {maxBytes: number; maxEntries: number};
/** put must atomically evict cache entries and insert, and abort on signal. */
export interface RecordingCacheStore {
  get(key: string, signal: AbortSignal): Promise<CacheEntry | undefined>;
  touch(key: string, at: number, signal: AbortSignal): Promise<void>;
  put(entry: CacheEntry, limits: CacheLimits, signal: AbortSignal): Promise<void>;
}
export type RecordingLoader = (request: {owner: string; id: string; signal: AbortSignal}) => Promise<Response>;
export type CacheResult = {
  blob: Blob; source: 'cache' | 'remote'; cached: boolean;
  cacheWarning?: 'read-failed' | 'write-failed' | 'over-budget';
};
type Job = {controller: AbortController; consumers: number; settled: boolean; promise: Promise<CacheResult>};

export function cacheKey(owner: string, recording: RecordingRef): string {
  return JSON.stringify([owner, recording.id, recording.revision || '']);
}
export function abortError(): DOMException {return new DOMException('Recording request cancelled', 'AbortError');}
function checkSignal(signal: AbortSignal) {if (signal.aborted) throw abortError();}
function positiveInteger(n: number, label: string) {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(label);
  return n;
}
function mime(value: string): string {return value.split(';', 1)[0].trim().toLowerCase();}
function cancel(promise: Promise<unknown> | undefined) {if (promise) void promise.catch(() => {});}
/** Even a non-cooperative loader/store cannot deliver after owner cancellation. */
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stopped = () => reject(abortError());
    const cleanup = () => signal.removeEventListener('abort', stopped);
    Promise.resolve(promise).then(value => {cleanup(); resolve(value);}, error => {cleanup(); reject(error);});
    if (signal.aborted) stopped(); else signal.addEventListener('abort', stopped, {once: true});
  });
}

export class RemoteRecordingCache {
  private owner: string | null = null;
  private generation = 0;
  private jobs = new Map<string, Job>();
  private store: RecordingCacheStore;
  private load: RecordingLoader;
  private now: () => number;
  private maxEntryBytes: number;
  private limits: CacheLimits;

  constructor(options: {
    store: RecordingCacheStore; load: RecordingLoader; now?: () => number;
    maxEntryBytes?: number; maxBytes?: number; maxEntries?: number;
  }) {
    this.store = options.store; this.load = options.load; this.now = options.now || Date.now;
    this.maxEntryBytes = positiveInteger(options.maxEntryBytes ?? 12_000_000, 'Invalid entry limit');
    this.limits = {
      maxBytes: positiveInteger(options.maxBytes ?? 48_000_000, 'Invalid cache budget'),
      maxEntries: positiveInteger(options.maxEntries ?? 16, 'Invalid cache count'),
    };
  }

  /** Call synchronously when the authenticated owner changes; null means logout. */
  setOwner(owner: string | null): void {
    if (owner !== null && (!owner.trim() || owner.length > 256)) throw new TypeError('Invalid owner');
    if (owner === this.owner) return;
    this.owner = owner; this.generation++;
    for (const job of this.jobs.values()) job.controller.abort();
    this.jobs.clear();
  }
  dispose(): void {this.setOwner(null);}

  get(recording: RecordingRef, options: {signal?: AbortSignal} = {}): Promise<CacheResult> {
    if (!this.owner) return Promise.reject(new Error('No active recording owner'));
    if (!recording.id.trim() || recording.id.length > 256 || (recording.revision?.length || 0) > 256) {
      return Promise.reject(new TypeError('Invalid recording reference'));
    }
    if (options.signal?.aborted) return Promise.reject(abortError());
    // The caller may reuse/mutate its UI object while an async read is pending.
    const reference: RecordingRef = {id: recording.id, revision: recording.revision || '', ...(recording.mime ? {mime: recording.mime} : {})};
    const owner = this.owner, generation = this.generation, key = cacheKey(owner, reference);
    let job = this.jobs.get(key);
    if (job?.controller.signal.aborted) {this.jobs.delete(key); job = undefined;}
    if (!job) {
      const created: Job = {controller: new AbortController(), consumers: 0, settled: false, promise: undefined!};
      this.jobs.set(key, created);
      created.promise = Promise.resolve().then(() => this.read(owner, generation, reference, created.controller.signal)).finally(() => {
        created.settled = true;
        if (this.jobs.get(key) === created) this.jobs.delete(key);
      });
      job = created;
    }
    return this.subscribe(job, options.signal).then(result => {
      if (reference.mime && mime(result.blob.type) !== mime(reference.mime)) throw new Error('Unexpected recording type');
      return result;
    });
  }

  private subscribe(job: Job, signal?: AbortSignal): Promise<CacheResult> {
    job.consumers++;
    return new Promise<CacheResult>((resolve, reject) => {
      let finished = false;
      const finish = (work: () => void) => {
        if (finished) return;
        finished = true; signal?.removeEventListener('abort', stopped); job.consumers--;
        if (!job.settled && job.consumers === 0) job.controller.abort();
        work();
      };
      const stopped = () => finish(() => reject(abortError()));
      job.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
      if (signal?.aborted) stopped(); else signal?.addEventListener('abort', stopped, {once: true});
    });
  }

  private assertActive(owner: string, generation: number, signal: AbortSignal) {
    checkSignal(signal);
    if (this.owner !== owner || this.generation !== generation) throw abortError();
  }

  private async read(owner: string, generation: number, recording: RecordingRef, signal: AbortSignal): Promise<CacheResult> {
    const active = () => this.assertActive(owner, generation, signal);
    const key = cacheKey(owner, recording); let warning: CacheResult['cacheWarning'];
    active();
    try {
      const entry = await abortable(this.store.get(key, signal), signal); active();
      if (entry && entry.key === key && entry.owner === owner && entry.recordingId === recording.id &&
          entry.revision === (recording.revision || '') && entry.blob instanceof Blob &&
          entry.bytes === entry.blob.size && entry.bytes > 0 && entry.bytes <= this.maxEntryBytes &&
          mime(entry.blob.type).startsWith('audio/') && (!recording.mime || mime(entry.blob.type) === mime(recording.mime))) {
        try {await abortable(this.store.touch(key, this.now(), signal), signal);} catch {active();}
        active(); return {blob: entry.blob, source: 'cache', cached: true};
      }
    } catch {active(); warning = 'read-failed';}

    let response: Response | undefined;
    try {
      active(); const loaded = this.load({owner, id: recording.id, signal});
      // A custom loader may ignore abort. Dispose a response that arrives late.
      void loaded.then(late => {if (signal.aborted && late.body && !late.body.locked) cancel(late.body.cancel());}, () => {});
      response = await abortable(loaded, signal); active();
      // Integration must bind the authenticated response to the requested owner.
      // A loader returning a Response without this echo is deliberately rejected.
      if (response.status !== 200) throw new Error('Unverified recording response');
      if (!response.headers.has('X-Lantern-Owner')) {
        const error = new Error('云端录音服务需要更新，请先使用已保存的本机录音。');
        error.name = 'RecordingServiceUpgradeRequiredError'; throw error;
      }
      if (response.headers.get('X-Lantern-Owner') !== owner) throw new Error('Unverified recording response');
      const contentType = mime(response.headers.get('content-type') || '');
      if (!contentType.startsWith('audio/') || (recording.mime && mime(recording.mime) !== contentType)) throw new Error('Unexpected recording type');
      const blob = await this.readComplete(response, contentType, signal); active();
      if (blob.size > this.limits.maxBytes) return {blob, source: 'remote', cached: false, cacheWarning: 'over-budget'};
      const at = this.now();
      const entry: CacheEntry = {key, owner, recordingId: recording.id, revision: recording.revision || '', blob, bytes: blob.size, storedAt: at, lastUsedAt: at};
      try {
        await abortable(this.store.put(entry, this.limits, signal), signal); active();
        return {blob, source: 'remote', cached: true, ...(warning ? {cacheWarning: warning} : {})};
      } catch {active(); return {blob, source: 'remote', cached: false, cacheWarning: 'write-failed'};}
    } catch (error) {if (response?.body && !response.body.locked) cancel(response.body.cancel()); throw error;}
  }

  private async readComplete(response: Response, contentType: string, signal: AbortSignal): Promise<Blob> {
    if (!response.body) throw new Error('Recording body missing');
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) < 1 || Number(declared) > this.maxEntryBytes)) {
      throw new Error('Recording length rejected');
    }
    const reader = response.body.getReader(), chunks: ArrayBuffer[] = [];
    let bytes = 0, complete = false;
    try {
      while (true) {
        const part = await abortable(reader.read(), signal); checkSignal(signal);
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > this.maxEntryBytes) throw new Error('Recording exceeds byte limit');
        chunks.push(part.value.slice().buffer as ArrayBuffer);
      }
      if (!bytes || (!response.headers.get('content-encoding') && declared !== null && bytes !== Number(declared))) throw new Error('Recording incomplete');
      complete = true; return new Blob(chunks, {type: contentType});
    } finally {
      if (!complete) cancel(reader.cancel());
      try {reader.releaseLock();} catch {}
    }
  }
}

/** Caller still needs the server-side expected-owner check and response echo. */
export function createSameOriginRecordingLoader(fetcher: typeof fetch = fetch): RecordingLoader {
  return ({owner, id, signal}) => fetcher('/api/recordings?id=' + encodeURIComponent(id), {
    credentials: 'same-origin', cache: 'no-store', signal, headers: {'X-Lantern-Owner': owner},
  });
}
