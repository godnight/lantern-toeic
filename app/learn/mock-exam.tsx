'use client';
import {useLearningAccess} from '@/lib/learning-access';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, Check, CircleAlert, Headphones, Image as ImageIcon, Upload, Download, ArrowUpRight} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {isNativeForeground, registerNativeBack, subscribeNativeState} from '@/lib/native-host';
import {EXAM_LIMITS, READING_MS, advanceAttempt, examKey, getListeningDurationMs, getExamProfile, presentExam,
  type ExamAttempt, type ExamResult, type InterruptionReason} from '@/lib/exam-model';
import {openExamRepository, type ExamRepository, type ExamSummary, type SavedExamAttempt, type ExamView} from '@/lib/exam-storage';
import {ExamAssetLeases, releaseExamAssetLease, type ExamAssetLease, ExamUiSession, StaleExamOwner, attachExamMedia, audioOffsetSeconds, checkExamAudioDuration, clockText, remainingMs, trySaveExamExit, verifyExamImage} from '@/lib/exam-ui';
import ExamLibrary from './exam-library';

type Props = {ownerId: string | null; onClose: () => void; cloudEnabled?:boolean;managementOnly?:boolean};
type Catalog = {packages: ExamSummary[]; attempts: SavedExamAttempt[]};
type VisibleQuestion = ReturnType<typeof presentExam>['questions'][number];
type VisibleGroup = ReturnType<typeof presentExam>['groups'][number];
type PendingAnswer = {number: number; choice: number | null};
const partNames = ['照片描述', '应答问题', '简短对话', '简短独白', '短句填空', '长文填空', '阅读理解'];
const labels: Record<InterruptionReason, string> = {
  background: '进入后台或离开模考', 'audio-failure': '音频播放失败',
  'audio-interrupted': '音频播放中断', 'audio-seek': '音频按已用时间对齐',
};
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。';
const ignore = () => {};
const inactive = (a: ExamAttempt | null) => !a || a.status === 'submitted';

/** key remount prevents even one render of a previous owner's package/answers. */
export default function MockExam({ownerId, onClose,cloudEnabled=true,managementOnly=false}: Props) {
  if (!ownerId?.trim()) return <section className="mock-exam panel" role="alert">
    <h2>暂时无法确认本机记录范围</h2><p>请先恢复当前账号状态，再打开模考。</p>
    <button className="button secondary" onClick={onClose}>返回</button>
  </section>;
  return <MockExamOwner key={ownerId} ownerId={ownerId} onClose={onClose} cloudEnabled={cloudEnabled} managementOnly={managementOnly}/>;
}

async function readCatalog(repo: ExamRepository): Promise<Catalog> {
  // Listing must stay readable if quota prevents an expired attempt being written.
  // Continue/resume performs durable clock reconciliation before entering the exam.
  return {packages: await repo.listPackages(), attempts: await repo.listAttempts()};
}

