/** Additive local feedback contract. Never write this into Recording/StudyData. */
export const SPEAKING_FEEDBACK_VERSION = 1 as const;
export const FEEDBACK_ALGORITHM = 'transcript-practice-v1' as const;

export type FeedbackBinding = {
  /** Existing owner namespace; guest must have a stable local namespace, never a shared null key. */
  ownerKey: string;
  /** Increment on account change, logout or recording replacement. */
  ownerGeneration: number;
  recordingId: string;
  promptId: string;
  audioSha256: string;
  modelVersion: string;
};
export type FeedbackRequest = FeedbackBinding & {
  version: typeof SPEAKING_FEEDBACK_VERSION;
  requestId: string;
  processingPolicy: 'device-local-only';
  task: 'read-aloud' | 'free-response';
  /** Only actual read-aloud passage; sample answers are not a free-response target. */
  referenceText?: string;
  /** Existing capture integrity warning; ASR confidence cannot clear it. */
  audioReviewRequired?: boolean;
};
export type TranscriptSegment = {
  startSeconds: number;
  endSeconds: number;
  text: string;
  /** Provider confidence is a heuristic, not calibrated pronunciation accuracy. */
  confidence?: number;
};
export type LocalAsrResult = FeedbackBinding & {
  version: typeof SPEAKING_FEEDBACK_VERSION;
  requestId: string;
  processingPolicy: 'device-local-only';
  status: 'ok' | 'failed' | 'unsupported' | 'cancelled';
  transcript: string;
  segments: TranscriptSegment[];
  /** Null/absent means unknown; do not invent a value for providers without it. */
  confidence?: number | null;
  errorCode?: 'MODEL_UNAVAILABLE' | 'AUDIO_UNREADABLE' | 'INFERENCE_FAILED';
};
export type TranscriptEdit = {
  text: string;
  /** Caller supplies real event time. Original recording time is never used as edit time. */
  editedAt: string;
  source: 'user-correction';
};
export type FeedbackObservation = {
  kind: 'audio-needs-review' | 'transcript-empty' | 'transcript-uncertain' | 'read-aloud-difference' | 'read-aloud-match' | 'response-structure';
  observation: string;
  suggestedAction: string;
  /** Reference token position when a textual difference exists, not a phone alignment. */
  referenceTokenIndex?: number;
  referenceToken?: string;
  transcriptToken?: string;
};
export type SpeakingFeedback = {
  version: typeof SPEAKING_FEEDBACK_VERSION;
  algorithm: typeof FEEDBACK_ALGORITHM;
  binding: FeedbackBinding;
  requestId: string;
  status: 'ready' | 'needs-audio-review' | 'needs-transcript-review' | 'failed' | 'unsupported' | 'cancelled';
  originalTranscript: string;
  transcript: string;
  edit?: TranscriptEdit;
  observations: FeedbackObservation[];
  nextStep: 'review-transcript' | 'listen-and-repractice' | 'retry-local-asr' | 'manual-review';
  limitations: string[];
  /** Literals intentionally prevent downstream presentation as official/numeric grading. */
  officialScore: null;
  pronunciationScore: null;
};

export class FeedbackContractError extends Error {
  readonly code: 'INVALID_REQUEST' | 'INVALID_RESULT' | 'BINDING_MISMATCH' | 'STALE_RESULT' | 'INVALID_EDIT';
  constructor(code: 'INVALID_REQUEST' | 'INVALID_RESULT' | 'BINDING_MISMATCH' | 'STALE_RESULT' | 'INVALID_EDIT') {
    super(code);
    this.code = code;
    this.name = 'FeedbackContractError';
  }
}

