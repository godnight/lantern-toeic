'use client';

import {useState,type ReactNode} from 'react';
import {ArrowRight,BookOpen,Headphones,Mic,Clock} from 'lucide-react';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {practiceUnits} from '@/lib/practice-selection';
import {PARTS,type Question} from '@/lib/study-model';

type Props={questions:Question[];listening:Question[];busy:boolean;tab:string;onTab:(value:string)=>void;
 onStart:(items:Question[])=>unknown;onPart:(part:number)=>unknown;onCustom:(part:number|undefined,count:number)=>unknown;
 onWrong:(part:number|undefined,count:number)=>unknown;onListeningWrong:()=>unknown;onMock:()=>void;children:ReactNode};

/** Presentation and explicit selection only; all scheduling and writes stay in the parent. */
export function PracticeHome({questions,listening,busy,tab,onTab,onStart,onPart,onCustom,onWrong,onListeningWrong,onMock,children}:Props){
 const [collection,setCollection]=useState('listening50'),[part,setPart]=useState('all'),[target,setTarget]=useState('5'),[material,setMaterial]=useState('');
 const pool=collection==='listening50'?listening:questions.filter(q=>q.part<=4),units=practiceUnits(pool);
 return <div className="v041-practice-home">
  <Tabs value={tab} onValueChange={onTab}><TabsList className="main-tabs"><TabsTrigger value="lr"><Headphones size={17}/>听力与阅读</TabsTrigger><TabsTrigger value="speaking"><Mic size={17}/>口语</TabsTrigger></TabsList>
   <TabsContent value="lr"><section className="v041-section"><div className="section-heading"><h2>听力</h2><select aria-label="听力练习集合" value={collection} onChange={e=>{setCollection(e.target.value);setMaterial('');}}><option value="listening50">听力{listening.length}题</option><option value="all">全部听力</option></select></div>
    <div className="v041-task-rows">{[1,2,3,4].map(p=><button type="button" className="v041-task-row" key={p} disabled={busy} onClick={()=>onStart(pool.filter(q=>q.part===p))}><Headphones size={21}/><span><b>Part {p} · {PARTS[p-1]}</b></span><small>{pool.filter(q=>q.part===p).length} 题</small><ArrowRight size={18}/></button>)}</div>
    <details className="v041-secondary-tools"><summary>按材料选择</summary><div className="field"><label htmlFor="practice-material">材料</label><select id="practice-material" value={material||units[0]?.id||''} onChange={e=>setMaterial(e.target.value)}>{units.map((unit,i)=><option key={unit.id} value={unit.id}>{i+1}. Part {unit.part} · {unit.questions[0].title}</option>)}</select></div><div className="button-row"><button type="button" className="button secondary" disabled={busy||!units.length} onClick={()=>onStart(units.find(unit=>unit.id===(material||units[0]?.id))?.questions||[])}>开始这段材料</button>{collection==='listening50'&&<button type="button" className="text-button" disabled={busy} onClick={onListeningWrong}>练本集合错题</button>}</div></details>
   </section><section className="v041-section"><h2>阅读</h2><div className="v041-task-rows">{[5,6,7].map(p=><button type="button" className="v041-task-row" key={p} disabled={busy} onClick={()=>onPart(p)}><BookOpen size={21}/><span><b>Part {p} · {PARTS[p-1]}</b></span><small>{questions.filter(q=>q.part===p).length} 题</small><ArrowRight size={18}/></button>)}</div></section>
   <section className="v041-section"><button className="v041-task-row" type="button" onClick={onMock}><Clock size={21}/><span><b>完整听读模考</b><small>题包与考试记录</small></span><ArrowRight size={18}/></button></section>
   <details className="v041-secondary-tools"><summary>自选题数与错题</summary><form onSubmit={e=>{e.preventDefault();onCustom(part==='all'?undefined:Number(part),Number(target));}}><div className="practice-config"><label className="field">专项<select value={part} onChange={e=>setPart(e.target.value)}><option value="all">所有 Part</option>{PARTS.map((label,i)=><option key={label} value={i+1}>Part {i+1} · {label}</option>)}</select></label><label className="field">目标题数<input type="number" required min="1" max="200" value={target} onChange={e=>setTarget(e.target.value)}/></label></div><div className="button-row"><button className="button secondary" disabled={busy} type="submit">开始练习</button><button className="text-button" disabled={busy} type="button" onClick={()=>onWrong(part==='all'?undefined:Number(part),Number(target))}>练当前错题</button><button className="text-button" disabled={busy} type="button" onClick={()=>questions.length>200?onCustom(undefined,200):onStart(questions)}>综合练习</button></div></form></details>
   </TabsContent><TabsContent value="speaking">{children}</TabsContent></Tabs>
 </div>;
}
