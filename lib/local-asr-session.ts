import {assertLocalAsrResult, FeedbackContractError, feedbackBinding,
  type FeedbackRequest, type LocalAsrResult, type SpeakingFeedback, type TranscriptEdit} from './speaking-feedback-contract';
import {createSpeakingFeedback, linkSpeakingRepractice} from './speaking-feedback';
import {verifyLocalAsrBundle, type LocalAsrBundle} from './verify-local-asr-bundle';
import type {OfflineFeedbackRequest} from './browser-feedback-import';

export const LOCAL_ASR_MAX_AUDIO_BYTES = 12_000_000;
export const LOCAL_ASR_MAX_RESULT_BYTES = 512 * 1024;
export type LocalAsrScope = {
  ownerKey: string;
  /** Owner lifecycle epoch; do not reuse another owner's in-flight session. */
  ownerGeneration: number;
  /** No phone-to-PC relay. This must be explicitly enabled for same-device offline jobs. */
  offlineJobSupported: boolean;
  modelVersion: string;
  /** Must come from the pinned provider capability, never a guessed file extension. */
  audioMimeTypes?: readonly string[];
};
export function localAsrAudioSupported(scope: LocalAsrScope, audio: Blob): boolean {
  return (scope.audioMimeTypes || ['audio/wav', 'audio/x-wav', 'audio/webm']).includes(audio.type.split(';')[0].trim().toLowerCase());
}
export type AsrRecordingInput = {recordingId: string; promptId: string; audio: Blob;
  task: 'read-aloud' | 'free-response'; referenceText?: string; audioReviewRequired: boolean};
export type LocalAsrSessionState = {
  phase: 'idle' | 'hashing' | 'waiting-result' | 'feedback' | 'cancelled' | 'unsupported' | 'error';
  request: FeedbackRequest | null;
  result: LocalAsrResult | null;
  feedback: SpeakingFeedback | null;
  error: string | null;
  comparison: ReturnType<typeof linkSpeakingRepractice> | null;
};
export type LocalAsrOfflineJob = {kind: 'lantern-local-asr-job'; version: 1; request: FeedbackRequest;
  audioByteLength: number; audioMimeType: string};

