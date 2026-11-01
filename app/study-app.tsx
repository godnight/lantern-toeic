'use client';
import {useState,useEffect} from 'react';
import {useProductSession} from '@/lib/use-product-session';
import {LearningAccessContext,useLearningAccess} from '@/lib/learning-access';
import type {AccountAccess} from '@/lib/session-proof';
import {GuestDataRecovery} from './learn/guest-data-recovery';
import AccountForm from './account/account-form';
import {PublicInfoLinks} from './learn/legal-pages';
import {applyDocumentTheme} from '@/lib/ui-theme';
import {hasSpeakingRecovery} from '@/lib/speaking-recovery';
import {PreparedStudyContent} from './learn/prepared-study-content';
const loadWorkspace=()=>import('./study-workspace').then(module=>module.StudyWorkspace);
export type StudyWorkspaceProps={owner:string|null;nativeMode?:boolean;onAccount?:()=>void;legacyAvailable?:boolean;remoteLearningEnabled?:boolean};
export default function StudyApp({owner,nativeMode=false,onAccount,legacyAvailable=false,access:externalAccess,remoteLearningEnabled=false}:{owner:string|null;nativeMode?:boolean;onAccount?:()=>void;accountAvailable?:boolean;legacyAvailable?:boolean;access?:AccountAccess;remoteLearningEnabled?:boolean}){
 const session=useProductSession(owner,nativeMode,owner!==null),[recover,setRecover]=useState(false);
 useEffect(()=>{if(!document.documentElement.dataset.uiTheme)applyDocumentTheme('paper');},[]);
 if(recover)return <GuestDataRecovery nativeMode={nativeMode} onBack={()=>setRecover(false)}/>;
 if(!owner)return <><AccountForm/><button className="button secondary" style={{margin:24}} onClick={()=>setRecover(true)}>查看旧本机数据与备份</button></>;
 const access=nativeMode?externalAccess:session.access;
 const allowed=session.status==='ready'&&access?.owner===owner&&access.canAccess();
 const guard=(event:{preventDefault:()=>void;stopPropagation:()=>void})=>{if(!access?.assertAccess()){event.preventDefault();event.stopPropagation();}};
 return <><SpeakingRecoveryGuard/>{allowed&&access?<LearningAccessContext.Provider value={access}><section style={{display:'contents'}} onPointerDownCapture={guard} onClickCapture={guard} onKeyDownCapture={guard} onSubmitCapture={guard} onInputCapture={guard}><StudyWorkspace key={JSON.stringify([nativeMode,owner,access.epoch])} owner={owner} nativeMode={nativeMode} onAccount={onAccount} legacyAvailable={legacyAvailable} remoteLearningEnabled={remoteLearningEnabled}/></section></LearningAccessContext.Provider>:<main className="workspace"><section className="panel" aria-live="polite"><h1>核对账号状态</h1><p>{session.status==='checking'?'正在确认账号，请稍候。':'暂时无法确认账号，已保存的学习记录会保留。'}</p><button className="button primary" onClick={()=>nativeMode?onAccount?.():session.recheck()}>重新核对账号</button><PublicInfoLinks compact/></section></main>}</>;
}
export function SpeakingRecoveryGuard(){
 useEffect(()=>{const protect=(event:BeforeUnloadEvent)=>{if(hasSpeakingRecovery()){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);},[]);
 return null;
}
export function StudyWorkspace(props:StudyWorkspaceProps){
 const current=useLearningAccess(props.owner,true);
 return <PreparedStudyContent loader={loadWorkspace} componentProps={props} current={current}/>;
}
