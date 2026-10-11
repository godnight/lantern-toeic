import {EXAM_LIMITS, parseExamPackage, type ExamFormat} from '@/lib/exam-model';

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
export async function prepareLibraryFile(file: File): Promise<LibraryManifest> {
  if (file.size > EXAM_LIMITS.importBytes) throw new Error('每份题包不能超过 96 MiB');
  // Validate locally before uploading; no attempt or learning history is included.
  const exam = parseExamPackage(await file.text());
  const sha256 = await sha256Bytes(await file.arrayBuffer());
  return readLibraryManifest({examId:exam.id, version:exam.version, title:exam.title, ...(exam.format ? {format:exam.format} : {}), bytes:file.size, sha256});
}
export async function checkedLibraryDownload(response: Response, item: LibraryItem): Promise<string> {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/json')) throw new Error('下载未完成，请重新登录并重试');
  const declared = response.headers.get('content-length');
  if ((declared !== null && !response.headers.get('content-encoding') && Number(declared) !== item.bytes) || item.bytes > EXAM_LIMITS.importBytes) throw new Error('下载长度不匹配');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > item.bytes) throw new Error('下载超过题包声明大小');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  if (size !== item.bytes) throw new Error('题包下载不完整，请重试');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  chunks.length = 0;
  if (await sha256Bytes(bytes.buffer) !== item.sha256) throw new Error('题包校验失败，请重新下载');
  const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
  const exam = parseExamPackage(text);
  if (exam.id !== item.examId || exam.version !== item.version || exam.title !== item.title || exam.format !== item.format) throw new Error('题包与目录信息不一致');
  return text;
}
