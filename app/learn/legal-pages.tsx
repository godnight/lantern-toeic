'use client';

import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {ArrowLeft,ChevronRight,Copy,Mail,ShieldCheck,FileText} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {registerNativeBack} from '@/lib/native-host';
import privacy from '@/content/legal/privacy.json';
import terms from '@/content/legal/terms.json';
import './legal-pages.css';

export type PublicInfoKind='privacy'|'terms'|'support';
export const SUPPORT_EMAIL='zzl1414179@qq.com';
export const SUPPORT_MAILTO=`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('微光托业问题反馈')}`;
const TITLES:Record<PublicInfoKind,string>={privacy:'隐私政策',terms:'用户协议',support:'联系客服'};
const LINK_ICONS={privacy:ShieldCheck,terms:FileText,support:Mail};
const isKind=(value:unknown):value is PublicInfoKind=>value==='privacy'||value==='terms'||value==='support';
const PublicInfoContext=createContext<((kind:PublicInfoKind)=>void)|null>(null);
type Marker={token:string;kind:PublicInfoKind};
const marker=(state:unknown):Marker|null=>{
  if(!state||typeof state!=='object')return null;
  const value=(state as {lanternPublicInfo?:unknown}).lanternPublicInfo;
  if(!value||typeof value!=='object')return null;
  const item=value as Partial<Marker>;
  return typeof item.token==='string'&&/^public-info-[A-Za-z0-9-]{8,120}$/.test(item.token)&&isKind(item.kind)?{token:item.token,kind:item.kind}:null;
};
const newToken=()=>`public-info-${typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}`;

/** Keep this provider outside identity/loading branches; children stay mounted. */
export function PublicInfoBoundary({children}:{children:ReactNode}){
  const [kind,setKind]=useState<PublicInfoKind|null>(null);
  const current=useRef<PublicInfoKind|null>(null),token=useRef(''),pendingBack=useRef(false);
  const focusBefore=useRef<HTMLElement|null>(null),reader=useRef<HTMLDivElement|null>(null);
  const present=useCallback((value:PublicInfoKind|null)=>{current.current=value;setKind(value);},[]);
  const open=useCallback((value:PublicInfoKind)=>{
    if(current.current===value||pendingBack.current)return;
    window.dispatchEvent(new Event('lantern-stop-lesson-audio'));
    document.querySelectorAll<HTMLMediaElement>('audio,video').forEach(media=>media.pause());
    if(!current.current)focusBefore.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    if(!token.current)token.current=newToken();
    try{window.history.pushState({...window.history.state,lanternPublicInfo:{token:token.current,kind:value}},'');}catch{/* Public reading still works when history is unavailable. */}
    present(value);
  },[present]);
  const back=useCallback(()=>{
    if(!current.current||pendingBack.current)return;
    const entry=marker(window.history.state);
    if(entry?.token===token.current&&window.history.length>1){pendingBack.current=true;window.history.back();return;}
    if(entry?.token===token.current){const state={...window.history.state};delete state.lanternPublicInfo;try{window.history.replaceState(state,'');}catch{/* Closing must remain available. */}}
    present(null);
  },[present]);
  // Register before child passive listeners: popstate targets window itself,
  // so its earlier listeners can otherwise react before this overlay consumes it.
  useLayoutEffect(()=>{
    const existing=marker(window.history.state);
    if(existing){token.current=existing.token;present(existing.kind);}
    const pop=(event:PopStateEvent)=>{
      const entry=marker(event.state),owned=entry?.token===token.current;
      if(owned||current.current){event.stopImmediatePropagation();pendingBack.current=false;present(owned?entry!.kind:null);}
    };
    window.addEventListener('popstate',pop,true);
    const unregister=registerNativeBack(()=>{if(!current.current&&!pendingBack.current)return false;back();return true;},200);
    return()=>{window.removeEventListener('popstate',pop,true);unregister();};
  },[back,present]);
  useEffect(()=>{if(kind&&reader.current)reader.current.scrollTop=0;},[kind]);
  return <PublicInfoContext.Provider value={open}>{children}
    <Dialog open={kind!==null} onOpenChange={value=>{if(!value)back();}}>
      <DialogContent className="v041-public-info-dialog" positioning="inset" showCloseButton={false}
        onCloseAutoFocus={event=>{event.preventDefault();focusBefore.current?.focus({preventScroll:true});}}>
        <DialogHeader className="v041-public-info-header">
          <button type="button" className="v041-public-info-back" onClick={back} aria-label="返回"><ArrowLeft size={20}/></button>
          <DialogTitle>{kind?TITLES[kind]:'应用信息'}</DialogTitle>
          <DialogDescription className="sr-only">公开信息，未登录也可阅读。</DialogDescription>
        </DialogHeader>
        <div className="v041-public-info-reader" ref={reader}>{kind&&<PublicInfoPage kind={kind} embedded/>}</div>
      </DialogContent>
    </Dialog>
  </PublicInfoContext.Provider>;
}

