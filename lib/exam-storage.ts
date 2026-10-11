import {
  EXAM_LIMITS, advanceAttempt, answerQuestion, assertOwner, createAttempt, examKey,
  fingerprintExam, gradeAttempt, isRecord, jsonBytes, parseExamPackage, parseLimitedJson,
  markInterrupted, selectQuestion, submitAttempt, validateAttempt,
  type ExamAttempt, type ExamFormat, type ExamPackage, type ExamResult, type ExamSource, type InterruptionReason,
} from './exam-model';

export type ExamSummary = {
  key: string; id: string; version: number; title: string; source: ExamSource;
  fingerprint: string; bytes: number; importedAt: number;
  listeningDurationMs?: number; format?: ExamFormat;
};
export type SavedExamAttempt = { attempt: ExamAttempt; result?: ExamResult };
export type ExamBackup = { kind: 'lantern-exam-backup'; schemaVersion: 1; ownerId: string; packages: ExamPackage[]; attempts: ExamAttempt[] };
type CatalogRow = ExamSummary & { ownerId: string; definition: Omit<ExamPackage, 'assets'> };
type PackageRow = { ownerId: string; key: string; exam: ExamPackage };
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
function definitionExam(row: CatalogRow): ExamPackage { return { ...row.definition, assets: [] }; }
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
  constructor(private db: IDBDatabase, ownerId: string) { this.ownerId = assertOwner(ownerId); }
  close() { this.closed = true; this.db.close(); }
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
  async getPackage(key: string): Promise<ExamPackage> {
    return this.transaction(['packages'], 'readonly', async tx => {
      const row = await request<PackageRow | undefined>(tx.objectStore('packages').get([this.ownerId, key]));
      if (!row) throw new Error('当前账号没有这套本机题包'); return row.exam;
    });
  }
  /** Hash and media validation happen before the atomic IndexedDB transaction. */
  async importPackage(input: unknown, now = Date.now()): Promise<{ status: 'imported' | 'unchanged'; summary: ExamSummary }> {
    const exam = parseExamPackage(input), fingerprint = await fingerprintExam(exam), bytes = jsonBytes(exam), key = examKey(exam);
    const { assets: _assets, ...definition } = exam; void _assets;
    const row: CatalogRow = { ownerId: this.ownerId, key, id: exam.id, version: exam.version, title: exam.title, source: exam.source, fingerprint, bytes, importedAt: now, definition };
    return this.transaction(['packages', 'catalog'], 'readwrite', async tx => {
      const rows = await this.owned<CatalogRow>(tx, 'catalog'), old = rows.find(r => r.key === key);
      if (old) {
        if (old.fingerprint !== fingerprint) throw new Error('同 ID、同版本题包内容冲突，原题包未覆盖；请核对来源后使用新版本。');
        return { status: 'unchanged', summary: summary(old) };
      }
      if (rows.length >= EXAM_LIMITS.packages || rows.reduce((n, r) => n + r.bytes, bytes) > EXAM_LIMITS.ownerBytes) throw new Error('本机题包总数或容量达到限额');
      await request(tx.objectStore('packages').add({ ownerId: this.ownerId, key, exam } satisfies PackageRow));
      await request(tx.objectStore('catalog').add(row));
      return { status: 'imported', summary: summary(row) };
    });
  }
  /** Explicit user action only; every package needed by a saved attempt is retained. */
  async removeUnusedPackage(key: string): Promise<void> {
    return this.transaction(STORES, 'readwrite', async tx => {
      const row = await this.catalog(tx, key);
      const history = await this.owned<AttemptRow>(tx, 'attempts');
      if (history.some(r => r.attempt.examId === row.id && r.attempt.examVersion === row.version)) throw new Error('这份题包已有考试记录，不能移除；原题包和记录保留。');
      await request(tx.objectStore('packages').delete([this.ownerId, key]));
      await request(tx.objectStore('catalog').delete([this.ownerId, key]));
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
  /** A separate personal backup. Never put this output in the study/vocabulary backup or cloud sync. */
  async exportBackup(): Promise<ExamBackup> {
    return this.transaction(['packages', 'attempts'], 'readonly', async tx => {
      const [packages, attempts] = await Promise.all([this.owned<PackageRow>(tx, 'packages'), this.owned<AttemptRow>(tx, 'attempts')]);
      const backup: ExamBackup = { kind: 'lantern-exam-backup', schemaVersion: 1, ownerId: this.ownerId, packages: packages.map(r => r.exam), attempts: attempts.map(r => r.attempt) };
      if (jsonBytes(backup) > EXAM_LIMITS.backupBytes) throw new Error('完整备份超过导出限额'); return backup;
    });
  }
  async importBackup(input: unknown, now = Date.now()): Promise<{ packagesAdded: number; attemptsAdded: number }> {
    const raw = typeof input === 'string' ? parseLimitedJson(input, EXAM_LIMITS.backupBytes) : input;
    if (!isRecord(raw) || raw.kind !== 'lantern-exam-backup' || raw.schemaVersion !== 1 || raw.ownerId !== this.ownerId || Object.keys(raw).some(k => !['kind','schemaVersion','ownerId','packages','attempts'].includes(k))) throw new Error('备份格式不支持或属于其他账号；未导入任何私人内容。');
    if (!Array.isArray(raw.packages) || raw.packages.length > EXAM_LIMITS.packages || !Array.isArray(raw.attempts) || raw.attempts.length > EXAM_LIMITS.attempts || jsonBytes(raw) > EXAM_LIMITS.backupBytes) throw new Error('备份数量或容量超过限额');
    const incoming: { catalog: CatalogRow; exam: ExamPackage }[] = [];
    for (const value of raw.packages) {
      const exam = parseExamPackage(value), key = examKey(exam);
      if (incoming.some(r => r.catalog.key === key)) throw new Error('备份中题包 ID 和版本重复');
      const fingerprint = await fingerprintExam(exam), { assets: _assets, ...definition } = exam; void _assets;
      incoming.push({ exam, catalog: { ownerId: this.ownerId, key, id: exam.id, version: exam.version, title: exam.title, source: exam.source, fingerprint, bytes: jsonBytes(exam), importedAt: now, definition } });
    }
    const attempts: ExamAttempt[] = [];
    for (const value of raw.attempts) {
      if (!isRecord(value)) throw new Error('备份考试记录无效');
      const match = incoming.find(r => r.exam.id === value.examId && r.exam.version === value.examVersion);
      if (!match) throw new Error('备份缺少考试记录所对应的题包');
      const attempt = advanceAttempt(validateAttempt(value, match.exam, this.ownerId, match.catalog.fingerprint, now), now);
      if (attempts.some(a => a.id === attempt.id)) throw new Error('备份中考试记录 ID 重复');
      attempts.push(attempt);
    }
    return this.transaction(STORES, 'readwrite', async tx => {
      const [existing, history] = await Promise.all([this.owned<CatalogRow>(tx, 'catalog'), this.owned<AttemptRow>(tx, 'attempts')]);
      const added = incoming.filter(r => !existing.some(e => e.key === r.catalog.key));
      for (const row of incoming) {
        const old = existing.find(e => e.key === row.catalog.key);
        if (old && old.fingerprint !== row.catalog.fingerprint) throw new Error('备份中同 ID 题包内容冲突，原数据保留');
      }
      if (existing.length + added.length > EXAM_LIMITS.packages || [...existing, ...added.map(r => r.catalog)].reduce((n, r) => n + r.bytes, 0) > EXAM_LIMITS.ownerBytes) throw new Error('本机题包总数或容量达到限额');
      const newAttempts: ExamAttempt[] = [];
      for (const a of attempts) {
        const old = history.find(r => r.id === a.id);
        if (old) {
          const current = advanceAttempt(old.attempt, now);
          if (comparableAttempt(current) !== comparableAttempt(a)) throw new Error('备份中同 ID 模考记录冲突，原记录未覆盖；请保留两个备份。');
        } else newAttempts.push(a);
      }
      const mergedHistory = history.map(r => advanceAttempt(r.attempt, now));
      enforceHistory([...mergedHistory, ...newAttempts]);
      // All validation completed before the first write; IDB still provides rollback on quota failure.
      for (const row of added) { await request(tx.objectStore('packages').add({ ownerId: this.ownerId, key: row.catalog.key, exam: row.exam } satisfies PackageRow)); await request(tx.objectStore('catalog').add(row.catalog)); }
      for (const a of [...mergedHistory, ...newAttempts]) {
        const row = [...existing, ...added.map(r => r.catalog)].find(r => r.key === examKey({ id: a.examId, version: a.examVersion }));
        if (!row) throw new Error('模考对应题包缺失');
        await request(tx.objectStore('attempts').put({ ...saved(a, row), ownerId: this.ownerId, id: a.id } satisfies AttemptRow));
      }
      return { packagesAdded: added.length, attemptsAdded: newAttempts.length };
    });
  }
}

export async function openExamRepository(ownerId: string, options: { factory?: IDBFactory; name?: string } = {}): Promise<ExamRepository> {
  assertOwner(ownerId);
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) throw new Error('当前浏览器不支持本机 IndexedDB，未退回不可靠的临时存储');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    // The version gate prevents older code from ignoring stored format profiles or LC durations.
    const r = factory.open(options.name ?? 'lantern-private-exams-v1', 3);
    r.onupgradeneeded = () => {
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
  return new ExamRepository(db, ownerId);
}
