import {reviewSchedule, type Attempt, type Question} from './study-model';

export type PracticeSelectionIntent = 'continue' | 'custom' | 'wrong' | 'review';
export type PracticeUnit = {id: string; part: number; questions: Question[]};
export type PracticeSelection =
  | {kind: 'queue'; questions: Question[]; unitIds: string[]; isReview: boolean}
  | {kind: 'exhausted'; reason: 'no-unseen' | 'no-matching-content'};

/** Build complete units before applying any view filter. A conversation is indivisible. */
export function practiceUnits(questions: readonly Question[]): PracticeUnit[] {
  const units: PracticeUnit[] = [], byId = new Map<string, PracticeUnit>();
  for (const question of questions) {
    const id = question.groupId ? `group:${question.part}:${question.groupId}` : `question:${question.id}`;
    let unit = byId.get(id);
    if (!unit) {unit = {id, part: question.part, questions: []}; byId.set(id, unit); units.push(unit);}
    unit.questions.push(question);
  }
  return units;
}

export function selectPractice(
  questions: readonly Question[], attempts: readonly Attempt[],
  options: {intent: PracticeSelectionIntent; part?: number; targetCount: number; excludeUnitIds?: readonly string[]},
  now = Date.now(),
): PracticeSelection {
  if (!Number.isSafeInteger(options.targetCount) || options.targetCount < 1 || options.targetCount > 200) {
    throw new RangeError('每组目标题数须为1至200的整数');
  }
  const seen = new Set(attempts.map(attempt => attempt.qid));
  const scheduled = new Map(reviewSchedule([...attempts], now).map(item => [item.qid, item]));
  const excluded = new Set(options.excludeUnitIds || []);
  const candidates = practiceUnits(questions).filter(unit =>
    (!options.part || unit.part === options.part) && !excluded.has(unit.id));
  const unseen = (unit: PracticeUnit) => unit.questions.every(question => !seen.has(question.id));
  const wrong = (unit: PracticeUnit) => unit.questions.some(question => scheduled.get(question.id)?.wrong);
  const due = (unit: PracticeUnit) => unit.questions.some(question => scheduled.get(question.id)?.isDue);
  let pool = candidates;
  if (options.intent === 'continue') pool = candidates.filter(unseen);
  if (options.intent === 'wrong') pool = candidates.filter(wrong);
  if (options.intent === 'review') pool = candidates.filter(unit => wrong(unit) || due(unit));
  if (options.intent === 'custom') {
    // Stable sort preserves authored order within the same priority and within every unit.
    const rank = (unit: PracticeUnit) => unseen(unit) ? 0 : wrong(unit) || due(unit) ? 1 : 2;
    pool = [...pool].sort((a, b) => rank(a) - rank(b));
  }
  if (!pool.length) return {kind: 'exhausted', reason: options.intent === 'continue' ? 'no-unseen' : 'no-matching-content'};
  const chosen: PracticeUnit[] = [];
  let count = 0;
  for (const unit of pool) {chosen.push(unit); count += unit.questions.length; if (count >= options.targetCount) break;}
  return {
    kind: 'queue', questions: chosen.flatMap(unit => unit.questions), unitIds: chosen.map(unit => unit.id),
    isReview: chosen.some(unit => unit.questions.some(question => seen.has(question.id))),
  };
}