const MAX_TEXT = 20_000;
const MAX_SEGMENTS = 2_000;
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function boundedString(value: unknown, max = 500): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}
function validBinding(value: Record<string, unknown>) {
  return boundedString(value.ownerKey) && Number.isSafeInteger(value.ownerGeneration) && Number(value.ownerGeneration) >= 0
    && boundedString(value.recordingId) && boundedString(value.promptId)
    && typeof value.audioSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.audioSha256)
    && boundedString(value.modelVersion);
}
function validConfidence(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1);
}
export function assertFeedbackRequest(value: unknown): asserts value is FeedbackRequest {
  if (!isObject(value) || !validBinding(value) || value.version !== 1 || !boundedString(value.requestId)
    || value.processingPolicy !== 'device-local-only' || !['read-aloud', 'free-response'].includes(String(value.task))
    || (value.referenceText !== undefined && (typeof value.referenceText !== 'string' || value.referenceText.length > MAX_TEXT))
    || (value.audioReviewRequired !== undefined && typeof value.audioReviewRequired !== 'boolean')
    || (value.task === 'read-aloud' && !(typeof value.referenceText === 'string' && value.referenceText.trim()))
    || (value.task === 'free-response' && value.referenceText !== undefined)) {
    throw new FeedbackContractError('INVALID_REQUEST');
  }
}
export function assertLocalAsrResult(value: unknown): asserts value is LocalAsrResult {
  if (!isObject(value) || !validBinding(value) || value.version !== 1 || !boundedString(value.requestId)
    || value.processingPolicy !== 'device-local-only' || !['ok', 'failed', 'unsupported', 'cancelled'].includes(String(value.status))
    || typeof value.transcript !== 'string' || value.transcript.length > MAX_TEXT || !validConfidence(value.confidence)
    || !Array.isArray(value.segments) || value.segments.length > MAX_SEGMENTS) throw new FeedbackContractError('INVALID_RESULT');
  let lastStart = -1;
  for (const segment of value.segments) {
    if (!isObject(segment) || typeof segment.startSeconds !== 'number' || !Number.isFinite(segment.startSeconds) || segment.startSeconds < 0
      || typeof segment.endSeconds !== 'number' || !Number.isFinite(segment.endSeconds) || segment.endSeconds < segment.startSeconds
      || segment.startSeconds < lastStart || typeof segment.text !== 'string' || segment.text.length > MAX_TEXT
      || !validConfidence(segment.confidence)) throw new FeedbackContractError('INVALID_RESULT');
    lastStart = segment.startSeconds;
  }
}
export function assertTranscriptEdit(value: unknown): asserts value is TranscriptEdit {
  if (!isObject(value) || value.source !== 'user-correction' || typeof value.text !== 'string' || value.text.length > MAX_TEXT
    || typeof value.editedAt !== 'string' || !Number.isFinite(Date.parse(value.editedAt))
    || new Date(value.editedAt).toISOString() !== value.editedAt) {
    throw new FeedbackContractError('INVALID_EDIT');
  }
}
export function sameFeedbackBinding(a: FeedbackBinding, b: FeedbackBinding): boolean {
  return a.ownerKey === b.ownerKey && a.ownerGeneration === b.ownerGeneration && a.recordingId === b.recordingId
    && a.promptId === b.promptId && a.audioSha256 === b.audioSha256 && a.modelVersion === b.modelVersion;
}
export function feedbackBinding(request: FeedbackRequest): FeedbackBinding {
  const {ownerKey, ownerGeneration, recordingId, promptId, audioSha256, modelVersion} = request;
  return {ownerKey, ownerGeneration, recordingId, promptId, audioSha256, modelVersion};
}
/** JSON tuple avoids delimiter ambiguity between owner IDs and recording IDs. */
export function feedbackStorageKey(binding: FeedbackBinding): string {
  if (!validBinding(binding)) throw new FeedbackContractError('INVALID_REQUEST');
  return 'lantern-speaking-feedback:v1:' + JSON.stringify([
    binding.ownerKey, binding.recordingId, binding.promptId, binding.audioSha256, binding.modelVersion, FEEDBACK_ALGORITHM,
  ]);
}
