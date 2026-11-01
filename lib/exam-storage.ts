import {
  EXAM_LIMITS, advanceAttempt, answerQuestion, assertOwner, createAttempt, examKey,
  gradeAttempt,
  markInterrupted, selectQuestion, submitAttempt, validateAttempt,
  type ExamAttempt, type ExamDefinition, type ExamFormat, type ExamPackage, type ExamResult, type ExamSource, type InterruptionReason,
} from './exam-model';
import * as examModel from './exam-model';
import {IdbSpool, beginManagedSpool, cleanupAbandonedSpools, createSpoolStores, readActiveAssetBlob, streamImport, restorePrepared, packageChunks, checkImportSignal, examTransferError, boundedFile,
  SPOOL_RUNS, SPOOL_CHUNKS, type ExamInputFile, type StreamStage, type StreamManifest, type StreamPackage, type StreamPrepared, type StreamHashFactory} from './exam-stream-adapter';
import {jsonInputFile, jsonChunks, BlobChunkWriter} from './exam-json-writer';

export type ExamSummary = {
  key: string; id: string; version: number; title: string; source: ExamSource;
  fingerprint: string; bytes: number; importedAt: number;
  listeningDurationMs?: number; format?: ExamFormat;
};
export type SavedExamAttempt = { attempt: ExamAttempt; result?: ExamResult };
export type ExamBackup = { kind: 'lantern-exam-backup'; schemaVersion: 1; ownerId: string; packages: ExamPackage[]; attempts: ExamAttempt[] };
type CatalogRow = ExamSummary & { ownerId: string; definition: Omit<ExamPackage, 'assets'> };
export type ExamView = ExamDefinition & {assets: {id: string; mime: ExamPackage['assets'][number]['mime']; bytes: number}[]};
type LegacyPackageRow = {ownerId: string; key: string; exam: ExamPackage};
type StreamPackageRow = {ownerId: string; key: string; runId: string; package: StreamPackage};
type PackageRow = LegacyPackageRow | StreamPackageRow;
type ImportOptions = {signal?: AbortSignal; expected?: {examId: string; version: number; title: string; format?: ExamFormat; bytes: number; sha256: string}; migration?: {key: string; fingerprint: string}};
type AttemptRow = SavedExamAttempt & { ownerId: string; id: string };
const STORES = ['packages', 'catalog', 'attempts'];
const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error ?? new Error('本机数据库请求失败')); });
const identity = (a: ExamAttempt) => [a.id, a.ownerId, a.examId, a.examVersion, a.fingerprint, a.ordinal, a.startedAt].join('|');
function comparableAttempt(attempt: ExamAttempt): string {
  // Replaying the same backup at a later clock tick can advance the same state in fewer revisions.
  // Ignore only that implementation counter; answers, focus time, clocks and interruptions still match.
  const { revision: _revision, ...state } = attempt; void _revision;
  return JSON.stringify(state);
}
function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new Error('当前环境无法生成安全记录 ID');
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
}
function summary(row: CatalogRow): ExamSummary {
  const { key, id, version, title, source, fingerprint, bytes, importedAt } = row;
  return { key, id, version, title, source, fingerprint, bytes, importedAt, ...(row.definition.listeningDurationMs === undefined ? {} : { listeningDurationMs: row.definition.listeningDurationMs }), ...(row.definition.format === undefined ? {} : { format: row.definition.format }) };
}
function definitionExam(row: CatalogRow): ExamDefinition { return row.definition; }
function saved(attempt: ExamAttempt, row: CatalogRow): SavedExamAttempt {
  return { attempt, ...(attempt.status === 'submitted' ? { result: gradeAttempt(definitionExam(row), attempt) } : {}) };
}
function enforceHistory(rows: ExamAttempt[]) {
  if (rows.length > EXAM_LIMITS.attempts) throw new Error('本机模考记录达到限额，请保留备份');
  if (rows.filter(a => a.status !== 'submitted').length > 1) throw new Error('本机已有进行中的模考，请先继续或交卷');
  const perExam = new Map<string, ExamAttempt[]>();
  for (const a of rows) perExam.set(a.examId, [...(perExam.get(a.examId) || []), a]);
  for (const attempts of perExam.values()) {
    attempts.sort((a, b) => a.ordinal - b.ordinal);
    attempts.forEach((a, i) => {
      if (a.ordinal !== i + 1 || (i && a.startedAt < attempts[i - 1].startedAt)) throw new Error('首次与重测序号不连续或冲突');
    });
  }
}

