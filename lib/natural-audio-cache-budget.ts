/** Shared budget for immutable natural audio only. No learning/recording storage is used. */
export const NATURAL_AUDIO_SOFT_BYTES = 192 * 1024 * 1024;
export const NATURAL_AUDIO_HARD_BYTES = 256 * 1024 * 1024;
export const NATURAL_AUDIO_MAX_CLIP_BYTES = 8 * 1024 * 1024;
const GLOBAL_LOCK = 'lantern-natural-audio-budget-v1';
const CACHE = /^lantern-natural-audio-v1-(v040-(?:natural|kokoro)-[a-f0-9]{12})$/;
const MAX_ROWS = 32768;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
type LockOptions = { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean; signal?: AbortSignal };
export interface NaturalAudioLockManager {
  request<T>(name: string, options: LockOptions, callback: (lock: object | null) => Promise<T>): Promise<T>;
}
export interface NaturalAudioBudgetMetadata {
  schema: 1;
  recency: Record<string, number>;
  offline: Record<string, number>;
  /** Absent in r1 metadata means epoch 0. Clears invalidate older lease decrements. */
  offlineEpoch?: Record<string, number>;
}
export interface NaturalAudioBudgetMetadataStore {
  load(): Promise<unknown>;
  save(value: NaturalAudioBudgetMetadata): Promise<void>;
}
export type NaturalAudioBudgetOutcome = {
  kind: 'not-attempted' | 'hit' | 'persisted' | 'not-persisted' | 'uncertain';
  reason?: string;
  metadataWarning?: string;
};
export type NaturalAudioBudgetRequest = { signal?: AbortSignal; isCurrent?: () => boolean; declaredBytes?: number };
export type NaturalAudioBudgetLease = { release(): void; settled: Promise<void>; persistentProtection: boolean };
export type NaturalAudioBudgetRow = { cacheName: string; url: string; bytes: number; lastUsed: number; evictable: boolean };
export class NaturalAudioOfflineReservationError extends Error {
  constructor(message: string, readonly reservationState: 'not-created' | 'released' | 'unknown-may-remain', readonly originalError: unknown) { super(message, { cause: originalError }); this.name = 'NaturalAudioOfflineReservationError'; }
}
const empty = (): NaturalAudioBudgetMetadata => ({ schema: 1, recency: {}, offline: {}, offlineEpoch: {} });
function fail(message: string): never { throw new Error(message); }
const id = (cacheName: string, url: string): string => cacheName + '\n' + url;
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

/** Metadata is bounded and advisory for LRU, never an authority for stored byte counts. */
export function createNaturalAudioBudgetMetadataStore(factory: IDBFactory): NaturalAudioBudgetMetadataStore {
  const database = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    let rejected = false;
    const request = factory.open('lantern-natural-audio-budget-v1', 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state'); };
    request.onsuccess = () => { if (rejected) request.result.close(); else resolve(request.result); };
    request.onerror = () => { rejected = true; reject(request.error ?? new Error('natural audio metadata open failed')); };
    request.onblocked = () => { rejected = true; reject(new Error('natural audio metadata blocked')); };
  });
  return {
    async load() {
      const db = await database();
      try { return await new Promise((resolve, reject) => {
        const tx = db.transaction('state', 'readonly'); const request = tx.objectStore('state').get('v1');
        let value: unknown; request.onsuccess = () => { value = request.result; };
        tx.oncomplete = () => resolve(value); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('metadata read failed'));
      }); } finally { db.close(); }
    },
    async save(value) {
      if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_METADATA_BYTES) fail('natural audio metadata exceeds bound');
      const db = await database();
      try { await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(value, 'v1');
        tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('metadata write failed'));
      }); } finally { db.close(); }
    },
  };
}

function metadata(value: unknown): NaturalAudioBudgetMetadata {
  if (value == null) return empty();
  if (typeof value !== 'object' || (value as { schema?: unknown }).schema !== 1) fail('invalid natural audio metadata');
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_METADATA_BYTES) fail('natural audio metadata exceeds bound');
  const parsed = empty();
  for (const field of ['recency', 'offline', 'offlineEpoch'] as const) {
    const rows = field === 'offlineEpoch' ? (value as NaturalAudioBudgetMetadata)[field] ?? {} : (value as NaturalAudioBudgetMetadata)[field];
    if (!rows || typeof rows !== 'object' || Array.isArray(rows) || Object.keys(rows).length > MAX_ROWS) fail('invalid natural audio metadata rows');
    for (const [key, n] of Object.entries(rows)) {
      if (!Number.isSafeInteger(n) || n < 0 || key.length > 2048) fail('invalid natural audio metadata value');
      parsed[field]![key] = n;
    }
  }
  return parsed;
}