export function createLocalAsrSession(options: {
  scope: LocalAsrScope;
  createId: () => string;
  onChange: (state: LocalAsrSessionState) => void;
  digest?: (audio: Blob) => Promise<string>;
  now?: () => Date;
  previousFeedback?: SpeakingFeedback | null;
}) {
  const scope = {...options.scope};
  let generation = 0, disposed = false, activeRequestId: string | null = null;
  let audio: Blob | null = null;
  let state: LocalAsrSessionState = {phase: scope.offlineJobSupported ? 'idle' : 'unsupported',
    request: null, result: null, feedback: null, error: null, comparison: null};
  const snapshot = () => structuredClone(state);
  const publish = () => {if (!disposed) options.onChange(snapshot());};
  const digest = options.digest || (async (blob: Blob) => {
    if (!globalThis.crypto?.subtle) throw Error('SHA256_UNAVAILABLE');
    const hash = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  });
  const setFailure = (code: string) => {
    state = {...state, phase: 'error', error: code, feedback: null, comparison: null}; publish();
  };
  const evaluate = (edit?: TranscriptEdit) => {
    if (!state.request || !state.result || !activeRequestId) throw new FeedbackContractError('STALE_RESULT');
    const feedback = createSpeakingFeedback(state.request, state.result,
      {activeBinding: feedbackBinding(state.request), activeRequestId, edit});
    let comparison = null;
    if (options.previousFeedback && feedback.status === 'ready') {
      try {comparison = linkSpeakingRepractice(options.previousFeedback, feedback);} catch { /* Different scope/task is not a comparison. */ }
    }
    state = {...state, phase: 'feedback', feedback, comparison, error: null}; publish();
    return feedback;
  };
  return {
    snapshot,
    isDisposed: () => disposed,
    async createJob(input: AsrRecordingInput): Promise<LocalAsrOfflineJob | null> {
      if (disposed) return null;
      const epoch = ++generation;
      activeRequestId = null; audio = null;
      state = {phase: scope.offlineJobSupported ? 'hashing' : 'unsupported', request: null,
        result: null, feedback: null, error: null, comparison: null}; publish();
      if (!scope.offlineJobSupported) return null;
      if (!localAsrAudioSupported(scope, input.audio)) {
        state = {...state, phase: 'unsupported', error: 'AUDIO_FORMAT_UNSUPPORTED'}; publish(); return null;
      }
      if (!input.audio.size || input.audio.size > LOCAL_ASR_MAX_AUDIO_BYTES) {setFailure('AUDIO_SIZE_UNSUPPORTED'); return null;}
      try {
        const audioSha256 = await digest(input.audio);
        if (disposed || epoch !== generation) return null;
        const request: FeedbackRequest & {language: 'en'; audioByteLength: number} = {
          ownerKey: scope.ownerKey, ownerGeneration: scope.ownerGeneration, modelVersion: scope.modelVersion,
          version: 1, requestId: options.createId(),
          recordingId: input.recordingId, promptId: input.promptId, audioSha256,
          language: 'en', audioByteLength: input.audio.size,
          processingPolicy: 'device-local-only', task: input.task,
          ...(input.task === 'read-aloud' ? {referenceText: input.referenceText} : {}),
          audioReviewRequired: input.audioReviewRequired};
        // Validation is performed through the same PM feedback contract before export.
        const seed: LocalAsrResult = {...feedbackBinding(request), version: 1, requestId: request.requestId,
          processingPolicy: 'device-local-only', status: 'unsupported', transcript: '', segments: [], confidence: null};
        createSpeakingFeedback(request, seed, {activeBinding: feedbackBinding(request), activeRequestId: request.requestId});
        audio = input.audio; activeRequestId = request.requestId;
        state = {...state, phase: 'waiting-result', request}; publish();
        return {kind: 'lantern-local-asr-job', version: 1, request: structuredClone(request),
          audioByteLength: audio.size, audioMimeType: audio.type};
      } catch (error) {
        if (disposed || epoch !== generation) return null;
        setFailure(error instanceof FeedbackContractError ? error.code : 'AUDIO_HASH_FAILED');
        return null;
      }
    },
    /** A newly selected file must match the original selected recording's actual bytes. */
    async verifySelectedAudio(selected: Blob): Promise<boolean> {
      const request = state.request, epoch = generation;
      if (!request || !activeRequestId || selected.size > LOCAL_ASR_MAX_AUDIO_BYTES) return false;
      try {
        const hash = await digest(selected);
        return !disposed && epoch === generation && activeRequestId === request.requestId && hash === request.audioSha256;
      } catch {return false;}
    },
    selectedAudio(): Blob | null {return audio;},
    /** Trusted in-device provider adapter only. Files must use importBundle instead. */
    acceptProviderResult(value: unknown): SpeakingFeedback {
      if (disposed || !state.request || !activeRequestId) throw new FeedbackContractError('STALE_RESULT');
      assertLocalAsrResult(value);
      if (value.confidence !== null || value.segments.some(segment => segment.confidence !== undefined)) throw Error('IMPORT_CONFIDENCE');
      // evaluate validates requestId and every owner/audio/model binding before state changes.
      const checked = createSpeakingFeedback(state.request, value,
        {activeBinding: feedbackBinding(state.request), activeRequestId});
      state = {...state, result: structuredClone(value), feedback: checked, error: null};
      return evaluate();
    },
    async importBundle(bundle: LocalAsrBundle): Promise<SpeakingFeedback> {
      const request = state.request, requestId = activeRequestId, epoch = generation;
      if (disposed || !request || !requestId) throw new FeedbackContractError('STALE_RESULT');
      if (!audio) throw new FeedbackContractError('STALE_RESULT');
      const result = await verifyLocalAsrBundle(bundle, request, feedbackBinding(request), requestId, audio, () => {
        if (disposed || generation !== epoch || !state.request || !audio || activeRequestId !== requestId) throw new FeedbackContractError('STALE_RESULT');
        return {request: state.request as OfflineFeedbackRequest, activeBinding: feedbackBinding(state.request), activeRequestId, audio};
      });
      if (disposed || generation !== epoch || activeRequestId !== requestId) throw new FeedbackContractError('STALE_RESULT');
      return this.acceptProviderResult(result);
    },
    confirmTranscript(text: string): SpeakingFeedback {
      return evaluate({text, source: 'user-correction', editedAt: (options.now?.() || new Date()).toISOString()});
    },
    cancel() {
      generation++; activeRequestId = null; audio = null;
      state = {...state, phase: 'cancelled', request: null, result: null, feedback: null, comparison: null}; publish();
    },
    exportFeedback() {
      if (!state.feedback || !state.request || !state.result) return null;
      return {kind: 'lantern-speaking-feedback', version: 1, request: structuredClone(state.request),
        result: structuredClone(state.result), feedback: structuredClone(state.feedback), comparison: structuredClone(state.comparison)};
    },
    dispose() {disposed = true; generation++; activeRequestId = null; audio = null;},
  };
}
