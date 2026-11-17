import type {FeedbackBinding, FeedbackRequest, LocalAsrResult} from './speaking-feedback-contract';
import {importOfflineSpeakingFeedback, type CurrentFeedbackSelection, type OfflineFeedbackRequest} from './browser-feedback-import';

export const LOCAL_ASR_BUNDLE_LIMITS = {request: 32768, result: 262144, evidence: 4194304, completion: 16384} as const;
export type LocalAsrBundle = Record<keyof typeof LOCAL_ASR_BUNDLE_LIMITS, Uint8Array>;
/** Use the independently browser-verified provider importer, including the actual current audio Blob. */
export async function verifyLocalAsrBundle(bundle: LocalAsrBundle, currentRequest: FeedbackRequest,
  activeBinding: FeedbackBinding, activeRequestId: string | null, audio: Blob,
  getCurrent?: () => CurrentFeedbackSelection): Promise<LocalAsrResult> {
  const files = {} as Record<keyof LocalAsrBundle, Blob>;
  for (const name of Object.keys(LOCAL_ASR_BUNDLE_LIMITS) as (keyof LocalAsrBundle)[]) {
    const bytes = bundle[name];
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > LOCAL_ASR_BUNDLE_LIMITS[name]) throw Error('IMPORT_SIZE');
    const copy = new Uint8Array(bytes.length); copy.set(bytes); files[name] = new Blob([copy.buffer]);
  }
  const imported = await importOfflineSpeakingFeedback(files, {getCurrent: getCurrent || (() => ({
    request: currentRequest as OfflineFeedbackRequest, activeBinding, activeRequestId, audio,
  }))});
  return imported.result;
}
