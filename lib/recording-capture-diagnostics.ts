// Bounded, process-local counters only. Never inspect audio bytes or log identifiers.
const captureEvents = new Set([
  'permission-request', 'stream-acquired', 'recorder-created', 'start', 'chunk',
  'stop-request', 'track-release', 'stopped', 'save-start', 'save-ok', 'save-error',
  'permission-error', 'start-error', 'recorder-error',
]);
const captureAttemptLimit = 64;
const captureLogLimit = 128;
let captureAttempts = 0;
let captureLogCount = 0;
let captureLimitReported = false;

type CaptureFields = {
  chunkCount: number;
  zeroChunks: number;
  totalBytes: number;
  lastChunkBytes: number;
  elapsedMs: number;
  mime: string;
  activeTracks: number;
};

function captureInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function captureElapsed(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function captureMimeKind(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return 'unknown';
  if (value.length > 128) return 'other';
  const normalized = value.toLowerCase().trim();
  if (normalized === '') return 'unknown';
  const parts = normalized.split(';').map(part => part.trim());
  if (parts[0] === 'audio/mp4') return 'mp4';
  if (parts[0] !== 'audio/webm') return 'other';
  return parts.slice(1).some(part => /^codecs\s*=\s*(?:opus|"opus")$/.test(part)) ? 'webm-opus' : 'webm';
}

/** Diagnostics never control capture, inspect storage, or expose media content. */
export function createRecordingCaptureTrace(): (event: string, fields: CaptureFields) => void {
  const attempt = captureAttempts < captureAttemptLimit ? ++captureAttempts : 0;
  return (event, fields) => {
    try {
      if (!captureEvents.has(event)) return;
      if (captureLogCount >= captureLogLimit) {
        if (!captureLimitReported) {
          captureLimitReported = true;
          console.info('Recording capture ' + JSON.stringify({
            attempt: 0, event: 'budget', chunkCount: 0, zeroChunks: 0, totalBytes: 0,
            lastChunkBytes: 0, elapsedMs: 0, mimeKind: 'unknown', activeTracks: 0,
          }));
        }
        return;
      }
      captureLogCount++;
      console.info('Recording capture ' + JSON.stringify({
        attempt,
        event,
        chunkCount: captureInteger(fields.chunkCount),
        zeroChunks: captureInteger(fields.zeroChunks),
        totalBytes: captureInteger(fields.totalBytes),
        lastChunkBytes: captureInteger(fields.lastChunkBytes),
        elapsedMs: captureElapsed(fields.elapsedMs),
        mimeKind: captureMimeKind(fields.mime),
        activeTracks: captureInteger(fields.activeTracks),
      }));
    } catch {
      // Getters, serialization and console sinks may throw; capture must continue unchanged.
    }
  };
}