export function MockExamOwner({ownerId, onClose,cloudEnabled=true,managementOnly=false}: {ownerId: string; onClose: () => void;cloudEnabled?:boolean;managementOnly?:boolean}) {
  const accountAccess=useLearningAccess();
  const [catalog, setCatalog] = useState<Catalog>({packages: [], attempts: []});
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [exitFailure, setExitFailure] = useState(false);
  const [exam, setExam] = useState<ExamView | null>(null);
  const [saved, setSaved] = useState<SavedExamAttempt | null>(null);
  const [now, setNow] = useState(Date.now()), [reviewNumber, setReviewNumber] = useState(1);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false), [confirmForceExit, setConfirmForceExit] = useState(false);
  const [libraryView, setLibraryView] = useState<'local' | 'cloud' | 'history'>('local');
  const [pendingAnswer, setPendingAnswer] = useState<PendingAnswer | null>(null);
  const pendingAnswerRef = useRef<PendingAnswer | null>(null);
  const [submitting, setSubmitting] = useState(false), [leaving, setLeaving] = useState(false);
  const [removeKey, setRemoveKey] = useState<string|null>(null);
  const [imagePreview, setImagePreview] = useState<{url: string; label: string} | null>(null);
  const [preflight, setPreflight] = useState(false), [heard, setHeard] = useState(false);
  const preflightRef = useRef({url: '', ready: false});
  const updatePreflight = useCallback((ready: boolean, url: string) => {
    // Media events invalidate this synchronously, before a Start click can use stale React state.
    preflightRef.current = {url, ready}; setPreflight(ready);
  }, []);
  const [assetSession, setAssetSession] = useState<{exam: ExamView; leases: ExamAssetLeases} | null>(null);
  const [audioSource, setAudioSource] = useState<{exam: ExamView | null; url: string}>({exam: null, url: ''});
  const [imageSources, setImageSources] = useState<{exam: ExamView | null; groupId: string; urls: Record<string, string>}>({exam: null, groupId: '', urls: {}});
  const [imageCheck, setImageCheck] = useState<{exam: ExamView | null; state: 'pending' | 'ready' | 'error'}>({exam: null, state: 'pending'});
  const [imageRetry, setImageRetry] = useState(0);
  const precheckController = useRef<AbortController | null>(null);
  const imagesReady = imageCheck.exam === exam && imageCheck.state === 'ready';
  const session = useRef<ExamUiSession | null>(null), current = useRef<SavedExamAttempt | null>(null);
  const pending = useRef(0), userLock = useRef(false);
  const errorRef = useRef(''), inputs = useRef<{packages: HTMLInputElement | null; backup: HTMLInputElement | null}>({packages: null, backup: null});
  const downloadUrls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const transferController = useRef<AbortController | null>(null);
  const [transfer, setTransfer] = useState<string | null>(null);
  async function withTransfer<T>(label: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController(); transferController.current = controller; setTransfer(label);
    try {return await work(controller.signal);}
    finally {if (transferController.current === controller) {transferController.current = null; if (session.current) setTransfer(null);}}
  }

  const displayed = saved ? advanceAttempt(saved.attempt, now) : null;
  // A computed timeout must wait for durable submission before revealing answers.
  const durableSubmitted = saved?.attempt.status === 'submitted' && !!saved.result;
  const presented = exam && saved ? presentExam(exam, durableSubmitted ? saved.attempt : displayed?.status === 'submitted' ? saved.attempt : displayed!) : null;
  const questionNumber = durableSubmitted ? reviewNumber : displayed?.activeQuestion;
  const question = presented?.questions.find(q => q.number === questionNumber);
  const group = question && presented?.groups.find(g => g.id === question.groupId);
  const active = catalog.attempts.find(row => row.attempt.status !== 'submitted');
  const answered = saved ? Object.keys(saved.attempt.answers).length : 0;
  const expiredSaving = displayed?.status === 'submitted' && !durableSubmitted;
  const audioActive = !!exam && (!displayed || displayed.status === 'listening');
  const urls: Record<string, string> = {
    ...(audioSource.exam === exam && exam && audioSource.url ? {[exam.listeningAudioId]: audioSource.url} : {}),
    ...(imageSources.exam === exam && imageSources.groupId === group?.id ? imageSources.urls : {}),
  };

  function fail(error: unknown) { const text = message(error); errorRef.current = text; setError(text); }
  function clearError() { errorRef.current = ''; setError(''); }
  function updatePendingAnswer(value: PendingAnswer | null) {
    // Own the draft synchronously as well as in the rendered UI, so a second
    // event before paint cannot silently navigate away or overwrite another question.
    pendingAnswerRef.current = value; setPendingAnswer(value);
  }
  function apply(row: SavedExamAttempt) {
    current.current = row; setSaved(row); setNow(Date.now());
    setCatalog(previous => ({...previous, attempts: [row, ...previous.attempts.filter(a => a.attempt.id !== row.attempt.id)]}));
    if (row.attempt.status === 'submitted') {setConfirmSubmit(false); updatePendingAnswer(null);}
  }
  async function perform<T>(work: (repo: ExamRepository) => Promise<T>, done: (value: T) => void, user = true): Promise<T> {
    const owner = session.current;
    if (!accountAccess() || !owner) throw new StaleExamOwner();
    if (user && userLock.current) throw new Error('正在保存，请稍候');
    if (user) { userLock.current = true; setBusy(true); clearError(); setNotice(''); }
    pending.current++;
    try {
      return await owner.run(async repo => {
        if (!accountAccess()) throw new StaleExamOwner();
        const value = await work(repo);
        if (!accountAccess()) throw new StaleExamOwner();
        owner.assertActive();
        if (session.current !== owner) throw new StaleExamOwner();
        // Update the ref before the next queued action reads its expected revision.
        done(value);
        setExitFailure(false);
        return value;
      });
    } catch (cause) {
      if (!(cause instanceof StaleExamOwner) && session.current === owner) fail(cause);
      throw cause;
    } finally {
      pending.current--;
      if (session.current === owner && user) { userLock.current = false; setBusy(false); }
    }
  }

  useEffect(() => {
    let cancelled = false;
    let opened: ExamUiSession | null = null;
    if (!accountAccess()) return;
    void openExamRepository(ownerId).then(repo => {
      if (cancelled) { repo.close(); return; }
      opened = new ExamUiSession(repo, ownerId); session.current = opened;
      return perform(readCatalog, value => {setCatalog(value); setReady(true);}, false);
    }).catch(cause => { if (!cancelled && !(cause instanceof StaleExamOwner)) fail(cause); });
    return () => {
      cancelled = true; transferController.current?.abort(new Error('模考页面已关闭，文件操作已取消')); opened?.close();
      if (session.current === opened) session.current = null;
      downloadUrls.current.forEach((timer, url) => {clearTimeout(timer); URL.revokeObjectURL(url);});
      downloadUrls.current.clear();
    };
  }, [ownerId]); // owner is immutable until the keyed component unmounts.

  useEffect(() => {
    setAudioSource({exam: null, url: ''}); setImageSources({exam: null, groupId: '', urls: {}});
    setImagePreview(null); updatePreflight(false, ''); setHeard(false);
    if (!exam) {setAssetSession(null); return;}
    const owner = session.current;
    const leases = new ExamAssetLeases(async id => {
      if (!accountAccess() || !owner) throw new StaleExamOwner(); owner.assertActive();
      const blob = await owner.repository.getAssetBlob(examKey(exam), id);
      if (!accountAccess()) throw new StaleExamOwner(); owner.assertActive(); return blob;
    });
    setAssetSession({exam, leases});
    return () => {precheckController.current?.abort(); leases.close();};
  }, [exam]);

  useEffect(() => {
    setAudioSource({exam: null, url: ''});
    if (!accountAccess() || !exam || assetSession?.exam !== exam || !audioActive) return;
    let cancelled = false, lease: ExamAssetLease | null = null;
    void assetSession.leases.acquire(exam.listeningAudioId).then(value => {
      if (cancelled || !accountAccess()) {value.release(); return;}
      lease = value; setAudioSource({exam, url: value.url});
    }).catch(cause => {if (!cancelled && !(cause instanceof StaleExamOwner)) fail(cause);});
    return () => {cancelled = true; if (lease) releaseExamAssetLease(lease);};
    // Question navigation must never release/recreate the current listening track.
  }, [exam, assetSession, audioActive]);

  useEffect(() => {
    setImageSources({exam: null, groupId: '', urls: {}}); setImagePreview(null);
    if (!accountAccess() || !exam || assetSession?.exam !== exam || !group) return;
    let cancelled = false;
    const acquired: ExamAssetLease[] = [], selected: Record<string, string> = {};
    void (async () => {
      for (const id of group.imageIds) {
        const lease = await (accountAccess() ? assetSession.leases.acquire(id) : Promise.reject(new StaleExamOwner()));
        if (cancelled || !accountAccess()) {lease.release(); return;}
        acquired.push(lease); selected[id] = lease.url;
      }
      if (!cancelled && accountAccess()) setImageSources({exam, groupId: group.id, urls: selected});
    })().catch(cause => {
      acquired.splice(0).forEach(lease => lease.release());
      if (!cancelled && !(cause instanceof StaleExamOwner)) {setImageCheck({exam, state: 'error'}); fail(cause);}
    });
    return () => {cancelled = true; acquired.splice(0).forEach(lease => lease.release());};
  }, [exam, assetSession, group?.id]);

  useEffect(() => {
    if (!accountAccess() || !exam || assetSession?.exam !== exam) return;
    const controller = new AbortController(); precheckController.current = controller;
    let cancelled = false;
    setImageCheck({exam, state: 'pending'});
    void (async () => {
      // Decode one image, detach its decoder and release its lease before the next.
      for (const asset of exam.assets.filter(value => value.mime.startsWith('image/'))) {
        const lease = await (accountAccess() ? assetSession.leases.acquire(asset.id) : Promise.reject(new StaleExamOwner()));
        try {
          if (cancelled || !accountAccess()) return;
          await verifyExamImage(lease.url, controller.signal);
        } finally {lease.release();}
      }
      if (!cancelled && accountAccess()) setImageCheck({exam, state: 'ready'});
    })().catch(cause => {
      if (!cancelled && !(cause instanceof StaleExamOwner)) {setImageCheck({exam, state: 'error'}); fail(cause);}
    });
    return () => {cancelled = true; controller.abort(); if (precheckController.current === controller) precheckController.current = null;};
  }, [exam, assetSession, imageRetry]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      if (!session.current || pending.current || errorRef.current || inactive(current.current?.attempt ?? null)) return;
      void perform(repo => repo.resumeAttempt(current.current!.attempt.id), apply, false).catch(ignore);
    }, 1000);
    return () => clearInterval(timer);
  }, []);



  async function interrupt(reason: InterruptionReason) {
    if (inactive(current.current?.attempt ?? null)) return;
    await perform(async repo => {
      const row = current.current!;
      return repo.markInterrupted(row.attempt.id, reason, Date.now(), row.attempt.revision);
    }, apply, false);
  }
  async function refresh() {
    if (!session.current) { fail(new Error('本机存储未打开，请返回后重试。')); return; }
    await perform(async repo => ({catalog: await readCatalog(repo), row: current.current ? await repo.resumeAttempt(current.current.attempt.id) : null}), value => {
      setCatalog(value.catalog); if (value.row) apply(value.row); setReady(true); setNotice('已重新读取本机记录。');
    });
  }
  async function leave() {
    if (userLock.current) { setNotice('正在保存，完成后可退出；计时仍在继续。'); return; }
    if (imagePreview) { setImagePreview(null); return; }
    if (confirmSubmit) { setConfirmSubmit(false); return; }
    setLeaving(true);
    try {if (!inactive(current.current?.attempt ?? null)) {
      const owner = session.current;
      const exitSaved = await trySaveExamExit(() => perform(async repo => {
        const row = current.current!;
        return repo.markInterrupted(row.attempt.id, 'background', Date.now(), row.attempt.revision);
      }, apply));
      if (!exitSaved) {
        if (session.current === owner) setExitFailure(true);
        return;
      }
    }
    onClose();
    } finally {if(session.current)setLeaving(false);}
  }
  function requestExit() {
    if (userLock.current) {setNotice('正在保存，完成后可退出；计时仍在继续。'); return;}
    if (imagePreview) {setImagePreview(null); return;}
    if (confirmSubmit) {setConfirmSubmit(false); return;}
    if (confirmForceExit) {setConfirmForceExit(false); return;}
    if (confirmExit) {setConfirmExit(false); return;}
    if (!inactive(current.current?.attempt ?? null)) {setConfirmForceExit(false); setConfirmExit(true); return;}
    void leave().catch(ignore);
  }
  useEffect(() => registerNativeBack(() => {requestExit(); return true;}, 90), [confirmSubmit, confirmExit, confirmForceExit, imagePreview, onClose]);

  async function openPackage(key: string, attemptId?: string) {
    await perform(async repo => {
      const value = await repo.getDefinition(key);
      let row = attemptId ? await repo.resumeAttempt(attemptId) : null;
      if (row && row.attempt.status !== 'submitted') row = await repo.markInterrupted(row.attempt.id, 'background', Date.now(), row.attempt.revision);
      if (row?.attempt.status === 'listening') row = await repo.markInterrupted(row.attempt.id, 'audio-interrupted', Date.now(), row.attempt.revision);
      return {value, row};
    }, ({value, row}) => {
      setExam(value); current.current = row; setSaved(row);
      updatePendingAnswer(null); setConfirmExit(false); setConfirmForceExit(false);
      if (row) apply(row); setReviewNumber(1); setNow(Date.now());
    });
  }
  async function start() {
    const matchesMedia = () => !!exam && preflightRef.current.ready && preflightRef.current.url === urls[exam.listeningAudioId];
    if (!accountAccess() || !exam || !preflight || !matchesMedia() || !heard || !imagesReady || document.hidden || !isNativeForeground()) return;
    await perform(repo => {
      // Recheck after the FIFO wait: durationchange/error may have invalidated this source.
      if (!matchesMedia() || document.hidden || !isNativeForeground()) throw new Error('音频预检状态已变化，请重新试听后开始。');
      return repo.startAttempt(examKey(exam));
    }, apply);
  }
  async function select(number: number, fromCard=false) {
    if (!durableSubmitted && pendingAnswerRef.current) {
      setNotice(`第 ${pendingAnswerRef.current.number} 题变更尚未保存；重试成功或明确取消后才能换题。`);
      return;
    }
    const owner=session.current,attemptId=current.current?.attempt.id;
    const focusQuestion=()=>{if(!fromCard||typeof requestAnimationFrame!=='function')return;requestAnimationFrame(()=>{if(!owner||session.current!==owner||!attemptId||current.current?.attempt.id!==attemptId)return;const target=document.querySelector<HTMLElement>(`.mock-paper-content[aria-label="第 ${number} 题"] .mock-question`);target?.scrollIntoView({block:'start',behavior:'auto'});target?.focus({preventScroll:true});});};
    if (durableSubmitted) { setReviewNumber(number); focusQuestion(); return; }
    await perform(repo => {
      const row = current.current!;
      return repo.select(row.attempt.id, number, Date.now(), row.attempt.revision);
    }, apply);
    focusQuestion();
  }
  async function answer(number: number, choice: number | null) {
    if (userLock.current) {setNotice('正在保存本题，完成后可继续选择；计时仍在继续。'); return;}
    if (pendingAnswerRef.current && pendingAnswerRef.current.number !== number) {
      setNotice(`第 ${pendingAnswerRef.current.number} 题变更尚未保存；重试成功或明确取消后才能换题。`);
      return;
    }
    updatePendingAnswer({number, choice});
    await perform(repo => {
      const row = current.current!;
      return repo.answer(row.attempt.id, number, choice, Date.now(), row.attempt.revision);
    }, row => {apply(row); updatePendingAnswer(null); setNotice(row.attempt.status === 'submitted' ? '时间已到，试卷已交卷；最后的点击未计入答案。' : `第 ${number} 题已保存在本机。`);});
  }
  async function submit() {
    setSubmitting(true);
    try {await perform(repo => {
      const row = current.current!;
      return repo.submit(row.attempt.id, Date.now(), row.attempt.revision);
    }, row => {apply(row); setReviewNumber(1); setNotice('试卷已交卷并保存在本机。');});
    } finally {if(session.current)setSubmitting(false);}
  }
  async function importFiles(files: File[]) {
    await perform(repo => withTransfer('导入题包', async signal => {
      const outcomes: string[] = []; let error = '';
      try {
        for (const file of files) {
          session.current?.assertActive();
          if (file.size > EXAM_LIMITS.importBytes) throw new Error(`${file.name} 超过 96 MiB 题包限额。`);
          const outcome = await repo.importPackageFile(file, Date.now(), {signal});
          outcomes.push(`${file.name}：${outcome.status === 'unchanged' ? '内容相同，未重复导入' : '已导入'}`);
        }
      } catch (cause) {error = message(cause);}
      return {catalog: await readCatalog(repo), outcomes, error};
    }), value => {
      setCatalog(value.catalog); setNotice(value.outcomes.join('；'));
      if (value.error) fail(new Error(value.error + ' 已完成的题包保留，当前未完成文件没有激活。'));
    });
    // Multiple files are sequential atomic-per-file; a backup restore is atomic as one unit.
  }
  async function restore(file: File) {
    await perform(repo => withTransfer('恢复完整备份', async signal => {
      if (file.size > EXAM_LIMITS.backupBytes) throw new Error('备份超过 224 MiB 限额。');
      const result = await repo.importBackupFile(file, Date.now(), {signal});
      return {result, catalog: await readCatalog(repo)};
    }), ({result, catalog}) => {setCatalog(catalog); setNotice(`备份已合并：新增 ${result.packagesAdded} 套题包、${result.attemptsAdded} 次记录；原记录保留。`);});
  }
  async function backup() {
    await perform(repo => withTransfer('导出完整备份', signal => repo.exportBackupBlob({signal})), blob => {
      const url = URL.createObjectURL(blob);
      const timer = setTimeout(() => {URL.revokeObjectURL(url); downloadUrls.current.delete(url);}, 60_000);
      downloadUrls.current.set(url, timer);
      const link = document.createElement('a'); link.href = url;
      // Harmony's download allowlist requires a fixed action name; native adds uniqueness.
      link.download = 'lantern-exam-backup.json';
      document.body.appendChild(link); link.click(); link.remove();
      setNotice('已发起备份下载，请在系统下载目录确认文件存在。备份包含题包、答案、音频及本机记录。');
    });
  }

  const phaseLabel = displayed?.status === 'listening' ? '听力 LC' : displayed?.status === 'reading' ? '阅读 RC' : '时间已到';
  const deadline = displayed?.status === 'listening' ? saved?.attempt.listeningDeadline : saved?.attempt.readingDeadline;
  const pendingIsNew = !!pendingAnswer && saved?.attempt.answers[pendingAnswer.number] === undefined;
  const savedChoice = pendingAnswer && saved?.attempt.answers[pendingAnswer.number]?.choice;
  const missingAnswers = 200 - answered;
  const localBytes = catalog.packages.reduce((sum, item) => sum + item.bytes, 0);

  if(managementOnly)return <section className="panel v041-mock-data" aria-busy={busy}><h2>模考备份</h2><p className="small muted">题包、媒体、答案与本机考试记录。</p>
    {error&&<div role="alert"><p>{error}</p><button className="text-button" disabled={busy} onClick={()=>void refresh().catch(ignore)}>重新读取</button></div>}
    {!ready&&!error&&<p role="status">正在读取模考记录…</p>}
    {(busy||notice)&&<p role="status">{busy?(transfer?transfer+'中…':'正在处理…'):notice}</p>}
    {transfer&&<button className="text-button" onClick={()=>transferController.current?.abort(new Error('操作已取消'))}>取消文件操作</button>}
    <div className="button-row"><button className="button secondary" disabled={!ready||busy||!catalog.packages.length} onClick={()=>void backup().catch(ignore)}>导出模考备份</button><button className="button secondary" disabled={!ready||busy} onClick={()=>inputs.current.backup?.click()}>恢复模考备份</button></div>
    <input hidden ref={node=>{inputs.current.backup=node;}} type="file" accept="application/json,.json" aria-label="选择模考备份" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void restore(file).catch(ignore);}}/>
  </section>;
  return <section className={saved && !durableSubmitted ? 'mock-exam is-running' : 'mock-exam'} aria-label="完整听读模考" aria-busy={busy}>
    <header className="mock-heading">
      <div><p className="eyebrow">{saved ? durableSubmitted ? '模考复盘' : '专注作答' : '听读模考'}</p><h2>{exam?.title || '题包与本机记录'}</h2>
        {exam && <p className="mock-identity">{getExamProfile(exam.format).label} · 版本 {exam.version} · {saved ? saved.attempt.ordinal === 1 ? '首次完整模考' : `复测第 ${saved.attempt.ordinal - 1} 次` : '开始后独立记录'}</p>}
      </div>
      <button className="button secondary mock-exit" disabled={busy} onClick={requestExit}><ArrowLeft size={18} aria-hidden/>{saved && !durableSubmitted ? '保存并退出' : '返回学习'}</button>
    </header>
    {!saved && <p className="mock-lead">完整题包按需导入。考试答案保存在这台设备，私人云库仅同步题包。</p>}
    {error && <div className="mock-alert" role="alert"><strong>这次操作尚未完成</strong><p>{error}</p><p>未完成不能视为已保存。原考试截止时间保持。</p>
      {pendingAnswer && <p>第 {pendingAnswer.number} 题{pendingAnswer.choice === null ? '清除操作' : `临时选项 ${String.fromCharCode(65 + pendingAnswer.choice)}`}尚未保存。{savedChoice !== null && savedChoice !== undefined ? `原已保存选项 ${String.fromCharCode(65 + savedChoice)} 保留。` : '本题尚未计入已保存题数。'}</p>}
      {pendingAnswer && <p>换题前，请先重试保存或明确取消这次未保存变更。</p>}
      <div className="mock-actions"><button className="button secondary" disabled={busy} onClick={() => void refresh().catch(ignore)}>重新读取记录</button>
        {pendingAnswer && <><button className="button primary" disabled={busy || !!expiredSaving} onClick={() => void answer(pendingAnswer.number, pendingAnswer.choice).catch(ignore)}>重试保存本题</button><button className="text-button" disabled={busy} onClick={() => updatePendingAnswer(null)}>取消未保存选择</button></>}
      </div>
    </div>}
    {pendingAnswer && !busy && !error && !durableSubmitted && <div className="mock-notice"><strong>第 {pendingAnswer.number} 题变更仍待保存</strong><p>原已保存答案保持；重试成功或明确取消后才能换题。</p><div className="mock-actions"><button className="button secondary" disabled={!!expiredSaving} onClick={()=>void answer(pendingAnswer.number,pendingAnswer.choice).catch(ignore)}>重试保存本题</button><button className="text-button" onClick={()=>updatePendingAnswer(null)}>取消未保存选择</button></div></div>}
    {exitFailure && !confirmExit && <div className="mock-alert" role="alert"><strong>退出中断标记尚未保存</strong><p>当前考试继续按原截止时间计时，原已保存答案保留。</p>
      <button className="button secondary" disabled={busy} onClick={() => {setConfirmForceExit(false);setConfirmExit(true);}}>处理退出保存失败</button></div>}
    {transfer && <div className="mock-notice" role="status"><span>{transfer}中。完成前可以取消；已经完成的其他文件保留。</span><button className="button secondary" onClick={() => transferController.current?.abort(new Error('操作已取消'))}>取消文件操作</button></div>}
    <p className="mock-status" role="status" aria-live="polite">{busy ? submitting ? '正在保存交卷…' : leaving ? '正在保存退出状态…' : '正在保存本机记录…' : notice}</p>
    {!ready ? <div className="panel mock-empty" role="status"><h3>正在打开本机记录</h3><p>请稍候。读取失败时保留原数据，并提供重试。</p></div> : !exam ? <>
      <nav className="mock-library-tabs" aria-label="模考资料范围">
        <button className={libraryView === 'local' ? 'selected' : ''} aria-pressed={libraryView === 'local'} onClick={() => setLibraryView('local')}>本机题包<span>{catalog.packages.length}</span></button>
        <button className={libraryView === 'cloud' ? 'selected' : ''} aria-pressed={libraryView === 'cloud'} disabled={!cloudEnabled} onClick={() => {if(cloudEnabled)setLibraryView('cloud');}}>私人云库</button>
        <button className={libraryView === 'history' ? 'selected' : ''} aria-pressed={libraryView === 'history'} onClick={() => setLibraryView('history')}>考试记录<span>{catalog.attempts.filter(row => row.attempt.status === 'submitted').length}</span></button>
      </nav>
      {!cloudEnabled&&<p className="mock-muted">此账号的模考保存在本机分区，原生云题包尚未启用。</p>}
      {cloudEnabled&&libraryView === 'cloud' ? <ExamLibrary ownerId={ownerId} disabled={busy} onImport={async source => {
        await perform(async repo => {const outcome=await repo.importPackageFile(source.file, Date.now(), {signal: source.signal, expected: source.expected});return {outcome,catalog:await readCatalog(repo)};}, value => {setCatalog(value.catalog);setNotice(value.outcome.status==='unchanged'?'本机已有相同题包。':'题包已下载到本机。');});
      }}/> : <>
        {libraryView === 'local' && <>
          <div className="mock-catalog-toolbar"><div><h3>已导入题包</h3><p className="mock-muted">{(localBytes / 1024 / 1024).toFixed(1)} / 192 MiB · 已有考试记录的题包会保留</p></div><button className="button primary" disabled={busy} onClick={() => inputs.current.packages?.click()}><Upload size={17} aria-hidden/>导入题包 JSON</button></div>
          {active && <article className="panel mock-resume"><div><span className="mock-badge">未交卷 · 原截止保持</span><h3>继续或结算上次模考</h3><p>{catalog.packages.find(p => p.id === active.attempt.examId && p.version === active.attempt.examVersion)?.title}</p><p className="mock-muted">离开期间继续计时。恢复时先校准阶段与音频，不重新开始。</p></div><button className="button primary" disabled={busy} onClick={() => void openPackage(examKey({id: active.attempt.examId, version: active.attempt.examVersion}), active.attempt.id).catch(ignore)}>继续考试</button></article>}
          {!catalog.packages.length ? <div className="panel mock-empty"><Headphones size={28} aria-hidden/><h3>还没有完整题包</h3><p>导入你有权个人使用的 200 题听读 JSON；正文或扫描图、选项、答案与完整听力音轨都须齐全。</p><p className="mock-muted">这里没有预装完整真题，不会把演示题拼成“真题卷”。</p></div> : <div className="mock-catalog">{catalog.packages.map(item => <article className="panel mock-package" key={item.key}>
            <div className="mock-package-heading"><span className="mock-badge">{getExamProfile(item.format).label}</span><span className="mock-muted">200 题 · v{item.version}</span></div><h3>{item.title}</h3><p className="mock-muted">听力 {clockText(getListeningDurationMs(item))} / 阅读 {clockText(READING_MS)}</p><p>{item.source.title}</p>
            {item.format && <p className="mock-muted">旧题型用于补充练习，Part 题量单独判分，不混为现行考前基线。</p>}
            <details><summary>来源与个人使用声明</summary><p>{item.source.publisher}</p><p>{item.source.reference}</p><p>{item.source.rightsStatement}</p><p>以上为导入者填写，程序未认证来源或授权。</p></details>
            <button className="button secondary" disabled={busy || !!active} onClick={() => void openPackage(item.key).catch(ignore)}>音频预检与新考试<ArrowUpRight size={16} aria-hidden/></button>
            {!catalog.attempts.some(row => row.attempt.examId===item.id && row.attempt.examVersion===item.version) && <div className="mock-remove-package">
              {removeKey === item.key ? <><p>确认移除“{item.title}”的本机副本？请先确认原 JSON 或私人云库仍有副本。</p><div className="mock-actions"><button className="button secondary" disabled={busy} onClick={() => void perform(async repo => {await repo.removeUnusedPackage(item.key);return readCatalog(repo);}, value => {setCatalog(value);setRemoveKey(null);setNotice('未作答题包已从本机移除，云端文件保留。');}).catch(ignore)}>确认移除本机副本</button><button className="text-button" onClick={() => setRemoveKey(null)}>取消</button></div></> : <button className="text-button" disabled={busy} onClick={() => setRemoveKey(item.key)}>移除未作答的本机副本</button>}
            </div>}
          </article>)}</div>}
        </>}
        {libraryView === 'history' && <section className="mock-history"><div className="mock-catalog-toolbar"><div><h3>已交卷记录</h3><p className="mock-muted">首次、复测分别保存；回看原题包与原答案。</p></div></div>{catalog.attempts.filter(row => row.attempt.status === 'submitted').length ? catalog.attempts.filter(row => row.attempt.status === 'submitted').map(row => <article className="panel mock-history-item" key={row.attempt.id}>
          <div><span className="mock-badge">{row.attempt.ordinal===1?'首次':`复测第 ${row.attempt.ordinal-1} 次`}</span><h4>{catalog.packages.find(p => p.id===row.attempt.examId && p.version===row.attempt.examVersion)?.title || '本机题包'}</h4><p className="mock-muted">{getExamProfile(row.attempt.format).label} · {new Date(row.attempt.startedAt).toLocaleString()}</p><p>正确 {row.result?.correct ?? '—'} / 200 · {row.result?.integrity==='interrupted'?'有中断或时钟异常标记':'未记录到中断（不等于监考认证）'}</p></div><button className="button secondary" disabled={busy} onClick={() => void openPackage(examKey({id:row.attempt.examId,version:row.attempt.examVersion}),row.attempt.id).catch(ignore)}>成绩与复盘</button>
        </article>) : <div className="panel mock-empty"><h3>还没有已交卷记录</h3><p>完成一次完整模考后，在这里回看原始题数与原题。</p></div>}</section>}

      </>}
      <input hidden ref={node => {inputs.current.packages=node;}} type="file" accept="application/json,.json" multiple aria-label="选择题包 JSON" onChange={event => {const files=Array.from(event.target.files||[]);event.target.value='';if(files.length)void importFiles(files).catch(ignore);}}/>
      <input hidden ref={node => {inputs.current.backup=node;}} type="file" accept="application/json,.json" aria-label="选择模考备份" onChange={event => {const file=event.target.files?.[0];event.target.value='';if(file)void restore(file).catch(ignore);}}/>
    </> : <>
      {(!saved || !imagesReady) && <div className="mock-media-status" role="status"><ImageIcon size={18} aria-hidden/><p>{imagesReady?'全部题图已通过本机解码预检。':imageCheck.exam===exam && imageCheck.state==='error'?'材料图片预检失败，不能开始新考试。':'正在逐张检查材料图片…'}</p>{!imagesReady && imageCheck.state==='error' && <button className="button secondary" disabled={busy} onClick={() => {clearError();setImageCheck({exam,state:'pending'});setImageRetry(n=>n+1);}}>重试图片预检</button>}</div>}
      <div className={!saved?'mock-preflight-layout':'mock-running-media'}>{!saved && <article className="panel mock-format"><h3>原题型与计时</h3><p>{getExamProfile(exam.format).label} · 原题包版本 {exam.version}</p><ul>{getExamProfile(exam.format).partCounts.map((count,index)=><li key={index}><span>Part {index+1} · {partNames[index]}</span><b>{count} 题</b></li>)}</ul><dl><div><dt>听力时限</dt><dd>{clockText(getListeningDurationMs(exam))}</dd></div><div><dt>阅读时限</dt><dd>{clockText(READING_MS)}</dd></div><div><dt>听力时长声明</dt><dd>{exam.listeningDurationMs===undefined?'未声明 · 沿用 45:00':clockText(exam.listeningDurationMs)}</dd></div></dl>{exam.format && <p className="mock-muted">2006 版旧题型单独判分，用于补充练习。</p>}</article>}
        {saved && !durableSubmitted && <div className="panel mock-clock"><div><b>{phaseLabel}</b><p>{displayed?.status==='listening'?'听力结束后自动进入阅读':'听力答案已锁定，不能返回修改'}</p></div><div className="mock-timer" role="timer" aria-label="当前阶段剩余时间"><strong>{clockText(displayed?remainingMs(displayed,now):0)}</strong><small>剩余时间</small></div><p className="mock-muted">已保存 {answered} / 200 题 · 原截止 {deadline?new Date(deadline).toLocaleTimeString(): '—'} · 离开仍继续计时</p></div>}
        <ExamAudio key={examKey(exam)} url={urls[exam.listeningAudioId]||''} declaredListeningDurationMs={exam.listeningDurationMs} effectiveListeningDurationMs={getListeningDurationMs(exam)} attempt={displayed} durableSubmitted={!!durableSubmitted} onPreflight={updatePreflight} onInterruption={interrupt} onRefresh={() => refresh()} busy={busy}/>
        {!saved && <article className="panel mock-preflight"><h3>开始前确认</h3><div className="mock-check-state"><span>全部题图</span><b>{imagesReady?<><Check size={16} aria-hidden/>解码通过</>:'等待预检'}</b></div><div className="mock-check-state"><span>音频解码、时长与实际播放</span><b>{preflight?<><Check size={16} aria-hidden/>预检通过</>:'请先试听'}</b></div><label className="mock-checkbox"><input type="checkbox" checked={heard} onChange={event=>setHeard(event.target.checked)}/><span>我已亲自试听，声音听得清，而且音轨包含本卷完整听力。</span></label><div className="mock-notice">点击开始后立即计时；退出、后台、重启不暂停。听力按本套 {clockText(getListeningDurationMs(exam))} 截止，再进入 75:00 阅读；进入阅读不能返回听力。</div><div className="mock-actions"><button className="button primary" disabled={busy || !preflight || preflightRef.current.url!==urls[exam.listeningAudioId] || !heard || !imagesReady} onClick={() => void start().catch(ignore)}>开始新考试 · 立即计时</button><button className="button secondary" disabled={busy} onClick={() => setExam(null)}>返回题包</button></div><p className="mock-muted">预检不计时。保存成功后才进入作答；首次与复测分别保留。</p></article>}
      </div>
      {saved && <>
        {durableSubmitted && <Results result={saved.result!} attempt={saved.attempt}/>}
        {/* The keyed audio remains mounted across preflight/start/phase transitions. */}
        {expiredSaving && <div className="mock-alert" role="alert"><strong>时间已到 · 作答已锁定</strong><p>正在保存自动交卷。保存成功后才显示成绩与正确答案。{error && '请点击“重新读取记录”重试。'}</p></div>}
        <div className="mock-workspace">
          <div className="mock-paper">{question && group && <ExamPaper question={question} group={group} urls={urls} selected={saved.attempt.answers[question.number]?.choice} pendingChoice={!durableSubmitted && pendingAnswer?.number===question.number?pendingAnswer.choice:undefined} submitted={!!durableSubmitted} disabled={busy || !!expiredSaving} navigationDisabled={!!pendingAnswer && !durableSubmitted} previousAvailable={!!presented?.questions.some(q=>q.number===question.number-1)} nextAvailable={!!presented?.questions.some(q=>q.number===question.number+1)} onAnswer={choice=>void answer(question.number,choice).catch(ignore)} onSelect={number=>void select(number).catch(ignore)} onImage={(url,label)=>setImagePreview({url,label})} onImageError={()=>{setImageCheck({exam,state:'error'});fail(new Error('当前题组图片无法显示，请重试图片预检；计时不会暂停。'));}}/>}</div>
          <aside className="panel mock-answer-card"><h3>答题卡</h3><p className="mock-card-count">已保存 {answered} / 200<br/>{durableSubmitted?'交卷后 · 全部题目':displayed?.status==='listening'?'听力阶段 · Part 1–4':'阅读阶段 · Part 5–7'}</p><div className="mock-card-legend"><span>✓ 已保存</span><span>□ 未答</span><span>○ 待保存变更</span></div><details><summary><span className="mock-nav-expand">展开题号导航</span><span className="mock-nav-collapse">收起题号导航</span></summary><p className="mock-muted">{durableSubmitted?'查看本次原答案；交卷后不可修改':'只显示当前阶段；点击题号返回原题。'}</p>{[1,2,3,4,5,6,7].map(part=>{const items=presented?.questions.filter(q=>q.part===part)||[];return !!items.length && <div className="mock-part" key={part}><h4>Part {part} · {items.length} 题</h4><div className="mock-grid">{items.map(q=>{const hasAnswer=saved.attempt.answers[q.number]!==undefined,isPending=!durableSubmitted && pendingAnswer?.number===q.number;return <button key={q.number} className={`${hasAnswer?'has-answer':''} ${isPending?'is-pending':''}`} aria-current={q.number===questionNumber?'true':undefined} aria-label={`第 ${q.number} 题，${hasAnswer?'已保存':'未答'}${isPending?'，另有待保存变更':''}`} disabled={busy || !!expiredSaving || !!pendingAnswer && !durableSubmitted} onClick={()=>void select(q.number,true).catch(ignore)}>{q.number}<span aria-hidden>{isPending?'○':hasAnswer?'✓':''}</span></button>;})}</div></div>;})}</details>{!durableSubmitted && displayed?.status==='reading' && <button className="button primary" disabled={busy || !!expiredSaving} onClick={()=>setConfirmSubmit(true)}>提交整卷</button>}
          </aside>
        </div>
        {durableSubmitted && <div className="mock-actions mock-result-actions"><button className="button secondary" onClick={()=>{setExam(null);setSaved(null);current.current=null;setLibraryView('history');}}>回到题包与记录</button></div>}
      </>}
    </>}
    <Dialog open={confirmSubmit} onOpenChange={open=>{if(!busy)setConfirmSubmit(open);}}><DialogContent className="mock-submit-dialog"><DialogHeader><DialogTitle>{submitting?'正在保存交卷…':'确认提交整卷？'}</DialogTitle><DialogDescription>已保存 {answered} / 200 题，还有 {missingAnswers} 题未保存答案，漏答按错误计。交卷后不能修改本次答案；再次开始会保留为复测记录。</DialogDescription></DialogHeader>
      <div className="mock-dialog-timer"><span>{phaseLabel}剩余</span><strong>{clockText(displayed?remainingMs(displayed,now):0)}</strong><small>原截止 {deadline?new Date(deadline).toLocaleTimeString():'—'} · 确认期间继续计时</small></div>
      {pendingAnswer && <div className="mock-alert" role="alert"><strong>第 {pendingAnswer.number} 题变更尚未保存</strong><p>{pendingIsNew?'这道题按漏答计；先返回重试保存，才会计入答案。':`仅按原已保存选项 ${savedChoice==null?'—':String.fromCharCode(65+savedChoice)} 交卷；当前临时变更不会覆盖它。`}</p></div>}
      {submitting && <p role="status">等待本机保存完成，成功前不展示成绩或正确答案。</p>}
      {error && !submitting && <div role="alert"><p className="mock-muted">交卷尚未完成。重新读取记录，核对原状态后重试，原截止不变。</p><button className="button secondary" disabled={busy} onClick={()=>void refresh().catch(ignore)}>重新读取记录</button></div>}
      <div className="mock-actions"><button className="button secondary" disabled={busy} onClick={()=>setConfirmSubmit(false)}>继续答题</button><button className="button primary" disabled={busy || displayed?.status!=='reading'} onClick={()=>void submit().catch(ignore)}>{submitting?'正在交卷…':'确认交卷'}</button></div>
    </DialogContent></Dialog>
    <Dialog open={confirmExit} onOpenChange={open=>{if(!busy){setConfirmExit(open);if(!open)setConfirmForceExit(false);}}}><DialogContent className="mock-exit-dialog"><DialogHeader><DialogTitle>{confirmForceExit?'仍要离开这次考试？':exitFailure?'退出状态尚未保存':'保存并退出模考？'}</DialogTitle><DialogDescription>{confirmForceExit?'只退出页面，未保存选择不能保证保留；原已保存答案保持，考试按原截止继续计时。':'先保存中断标记，再离开这次考试。退出、后台和重启都不会暂停计时。'}</DialogDescription></DialogHeader>
      <div className="mock-dialog-timer"><span>{phaseLabel}剩余</span><strong>{clockText(displayed?remainingMs(displayed,now):0)}</strong><small>原截止 {deadline?new Date(deadline).toLocaleTimeString():'—'} · 已保存 {answered} / 200</small></div>
      {pendingAnswer && <p className="mock-notice">第 {pendingAnswer.number} 题临时变更尚未保存，不会当作已保存答案。</p>}
      {exitFailure && <div className="mock-alert" role="alert"><strong>保存未完成</strong><p>可以先重新读取并重试。明确退出只关闭页面，不把本次失败标记为安全保存。</p></div>}
      <div className="mock-actions">{confirmForceExit?<><button className="button secondary" disabled={busy} onClick={()=>setConfirmForceExit(false)}>返回处理保存</button><button className="button danger" disabled={busy} onClick={onClose}>确认未保存仍退出</button></>:<><button className="button secondary" disabled={busy} onClick={()=>setConfirmExit(false)}>继续作答</button><button className="button primary" disabled={busy} onClick={()=>void leave().catch(ignore)}>{leaving?'正在保存…':'保存并退出'}</button>{exitFailure && <><button className="button secondary" disabled={busy} onClick={()=>void refresh().catch(ignore)}>重新读取记录</button><button className="text-button" disabled={busy} onClick={()=>setConfirmForceExit(true)}>中断标记未保存，仍退出（计时继续）</button></>}</>}</div>
    </DialogContent></Dialog>
    <Dialog open={!!imagePreview} onOpenChange={open=>{if(!open)setImagePreview(null);}}><DialogContent className="mock-image-dialog"><DialogHeader><DialogTitle>{imagePreview?.label}</DialogTitle><DialogDescription>原图保持比例，可横向、纵向滚动。扫描文字未自动转为无障碍正文。</DialogDescription></DialogHeader>
      {!durableSubmitted && saved && <p className="mock-image-clock">{phaseLabel}剩余 {clockText(displayed?remainingMs(displayed,now):0)} · 原截止 {deadline?new Date(deadline).toLocaleTimeString():'—'} · 放大期间继续计时</p>}
      <div className="mock-image-scroll" tabIndex={0}>{imagePreview && <img src={imagePreview.url} alt={imagePreview.label}/>}</div>
    </DialogContent></Dialog>
  </section>;
}

