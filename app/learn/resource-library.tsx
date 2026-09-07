'use client';
import {useState} from 'react';
import {ArrowUpRight,BookOpen,Check,Clock,Headphones,NotebookPen} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {resources,type LearningResource} from '@/content/resources-v2';
import type {Checkin} from '@/lib/study-model';

const categories=[['all','全部'],['official','托业官方'],['listening','听力精听'],['reading','阅读积累'],['speaking','开口表达']];

export default function ResourceLibrary({checkins,onRecord}:{checkins:Checkin[];onRecord:(resource:LearningResource)=>void}){
 const [category,setCategory]=useState('all');
 const filtered=resources.filter(r=>category==='all'||r.category===category);
 return <section className="learning-library">
  <div className="section-heading resource-heading"><div><p className="eyebrow">FIND YOUR NEXT LESSON</p><h2>今天，用一份好材料</h2></div><span>{resources.length} 个精选入口</span></div>
  <p className="library-lead">官方样题熟悉考试，真实英语练精听与表达。每份材料都有一条能完成的小任务。</p>
  <Tabs value={category} onValueChange={setCategory}><TabsList className="resource-tabs">{categories.map(([id,label])=><TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}</TabsList></Tabs>
  <div className="resource-catalog">{filtered.map(r=>{
   const visits=checkins.filter(c=>c.note.includes(`[资源:${r.id}]`));
   return <article className="resource-card" key={r.id}>
    <div className="resource-card-top"><span className="resource-provider">{r.provider}</span><span><Clock size={14}/>{r.minutes} 分钟</span></div>
    <h3>{r.title}</h3><p className="resource-summary">{r.description}</p>
    <div className="resource-tags">{r.hasAudio&&<span><Headphones size={13}/>音频</span>}{r.hasTranscript&&<span><BookOpen size={13}/>文本</span>}{r.parts.length>0&&<span>Part {r.parts.join(' / ')}</span>}</div>
    <ol className="resource-steps">{r.steps.map((s,i)=><li key={s}><span>{String(i+1).padStart(2,'0')}</span>{s}</li>)}</ol>
    <p className="resource-access">{r.accessNote}</p>
    <div className="resource-card-actions"><a href={r.url} target="_blank" rel="noreferrer" className="button secondary">打开材料<ArrowUpRight size={16}/></a><button className="text-button" onClick={()=>onRecord(r)}><NotebookPen size={16}/>学完记一笔</button></div>
    {visits.length>0&&<p className="resource-completed"><Check size={14}/>已学习 {visits.length} 次 · {visits.reduce((n,c)=>n+c.minutes,0)} 分钟</p>}
   </article>;
  })}</div>
  <p className="library-footnote">外站材料在原网站使用；这里保存入口、学习步骤和你的记录。真人音频由各来源提供，应用内原创听力仍使用系统朗读。</p>
 </section>;
}
