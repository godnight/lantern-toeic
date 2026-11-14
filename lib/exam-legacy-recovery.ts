import type {NativeAccountController} from './native-account-controller';
import type {AccountAccess} from './session-proof';
import {PRODUCT_USER_ID} from './product-identity';
import type {ExamRepository, ExamSummary} from './exam-storage';

/** Explicit single-package action only. Never scan, claim, or migrate attempts. */
export async function copySelectedLegacyExam(options: {
  controller: NativeAccountController;
  access: AccountAccess;
  source: ExamRepository;
  target: ExamRepository;
  selection: {key: string; fingerprint: string; confirmed: true};
}): Promise<{status: 'imported' | 'unchanged'; summary: ExamSummary}> {
  const {controller, access, source, target, selection} = options;
  const user = access?.user, owner = access?.owner, epoch = access?.epoch, signal = access?.sessionSignal;
  if (!user || !owner || user.id !== owner || !PRODUCT_USER_ID.test(owner) || !Number.isSafeInteger(epoch) || !signal ||
      source.ownerId !== 'harmony-local-device' || target.ownerId !== `harmony-${owner}` ||
      selection?.confirmed !== true || typeof selection.key !== 'string' || !selection.key.trim() ||
      typeof selection.fingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(selection.fingerprint)) {
    throw new Error('账号、题包选择或确认无效');
  }
  // Reference equality prevents an old proof for the same owner/epoch being
  // substituted. The callback is used again inside the final IDB transaction.
  const accountIsCurrent = () => {
    const state = controller.getSnapshot();
    if (signal.aborted || state.status !== 'ready' || state.unavailable || state.access !== access ||
        state.access.epoch !== epoch || state.user?.id !== owner || state.access.user?.id !== owner ||
        state.access.owner !== owner || state.access.sessionSignal !== signal) return false;
    if (!access.assertAccess() || signal.aborted) return false;
    const after = controller.getSnapshot();
    return after === state && after.status === 'ready' && after.access === access && !signal.aborted;
  };
  if (!accountIsCurrent()) throw new Error('账号会话已失效，未复制题包');
  return source.copySelectedLegacyPackageTo(target, {
    key: selection.key, fingerprint: selection.fingerprint, confirmed: true,
    targetOwnerId: `harmony-${owner}`, accountIsCurrent,
  }, {signal});
}