/** One bound owner per repository. No API calls, StudyData writes, or account fallback. */
export class ExamRepository {
  readonly ownerId: string;
  private closed = false;
  private operations = new Set<Promise<unknown>>();
  private controllers = new Set<AbortController>();
  constructor(private db: IDBDatabase, ownerId: string, private hashFactory?: StreamHashFactory) { this.ownerId = assertOwner(ownerId); }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const controller of this.controllers) controller.abort(new Error('模考页面或账号范围已关闭，导入已取消'));
    // Let aborted unpublished imports discard their spool before closing the DB.
    if (!this.operations.size) this.db.close();
  }
  private async operation<T>(work: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> {
    if (this.closed) throw new Error('本机模考存储已关闭，请按当前账号重新打开');
    checkImportSignal(external);
    const controller = new AbortController(), abort = () => controller.abort(external?.reason ?? new Error('操作已取消，原题包和记录保留。'));
    external?.addEventListener('abort', abort, {once: true}); this.controllers.add(controller);
    const pending = work(controller.signal); this.operations.add(pending);
    try {return await pending;}
    catch (error) {checkImportSignal(controller.signal); throw examTransferError(error);}
    finally {external?.removeEventListener('abort', abort); this.controllers.delete(controller); this.operations.delete(pending); if (this.closed && !this.operations.size) this.db.close();}
  }
  private async transaction<T>(names: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('本机模考存储已关闭，请按当前账号重新打开');
    const tx = this.db.transaction(names, mode);
    const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('本机事务已取消')); tx.onerror = () => {}; });
    // Consume an early abort while action is still unwinding, then await completion below.
    void done.catch(() => {});
    try { const result = await action(tx); await done; return result; }
    catch (error) {
      try { tx.abort(); } catch { /* Transaction may already have aborted. */ }
      await done.catch(() => {});
      if (error instanceof Error && (error.name === 'QuotaExceededError' || error.name === 'UnknownError')) throw new Error('本机空间不足或存储不可用，操作未保存，原题包和记录保留。', { cause: error });
      throw error;
    }
  }
  private owned<T>(tx: IDBTransaction, store: string): Promise<T[]> { return request(tx.objectStore(store).index('owner').getAll(this.ownerId)); }
  private async catalog(tx: IDBTransaction, key: string): Promise<CatalogRow> {
    const row = await request<CatalogRow | undefined>(tx.objectStore('catalog').get([this.ownerId, key]));
    if (!row) throw new Error('当前账号没有这套本机题包'); return row;
  }
  async listPackages(): Promise<ExamSummary[]> {
    return this.transaction(['catalog'], 'readonly', async tx => (await this.owned<CatalogRow>(tx, 'catalog')).map(summary).sort((a, b) => b.importedAt - a.importedAt || a.key.localeCompare(b.key)));
  }
  private async packageRow(key: string): Promise<PackageRow> {
    return this.transaction(['packages'], 'readonly', async tx => {
      const row = await request<PackageRow | undefined>(tx.objectStore('packages').get([this.ownerId, key]));
      if (!row) throw new Error('当前账号没有这套本机题包'); return row;
    });
  }
  private async streamRow(key: string, signal?: AbortSignal): Promise<StreamPackageRow> {
    const row = await this.packageRow(key);
    if ('runId' in row) return row;
    const catalog = await this.transaction(['catalog'], 'readonly', tx => this.catalog(tx, key));
    // Existing IDB schema-1 rows must be read once to migrate. No full JSON copy,
    // full atob or eager migration of every private package is performed here.
    const file = jsonInputFile(row.exam, {maxBytes: EXAM_LIMITS.importBytes});
    await this.importPackageFile(file, catalog.importedAt, {signal, migration: {key, fingerprint: catalog.fingerprint}});
    const migrated = await this.packageRow(key);
    if (!('runId' in migrated)) throw new Error('题包迁移未完成，原题包保留'); return migrated;
  }
  async getDefinition(key: string): Promise<ExamView> {
    const row = await this.streamRow(key), p = row.package;
    return {...p.definition, assets: p.assets.map(({id, mime, bytes}) => ({id, mime, bytes}))};
  }
  async getAssetBlob(key: string, assetId: string): Promise<Blob> {
    const row = await this.streamRow(key), asset = row.package.assets.find(value => value.id === assetId);
    if (!asset) throw new Error('当前题包没有这份素材');
    const blob = await readActiveAssetBlob(this.db, this.ownerId, row.runId, asset.spoolId);
    if (this.closed) throw new Error('模考页面或账号范围已关闭'); return blob;
  }
  private async preparedPackage(key: string, verify = true, signal?: AbortSignal): Promise<{prepared: StreamPrepared; stage: StreamStage}> {
    const row = await this.streamRow(key, signal);
    const run = await this.transaction([SPOOL_RUNS], 'readonly', tx => request<{ownerId: string; status: string; counts: Record<string, number>} | undefined>(tx.objectStore(SPOOL_RUNS).get(row.runId)));
    if (!run || run.ownerId !== this.ownerId || run.status !== 'active') throw new Error('题包素材尚未完整保存');
    const stage = new IdbSpool(this.db, this.ownerId, row.runId, run.counts);
    const read = stage.read.bind(stage);
    stage.read = async function* (id: string) {checkImportSignal(signal); for await (const chunk of read(id)) {checkImportSignal(signal); yield chunk;}};
    const prepared = await restorePrepared({kind: 'package', ownerId: this.ownerId, packages: [row.package], attempts: []}, stage, examModel, {verify, hashFactory: this.hashFactory});
    return {prepared, stage};
  }
  /** Explicit compatibility API. Product screens use getDefinition/getAssetBlob. */
  async getPackage(key: string): Promise<ExamPackage> {
    const {prepared, stage} = await this.preparedPackage(key);
    const writer = new BlobChunkWriter({maxBytes: EXAM_LIMITS.importBytes});
    try {for await (const chunk of packageChunks(prepared, stage)) await writer.write(chunk); await writer.close(); return JSON.parse(await writer.toBlob().text()) as ExamPackage;}
    catch (error) {await writer.abort(error); throw error;}
  }
  async importPackage(input: unknown, now = Date.now()): Promise<{status: 'imported' | 'unchanged'; summary: ExamSummary}> {
    return this.importPackageFile(jsonInputFile(input, {maxBytes: EXAM_LIMITS.importBytes}), now);
  }
  async importPackageFile(file: Blob | ExamInputFile, now = Date.now(), options: ImportOptions = {}): Promise<{status: 'imported' | 'unchanged'; summary: ExamSummary}> {
    return this.operation(async signal => {
      let stage: StreamStage | undefined, active = false;
      try {
        checkImportSignal(signal); stage = await beginManagedSpool(this.db, this.ownerId);
        const result = await streamImport(boundedFile(file), stage, this.ownerId, {now, signal, hashFactory: this.hashFactory});
        const incoming = result.manifest.packages[0], expected = options.expected;
        if (expected && (result.inputBytes !== expected.bytes || result.rawSha256 !== expected.sha256 || incoming.definition.id !== expected.examId || incoming.definition.version !== expected.version || incoming.definition.title !== expected.title || incoming.definition.format !== expected.format)) throw new Error('题包原文件校验或目录身份不匹配，未导入');
        if (options.migration && (incoming.key !== options.migration.key || incoming.fingerprint !== options.migration.fingerprint)) throw new Error('旧题包内容与原摘要不符，原题包保留');
        const outcome = await this.commitStream(stage, result.manifest, now, signal, options.migration);
        active = result.manifest.packages.length > 0;
        return {status: outcome.packagesAdded ? 'imported' : 'unchanged', summary: outcome.summary!};
      } finally {if (stage && !active) await stage.discard().catch(() => {});}
    }, options.signal);
  }
  private async commitStream(stage: StreamStage, manifest: StreamManifest, now: number, signal: AbortSignal, migration?: {key: string; fingerprint: string}): Promise<{packagesAdded: number; attemptsAdded: number; summary?: ExamSummary}> {
    let result: {packagesAdded: number; attemptsAdded: number; summary?: ExamSummary} | undefined;
    await stage.activate(manifest, {stores: [...STORES, SPOOL_CHUNKS], signal, write: async (tx, incoming) => {
      const [existing, history] = await Promise.all([this.owned<CatalogRow>(tx, 'catalog'), this.owned<AttemptRow>(tx, 'attempts')]);
      const additions: {p: StreamPackage; catalog: CatalogRow}[] = [], replacements: StreamPackage[] = [];
      for (const p of incoming.packages) {
        const old = existing.find(value => value.key === p.key);
        if (old && old.fingerprint !== p.fingerprint) throw new Error('同 ID、同版本题包内容冲突，原题包未覆盖');
        if (migration) {
          if (!old || old.key !== migration.key || old.fingerprint !== migration.fingerprint) throw new Error('迁移期间题包已移除或改变，未重新创建');
          const row = await request<PackageRow | undefined>(tx.objectStore('packages').get([this.ownerId, p.key]));
          if (!row) throw new Error('旧题包记录缺失，迁移未保存');
          if ('exam' in row) replacements.push(p);
        } else if (!old) additions.push({p, catalog: {ownerId: this.ownerId, key: p.key, id: p.definition.id, version: p.definition.version, title: p.definition.title, source: p.definition.source, fingerprint: p.fingerprint, bytes: p.bytes, importedAt: now, definition: p.definition}});
      }
      if (existing.length + additions.length > EXAM_LIMITS.packages || [...existing, ...additions.map(value => value.catalog)].reduce((sum, value) => sum + value.bytes, 0) > EXAM_LIMITS.ownerBytes) throw new Error('本机题包总数或容量达到限额');
      const newAttempts: ExamAttempt[] = [];
      for (const attempt of incoming.attempts) {
        const old = history.find(value => value.id === attempt.id);
        if (old) {if (comparableAttempt(advanceAttempt(old.attempt, now)) !== comparableAttempt(attempt)) throw new Error('备份中同 ID 模考记录冲突，原记录未覆盖；请保留两个备份。');}
        else newAttempts.push(attempt);
      }
      const merged = incoming.kind === 'backup' ? history.map(value => advanceAttempt(value.attempt, now)) : history.map(value => value.attempt);
      enforceHistory([...merged, ...newAttempts]);
      const allCatalog = [...existing, ...additions.map(value => value.catalog)];
      // Finish every semantic check before pruning or writing. Final stage visibility,
      // packages, catalog, history and discarded duplicate chunks share this transaction.
      const changes = incoming.kind === 'backup' ? [...merged, ...newAttempts] : [];
      const savedChanges = changes.map(attempt => {
        const catalog = allCatalog.find(value => value.key === examKey({id: attempt.examId, version: attempt.examVersion}));
        if (!catalog) throw new Error('模考对应题包缺失');
        return {...saved(attempt, catalog), ownerId: this.ownerId, id: attempt.id} satisfies AttemptRow;
      });
      const visible = [...additions.map(value => value.p), ...replacements], keep = new Set(visible.flatMap(p => p.assets.map(asset => asset.spoolId)));
      await new Promise<void>((resolve, reject) => {
        const cursor = tx.objectStore(SPOOL_CHUNKS).index('runId').openCursor(stage.runId);
        cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => {const row = cursor.result; if (!row) {resolve(); return;} if (!keep.has(row.value.asset)) row.delete(); row.continue();};
      });
      stage.counts = Object.fromEntries(Object.entries(stage.counts).filter(([id]) => keep.has(id)));
      for (const {p, catalog} of additions) {await request(tx.objectStore('packages').add({ownerId: this.ownerId, key: p.key, runId: stage.runId, package: p} satisfies StreamPackageRow)); await request(tx.objectStore('catalog').add(catalog));}
      for (const p of replacements) await request(tx.objectStore('packages').put({ownerId: this.ownerId, key: p.key, runId: stage.runId, package: p} satisfies StreamPackageRow));
      for (const row of savedChanges) await request(tx.objectStore('attempts').put(row));
      const primary = incoming.packages[0];
      result = {packagesAdded: additions.length, attemptsAdded: newAttempts.length, ...(primary ? {summary: summary(allCatalog.find(value => value.key === primary.key)!)} : {})};
      incoming.packages = visible;
    }});
    if (!result) throw new Error('题包激活结果未确认'); return result;
  }
  /** Explicit user action only; every package needed by a saved attempt is retained. */
  async removeUnusedPackage(key: string): Promise<void> {
    return this.transaction([...STORES, SPOOL_RUNS, SPOOL_CHUNKS], 'readwrite', async tx => {
      const row = await this.catalog(tx, key), history = await this.owned<AttemptRow>(tx, 'attempts');
      if (history.some(value => value.attempt.examId === row.id && value.attempt.examVersion === row.version)) throw new Error('这份题包已有考试记录，不能移除；原题包和记录保留。');
      const pkg = await request<PackageRow | undefined>(tx.objectStore('packages').get([this.ownerId, key]));
      if (pkg && 'runId' in pkg) {
        const store = tx.objectStore(SPOOL_RUNS), run = await request<{runId: string; ownerId: string; manifest: StreamManifest; counts: Record<string, number>} | undefined>(store.get(pkg.runId));
        if (!run || run.ownerId !== this.ownerId) throw new Error('题包素材范围不匹配，未移除');
        const removed = new Set(pkg.package.assets.map(value => value.spoolId));
        await new Promise<void>((resolve, reject) => {
          const cursor = tx.objectStore(SPOOL_CHUNKS).index('runId').openCursor(pkg.runId);
          cursor.onerror = () => reject(cursor.error); cursor.onsuccess = () => {const item = cursor.result; if (!item) {resolve(); return;} if (removed.has(item.value.asset)) item.delete(); item.continue();};
        });
        const packages = run.manifest.packages.filter(value => value.key !== key);
        if (packages.length) await request(store.put({...run, manifest: {...run.manifest, packages}, counts: Object.fromEntries(Object.entries(run.counts).filter(([id]) => !removed.has(id)))}));
        else await request(store.delete(pkg.runId));
      }
      await request(tx.objectStore('packages').delete([this.ownerId, key])); await request(tx.objectStore('catalog').delete([this.ownerId, key]));
    });
  }
  async listAttempts(): Promise<SavedExamAttempt[]> {
    return this.transaction(['attempts'], 'readonly', async tx => (await this.owned<AttemptRow>(tx, 'attempts')).map(r => ({ attempt: r.attempt, ...(r.result ? { result: r.result } : {}) })).sort((a, b) => b.attempt.startedAt - a.attempt.startedAt || b.attempt.ordinal - a.attempt.ordinal));
  }
  async startAttempt(key: string, now = Date.now(), attemptId = randomId()): Promise<SavedExamAttempt> {
    return this.transaction(['catalog', 'attempts'], 'readwrite', async tx => {
      const exam = await this.catalog(tx, key), history = await this.owned<AttemptRow>(tx, 'attempts');
      if (history.some(r => r.id === attemptId)) throw new Error('考试记录 ID 重复');
      for (const row of history) {
        if (row.attempt.status === 'submitted') continue;
        const current = advanceAttempt(row.attempt, now);
        if (current.status !== 'submitted') throw new Error('本机已有进行中的模考，请先继续或交卷');
        const oldExam = await this.catalog(tx, examKey({ id: current.examId, version: current.examVersion }));
        row.attempt = current; row.result = gradeAttempt(definitionExam(oldExam), current);
        await request(tx.objectStore('attempts').put(row));
      }
      const ordinal = history.filter(r => r.attempt.examId === exam.id).length + 1;
      const attempt = createAttempt(definitionExam(exam), { id: attemptId, ownerId: this.ownerId, fingerprint: exam.fingerprint, ordinal, now });
      enforceHistory([...history.map(r => r.attempt), attempt]);
      const result = { attempt };
      await request(tx.objectStore('attempts').add({ ...result, ownerId: this.ownerId, id: attempt.id } satisfies AttemptRow));
      return result;
    });
  }
  private async act(attemptId: string, now: number, action: (a: ExamAttempt) => ExamAttempt, expectedRevision?: number): Promise<SavedExamAttempt> {
    return this.transaction(['catalog', 'attempts'], 'readwrite', async tx => {
      const record = await request<AttemptRow | undefined>(tx.objectStore('attempts').get([this.ownerId, attemptId]));
      if (!record) throw new Error('当前账号没有这次模考记录');
      if (expectedRevision !== undefined && record.attempt.revision !== expectedRevision) throw new Error('其他页面已更新模考，请刷新当前记录后继续');
      const row = await this.catalog(tx, examKey({ id: record.attempt.examId, version: record.attempt.examVersion }));
      const old = validateAttempt(record.attempt, definitionExam(row), this.ownerId, row.fingerprint);
      const timed = advanceAttempt(old, now);
      // On expiry, persist the automatic submission even if the pending UI action was an answer.
      const next = timed.status === 'submitted' ? timed : action(timed);
      if (identity(old) !== identity(next)) throw new Error('考试记录身份不可改写');
      const attempt = validateAttempt(next, definitionExam(row), this.ownerId, row.fingerprint), result = saved(attempt, row);
      if (JSON.stringify(result) !== JSON.stringify({ attempt: record.attempt, ...(record.result ? { result: record.result } : {}) })) await request(tx.objectStore('attempts').put({ ...result, ownerId: this.ownerId, id: attempt.id } satisfies AttemptRow));
      return result;
    });
  }
  resumeAttempt(attemptId: string, now = Date.now()): Promise<SavedExamAttempt> { return this.act(attemptId, now, a => a); }
  answer(attemptId: string, number: number, choice: number | null, now = Date.now(), expectedRevision?: number): Promise<SavedExamAttempt> {
    return this.act(attemptId, now, a => answerQuestion(a, number, choice, now), expectedRevision);
  }
  select(attemptId: string, number: number, now = Date.now(), expectedRevision?: number): Promise<SavedExamAttempt> {
    return this.act(attemptId, now, a => selectQuestion(a, number, now), expectedRevision);
  }
  submit(attemptId: string, now = Date.now(), expectedRevision?: number): Promise<SavedExamAttempt> {
    return this.act(attemptId, now, a => submitAttempt(a, now), expectedRevision);
  }
  markInterrupted(attemptId: string, reason: InterruptionReason, now = Date.now(), expectedRevision?: number): Promise<SavedExamAttempt> {
    return this.act(attemptId, now, a => markInterrupted(a, reason, now), expectedRevision);
  }
  private async backupSnapshot(): Promise<{catalog: CatalogRow[]; attempts: ExamAttempt[]}> {
    return this.transaction(['catalog', 'attempts'], 'readonly', async tx => {
      const [catalog, attempts] = await Promise.all([this.owned<CatalogRow>(tx, 'catalog'), this.owned<AttemptRow>(tx, 'attempts')]);
      return {catalog, attempts: attempts.map(value => value.attempt)};
    });
  }
  /** Writes one immutable package at a time. The attempts/catalog snapshot is
   * taken atomically; a concurrently removed source makes the whole export fail.
   */
  async writeBackup(writer: {write: (bytes: Uint8Array) => unknown; close?: () => unknown; abort?: (error?: unknown) => unknown}, options: {signal?: AbortSignal} = {}): Promise<void> {
    return this.operation(async signal => {
      let bytes = 0;
      const emit = async (chunk: Uint8Array) => {checkImportSignal(signal); bytes += chunk.byteLength; if (bytes > EXAM_LIMITS.backupBytes) throw new Error('完整备份超过导出限额'); await writer.write(chunk);};
      try {
        const snapshot = await this.backupSnapshot(), encoder = new TextEncoder();
        await emit(encoder.encode('{"kind":"lantern-exam-backup","schemaVersion":1,"ownerId":' + JSON.stringify(this.ownerId) + ',"packages":['));
        for (let index = 0; index < snapshot.catalog.length; index++) {
          if (index) await emit(encoder.encode(','));
          const item = snapshot.catalog[index], {prepared, stage} = await this.preparedPackage(item.key, true, signal);
          const current = await this.transaction(['catalog'], 'readonly', tx => this.catalog(tx, item.key));
          if (current.fingerprint !== item.fingerprint) throw new Error('导出期间题包身份改变，请重试');
          for await (const chunk of packageChunks(prepared, stage)) await emit(chunk);
        }
        await emit(encoder.encode('],"attempts":'));
        for (const chunk of jsonChunks(snapshot.attempts, {signal})) await emit(chunk);
        await emit(encoder.encode('}')); checkImportSignal(signal); await writer.close?.();
      } catch (error) {await writer.abort?.(error); throw error;}
    }, options.signal);
  }
  /** Browser/Harmony download fallback: bounded JS chunks, final native Blob.
   * This is not a promise of constant total memory or native filesystem streaming.
   */
  async exportBackupBlob(options: {signal?: AbortSignal} = {}): Promise<Blob> {
    const writer = new BlobChunkWriter({maxBytes: EXAM_LIMITS.backupBytes, signal: options.signal});
    await this.writeBackup(writer, options); return writer.toBlob();
  }
  /** Explicit schema-1 compatibility API; product downloads use exportBackupBlob. */
  async exportBackup(): Promise<ExamBackup> {
    return JSON.parse(await (await this.exportBackupBlob()).text()) as ExamBackup;
  }
  async importBackup(input: unknown, now = Date.now()): Promise<{packagesAdded: number; attemptsAdded: number}> {
    return this.importBackupFile(jsonInputFile(input, {maxBytes: EXAM_LIMITS.backupBytes}), now);
  }
  async importBackupFile(file: Blob | ExamInputFile, now = Date.now(), options: {signal?: AbortSignal} = {}): Promise<{packagesAdded: number; attemptsAdded: number}> {
    return this.operation(async signal => {
      let stage: StreamStage | undefined, active = false;
      try {
        checkImportSignal(signal); stage = await beginManagedSpool(this.db, this.ownerId);
        const result = await streamImport(boundedFile(file), stage, this.ownerId, {mode: 'backup', now, signal, hashFactory: this.hashFactory});
        const outcome = await this.commitStream(stage, result.manifest, now, signal);
        active = result.manifest.packages.length > 0;
        return {packagesAdded: outcome.packagesAdded, attemptsAdded: outcome.attemptsAdded};
      } finally {if (stage && !active) await stage.discard().catch(() => {});}
    }, options.signal);
  }

}

