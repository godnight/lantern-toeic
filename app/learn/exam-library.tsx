'use client';
import {useEffect, useRef, useState} from 'react';
import {EXAM_LIBRARY_URL, checkedLibraryDownload, prepareLibraryFile, type LibraryItem} from '@/lib/exam-library';
import {getExamProfile} from '@/lib/exam-model';

export default function ExamLibrary({ownerId, onImport, disabled}: {ownerId:string; onImport:(text:string)=>Promise<void>; disabled:boolean}) {
  const [items, setItems] = useState<LibraryItem[]>([]), [loaded, setLoaded] = useState(false);
  const [native, setNative] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [remove, setRemove] = useState<string|null>(null);
  const input = useRef<HTMLInputElement|null>(null), alive = useRef(false), locked = useRef(false), controller = useRef<AbortController|null>(null);
  useEffect(() => {alive.current=true; setNative(window.location.origin==='https://lantern.local'); return () => {alive.current=false;controller.current?.abort();};}, []);
  const headers = {'x-lantern-owner':ownerId};
  async function json(response:Response) {
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('请在网页中登录后打开个人题包库');
    const data = await response.json() as {error?:string; items?:LibraryItem[]}; if (!response.ok) throw new Error(data.error || '个人题包库暂不可用'); return data;
  }
  function active() {if (!alive.current || controller.current?.signal.aborted) throw new Error('页面已关闭，操作已取消');}
  async function list(signal:AbortSignal) {
    const data = await json(await fetch('/api/exam-library', {headers,signal,cache:'no-store'}));
    if (!Array.isArray(data.items)) throw new Error('题包目录响应无效，请重试');
    active(); setItems(data.items); setLoaded(true);
  }
  async function run(work:(signal:AbortSignal)=>Promise<void>) {
    if (locked.current || disabled) return;
    locked.current=true; setBusy(true); setError(''); setNotice(''); controller.current=new AbortController();
    try {await work(controller.current.signal);} catch(cause) {if(alive.current)setError(cause instanceof Error?cause.message:'操作未完成');}
    finally {locked.current=false; if(alive.current)setBusy(false);}
  }
  async function upload(files:File[], signal:AbortSignal) {
    let completed=0;
    for(const file of files) {
      active(); setNotice(`正在校验并上传 ${file.name}（${completed+1}/${files.length}）…`);
      const manifest=await prepareLibraryFile(file); active();
      await json(await fetch('/api/exam-library', {method:'POST',headers:{...headers,'Content-Type':'application/json','x-exam-manifest':encodeURIComponent(JSON.stringify(manifest))},body:file,signal}));
      completed++;
    }
    await list(signal); setNotice(`已保存 ${completed} 份个人题包，可在其他设备登录后下载。`);
  }
  return <section className="panel mock-library" aria-label="个人题包库">
    <div className="mock-library-heading"><div><p className="eyebrow">YOUR EXAM LIBRARY</p><h3>个人题包库</h3></div><span className="mock-library-tag">按需下载 · 离线作答</span></div>
    {native ? <><p>在手机浏览器登录网页版，下载个人题包，再回到这里选择“导入题包 JSON”。导入后断网也能考试。</p>
      <a className="button secondary" href={EXAM_LIBRARY_URL}>在浏览器打开个人题包库</a><p className="mock-muted">目前通过浏览器登录下载；不直接读取百度网盘，App 内尚未接入云端账号认证。</p></> : <>
      <p>题包存入当前账号的私人空间，换设备后可以取回。考试记录仍保存在作答设备，备份请使用“导出完整备份”。</p>
      <div className="mock-actions"><button className="button secondary" disabled={busy||disabled} onClick={()=>void run(list)}>{loaded?'刷新个人题包库':'加载个人题包库'}</button>
        <button className="button secondary" disabled={busy||disabled} onClick={()=>input.current?.click()}>上传整理好的题包</button></div>
      <input hidden ref={input} type="file" multiple accept="application/json,.json" aria-label="上传个人题包 JSON" onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';if(files.length)void run(signal=>upload(files,signal));}}/>
      <p className="mock-muted">最多 32 份 / 2 GiB；每份不超过 96 MiB。本机最多保存 192 MiB。上传的是完整题包 JSON，原始 PDF / MP3 需先整理。</p>
      {error&&<p role="alert" className="mock-alert">{error}；原文件和本机记录仍保留。可刷新目录核对已完成的上传。</p>}
      <p role="status" aria-live="polite">{busy?notice||'正在读取个人题包库…':notice}</p>
      {loaded&&!items.length&&<p className="mock-muted">个人题包库还是空的。上传一次，以后可在其他设备下载。</p>}
      <div className="mock-library-list">{items.map(item=><article key={item.id} className="mock-library-item">
        <h4>{item.title}</h4><p className="mock-muted">{getExamProfile(item.format).label} · {(item.bytes/1024/1024).toFixed(1)} MiB · 版本 {item.version}</p>
        {item.state==='ready'?<div className="mock-actions"><button className="button primary" disabled={busy||disabled} onClick={()=>void run(async signal=>{
          setNotice('正在下载并核对题包…'); const response=await fetch(`/api/exam-library?id=${item.id}`,{headers,signal,cache:'no-store'});
          const text=await checkedLibraryDownload(response,item); active(); await onImport(text); active();setNotice('已校验并保存到本机题包，可以开始音频预检。');
        })}>下载到本机题包</button><a className="button secondary" href={`/api/exam-library?id=${item.id}`} download>下载 JSON 文件</a></div>:<p>{item.state==='deleting'?'上次移除尚未完成，可重试。':'上传尚未完成；若已经中断，可取消后重新上传。'}</p>}
        {remove===item.id?<div className="mock-actions"><span>只移除云端文件，本机题包和成绩保留。</span><button className="button secondary" disabled={busy||disabled} onClick={()=>void run(async signal=>{await json(await fetch(`/api/exam-library?id=${item.id}`,{method:'DELETE',headers,signal}));active();setRemove(null);await list(signal);setNotice('已移除云端题包。');})}>确认移除云端文件</button><button className="text-button" onClick={()=>setRemove(null)}>取消</button></div>:<button className="text-button" disabled={busy||disabled} onClick={()=>setRemove(item.id)}>{item.state==='ready'?'移除云端文件':'取消未完成操作'}</button>}
      </article>)}</div>
    </>}
  </section>;
}
