/* Synthetic workflow I/O around the actual product components. No user data. */
import React, {useEffect, useRef, useState} from '__QA_REACT__';
import {createRoot} from '__QA_REACT_DOM__';
import {VocabularyStudyCard} from '@/app/learn/vocabulary-plan';
import referenceData from '@/content/word-card-reference.json';
import {WorkspaceShell} from '@/app/learn/workspace-shell';
import {applyDocumentTheme} from '@/lib/ui-theme';
import '@/app/globals.css';
import '@/app/redesign.css';
import '@/app/v041-design-theme.css';
import '@/app/learn/v041-vocabulary.css';
import '@/app/learn/audio-redesign.css';
import '@/app/v041-app-redesign.css';
import '@/app/learn/legal-pages.css';

const requestedTheme = new URLSearchParams(location.search).get('theme');
const theme = ['paper', 'crystal', 'hollow', 'silk'].includes(requestedTheme) ? requestedTheme : 'paper';
const fontPercent = new URLSearchParams(location.search).get('font') === '200' ? 200 : 100;
document.documentElement.style.fontSize = `${fontPercent}%`;
const terms = ['quiet', 'internationalization', 'a', 'acknowledgement', 'conference',
  'counterproductive', 'schedule', 'interdepartmental', 'responsibility', 'available'];
const WORDS = terms.map((word, index) => ({
  id: `qa-v045-word-${index}`, word, pos: index % 2 ? 'n.' : 'adj.',
  phonetics: index === 2 ? [] : index % 3 ? [`/${word}/`] : [`/${word}/`, `/${word} alternative/`],
  etymology: index === 2 ? undefined : `合成构词参考_${index}。${index === 1 ? '这段合成构词参考仅验证换行、完整阅读和滚动，不属于真实词源资料。'.repeat(12) : '此处是用于布局验证的合成构词参考。'}`,
  meaning: `未揭义答案_${index}。${index % 3 === 1 ? '这是一段用于验证完整阅读的长释义，包含多个意思、搭配使用条件和相近语境。'.repeat(28) : '用于验证短释义不会使操作位置上移。'}`,
  collocation: index % 2 ? `${word} in a professional context; ${word} during a scheduled meeting` : '',
  example: index % 4 === 2 ? '' : index % 3 === 1
    ? `During the international conference, the representatives reviewed every important detail, checked the revised timetable, and prepared a clear summary for the entire interdepartmental team. `.repeat(5)
    : `Please confirm that the ${word} item is ready for the meeting.`,
  translation: `教学末尾_${index}。这段翻译必须能够完整读到，不能裁掉。`,
}));

function Fixture() {
  const [, rerender] = useState(0);
  const state = useRef({
    cursor: 0, status: 'active', pendingRating: null, pending: null,
    steps: WORDS.map((word, index) => ({id: `qa-v045-step-${index}`, word, intent: 'new', receipt: null})),
    attempts: [], saved: [], next: [], blockedAlternateCalls: 0,
  });
  const repaint = () => rerender(value => value + 1);
  useEffect(() => {applyDocumentTheme(theme);}, []);

  async function submitRating(rating) {
    const s = state.current;
    const step = s.steps[s.cursor];
    if (step.receipt) return {status: 'replayed', receipt: step.receipt};
    if (s.pending || s.pendingRating && s.pendingRating !== rating) {
      s.blockedAlternateCalls++;
      return {status: 'blocked', reason: '合成保存仍在进行，原选择不能改变。'};
    }
    const cursor = s.cursor;
    s.attempts.push({cursor, rating});
    const outcome = await new Promise(resolve => {s.pending = {cursor, rating, resolve}; repaint();});
    s.pending = null;
    if (outcome === 'failure') {
      s.pendingRating = rating;
      repaint();
      return {status: 'blocked', reason: '合成保存失败：未确认结果，请重试原反馈。'};
    }
    s.pendingRating = null;
    step.receipt = {rawRating: rating, commandId: `qa-receipt-${cursor}`, legacyEventId: `qa-event-${cursor}`, legacyPayloadHash: 'synthetic-layout-only', occurredAt: '2026-10-24T04:00:00.000Z', intent: 'new', ratingPolicy: 'three-label-conservative-v1'};
    s.saved.push({cursor, rating});
    repaint();
    return {status: 'applied', receipt: step.receipt};
  }

  async function nextStep() {
    const s = state.current;
    if (!s.steps[s.cursor].receipt || s.pending) return {status: 'blocked', reason: '原反馈尚未保存。'};
    s.next.push(s.cursor);
    if (s.cursor === s.steps.length - 1) s.status = 'completed';
    else s.cursor++;
    repaint();
    return {status: 'applied'};
  }

  const s = state.current;
  const workflow = {
    scopeKey: 'synthetic-v045-word-layout-only', ready: true, error: null,
    pendingRating: s.pendingRating, submitRating, nextStep,
    refresh: async () => ({status: 'applied'}),
    activeSession: {id: 'qa-v045-session', status: s.status, cursor: s.cursor, queue: s.steps,
      currentStep: s.steps[s.cursor], dayWindow: {localDate: '2026-10-24', timezone: 'Asia/Shanghai'}},
  };
  useEffect(() => {
    window.__wordCardQA = {
      read() {
        const value = state.current;
        return {cursor: value.cursor, status: value.status, pending: !!value.pending,
          pendingRating: value.pendingRating, attempts: value.attempts, saved: value.saved,
          next: value.next, blockedAlternateCalls: value.blockedAlternateCalls,
          words: WORDS.map((word, index) => ({word: word.word, answerMarker: `未揭义答案_${index}`,
            finalMarker: `教学末尾_${index}`, long: index % 3 === 1,
            phonetics: word.phonetics.length ? word.phonetics : referenceData.entries[word.word]?.phonetics || [],
            etymology: word.etymology || referenceData.entries[word.word]?.etymology || ''}))};
      },
      settle(outcome = 'success') {
        if (!state.current.pending) throw new Error('No pending synthetic save to settle');
        if (!['success', 'failure'].includes(outcome)) throw new Error('Invalid synthetic save outcome');
        state.current.pending.resolve(outcome);
      },
    };
    return () => {delete window.__wordCardQA;};
  }, []);

  return <WorkspaceShell nav="vocabulary" theme={theme} name="合成布局验证" scope="隔离测试"
    syncLabel="本机" reviewCount={0} onNavigate={() => {}} onSearch={() => {}} onSync={() => {}}>
    <section className="phase2-vocabulary-plan v041-vocabulary">
      <VocabularyStudyCard workflow={workflow} theme={theme} onExampleLookup={() => {}}/>
    </section>
  </WorkspaceShell>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
