import { utf8Length } from '../auth/AuthPolicy';

export const MEDIA_CONTROL_BYTES: number = 4096;
export const MEDIA_METADATA_BYTES: number = 1024;
export const MEDIA_CHUNK_BYTES: number = 65536;
export const MEDIA_FRAME_BYTES: number = 4 + MEDIA_METADATA_BYTES + MEDIA_CHUNK_BYTES;
export const MEDIA_MAX_BYTES: number = 12000000;
export const MEDIA_MAX_MS: number = 120000;
export const MEDIA_HANDLE_MS: number = 120000;
export const MEDIA_LIFETIME_MS: number = 600000;
export const MEDIA_MAX_CHUNKS: number = 200;
export interface MediaRequest {
  version: number;
  id: string;
  action: string;
  captureId?: string;
  generation?: number;
  maxDurationMs?: number;
  index?: number;
  blobSha256?: string;
  byteLength?: number;
}
export interface MediaSnapshot {
  captureId?: string;
  generation?: number;
  state: string;
  revision: number;
  nextChunkIndex?: number;
  totalChunks?: number;
  totalBytes?: number;
  sha256?: string;
  mime?: string;
  durationMs?: number;
  errorCode?: string;
}
export interface MediaReply extends MediaSnapshot {
  version: number;
  id: string;
  result?: string;
  index?: number;
}
export interface MediaScope { captureId: string; generation: number; }
export function mediaId(value: string): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
function validGeneration(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
export function parseMediaRequest(raw: string): MediaRequest | undefined {
  if (typeof raw !== 'string' || raw.length > MEDIA_CONTROL_BYTES || utf8Length(raw) > MEDIA_CONTROL_BYTES) return undefined;
  let input: MediaRequest;
  try { input = JSON.parse(raw) as MediaRequest; } catch { return undefined; }
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1 || !mediaId(input.id)) return undefined;
  if (!['start', 'stop', 'cancel', 'query', 'readChunk', 'ack'].includes(input.action)) return undefined;
  const keys: string[] = ['version', 'id', 'action'];
  if (input.action !== 'query' || input.captureId !== undefined || input.generation !== undefined) {
    if (!mediaId(input.captureId ?? '') || !validGeneration(input.generation)) return undefined;
    keys.push('captureId', 'generation');
  }
  if (input.action === 'start') {
    if (typeof input.maxDurationMs !== 'number' || !Number.isSafeInteger(input.maxDurationMs) ||
      input.maxDurationMs < 1 || input.maxDurationMs > MEDIA_MAX_MS) return undefined;
    keys.push('maxDurationMs');
  }
  if (input.action === 'readChunk') {
    if (typeof input.index !== 'number' || !Number.isInteger(input.index) || input.index < 0 || input.index >= MEDIA_MAX_CHUNKS) return undefined;
    keys.push('index');
  }
  if (input.action === 'ack') {
    if (typeof input.blobSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.blobSha256) ||
      typeof input.byteLength !== 'number' || !Number.isSafeInteger(input.byteLength) ||
      input.byteLength < 1 || input.byteLength > MEDIA_MAX_BYTES) return undefined;
    keys.push('blobSha256', 'byteLength');
  }
  return Object.keys(input).sort().join(',') === keys.sort().join(',') ? input : undefined;
}
export function parseMediaScope(raw: string): MediaScope | undefined {
  if (typeof raw !== 'string' || raw.length > 128 || utf8Length(raw) > 128) return undefined;
  let scope: MediaScope;
  try { scope = JSON.parse(raw) as MediaScope; } catch { return undefined; }
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) ||
    Object.keys(scope).sort().join(',') !== 'captureId,generation' ||
    !mediaId(scope.captureId) || !validGeneration(scope.generation)) return undefined;
  return scope;
}
