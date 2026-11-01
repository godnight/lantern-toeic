'use client';
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowUpRight,Bookmark,Search} from 'lucide-react';
import {discoveryEntries,DISCOVERY_KINDS,discoveryDuration,filterDiscoveryEntries,type DiscoveryEntry} from '@/lib/discovery-catalog';
import {createDiscoveryFavoritesStore,type DiscoveryFavoritesResult} from '@/lib/discovery-favorites';
import {readDiscoveryReturn,rememberDiscoveryReturn,clearDiscoveryReturn,type DiscoveryCategory,type DiscoveryReturnState} from '@/lib/discovery-return';
import './discovery.css';

const categories=[['all','为你选'],['talk','演讲'],['person','人物'],['film','影视'],['library','资料库']] as const;
const coverNames={talk:'声音与表达',person:'人生中的选择',film:'银幕里的对话'};
type View={scope:string;category:DiscoveryCategory;query:string;savedOnly:boolean};
type Props={owner:string|null;canAccess:()=>boolean;library:ReactNode;active?:boolean;libraryFocused?:boolean;
 initialReturn?:DiscoveryReturnState|null;onLibraryActiveChange?:(active:boolean)=>void};

/** A curated external-link directory. Opening a source never submits study time. */
export default function DiscoveryView({owner,canAccess,library,active=true,libraryFocused=false,initialReturn,onLibraryActiveChange}:Props){
 const current=useRef({owner,canAccess,active,alive:true,generation:1});
 if(current.current.owner!==owner||current.current.canAccess!==canAccess)current.current={owner,canAccess,active,alive:true,generation:current.current.generation+1};
 else current.current.active=active;
 const generation=current.current.generation,scope=JSON.stringify([owner,generation]);
 // Capture this proof as well as the generation. A/B/A and a fresh proof for A
 // cannot authorize a callback retained from an earlier rendered workspace.
 const matching=()=>current.current.alive&&current.current.generation===generation&&current.current.owner===owner;
 const permitted=()=>matching()&&canAccess();
 const [viewState,setView]=useState<View>(()=>{const saved=canAccess()?(initialReturn===undefined?readDiscoveryReturn(owner):initialReturn):null;return {scope,category:saved?.category??'all',query:saved?.query??'',savedOnly:saved?.savedOnly??false};});
 const view=viewState.scope===scope?viewState:{scope,category:'all' as const,query:'',savedOnly:false};
 const [favorites,setFavorites]=useState<{scope:string;result:DiscoveryFavoritesResult}|null>(null),[notice,setNotice]=useState('');
 const store=useRef<ReturnType<typeof createDiscoveryFavoritesStore>|null>(null);
 const resume=useRef<{owner:string|null;state:DiscoveryReturnState|null}>({owner,state:canAccess()?(initialReturn===undefined?readDiscoveryReturn(owner):initialReturn):null});
 const sourceLinks=useRef(new Map<string,HTMLAnchorElement>()),resultsTitle=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  if(current.current.generation!==generation||current.current.owner!==owner||current.current.canAccess!==canAccess)return;
  current.current.alive=true;
  if(viewState.scope!==scope){const saved=canAccess()?readDiscoveryReturn(owner):null;resume.current={owner,state:saved};setView({scope,category:saved?.category??'all',query:saved?.query??'',savedOnly:saved?.savedOnly??false});setNotice('');}
  let value:ReturnType<typeof createDiscoveryFavoritesStore>;
  try{value=createDiscoveryFavoritesStore({owner,storage:window.localStorage,canAccess,isCurrent:matching});}
  catch{setFavorites({scope,result:{status:'blocked',reason:'storage'}});return()=>{if(current.current.generation===generation)current.current.alive=false;};}
  store.current=value;
  const reload=()=>{if(matching())setFavorites({scope,result:value.read()});};reload();
  const changed=(event:StorageEvent)=>{if(event.key===null||event.key===value.key)reload();};
  window.addEventListener('storage',changed);
  return()=>{if(current.current.generation===generation)current.current.alive=false;window.removeEventListener('storage',changed);if(store.current===value)store.current=null;};
 },[owner,canAccess]);
 const ready=favorites?.scope===scope&&favorites.result.status==='ready',ids=favorites?.scope===scope&&favorites.result.status==='ready'?favorites.result.ids:[];
 const allowed=canAccess(),blocked=favorites?.scope===scope&&favorites.result.status==='blocked';
 useLayoutEffect(()=>{onLibraryActiveChange?.(active&&view.category==='library');return()=>onLibraryActiveChange?.(false);},[active,view.category,onLibraryActiveChange]);
 useLayoutEffect(()=>{
  const pending=resume.current;if(!active||pending.owner!==owner||!pending.state||!allowed||pending.state.savedOnly&&!ready)return;
  const saved=pending.state;
  const frame=requestAnimationFrame(()=>{if(!permitted()||!current.current.active)return;sourceLinks.current.get(saved.entryId??'')?.focus({preventScroll:true});window.scrollTo({top:saved.scroll,behavior:'auto'});resume.current.state=null;clearDiscoveryReturn(owner);});
  return()=>cancelAnimationFrame(frame);
 },[active,owner,canAccess,allowed,ready,view.category]);
 const change=(patch:Partial<Omit<View,'scope'>>)=>{if(!permitted()||!current.current.active)return;setView({...view,...patch,scope});setNotice('');};
 const found=filterDiscoveryEntries(discoveryEntries,{kind:view.category==='library'?'all':view.category,query:view.query,favoritesOnly:view.savedOnly,savedIds:ids});
 const toggle=(entry:DiscoveryEntry)=>{
  if(!permitted()||!current.current.active||!active)return;
  const result=store.current?.toggle(entry.id);
  if(result?.status==='ready'){setFavorites({scope,result});setNotice(result.ids.includes(entry.id)?'已收藏。':'已取消收藏。');}
  else setNotice('收藏未能保存，原记录已保留。请稍后重试。');
 };
 const beforeExternal=(entry:DiscoveryEntry)=>{
  if(!permitted()||!current.current.active||!active)return false;
  const saved=rememberDiscoveryReturn(owner,{category:view.category,query:view.query,savedOnly:view.savedOnly,scroll:window.scrollY,entryId:entry.id});
  if(!saved)setNotice('返回位置未能保存，原站尚未打开。请稍后重试。');
  return saved;
 };
 return <section className="discovery-view" aria-label="精选英语内容">
  {!(view.category==='library'&&libraryFocused)&&<>
   <div className="discovery-heading"><p>今天想听点什么？</p><button type="button" className="discovery-saved" aria-pressed={view.savedOnly} disabled={!allowed} onClick={()=>change({savedOnly:!view.savedOnly,category:view.category==='library'?'all':view.category})}><Bookmark size={18} aria-hidden="true"/>{view.savedOnly?'全部内容':'收藏'}</button></div>
   {view.category!=='library'&&<form className="discovery-search" role="search" onSubmit={event=>{event.preventDefault();resultsTitle.current?.focus({preventScroll:true});}}><label><span className="sr-only">搜索精选英语内容</span><input type="search" value={view.query} maxLength={200} placeholder="演讲、人物、话题…" onChange={event=>change({query:event.target.value})}/></label><button type="submit" disabled={!allowed}><Search size={18} aria-hidden="true"/><span>搜索</span></button></form>}
   <div className="discovery-categories" role="group" aria-label="内容分类">{categories.map(([id,label])=><button type="button" key={id} data-discovery-category={id} aria-pressed={view.category===id} disabled={!allowed} onClick={()=>change({category:id,savedOnly:false})}>{label}</button>)}</div>
  </>}
  <div className="discovery-library" hidden={view.category!=='library'}>{library}</div>
  <div hidden={view.category==='library'} className="discovery-directory">
   <p className="discovery-result-count" tabIndex={-1} ref={resultsTitle} role="status">{view.savedOnly?'我的收藏':'精选目录'} · {found.length} 条{view.query.trim()?` · “${view.query.trim()}”`:''}</p>
   {view.savedOnly&&<p className="discovery-storage-note">收藏仅保存在此设备，不随学习记录备份导出。</p>}
   {blocked&&<p className="discovery-notice" role="alert">收藏暂时无法读取，已有记录未修改。原站目录仍可浏览。</p>}
   <div className="discovery-results">{found.map(entry=><article className="discovery-card" key={entry.id}>
    <div className={`discovery-cover discovery-cover-${entry.kind}`} aria-hidden="true"><span>{DISCOVERY_KINDS[entry.kind]}</span><strong>{coverNames[entry.kind]}</strong><small>分类图</small></div>
    <div className="discovery-copy"><div className="discovery-source"><span>{entry.publisher}</span><span>{DISCOVERY_KINDS[entry.kind]}</span></div><h2>{entry.title}</h2><p className="discovery-author">{entry.author}</p><p>{entry.description}</p>
     <p className="discovery-meta">{entry.durationLabel??discoveryDuration(entry.durationSeconds)}<br/>{entry.captions??'字幕以原站为准'}<br/>{entry.difficulty?`编辑估计：${entry.difficulty}`:'难度暂未评估'}</p>
     <div className="discovery-actions"><a ref={node=>{if(node)sourceLinks.current.set(entry.id,node);else sourceLinks.current.delete(entry.id);}} data-discovery-source={entry.id} href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={event=>{if(!beforeExternal(entry))event.preventDefault();}}>前往原站<ArrowUpRight size={17} aria-hidden="true"/><span className="sr-only">：{entry.title}</span></a><button type="button" data-discovery-save={entry.id} aria-label={`${ids.includes(entry.id)?'取消收藏':'收藏'}：${entry.title}`} aria-pressed={ids.includes(entry.id)} disabled={!allowed||!ready} onClick={()=>toggle(entry)}>{ids.includes(entry.id)?'已收藏':'收藏'}</button></div>
     <details className="discovery-rights"><summary>来源与访问说明</summary><p>{entry.availability.note}</p><p>仅提供原站入口，不在微光内播放或处理原站内容。</p><p>核查 {entry.rights.checkedAt} · {entry.rights.holder}</p>{entry.rights.evidenceUrls.map((url,index)=><a key={url} href={url} target="_blank" rel="noopener noreferrer" onClick={event=>{if(!beforeExternal(entry))event.preventDefault();}}>查看来源依据 {index+1}<ArrowUpRight size={14} aria-hidden="true"/></a>)}</details>
    </div>
   </article>)}</div>
   {!found.length&&<div className="discovery-empty"><h2>{view.savedOnly?'还没有匹配的收藏':'没有匹配的内容'}</h2><p>{view.savedOnly?'看到想听的内容，可以先收藏下来。':'搜索的是已收录目录，可以换个关键词或查看全部内容。'}</p>{(view.query||view.category!=='all'||view.savedOnly)&&<button type="button" onClick={()=>change({query:'',category:'all',savedOnly:false})}>查看全部内容</button>}</div>}
   <p className="discovery-notice" role="status" aria-live="polite">{notice||'精选目录检索 · 原站访问需要联网'}</p><p className="discovery-footnote">打开原站不会自动记作听完，也不增加学习时长。</p>
  </div>
 </section>;
}
