'use client';

import {useEffect, useRef, useState} from 'react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {isNativeForeground, registerNativeBack, subscribeNativeState} from '@/lib/native-host';
import {EXAM_LIMITS, LISTENING_MS, advanceAttempt, examKey, presentExam,
  type ExamAttempt, type ExamPackage, type ExamResult, type InterruptionReason} from '@/lib/exam-model';
import {openExamRepository, type ExamRepository, type ExamSummary, type SavedExamAttempt} from '@/lib/exam-storage';
import {ExamAssetUrls, ExamUiSession, StaleExamOwner, attachExamMedia, audioOffsetSeconds, clockText, remainingMs, trySaveExamExit, verifyExamImage} from '@/lib/exam-ui';
import './mock-exam.css';

type Props = {ownerId: string | null; onClose: () => void};
type Catalog = {packages: ExamSummary[]; attempts: SavedExamAttempt[]};
type VisibleQuestion = ReturnType<typeof presentExam>['questions'][number];
const labels: Record<InterruptionReason, string> = {
  background: '进入后台或离开模考', 'audio-failure': '音频播放失败',
  'audio-interrupted': '音频播放中断', 'audio-seek': '音频按已用时间对齐',
};
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。';
const ignore = () => {};
const inactive = (a: ExamAttempt | null) => !a || a.status === 'submitted';

/** key remount prevents even one render of a previous owner's package/answers. */
export default function MockExam({ownerId, onClose}: Props) {
  if (!ownerId?.trim()) return <section className="mock-exam panel" role="alert">
    <h2>暂时无法确认本机记录范围</h2><p>请先恢复当前账号状态，再打开模考。</p>
    <button className="button secondary" onClick={onClose}>返回</button>
  </section>;
  return <MockExamOwner key={ownerId} ownerId={ownerId} onClose={onClose}/>;
}

async function readCatalog(repo: ExamRepository): Promise<Catalog> {
  // Listing must stay readable if quota prevents an expired attempt being written.
  // Continue/resume performs durable clock reconciliation before entering the exam.
  return {packages: await repo.listPackages(), attempts: await repo.listAttempts()};
}

