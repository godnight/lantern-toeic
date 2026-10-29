'use client';
import {useEffect, useRef, useState} from 'react';
import type {Speaking} from '@/lib/study-model';
import {createId} from '@/lib/study-model';
import {createLocalAsrSession, localAsrAudioSupported, type LocalAsrScope,
  type LocalAsrSessionState} from '@/lib/local-asr-session';
import {LOCAL_ASR_BUNDLE_LIMITS, type LocalAsrBundle} from '@/lib/verify-local-asr-bundle';
import type {SpeakingFeedback} from '@/lib/speaking-feedback-contract';

const initialState: LocalAsrSessionState = {phase: 'idle', request: null, result: null,
  feedback: null, error: null, comparison: null};
function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function downloadJson(name: string, value: unknown) {download(name, new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));}

/** Offline exchange only; this component never uploads audio or starts a service. */
function EnabledOfflineSpeakingFeedback({prompt, recordingId, blob, saved, captureIssue, scope, previousFeedback, onFeedback}: {
  prompt: Speaking; recordingId: string; blob: Blob; saved: boolean; captureIssue: string;
  scope: LocalAsrScope; previousFeedback: SpeakingFeedback | null;
  onFeedback: (value: SpeakingFeedback | null) => void;
}) {
  const [state, setState] = useState(initialState);
  const [transcript, setTranscript] = useState(''); const [message, setMessage] = useState('');
  const [edited, setEdited] = useState(false);
  const session = useRef<ReturnType<typeof createLocalAsrSession> | null>(null);
  const makeSession = () => createLocalAsrSession({scope, createId, previousFeedback,
    onChange: next => {setState(next); onFeedback(next.feedback);}});
  if (!session.current) session.current = makeSession();
  useEffect(() => {
    // React StrictMode replays effects without replacing refs. Recreate the disposed lease.
    if (session.current?.isDisposed()) session.current = makeSession();
    const current = session.current;
    return () => {current?.dispose();};
  }, []);
  const id = `offline-asr-${recordingId}`;
  const formatSupported = localAsrAudioSupported(scope, blob);
  const makeJob = async () => {
    if (!saved) return;
    setMessage('');
    const job = await session.current!.createJob({recordingId, promptId: prompt.id, audio: blob,
      task: prompt.type === 'read-aloud' ? 'read-aloud' : 'free-response',
      ...(prompt.type === 'read-aloud' ? {referenceText: prompt.passage} : {}), audioReviewRequired: !!captureIssue});
    if (job) downloadJson('local-asr-request.json', job.request);
  };
  const importResult = async (files: File[]) => {
    if (!files.length) return; setMessage('');
    try {
      const bundle = {} as LocalAsrBundle;
      if (files.length !== 4) throw Error('IMPORT_FILES');
      for (const name of Object.keys(LOCAL_ASR_BUNDLE_LIMITS) as (keyof LocalAsrBundle)[]) {
        const matching = files.filter(file => file.name === `${name}.json`);
        if (matching.length !== 1 || matching[0].size > LOCAL_ASR_BUNDLE_LIMITS[name]) throw Error('IMPORT_FILES');
        bundle[name] = new Uint8Array(await matching[0].arrayBuffer());
      }
      const result = await session.current!.importBundle(bundle);
      setTranscript(result.transcript); setEdited(false);
    } catch {setMessage('结果与当前账号、录音、模型或任务不匹配，或文件格式不可读。当前录音和原反馈均保留。');}
  };
  const confirm = () => {
    try {session.current!.confirmTranscript(transcript); setEdited(false); setMessage('');}
    catch {setMessage('转写修订暂不可用，请保留原件并检查本次任务是否仍有效。');}
  };
  const cancel = () => {session.current!.cancel(); setTranscript(''); setEdited(false); setMessage('本次转写任务已取消，旧结果不能再导入当前任务。原录音保留。');};
  return <section className="speaking-text-feedback" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>本地转写与再练</h3>
    {!scope.offlineJobSupported ? <p className="speaking-notice" role="status">此设备暂不支持本地语音识别。录音仍可回听和保留；不会自动传到电脑或云端。</p> : <>
      <p className="speaking-caption">本机离线转写只处理你选择的本次录音。导出任务后，在同一台电脑完成识别，再导入对应结果；尚未导入时不算识别成功。</p>
      {!formatSupported && <p className="speaking-notice" role="status">当前本机 provider 尚不支持这段录音的格式，不能直接转写。原音频仍可回听和下载保留。</p>}
      <div className="speaking-action-stack"><button type="button" className="button secondary"
        disabled={!saved || !formatSupported || state.phase === 'hashing'} onClick={() => void makeJob()}>{state.phase === 'hashing' ? '核对音频身份…' : '导出本机转写任务'}</button>
        {state.request && <>
          <button type="button" className="button secondary" onClick={() => download(`local-asr-audio.${blob.type.includes('wav') ? 'wav' : blob.type.includes('mp4') ? 'm4a' : 'webm'}`, blob)}>下载本次转写音频</button>
          <label className="speaking-text-file" htmlFor={`${id}-result`}>导入本机转写结果（4个JSON）<input id={`${id}-result`} type="file" multiple accept="application/json,.json"
            onChange={event => {void importResult(Array.from(event.target.files || [])); event.target.value = '';}}/></label>
          <button type="button" className="button secondary" onClick={cancel}>取消本次转写任务</button>
        </>}
      </div>
    </>}
    {state.phase === 'waiting-result' && <p role="status">等待本机识别结果；当前录音保持不变。</p>}
    {(message || state.error) && <p className="speaking-notice error" role="alert">{message || '本地转写任务暂不可用，原录音保留。'}</p>}
    {state.feedback && <div className="speaking-notice" role="status">
      <strong>{state.feedback.status === 'ready' ? '本地转写练习建议' : state.feedback.status === 'needs-transcript-review' ? '请先回听核对转写' : '本次转写仍需处理'}</strong>
      {state.feedback.status === 'unsupported' && <p>本机 provider 不支持此模型，未完成识别。</p>}
      {state.feedback.status === 'failed' && <p>本次本地识别失败，原音频保持。可以重新导出任务。</p>}
      {state.feedback.status === 'cancelled' && <p>provider 已取消本次任务，没有生成有效转写。</p>}
      <details><summary>保留的原始转写</summary><p lang="en">{state.feedback.originalTranscript || '无原始转写'}</p></details>
      {state.result?.status === 'ok' && <>
        <label htmlFor={`${id}-transcript`}>回听后核对或修订转写</label>
        <textarea id={`${id}-transcript`} lang="en" value={transcript} rows={4} maxLength={20000} onChange={event => {setTranscript(event.target.value); setEdited(true);}}/>
        {edited && <p role="status">修订尚未确认，确认后更新练习建议。</p>}
        <button type="button" className="button secondary" onClick={confirm}>确认本轮转写，查看练习建议</button>
      </>}
      {!edited && state.feedback.observations.map((observation, index) => <div key={index}><p>{observation.observation}</p><p>{observation.suggestedAction}</p></div>)}
      {state.comparison && <details><summary>与上次同题文字对照</summary><p lang="en">上次：{state.comparison.previousTranscript}</p><p lang="en">本次：{state.comparison.nextTranscript}</p><p>文字对照不自动判定发音进步。</p></details>}
      <button type="button" className="button secondary" disabled={edited} onClick={() => downloadJson('speaking-feedback.json', session.current!.exportFeedback())}>下载本轮反馈</button>
      <p className="speaking-caption">转写原文与修订分别保留，不换算托业分数，也不评价音素、口音或重音。反馈保留在本页，可单独下载，尚未包含在学习记录备份中。</p>
    </div>}
  </section>;
}

/** A browser cannot discover a Python model; an explicit same-PC choice enables file exchange. */
export function OfflineSpeakingFeedback(props: Parameters<typeof EnabledOfflineSpeakingFeedback>[0]) {
  const [enabled,setEnabled]=useState(false);
  if(props.blob.type.split(';')[0].toLowerCase()==='audio/mp4')return <p className="speaking-caption" role="status">本机录音和回听可用；此格式暂不可用于当前口语识别。</p>;
  if(!props.scope.offlineJobSupported)return <EnabledOfflineSpeakingFeedback {...props}/>;
  return <section className="speaking-text-feedback">
    <label className="speaking-local-asr-optin"><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/>这台电脑已配置本地转写工具，使用离线文件交换</label>
    <p className="speaking-caption">在当前电脑导出并运行本地工具，再导入对应结果。录音不会自动发送到其他设备。</p>
    {enabled?<EnabledOfflineSpeakingFeedback {...props}/>:<p role="status">尚未启用本地转写。原录音可回放和保存。</p>}
  </section>;
}
