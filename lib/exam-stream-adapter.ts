import * as model from './exam-model';
import {importStreaming as importRuntime, packageChunks as packageRuntime, restorePrepared as restoreRuntime, writeLegacyJson as writeRuntime} from './exam-stream/importer.mjs';
import {IdbSpool as SpoolRuntime, createSpoolStores as createRuntime, readActiveAssetBlob as blobRuntime} from './exam-stream/idb-spool.mjs';
import type {ExamAttempt, ExamPackage} from './exam-model';

export type ExamInputFile = {size: number; stream: () => ReadableStream<Uint8Array>};
export type StreamAsset = {id: string; mime: ExamPackage['assets'][number]['mime']; spoolId: string; bytes: number};
export type StreamPackage = {key: string; definition: Omit<ExamPackage, 'assets'>; fingerprint: string; bytes: number; assets: StreamAsset[]};
export type StreamManifest = {kind: 'package' | 'backup'; ownerId: string; rawSha256?: string; packages: StreamPackage[]; attempts: ExamAttempt[]};
export type StreamHashFactory = () => {update: (bytes: Uint8Array) => unknown; hex: () => string};
export type StreamPrepared = {kind: 'package' | 'backup'; canonical?: ExamPackage; packages?: unknown[]; ownerId?: string; attempts?: ExamAttempt[]};
export type StreamResult = {prepared: StreamPrepared; manifest: StreamManifest; rawSha256: string; inputBytes: number; stats: {nodes: number; decodeBytes: number; maxRetainedStringChars: number}};
export type StreamStage = {
  runId: string; counts: Record<string, number>;
  read: (id: string) => AsyncGenerator<Uint8Array>;
  retain: (ids: string[]) => Promise<void>;
  discard: () => Promise<void>;
  activate: (manifest: StreamManifest, options?: {stores?: string[]; signal?: AbortSignal; write?: (tx: IDBTransaction, manifest: StreamManifest) => Promise<void>}) => Promise<void>;
};
export const SPOOL_RUNS = 'v040ImportRuns';
export const SPOOL_CHUNKS = 'v040ImportChunks';
export const IdbSpool = SpoolRuntime as unknown as {
  new(db: IDBDatabase, ownerId: string, runId: string, counts?: Record<string, number>): StreamStage;
  begin: (db: IDBDatabase, ownerId: string, runId?: string) => Promise<StreamStage>;
};
export const createSpoolStores = createRuntime as (db: IDBDatabase) => void;
export const readActiveAssetBlob = blobRuntime as (db: IDBDatabase, ownerId: string, runId: string, spoolId: string) => Promise<Blob>;
export const packageChunks = packageRuntime as unknown as (prepared: StreamPrepared, stage: StreamStage) => AsyncGenerator<Uint8Array>;
export const restorePrepared = restoreRuntime as unknown as (manifest: StreamManifest, stage: StreamStage, model: typeof import('./exam-model'), options?: {verify?: boolean; hashFactory?: StreamHashFactory}) => Promise<StreamPrepared>;
export const writeLegacyJson = writeRuntime as unknown as (prepared: StreamPrepared, stage: StreamStage, writer: {write: (bytes: Uint8Array) => unknown; close?: () => unknown; abort?: (error?: unknown) => unknown}) => Promise<void>;

export function checkImportSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('操作已取消，原题包和记录保留。');
}

/** Original files are never materialized with text()/arrayBuffer(). Old ArkWeb
 * without Blob.stream can read fixed-size slices; it has no unbounded fallback.
 */
export function boundedFile(file: Blob | ExamInputFile): ExamInputFile {
  if (typeof file.stream === 'function') return {size: file.size, stream: () => file.stream()};
  const blob = file as Blob;
  if (typeof blob.slice !== 'function') throw new Error('当前环境不能安全读取题包文件');
  return {size: blob.size, stream: () => {
    let offset = 0;
    return new ReadableStream<Uint8Array>({async pull(controller) {
      if (offset >= blob.size) {controller.close(); return;}
      try {const end = Math.min(blob.size, offset + 64 * 1024), bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer()); offset = end; controller.enqueue(bytes);}
      catch (error) {controller.error(error);}
    }});
  }};
}

export function examTransferError(error: unknown): unknown {
  const detail = error as {name?: string; message?: string};
  const message = detail?.name === 'QuotaExceededError' || detail?.name === 'UnknownError' ? '本机空间不足或存储不可用，操作未完成，原题包和记录保留' :
    detail?.message === 'Truncated JSON stream' ? '题包或备份下载不完整，原题包和记录保留' :
    detail?.message === 'JSON stream exceeds declared size' ? '数据长度超过声明长度，未导入' :
    detail?.message === 'Invalid or cross-owner backup' ? '备份无效或属于其他账号，未导入' :
    detail?.message === 'Noncontinuous attempt history' ? '首次与重测序号不连续或时间冲突，未导入' : undefined;
  return message ? new Error(message, {cause: error}) : error;
}
export async function streamImport(file: ExamInputFile, stage: StreamStage, ownerId: string, options: {mode?: 'package' | 'backup'; now?: number; signal?: AbortSignal; hashFactory?: StreamHashFactory} = {}): Promise<StreamResult> {
  const read = stage.read.bind(stage);
  stage.read = async function* (id: string) {checkImportSignal(options.signal); for await (const chunk of read(id)) {checkImportSignal(options.signal); yield chunk;}};
  try {return await (importRuntime as unknown as (file: ExamInputFile, options: unknown) => Promise<StreamResult>)(file, {stage, model, ownerId, ...options, activate: false});}
  catch (error) {checkImportSignal(options.signal); throw examTransferError(error);}
}