function MockExamOwner({ownerId, onClose}: {ownerId: string; onClose: () => void}) {
  const [catalog, setCatalog] = useState<Catalog>({packages: [], attempts: []});
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [exitFailure, setExitFailure] = useState(false);
  const [exam, setExam] = useState<ExamPackage | null>(null);
  const [saved, setSaved] = useState<SavedExamAttempt | null>(null);
  const [now, setNow] = useState(Date.now()), [reviewNumber, setReviewNumber] = useState(1);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [imagePreview, setImagePreview] = useState<{url: string; label: string} | null>(null);
  const [preflight, setPreflight] = useState(false), [heard, setHeard] = useState(false);
  const [assetState, setAssetState] = useState<{exam: ExamPackage | null; urls: Record<string, string>}>({exam: null, urls: {}});
  const urls = assetState.exam === exam ? assetState.urls : {};
  const [imageCheck, setImageCheck] = useState<{exam: ExamPackage | null; state: 'pending' | 'ready' | 'error'}>({exam: null, state: 'pending'});
  const [imageRetry, setImageRetry] = useState(0);
  const imagesReady = imageCheck.exam === exam && imageCheck.state === 'ready';
  const session = useRef<ExamUiSession | null>(null), current = useRef<SavedExamAttempt | null>(null);
  const pending = useRef(0), userLock = useRef(false);
  const errorRef = useRef(''), inputs = useRef<{packages: HTMLInputElement | null; backup: HTMLInputElement | null}>({packages: null, backup: null});
  const downloadUrls = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  function fail(error: unknown) { const text = message(error); errorRef.current = text; setError(text); }
  function clearError() { errorRef.current = ''; setError(''); }
  function apply(row: SavedExamAttempt) {
    current.current = row; setSaved(row); setNow(Date.now());
    setCatalog(previous => ({...previous, attempts: [row, ...previous.attempts.filter(a => a.attempt.id !== row.attempt.id)]}));
    if (row.attempt.status === 'submitted') setConfirmSubmit(false);
  }
  async function perform<T>(work: (repo: ExamRepository) => Promise<T>, done: (value: T) => void, user = true): Promise<T> {
    const owner = session.current;
    if (!owner) throw new StaleExamOwner();
    if (user && userLock.current) throw new Error('正在保存，请稍候');
    if (user) { userLock.current = true; setBusy(true); clearError(); setNotice(''); }
    pending.current++;
    try {
      return await owner.run(async repo => {
        const value = await work(repo);
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
    void openExamRepository(ownerId).then(repo => {
      if (cancelled) { repo.close(); return; }
      opened = new ExamUiSession(repo, ownerId); session.current = opened;
      return perform(readCatalog, value => {setCatalog(value); setReady(true);}, false);
    }).catch(cause => { if (!cancelled && !(cause instanceof StaleExamOwner)) fail(cause); });
    return () => {
      cancelled = true; opened?.close();
      if (session.current === opened) session.current = null;
      downloadUrls.current.forEach((timer, url) => {clearTimeout(timer); URL.revokeObjectURL(url);});
      downloadUrls.current.clear();
    };
  }, [ownerId]); // owner is immutable until the keyed component unmounts.

  useEffect(() => {
    setAssetState({exam: null, urls: {}}); setPreflight(false); setHeard(false);
    if (!exam) return;
    const owned = new ExamAssetUrls(exam);
    try { setAssetState({exam, urls: Object.fromEntries(exam.assets.map(asset => [asset.id, owned.get(asset.id)]))}); }
    catch (cause) { owned.close(); fail(cause); }
    return () => owned.close();
  }, [exam]);

  useEffect(() => {
    if (!exam || assetState.exam !== exam) return;
    const controller = new AbortController();
    let cancelled = false;
    setImageCheck({exam, state: 'pending'});
    void (async () => {
      // Decode sequentially to avoid holding every full-resolution image at once.
      for (const asset of exam.assets.filter(value => value.mime.startsWith('image/'))) {
        await verifyExamImage(assetState.urls[asset.id], controller.signal);
      }
      if (!cancelled) setImageCheck({exam, state: 'ready'});
    })().catch(cause => {
      if (!cancelled && !(cause instanceof StaleExamOwner)) {setImageCheck({exam, state: 'error'}); fail(cause);}
    });
    return () => {cancelled = true; controller.abort();};
  }, [exam, assetState, imageRetry]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      if (!session.current || pending.current || errorRef.current || inactive(current.current?.attempt ?? null)) return;
      void perform(repo => repo.resumeAttempt(current.current!.attempt.id), apply, false).catch(ignore);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
    if (!inactive(current.current?.attempt ?? null)) {
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
  }
  useEffect(() => registerNativeBack(() => { void leave().catch(ignore); return true; }, 90), [confirmSubmit, imagePreview, onClose]);

  async function openPackage(key: string, attemptId?: string) {
    await perform(async repo => {
      const value = await repo.getPackage(key);
      let row = attemptId ? await repo.resumeAttempt(attemptId) : null;
      if (row && row.attempt.status !== 'submitted') row = await repo.markInterrupted(row.attempt.id, 'background', Date.now(), row.attempt.revision);
      if (row?.attempt.status === 'listening') row = await repo.markInterrupted(row.attempt.id, 'audio-interrupted', Date.now(), row.attempt.revision);
      return {value, row};
    }, ({value, row}) => {
      setExam(value); current.current = row; setSaved(row);
      if (row) apply(row); setReviewNumber(1); setNow(Date.now());
    });
  }
  async function start() {
    if (!exam || !preflight || !heard || !imagesReady || document.hidden || !isNativeForeground()) return;
    await perform(repo => repo.startAttempt(examKey(exam)), apply);
  }
  async function select(number: number) {
    if (durableSubmitted) { setReviewNumber(number); return; }
    await perform(repo => {
      const row = current.current!;
      return repo.select(row.attempt.id, number, Date.now(), row.attempt.revision);
    }, apply);
  }
  async function answer(number: number, choice: number | null) {
    await perform(repo => {
      const row = current.current!;
      return repo.answer(row.attempt.id, number, choice, Date.now(), row.attempt.revision);
    }, row => {apply(row); setNotice(row.attempt.status === 'submitted' ? '时间已到，试卷已交卷；最后的点击未计入答案。' : `第 ${number} 题已保存在本机。`);});
  }
  async function submit() {
    await perform(repo => {
      const row = current.current!;
      return repo.submit(row.attempt.id, Date.now(), row.attempt.revision);
    }, row => {apply(row); setReviewNumber(1); setNotice('试卷已交卷并保存在本机。');});
  }
  async function importFiles(files: File[]) {
    await perform(async repo => {
      const outcomes: string[] = [];
      for (const file of files) {
        session.current?.assertActive();
        if (file.size > EXAM_LIMITS.importBytes) throw new Error(`${file.name} 超过 96 MiB 题包限额。`);
        const text = await file.text();
        // close() prevents a delayed file read from writing after owner disposal.
        const outcome = await repo.importPackage(text);
        outcomes.push(`${file.name}：${outcome.status === 'unchanged' ? '内容相同，未重复导入' : '已导入'}`);
      }
      return {catalog: await readCatalog(repo), outcomes};
    }, value => {setCatalog(value.catalog); setNotice(value.outcomes.join('；'));});
    // Multi-file selection is sequential atomic-per-file, not one batch transaction.
  }
  async function restore(file: File) {
    await perform(async repo => {
      if (file.size > EXAM_LIMITS.backupBytes) throw new Error('备份超过 224 MiB 限额。');
      const result = await repo.importBackup(await file.text());
      return {result, catalog: await readCatalog(repo)};
    }, ({result, catalog}) => {setCatalog(catalog); setNotice(`备份已合并：新增 ${result.packagesAdded} 套题包、${result.attemptsAdded} 次记录；原记录保留。`);});
  }
  async function backup() {
    await perform(repo => repo.exportBackup(), value => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(value)], {type: 'application/json'}));
      const timer = setTimeout(() => {URL.revokeObjectURL(url); downloadUrls.current.delete(url);}, 60_000);
      downloadUrls.current.set(url, timer);
      const link = document.createElement('a'); link.href = url;
      // Harmony's download allowlist requires a fixed action name; native adds uniqueness.
      link.download = 'lantern-exam-backup.json';
      document.body.appendChild(link); link.click(); link.remove();
      setNotice('已发起备份下载，请在系统下载目录确认文件存在。备份包含题包、答案、音频及本机记录。');
    });
  }

  return <section className={saved && !durableSubmitted ? "mock-exam is-running" : "mock-exam"} aria-label="完整听读模考">
    <header className="mock-heading"><div><p className="eyebrow">LOCAL MOCK EXAM</p><h2>{exam?.title || '完整听读模考'}</h2></div>
      <button className="button secondary" disabled={busy} onClick={() => void leave().catch(ignore)}>退出模考</button></header>
    {!saved && <p className="mock-muted">个人题包仅保存在这台设备。未接入云同步；卸载或清理数据前请导出完整备份。</p>}
    {error && <div className="mock-alert" role="alert"><p>{error}</p><p>未完成的操作不能视为已保存。考试截止时间不会因此延后。</p>
      <button className="button secondary" disabled={busy} onClick={() => void refresh().catch(ignore)}>重新读取记录</button></div>}
    {exitFailure && <div className="mock-alert" role="alert"><p>退出时的中断标记尚未保存。可以先重试读取，或明确退出；考试仍按原截止时间继续。</p>
      <button className="button secondary" disabled={busy} onClick={onClose}>中断标记未保存，仍退出（计时继续）</button></div>}
    <p className="mock-status" role="status" aria-live="polite">{busy ? '正在处理本机记录…' : notice}</p>
    {!ready ? <p role="status">正在打开本机模考存储…</p> : !exam ? <>
      <div className="mock-actions"><button className="button primary" disabled={busy} onClick={() => inputs.current.packages?.click()}>导入题包 JSON</button>
        <button className="button secondary" disabled={busy || !catalog.packages.length} onClick={() => void backup().catch(ignore)}>导出完整备份</button>
        <button className="button secondary" disabled={busy} onClick={() => inputs.current.backup?.click()}>恢复本机备份</button></div>
      <p className="mock-muted">可一次选择多份 JSON，每份独立保存；若中途失败，之前成功的文件仍保留，重新读取可查看。仅同一记录范围可恢复备份。</p>
      <input hidden ref={node => {inputs.current.packages = node;}} type="file" accept="application/json,.json" multiple aria-label="选择题包 JSON"
        onChange={event => {const files = Array.from(event.target.files || []); event.target.value = ''; if (files.length) void importFiles(files).catch(ignore);}}/>
      <input hidden ref={node => {inputs.current.backup = node;}} type="file" accept="application/json,.json" aria-label="选择模考备份"
        onChange={event => {const file = event.target.files?.[0]; event.target.value = ''; if (file) void restore(file).catch(ignore);}}/>
      {active && <article className="panel mock-resume"><h3>继续或结算上次模考</h3><p>{catalog.packages.find(p => p.id === active.attempt.examId && p.version === active.attempt.examVersion)?.title}</p>
        <p>离开期间继续计时；恢复时按原截止时间校准阶段和音频。</p><button className="button primary" disabled={busy}
          onClick={() => void openPackage(examKey({id: active.attempt.examId, version: active.attempt.examVersion}), active.attempt.id).catch(ignore)}>继续考试</button></article>}
      {!catalog.packages.length ? <div className="panel mock-empty"><h3>还没有可用的完整题包</h3><p>导入你有权个人使用的完整听读 JSON 题包后，才能开始 200 题模考。</p>
        <p>这里没有预装完整真题，也不会用演示题拼成“真题卷”。题包须含正文或扫描图片、选项、答案和完整听力音频。</p></div> :
        <div className="mock-catalog">{catalog.packages.map(item => <article className="panel" key={item.key}>
          <p className="eyebrow">200 题 · 听力 45 分钟 / 阅读 75 分钟</p><h3>{item.title}</h3><p className="mock-muted">版本 {item.version} · {item.source.title}</p>
          <details><summary>来源与个人使用声明</summary><p>{item.source.publisher}</p><p>{item.source.reference}</p><p>{item.source.rightsStatement}</p><p>以上为导入者填写，程序未认证来源或授权。</p></details>
          <button className="button secondary" disabled={busy || !!active} onClick={() => void openPackage(item.key).catch(ignore)}>音频预检与新考试</button></article>)}</div>}
      <section className="mock-history"><h3>已交卷记录</h3>{catalog.attempts.filter(row => row.attempt.status === 'submitted').length ?
        catalog.attempts.filter(row => row.attempt.status === 'submitted').map(row => <article className="panel" key={row.attempt.id}>
          <h4>{catalog.packages.find(p => p.id === row.attempt.examId && p.version === row.attempt.examVersion)?.title || '本机题包'}</h4>
          <p>{row.attempt.ordinal === 1 ? '首次' : `复测第 ${row.attempt.ordinal - 1} 次`} · {new Date(row.attempt.startedAt).toLocaleString()} · 正确 {row.result?.correct ?? '—'}/200</p>
          <p>{row.result?.integrity === 'interrupted' ? '有中断或时钟异常标记' : '未记录到中断（不等于监考认证）'}</p>
          <button className="button secondary" disabled={busy} onClick={() => void openPackage(examKey({id: row.attempt.examId, version: row.attempt.examVersion}), row.attempt.id).catch(ignore)}>成绩与复盘</button></article>) : <p className="mock-muted">暂无已交卷记录。</p>}</section>
    </> : <>
      {(!saved || !imagesReady) && <div className="mock-media-status"><p role="status">{imagesReady ? '题包图片已通过本机解码预检。' : imageCheck.exam === exam && imageCheck.state === 'error' ? '材料图片预检失败，不能开始新考试。' : '正在逐张检查材料图片…'}</p>
        {!imagesReady && imageCheck.state === 'error' && <button className="button secondary" disabled={busy} onClick={() => {clearError(); setImageCheck({exam, state: 'pending'}); setImageRetry(n => n + 1);}}>重试图片预检</button>}</div>}
      <ExamAudio key={examKey(exam)} url={urls[exam.listeningAudioId] || ''} attempt={displayed} durableSubmitted={!!durableSubmitted}
        onPreflight={setPreflight} onInterruption={interrupt} onRefresh={() => refresh()} busy={busy}/>
      {!saved ? <article className="panel mock-preflight"><h3>开始前确认</h3><p>听力开始后按 45 分钟截止，随后进入 75 分钟阅读；进入阅读后不能返回听力。退出、后台和重启都不暂停计时。</p>
        <label className="mock-checkbox"><input type="checkbox" checked={heard} onChange={event => setHeard(event.target.checked)}/><span>我已试听，确认声音可听清，且这段音频包含本卷完整听力。</span></label>
        <p>程序仅检查可解码与播放状态，不能代替你确认扬声器和材料完整性。</p>
        <div className="mock-actions"><button className="button primary" disabled={busy || !preflight || !heard || !imagesReady} onClick={() => void start().catch(ignore)}>开始新考试 · 立即计时</button>
          <button className="button secondary" disabled={busy} onClick={() => setExam(null)}>返回题包</button></div></article> : <>
        {durableSubmitted ? <Results result={saved.result!} attempt={saved.attempt}/> : <div className="panel mock-clock">
          <div><b>{displayed?.status === 'listening' ? '听力 LC' : displayed?.status === 'reading' ? '阅读 RC' : '时间已到'}</b>
            <p>{displayed?.status === 'listening' ? '听力结束后自动进入阅读' : '听力已锁定，不能返回修改'}</p></div>
          <div role="timer" aria-label="当前阶段剩余时间"><strong>{clockText(displayed ? remainingMs(displayed, now) : 0)}</strong><small>剩余时间</small></div>
          <p className="mock-muted">已保存 {answered}/200 题 · 离开仍继续计时</p></div>}
        {expiredSaving && <p role="alert">时间已到，正在保存交卷。保存成功后才显示成绩与答案。{error && '请点击“重新读取记录”重试。'}</p>}
        <div className="mock-workspace">
          <div className="mock-paper">{question && group && <article className="panel" aria-label={`第 ${question.number} 题`}>
            <p className="eyebrow">Part {question.part} · 第 {question.number} 题</p>
            {group.passages.map((text, index) => text && <div className="mock-passage" lang="en" key={index}>{text}</div>)}
            {group.imageIds.map((id, index) => urls[id] && <figure className="mock-scan" key={id}><button type="button" aria-label={`放大本组材料图片 ${index + 1}`} onClick={() => setImagePreview({url: urls[id], label: `Part ${group.part} 题组扫描材料 ${index + 1}`})}>
              <img src={urls[id]} onError={() => {setImageCheck({exam, state: 'error'}); fail(new Error('当前题组图片无法显示，请重试图片预检；计时不会暂停。'));}} alt={`Part ${group.part} 题组扫描材料 ${index + 1}；图片文字需放大查看`}/></button><figcaption>可点击放大；扫描材料未自动转为无障碍文字。</figcaption></figure>)}
            <QuestionBody question={question} selected={saved.attempt.answers[question.number]?.choice} submitted={!!durableSubmitted}
              disabled={busy || !!expiredSaving} onAnswer={choice => void answer(question.number, choice).catch(ignore)}/>
            <div className="mock-actions"><button className="button secondary" disabled={busy || !!expiredSaving || !presented?.questions.some(q => q.number === question.number - 1)} onClick={() => void select(question.number - 1).catch(ignore)}>上一题</button>
              <button className="button secondary" disabled={busy || !!expiredSaving || !presented?.questions.some(q => q.number === question.number + 1)} onClick={() => void select(question.number + 1).catch(ignore)}>下一题</button></div>
          </article>}</div>
          <aside className="panel mock-answer-card"><details><summary>答题卡 · 已保存 {answered}/200</summary><p className="mock-muted">{durableSubmitted ? '交卷后可查看全部题目' : '仅显示当前阶段；实心为已保存答案'}</p>
            {[1, 2, 3, 4, 5, 6, 7].map(part => {
              const items = presented?.questions.filter(q => q.part === part) || [];
              return !!items.length && <div className="mock-part" key={part}><h4>Part {part}</h4><div className="mock-grid">{items.map(q => <button key={q.number}
                className={saved.attempt.answers[q.number] ? 'has-answer' : ''} aria-current={q.number === questionNumber ? 'true' : undefined}
                aria-label={`第 ${q.number} 题，${saved.attempt.answers[q.number] ? '已答' : '未答'}`} disabled={busy || !!expiredSaving}
                onClick={() => void select(q.number).catch(ignore)}>{q.number}</button>)}</div></div>;
            })}
            </details>{!durableSubmitted && displayed?.status === 'reading' && <button className="button primary" disabled={busy} onClick={() => setConfirmSubmit(true)}>提交整卷</button>}
          </aside>
        </div>
        {durableSubmitted && <button className="button secondary" onClick={() => {setExam(null); setSaved(null); current.current = null;}}>回到题包与记录</button>}
      </>}
    </>}
    <Dialog open={confirmSubmit} onOpenChange={open => {if (!busy) setConfirmSubmit(open);}}><DialogContent className="mock-submit-dialog"><DialogHeader>
      <DialogTitle>确认提交整卷？</DialogTitle><DialogDescription>还有 {200 - answered} 题未保存答案，漏答按错误计。交卷后不能修改本次答案；再次开始会保留为复测记录。</DialogDescription>
    </DialogHeader><div className="mock-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirmSubmit(false)}>继续答题</button>
      <button className="button primary" disabled={busy || displayed?.status !== 'reading'} onClick={() => void submit().catch(ignore)}>确认交卷</button></div></DialogContent></Dialog>
    <Dialog open={!!imagePreview} onOpenChange={open => {if (!open) setImagePreview(null);}}><DialogContent className="mock-image-dialog"><DialogHeader>
      <DialogTitle>{imagePreview?.label}</DialogTitle><DialogDescription>可在图片区域横向、纵向滚动；关闭图片不会暂停考试。</DialogDescription></DialogHeader>
      <div className="mock-image-scroll" tabIndex={0}>{imagePreview && <img src={imagePreview.url} alt={imagePreview.label}/>}</div>
    </DialogContent></Dialog>
  </section>;
}

