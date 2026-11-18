/** Read-only practice suggestions; never an ability diagnosis or a score. */
export type RecommendationAttempt = {
  id: string;
  qid: string;
  createdAt: string;
  correct: boolean;
  mode: 'first' | 'review';
};
export type RecommendationQuestion = { id: string; part: number };
export type RecommendationPolicy = {
  minimumFirstAnswers: number;
  minimumIncorrect: number;
  focusBelowAccuracy: number;
};
/** Conservative configurable engineering defaults, NOT statistically calibrated. */
export const DEFAULT_RECOMMENDATION_POLICY: Readonly<RecommendationPolicy> = Object.freeze({
  minimumFirstAnswers: 10,
  minimumIncorrect: 3,
  focusBelowAccuracy: 0.7,
});
export type PartEvidence = {
  part: number;
  availableQuestions: number;
  sampleCount: number;
  correctCount: number;
  incorrectCount: number;
  accuracy: number | null;
  status: 'unavailable' | 'insufficient-evidence' | 'practice-focus' | 'no-focus-signal';
};
export type GroupRecommendation = {
  part: number | null;
  reason: 'no-questions' | 'practice-focus' | 'unseen-part-exploration' | 'limited-sample-exploration' | 'daily-rotation';
  sampleCount: number;
  incorrectCount: number;
  accuracy: number | null;
  explanation: string;
};
export type RecommendationInput = {
  attempts: readonly RecommendationAttempt[];
  questions: readonly RecommendationQuestion[];
  timezone: string;
  today?: string;
  now?: Date | string | number;
  policy?: Partial<RecommendationPolicy>;
};

function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T12:00:00Z'))
    && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
}

function explicitInstant(value: string): number {
  // Local timestamp strings depend on the host timezone and cannot be evidence.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !validDay(match[1]) || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) return NaN;
  return Date.parse(value);
}

function dateKey(formatter: Intl.DateTimeFormat, value: Date | number): string {
  const fields = formatter.formatToParts(value);
  const field = (type: string) => fields.find(item => item.type === type)!.value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}

function resolvePolicy(overrides: Partial<RecommendationPolicy> = {}): RecommendationPolicy {
  const result = { ...DEFAULT_RECOMMENDATION_POLICY, ...overrides };
  if (!Number.isSafeInteger(result.minimumFirstAnswers) || result.minimumFirstAnswers < 2
    || !Number.isSafeInteger(result.minimumIncorrect) || result.minimumIncorrect < 2
    || !Number.isFinite(result.focusBelowAccuracy) || result.focusBelowAccuracy <= 0 || result.focusBelowAccuracy >= 1) {
    throw new RangeError('Invalid recommendation policy: counts must be integers >= 2 and accuracy must be between 0 and 1.');
  }
  return result;
}