export async function openExamRepository(ownerId: string, options: { factory?: IDBFactory; name?: string; hashFactory?: StreamHashFactory } = {}): Promise<ExamRepository> {
  assertOwner(ownerId);
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) throw new Error('当前浏览器不支持本机 IndexedDB，未退回不可靠的临时存储');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    // The version gate prevents older code from ignoring stored format profiles or LC durations.
    const r = factory.open(options.name ?? 'lantern-private-exams-v1', 4);
    r.onupgradeneeded = () => {
      createSpoolStores(r.result);
      for (const name of STORES) {
        if (r.result.objectStoreNames.contains(name)) continue;
        const store = r.result.createObjectStore(name, { keyPath: name === 'attempts' ? ['ownerId', 'id'] : ['ownerId', 'key'] });
        store.createIndex('owner', 'ownerId', { unique: false });
      }
    };
    r.onsuccess = () => { if (blocked) { r.result.close(); return; } r.result.onversionchange = () => r.result.close(); resolve(r.result); };
    r.onerror = () => reject(r.error ?? new Error('本机模考数据库无法打开'));
    r.onblocked = () => { blocked = true; reject(new Error('另一个页面阻止打开模考存储，请关闭旧页面后重试')); };
  });
  try {await cleanupAbandonedSpools(db, ownerId); return new ExamRepository(db, ownerId, options.hashFactory);} catch (error) {db.close(); throw error;}
}