export function ExamPaper({question, group, urls, selected, pendingChoice, submitted, disabled, navigationDisabled=false, previousAvailable, nextAvailable, onAnswer, onSelect, onImage, onImageError}: {
  question: VisibleQuestion; group: VisibleGroup; urls: Record<string,string>; selected?: number;
  pendingChoice?: number | null; submitted: boolean; disabled: boolean; navigationDisabled?: boolean; previousAvailable: boolean; nextAvailable: boolean;
  onAnswer: (choice:number|null)=>void; onSelect: (number:number)=>void; onImage: (url:string,label:string)=>void; onImageError: ()=>void;
}) {
  const hasMaterials=group.passages.some(text=>text.trim()) || group.imageIds.length>0;
  const parallel=hasMaterials && group.part>=6;
  return <article className={`mock-paper-content ${parallel?'parallel':''}`} aria-label={`第 ${question.number} 题`}>
    {hasMaterials && <section className="panel mock-materials" tabIndex={-1} aria-label="本题组原材料"><div className="mock-material-heading"><h3>{group.part===1?'本题照片':'阅读材料'}</h3><span>{group.questionNumbers[0]}–{group.questionNumbers[group.questionNumbers.length-1]} 题</span></div>
      {group.passages.filter(text=>text.trim()).length>1 && <nav className="mock-material-links" aria-label="跳至材料">{group.passages.map((text,index)=>text.trim() && <a key={index} href={`#mock-material-${group.id}-${index}`} onClick={event=>{event.preventDefault();document.getElementById(`mock-material-${group.id}-${index}`)?.scrollIntoView({block:'start',behavior:'auto'});}}>材料 {index+1}</a>)}</nav>}
      {group.passages.map((text,index)=>text.trim() && <section id={`mock-material-${group.id}-${index}`} className="mock-material" key={index}><span>材料 {index+1}</span><div className="mock-passage" lang="en">{text}</div></section>)}
      {group.imageIds.map((id,index)=>urls[id] && <figure className="mock-scan" key={id}><button type="button" aria-label={`放大本组材料图片 ${index+1}`} onClick={()=>onImage(urls[id],`Part ${group.part} 题组扫描材料 ${index+1}`)}><img src={urls[id]} onError={onImageError} alt={`Part ${group.part} 题组扫描材料 ${index+1}；图片文字需放大查看`}/><span>放大图片 ↗</span></button><figcaption>可点击放大；扫描材料未自动转为无障碍文字。</figcaption></figure>)}
      {parallel && <p className="mock-material-end">材料结束 · 接下来作答</p>}
    </section>}
    <section className="panel mock-question" tabIndex={-1}>{hasMaterials&&<button className="text-button mock-return-material" onClick={event=>{const target=event.currentTarget.closest('article')?.querySelector<HTMLElement>('.mock-materials');target?.scrollIntoView({block:'start',behavior:'auto'});target?.focus({preventScroll:true});}}>返回本题组材料</button>}<p className="eyebrow">Part {question.part} · 第 {question.number} / 200 题</p>
      <QuestionBody question={question} selected={submitted?selected:pendingChoice===undefined?selected:pendingChoice??undefined} submitted={submitted} disabled={disabled} onAnswer={onAnswer}/>
      {!submitted && <p className={pendingChoice!==undefined?'mock-save-state pending':'mock-save-state'} role="status">{pendingChoice!==undefined?`○ ${pendingChoice===null?'清除操作':`已选 ${String.fromCharCode(65+pendingChoice)}`} · 待保存`:selected===undefined?'本题尚未作答':'✓ 本题答案已保存在本机'}</p>}
      <div className="mock-actions mock-question-navigation"><button className="button secondary" disabled={disabled || navigationDisabled || !previousAvailable} onClick={()=>onSelect(question.number-1)}>上一题</button><button className="button secondary" disabled={disabled || navigationDisabled || !nextAvailable} onClick={()=>onSelect(question.number+1)}>下一题</button></div>
    </section>
  </article>;
}