export function recommendLearningParts(input: RecommendationInput) {
  const policy = resolvePolicy(input.policy);
  // Invalid zones throw rather than silently changing a learner's study day.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: input.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  if (typeof input.timezone !== 'string' || !input.timezone) throw new RangeError('An explicit study timezone is required.');
  const now = input.now ?? Date.now();
  const instant = typeof now === 'string' ? explicitInstant(now) : +new Date(now);
  const today = input.today ?? dateKey(formatter, instant);
  if (!validDay(today)) throw new RangeError('Invalid study day.');

  const questionParts = new Map<string, number>();
  for (const question of input.questions) {
    if (!question.id || !Number.isInteger(question.part) || question.part < 1 || question.part > 7) continue;
    const previous = questionParts.get(question.id);
    if (previous !== undefined && previous !== question.part) throw new RangeError('Conflicting question-to-Part mapping.');
    questionParts.set(question.id, question.part);
  }
  const earliest = new Map<string, { instant: number; correct: boolean; ambiguous: boolean }>();
  for (const attempt of input.attempts) {
    // Review-only records never manufacture baseline evidence or erase a first error.
    if (attempt.mode !== 'first' || !attempt.id || !questionParts.has(attempt.qid) || typeof attempt.correct !== 'boolean') continue;
    const instant = explicitInstant(attempt.createdAt);
    if (!Number.isFinite(instant) || dateKey(formatter, instant) >= today) continue;
    const previous = earliest.get(attempt.qid);
    if (!previous || instant < previous.instant) {
      earliest.set(attempt.qid, { instant, correct: attempt.correct, ambiguous: false });
    } else if (instant === previous.instant && previous.correct !== attempt.correct) {
      // Conflicting equally early facts are not a basis for asserting a weakness.
      previous.ambiguous = true;
    }
  }

  const parts: PartEvidence[] = Array.from({ length: 7 }, (_, index) => ({
    part: index + 1, availableQuestions: 0, sampleCount: 0, correctCount: 0,
    incorrectCount: 0, accuracy: null, status: 'unavailable',
  }));
  for (const part of questionParts.values()) parts[part - 1].availableQuestions++;
  let ambiguousQuestionCount = 0;
  for (const [qid, attempt] of earliest) {
    if (attempt.ambiguous) { ambiguousQuestionCount++; continue; }
    const evidence = parts[questionParts.get(qid)! - 1];
    evidence.sampleCount++;
    if (attempt.correct) evidence.correctCount++;
    else evidence.incorrectCount++;
  }
  for (const evidence of parts) {
    evidence.accuracy = evidence.sampleCount ? evidence.correctCount / evidence.sampleCount : null;
    evidence.status = !evidence.availableQuestions ? 'unavailable'
      : evidence.sampleCount < policy.minimumFirstAnswers ? 'insufficient-evidence'
      : evidence.incorrectCount >= policy.minimumIncorrect && evidence.accuracy! < policy.focusBelowAccuracy
        ? 'practice-focus' : 'no-focus-signal';
  }
  const focusOrder = (a: PartEvidence, b: PartEvidence) => a.accuracy! - b.accuracy!
    || b.sampleCount - a.sampleCount || a.part - b.part;
  const seed = Math.floor(Date.parse(today + 'T00:00:00Z') / 86400000);
  const choose = (listening: boolean): GroupRecommendation => {
    const group = parts.filter(item => item.availableQuestions > 0 && (listening ? item.part <= 4 : item.part > 4));
    if (!group.length) return { part: null, reason: 'no-questions', sampleCount: 0, incorrectCount: 0, accuracy: null, explanation: '当前没有该组可推荐题目，不生成练习任务。' };
    const focus = group.filter(item => item.status === 'practice-focus').sort(focusOrder)[0];
    const selected = focus ?? group.find(item => item.sampleCount === 0) ?? group[((seed % group.length) + group.length) % group.length];
    const reason = focus ? 'practice-focus' : selected.sampleCount === 0 ? 'unseen-part-exploration'
      : selected.status === 'insufficient-evidence' ? 'limited-sample-exploration' : 'daily-rotation';
    const explanation = focus
      ? `Part ${selected.part}：依据今日之前${selected.sampleCount}道首答（${selected.incorrectCount}道错误），建议加强练习；不是能力或弱项定论。`
      : selected.status === 'insufficient-evidence'
        ? `Part ${selected.part}：今日之前有${selected.sampleCount}道首答，少于参考门槛${policy.minimumFirstAnswers}道；证据不足，先探索练习，不判定弱项。`
        : `Part ${selected.part}：今日之前有${selected.sampleCount}道首答，未达到加强练习条件，按学习日轮换。`;
    return { part: selected.part, reason, sampleCount: selected.sampleCount, incorrectCount: selected.incorrectCount, accuracy: selected.accuracy, explanation };
  };
  const available = parts.filter(item => item.availableQuestions > 0);
  const enough = available.filter(item => item.status !== 'insufficient-evidence').length;
  return {
    today, timezone: input.timezone, policy,
    calibration: 'conservative-engineering-policy-not-statistically-calibrated' as const,
    basis: 'one-earliest-explicit-first-answer-per-question-before-study-day' as const,
    sampleCount: parts.reduce((sum, item) => sum + item.sampleCount, 0),
    ambiguousQuestionCount,
    evidenceStatus: !available.length ? 'no-questions' as const : !enough ? 'insufficient-evidence' as const
      : enough < available.length ? 'partial-evidence' as const : 'minimum-met' as const,
    focusPart: available.filter(item => item.status === 'practice-focus').sort(focusOrder)[0]?.part ?? null,
    listening: choose(true), reading: choose(false), parts,
  };
}
