'use client';
import {useState} from 'react';
import {ArrowUpRight,FileDown,NotebookPen} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import catalogue from '@/content/exams/catalogue.json';
import type {Checkin} from '@/lib/study-model';

const filters=[['past','公开实际考题'],['pdf','官方 PDF'],['sample','官方样题'],['prep','备考材料'],['all','全部']];
const categoryLabel=(category:string)=>category==='official-past-paper'?'实际考题选题':category==='official-sample'?'官方样题':'官方备考';

export default function ExamCollection({checkins,onRecord}:{checkins:Checkin[];onRecord:(r:{id:string;title:string;minutes:number})=>void}){
 const [filter,setFilter]=useState('past');
 const entries=catalogue.filter(r=>filter==='all'||(filter==='past'&&r.category==='official-past-paper')||(filter==='pdf'&&!!r.downloadUrl)||(filter==='sample'&&r.category==='official-sample')||(filter==='prep'&&r.category==='official-preparation'));
 return <section className="learning-library exam-collection">
  <div className="section-heading resource-heading"><div><p className="eyebrow">OFFICIAL EXAM COLLECTION</p><h2>真题与官方考试资料</h2></div><span>{catalogue.length} 个官方入口</span></div>
  <p className="library-lead">实际考题目前为韩国官方公开的选题视频。PDF 区提供官方样题和手册；本集合没有标称完整历年试卷的下载包。</p>
  <Tabs value={filter} onValueChange={setFilter}><TabsList className="resource-tabs">{filters.map(([id,label])=><TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}</TabsList></Tabs>
  <div className="resource-catalog">{entries.map(r=>{
   const id='exam-'+r.id;const visits=checkins.filter(c=>c.note.includes(`[资源:${id}]`));
   return <article className="resource-card" key={r.id}>
    <div className="resource-card-top"><span className="resource-provider">{r.provider}</span><span>{r.access==='paid'?'正版付费':'免费入口'}</span></div>
    <h3>{r.title}</h3><p className="resource-summary">{r.description}</p>
    <div className="resource-tags"><span>{categoryLabel(r.category)}</span>{r.downloadUrl&&<span>PDF</span>}<span>{r.language}</span></div>
    <ol className="resource-steps">{r.usageSteps.map((step,i)=><li key={step}><span>{String(i+1).padStart(2,'0')}</span>{step}</li>)}</ol>
    <p className="resource-access">{r.accessNote}</p>
    <div className="resource-card-actions"><a className="button secondary" href={r.landingUrl} target="_blank" rel="noreferrer">官方入口<ArrowUpRight size={16}/></a>{r.downloadUrl&&<a className="button secondary" href={r.downloadUrl} target="_blank" rel="noreferrer">官方 PDF<FileDown size={16}/></a>}<button className="text-button" onClick={()=>onRecord({id,title:r.title,minutes:10})}><NotebookPen size={16}/>学完记一笔</button></div>
    <p className="small muted">链接核验 {r.verifiedAt}{visits.length?` · 已记录 ${visits.length} 次学习`:''}</p>
   </article>;
  })}</div>
  <p className="library-footnote">PDF 在官方页面打开后可按浏览器功能保存。音视频在原站使用；播放能力、地区访问和转载权限分别核验。</p>
 </section>;
}
