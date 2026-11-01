'use client';
import {useEffect,useRef,useState} from 'react';
import {LearningAccessContext} from '@/lib/learning-access';
import {useStudy} from '@/lib/use-study';
import {useVocabulary} from '@/lib/use-vocabulary';
import {useVocabularyWorkflow} from '@/lib/use-vocabulary-workflow';
import {createStudyBackup} from '@/lib/study-backup';
import type {AccountAccess} from '@/lib/session-proof';

export function GuestDataRecovery({nativeMode,onBack}:{nativeMode:boolean;onBack:()=>void}){
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const [access]=useState<AccountAccess>(()=>({owner:null,epoch:0,canAccess:()=>alive.current,assertAccess:()=>alive.current}));
 return <LearningAccessContext.Provider value={access}><GuestExports nativeMode={nativeMode} onBack={onBack}/></LearningAccessContext.Provider>;
}
function GuestExports({nativeMode,onBack}:{nativeMode:boolean;onBack:()=>void}){
 const study=useStudy(null,false),words=useVocabulary(null,false),workflow=useVocabularyWorkflow({owner:null,nativeMode,identityReady:study.ready,timezone:study.data.profile.timezone,legacy:words});
 const [message,setMessage]=useState('');const alive=useRef(true);useEffect(()=>()=>{alive.current=false;},[]);
 const download=(name:string,value:unknown)=>{if(!alive.current)return;const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);setMessage('备份已生成，请确认文件保存完成。');};
 return <main className="workspace-account"><section className="panel" style={{padding:24,margin:20,display:'grid',gap:16}}><h1>旧本机数据与备份</h1><p>这里只读取原设备访客分区，不会把资料自动归入新账号。</p><p>学习JSON不含音频原件、词卡完整工作流或模考题包；词卡工作流另行备份。本机数据不会随新账号换机恢复，卸载、清数据或丢机可能无法找回。</p>
  <button className="button secondary" disabled={!study.ready||study.recordsReadable===false} onClick={()=>{try{download('lantern-guest-study.json',createStudyBackup(study.data));}catch{setMessage('学习备份未能生成，原数据保留。');}}}>导出原访客学习记录</button>
  <button className="button secondary" disabled={!words.ready||!!words.error} onClick={()=>{try{download('lantern-guest-vocabulary.json',words.backup());}catch{setMessage('词库备份未能生成，原数据保留。');}}}>导出原访客词库记录</button>
  <button className="button secondary" disabled={!workflow.ready} onClick={()=>{void workflow.exportWorkflow().then(value=>download('lantern-guest-workflow.json',value)).catch(()=>setMessage('工作流备份未能生成，原数据保留。'));}}>导出原访客工作流</button>
  <p>原录音与模考资料仍保存在原分区，不包含在以上两个JSON或工作流备份中；此入口不提供全量迁移。</p>{message&&<p role="status">{message}</p>}<button className="button primary" onClick={onBack}>返回账号入口</button>
 </section></main>;
}
