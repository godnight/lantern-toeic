/** Bounded legacy JSON output only. This module contains no JSON parser.
 * Plain objects/arrays are snapshotted structurally; immutable string payloads
 * (including legacy base64) are shared, never cloned or stringified whole.
 */
export type ExamInputFile = {readonly size: number; stream(): ReadableStream<Uint8Array>};
export type JsonWriterOptions = {
  chunkBytes?: number; maxDepth?: number; maxNodes?: number; signal?: AbortSignal;
};
type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};
const DEFAULT_CHUNK_BYTES = 16 * 1024;
const encoder = new TextEncoder();

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(name + ' must be a positive safe integer');
  return value;
}
function abortReason(signal?: AbortSignal): unknown {
  if (signal?.reason !== undefined) return signal.reason;
  const error = new Error('JSON export cancelled'); error.name = 'AbortError'; return error;
}
export function checkJsonAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

/** JSON.stringify's ordinary-JSON behavior, excluding Date/class/toJSON hooks.
 * Capturing values once prevents size-count/stream races if a caller later
 * changes its legacy row. It does not duplicate the bytes of any string.
 */
function snapshotJson(input: unknown, options: JsonWriterOptions): JsonValue {
  const maxDepth = positiveInteger(options.maxDepth ?? 128, 'maxDepth');
  const maxNodes = positiveInteger(options.maxNodes ?? 2_000_000, 'maxNodes');
  const visiting = new Set<object>(); let nodes = 0;
  function visit(value: unknown, depth: number, arrayItem: boolean): JsonValue | undefined {
    checkJsonAbort(options.signal);
    if (++nodes > maxNodes || depth > maxDepth) throw new Error('JSON structure exceeds export safety bounds');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'bigint') throw new TypeError('BigInt cannot be serialized as JSON');
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return arrayItem ? null : undefined;
    if (typeof value !== 'object') throw new TypeError('Unsupported JSON value');
    if (visiting.has(value)) throw new TypeError('Circular JSON value');
    if (typeof (value as {toJSON?: unknown}).toJSON === 'function' || (!Array.isArray(value) && Object.prototype.toString.call(value) !== '[object Object]')) {
      throw new TypeError('Only ordinary JSON objects/arrays are supported');
    }
    visiting.add(value);
    try {
      if (Array.isArray(value)) {
        const result: JsonValue[] = [];
        for (let index = 0; index < value.length; index++) result.push(visit(value[index], depth + 1, true) ?? null);
        return result;
      }
      const result: {[key: string]: JsonValue} = Object.create(null);
      for (const key of Object.keys(value)) {
        const item = visit((value as Record<string, unknown>)[key], depth + 1, false);
        if (item !== undefined) Object.defineProperty(result, key, {value: item, enumerable: true});
      }
      return result;
    } finally {visiting.delete(value);}
  }
  const result = visit(input, 0, false);
  if (result === undefined) throw new TypeError('Root value has no JSON representation');
  return result;
}

