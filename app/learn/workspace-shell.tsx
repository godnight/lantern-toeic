'use client';

import {BookOpen,ChartNoAxesCombined,ChevronLeft,Headphones,Home,Library,Menu,Palette,RotateCcw,Search,Settings,X} from 'lucide-react';
import {useEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import type {Theme} from '@/lib/study-model';
import {ThemeMotif,workspaceSceneBackdrop} from './ui-theme';
import './workspace-drawer.css';

export const WORKSPACE_NAV = [
 {id:'today',label:'今日',icon:Home},{id:'vocabulary',label:'单词',icon:BookOpen},
 {id:'train',label:'练习',icon:Headphones},{id:'review',label:'复习',icon:RotateCcw},
 {id:'progress',label:'进度',icon:ChartNoAxesCombined},{id:'resources',label:'发现',icon:Library},
];

export type WorkspaceShellProps={
 nav:string;theme:Theme;name:string;scope:string;syncLabel:string;reviewCount:number;
 onNavigate:(nav:string)=>void;onSearch:()=>void;onSync:()=>void;focused?:boolean;children:ReactNode;
 /** Parent owns navigation/history and may override the default personal-page hierarchy. */
 onBack?:()=>void;backLabel?:string;onProfile?:()=>void;discoveryFeedActive?:boolean;
};

const TITLES:Record<string,string>={today:'今日学习',train:'练习',review:'复习',progress:'进度',resources:'发现',
 vocabulary:'单词',search:'查词',profile:'我的',themes:'选择主题',about:'关于微光',
 settings:'学习偏好',account:'账号与安全',backups:'数据管理',art:'内容与来源'};
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
  <img src="/icons/login-approved.png" width="29" height="29" alt=""/><b>微光</b>
 </button>;
}

