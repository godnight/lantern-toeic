'use client';
import {useEffect,useState,type ComponentType} from 'react';
import {prepareStudyContent} from '@/lib/prepare-study-content';

/** Only an active consumer may mount the fully prepared module. The shared
 * content promise contains no owner data; expired/old consumers cannot commit. */
export function PreparedStudyContent<P extends object>({loader,componentProps,current,onBack,prepare=prepareStudyContent}:{loader:()=>Promise<ComponentType<P>>;componentProps:P;current:()=>boolean;onBack?:()=>void;prepare?:(retry?:boolean)=>Promise<void>}){
 const [view,setView]=useState<{component:ComponentType<P>|null;error:boolean}>({component:null,error:false});
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let live=true;
  if(!current())return()=>{live=false;};
  void prepare(attempt>0).then(()=>live&&current()?loader():null).then(component=>{
   if(component&&live&&current())setView({component,error:false});
  },()=>{if(live&&current())setView({component:null,error:true});});
  return()=>{live=false;};
 },[loader,current,attempt,prepare]);
 if(view.component&&current()){const Content=view.component;return <Content {...componentProps}/>;}
 return <main className="workspace" style={{padding:'24px 18px'}}><section className="panel" aria-live="polite"><h1>{view.error?'暂时无法加载学习内容':'正在准备学习内容…'}</h1>{view.error&&<p>已保存的学习记录会保留。</p>}{view.error&&<button className="button primary" onClick={()=>{setView({component:null,error:false});setAttempt(value=>value+1);}}>重试</button>}{onBack&&<button className="button secondary" onClick={onBack}>返回账号入口</button>}</section></main>;
}