function stringEnd(value: string, start: number, units: number): number {
  let end = Math.min(value.length, start + units);
  if (end < value.length) {
    const high = value.charCodeAt(end - 1), low = value.charCodeAt(end);
    if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) end--;
  }
  return end;
}
function* quoted(value: string): Generator<string> {
  yield '"';
  // At worst 6 escaped ASCII bytes per UTF-16 code unit; never pass an entire
  // base64 field, long key or explanation to JSON.stringify.
  for (let offset = 0; offset < value.length;) {
    const end = stringEnd(value, offset, 2048);
    yield JSON.stringify(value.slice(offset, end)).slice(1, -1);
    offset = end;
  }
  yield '"';
}
function* jsonTokens(value: JsonValue): Generator<string> {
  if (typeof value === 'string') {yield* quoted(value); return;}
  if (Array.isArray(value)) {
    yield '[';
    for (let index = 0; index < value.length; index++) {if (index) yield ','; yield* jsonTokens(value[index]);}
    yield ']'; return;
  }
  if (value !== null && typeof value === 'object') {
    yield '{'; let first = true;
    for (const key of Object.keys(value)) {
      if (!first) yield ','; first = false;
      yield* quoted(key); yield ':'; yield* jsonTokens(value[key]);
    }
    yield '}'; return;
  }
  yield JSON.stringify(value);
}
function* bytesFromTokens(tokens: Iterable<string>, chunkBytes: number, signal?: AbortSignal): Generator<Uint8Array> {
  let buffer = new Uint8Array(chunkBytes), used = 0;
  for (const token of tokens) {
    checkJsonAbort(signal);
    const encoded = encoder.encode(token);
    for (let offset = 0; offset < encoded.length;) {
      const count = Math.min(chunkBytes - used, encoded.length - offset);
      buffer.set(encoded.subarray(offset, offset + count), used); used += count; offset += count;
      if (used === chunkBytes) {yield buffer; buffer = new Uint8Array(chunkBytes); used = 0;}
    }
  }
  checkJsonAbort(signal);
  if (used) yield buffer.slice(0, used);
}
function* rawTextTokens(text: string): Generator<string> {
  for (let offset = 0; offset < text.length;) {
    const end = stringEnd(text, offset, 4096);
    yield text.slice(offset, end); offset = end;
  }
}
function chunkLimit(options: JsonWriterOptions): number {
  const bytes = positiveInteger(options.chunkBytes ?? DEFAULT_CHUNK_BYTES, 'chunkBytes');
  if (bytes > DEFAULT_CHUNK_BYTES) throw new Error('JSON output chunks cannot exceed 16 KiB');
  return bytes;
}
export function jsonChunks(value: unknown, options: JsonWriterOptions = {}): Iterable<Uint8Array> {
  const snapshot = snapshotJson(value, options), chunkBytes = chunkLimit(options);
  return {[Symbol.iterator]: () => bytesFromTokens(jsonTokens(snapshot), chunkBytes, options.signal)};
}

/** A string argument is already JSON text; other arguments are ordinary JSON
 * values. No parser is invoked. UTF-8 raw text follows TextEncoder semantics.
 */
export function jsonInputFile(input: unknown, options: JsonWriterOptions & {maxBytes?: number} = {}): ExamInputFile {
  const maxBytes = positiveInteger(options.maxBytes ?? 96 * 1024 ** 2, 'maxBytes');
  const chunkBytes = chunkLimit(options);
  const snapshot = typeof input === 'string' ? input : snapshotJson(input, options);
  const chunks = () => bytesFromTokens(typeof snapshot === 'string' && typeof input === 'string' ? rawTextTokens(snapshot) : jsonTokens(snapshot), chunkBytes, options.signal);
  let size = 0;
  for (const chunk of chunks()) {size += chunk.byteLength; if (size > maxBytes) throw new Error('JSON input exceeds byte limit');}
  if (!size) throw new Error('JSON input is empty');
  return {size, stream() {
    checkJsonAbort(options.signal);
    const iterator = chunks(); let finished = false;
    let remove = () => {};
    return new ReadableStream<Uint8Array>({
      start(controller) {
        const abort = () => {if (!finished) {finished = true; remove(); iterator.return(undefined); controller.error(abortReason(options.signal));}};
        remove = () => options.signal?.removeEventListener('abort', abort);
        options.signal?.addEventListener('abort', abort, {once: true});
      },
      pull(target) {
        if (finished) return;
        try {
          checkJsonAbort(options.signal);
          const next = iterator.next();
          if (next.done) {finished = true; remove(); target.close();} else target.enqueue(next.value);
        } catch (error) {finished = true; remove(); iterator.return(undefined); target.error(error);}
      },
      cancel() {finished = true; remove(); iterator.return(undefined);},
    }, {highWaterMark: 0});
  }};
}
/** Compatibility alias for integrators that call the source adapter jsonFile. */
export const jsonFile = jsonInputFile;

