'use client';
import {useEffect,useLayoutEffect,useRef,useState,type KeyboardEvent,type MouseEvent,type ReactNode} from 'react';
import {ArrowUpRight,Bookmark,BookOpen,ChevronLeft,FileText,Headphones,Library,RefreshCw,Search,SlidersHorizontal,Video,X} from 'lucide-react';
import {safeDiscoveryUrl} from '@/lib/discovery-catalog';
import {createDiscoveryFavoritesStore,type DiscoveryFavoritesResult} from '@/lib/discovery-favorites';
import {readDiscoveryReturn,readDiscoveryReturnSnapshot,rememberDiscoveryReturn,clearDiscoveryReturn,type DiscoveryCategory,type DiscoveryReturnState} from '@/lib/discovery-return';
import {DISCOVERY_SEED,readDiscoveryFeedCache,refreshDiscoveryFeed} from '@/lib/discovery-feed';
import type {DiscoveryContentKind,DiscoveryFeedSnapshot,DiscoveryItem,DiscoverySourceStatus} from '@/lib/discovery-feed-contract';
import './discovery.css';

const categories=[['all','全部'],['video','视频'],['podcast','播客'],['article','文章']] as const;
const kindLabels:Record<DiscoveryContentKind,string>={video:'视频',podcast:'播客',article:'文章'};
const kindIcons={video:Video,podcast:Headphones,article:FileText};
type FeedCategory='all'|DiscoveryContentKind;
type SourceControl='cover'|'title'|'source';
type View={scope:string;category:FeedCategory|'library';query:string;savedOnly:boolean;sourceIds?:string[]};
type Props={owner:string|null;canAccess:()=>boolean;library:ReactNode;active?:boolean;libraryFocused?:boolean;
 initialReturn?:DiscoveryReturnState|null;initialReturnToken?:string|null;onReturnConsumed?:()=>void;onLibraryActiveChange?:(active:boolean)=>void};
type ScopedFeed={scope:string;snapshot:DiscoveryFeedSnapshot;pending:boolean};
function categoryOf(value:DiscoveryCategory|undefined):View['category']{
 if(value==='library'||value==='video'||value==='podcast'||value==='article')return value;
 return 'all';
}
function seedSnapshot():DiscoveryFeedSnapshot{
 const seen=new Map<string,DiscoverySourceStatus>();
 for(const entry of DISCOVERY_SEED)if(!seen.has(entry.sourceId))seen.set(entry.sourceId,{id:entry.sourceId,label:entry.platform||entry.publisher,mode:'curated'});
 return {entries:DISCOVERY_SEED,sources:[...seen.values()],status:'seed',refreshedAt:null};
}
function readSnapshot():DiscoveryFeedSnapshot{try{return readDiscoveryFeedCache();}catch{return seedSnapshot();}}
function normalized(value:string){return value.normalize('NFKC').toLocaleLowerCase();}
function safeCover(src:string){return /^\/images\/discovery\/[a-z0-9][a-z0-9._/-]*$/i.test(src)&&!src.split('/').includes('..');}