export function QuestionBody({question, selected, submitted, disabled, onAnswer}: {
  question: VisibleQuestion; selected?: number; submitted: boolean; disabled: boolean; onAnswer: (choice: number | null) => void;
}) {
  // Defensive condition remains even if a future caller passes a full question during an exam.
  const correct = submitted && 'answer' in question && typeof question.answer === 'number' ? question.answer : undefined;
  return <><h3 className="mock-prompt" lang="en">{question.prompt || `Question ${question.number}`}</h3>
    <fieldset className="mock-choices" disabled={disabled || submitted}><legend className="sr-only">第 {question.number} 题选项</legend>
      {question.choices.map((text, index) => <label key={index} className={correct !== undefined && index === correct ? 'answer-correct' : correct !== undefined && selected === index ? 'answer-wrong' : !submitted && selected === index ? 'selected' : ''}>
        <input type="radio" name={`exam-answer-${question.number}`} checked={selected === index} onChange={() => onAnswer(index)}/>
        <b aria-hidden="true">{String.fromCharCode(65 + index)}</b><span lang="en">{text}{correct !== undefined && (index === correct || selected === index) && <span className="mock-answer-label" lang="zh-CN">{index === correct ? <Check size={16} aria-hidden/> : <CircleAlert size={16} aria-hidden/>}{index === correct ? selected === index ? '正确答案 · 你的答案' : '正确答案' : '你的答案 · 回答错误'}</span>}</span>
      </label>)}</fieldset>
    {!submitted && <button className="text-button" disabled={disabled || selected === undefined} onClick={() => onAnswer(null)}>清除此题答案</button>}
    {submitted && correct !== undefined && <section className={`mock-explanation ${selected === undefined ? 'answer-unanswered' : selected === correct ? 'answer-correct' : 'answer-wrong'}`} aria-label="交卷后解析">
      <h4>{selected === correct ? <Check size={18} aria-hidden/> : <CircleAlert size={18} aria-hidden/>}{selected === undefined ? '未作答' : selected === correct ? '回答正确' : '回答错误'} · 正确答案 {String.fromCharCode(65 + correct)}</h4>
      {'explanation' in question && typeof question.explanation === 'string' && question.explanation ? <p>{question.explanation}</p> : <p>此题包未提供解析。</p>}
    </section>}</>;
}