export function WorkspaceShell({nav,theme,name,scope,syncLabel,reviewCount,onNavigate,onSearch,onSync,
 focused=false,children,onBack,backLabel,onProfile,discoveryFeedActive=false}:WorkspaceShellProps){
 const subpage=PERSONAL_PAGES.has(nav);
 const parent=nav==='profile'?'today':'profile';
 const parentLabel=backLabel||(parent==='today'?'今日学习':'我的');
 const goBack=onBack||(()=>onNavigate(parent));
 const openProfile=onProfile||(()=>onNavigate('profile'));
 const [drawerOpen,setDrawerOpen]=useState(false);
 const [wide,setWide]=useState(false);
 const toggle=useRef<HTMLButtonElement>(null),drawer=useRef<HTMLElement>(null);
 useEffect(()=>{const m=window.matchMedia('(min-width: 700px)');const update=()=>setWide(m.matches);update();m.addEventListener('change',update);return()=>m.removeEventListener('change',update);},[]);
 useEffect(()=>{if(!drawerOpen||wide)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous;};},[drawerOpen,wide]);
 useEffect(()=>{if(!drawerOpen||wide||focused)return;let frame=0;const focusDrawer=()=>{if(drawer.current?.contains(document.activeElement))return;const close=drawer.current?.querySelector<HTMLButtonElement>('.workspace-drawer-head button');close?.focus();if(close&&document.activeElement!==close)frame=requestAnimationFrame(focusDrawer);};frame=requestAnimationFrame(focusDrawer);return()=>cancelAnimationFrame(frame);},[drawerOpen,wide,focused]);
 useEffect(()=>{if(!drawerOpen||focused)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setDrawerOpen(false);toggle.current?.focus();return;}if(event.key!=='Tab'||wide||!drawer.current)return;const items=[...drawer.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]')];if(!items.length)return;const first=items[0],last=items[items.length-1],active=document.activeElement;if(!drawer.current.contains(active)){event.preventDefault();(event.shiftKey?last:first).focus();}else if(event.shiftKey&&active===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&active===last){event.preventDefault();first.focus();}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[drawerOpen,wide,focused]);
 useEffect(()=>{if(focused)setDrawerOpen(false);},[focused]);
 const choose=(action:()=>void)=>{if(!wide){setDrawerOpen(false);toggle.current?.focus();}action();};
 const backdrop=workspaceSceneBackdrop(theme,nav,discoveryFeedActive);
 const sceneStyle=backdrop?({'--page-scene':backdrop.background,'--page-scene-mobile':backdrop.mobileBackground} as CSSProperties):undefined;
 return <div className={`lantern-workspace v040-workspace-shell${focused?' workspace-focused':''}${subpage?' v040-workspace-subpage':''}${discoveryFeedActive?' workspace-discovery-feed':''}`} data-drawer-open={drawerOpen} data-v040-view={nav} data-scene-background={backdrop?.id} style={sceneStyle}>
  <a className="workspace-skip" href="#workspace-main">跳到学习内容</a>

  {drawerOpen&&!wide&&!focused&&<div className="workspace-drawer-backdrop" aria-hidden="true" onClick={()=>{setDrawerOpen(false);toggle.current?.focus();}}/>}
  <aside id="workspace-drawer" ref={drawer} className="workspace-sidebar" aria-label="学习空间导航" aria-hidden={!drawerOpen||focused} inert={!drawerOpen||focused}>
   <div className="workspace-drawer-head"><h2>导航</h2><button type="button" aria-label="收起导航" onClick={()=>{setDrawerOpen(false);toggle.current?.focus();}}><X size={20} aria-hidden="true"/></button></div>
   <nav aria-label="主导航">{WORKSPACE_NAV.map(item=><button type="button" key={item.id}
    aria-current={nav===item.id?'page':undefined} onClick={()=>choose(()=>onNavigate(item.id))}>
    <item.icon size={20} aria-hidden="true"/><span>{item.label}</span>
    {item.id==='review'&&reviewCount>0&&<small>{reviewCount}</small>}
   </button>)}</nav>
   <div className="workspace-sidebar-bottom"><button type="button" aria-current={nav==='search'?'page':undefined} onClick={()=>choose(onSearch)}><Search size={19} aria-hidden="true"/>查词</button>
   <button type="button" aria-current={nav==='themes'?'page':undefined} onClick={()=>choose(()=>onNavigate('themes'))}><Palette size={19} aria-hidden="true"/>主题</button>
   <button type="button" aria-current={nav==='profile'||nav==='settings'?'page':undefined} onClick={()=>choose(openProfile)}><Settings size={19} aria-hidden="true"/>设置</button></div>
  </aside>
  <div className="workspace-body"><header className="workspace-topbar">
   <div className="workspace-topbar-brand"><button ref={toggle} type="button" className="workspace-drawer-toggle" aria-label={drawerOpen?'收起导航':'展开导航'} aria-controls="workspace-drawer" aria-expanded={drawerOpen} onClick={()=>setDrawerOpen(value=>!value)}><Menu size={22} aria-hidden="true"/></button><Brand mobile onClick={()=>onNavigate('today')}/></div>
   {subpage&&<div className="v040-backbar"><button type="button" className="v040-icon-button" onClick={goBack} aria-label={`返回${parentLabel}`}><ChevronLeft size={23} aria-hidden="true"/></button><span>{TITLES[nav]||parentLabel}</span></div>}
  </header><main id="workspace-main" tabIndex={-1} className="workspace-main">{children}</main></div>
 </div>;
}

export function WorkspaceHeading({theme,title,eyebrow,description}:{theme:Theme;title:string;eyebrow?:string;description?:string}){
 return <div className="workspace-heading"><h1>{title}</h1></div>;
}
export function BackToWorkspace({onBack,children='返回'}:{onBack:()=>void;children?:ReactNode}){
 return <button type="button" className="text-button workspace-back" onClick={onBack}><ChevronLeft size={17} aria-hidden="true"/>{children}</button>;
}
