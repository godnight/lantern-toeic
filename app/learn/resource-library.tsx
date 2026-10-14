'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ArrowUpRight,BookOpen,Check,ChevronRight,Clock,Headphones,Info,NotebookPen} from 'lucide-react';
import {resources,type LearningResource} from '@/content/resources-v2';
import {registerNativeBack} from '@/lib/native-host';
import type {Checkin} from '@/lib/study-model';

const categories=[['all','全部'],['official','托业官方'],['listening','听力精听'],['reading','阅读积累'],['speaking','开口表达']] as const;

type ResourceLibraryProps={
 checkins:Checkin[];
 onRecord:(resource:LearningResource)=>void;
 checkinOpen?:boolean;
 recordsReady?:boolean;
 onDetailChange?:(open:boolean)=>void;
};

export default function ResourceLibrary({checkins,onRecord,checkinOpen=false,recordsReady=true,onDetailChange}:ResourceLibraryProps){
 const [category,setCategory]=useState('all');
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const listPosition=useRef({scroll:0,id:''});
 const restoreList=useRef(false);
 const detailTitle=useRef<HTMLHeadingElement>(null);
 const itemButtons=useRef(new Map<string,HTMLButtonElement>());
 const selected=resources.find(resource=>resource.id===selectedId);
 useEffect(()=>{onDetailChange?.(!!selectedId);return()=>onDetailChange?.(false);},[selectedId,onDetailChange]);
 const filtered=resources.filter(resource=>category==='all'||resource.category===category);
 const records=useMemo(()=>new Map(resources.map(resource=>{
  const visits=checkins.filter(checkin=>checkin.note.includes(`[资源:${resource.id}]`));
  return [resource.id,{count:visits.length,minutes:visits.reduce((total,checkin)=>total+checkin.minutes,0)}] as const;
 })),[checkins]);

 const openDetail=(resource:LearningResource)=>{
  listPosition.current={scroll:window.scrollY,id:resource.id};
  restoreList.current=false;
  setSelectedId(resource.id);
 };
 const closeDetail=()=>{
  if(checkinOpen)return;
  restoreList.current=true;
  setSelectedId(null);
 };
 useEffect(()=>{
  if(selectedId){window.scrollTo({top:0,behavior:'auto'});detailTitle.current?.focus({preventScroll:true});return;}
  if(restoreList.current){
   restoreList.current=false;
   const restore=()=>{window.scrollTo({top:listPosition.current.scroll,behavior:'auto'});itemButtons.current.get(listPosition.current.id)?.focus({preventScroll:true});};
   if(typeof requestAnimationFrame==='function'){const frame=requestAnimationFrame(restore);return()=>cancelAnimationFrame(frame);}
   restore();
  }
 },[selectedId]);
 useEffect(()=>registerNativeBack(()=>{
  if(!selectedId||checkinOpen)return false;
  closeDetail();
  return true;
 },20),[selectedId,checkinOpen]);

 const summary=(resource:LearningResource)=>{
  if(!recordsReady)return <span className="rs-record-status" role="status">正在读取学习记录…</span>;
  const saved=records.get(resource.id)!;
  return saved.count>0?<span className="rs-record-status"><Check size={15} aria-hidden="true"/>已学习 {saved.count} 次 · {saved.minutes} 分钟</span>:<span className="rs-record-status">尚未记录这份材料的学习</span>;
 };

 if(selected)return <section className="resource-redesign rs-detail" aria-labelledby="resource-detail-title">
  <button type="button" className="rs-back" onClick={closeDetail} disabled={checkinOpen}><ArrowLeft size={18} aria-hidden="true"/>返回资料列表</button>
  <header className="rs-detail-heading">
   <span className="rs-provider" lang="en">{selected.provider}</span>
   <h2 id="resource-detail-title" ref={detailTitle} tabIndex={-1}>{selected.title}</h2>
   <p>{selected.description}</p>
   <div className="rs-metadata"><span><Clock size={16} aria-hidden="true"/>建议学习 {selected.minutes} 分钟</span>{selected.hasAudio&&<span><Headphones size={16} aria-hidden="true"/>有音频</span>}{selected.hasTranscript&&<span><BookOpen size={16} aria-hidden="true"/>有对照文本</span>}{selected.parts.length>0&&<span>Part {selected.parts.join(' / ')}</span>}</div>
  </header>
  <div className="rs-detail-grid">
   <div className="rs-reading">
    <section className="rs-panel" aria-labelledby="resource-steps-title">
     <h3 id="resource-steps-title">按这几步完成</h3>
     <ol className="rs-steps">{selected.steps.map((step,index)=><li key={step}><span className="rs-step-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span><p>{step}</p></li>)}</ol>
    </section>
    <section className="rs-access" aria-labelledby="resource-access-title"><Info size={18} aria-hidden="true"/><div><h3 id="resource-access-title">访问这份材料</h3><p>{selected.accessNote}</p></div></section>
    <section className="rs-source" aria-labelledby="resource-source-title"><h3 id="resource-source-title">来源与使用说明</h3><p>{selected.licenseNote}</p><a href={selected.licenseUrl} target="_blank" rel="noopener noreferrer">查看来源的使用说明<ArrowUpRight size={15} aria-hidden="true"/><span className="sr-only">（在新窗口打开）</span></a></section>
   </div>
   <aside className="rs-panel rs-learning" aria-labelledby="resource-learning-title">
    <h3 id="resource-learning-title">完成这一小步</h3>
    <p>先在原网站使用材料，学完后记下实际用时。</p>
    <a className="rs-action rs-primary" href={selected.url} target="_blank" rel="noopener noreferrer">打开材料<ArrowUpRight size={17} aria-hidden="true"/><span className="sr-only">（在新窗口打开）</span></a>
    <button type="button" className="rs-action rs-secondary" disabled={!recordsReady||checkinOpen} onClick={()=>{if(recordsReady&&!checkinOpen)onRecord(selected);}}><NotebookPen size={17} aria-hidden="true"/>学完记一笔</button>
    <p className="rs-action-help">打开材料不会自动记录学习。按你实际完成的分钟打卡即可。</p>
    <div className="rs-saved-summary">{summary(selected)}</div>
   </aside>
  </div>
 </section>;

 return <section className="resource-redesign" aria-labelledby="resource-library-title">
  <header className="rs-library-heading"><div><h2 id="resource-library-title">学习资料</h2><p>选一份材料，按步骤完成，再记录实际学习。</p></div><span>{resources.length} 个材料入口</span></header>
  <div className="rs-filters" role="group" aria-label="按技能筛选资料">{categories.map(([id,label])=><button type="button" key={id} data-resource-category={id} aria-pressed={category===id} aria-controls="resource-list" onClick={()=>setCategory(id)}>{label}</button>)}</div>
  <div className="rs-list-summary" role="status">{category==='all'?`全部 ${filtered.length} 份材料`:`${categories.find(([id])=>id===category)?.[1]} · ${filtered.length} 份材料`}</div>
  <div id="resource-list" className="rs-resource-list">{filtered.length?filtered.map(resource=><article className="rs-resource-row" key={resource.id}>
   <button type="button" className="rs-item-button" data-resource-id={resource.id} ref={element=>{if(element)itemButtons.current.set(resource.id,element);else itemButtons.current.delete(resource.id);}} onClick={()=>openDetail(resource)}>
    <span className="rs-item-symbol" aria-hidden="true">{resource.hasAudio?<Headphones size={21}/>:<BookOpen size={21}/>}</span>
    <span className="rs-item-copy"><span className="rs-item-provider" lang="en">{resource.provider}</span><span className="rs-item-title">{resource.title}</span><span className="rs-item-description">{resource.description}</span><span className="rs-item-meta">建议 {resource.minutes} 分钟{resource.parts.length>0?` · Part ${resource.parts.join(' / ')}`:''}</span></span>
    <ChevronRight size={20} className="rs-item-arrow" aria-hidden="true"/>
   </button>
   {recordsReady&&records.get(resource.id)!.count>0&&<div className="rs-row-records">{summary(resource)}</div>}
  </article>):<div className="rs-empty"><BookOpen size={27} aria-hidden="true"/><h3>这个分类暂时没有材料</h3><p>可以切换到其他技能，或查看全部资料。</p><button type="button" className="rs-action rs-secondary" onClick={()=>setCategory('all')}>查看全部资料</button></div>}</div>
  <p className="rs-library-note">材料在原网站使用；这里保留入口、学习步骤和你的学习记录。资料建议用时与音频时长分别计算。</p>
 </section>;
}
