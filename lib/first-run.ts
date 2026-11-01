/** Device presentation metadata only. This marker never supplies an identity. */
export const FIRST_RUN_STORAGE_KEY = 'lantern-first-run-v1';
export const FIRST_RUN_KIND = 'lantern-first-run';
export const FIRST_RUN_INVENTORY_TIMEOUT_MS = 2000;
export type FirstRunReason = 'guest-entered' | 'verified-account' | 'existing-install';
export type FirstRunMarker = Readonly<{
  kind: typeof FIRST_RUN_KIND;
  schemaVersion: 1;
  completed: true;
  reason: FirstRunReason;
}>;
export type FirstRunStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>;
export type FirstRunInventory = {databases?: () => Promise<readonly {name?: string}[]>};
export type FirstRunInspectionOptions = Readonly<{signal?: AbortSignal; inventoryTimeoutMs?: number}>;
export type FirstRunInspection =
  | Readonly<{status: 'welcome'}>
  | Readonly<{status: 'complete'; reason: FirstRunReason; persisted: boolean}>;

const REASONS = new Set<FirstRunReason>(['guest-entered', 'verified-account', 'existing-install']);
// These repositories predate the welcome flow. Merely enumerate; never open or
// create a database while deciding whether an existing installation is present.
const EXISTING_DATABASES = new Set(['lantern-workflow-v1', 'lantern-private-exams-v1', 'lantern-audio']);
const STORAGE_ERROR = '首次使用记录暂时无法读取或保存。原学习记录未更改，请重试。';

export class FirstRunError extends Error {
  constructor(message = STORAGE_ERROR) { super(message); this.name = 'FirstRunError'; }
}

export function readFirstRunMarker(storage: FirstRunStorage): FirstRunMarker | null {
  let raw: string | null;
  try { raw = storage.getItem(FIRST_RUN_STORAGE_KEY); } catch { throw new FirstRunError(); }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const marker = value as Record<string, unknown>;
    if (marker.schemaVersion !== 1) throw new FirstRunError('首次使用记录版本不受支持。请保留本机数据并重试或更新应用。');
    if (Object.keys(marker).sort().join(',') !== 'completed,kind,reason,schemaVersion' ||
      marker.kind !== FIRST_RUN_KIND || marker.completed !== true || !REASONS.has(marker.reason as FirstRunReason)) throw new Error();
    return Object.freeze({kind: FIRST_RUN_KIND, schemaVersion: 1, completed: true, reason: marker.reason as FirstRunReason});
  } catch (error) {
    if (error instanceof FirstRunError) throw error;
    throw new FirstRunError('首次使用记录无法识别。原记录已保留，请重试或更新应用。');
  }
}

export function persistFirstRunCompletion(storage: FirstRunStorage, reason: FirstRunReason): FirstRunMarker {
  if (!REASONS.has(reason)) throw new FirstRunError('首次使用状态无效，请重试。');
  const prior = readFirstRunMarker(storage);
  if (prior) return prior;
  const marker: FirstRunMarker = {kind: FIRST_RUN_KIND, schemaVersion: 1, completed: true, reason};
  try { storage.setItem(FIRST_RUN_STORAGE_KEY, JSON.stringify(marker)); } catch { throw new FirstRunError(); }
  // A void setItem result alone is not an acknowledgement from a storage shim.
  const saved = readFirstRunMarker(storage);
  if (!saved) throw new FirstRunError();
  return saved;
}

function hasLegacyLocalRecords(storage: FirstRunStorage): boolean {
  try {
    for (let index = 0, count = storage.length; index < count; index++) {
      const name = storage.key(index);
      // Keep old device, product-owner and pre-product owner journals intact.
      // Presence is sufficient; do not parse or rewrite private learning facts.
      if (name && (name.startsWith('lantern-v1-') || name.startsWith('lantern-vocab-v1:'))) return true;
    }
    return false;
  } catch { throw new FirstRunError(); }
}

async function readDatabaseNames(inventory: FirstRunInventory, options: FirstRunInspectionOptions): Promise<readonly {name?: string}[]> {
  const read = inventory.databases!;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value?: readonly {name?: string}[], error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve(value!);
    };
    const aborted = () => finish(undefined, new FirstRunError('首次使用检查已取消，请重试。'));
    const timer = setTimeout(() => finish(undefined, new FirstRunError('首次使用记录检查超时。原学习记录未更改，请重试。')),
      options.inventoryTimeoutMs ?? FIRST_RUN_INVENTORY_TIMEOUT_MS);
    if (options.signal?.aborted) { aborted(); return; }
    options.signal?.addEventListener('abort', aborted, {once: true});
    Promise.resolve().then(() => read.call(inventory)).then(value => finish(value), () => finish(undefined, new FirstRunError()));
  });
}

export async function inspectFirstRun(
  storage: FirstRunStorage,
  owner: string | null,
  inventory?: FirstRunInventory,
  options: FirstRunInspectionOptions = {},
): Promise<FirstRunInspection> {
  if (options.signal?.aborted) throw new FirstRunError('首次使用检查已取消，请重试。');
  const marker = readFirstRunMarker(storage);
  if (marker) return {status: 'complete', reason: marker.reason, persisted: true};
  // The caller must supply an independently verified owner. This test is only a
  // presentation shortcut; the resulting metadata never authenticates anyone.
  if (owner !== null) return {status: 'complete', reason: 'verified-account', persisted: false};
  if (hasLegacyLocalRecords(storage)) return {status: 'complete', reason: 'existing-install', persisted: false};
  if (typeof inventory?.databases === 'function') {
    let databases: readonly {name?: string}[];
    try { databases = await readDatabaseNames(inventory, options); }
    catch (error) { if (error instanceof FirstRunError) throw error; throw new FirstRunError(); }
    if (databases.some(database => typeof database.name === 'string' && EXISTING_DATABASES.has(database.name))) {
      return {status: 'complete', reason: 'existing-install', persisted: false};
    }
  }
  // Older ArkWeb implementations may lack databases(). A non-destructive
  // welcome is allowed then; continuing still uses the existing guest scope.
  return {status: 'welcome'};
}
