'use client';
import {BookOpen,ChartNoAxesCombined,ChevronLeft,Cloud,CloudOff,Compass,LampDesk,Library,RotateCcw,Search,Settings2} from 'lucide-react';
import type {ReactNode} from 'react';
import type {Theme} from '@/lib/study-model';
import {ThemeBrandMark,ThemeMotif} from './ui-theme';

export const WORKSPACE_NAV = [
 {id:'today',label:'今日',icon:Compass}, {id:'vocabulary',label:'单词',icon:BookOpen}, {id:'train',label:'练习',icon:BookOpen},
 {id:'review',label:'复习',icon:RotateCcw}, {id:'progress',label:'进度',icon:ChartNoAxesCombined},
 {id:'resources',label:'资料',icon:Library}
];
// Retain the approved Hollow Knight navigation motifs on the full product routes.
function WorkspaceNavIcon({item,theme}:{item:typeof WORKSPACE_NAV[number];theme:Theme}){
 const Icon=item.icon;
 if(theme!=='hollow')return <Icon size={20}/>;
 const marks:Record<string,ReactNode>={
  today:<><path d="M8 7 4 2l1 9c-1 5 1 9 7 10 6-1 8-5 7-10l1-9-4 5c-2-1-6-1-8 0Z"/><ellipse cx="9" cy="12" rx="1" ry="2"/><ellipse cx="15" cy="12" rx="1" ry="2"/></>,
  vocabulary:<path d="M6 20 18 3c4 6 0 12-7 13M5 21l6-5M9 15l3-1m0-4 3 1"/>,
  train:<path d="m8 16 10-12 3-1-1 4L10 18M5 14l8 7m-6-4-4 4"/>,
  review:<path d="M3 11h18M5 7h14v4M4 15h16M6 15v5m12-5v5M5 11v4m14-4v4"/>,
  progress:<><circle cx="12" cy="12" r="9"/><path d="m9 15 2-6 4-2-2 6-4 2Z"/></>
 };
 return marks[item.id]?<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{marks[item.id]}</svg>:<Icon size={20}/>;
}
export function WorkspaceShell({nav,theme,name,scope,syncLabel,reviewCount,onNavigate,onSearch,onSync,focused=false,children}:{
 nav:string;theme:Theme;name:string;scope:string;syncLabel:string;reviewCount:number;
 onNavigate:(nav:string)=>void;onSearch:()=>void;onSync:()=>void;focused?:boolean;children:ReactNode
}){
 const titles:Record<string,string>={today:'今日',train:'练习',review:'复习',progress:'进度',resources:'资料',vocabulary:'单词计划',search:'查词',settings:'外观与偏好',backups:'记录与备份',art:'内容与来源'};
 return <div className={'lantern-workspace'+(focused?' workspace-focused':'')}>
  <a className="workspace-skip" href="#workspace-main">跳到学习内容</a>
  <aside className="workspace-sidebar" aria-label="学习空间">
   <button className="workspace-brand" onClick={()=>onNavigate('today')} aria-label="微光，返回今日">{theme==='hollow'?<ThemeBrandMark/>:<span aria-hidden="true"><LampDesk size={25}/></span>}<div><b>微光</b><small>LANTERN · TOEIC</small></div></button>
   <p className="workspace-nav-caption">学习空间</p>
   <nav aria-label="桌面主导航">{WORKSPACE_NAV.map(n=><button key={n.id} aria-current={nav===n.id?'page':undefined} onClick={()=>onNavigate(n.id)}><WorkspaceNavIcon item={n} theme={theme}/><span>{n.label}</span>{n.id==='review'&&reviewCount>0&&<small>{reviewCount}</small>}</button>)}<button aria-current={nav==='search'?'page':undefined} onClick={onSearch}><Search size={20}/><span>查词</span></button></nav>
   <div className="workspace-sidebar-bottom"><button onClick={()=>onNavigate('settings')}><Settings2 size={19}/>外观与偏好</button><div className="workspace-identity"><span aria-hidden="true">{name.slice(0,1)}</span><div><b>{name}</b><small>{scope}</small></div></div></div>
  </aside>
  <div className="workspace-body"><header className="workspace-topbar">
   <button className="workspace-mobile-brand" onClick={()=>onNavigate('today')} aria-label="微光，返回今日">{theme==='hollow'?<ThemeBrandMark size={32}/>:<LampDesk size={25} aria-hidden="true"/>}<b>微光</b></button><span className="workspace-location">{titles[nav]||'学习'}</span>
   <div><button className="workspace-search-entry" onClick={onSearch}><Search size={18}/><span>查词</span><kbd>⌘ K</kbd></button><button className="workspace-sync" onClick={onSync} title={syncLabel} aria-label={'学习记录：'+syncLabel}>{syncLabel.includes('同步')&&!syncLabel.includes('待')?<Cloud size={18}/>:<CloudOff size={18}/>}<span>{syncLabel}</span></button><button className="workspace-icon workspace-theme-entry" onClick={()=>onNavigate('settings')} aria-label="外观与偏好"><Settings2 size={19}/><span>主题</span></button></div>
  </header><main id="workspace-main" tabIndex={-1} className="workspace-main">{children}</main></div>
  <nav className="workspace-mobile-nav" aria-label="手机主导航">{WORKSPACE_NAV.map(n=><button key={n.id} aria-current={nav===n.id?'page':undefined} onClick={()=>onNavigate(n.id)}><WorkspaceNavIcon item={n} theme={theme}/><span>{n.label}</span></button>)}</nav>
 </div>
}
export function WorkspaceHeading({theme,title,eyebrow,description}:{theme:Theme;title:string;eyebrow?:string;description?:string}){
 return <div className="workspace-heading"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description&&<p>{description}</p>}</div><ThemeMotif theme={theme}/></div>
}
export function BackToWorkspace({onBack,children='返回'}:{onBack:()=>void;children?:ReactNode}){return <button className="text-button workspace-back" onClick={onBack}><ChevronLeft size={17}/>{children}</button>}