export function Results({result, attempt}: {result: ExamResult; attempt: ExamAttempt}) {
  return <article className="panel mock-results"><p className="eyebrow">{result.firstAttempt?'首次完整模考':`复测第 ${result.ordinal-1} 次`} · {attempt.submittedReason==='timeout'?'到时自动交卷':'主动交卷'}</p>
    <h3>这一次，已交卷并保存。</h3><p>{getExamProfile(attempt.format).label} · 总用时 {clockText(result.elapsedMs)} · 原答案已锁定</p>
    <div className="mock-result-metrics"><div><span>听力原始正确</span><strong>{result.listeningCorrect}<small> / 100</small></strong></div><div><span>阅读原始正确</span><strong>{result.readingCorrect}<small> / 100</small></strong></div><div><span>整卷漏答</span><strong>{result.unanswered}<small> / 200</small></strong></div></div>
    <p>正确 {result.correct} / 200 · 本次听力时限 {clockText(attempt.listeningDeadline-attempt.startedAt)} · 阅读时限 {clockText(attempt.readingDeadline-attempt.listeningDeadline)}</p>
    <div className="mock-table-wrap"><table><caption>全部 7 个 Part</caption><thead><tr><th scope="col">Part</th><th scope="col">正确 / 总题</th><th scope="col">漏答</th><th scope="col">正确率</th><th scope="col">驻留用时</th></tr></thead><tbody>{result.parts.map(part=><tr key={part.part}><th scope="row">{part.part}<small>{partNames[part.part-1]}</small></th><td>{part.correct} / {part.total}</td><td>{part.unanswered}</td><td>{Math.round(part.accuracy*100)}%</td><td>{clockText(part.timeMs)}</td></tr>)}</tbody></table></div>
    <p className="mock-muted">各 Part 用时是当前题驻留的墙钟时间，包含后台和离开，不代表有效专注时间。结果只对应这份原题包与这次记录。</p>
    <p className="mock-integrity">{result.integrity==='interrupted'?'本次存在中断或时钟异常，比较成绩时请一并考虑。':'未记录到中断；本机记录不等于监考认证。'}</p>
    {result.clockRollback && <p role="alert" className="mock-alert">检测到系统时钟回拨，使用已观察时间高水位继续计时。</p>}
    {!!result.interruptions.length && <details><summary>查看 {result.interruptions.length} 条中断记录</summary><ul>{result.interruptions.map((item,index)=><li key={index}>{new Date(item.at).toLocaleTimeString()} · {labels[item.reason]}</li>)}</ul></details>}
    {result.referenceRange?<div className="mock-explanation"><h4>该套试卷提供的参考区间</h4><p>听力 {result.referenceRange.listening?.join('–')||'未提供'} · 阅读 {result.referenceRange.reading?.join('–')||'未提供'}</p><p>{result.referenceRange.source}</p><p>{result.referenceRange.disclaimer}</p></div>:<p className="mock-muted">本卷未提供有出处的分数换算表，只显示原始正确题数，不推算正式托业分数。</p>}
  </article>;
}