export function QuestionBody({question, selected, submitted, disabled, onAnswer}: {
  question: VisibleQuestion; selected?: number; submitted: boolean; disabled: boolean; onAnswer: (choice: number | null) => void;
}) {
  // Defensive condition remains even if a future caller passes a full question during an exam.
  const correct = submitted && 'answer' in question && typeof question.answer === 'number' ? question.answer : undefined;
  return <><h3 className="mock-prompt" lang="en">{question.prompt || `Question ${question.number}`}</h3>
    <fieldset className="mock-choices" disabled={disabled || submitted}><legend className="sr-only">第 {question.number} 题选项</legend>
      {question.choices.map((text, index) => <label key={index} className={selected === index ? 'selected' : ''}>
        <input type="radio" name={`exam-answer-${question.number}`} checked={selected === index} onChange={() => onAnswer(index)}/>
        <b aria-hidden="true">{String.fromCharCode(65 + index)}</b><span lang="en">{text}</span>
      </label>)}</fieldset>
    {!submitted && <button className="text-button" disabled={disabled || selected === undefined} onClick={() => onAnswer(null)}>清除此题答案</button>}
    {submitted && correct !== undefined && <section className="mock-explanation" aria-label="交卷后解析">
      <h4>{selected === undefined ? '未作答' : selected === correct ? '回答正确' : '回答错误'} · 正确答案 {String.fromCharCode(65 + correct)}</h4>
      {'explanation' in question && typeof question.explanation === 'string' && question.explanation ? <p>{question.explanation}</p> : <p>此题包未提供解析。</p>}
    </section>}</>;
}