/** Ordinary links remain public routes without a provider, including before login. */
export function PublicInfoLinks({className='',compact=false}:{className?:string;compact?:boolean}={}){
  const open=useContext(PublicInfoContext);
  return <nav className={`v041-public-info-links${compact?' v041-public-info-links--compact':''} ${className}`.trim()} aria-label="政策与联系">
    {(['privacy','terms','support'] as const).map(kind=>{const Icon=LINK_ICONS[kind];return <a key={kind} href={`/${kind}`}
      onClick={event=>{if(open&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();open(kind);}}}>
      {!compact&&<Icon size={20} aria-hidden="true"/>}<span>{TITLES[kind]}</span>{!compact&&<ChevronRight size={18} aria-hidden="true"/>}
    </a>;})}
  </nav>;
}

function inline(text:string):ReactNode{
  return text.split(/(\*\*[^*]+\*\*)/g).map((value,index)=>value.startsWith('**')&&value.endsWith('**')?<strong key={index}>{value.slice(2,-2)}</strong>:value);
}

function SupportContent(){
  const input=useRef<HTMLInputElement|null>(null),alive=useRef(true);
  const [notice,setNotice]=useState(''),[copying,setCopying]=useState(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const copy=async()=>{
    if(copying)return;setCopying(true);setNotice('');
    try{
      if(typeof navigator.clipboard?.writeText!=='function')throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      if(alive.current)setNotice('邮箱已复制。');
    }catch{
      if(alive.current){input.current?.focus({preventScroll:true});input.current?.select();setNotice('暂未复制。邮箱已选中，请长按或手动复制。');}
    }finally{if(alive.current)setCopying(false);}
  };
  return <>
    <p>如遇使用问题、发现内容错误，或需要提出隐私与数据相关请求，请发送邮件至：</p>
    <label className="v041-support-email"><span className="sr-only">客服邮箱</span><input ref={input} aria-label="客服邮箱" readOnly value={SUPPORT_EMAIL} onFocus={event=>event.currentTarget.select()} spellCheck={false}/></label>
    <p>可说明遇到问题的页面、操作步骤、App版本与设备系统。请勿发送密码、短信验证码或其他无关的私人资料。</p>
    <div className="v041-support-actions">
      <button type="button" className="button secondary" onClick={()=>void copy()} disabled={copying}><Copy size={18}/>{copying?'正在复制…':'复制邮箱'}</button>
      <a className="button primary" href={SUPPORT_MAILTO} onClick={()=>setNotice('将交由邮件应用打开草稿；如未打开，请复制邮箱后自行撰写。')}><Mail size={18}/>撰写邮件</a>
    </div>
    {notice&&<p className="v041-support-notice" role="status">{notice}</p>}
    <p className="v041-support-note">邮件内容、发送和附件由你自行确认。</p>
  </>;
}

/** Bundled public content only: no session, data store, network or permission read. */
export function PublicInfoPage({kind,onBack,embedded=false}:{kind:PublicInfoKind;onBack?:()=>void;embedded?:boolean}){
  const document=kind==='privacy'?privacy:terms;
  const back=()=>{if(onBack){onBack();return;}if(window.history.length>1)window.history.back();else window.location.assign('/');};
  return <article className={`v041-public-info-page${embedded?' v041-public-info-page--embedded':''}`} data-public-info-kind={kind}>
    {!embedded&&<header className="v041-public-route-header"><button type="button" className="v041-public-info-back" onClick={back} aria-label="返回"><ArrowLeft size={20}/></button><h1>{TITLES[kind]}</h1></header>}
    <div className="v041-public-info-body">
      {kind==='support'?<SupportContent/>:<>
        <h2 className="sr-only">{document.title}</h2>
        {document.blocks.map((block,index)=>block.type==='heading'?<h3 key={index}>{block.text}</h3>:<p key={index}>{inline(block.text)}</p>)}
      </>}
      <PublicInfoLinks compact/>
    </div>
  </article>;
}