export function ExamAudio({url, declaredListeningDurationMs, effectiveListeningDurationMs, attempt, durableSubmitted, onPreflight, onInterruption, onRefresh, busy}: {
  url: string; declaredListeningDurationMs?: number; effectiveListeningDurationMs: number;
  attempt: ExamAttempt | null; durableSubmitted: boolean;
  onPreflight: (ready: boolean, url: string) => void; onInterruption: (reason: InterruptionReason) => Promise<void>;
  onRefresh: () => Promise<void>; busy: boolean;
}) {
  const accountAccess=useLearningAccess();
  const audio = useRef<HTMLAudioElement | null>(null), mounted = useRef(false), generation = useRef(0);
  const latest = useRef({url, declaredListeningDurationMs, effectiveListeningDurationMs, attempt, onPreflight, onInterruption, onRefresh});
  latest.current = {url, declaredListeningDurationMs, effectiveListeningDurationMs, attempt, onPreflight, onInterruption, onRefresh};
  const metadataDuration = useRef<number>(NaN);
  const [duration, setDuration] = useState(0), [playable, setPlayable] = useState(false), [played, setPlayed] = useState(false);
  const [state, setState] = useState<'idle' | 'playing' | 'paused' | 'ended' | 'error'>('idle'), [error, setError] = useState('');
  const intentionalPause = useRef(false), controlledSeek = useRef(false), failureLogged = useRef(false);
  const wasPreflight = useRef(!attempt);
  const background = useRef(false), playbackWanted = useRef(false), stall = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function stop() { generation.current++; playbackWanted.current = false; intentionalPause.current = true; audio.current?.pause(); }
  async function recordFailure(reason: InterruptionReason, text: string) {
    if (!mounted.current) return;
    stop(); setPlayable(false); setPlayed(false); latest.current.onPreflight(false, latest.current.url); setState('error'); setError(text);
    if (!failureLogged.current && !inactive(latest.current.attempt)) {
      failureLogged.current = true;
      await latest.current.onInterruption(reason);
    }
  }
  async function playAligned() {
    const player = audio.current, snapshot = latest.current.attempt;
    if (!accountAccess() || !player || !snapshot || snapshot.status !== 'listening' || document.hidden || !isNativeForeground()) return;
    const ticket = ++generation.current;
    try {
      const check = durationCheck(player);
      if (!check.ready) throw new Error(check.error);
      const target = audioOffsetSeconds(snapshot, Date.now(), player.duration);
      if (Math.abs(player.currentTime - target) > 1) {
        await latest.current.onInterruption('audio-seek');
        if (!accountAccess() || !mounted.current || generation.current !== ticket) return;
        controlledSeek.current = true;
        player.currentTime = audioOffsetSeconds(snapshot, Date.now(), player.duration);
      }
      if (!accountAccess() || !mounted.current || generation.current !== ticket || latest.current.attempt?.status !== 'listening') return;
      const alignedCheck = durationCheck(player);
      if (!alignedCheck.ready) throw new Error(alignedCheck.error);
      if (player.currentTime >= player.duration - 0.05) {setState('ended'); return;}
      intentionalPause.current = false; playbackWanted.current = true; setError('');
      await player.play();
      if (!accountAccess() || !mounted.current || generation.current !== ticket || latest.current.attempt?.status !== 'listening' || document.hidden || !isNativeForeground()) {player.pause(); return;}
      const playingCheck = durationCheck(player);
      if (!playingCheck.ready) throw new Error(playingCheck.error);
      failureLogged.current = false; setState('playing');
    } catch (cause) {
      if (mounted.current && generation.current === ticket) await recordFailure('audio-failure', `音频未能播放：${message(cause)} 计时继续，请重试。`);
    }
  }
  function durationCheck(player: HTMLAudioElement) {
    const current = latest.current;
    if (!current.url || player !== audio.current || player.getAttribute('src') !== current.url) {
      return {ready: false, error: '音频来源已变化，请重新加载并试听。'};
    }
    return checkExamAudioDuration(player.duration, current.declaredListeningDurationMs, current.effectiveListeningDurationMs);
  }
  function clearPreflight() {
    metadataDuration.current = NaN; setDuration(0); setPlayable(false); setPlayed(false);
    latest.current.onPreflight(false, latest.current.url);
  }
  function readDuration(player: HTMLAudioElement) {
    if (!accountAccess()) {stop(); clearPreflight(); setState('paused'); return false;}
    if (player !== audio.current || player.getAttribute('src') !== latest.current.url) return false;
    if (!Object.is(metadataDuration.current, player.duration)) {
      // A changed measurement needs a new successful play; a prior preview cannot certify it.
      metadataDuration.current = player.duration; setPlayed(false);
      latest.current.onPreflight(false, latest.current.url);
    }
    setDuration(player.duration);
    const check = durationCheck(player);
    if (!check.ready) {void recordFailure('audio-failure', check.error).catch(ignore); return false;}
    return true;
  }
  const playRef = useRef(playAligned); playRef.current = playAligned;
  useEffect(() => {
    mounted.current = true; clearPreflight(); setState('idle'); setError(''); failureLogged.current = false;
    const detach = attachExamMedia(audio.current, url);
    return () => {mounted.current = false; stop(); clearTimeout(stall.current); detach();};
  }, [url, declaredListeningDurationMs, effectiveListeningDurationMs]);
  const durationMatch = checkExamAudioDuration(duration, declaredListeningDurationMs, effectiveListeningDurationMs);
  useEffect(() => {
    onPreflight(!!url && !attempt && playable && played && !error && durationMatch.ready, url);
  }, [url, attempt, playable, played, error, durationMatch.ready, onPreflight]);
  useEffect(() => {
    if (attempt?.status === 'listening') {
      if ((audio.current?.readyState ?? 0) >= 1) {
        if (wasPreflight.current && audio.current) {
          // Preview playback is not part of the exam and must start again at zero.
          intentionalPause.current = true; audio.current.pause();
          if (audio.current.currentTime > 0.01) {controlledSeek.current = true; audio.current.currentTime = 0;}
          audio.current.playbackRate = 1;
        }
        wasPreflight.current = false;
        void playRef.current().catch(ignore);
      }
      else setState('paused'); // A restored package must load metadata before Resume.
    }
    else {stop(); if (attempt) setState('paused');}
  }, [attempt?.id, attempt?.status]);
  useEffect(() => {
    const update = () => {
      const hidden = document.hidden || !isNativeForeground();
      if (hidden && !background.current) {
        background.current = true; stop(); setState('paused');
        if (!inactive(latest.current.attempt)) void latest.current.onInterruption('background').catch(ignore);
      } else if (!hidden && background.current) {
        background.current = false;
        if (!inactive(latest.current.attempt)) void latest.current.onRefresh().catch(ignore);
        // User taps Resume: no unsolicited autoplay after lock screen / background.
      }
    };
    document.addEventListener('visibilitychange', update);
    const unsubscribe = subscribeNativeState(update);
    return () => {document.removeEventListener('visibilitychange', update); unsubscribe();};
  }, []);
  return <section hidden={durableSubmitted || attempt?.status === 'reading'} className="panel mock-audio" aria-label={attempt ? '考试听力播放' : '听力音频预检'}><h3>{attempt ? '听力播放' : '音频预检'}</h3>
    <audio ref={audio} src={url || undefined} preload="metadata" controls={!attempt} controlsList="nodownload noplaybackrate" onLoadedMetadata={event => {readDuration(event.currentTarget);}}
      onDurationChange={event => {readDuration(event.currentTarget);}}
      onEmptied={clearPreflight} onLoadStart={clearPreflight}
      onCanPlay={event => {setPlayable(readDuration(event.currentTarget));}}
      onPlaying={event => {
        if (!readDuration(event.currentTarget)) return;
        setPlayable(true); setPlayed(true); setError(''); setState('playing'); clearTimeout(stall.current);
      }}
      onError={() => {clearPreflight(); void recordFailure('audio-failure', '音频无法解码或加载；请检查题包。考试计时不会暂停。').catch(ignore);}}
      onPause={() => {
        if (!audio.current?.paused) return; // Ignore an already superseded preview pause event.
        if (!audio.current?.ended && !intentionalPause.current && latest.current.attempt?.status === 'listening' && !document.hidden && isNativeForeground())
          void recordFailure('audio-interrupted', '听力播放中断，恢复时将按已经过的考试时间对齐。').catch(ignore);
        intentionalPause.current = false;
      }} onEnded={() => {playbackWanted.current = false; setState('ended');}}
      onWaiting={() => {
        clearTimeout(stall.current);
        if (!playbackWanted.current) return;
        stall.current = setTimeout(() => {if (mounted.current && playbackWanted.current && (audio.current?.readyState ?? 0) < 3)
          void recordFailure('audio-failure', '音频持续无法播放，请重试；考试计时仍继续。').catch(ignore);}, 5000);
      }} onSeeking={() => {
        if (!controlledSeek.current && latest.current.attempt?.status === 'listening')
          void recordFailure('audio-seek', '音频位置发生变化，恢复时将重新对齐已用时间。').catch(ignore);
      }} onSeeked={() => {controlledSeek.current = false;}}/>
    <p>音频时长：{Number.isFinite(duration) && duration > 0 ? clockText(duration * 1000) : '读取中…'} · 本套听力时限 {clockText(effectiveListeningDurationMs)} · 阅读 {clockText(READING_MS)}</p>
    {!attempt && <p className="mock-muted">先点击播放器试听。{declaredListeningDurationMs === undefined ? '本套未声明听力时长，沿用 45:00；超过时限的音轨须核对后使用新版本。' : '本套使用题包声明的听力时长，须与实际音轨匹配；声明不代表材料已获认证。'}</p>}
    {attempt && <p className="mock-muted">本次沿用已保存的听力截止 {new Date(attempt.listeningDeadline).toLocaleTimeString()}；音频重载或结束不改变计时。</p>}
    {attempt?.status === 'listening' && <><p role="status">{state === 'playing' ? '正在播放整场听力' : state === 'ended' ? '音频已结束；听力阶段按原截止时间结束。' : '音频当前未播放；倒计时继续。'}</p>
      {state !== 'playing' && state !== 'ended' && <div className="mock-actions"><button className="button secondary" disabled={busy} onClick={() => void playAligned().catch(ignore)}>按已用时间恢复听力</button>
        <button className="text-button" disabled={busy} onClick={() => {stop(); clearPreflight(); audio.current?.load(); setError('正在重新加载，请稍后点击恢复听力。');}}>重新加载音频</button></div>}</>}
    {attempt?.status === 'reading' && <p>听力阶段已结束，音频已停止；无法返回听力修改答案。</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
