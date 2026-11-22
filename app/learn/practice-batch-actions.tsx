'use client';
import {useEffect,useId,useRef,useState} from 'react';
import './practice-batch-actions.css';

export type GroupView={id:string;index:number;count:number;status:'unstarted'|'active'|'completed';saved:number};
type Props={groups:readonly GroupView[];total:number;disabled:boolean;label:string;onOpen:(id:string)=>void;onHistory:(id:string)=>void};

export function PracticeBatchActions({groups,total,disabled,label,onOpen,onHistory}:Props){
 const [expanded,setExpanded]=useState(false),root=useRef<HTMLDivElement>(null),more=useRef<HTMLButtonElement>(null),listId=useId();
 const current=groups.find(group=>group.status==='active'&&group.saved>0)??groups.find(group=>group.status!=='completed');
 useEffect(()=>{
  if(!expanded)return;
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))setExpanded(false);};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setExpanded(false);more.current?.focus();}};
  document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
 },[expanded]);
 useEffect(()=>{if(disabled)setExpanded(false);},[disabled]);
 const primary=current?`${current.status==='active'?'继续':'开始'}第 ${current.index} 组`:'全部组已完成';
 const progress=(group:GroupView)=>group.status==='completed'?'已完成':group.status==='active'?`已答 ${group.saved} / ${group.count} 题`:'未开始';
 return <div className="practice-batch-actions" ref={root}>
  <p className="practice-batch-summary" aria-live="polite">共 {total} 题 · 分 {groups.length} 组{current?.status==='active'&&current.saved>0&&<small>第 {current.index} 组 · {progress(current)}</small>}</p>
  <div className="practice-batch-controls">
   <button data-task-primary type="button" className="button primary" disabled={disabled||!current} aria-label={`${label} · ${primary}`} onClick={()=>{if(current)onOpen(current.id);}}>{primary}</button>
   <button ref={more} type="button" className="text-button practice-batch-more" disabled={disabled||!groups.length} aria-label={`${label} · 更多`} aria-expanded={expanded} aria-controls={listId} onClick={()=>setExpanded(value=>!value)}>更多</button>
   {expanded&&<div id={listId} className="practice-batch-list" aria-label={`${label}分组`}>
    {groups.map(group=><button type="button" className="practice-batch-option" key={group.id} disabled={disabled} onClick={()=>{setExpanded(false);if(group.status==='completed')onHistory(group.id);else onOpen(group.id);}}><span><strong>第 {group.index} 组 · {group.count} 题</strong><small>{progress(group)}</small></span><span>{group.status==='completed'?'记录':group.status==='active'?'继续':'开始'}</span></button>)}
   </div>}
  </div>
 </div>;
}
