import {EXAM_LIMITS, type ExamFormat} from '@/lib/exam-model';
import {withValidatedPackage, writeLegacyJson, type ExamInputFile} from './exam-stream-adapter';
import {BlobChunkWriter} from './exam-json-writer';

export const EXAM_LIBRARY_LIMITS = {packages: 32, bytes: 2 * 1024 * 1024 * 1024};
export const EXAM_LIBRARY_URL = 'https://lantern-toeic-godnight.zhuangzeliang.chatgpt.site/?examLibrary=1';
export type LibraryManifest = {examId: string; version: number; title: string; format?: ExamFormat; bytes: number; sha256: string};
export type LibraryItem = LibraryManifest & {id: string; createdAt: string; state: 'ready' | 'uploading' | 'deleting'};
export function readLibraryManifest(value: unknown): LibraryManifest {
  const m = value as LibraryManifest;
  if (!m || typeof m !== 'object' || Array.isArray(m) ||
    Object.keys(m).some(k => !['examId','version','title','format','bytes','sha256'].includes(k)) ||
    typeof m.examId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(m.examId) ||
    !Number.isSafeInteger(m.version) || m.version < 1 || m.version > 1000000 ||
    typeof m.title !== 'string' || !m.title.trim() || m.title.length > 200 || /[\x00-\x1f]/.test(m.title) ||
    (m.format !== undefined && m.format !== 'legacy-2006') ||
    !Number.isSafeInteger(m.bytes) || m.bytes < 1 || m.bytes > EXAM_LIMITS.importBytes ||
    typeof m.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(m.sha256)) throw new Error('题包信息无效或文件超过 96 MiB');
  return {examId:m.examId, version:m.version, title:m.title, ...(m.format ? {format:m.format} : {}), bytes:m.bytes, sha256:m.sha256};
}
export async function sha256Bytes(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export async function prepareLibraryFile(file: File, options: {signal?: AbortSignal; ownerId?: string; factory?: IDBFactory} = {}): Promise<LibraryManifest> {
  if (file.size > EXAM_LIMITS.importBytes) throw new Error('每份题包不能超过 96 MiB');
  return withValidatedPackage(file, async result => {
    const exam = result.manifest.packages[0].definition;
    // The cloud checksum is raw file bytes, never the normalized exam fingerprint.
    return readLibraryManifest({examId: exam.id, version: exam.version, title: exam.title, ...(exam.format ? {format: exam.format} : {}), bytes: result.inputBytes, sha256: result.rawSha256});
  }, options);
}

export type LibraryDownloadSource = {file: ExamInputFile; expected: LibraryManifest; signal?: AbortSignal};
/** Check the response envelope without buffering. The consumer must verify raw
 * checksum + schema + identity before its atomic activation (ExamRepository does).
 */
export function libraryDownloadSource(response: Response, item: LibraryItem, signal?: AbortSignal): LibraryDownloadSource {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('下载未完成，请重新登录并重试');
  const expected = readLibraryManifest({examId: item.examId, version: item.version, title: item.title, format: item.format, bytes: item.bytes, sha256: item.sha256}), declared = response.headers.get('content-length');
  if (declared !== null && !response.headers.get('content-encoding') && (!/^\d+$/.test(declared) || Number(declared) !== item.bytes)) throw new Error('下载长度不匹配');
  const body = response.body; let used = false;
  return {expected, signal, file: {size: expected.bytes, stream() {if (used) throw new Error('下载流已被读取，请重新下载'); used = true; return body;}}};
}

/** Explicit legacy text API only. Product download passes libraryDownloadSource
 * directly to importPackageFile so it never reconstructs complete base64 JSON.
 */
export async function checkedLibraryDownload(response: Response, item: LibraryItem, options: {signal?: AbortSignal; ownerId?: string; factory?: IDBFactory} = {}): Promise<string> {
  const source = libraryDownloadSource(response, item, options.signal);
  return withValidatedPackage(source.file, async (result, stage) => {
    const exam = result.manifest.packages[0].definition;
    if (result.rawSha256 !== source.expected.sha256 || exam.id !== item.examId || exam.version !== item.version || exam.title !== item.title || exam.format !== item.format) throw new Error('题包校验或目录身份不一致');
    const writer = new BlobChunkWriter({maxBytes: EXAM_LIMITS.importBytes, signal: options.signal});
    await writeLegacyJson(result.prepared, stage, writer); return await writer.toBlob().text();
  }, options);
}