/** A native-Blob fallback, not a constant-memory/disk streaming writer.
 * JS-owned pending bytes stay at most batchBytes (default 1 MiB). Completed
 * native Blob parts still retain the complete output until download finishes.
 */
export class BlobChunkWriter {
  private parts: Blob[] = [];
  private pending: ArrayBuffer[] = [];
  private pendingBytes = 0;
  private acceptedBytes = 0;
  private peakPendingBytes = 0;
  private state: 'open' | 'closed' | 'aborted' = 'open';
  private failure: unknown;
  private result?: Blob;
  private readonly maxBytes: number;
  private readonly batchBytes: number;
  private readonly type: string;
  private readonly signal?: AbortSignal;
  private readonly onAbort: () => void;
  constructor(options: {maxBytes: number; batchBytes?: number; type?: string; signal?: AbortSignal}) {
    this.maxBytes = positiveInteger(options.maxBytes, 'maxBytes');
    this.batchBytes = positiveInteger(options.batchBytes ?? 1024 ** 2, 'batchBytes');
    if (this.batchBytes > 1024 ** 2) throw new Error('Blob writer JS batch cannot exceed 1 MiB');
    this.type = options.type ?? 'application/json'; this.signal = options.signal;
    this.onAbort = () => {this.abort(abortReason(this.signal));};
    this.signal?.addEventListener('abort', this.onAbort, {once: true});
    if (this.signal?.aborted) this.onAbort();
  }
  get bytes(): number {return this.acceptedBytes;}
  get maxBufferedBytes(): number {return this.peakPendingBytes;}
  get bufferedBytes(): number {return this.pendingBytes;}
  get blob(): Blob {
    if (this.state === 'aborted') throw this.failure ?? new Error('Blob writer aborted');
    if (this.state !== 'closed' || !this.result) throw new Error('Blob writer has not closed');
    return this.result;
  }
  toBlob(): Blob {return this.blob;}
  private assertOpen(): void {
    if (this.state === 'aborted') throw this.failure ?? new Error('Blob writer aborted');
    if (this.state !== 'open') throw new Error('Blob writer already closed');
    checkJsonAbort(this.signal);
  }
  private flush(): void {
    if (!this.pendingBytes) return;
    this.parts.push(new Blob(this.pending)); this.pending = []; this.pendingBytes = 0;
  }
  async write(chunk: Uint8Array): Promise<void> {
    this.assertOpen();
    try {
      if (!ArrayBuffer.isView(chunk) || chunk.BYTES_PER_ELEMENT !== 1) throw new TypeError('Blob writer requires a byte array');
      if (chunk.byteLength > this.maxBytes - this.acceptedBytes) throw new Error('JSON output exceeds byte limit');
      for (let offset = 0; offset < chunk.byteLength;) {
        this.assertOpen();
        const count = Math.min(this.batchBytes - this.pendingBytes, chunk.byteLength - offset);
        // Snapshot the producer's chunk before write resolves; callers may reuse it.
        const copy = new Uint8Array(count); copy.set(chunk.subarray(offset, offset + count));
        this.pending.push(copy.buffer); this.pendingBytes += count; this.acceptedBytes += count; offset += count;
        this.peakPendingBytes = Math.max(this.peakPendingBytes, this.pendingBytes);
        if (this.pendingBytes === this.batchBytes) this.flush();
      }
    } catch (error) {await this.abort(error); throw error;}
  }
  async close(): Promise<void> {
    if (this.state === 'closed') return;
    this.assertOpen();
    try {
      this.flush(); this.result = new Blob(this.parts, {type: this.type}); this.parts = []; this.state = 'closed';
      this.signal?.removeEventListener('abort', this.onAbort);
    } catch (error) {await this.abort(error); throw error;}
  }
  async abort(reason?: unknown): Promise<void> {
    if (this.state !== 'open') return;
    this.state = 'aborted'; this.failure = reason ?? new Error('Blob writer aborted');
    this.pending = []; this.parts = []; this.pendingBytes = 0; this.result = undefined;
    this.signal?.removeEventListener('abort', this.onAbort);
  }
}