function Results({result, attempt}: {result: ExamResult; attempt: ExamAttempt}) {
  return <article className="panel mock-results"><p className="eyebrow">{result.firstAttempt ? '首次完整模考' : `复测第 ${result.ordinal - 1} 次`} · {attempt.submittedReason === 'timeout' ? '到时自动交卷' : '主动交卷'}</p>
    <h3>正确 {result.correct}/200 · 漏答 {result.unanswered}</h3><p>听力 {result.listeningCorrect}/100 · 阅读 {result.readingCorrect}/100 · 总用时 {clockText(result.elapsedMs)}</p>
    <p className="mock-muted">各 Part 用时是当前题驻留的墙钟时间，包含后台和离开，不代表有效专注时间。</p>
    <div className="mock-table-wrap"><table><caption>各 Part 成绩</caption><thead><tr><th>Part</th><th>正确/总题</th><th>漏答</th><th>正确率</th><th>用时</th></tr></thead>
      <tbody>{result.parts.map(part => <tr key={part.part}><th scope="row">{part.part}</th><td>{part.correct}/{part.total}</td><td>{part.unanswered}</td><td>{Math.round(part.accuracy * 100)}%</td><td>{clockText(part.timeMs)}</td></tr>)}</tbody></table></div>
    <p>{result.integrity === 'interrupted' ? '本次存在中断或时钟异常，比较成绩时请一并考虑。' : '未记录到中断；本机记录不等于监考认证。'}</p>
    {result.clockRollback && <p role="alert">检测到系统时钟回拨，使用已观察时间高水位继续计时。</p>}
    {!!result.interruptions.length && <details><summary>查看 {result.interruptions.length} 条中断记录</summary><ul>{result.interruptions.map((item, index) => <li key={index}>{new Date(item.at).toLocaleTimeString()} · {labels[item.reason]}</li>)}</ul></details>}
    {result.referenceRange ? <div className="mock-explanation"><h4>该套试卷提供的参考区间</h4><p>听力 {result.referenceRange.listening?.join('–') || '未提供'} · 阅读 {result.referenceRange.reading?.join('–') || '未提供'}</p><p>{result.referenceRange.source}</p><p>{result.referenceRange.disclaimer}</p></div> : <p className="mock-muted">本卷未提供有出处的分数换算表，只显示原始正确题数，不推算正式托业分数。</p>}
  </article>;
}

