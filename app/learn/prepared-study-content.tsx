'use client';
import {useEffect,useState,type ComponentType} from 'react';
import {prepareVocabularyCatalog} from '@/lib/prepare-vocabulary-catalog';

/** Only an active consumer may mount the fully prepared module. The shared
 * content promise contains no owner data; expired/old consumers cannot commit. */
export function PreparedStudyContent<P extends object>({loader,componentProps,current,onBack}:{loader:()=>Promise<ComponentType<P>>;componentProps:P;current:()=>boolean;onBack?:()=>void}){
 const [view,setView]=useState<{component:ComponentType<P>|null;error:boolean}>({component:null,error:false});
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let live=true;
  if(!current())return()=>{live=false;};
  void prepareVocabularyCatalog(attempt>0).then(()=>live&&current()?loader():null).then(component=>{
   if(component&&live&&current())setView({component,error:false});
  },()=>{if(live&&current())setView({component:null,error:true});});
  return()=>{live=false;};
 },[loader,current,attempt]);
 if(view.component&&current()){const Content=view.component;return <Content {...componentProps}/>;}
 return <main className="workspace"><section className="panel" aria-live="polite"><h1>{view.error?'学习内容暂未准备好':'准备学习内容'}</h1><p>{view.error?'词表核验暂未完成，已保存的学习记录会保留。':'正在核验随包词表，完成后即可继续。'}</p>{view.error&&<button className="button primary" onClick={()=>{setView({component:null,error:false});setAttempt(value=>value+1);}}>重新准备</button>}{onBack&&<button className="button secondary" onClick={onBack}>返回账号入口</button>}</section></main>;
}