const spoolLockName = (db: IDBDatabase, runId: string) => 'lantern-exam-spool:' + db.name + ':' + runId;
const idbRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
async function spoolTransaction<T>(db: IDBDatabase, names: string[], work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const tx = db.transaction(names, 'readwrite');
  const done = new Promise<void>((resolve, reject) => {tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('Spool cleanup transaction aborted')); tx.onerror = () => {};});
  void done.catch(() => {});
  try {const result = await work(tx); await done; return result;} catch (error) {try {tx.abort();} catch {} await done.catch(() => {}); throw error;}
}

/** A held Web Lock survives background throttling and disappears on page crash.
 * No TTL can safely distinguish a suspended tab from an abandoned import.
 */
export async function beginManagedSpool(db: IDBDatabase, ownerId: string): Promise<StreamStage> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return IdbSpool.begin(db, ownerId);
  const runId = crypto.randomUUID();
  let unlock!: () => void, acquired!: () => void, acquisitionFailed!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {acquired = resolve; acquisitionFailed = reject;});
  const released = new Promise<void>(resolve => {unlock = resolve;});
  const holding = locks.request(spoolLockName(db, runId), async () => {acquired(); await released;});
  void holding.catch(acquisitionFailed);
  await ready;
  let stage: StreamStage | undefined;
  try {
    stage = await IdbSpool.begin(db, ownerId, runId);
    await spoolTransaction(db, [SPOOL_RUNS], async tx => {
      const store = tx.objectStore(SPOOL_RUNS), run = await idbRequest(store.get(runId));
      await idbRequest(store.put({...run, lockProtocol: 1}));
    });
    const discard = stage.discard.bind(stage), activate = stage.activate.bind(stage);
    stage.discard = async () => {try {await discard();} finally {unlock(); await holding;}};
    stage.activate = async (...args) => {await activate(...args); unlock(); await holding;};
    return stage;
  } catch (error) {try {await stage?.discard();} finally {unlock(); await holding;} throw error;}
}

/** Only lock-protected, unpublished runs of this owner are eligible. The
 * availability check protects other active tabs; active manifests are never GC'd.
 * Platforms lacking Web Locks retain crash debris rather than risk live data.
 */
export async function cleanupAbandonedSpools(db: IDBDatabase, ownerId: string): Promise<number> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return 0;
  const candidates = await new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction([SPOOL_RUNS], 'readonly'), cursor = tx.objectStore(SPOOL_RUNS).openCursor(), found: string[] = [];
    tx.onabort = () => reject(tx.error); tx.oncomplete = () => resolve(found);
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {const row = cursor.result; if (!row) return; const run = row.value; if (run.ownerId === ownerId && run.status === 'staging' && run.lockProtocol === 1) found.push(run.runId); row.continue();};
  });
  let removed = 0;
  for (const runId of candidates) await locks.request(spoolLockName(db, runId), {ifAvailable: true}, async lock => {
    if (!lock) return;
    await spoolTransaction(db, [SPOOL_RUNS, SPOOL_CHUNKS], async tx => {
      const store = tx.objectStore(SPOOL_RUNS), run = await idbRequest(store.get(runId));
      if (!run || run.ownerId !== ownerId || run.status !== 'staging' || run.lockProtocol !== 1) return;
      await new Promise<void>((resolve, reject) => {
        const chunks = tx.objectStore(SPOOL_CHUNKS), cursor = chunks.index('runId').openKeyCursor(runId);
        cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => {const row = cursor.result; if (!row) {resolve(); return;} chunks.delete(row.primaryKey); row.continue();};
      });
      await idbRequest(store.delete(runId)); removed++;
    });
  });
  return removed;
}

/** Upload validation is isolated from learning records and always discards its
 * unpublished spool. Content is never activated merely to calculate a manifest.
 */
export async function withValidatedPackage<T>(file: Blob | ExamInputFile, consume: (result: StreamResult, stage: StreamStage) => Promise<T>, options: {signal?: AbortSignal; ownerId?: string; factory?: IDBFactory} = {}): Promise<T> {
  checkImportSignal(options.signal);
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) throw new Error('当前环境缺少安全的题包临时存储，未退回整文件内存解析');
  const ownerId = options.ownerId ?? 'file-validation-' + crypto.randomUUID();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = factory.open('lantern-exam-validation-v1', 1);
    opening.onupgradeneeded = () => createSpoolStores(opening.result);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error('临时题包存储不可用'));
    opening.onblocked = () => reject(new Error('临时题包存储被旧页面阻止'));
  });
  let stage: StreamStage | undefined;
  try {
    await cleanupAbandonedSpools(db, ownerId);
    checkImportSignal(options.signal); stage = await beginManagedSpool(db, ownerId);
    const result = await streamImport(boundedFile(file), stage, ownerId, {signal: options.signal});
    checkImportSignal(options.signal); return await consume(result, stage);
  } finally {await stage?.discard().catch(() => {}); db.close();}
}