/** A curated external-link directory. Opening a source never submits study time. */
export default function DiscoveryView({owner,canAccess,library,active=true,libraryFocused=false,initialReturn,initialReturnToken,onReturnConsumed,onLibraryActiveChange}:Props){
 const current=useRef({owner,canAccess,active,alive:true,generation:1});
 if(current.current.owner!==owner||current.current.canAccess!==canAccess)current.current={owner,canAccess,active,alive:true,generation:current.current.generation+1};
 else current.current.active=active;
 const generation=current.current.generation,scope=JSON.stringify([owner,generation]);
 const matching=()=>current.current.alive&&current.current.generation===generation&&current.current.owner===owner;
 const permitted=()=>matching()&&canAccess();
 const fromSaved=(saved:DiscoveryReturnState|null):View=>({scope,category:categoryOf(saved?.category),query:saved?.query??'',savedOnly:saved?.savedOnly??false,...saved?.sourceIds!==undefined?{sourceIds:[...saved.sourceIds]}:{}});
 const [viewState,setView]=useState<View>(()=>fromSaved(canAccess()?readDiscoveryReturn(owner):null));
 const view=viewState.scope===scope?viewState:fromSaved(null);
 const [favorites,setFavorites]=useState<{scope:string;result:DiscoveryFavoritesResult}|null>(null),[notice,setNotice]=useState('');
 const [feed,setFeed]=useState<ScopedFeed>(()=>({scope,snapshot:canAccess()?readSnapshot():seedSnapshot(),pending:true}));
 const [refreshCount,setRefreshCount]=useState(0),[sourcesOpen,setSourcesOpen]=useState(false);
 const [failedCovers,setFailedCovers]=useState<ReadonlySet<string>>(()=>new Set());
 const store=useRef<ReturnType<typeof createDiscoveryFavoritesStore>|null>(null);
 const initialSnapshot=canAccess()?readDiscoveryReturnSnapshot(owner):null;
 const resume=useRef<{owner:string|null;state:DiscoveryReturnState|null;token:string|null}>({owner,state:canAccess()?(initialReturn===undefined?initialSnapshot?.state??null:initialReturn):null,token:initialReturnToken===undefined?initialSnapshot?.token??null:initialReturnToken});
 const sourceLinks=useRef(new Map<string,Partial<Record<SourceControl,HTMLAnchorElement>>>()),sourceButton=useRef<HTMLButtonElement>(null),searchInput=useRef<HTMLInputElement>(null),sheetClose=useRef<HTMLButtonElement>(null),sheet=useRef<HTMLDivElement>(null),resultsTitle=useRef<HTMLParagraphElement>(null);
 const setSourceLink=(id:string,control:SourceControl,node:HTMLAnchorElement|null)=>{
  const links=sourceLinks.current.get(id)??{};
  if(node){links[control]=node;sourceLinks.current.set(id,links);}
  else{delete links[control];if(Object.keys(links).length)sourceLinks.current.set(id,links);else sourceLinks.current.delete(id);}
 };
 const allowed=canAccess();
 useEffect(()=>{
  if(current.current.generation!==generation||current.current.owner!==owner||current.current.canAccess!==canAccess)return;
  current.current.alive=true;
  if(viewState.scope!==scope){const saved=canAccess()?readDiscoveryReturnSnapshot(owner):null;resume.current={owner,state:saved?.state??null,token:saved?.token??null};setView(fromSaved(saved?.state??null));setNotice('');setSourcesOpen(false);}
  let value:ReturnType<typeof createDiscoveryFavoritesStore>;
  try{value=createDiscoveryFavoritesStore({owner,storage:window.localStorage,canAccess,isCurrent:matching});}
  catch{setFavorites({scope,result:{status:'blocked',reason:'storage'}});return()=>{if(current.current.generation===generation)current.current.alive=false;};}
  store.current=value;
  const reload=()=>{if(matching())setFavorites({scope,result:value.read()});};reload();
  const changed=(event:StorageEvent)=>{if(event.key===null||event.key===value.key)reload();};
  window.addEventListener('storage',changed);
  return()=>{if(current.current.generation===generation)current.current.alive=false;window.removeEventListener('storage',changed);if(store.current===value)store.current=null;};
 },[owner,canAccess]);
 useEffect(()=>{
  if(!active||!allowed)return;
  let live=true;const controller=new AbortController(),isCurrent=()=>live&&matching()&&current.current.active&&canAccess();
  if(isCurrent())setFeed({scope,snapshot:readSnapshot(),pending:true});
  void Promise.resolve().then(()=>refreshDiscoveryFeed({signal:controller.signal,canCommit:isCurrent})).then(snapshot=>{
   if(isCurrent())setFeed({scope,snapshot,pending:false});
  }).catch(()=>{
   if(isCurrent())setFeed(previous=>previous.scope===scope?{scope,snapshot:{...previous.snapshot,status:'offline'},pending:false}:{scope,snapshot:{...seedSnapshot(),status:'offline'},pending:false});
  });
  return()=>{live=false;controller.abort();};
 },[owner,canAccess,active,allowed,refreshCount]);
 useEffect(()=>{if(!active)setSourcesOpen(false);},[active]);
 useEffect(()=>{if(notice!=='已收藏。'&&notice!=='已取消收藏。')return;const timer=setTimeout(()=>setNotice(''),1800);return()=>clearTimeout(timer);},[notice]);
 useEffect(()=>{if(!sourcesOpen)return;const frame=requestAnimationFrame(()=>sheetClose.current?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame);},[sourcesOpen]);
 const ready=favorites?.scope===scope&&favorites.result.status==='ready',ids=favorites?.scope===scope&&favorites.result.status==='ready'?favorites.result.ids:[];
 const blocked=favorites?.scope===scope&&favorites.result.status==='blocked';
 const feedState=feed.scope===scope?feed:{scope,snapshot:seedSnapshot(),pending:true};
 const snapshot=feedState.snapshot;
 useEffect(()=>{
  if(!permitted()||!current.current.active)return;
  const value=store.current?.capture(snapshot.entries);
  if(value&&matching())setFavorites({scope,result:value});
 },[scope,snapshot.entries,active]);
 const sources=snapshot.sources.length?snapshot.sources:seedSnapshot().sources;
 const selectedSources=new Set(view.sourceIds??sources.map(source=>source.id));
 const terms=normalized(view.query).trim().split(/\s+/u).filter(Boolean),savedIds=new Set(ids);
 const savedEntries=favorites?.scope===scope&&favorites.result.status==='ready'?favorites.result.entries:[];
 const visibleEntries=view.savedOnly?[...snapshot.entries,...savedEntries.filter(item=>!snapshot.entries.some(entry=>entry.id===item.id))]:snapshot.entries;
 const entries=visibleEntries.filter(entry=>entry.language==='en'&&entry.originalLanguage==='en'&&safeDiscoveryUrl(entry.sourceUrl));
 const found=entries.filter(entry=>selectedSources.has(entry.sourceId)&&(view.category==='all'||view.category==='library'||entry.kind===view.category)&&(!view.savedOnly||savedIds.has(entry.id))&&
  terms.every(term=>normalized([entry.title,entry.author??'',entry.publisher,entry.platform,...entry.tags].join(' ')).includes(term)));
 useLayoutEffect(()=>{onLibraryActiveChange?.(active&&view.category==='library');return()=>onLibraryActiveChange?.(false);},[active,view.category,onLibraryActiveChange]);
 useLayoutEffect(()=>{
  const pending=resume.current;if(!active||pending.owner!==owner||!pending.state||!allowed||pending.state.savedOnly&&!ready)return;
  const saved=pending.state;
  if(saved.entryId&&!sourceLinks.current.has(saved.entryId)&&feedState.pending)return;
  const frame=requestAnimationFrame(()=>{
   if(!permitted()||!current.current.active)return;
   // The in-memory snapshot may outlive its session or have been superseded.
   // Never clear a newer return for this owner, or anything belonging to another.
   const currentSnapshot=readDiscoveryReturnSnapshot(owner);
   if(!pending.token||currentSnapshot?.token!==pending.token||JSON.stringify(currentSnapshot.state)!==JSON.stringify(saved)){resume.current.state=null;onReturnConsumed?.();return;}
   const links=sourceLinks.current.get(saved.entryId??'');(links?.[saved.entryControl??'source']??links?.source)?.focus({preventScroll:true});window.scrollTo({top:saved.scroll,behavior:'auto'});resume.current.state=null;clearDiscoveryReturn(owner);onReturnConsumed?.();
  });
  return()=>cancelAnimationFrame(frame);
 },[active,owner,canAccess,allowed,ready,view.category,view.query,view.savedOnly,view.sourceIds,feedState.pending,snapshot.entries]);
 const change=(patch:Partial<Omit<View,'scope'>>)=>{if(!permitted()||!current.current.active)return;setView(previous=>({...(previous.scope===scope?previous:fromSaved(null)),...patch,scope}));setNotice('');};
 const toggle=(entry:DiscoveryItem)=>{
  if(!permitted()||!current.current.active||!active)return;
  const result=store.current?.toggle(entry.id,entry);
  if(result?.status==='ready'){setFavorites({scope,result});setNotice(result.ids.includes(entry.id)?'已收藏。':'已取消收藏。');}
  else setNotice('收藏未能保存，原记录已保留。请稍后重试。');
 };
 const beforeExternal=(entry:DiscoveryItem,entryControl:SourceControl)=>{
  if(!permitted()||!current.current.active||!active||!safeDiscoveryUrl(entry.sourceUrl))return false;
  const saved=rememberDiscoveryReturn(owner,{category:view.category,query:view.query,savedOnly:view.savedOnly,scroll:window.scrollY,entryId:entry.id,entryControl,...view.sourceIds!==undefined?{sourceIds:[...view.sourceIds]}:{}});
  if(!saved)setNotice('返回位置未能保存，原站尚未打开。请稍后重试。');
  return saved;
 };
 const externalClick=(entry:DiscoveryItem,control:SourceControl)=>(event:MouseEvent<HTMLAnchorElement>)=>{if(!beforeExternal(entry,control))event.preventDefault();};
 const refresh=()=>{if(permitted()&&current.current.active)setRefreshCount(count=>count+1);};
 const closeSources=()=>{setSourcesOpen(false);requestAnimationFrame(()=>{if(permitted()&&current.current.active)sourceButton.current?.focus({preventScroll:true});});};
 const sourceKey=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.key==='Escape'){event.preventDefault();closeSources();return;}
  if(event.key!=='Tab'||!sheet.current||typeof document==='undefined')return;
  const controls=Array.from(sheet.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]'));
  if(!controls.length)return;const first=controls[0],last=controls[controls.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
 };
 const toggleSource=(id:string)=>{const next=new Set(view.sourceIds??sources.map(source=>source.id));if(next.has(id))next.delete(id);else next.add(id);const all=sources.length>0&&sources.every(source=>next.has(source.id));change({sourceIds:all?undefined:[...next]});};
 return <section className="discovery-view" aria-label="精选英语内容" data-discovery-mode={view.category==='library'?'library':'feed'}>
  {view.category!=='library'&&<header className="discovery-header">
   <div className="discovery-topline"><button type="button" className="discovery-icon-button discovery-library-button" aria-label="资料库" disabled={!allowed} onClick={()=>change({category:'library'})}><Library size={22} aria-hidden="true"/></button><h1>{view.savedOnly?'收藏':'发现'}</h1><div className="discovery-header-actions"><button type="button" className="discovery-icon-button" aria-label="我的收藏" aria-pressed={view.savedOnly} disabled={!allowed} onClick={()=>change({savedOnly:!view.savedOnly})}><Bookmark size={21} aria-hidden="true"/>{ids.length>0&&<span className="discovery-saved-dot" aria-hidden="true"/>}</button><button type="button" ref={sourceButton} className="discovery-icon-button" aria-label="内容来源" disabled={!allowed} onClick={()=>{if(permitted()&&current.current.active)setSourcesOpen(true);}}><SlidersHorizontal size={21} aria-hidden="true"/></button></div></div>
   <form className="discovery-search" role="search" onSubmit={event=>{event.preventDefault();resultsTitle.current?.focus({preventScroll:true});}}><Search size={18} aria-hidden="true"/><label><span className="sr-only">搜索英文内容</span><input ref={searchInput} type="search" value={view.query} maxLength={200} placeholder="搜索英文内容" onChange={event=>change({query:event.target.value})}/></label>{view.query&&<button type="button" className="discovery-search-clear" aria-label="清除搜索" onClick={()=>{change({query:''});requestAnimationFrame(()=>searchInput.current?.focus({preventScroll:true}));}}><X size={17} aria-hidden="true"/></button>}</form><nav className="discovery-categories" aria-label="内容类型">{categories.map(([id,label])=><button type="button" key={id} data-discovery-category={id} aria-pressed={view.category===id} disabled={!allowed} onClick={()=>change({category:id})}>{label}</button>)}</nav>
  </header>}
  {view.category==='library'&&!libraryFocused&&<button type="button" className="discovery-library-back" disabled={!allowed} onClick={()=>change({category:'all'})}><ChevronLeft size={18} aria-hidden="true"/>返回发现</button>}
  <div className="discovery-library" hidden={view.category!=='library'}>{library}</div>
  <div hidden={view.category==='library'} className="discovery-directory">
   <p className="sr-only" tabIndex={-1} ref={resultsTitle} role="status">{view.savedOnly?'我的收藏':'精选目录'} · {found.length} 条</p>
   {view.savedOnly&&<p className="discovery-storage-note">收藏仅保存在此设备，不随学习记录备份导出。</p>}
   {blocked&&<p className="discovery-notice" role="alert">收藏暂时无法读取，已有记录未修改。原站目录仍可浏览。</p>}
   <div className="discovery-results">{found.map(entry=>{
    const saved=ids.includes(entry.id),KindIcon=kindIcons[entry.kind],cover=entry.cover&&safeCover(entry.cover.src)?entry.cover:null,coverFailed=failedCovers.has(entry.id);
    const publisher=(!coverFailed&&cover?.credit)||entry.publisher;
    const sameSource=(name:string)=>name.trim().toLocaleLowerCase().replace(/\s+university$/u,'');
    const sourceName=entry.platform&&sameSource(entry.platform)!==sameSource(entry.publisher)&&sameSource(entry.platform)!==sameSource(publisher)?`${publisher} · ${entry.platform}`:publisher;
    return <article className={`discovery-card${cover?'':' discovery-card--no-cover'}`} key={entry.id} data-discovery-id={entry.id}>
     {cover&&<a ref={node=>setSourceLink(entry.id,'cover',node)} data-discovery-control="cover" className={`discovery-cover-link${coverFailed?' discovery-cover-link--unavailable':''}`} href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`打开原站：${entry.title}`} onClick={externalClick(entry,'cover')}>{!coverFailed&&<img src={cover.src} alt={cover.alt} loading="lazy" onError={()=>{if(matching())setFailedCovers(previous=>new Set([...previous,entry.id]));}}/>}<span className="discovery-kind-tag"><KindIcon size={13} aria-hidden="true"/>{kindLabels[entry.kind]}</span>{entry.durationLabel&&<span className="discovery-duration">{entry.durationLabel}</span>}</a>}
     <div className="discovery-copy"><div className="discovery-source"><span className="discovery-source-mark" aria-hidden="true">{entry.publisher.slice(0,1).toUpperCase()}</span><span className="discovery-source-name">{sourceName}</span>{(cover?entry.tags[0]:kindLabels[entry.kind])&&<span className="discovery-source-kind">{cover?entry.tags[0]:kindLabels[entry.kind]}</span>}</div><h2 lang="en"><a ref={node=>setSourceLink(entry.id,'title',node)} data-discovery-control="title" href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={externalClick(entry,'title')}>{entry.title}</a></h2>{entry.author&&<p className="discovery-author" lang="en">{entry.author}</p>}</div>
     <div className="discovery-actions"><a ref={node=>setSourceLink(entry.id,'source',node)} data-discovery-control="source" data-discovery-source={entry.id} href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={externalClick(entry,'source')}>{entry.kind==='article'?'阅读原文':'打开原站'}<ArrowUpRight size={16} aria-hidden="true"/><span className="sr-only">：{entry.title}</span></a><button type="button" className="discovery-bookmark" data-discovery-save={entry.id} aria-label={`${saved?'取消收藏':'收藏'}：${entry.title}`} aria-pressed={saved} disabled={!allowed||!ready} onClick={()=>toggle(entry)}><Bookmark size={19} aria-hidden="true"/></button></div>
    </article>;
   })}</div>
   {!found.length&&<div className="discovery-empty"><p>{view.savedOnly&&!ids.length?'还没有收藏。看到喜欢的内容，点一下书签。':selectedSources.size===0?'选择一个内容来源，开始浏览。':'没有找到相关内容。换个关键词试试。'}</p>{(view.query||view.category!=='all'||view.savedOnly||view.sourceIds!==undefined)&&<button type="button" onClick={()=>change({query:'',category:'all',savedOnly:false,sourceIds:undefined})}>查看全部内容</button>}</div>}
   {!feedState.pending&&(snapshot.status==='offline'||snapshot.status==='cached'||snapshot.status==='fresh'&&snapshot.sources.some(source=>source.mode==='offline'||source.mode==='cached'))&&<p className="discovery-feed-status" role="status">{snapshot.status==='fresh'?'部分内容暂时无法更新，已显示现有内容。':'暂时无法更新，已显示现有内容。'}<button type="button" onClick={refresh} disabled={!allowed||feedState.pending}>重试</button></p>}
   {notice&&<p className="discovery-notice discovery-toast" role="status" aria-live="polite">{notice}</p>}
  </div>
  {sourcesOpen&&<div className="discovery-sheet-backdrop" onClick={event=>{if(event.target===event.currentTarget)closeSources();}}><div className="discovery-sheet" ref={sheet} role="dialog" aria-modal="true" aria-labelledby="discovery-sheet-title" onKeyDown={sourceKey}><div className="discovery-sheet-grip" aria-hidden="true"/><div className="discovery-sheet-heading"><h2 id="discovery-sheet-title">内容来源</h2><button type="button" ref={sheetClose} className="discovery-icon-button" aria-label="关闭" onClick={closeSources}><X size={20} aria-hidden="true"/></button></div><p className="discovery-sheet-note">英文原生内容</p>{sources.map(source=><label className="discovery-source-option" key={source.id}><span className="discovery-source-mark" aria-hidden="true">{source.label.slice(0,1).toUpperCase()}</span><span>{source.label}</span><input type="checkbox" aria-label={source.label} checked={selectedSources.has(source.id)} disabled={!allowed} onChange={()=>toggleSource(source.id)}/></label>)}<button type="button" className="discovery-sheet-done" onClick={closeSources}>完成</button><button type="button" className="discovery-sheet-refresh" disabled={!allowed||feedState.pending} onClick={refresh}><RefreshCw size={16} aria-hidden="true"/>刷新来源</button></div></div>}
 </section>;
}
