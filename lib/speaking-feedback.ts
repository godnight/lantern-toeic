import {
  FEEDBACK_ALGORITHM, FeedbackContractError, assertFeedbackRequest, assertLocalAsrResult,
  assertTranscriptEdit, feedbackBinding, sameFeedbackBinding,
  type FeedbackBinding, type FeedbackObservation, type FeedbackRequest, type LocalAsrResult,
  type SpeakingFeedback, type TranscriptEdit,
} from './speaking-feedback-contract';

/** Engineering default only; not a calibrated accuracy or pronunciation threshold. */
export const DEFAULT_REVIEW_CONFIDENCE = 0.7;
const LIMITATIONS = [
  '这是本地转写和文字练习线索，不是托业官方评分。',
  '文字差异可能来自识别错误；回听并核对转写后再决定练哪里。',
  '此反馈不测量音素准确度、重音、语调或口音。',
];
export function transcriptTokens(text: string): string[] {
  return text.toLowerCase().replaceAll('’', "'").match(/[a-z0-9]+(?:'[a-z]+)?/g) || [];
}

/** First local difference after the common prefix; linear space/time and intentionally no WER score. */
function firstDifference(reference: string[], transcript: string[]): FeedbackObservation | undefined {
  const length = Math.max(reference.length, transcript.length);
  for (let i = 0; i < length; i++) {
    if (reference[i] !== transcript[i]) {
      return {
        kind: 'read-aloud-difference', referenceTokenIndex: i,
        ...(reference[i] !== undefined ? {referenceToken: reference[i]} : {}),
        ...(transcript[i] !== undefined ? {transcriptToken: transcript[i]} : {}),
        observation: `从第 ${i + 1} 个词起，转写与原文出现差异；这不能直接证明读错。`,
        suggestedAction: `回听这一处，核对${reference[i] ? `原文“${reference[i]}”` : '结尾是否多识别了文字'}；确认后只重练附近一个短句。`,
      };
    }
  }
}

export function createSpeakingFeedback(
  request: FeedbackRequest,
  result: LocalAsrResult,
  options: {activeBinding: FeedbackBinding; activeRequestId: string | null; edit?: TranscriptEdit; minimumConfidence?: number},
): SpeakingFeedback {
  assertFeedbackRequest(request);
  assertLocalAsrResult(result);
  if (!sameFeedbackBinding(request, result) || request.requestId !== result.requestId) throw new FeedbackContractError('BINDING_MISMATCH');
  if (!sameFeedbackBinding(request, options.activeBinding) || options.activeRequestId !== request.requestId) throw new FeedbackContractError('STALE_RESULT');
  const minimum = options.minimumConfidence ?? DEFAULT_REVIEW_CONFIDENCE;
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 1) throw new FeedbackContractError('INVALID_REQUEST');
  if (options.edit) assertTranscriptEdit(options.edit);
  const transcript = options.edit ? options.edit.text : result.transcript;
  const base: SpeakingFeedback = {
    version: 1, algorithm: FEEDBACK_ALGORITHM, binding: feedbackBinding(request), requestId: request.requestId,
    status: 'ready', originalTranscript: result.transcript, transcript,
    ...(options.edit ? {edit: {...options.edit}} : {}), observations: [], nextStep: 'listen-and-repractice',
    limitations: [...LIMITATIONS], officialScore: null, pronunciationScore: null,
  };
  // Failed recognition cannot be silently promoted by supplying a manual edit.
  if (result.status !== 'ok') {
    return {...base, status: result.status, nextStep: result.status === 'failed' ? 'retry-local-asr' : 'manual-review'};
  }
  if (request.audioReviewRequired) {
    return {...base, status: 'needs-audio-review', nextStep: 'manual-review', observations: [{
      kind: 'audio-needs-review', observation: '这段录音存在待核对的采集或音质提示；转写成功不能消除录音问题。',
      suggestedAction: '先回听并核对录音完整性或噪声；保留原件，不依据当前转写评价发音。',
    }]};
  }
  if (!transcriptTokens(transcript).length) {
    return {...base, status: 'needs-transcript-review', nextStep: 'review-transcript', observations: [{
      kind: 'transcript-empty', observation: '没有可核对的英文转写，尚不足以给出文字练习建议。',
      suggestedAction: '先回听确认是否录到声音，再重新本地识别或手动补正转写。',
    }]};
  }
  const segmentUncertain = result.segments.some(s => s.confidence !== undefined && s.confidence !== null && s.confidence < minimum);
  const unknownOrLow = result.confidence == null || result.confidence < minimum || segmentUncertain;
  // Explicit user correction permits textual practice, retaining the unmodified ASR transcript.
  if (!options.edit && unknownOrLow) {
    return {...base, status: 'needs-transcript-review', nextStep: 'review-transcript', observations: [{
      kind: 'transcript-uncertain', observation: '本次转写信心偏低或未知，请先核对文字。此门槛是工程默认值，未经统计标定。',
      suggestedAction: '对照回听编辑转写，再查看文字练习建议；不要依据当前文字判断发音好坏。',
    }]};
  }
  if (request.task === 'read-aloud') {
    const difference = firstDifference(transcriptTokens(request.referenceText!), transcriptTokens(transcript));
    base.observations = [difference || {
      kind: 'read-aloud-match', observation: '经大小写及标点归一后，转写文字与原文一致；这不代表发音已经通过。',
      suggestedAction: '回听一个长句，选一处停顿再练一次；保留两段录音供自己比较。',
    }];
  } else {
    base.observations = [{
      kind: 'response-structure', observation: '已保留可核对的回答文字；当前模块不自动判定观点、语法或是否答到题意。',
      suggestedAction: '对照题目选一个要表达的信息点，补一句具体理由，再录一次并回看两份转写。',
    }];
  }
  return base;
}

/** Account/recording changes invalidate late responses before they reach persistence/UI. */
export function canPresentFeedback(feedback: SpeakingFeedback, active: FeedbackBinding): boolean {
  return feedback.version === 1 && feedback.algorithm === FEEDBACK_ALGORITHM && sameFeedbackBinding(feedback.binding, active);
}

/** Deliberate repractice relation; does not create attempts, minutes or alter either recording. */
export function linkSpeakingRepractice(previous: SpeakingFeedback, next: SpeakingFeedback) {
  if (previous.binding.ownerKey !== next.binding.ownerKey || previous.binding.ownerGeneration !== next.binding.ownerGeneration
    || previous.binding.promptId !== next.binding.promptId || previous.binding.recordingId === next.binding.recordingId) {
    throw new FeedbackContractError('BINDING_MISMATCH');
  }
  return {
    version: 1 as const, previous: {...previous.binding}, next: {...next.binding},
    comparison: 'transcript-only' as const,
    previousTranscript: previous.transcript, nextTranscript: next.transcript,
    automaticImprovementClaim: false as const,
  };
}
