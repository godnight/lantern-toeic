// Bounded, process-local observations only. Never log URLs, recording IDs or content.
const recordingEvents = new Set([
  'reading', 'source-ready', 'url-attached', 'url-released', 'url-discarded',
  'loadstart', 'loadedmetadata', 'durationchange', 'canplay', 'play', 'playing', 'timeupdate', 'pause', 'ended',
  'error', 'waiting', 'stalled', 'timeout', 'retry', 'retired', 'global-stop', 'native-background',
]);
const recordingLogLimit = 128;
const recordingSourceLimit = 64;
const recordingSources = new Map<string, number>();
let recordingLogCount = 0;
let recordingLimitReported = false;

type SourceKind = 'blob' | 'local' | 'remote' | 'none';

function finiteRead(read: () => unknown): number | null {
  try {
    const value = read();
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function stateRead(read: () => unknown, maximum: number): number {
  const value = finiteRead(read);
  return value !== null && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : 0;
}

function booleanRead(read: () => unknown, fallback = false): boolean {
  try {
    const value = read();
    return typeof value === 'boolean' ? value : fallback;
  } catch {
    return fallback;
  }
}

function sourceKind(src: string): SourceKind {
  if (!src) return 'none';
  if (src.startsWith('blob:')) return 'blob';
  if (/^https:\/\/lantern\.local(?:[/?#]|$)/i.test(src) || /^file:/i.test(src)) return 'local';
  if (/^(?:https?:)?\/\//i.test(src)) return 'remote';
  // Relative packaged paths are local; unrecognized schemes are not classified.
  return /^[^:\s]+$/.test(src) ? 'local' : 'none';
}

function sourceNumber(src: string): number {
  if (!src || src.length > 4096) return 0;
  const existing = recordingSources.get(src);
  if (existing !== undefined) return existing;
  if (recordingSources.size >= recordingSourceLimit) return 0;
  const source = recordingSources.size + 1;
  recordingSources.set(src, source);
  return source;
}

/** Diagnostics must never control playback, read storage, or expose media identifiers. */
export function recordingMediaTrace(event: string, src: string, audio?: HTMLAudioElement | null, request = 0): void {
  try {
    if (!recordingEvents.has(event)) return;
    if (recordingLogCount >= recordingLogLimit) {
      if (!recordingLimitReported) {
        recordingLimitReported = true;
        console.info('Recording playback ' + JSON.stringify({
          source: 0, request: 0, event: 'budget', current: null, duration: null,
          ready: 0, network: 0, errorCode: null, paused: true, ended: false,
          seeking: false, sourceKind: 'none',
        }));
      }
      return;
    }
    recordingLogCount++;
    const safeSource = typeof src === 'string' ? src : '';
    const errorCode = finiteRead(() => audio?.error?.code);
    console.info('Recording playback ' + JSON.stringify({
      source: sourceNumber(safeSource),
      request: Number.isSafeInteger(request) && request >= 0 ? request : 0,
      event,
      current: finiteRead(() => audio?.currentTime),
      duration: finiteRead(() => audio?.duration),
      ready: stateRead(() => audio?.readyState, 4),
      network: stateRead(() => audio?.networkState, 3),
      errorCode: errorCode !== null && Number.isSafeInteger(errorCode) && errorCode > 0 ? errorCode : null,
      paused: booleanRead(() => audio?.paused, true),
      ended: booleanRead(() => audio?.ended),
      seeking: booleanRead(() => audio?.seeking),
      sourceKind: sourceKind(safeSource),
    }));
  } catch {
    // Native getters, JSON and the log sink may throw; observations cannot affect media.
  }
}