function ExamAudio({url, attempt, durableSubmitted, onPreflight, onInterruption, onRefresh, busy}: {
  url: string; attempt: ExamAttempt | null; durableSubmitted: boolean;
  onPreflight: (ready: boolean) => void; onInterruption: (reason: InterruptionReason) => Promise<void>;
  onRefresh: () => Promise<void>; busy: boolean;
}) {
  const audio = useRef<HTMLAudioElement | null>(null), mounted = useRef(false), generation = useRef(0);
  const latest = useRef({attempt, onInterruption, onRefresh}); latest.current = {attempt, onInterruption, onRefresh};
  const [duration, setDuration] = useState(0), [playable, setPlayable] = useState(false), [played, setPlayed] = useState(false);
  const [state, setState] = useState<'idle' | 'playing' | 'paused' | 'ended' | 'error'>('idle'), [error, setError] = useState('');
  const intentionalPause = useRef(false), controlledSeek = useRef(false), failureLogged = useRef(false);
  const wasPreflight = useRef(!attempt);
  const background = useRef(false), playbackWanted = useRef(false), stall = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function stop() { generation.current++; playbackWanted.current = false; intentionalPause.current = true; audio.current?.pause(); }
  async function recordFailure(reason: InterruptionReason, text: string) {
    if (!mounted.current) return;
    stop(); setState('error'); setError(text);
    if (!failureLogged.current && !inactive(latest.current.attempt)) {
      failureLogged.current = true;
      await latest.current.onInterruption(reason);
    }
  }
  async function playAligned() {
    const player = audio.current, snapshot = latest.current.attempt;
    if (!player || !snapshot || snapshot.status !== 'listening' || document.hidden || !isNativeForeground()) return;
    const ticket = ++generation.current;
    try {
      if (!Number.isFinite(player.duration) || player.duration <= 0) throw new Error('音频时长尚未读取，请重试加载。');
      const target = audioOffsetSeconds(snapshot, Date.now(), player.duration);
      if (Math.abs(player.currentTime - target) > 1) {
        await latest.current.onInterruption('audio-seek');
        if (!mounted.current || generation.current !== ticket) return;
        controlledSeek.current = true;
        player.currentTime = audioOffsetSeconds(snapshot, Date.now(), player.duration);
      }
      if (!mounted.current || generation.current !== ticket || latest.current.attempt?.status !== 'listening') return;
      if (player.currentTime >= player.duration - 0.05) {setState('ended'); return;}
      intentionalPause.current = false; playbackWanted.current = true; setError('');
      await player.play();
      if (!mounted.current || generation.current !== ticket || document.hidden || !isNativeForeground()) {player.pause(); return;}
      failureLogged.current = false; setState('playing');
    } catch (cause) {
      if (mounted.current && generation.current === ticket) await recordFailure('audio-failure', `音频未能播放：${message(cause)} 计时继续，请重试。`);
    }
  }
  const playRef = useRef(playAligned); playRef.current = playAligned;
  useEffect(() => {
    mounted.current = true;
    const detach = attachExamMedia(audio.current, url);
    return () => {mounted.current = false; stop(); clearTimeout(stall.current); detach();};
  }, [url]);
  useEffect(() => { onPreflight(!attempt && playable && played && Number.isFinite(duration) && duration > 0); }, [attempt, playable, played, duration, onPreflight]);
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
    <audio ref={audio} src={url || undefined} preload="metadata" controls={!attempt} controlsList="nodownload noplaybackrate" onLoadedMetadata={event => {
      const value = event.currentTarget.duration; setDuration(Number.isFinite(value) ? value : 0);
    }} onCanPlay={() => setPlayable(true)} onPlaying={() => {setPlayable(true); setPlayed(true); setState('playing'); clearTimeout(stall.current);}}
      onError={() => {setPlayable(false); void recordFailure('audio-failure', '音频无法解码或加载；请检查题包。考试计时不会暂停。').catch(ignore);}}
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
    <p>音频时长：{duration ? clockText(duration * 1000) : '读取中…'} · 听力计时固定 45:00</p>
    {!attempt && <p className="mock-muted">先点击播放器试听。{duration > 0 && Math.abs(duration * 1000 - LISTENING_MS) > 60_000 && '音频时长与 45 分钟明显不同，请先核对整卷材料是否完整。'}</p>}
    {attempt?.status === 'listening' && <><p role="status">{state === 'playing' ? '正在播放整场听力' : state === 'ended' ? '音频已结束；听力阶段按原截止时间结束。' : '音频当前未播放；倒计时继续。'}</p>
      {state !== 'playing' && state !== 'ended' && <div className="mock-actions"><button className="button secondary" disabled={busy} onClick={() => void playAligned().catch(ignore)}>按已用时间恢复听力</button>
        <button className="text-button" disabled={busy} onClick={() => {audio.current?.load(); setError('正在重新加载，请稍后点击恢复听力。');}}>重新加载音频</button></div>}</>}
    {attempt?.status === 'reading' && <p>听力阶段已结束，音频已停止；无法返回听力修改答案。</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
