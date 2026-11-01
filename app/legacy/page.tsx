import {env} from 'cloudflare:workers';
import {requireSitesLegacyOwner} from '@/lib/sites-legacy-identity';
import {legacySummary,legacyReadPage,type LegacyTable} from '@/lib/sites-legacy-readonly';
export const dynamic='force-dynamic';
const labels:Record<LegacyTable,string>={profiles:'个人设置',attempts:'答题记录',checkins:'打卡记录',recordings:'录音记录',question_marks:'题目标记',resource_tasks:'资料任务',vocabulary_events:'单词记录',exam_library:'个人题包'};
function title(row:Record<string,unknown>){try{const value=JSON.parse(String(row.manifest));return typeof value.title==='string'?value.title:'旧版题包';}catch{return '旧版题包';}}
export default async function LegacyPage(){
 const owner=await requireSitesLegacyOwner();
 let data;try{if(!env.DB)throw new Error();data={counts:await legacySummary(env.DB,owner),exams:await legacyReadPage(env.DB,owner,'exam_library'),recordings:await legacyReadPage(env.DB,owner,'recordings')};}catch{return <main className="workspace"><div className="page-content"><h1>旧版记录</h1><p role="status">旧版记录暂时无法读取，请稍后重试。</p><a href="/account">返回账号</a></div></main>;}
 return <main className="workspace"><div className="page-content" style={{maxWidth:760,overflowWrap:'anywhere'}}>
  <header className="page-heading"><h1>旧版记录</h1><a className="text-button" href="/account">返回账号</a></header>
  <p>这里保留原 Sites 账号的记录，可查看和导出。新版账号的学习记录单独保存。</p>
  <dl>{(Object.keys(labels) as LegacyTable[]).map(table=><div key={table}><dt>{labels[table]}</dt><dd>{data.counts[table]}</dd></div>)}</dl>
  <p><a className="text-button" href="/api/legacy/export" download>导出旧版全部记录</a></p>
  <p>导出文件为 NDJSON；只有文件末行包含 complete: true 时才是完整导出。题包和录音需分别下载。</p>
  <h2>旧版个人题包</h2>
  {data.exams.rows.length?<ul>{data.exams.rows.map(row=><li key={String(row.id)}>{title(row)} · {row.state==='ready'?<a href={`/api/legacy/exam-library?id=${encodeURIComponent(String(row.id))}`} download>下载题包</a>:<span>原记录状态：{String(row.state)}</span>}</li>)}</ul>:<p>暂无旧版题包。</p>}
  {data.exams.nextCursor&&<p><a href={`/api/legacy/exam-library?after=${encodeURIComponent(data.exams.nextCursor)}`}>查看后续题包记录</a></p>}
  {data.recordings.rows.length>0&&<><h2>旧版录音</h2><ul>{data.recordings.rows.map(row=><li key={String(row.id)}><a href={`/api/legacy/recordings?id=${encodeURIComponent(String(row.id))}`} download>下载录音 · {String(row.created_at)}</a></li>)}</ul></>}
 </div></main>;
}
