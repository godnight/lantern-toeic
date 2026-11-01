import {abortError, type CacheEntry, type CacheLimits, type RecordingCacheStore} from './remote-recording-cache';

export const CACHE_DB_NAME = 'lantern-remote-recording-cache-v1';
const STORE = 'remote-cache';

/** A separate database: never opens or evicts lantern-audio user originals. */
export function createIndexedDbRecordingStore(factory: IDBFactory = indexedDB): RecordingCacheStore {
  async function open(signal: AbortSignal): Promise<IDBDatabase> {
    if (signal.aborted) throw abortError();
    return new Promise((resolve, reject) => {
      const request = factory.open(CACHE_DB_NAME, 1); let settled = false;
      const stopped = () => {if (!settled) {settled = true; reject(abortError());}};
      const finish = () => signal.removeEventListener('abort', stopped);
      signal.addEventListener('abort', stopped, {once: true});
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, {keyPath: 'key'});
      };
      request.onerror = () => {finish(); if (!settled) {settled = true; reject(request.error);}};
      request.onblocked = () => {finish(); if (!settled) {settled = true; reject(new Error('Recording cache upgrade blocked'));}};
      request.onsuccess = () => {
        finish(); const db = request.result; db.onversionchange = () => db.close();
        if (settled || signal.aborted) {db.close(); if (!settled) reject(abortError()); return;}
        settled = true; resolve(db);
      };
    });
  }
  async function transaction<T>(mode: IDBTransactionMode, signal: AbortSignal, work: (store: IDBObjectStore, set: (value: T) => void) => void): Promise<T> {
    const db = await open(signal);
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) {db.close(); reject(abortError()); return;}
      let tx: IDBTransaction; let value: T; let localError: unknown;
      try {tx = db.transaction(STORE, mode);} catch (error) {db.close(); reject(error); return;}
      const stopped = () => {try {tx.abort();} catch {}};
      const cleanup = () => {signal.removeEventListener('abort', stopped); db.close();};
      signal.addEventListener('abort', stopped, {once: true});
      tx.oncomplete = () => {cleanup(); signal.aborted ? reject(abortError()) : resolve(value);};
      tx.onabort = () => {cleanup(); reject(signal.aborted ? abortError() : localError || tx.error || new Error('Recording cache transaction aborted'));};
      tx.onerror = () => {localError ||= tx.error;};
      try {work(tx.objectStore(STORE), next => {value = next;});} catch (error) {localError = error; stopped();}
    });
  }
  return {
    get: (key, signal) => transaction<CacheEntry | undefined>('readonly', signal, (store, set) => {
      const request = store.get(key); request.onsuccess = () => set(request.result);
    }),
    touch: (key, at, signal) => transaction<void>('readwrite', signal, store => {
      const request = store.get(key);
      request.onsuccess = () => {
        try {if (request.result) store.put({...request.result, lastUsedAt: at});}
        catch {try {store.transaction.abort();} catch {}}
      };
    }),
    put: (entry: CacheEntry, limits: CacheLimits, signal: AbortSignal) => transaction<void>('readwrite', signal, store => {
      if (entry.bytes > limits.maxBytes || entry.bytes !== entry.blob.size || entry.bytes <= 0) throw new Error('Recording cache entry exceeds budget');
      const rows: Array<{key: string; bytes: number; lastUsedAt: number}> = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const old = cursor.value as CacheEntry;
          if (old.key !== entry.key) rows.push({key: old.key, bytes: old.bytes, lastUsedAt: old.lastUsedAt});
          cursor.continue(); return;
        }
        try {
          if (signal.aborted) throw abortError();
          rows.sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.key.localeCompare(b.key));
          let total = rows.reduce((sum, row) => sum + row.bytes, entry.bytes), count = rows.length + 1;
          for (const old of rows) {
            if (total <= limits.maxBytes && count <= limits.maxEntries) break;
            store.delete(old.key); total -= old.bytes; count--;
          }
          store.put(entry);
        } catch {try {store.transaction.abort();} catch {}}
      };
    }),
  };
}
