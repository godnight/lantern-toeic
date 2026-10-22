'use client';

import {BookOpen,ChartNoAxesCombined,ChevronLeft,Cloud,CloudOff,Headphones,Home,Library,RotateCcw,Search,UserRound} from 'lucide-react';
import type {ReactNode} from 'react';
import type {Theme} from '@/lib/study-model';
import {ThemeMotif} from './ui-theme';

export const WORKSPACE_NAV = [
 {id:'today',label:'今日',icon:Home},{id:'vocabulary',label:'单词',icon:BookOpen},
 {id:'train',label:'练习',icon:Headphones},{id:'review',label:'复习',icon:RotateCcw},
 {id:'progress',label:'进度',icon:ChartNoAxesCombined},{id:'resources',label:'资料',icon:Library},
];

export type WorkspaceShellProps={
 nav:string;theme:Theme;name:string;scope:string;syncLabel:string;reviewCount:number;
 onNavigate:(nav:string)=>void;onSearch:()=>void;onSync:()=>void;focused?:boolean;children:ReactNode;
 /** Parent owns navigation/history and may override the default personal-page hierarchy. */
 onBack?:()=>void;backLabel?:string;onProfile?:()=>void;
};

const TITLES:Record<string,string>={today:'今日学习',train:'练习',review:'复习',progress:'进度',resources:'资料',
 vocabulary:'单词计划',search:'查词',profile:'我的',themes:'选择主题',about:'关于微光',
 settings:'学习偏好',account:'账号与安全',backups:'记录与备份',art:'内容与来源'};
const PERSONAL_PAGES=new Set(['profile','themes','about','account','settings','backups','art']);

/** Kept separate from content: this decor never changes learning state. */
function WorkspaceAmbient({theme}:{theme:Theme}){
 if(theme!=='hollow'&&theme!=='silk')return null;
 return <div className="v040-ambient" data-kind={theme} aria-hidden="true">
  {theme==='hollow'&&<img src="/phase2-theme/rain-city-hd-1x.webp"
   srcSet="/phase2-theme/rain-city-hd-1x.webp 560w, /phase2-theme/rain-city-hd-2x.webp 1120w, /phase2-theme/rain-city-hd-3x.webp 1672w"
   sizes="462px" width={560} height={315} alt="" decoding="async"/>}
 </div>;
}

function Brand({onClick,mobile=false}:{onClick:()=>void;mobile?:boolean}){
 return <button type="button" className={mobile?'workspace-mobile-brand':'workspace-brand'}
  onClick={onClick} aria-label="微光，返回今日">
  <img className="v040-brand-mark" src="/phase2-theme/knight-v3-reference.jpg" width={34} height={34}
   alt="" aria-hidden="true" decoding="async"/>
  {mobile?<b>微光</b>:<span><b>微光</b><small>LANTERN · TOEIC</small></span>}
 </button>;
}

export function WorkspaceShell({nav,theme,name,scope,syncLabel,reviewCount,onNavigate,onSearch,onSync,
 focused=false,children,onBack,backLabel,onProfile}:WorkspaceShellProps){
 const subpage=PERSONAL_PAGES.has(nav);
 const parent=nav==='profile'?'today':'profile';
 const parentLabel=backLabel||(parent==='today'?'今日学习':'我的');
 const goBack=onBack||(()=>onNavigate(parent));
 const openProfile=onProfile||(()=>onNavigate('profile'));
 return <div className={`lantern-workspace v040-workspace-shell${focused?' workspace-focused':''}${subpage?' v040-workspace-subpage':''}`} data-v040-view={nav}>
  <a className="workspace-skip" href="#workspace-main">跳到学习内容</a>
  <WorkspaceAmbient theme={theme}/>
  <aside className="workspace-sidebar" aria-label="学习空间">
   <Brand onClick={()=>onNavigate('today')}/>
   <p className="workspace-nav-caption">学习空间</p>
   <nav aria-label="桌面主导航">{WORKSPACE_NAV.map(item=><button type="button" key={item.id}
    aria-current={nav===item.id?'page':undefined} onClick={()=>onNavigate(item.id)}>
    <item.icon size={20} aria-hidden="true"/><span>{item.label}</span>
    {item.id==='review'&&reviewCount>0&&<small>{reviewCount}</small>}
   </button>)}<button type="button" aria-current={nav==='search'?'page':undefined} onClick={onSearch}>
    <Search size={20} aria-hidden="true"/><span>查词</span>
   </button></nav>
   <div className="workspace-sidebar-bottom"><button type="button" aria-current={nav==='profile'?'page':undefined} onClick={openProfile}>
    <UserRound size={19} aria-hidden="true"/>我的与设置
   </button><div className="workspace-identity"><span aria-hidden="true">{name.slice(0,1)}</span><div><b>{name}</b><small>{scope}</small></div></div></div>
  </aside>
  <div className="workspace-body"><header className="workspace-topbar">
   {subpage?<div className="v040-backbar"><button type="button" className="v040-icon-button" onClick={goBack} aria-label={`返回${parentLabel}`}><ChevronLeft size={23} aria-hidden="true"/></button><span>{parentLabel}</span></div>
    :<><Brand mobile onClick={()=>onNavigate('today')}/><span className="workspace-location">{TITLES[nav]||'学习'}</span></>}
   <div className="v040-topbar-tools"><button type="button" className="workspace-search-entry" onClick={onSearch}>
    <Search size={18} aria-hidden="true"/><span>查词</span><kbd>⌘ K</kbd>
   </button><button type="button" className="workspace-sync" onClick={onSync} title={syncLabel} aria-label={`学习记录：${syncLabel}`}>
    {syncLabel.includes('同步')&&!syncLabel.includes('待')?<Cloud size={18} aria-hidden="true"/>:<CloudOff size={18} aria-hidden="true"/>}<span>{syncLabel}</span>
   </button>{!subpage&&<button type="button" className="v040-icon-button v040-personal-entry" onClick={openProfile} aria-label="打开个人信息与设置"><UserRound size={22} aria-hidden="true"/></button>}</div>
  </header><main id="workspace-main" tabIndex={-1} className="workspace-main">{children}</main></div>
  {!subpage&&<nav className="workspace-mobile-nav" aria-label="手机主导航">{WORKSPACE_NAV.map(item=><button type="button" key={item.id}
   aria-current={nav===item.id?'page':undefined} onClick={()=>onNavigate(item.id)}><item.icon size={20} aria-hidden="true"/><span>{item.label}</span></button>)}</nav>}
 </div>;
}

export function WorkspaceHeading({theme,title,eyebrow,description}:{theme:Theme;title:string;eyebrow?:string;description?:string}){
 return <div className="workspace-heading"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description&&<p>{description}</p>}</div><ThemeMotif theme={theme}/></div>;
}
export function BackToWorkspace({onBack,children='返回'}:{onBack:()=>void;children?:ReactNode}){
 return <button type="button" className="text-button workspace-back" onClick={onBack}><ChevronLeft size={17} aria-hidden="true"/>{children}</button>;
}