export class NaturalAudioCacheBudget {
  private readonly storage: CacheStorage | null;
  private readonly locks: NaturalAudioLockManager | null;
  private readonly meta: NaturalAudioBudgetMetadataStore | null;
  private readonly origin: string | null;
  private readonly now: () => number;
  private readonly soft: number;
  private readonly hard: number;
  private readonly putTimeout: number;
  private volatile = empty();
  private readonly outcomes = new WeakMap<object, NaturalAudioBudgetOutcome>();
  private readonly localPins = new Map<string, number>();
  private lockFailed = false;
  private get safeLocks(): NaturalAudioLockManager | null { return this.lockFailed ? null : this.locks; }

  constructor(options: {
    storage?: CacheStorage | null; locks?: NaturalAudioLockManager | null;
    metadataStore?: NaturalAudioBudgetMetadataStore | null;
    origin?: string; now?: () => number; softBytes?: number; hardBytes?: number; putTimeoutMs?: number;
  } = {}) {
    this.storage = options.storage === undefined ? globalThis.caches ?? null : options.storage;
    let origin: string | null = null;
    try {
      const parsed = new URL(options.origin ?? globalThis.location?.origin ?? 'null');
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.origin !== 'null' && !parsed.username && !parsed.password) origin = parsed.origin;
    } catch { /* file/opaque/no window origin: memory playback only, no fabricated origin. */ }
    this.origin = origin;
    this.locks = origin ? (options.locks === undefined ? ((globalThis.navigator?.locks as unknown as NaturalAudioLockManager) ?? null) : options.locks) : null;
    this.meta = options.metadataStore === undefined ? (globalThis.indexedDB ? createNaturalAudioBudgetMetadataStore(globalThis.indexedDB) : null) : options.metadataStore;
    this.now = options.now ?? Date.now;
    this.soft = options.softBytes ?? NATURAL_AUDIO_SOFT_BYTES;
    this.hard = options.hardBytes ?? NATURAL_AUDIO_HARD_BYTES;
    this.putTimeout = options.putTimeoutMs ?? 15000;
    if (!Number.isFinite(this.putTimeout) || this.putTimeout < 1 || this.putTimeout > 30000) fail('invalid natural audio write deadline');
    if (!Number.isSafeInteger(this.soft) || !Number.isSafeInteger(this.hard) || this.soft < 0 || this.soft > this.hard || this.hard > NATURAL_AUDIO_HARD_BYTES) fail('invalid natural audio budget');
  }

  private canonical(input: RequestInfo | URL): string {
    if (!this.origin) {
      // Only local relative selectors are accepted; this key is never persisted.
      if (typeof input === 'string' && /^\/audio\/natural\/v040-(?:natural|kokoro)-[a-f0-9]{12}\/[a-f0-9]{64}\.mp3$/.test(input)) return input;
      return fail('opaque origin cannot use persistent natural audio URLs');
    }
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, this.origin);
    if (url.origin !== this.origin || url.search || url.hash || !/^\/audio\/natural\/v040-(?:natural|kokoro)-[a-f0-9]{12}\/[a-f0-9]{64}\.mp3$/.test(url.pathname)) fail('not an immutable same-origin natural audio URL');
    if (typeof input !== 'string' && !(input instanceof URL) && input.method !== 'GET') fail('natural audio cache requires GET');
    return url.href;
  }
  private owned(name: string, url: string): boolean {
    if (!this.origin) return false;
    const pack = CACHE.exec(name)?.[1];
    try { return !!pack && new URL(this.canonical(url)).pathname.startsWith('/audio/natural/' + pack + '/'); } catch { return false; }
  }
  private check(context: NaturalAudioBudgetRequest) {
    if (context.signal?.aborted) throw context.signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (context.isCurrent && !context.isCurrent()) fail('stale natural audio request');
  }
  private async locked<T>(context: NaturalAudioBudgetRequest, fn: () => Promise<T>): Promise<T> {
    this.check(context);
    const locks = this.safeLocks;
    if (!locks) fail('safe natural audio cache lock unavailable; persistence disabled');
    return locks.request(GLOBAL_LOCK, { mode: 'exclusive', signal: context.signal }, async lock => {
      if (!lock) fail('natural audio budget lock unavailable'); this.check(context); return fn();
    });
  }
  private async loadMeta(): Promise<NaturalAudioBudgetMetadata> {
    // Corrupt/unreadable durable reservations must not be treated as an empty set.
    if (this.meta) return metadata(await this.meta.load());
    return structuredClone(this.volatile);
  }
  private async saveMeta(value: NaturalAudioBudgetMetadata, required = false): Promise<string | undefined> {
    this.volatile = structuredClone(value);
    if (!this.meta) { if (required) fail('durable offline reservation storage unavailable'); return 'LRU metadata is memory-only'; }
    try { await this.meta.save(value); return undefined; }
    catch (error) { if (required) throw error; return 'LRU metadata update failed; persisted audio remains real'; }
  }
  private async count(response: Response, bound: number, context: NaturalAudioBudgetRequest, collect = false): Promise<{bytes: number; data?: Uint8Array}> {
    if (!response.body) return { bytes: 0, data: collect ? new Uint8Array(0) : undefined };
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    const abort = () => { void reader.cancel(context.signal?.reason).catch(() => {}); };
    context.signal?.addEventListener('abort', abort, { once: true });
    try {
      while (true) {
        this.check(context); const item = await reader.read(); this.check(context);
        if (item.done) break; bytes += item.value.byteLength;
        if (bytes > bound) fail('natural audio body exceeds accounting bound');
        if (collect) chunks.push(item.value);
      }
      if (!collect) return { bytes };
      const data = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      return { bytes, data };
    } finally { context.signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  private async scan(meta: NaturalAudioBudgetMetadata, context: NaturalAudioBudgetRequest): Promise<{totalBytes: number; rows: NaturalAudioBudgetRow[]}> {
    if (!this.storage) fail('CacheStorage unavailable');
    const rows: NaturalAudioBudgetRow[] = []; let totalBytes = 0;
    const names = (await this.storage.keys()).filter(name => CACHE.test(name));
    if (names.length > 256) fail('too many natural audio cache namespaces');
    for (const cacheName of names) {
      this.check(context); const cache = await this.storage!.open(cacheName);
      for (const key of await cache.keys()) {
        this.check(context); if (rows.length >= MAX_ROWS) fail('too many natural audio cache entries');
        const response = await cache.match(key); if (!response) fail('natural audio cache changed during accounting');
        const bytes = (await this.count(response, this.hard + 1, context)).bytes;
        totalBytes += bytes; if (!Number.isSafeInteger(totalBytes)) fail('invalid natural audio stored byte count');
        rows.push({ cacheName, url: key.url, bytes, lastUsed: meta.recency[id(cacheName, key.url)] ?? 0, evictable: this.owned(cacheName, key.url) });
      }
    }
    return { totalBytes, rows };
  }
  async inspect(): Promise<{totalBytes: number; rows: NaturalAudioBudgetRow[]; persistenceAvailable: boolean}> {
    const run = async () => ({ ...await this.scan(await this.loadMeta(), {}), persistenceAvailable: !!this.safeLocks });
    return this.safeLocks ? this.locked({}, run) : run();
  }
  outcome(storage: CacheStorage): NaturalAudioBudgetOutcome { return { ...(this.outcomes.get(storage) ?? { kind: 'not-attempted' }) }; }

  /** Caller must await this before prepare and release when playback/task ends. */
  async pinURLs(inputs: readonly string[], options: {signal?: AbortSignal; kind?: 'playback' | 'lesson' | 'offline'} = {}): Promise<NaturalAudioBudgetLease> {
    const urls = [...new Set(inputs.map(url => this.canonical(url)))].sort();
    if (urls.length > 1024) fail('too many natural audio pins'); this.check(options);
    if (options.kind === 'offline' && (!this.safeLocks || !this.meta)) fail('durable offline protection unavailable');
    const holders: { release: () => void; done: Promise<unknown> }[] = []; const pinned: string[] = [];
    let offlineRecorded = false; let offlineSaveAttempted = false; const offlineEpochs: Record<string, number> = {};
    try {
      for (const url of urls) {
        if (this.safeLocks) {
          const acquired = deferred<void>(); const hold = deferred<void>();
          const done = this.safeLocks.request('lantern-natural-audio-asset-v1:' + url, { mode: 'shared', signal: options.signal }, async lock => {
            if (!lock) fail('natural audio pin lock unavailable'); acquired.resolve(); await hold.promise;
          });
          await Promise.race([acquired.promise, done.then(() => fail('pin lock ended before acquisition'))]);
          holders.push({ release: () => hold.resolve(), done });
        }
        this.localPins.set(url, (this.localPins.get(url) ?? 0) + 1);
        pinned.push(url);
      }
      if (options.kind === 'offline') await this.locked(options, async () => {
        const meta = await this.loadMeta(); for (const url of urls) { offlineEpochs[url] = meta.offlineEpoch?.[url] ?? 0; meta.offline[url] = (meta.offline[url] ?? 0) + 1; }
        offlineSaveAttempted = true;
        await this.saveMeta(meta, true); offlineRecorded = true;
      });
      this.check(options);
    } catch (error) {
      let reservationState: 'not-created' | 'released' | 'unknown-may-remain' = offlineSaveAttempted ? 'unknown-may-remain' : 'not-created';
      if (offlineRecorded) {
        // Commit is known successful but no lease can be returned. Undo only our
        // increment in a fresh global transaction, never with the aborted signal.
        try { await this.releaseOffline(urls, offlineEpochs); reservationState = 'released'; }
        catch { /* Save/cleanup outcome unknown: conservatively retain protection. */ }
      }
      for (const holder of holders) holder.release(); await Promise.allSettled(holders.map(holder => holder.done));
      for (const url of pinned) this.decrementPin(url);
      if (options.kind === 'offline') {
        const message = error instanceof Error ? error.message : String(error);
        throw new NaturalAudioOfflineReservationError(message + '; offline reservation ' + reservationState, reservationState, error);
      }
      if (!options.signal?.aborted && this.safeLocks) {
        // Present-but-unusable Web Locks is also a read/memory-only capability.
        this.lockFailed = true; return this.pinURLs(inputs, options);
      }
      throw error;
    }
    let released = false; const settled = deferred<void>();
    const release = () => {
      if (released) return; released = true; options.signal?.removeEventListener('abort', release);
      void (async () => {
        try {
          if (offlineRecorded) await this.releaseOffline(urls, offlineEpochs);
        } catch { /* Failed removal conservatively leaves durable reservation in force. */ }
        finally { for (const url of urls) this.decrementPin(url); for (const holder of holders) holder.release(); await Promise.allSettled(holders.map(holder => holder.done)); settled.resolve(); }
      })();
    };
    options.signal?.addEventListener('abort', release, { once: true });
    if (options.signal?.aborted) release();
    return { release, settled: settled.promise, persistentProtection: !!this.safeLocks && (options.kind !== 'offline' || offlineRecorded) };
  }
  private decrementPin(url: string) { const next = (this.localPins.get(url) ?? 0) - 1; if (next > 0) this.localPins.set(url, next); else this.localPins.delete(url); }
  private async releaseOffline(urls: readonly string[], epochs: Record<string, number>): Promise<void> {
    await this.locked({}, async () => {
      const meta = await this.loadMeta();
      for (const url of urls) {
        if ((meta.offlineEpoch?.[url] ?? 0) !== epochs[url]) continue;
        const next = (meta.offline[url] ?? 0) - 1; if (next > 0) meta.offline[url] = next; else delete meta.offline[url];
      }
      await this.saveMeta(meta, true);
    });
  }
  /** Explicit user-intent removal for durable reservations surviving restart. */
  async clearOfflineReservations(urls: readonly string[]): Promise<void> {
    const canonical = urls.map(url => this.canonical(url));
    await this.locked({}, async () => {
      const meta = await this.loadMeta(); meta.offlineEpoch ??= {};
      for (const url of canonical) {
        const epoch = (meta.offlineEpoch[url] ?? 0) + 1; if (!Number.isSafeInteger(epoch)) fail('offline reservation epoch exhausted');
        meta.offlineEpoch[url] = epoch; delete meta.offline[url];
      }
      await this.saveMeta(meta, true);
    });
  }

  forRequest(context: NaturalAudioBudgetRequest = {}): CacheStorage {
    const state: NaturalAudioBudgetOutcome = { kind: 'not-attempted' }; const owner = this;
    const wrapper = {
      async open(name: string): Promise<Cache> {
        if (!CACHE.test(name)) fail('cache namespace is outside natural audio budget');
        if (!owner.origin) fail('opaque origin: natural audio persistence disabled; verified memory playback only');
        if (!owner.storage) fail('CacheStorage unavailable');
        const raw = await owner.storage!.open(name);
        const cache = {
          async match(input: RequestInfo | URL, options?: CacheQueryOptions) {
            if (options?.ignoreSearch || options?.ignoreMethod || options?.ignoreVary) fail('unsafe natural audio cache query');
            const url = owner.canonical(input); if (!owner.owned(name, url)) fail('natural audio pack URL mismatch');
            const response = await raw.match(url, options);
            if (response) {
              state.kind = 'hit';
              if (owner.safeLocks) {
                try { await owner.safeLocks.request(GLOBAL_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
                  if (!lock) { state.metadataWarning = 'LRU touch skipped while another write holds reservation'; return; }
                  owner.check(context); const meta = await owner.loadMeta(); meta.recency[id(name, url)] = owner.now(); state.metadataWarning = await owner.saveMeta(meta);
                }); }
                catch { owner.check(context); state.metadataWarning = 'LRU metadata unavailable; cached bytes still require registry verification'; }
              }
            }
            return response;
          },
          async put(input: RequestInfo | URL, response: Response) {
            let expired = false; let timer: ReturnType<typeof setTimeout> | undefined;
            const controller = new AbortController();
            const abort = () => controller.abort(context.signal?.reason);
            context.signal?.addEventListener('abort', abort, { once: true }); if (context.signal?.aborted) abort();
            const guardedContext = { ...context, signal: controller.signal, isCurrent: () => !expired && (!context.isCurrent || context.isCurrent()) };
            const pending = owner.put(name, raw, input, response, guardedContext, state);
            // Native Cache.put is unabortable: timeout returns memory-only/uncertain,
            // while pending retains the global lock until settlement and cleanup.
            const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => {
              expired = true; state.kind = 'uncertain'; state.reason = 'cache operation deadline; native write or cleanup may still be pending';
              controller.abort(new Error(state.reason));
              reject(new Error(state.reason));
            }, owner.putTimeout); });
            try { await Promise.race([pending, deadline]); }
            catch (error) { if (state.kind !== 'uncertain') { state.kind = 'not-persisted'; state.reason = error instanceof Error ? error.message : String(error); } throw error; }
            finally { if (timer) clearTimeout(timer); context.signal?.removeEventListener('abort', abort); void pending.catch(() => {}); }
          },
          keys: raw.keys.bind(raw), matchAll: raw.matchAll.bind(raw),
          async delete() { return fail('only budget eviction may delete natural audio'); },
          async add() { return fail('unverified natural audio add disabled'); },
          async addAll() { return fail('unverified natural audio addAll disabled'); },
        };
        return cache as unknown as Cache;
      },
      async keys() { return owner.storage ? (await owner.storage.keys()).filter(name => CACHE.test(name)) : []; },
      async has(name: string) { return CACHE.test(name) && !!owner.storage && await owner.storage.has(name); },
      async delete() { return fail('whole-cache deletion disabled'); },
      async match() { return fail('open exact natural audio pack cache before match'); },
    } as unknown as CacheStorage;
    this.outcomes.set(wrapper, state); return wrapper;
  }

  private async put(name: string, cache: Cache, input: RequestInfo | URL, response: Response, context: NaturalAudioBudgetRequest, state: NaturalAudioBudgetOutcome): Promise<void> {
    this.check(context); if (!this.safeLocks) fail('safe natural audio cache lock unavailable; persistence disabled');
    const url = this.canonical(input); if (!this.owned(name, url)) fail('natural audio pack URL mismatch');
    if (!response.ok || response.status !== 200 || response.redirected) fail('invalid natural audio cache response');
    const incoming = await this.count(response, NATURAL_AUDIO_MAX_CLIP_BYTES, context, true);
    if (!incoming.bytes || (context.declaredBytes != null && context.declaredBytes !== incoming.bytes)) fail('natural audio declared byte mismatch');
    const data = incoming.data!;
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource)), value => value.toString(16).padStart(2, '0')).join('');
    if (!url.endsWith('/' + sha + '.mp3')) fail('natural audio content hash mismatch');
    await this.locked(context, async () => {
      const meta = await this.loadMeta(); const usage = await this.scan(meta, context); this.check(context);
      const existing = await cache.match(url);
      if (existing) {
        const old = await this.count(existing, NATURAL_AUDIO_MAX_CLIP_BYTES, context, true);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', old.data! as BufferSource)), value => value.toString(16).padStart(2, '0')).join('');
        if (hash !== sha) fail('immutable cached natural audio differs; refusing overwrite');
        meta.recency[id(name, url)] = this.now(); state.kind = 'persisted'; state.metadataWarning = await this.saveMeta(meta); return;
      }
      let total = usage.totalBytes;
      const candidates = usage.rows.filter(row => row.evictable && row.url !== url).sort((a, b) => a.lastUsed - b.lastUsed || a.url.localeCompare(b.url) || a.cacheName.localeCompare(b.cacheName));
      for (const row of candidates) {
        if (total + incoming.bytes <= this.soft) break; this.check(context);
        if (this.localPins.has(row.url) || (meta.offline[row.url] ?? 0) > 0) continue;
        await this.locks!.request('lantern-natural-audio-asset-v1:' + row.url, { mode: 'exclusive', ifAvailable: true }, async lock => {
          if (!lock) return; this.check(context); const oldCache = await this.storage!.open(row.cacheName);
          if (await oldCache.delete(row.url)) { total -= row.bytes; delete meta.recency[id(row.cacheName, row.url)]; }
        });
      }
      if (total + incoming.bytes > this.hard) fail('natural audio hard budget reserved capacity unavailable');
      this.check(context);
      // Global reservation remains held until native put settles, including cancellation.
      let putError: unknown; let putFailed = false;
      try { await cache.put(url, new Response(data as BodyInit, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(data.length), 'X-Lantern-Audio-Sha256': sha } })); }
      catch (error) { putFailed = true; putError = error ?? new Error('native natural audio put rejected'); }
      let invalid: unknown = putFailed ? putError : undefined; try { this.check(context); } catch (error) { invalid = error; }
      if (invalid) {
        try {
          // Key was absent under global lock. Only our exact newly written immutable body can be removed.
          const after = await cache.match(url);
          if (after) {
            const read = await this.count(after, NATURAL_AUDIO_MAX_CLIP_BYTES, {}, true);
            const observed = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', read.data! as BufferSource)), value => value.toString(16).padStart(2, '0')).join('');
            if (observed !== sha || !await cache.delete(url)) fail('cannot reconcile new natural audio write');
          }
          state.kind = 'not-persisted'; state.reason = putFailed ? 'single native put failed; new entry absent after reconciliation' : 'cancelled or stale write removed';
        } catch { state.kind = 'uncertain'; state.reason = 'native cache write outcome or cleanup uncertain; offline status requires reconciliation'; }
        throw invalid;
      }
      // Include every persisted version again: never claim success from our declaration alone.
      try {
        const persisted = await cache.match(url);
        if (!persisted) fail('new natural audio cache entry missing after put');
        const readBack = await this.count(persisted, NATURAL_AUDIO_MAX_CLIP_BYTES, context, true);
        const observed = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', readBack.data! as BufferSource)), value => value.toString(16).padStart(2, '0')).join('');
        if (observed !== sha || readBack.bytes !== incoming.bytes) fail('new natural audio cached bytes corrupt');
        const actual = await this.scan(meta, context);
        if (actual.totalBytes > this.hard) fail('natural audio hard budget changed during write');
      } catch (error) {
        try { if (!await cache.delete(url)) fail('cannot remove unconfirmed write'); state.kind = 'not-persisted'; }
        catch { state.kind = 'uncertain'; state.reason = 'post-write accounting failed; cleanup uncertain'; }
        throw error;
      }
      meta.recency[id(name, url)] = this.now();
      const live = new Set(usage.rows.map(row => id(row.cacheName, row.url))); live.add(id(name, url));
      for (const key of Object.keys(meta.recency)) if (!live.has(key)) delete meta.recency[key];
      state.kind = 'persisted'; state.metadataWarning = await this.saveMeta(meta);
      try { this.check(context); }
      catch (error) {
        try { if (!await cache.delete(url)) fail('cannot remove cancelled new entry'); state.kind = 'not-persisted'; state.reason = 'cancelled or stale during final metadata update; new entry removed'; }
        catch { state.kind = 'uncertain'; state.reason = 'cancelled final metadata update; cache cleanup uncertain'; }
        throw error;
      }
    });
  }
}
