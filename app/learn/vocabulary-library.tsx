'use client';
import {useDeferredValue,useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,Check,Download,Search,Star,Upload,X} from 'lucide-react';
import {toast} from 'sonner';
import {registerNativeBack} from '@/lib/native-host';
import {useVocabulary} from '@/lib/use-vocabulary';
import {vocabularyId,CATEGORIES,searchText,searchWords,type Word} from '@/lib/vocabulary-model';
import wordData from '@/content/vocabulary.json';
import questions from '@/content/questions.json';
import expansion from '@/content/vocabulary-expansion.json';
import dictionaryMetadata from '@/content/dictionary-metadata.json';
import {emptyVocabularyState,findDictionary,indexDictionary,mergeWordCatalog,vocabularyStates,type DictionaryEntry} from '@/lib/dictionary-model';
import {loadDictionary} from '@/lib/load-dictionary';
import {bundledLessonAudio} from '@/lib/lesson-audio';
import {SpeechPlayer} from './practice';
import {InteractiveExample,type ExampleLookup} from './interactive-example';

const core=wordData as Word[];
const questionWords:Word[]=[];
for(const q of questions)for(const v of q.vocabulary||[])if(!core.some(w=>searchText(w.word)===searchText(v.word))&&!questionWords.some(w=>searchText(w.word)===searchText(v.word)))questionWords.push({id:'qv-'+v.word.toLowerCase().replace(/[^a-z0-9]+/g,'-'),word:v.word,pos:'词汇与表达',meaning:v.meaning,category:'questions',example:v.example,translation:'',collocation:''});
const extraWords:Word[]=expansion.map(w=>({...w,example:'',translation:'',collocation:'',source:'lantern-expansion'}));
const learningWords=[...core,...questionWords,...extraWords];
const posLabel=(value:string)=>({noun:'名词',verb:'动词',adj:'形容词',adjective:'形容词',adv:'副词',adverb:'副词',pron:'代词',pronoun:'代词',prep:'介词',preposition:'介词',conj:'连词',conjunction:'连词',interj:'感叹词',interjection:'感叹词',unknown:'词性未标注',name:'专名',proper:'专名',phrase:'短语',num:'数词',number:'数词',determiner:'限定词',article:'冠词',abbrev:'缩略词',symbol:'符号',suffix:'后缀',prefix:'前缀'} as Record<string,string>)[value]||value;
type Mode='learn'|'dictionary';
type Filter='all'|'starred'|'due';
type Snapshot={query:string;searchQuery:string;mode:Mode;category:string;filter:Filter;limit:number;scroll:number;selectedId:string|null;focusId:string|null};
type VocabularyView={token:string;snapshot:Snapshot}&({view:'detail';selectedId:string}|{view:'session';words:string[];sessionId:string;index:number;revealed:boolean;answered:string[];gradeError:'again'|'remembered'|null});
type Props={owner:string|null;onQuestion:(id:string)=>void;initialMode?:Mode;initialFilter?:Filter;initialQuery?:string;lookupOnly?:boolean;backLabel?:string;onBack?:()=>void;onFocusChange?:(focused:boolean)=>void;overlayBlocked?:boolean;onExampleLookup?:ExampleLookup;renderPlanAction?:(word:Word)=>ReactNode};

function DictionarySources({word}:{word:string}){
 const variants=(dictionaryMetadata.headwordCaseVariants as Record<string,string[]>)[searchText(word)]||[word];
 return <p className="word-footnote">中文维基词典贡献者 · Kaikki 提取 · {variants.map(value=><span key={value}><a href={'https://zh.wiktionary.org/wiki/'+encodeURIComponent(value)} target="_blank" rel="noreferrer">{value} 原词条</a>（<a href={'https://zh.wiktionary.org/w/index.php?title='+encodeURIComponent(value)+'&action=history'} target="_blank" rel="noreferrer">编辑历史</a>） </span>)} · <a href={dictionaryMetadata.licenseUrl} target="_blank" rel="noreferrer">{dictionaryMetadata.license}</a>。词典释义为一般用法，不代表托业考纲；词源参考不等于记忆联想。</p>;
}
export function VocabularyEntry({onOpen}:{onOpen:()=>void}){return <button className="vocabulary-entry panel" onClick={onOpen}><span className="vocabulary-entry-icon"><BookOpen size={25}/></span><span><b>场景词与生词本</b><small>{core.length+extraWords.length} 个场景词 · 词卡复习与英汉查词</small></span><ArrowRight size={20}/></button>;}
export function VocabularyReviewSummary({owner,onOpen}:{owner:string|null;onOpen:()=>void}){
 const store=useVocabulary(owner),[now,setNow]=useState(Date.now());
 const states=useMemo(()=>vocabularyStates(store.events),[store.events]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
 const starred=[...states.values()].filter(s=>s.starred).length,due=[...states.values()].filter(s=>s.due>0&&s.due<=now).length;
 return <section className="vocab-review-summary panel" aria-label="生词与到期词卡"><div><span className="vocab-source-label">词卡复习</span><h2>{!store.ready?'正在读取词卡记录':store.error?'词卡记录暂未读入':due?`${due} 个到期词卡`:'今天没有到期词卡'}</h2>{!store.error&&store.ready&&<p>{starred} 个生词 · <span>{store.sync}</span></p>}</div>{store.error?<div className="vocab-alert" role="alert"><p>{store.error}</p><button className="text-button" onClick={store.retry}>重新读取词卡记录</button></div>:<button className="button secondary" disabled={!store.ready} onClick={onOpen}>查看词卡范围<ArrowRight size={16}/></button>}</section>;
}

export default function VocabularyLibrary({owner,onQuestion,initialMode='learn',initialFilter='all',initialQuery='',lookupOnly=false,backLabel='返回来源页',onBack,onFocusChange,overlayBlocked=false,onExampleLookup,renderPlanAction}:Props){
 const store=useVocabulary(owner);
 const instanceId=useId(),rootElement=useRef<HTMLElement>(null);
 const domId=(name:string)=>'vocab-'+instanceId+'-'+name;
 const dialogScrollHost=()=>rootElement.current?.closest<HTMLElement>('[role="dialog"]')||null;
 const readScroll=()=>dialogScrollHost()?.scrollTop??window.scrollY??0;
 const writeScroll=(scroll:number)=>{const host=dialogScrollHost();if(host)host.scrollTop=scroll;else window.scrollTo(0,scroll);};
 const focusWithin=(id:string)=>{const target=rootElement.current?.querySelector<HTMLElement>('[id="'+id+'"]');if(!target||(target as HTMLButtonElement).disabled||target.matches?.(':disabled')||target.getAttribute?.('aria-disabled')==='true')return false;target.focus({preventScroll:true});return true;};
 const [query,setQuery]=useState(initialQuery),[searchQuery,setSearchQuery]=useState(initialQuery),[category,setCategory]=useState('all'),[filter,setFilter]=useState<Filter>(initialFilter),[limit,setLimit]=useState(24),[mode,setMode]=useState<Mode>(lookupOnly?'dictionary':initialMode);
 const [dictionary,setDictionary]=useState<DictionaryEntry[]>([]),[dictionaryReady,setDictionaryReady]=useState(false),[dictionaryLoading,setDictionaryLoading]=useState(false),[dictionaryError,setDictionaryError]=useState(''),[dictionaryRetry,setDictionaryRetry]=useState(0);
 const [detailId,setDetailId]=useState<string|null>(null),[session,setSession]=useState<string[]|null>(null),[index,setIndex]=useState(0),[revealed,setRevealed]=useState(false),[now,setNow]=useState(Date.now()),[singleColumn,setSingleColumn]=useState(false);
 const [markError,setMarkError]=useState<{word:Word;starred:boolean}|null>(null),[gradeError,setGradeError]=useState<'again'|'remembered'|null>(null);
 const searchInput=useRef<HTMLInputElement>(null),backupInput=useRef<HTMLInputElement>(null),composing=useRef(false),answered=useRef(new Set<string>()),sessionId=useRef(''),ownerRef=useRef(owner);
 ownerRef.current=owner;
 const activeStore=useRef(store);activeStore.current=store;
 const focusCallback=useRef(onFocusChange);focusCallback.current=onFocusChange;
 const snapshot=useRef<Snapshot|null>(null),restorePending=useRef<Snapshot|null>(null),innerHistory=useRef(false),consumeOwnedPop=useRef(false),historyToken=useRef(''),backHandler=useRef<()=>boolean>(()=>false);
 const activeView=useRef({detailId,session,singleColumn,overlayBlocked});activeView.current={detailId,session,singleColumn,overlayBlocked};
 const compactHistoryPending=useRef(false),focusedDetail=useRef<string|null>(null),ensureCompactRef=useRef(()=>{});
 const pendingReturn=useRef<{callback:()=>void;owner:string|null}|null>(null),mounted=useRef(true);
 const deferredQuery=useDeferredValue(searchQuery);
 const words=useMemo(()=>mergeWordCatalog(learningWords,dictionary),[dictionary]);
 const wordById=useMemo(()=>new Map(words.map(word=>[word.id,word])),[words]);
 const dictionaryIndex=useMemo(()=>indexDictionary(words),[words]);
 const stateEvents=useMemo(()=>vocabularyStates(store.events),[store.events]);
 const wordState=(id:string)=>stateEvents.get(id)||emptyVocabularyState;
 const starred=[...stateEvents.values()].filter(s=>s.starred).length,due=[...stateEvents.values()].filter(s=>s.due>0&&s.due<=now).length;
 const unresolved=[...stateEvents.keys()].filter(id=>!wordById.has(id)).length;
 // Browsing authored scenes does not read the 84,979-entry file. A query or unresolved
 // saved dictionary ID is the first demand; loadDictionary retains its hash validation.
 const privateReady=store.ready&&!store.error;
 const dictionaryWanted=(mode==='dictionary'&&!!searchText(searchQuery))||(privateReady&&filter!=='all'&&unresolved>0);
 useEffect(()=>{
  if(!dictionaryWanted||dictionaryReady){setDictionaryLoading(false);if(!dictionaryWanted)setDictionaryError('');return;}
  let alive=true;setDictionaryLoading(true);setDictionaryError('');
  loadDictionary().then(value=>{if(alive){setDictionary(value.entries);setDictionaryReady(true);setDictionaryLoading(false);}}).catch(error=>{if(alive){setDictionaryError(error instanceof Error?error.message:'词典读取失败，请重试。');setDictionaryLoading(false);}});
  return()=>{alive=false;};
 },[dictionaryWanted,dictionaryReady,dictionaryRetry]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  const media=window.matchMedia?.('(max-width: 1199px)');if(!media)return;
  const update=()=>setSingleColumn(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
 },[]);
 useEffect(()=>{setSession(null);setDetailId(null);setFilter(initialFilter);setCategory('all');setQuery(initialQuery);setSearchQuery(initialQuery);setLimit(24);setMarkError(null);setGradeError(null);snapshot.current=null;restorePending.current=null;innerHistory.current=false;consumeOwnedPop.current=false;historyToken.current='';compactHistoryPending.current=false;focusedDetail.current=null;composing.current=false;answered.current.clear();sessionId.current='';pendingReturn.current=null;},[owner]);
 useEffect(()=>{setMode(lookupOnly?'dictionary':initialMode);},[initialMode,lookupOnly]);
 useEffect(()=>{setFilter(initialFilter);},[initialFilter]);
 useEffect(()=>{focusCallback.current?.(!!session||!!detailId&&singleColumn);},[session,detailId,singleColumn]);
 useEffect(()=>()=>focusCallback.current?.(false),[]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pendingReturn.current=null;};},[]);

 const filtered=useMemo(()=>{
  if(filter==='all')return mode==='dictionary'?findDictionary(dictionaryIndex,deferredQuery):searchWords(learningWords,deferredQuery,category).map(w=>wordById.get(w.id)!);
  if(!privateReady)return [];
  const candidates=[...stateEvents].filter(([,s])=>filter==='starred'?s.starred:s.due>0&&s.due<=now).map(([id])=>wordById.get(id)).filter((w):w is Word=>!!w);
  return mode==='dictionary'?findDictionary(indexDictionary(candidates),deferredQuery||'') .concat(!searchText(deferredQuery)?candidates:[]):searchWords(candidates,deferredQuery,category);
 },[filter,mode,dictionaryIndex,deferredQuery,category,wordById,stateEvents,now,privateReady]);
 const exact=filtered.filter(w=>!!searchText(deferredQuery)&&searchText(w.word)===searchText(deferredQuery));
 const related=filtered.filter(w=>!exact.some(e=>e.id===w.id));
 const visible=[...exact,...related].slice(0,limit),detail=detailId?wordById.get(detailId):undefined;
 const card=session?wordById.get(session[index]):undefined,finished=!!session&&index>=session.length;
 const updating=query!==deferredQuery;
 const frame=(callback:()=>void)=>{if(typeof requestAnimationFrame==='function')requestAnimationFrame(callback);else setTimeout(callback,0);};
 const practiceOwnsHistory=()=>!!window.history?.state?.lanternPracticeView&&!window.history?.state?.lanternPracticeLookup;
 const saveContext=(selectedId:string|null,focusId=selectedId?domId('word-result-'+selectedId):null)=>{snapshot.current={query,searchQuery,mode,category,filter,limit,scroll:readScroll(),selectedId,focusId};};
 const pushInnerHistory=(view:VocabularyView['view'],selectedId=detailId,words=session)=>{
  if(!window.history?.pushState||!snapshot.current||activeView.current.overlayBlocked||practiceOwnsHistory())return;
  if(!historyToken.current)historyToken.current=vocabularyId();
  const common={token:historyToken.current,snapshot:snapshot.current};
  const marker:VocabularyView|undefined=view==='detail'&&selectedId?{...common,view,selectedId}:view==='session'&&words?{...common,view,words,sessionId:sessionId.current,index,revealed,answered:[...answered.current],gradeError}:undefined;
  if(!marker)return;
  const state={...window.history?.state,lanternVocabularyView:marker};
  if(window.history?.state?.lanternVocabularyView?.token===historyToken.current)window.history.replaceState(state,'');else window.history.pushState(state,'');
  innerHistory.current=true;
 };
 const ensureCompactDetail=()=>{
  if(!detailId||!singleColumn||activeView.current.overlayBlocked||practiceOwnsHistory())return;
  pushInnerHistory('detail',detailId);compactHistoryPending.current=false;
  if(focusedDetail.current!==detailId){writeScroll(0);focusWithin(domId('word-detail'));focusedDetail.current=detailId;}
 };
 ensureCompactRef.current=ensureCompactDetail;
 const restoreContext=(saved:Snapshot)=>{setQuery(saved.query);setSearchQuery(saved.searchQuery);setMode(saved.mode);setCategory(saved.category);setFilter(saved.filter);setLimit(saved.limit);snapshot.current=saved;};
 const restoreList=(pop=true)=>{
  const saved=snapshot.current;
  if(saved){restoreContext(saved);restorePending.current=saved;}
  setDetailId(null);setSession(null);setGradeError(null);
  const ownsEntry=window.history?.state?.lanternVocabularyView?.token===historyToken.current;
  innerHistory.current=false;
  if(pop&&ownsEntry){consumeOwnedPop.current=true;window.history.back();}
 };
 // The parent owns the search/lookup entry. Consume this component's child
 // entry first, then call the parent only after that Back has been acknowledged.
 const returnToOrigin=()=>{
  if(!onBack||overlayBlocked)return;
  if(consumeOwnedPop.current||window.history?.state?.lanternVocabularyView?.token===historyToken.current){pendingReturn.current={callback:onBack,owner};if(!consumeOwnedPop.current)restoreList();restorePending.current=null;}
  else onBack();
 };
 backHandler.current=()=>{if(overlayBlocked)return false;if(session||detailId){restoreList();return true;}if(onBack){returnToOrigin();return true;}return false;};
 useEffect(()=>registerNativeBack(()=>backHandler.current(),30),[owner]);
 useEffect(()=>{
  if(!window.addEventListener)return;
  const pop=(event:PopStateEvent)=>{
   if(activeView.current.overlayBlocked)return;
   if(consumeOwnedPop.current){consumeOwnedPop.current=false;event.stopImmediatePropagation?.();const request=pendingReturn.current;pendingReturn.current=null;if(request)frame(()=>{if(mounted.current&&ownerRef.current===request.owner)request.callback();});return;}
   const marker=event.state?.lanternVocabularyView as VocabularyView|undefined;
   if(marker?.token===historyToken.current&&marker.snapshot){
    // A child Practice lease returning to the already-visible detail must not
    // reset that detail's scroll, selection, focus, or pending mark feedback.
    if(marker.view==='detail'&&activeView.current.detailId===marker.selectedId&&!activeView.current.session){event.stopImmediatePropagation?.();innerHistory.current=true;compactHistoryPending.current=false;return;}
    event.stopImmediatePropagation?.();restoreContext(marker.snapshot);restorePending.current=null;innerHistory.current=true;setMarkError(null);
    if(marker.view==='detail'){setSession(null);setGradeError(null);setDetailId(marker.selectedId);}else if(marker.view==='session'){setDetailId(null);setSession(marker.words);sessionId.current=marker.sessionId;answered.current=new Set(marker.answered);setIndex(marker.index);setRevealed(marker.revealed);setGradeError(marker.gradeError);writeScroll(0);}
    return;
   }
   if(compactHistoryPending.current&&activeView.current.detailId&&activeView.current.singleColumn&&(!event.state?.lanternPracticeView||event.state?.lanternPracticeLookup)){event.stopImmediatePropagation?.();ensureCompactRef.current();return;}
   if(innerHistory.current){event.stopImmediatePropagation?.();restoreList(false);}
  };
  window.addEventListener('popstate',pop,true);return()=>window.removeEventListener('popstate',pop,true);
 },[owner,overlayBlocked]);
 useEffect(()=>{
  let cancelled=false;
  if(!detailId||!singleColumn){focusedDetail.current=null;compactHistoryPending.current=false;}
  if(detailId&&singleColumn){
   if(!innerHistory.current)compactHistoryPending.current=true;
   if(!overlayBlocked)frame(()=>{if(!cancelled)ensureCompactRef.current();});
  }
  if(!detailId&&!session&&restorePending.current&&!overlayBlocked){const saved=restorePending.current;restorePending.current=null;frame(()=>{if(!cancelled&&!activeView.current.overlayBlocked){writeScroll(saved.scroll);if(!saved.focusId||!focusWithin(saved.focusId))focusWithin(domId('heading'));}});}
  return()=>{cancelled=true;};
 },[detailId,singleColumn,session,limit,overlayBlocked]);
 useEffect(()=>{if(session&&!overlayBlocked&&window.history?.state?.lanternVocabularyView?.token===historyToken.current)pushInnerHistory('session');},[session,index,revealed,gradeError,overlayBlocked]);
 useEffect(()=>{
  if(!window.addEventListener)return;
  const key=(event:KeyboardEvent)=>{if(!overlayBlocked&&event.key==='Escape'&&!event.isComposing&&!composing.current&&(session||detailId||onBack)){event.preventDefault();event.stopImmediatePropagation();if(session||detailId)restoreList();else returnToOrigin();}};
  window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
 },[session,detailId,singleColumn,overlayBlocked,onBack]);

 const openDetail=(w:Word)=>{saveContext(w.id);setDetailId(w.id);setMarkError(null);if(singleColumn||innerHistory.current)pushInnerHistory('detail',w.id);};
 const start=()=>{if(lookupOnly||!filtered.length||!privateReady)return;saveContext(detailId,detailId?domId('word-result-'+detailId):domId('self-test'));sessionId.current=vocabularyId();answered.current.clear();const words=[...exact,...related].slice(0,20).map(w=>w.id);setSession(words);setIndex(0);setRevealed(false);setGradeError(null);pushInnerHistory('session',null,words);writeScroll(0);};
 const grade=(value:'again'|'remembered')=>{if(lookupOnly||!card||!revealed)return;const id=sessionId.current+'-'+index;if(answered.current.has(id))return;if(!store.review(card.id,value,id)){setGradeError(value);return;}answered.current.add(id);setIndex(i=>i+1);setRevealed(false);setGradeError(null);setNow(Date.now());};
 const mark=(w:Word,wanted=!wordState(w.id).starred)=>{if(wordState(w.id).starred===wanted){setMarkError(null);return;}if(!store.mark(w.id,wanted)){setMarkError({word:w,starred:wanted});return;}setMarkError(null);};
 const reset=()=>{setLimit(24);setDetailId(null);setMarkError(null);};
 const updateQuery=(value:string)=>{setQuery(value);if(!composing.current){setSearchQuery(value);reset();}};
 const changeMode=(value:Mode)=>{if(lookupOnly&&value!=='dictionary')return;setMode(value);setCategory('all');setFilter('all');reset();};
 const showStarred=()=>{restoreList();setFilter('starred');setLimit(24);};
 const saveBackup=()=>{try{const url=URL.createObjectURL(new Blob([JSON.stringify(store.backup(),null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='lantern-vocabulary-records.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}catch{toast.error('备份无法读取，请保留浏览器数据后重试。');}};
 const meaning=(w:Word)=><div className="word-definition"><p><span className="word-pos">{posLabel(w.pos)}</span>{w.meaning}</p>{w.collocation&&<p className="word-collocation" lang="en">{w.collocation}</p>}{w.example&&<><blockquote lang="en"><InteractiveExample text={w.example} onLookup={lookupOnly?undefined:onExampleLookup} disabled={overlayBlocked}/></blockquote>{onExampleLookup&&!lookupOnly&&<p className="example-lookup-hint">点例句中的英文词查词，不会自动加入生词本或学习计划。</p>}{lookupOnly&&<p className="example-lookup-hint">查词窗口内的例句仅展示，返回后可继续点词。</p>}</>}{w.translation&&<p className="muted">{w.translation}</p>}{!!w.forms?.length&&<p><span className="word-pos">词形参考</span><span lang="en">{w.forms.join(' · ')}</span></p>}{!!w.senses?.length&&<section className="word-dictionary-detail"><h3>词典释义</h3><ol>{w.senses.map((s,i)=><li key={i}><span className="word-pos">{posLabel(s.pos)}</span>{s.meaning}</li>)}</ol>{w.etymology&&<><h3>词源参考</h3><p>{w.etymology}</p></>}<DictionarySources word={w.word}/></section>}</div>;
 const audio=(w:Word)=>typeof window!=='undefined'&&window.__LANTERN_HARMONY__&&!bundledLessonAudio(w.word)?<p className="word-footnote">此词暂无离线发音；已有场景词可离线播放。</p>:<SpeechPlayer key={w.id} text={w.word} label="听单词发音" sourceLabel={w.source==='wiktionary'?'词典词条':'场景词汇'}/>;
 const markButton=(w:Word)=><div className="vocab-mark-actions"><button className={'button '+(wordState(w.id).starred?'secondary':'primary')} aria-pressed={wordState(w.id).starred} disabled={!store.ready||!!store.error||overlayBlocked} onClick={()=>mark(w,true)}>{wordState(w.id).starred?<Check size={17}/>:<Star size={17}/>} {wordState(w.id).starred?'已加入生词本':'加入生词本'}</button>{wordState(w.id).starred&&<><button className="text-button" disabled={!store.ready||!!store.error||overlayBlocked} onClick={()=>mark(w,false)}>移出生词本</button><button className="text-button" disabled={overlayBlocked} onClick={showStarred}>查看我的生词<ArrowRight size={16}/></button></>}{renderPlanAction?.(w)}</div>;
 const renderDetail=(w:Word)=><article id={domId('word-detail')} data-vocabulary-detail="true" className="vocab-detail" tabIndex={-1} aria-label={'词条详情：'+w.word}><button className="vocab-detail-back text-button" onClick={()=>restoreList()}><ArrowLeft size={17}/>返回结果</button><span className="vocab-source-label">{w.source==='wiktionary'?'通用词典 · 非托业专用词表':CATEGORIES[w.category]||'托业场景词'}</span><h2 className="vocab-word-title" lang="en">{w.word}</h2>{!!w.phonetics?.length&&<p className="word-phonetic" lang="en">{w.phonetics.join(' · ')}</p>}{audio(w)}{meaning(w)}{markButton(w)}{markError?.word.id===w.id&&<div className="vocab-alert" role="alert"><b>生词标记未保存</b><p>原标记保持。重试后再确认是否已加入。</p><button className="text-button" disabled={!store.ready||!!store.error} onClick={()=>mark(w,markError.starred)}>重试保存标记</button></div>}{!lookupOnly&&questions.some(q=>q.vocabulary?.some(v=>searchText(v.word)===searchText(w.word)))&&<section className="word-question-links"><h3>在练习里认识它</h3>{questions.filter(q=>q.vocabulary?.some(v=>searchText(v.word)===searchText(w.word))).map(q=><button key={q.id} className="text-button" onClick={()=>onQuestion(q.id)}>Part {q.part} · {q.title}<ArrowRight size={16}/></button>)}</section>}</article>;
 const initial=mode==='dictionary'&&filter==='all'&&!searchText(deferredQuery);
 const partial=mode==='dictionary'&&!!searchText(deferredQuery)&&!dictionaryReady;
 const blockingEmpty=partial||filter!=='all'&&(!privateReady||unresolved>0&&!dictionaryReady);

 return <section ref={rootElement} data-vocabulary-instance={instanceId} className={'vocabulary-library vocab-redesign '+(detail&&singleColumn?'vocab-detail-open ':'')+(session?'vocab-session-open':'')} aria-label="查词与场景词库" data-dictionary-ready={dictionaryReady} data-dictionary-loading={dictionaryLoading}>
  {!session&&!(detail&&singleColumn)&&<>
   <header className="vocab-page-heading"><h1 id={domId('heading')} tabIndex={-1}>{mode==='dictionary'?'查词':'场景词与生词本'}</h1>{onBack&&<button className="text-button" onClick={returnToOrigin}><ArrowLeft size={17}/>{backLabel}</button>}</header>
   {!lookupOnly&&<div className="word-mode word-filters" aria-label="词汇范围"><button aria-pressed={mode==='learn'} onClick={()=>changeMode('learn')}>托业场景词</button><button aria-pressed={mode==='dictionary'} onClick={()=>changeMode('dictionary')}>英汉查词</button></div>}
   <div className="word-controls"><label className="word-search"><Search size={19} aria-hidden="true"/><input ref={searchInput} type="search" aria-label="搜索单词或中文释义" placeholder="输入单词或中文释义" value={query} autoCapitalize="off" autoComplete="off" spellCheck={false} enterKeyHint="search" onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={e=>{composing.current=false;setQuery(e.currentTarget.value);setSearchQuery(e.currentTarget.value);reset();}} onChange={e=>updateQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&!composing.current){setSearchQuery(query);reset();}}}/>{query&&<button type="button" aria-label="清空查询" onClick={()=>{composing.current=false;setQuery('');setSearchQuery('');reset();searchInput.current?.focus();}}><X size={18}/></button>}</label>{mode==='learn'&&<label className="vocab-category">场景<select aria-label="词汇场景" value={category} onChange={e=>{setCategory(e.target.value);reset();}}><option value="all">全部场景</option>{Object.entries(CATEGORIES).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>}</div>
   <div className="vocab-filter-line"><div className="word-filters" aria-label="词库筛选">{([['all','全部'],['starred','我的生词'],['due','到期复习']] as const).map(([id,label])=><button key={id} aria-pressed={filter===id} onClick={()=>{setFilter(id);reset();}}>{label}</button>)}</div><span className="vocab-catalog-count">{mode==='dictionary'?`${dictionaryMetadata.count.toLocaleString()} 条 · 通用词典`:`${core.length+extraWords.length} 场景词 + ${questionWords.length} 题内表达`}</span></div>
  </>}
  {store.error&&<div className="vocab-alert" role="alert"><b>词库记录暂时无法读取</b><p>{store.error}</p><button className="text-button" onClick={store.retry}>重新读取</button></div>}
  {!store.ready&&<p className="vocab-status" role="status">正在读取词库记录…</p>}
  {unresolved>0&&<div className="vocab-status" role="status">{dictionaryLoading?'正在读取历史生词对应的词典内容…':`${unresolved} 个历史词条暂未能显示，原收藏和复习记录已保留。`}{!dictionaryLoading&&!dictionaryReady&&<button className="text-button" onClick={()=>{setFilter('starred');setDictionaryRetry(n=>n+1);}}>重新读取词典</button>}</div>}
  {session?<>
   <div className="word-session-heading"><button className="text-button" onClick={()=>restoreList()}><ArrowLeft size={17}/>返回词库</button><span>词卡自测 · {Math.min(index+1,session.length)} / {session.length}</span></div>
   {finished?<div className="word-flashcard panel"><BookOpen size={36}/><h2>这一组，复习完成</h2><p>已记录 {session.length} 张词卡。忘记的词约 10 分钟后再见；按时记住的词会逐步延长复习间隔。</p><button className="button primary" onClick={()=>restoreList()}>回到词库</button></div>:card&&<article className="word-flashcard panel"><p className="vocab-source-label">{CATEGORIES[card.category]||'通用词典'} · 先回想，再翻卡</p><h2 className="vocab-word-title" lang="en">{card.word}</h2>{audio(card)}{revealed?<>{meaning(card)}<div className="button-row"><button className="button secondary" disabled={!!store.error} onClick={()=>grade('again')}>还没记住</button><button className="button primary" disabled={!!store.error} onClick={()=>grade('remembered')}>记住了<ArrowRight size={16}/></button></div></>:<button className="button primary" onClick={()=>setRevealed(true)}>查看释义与例句</button>}{gradeError&&<div className="vocab-alert" role="alert"><b>反馈未保存 · 待保存：{gradeError==='again'?'还没记住':'记住了'}</b><p>保留当前词卡与反馈；保存成功才进入下一张。</p><button className="text-button" disabled={!!store.error} onClick={()=>grade(gradeError)}>重试保存反馈</button></div>}{markButton(card)}<p className="word-footnote">提前自测不会增加复习间隔。词卡自评不计入听读正确率。</p></article>}
  </>:<>
   {dictionaryError&&<div className="vocab-alert" role="alert"><b>词典暂时未能读取</b><p>{dictionaryError} 查询与筛选已保留，场景词仍可使用。</p><div className="button-row"><button className="text-button" onClick={()=>setDictionaryRetry(n=>n+1)}>重试加载词典</button>{!lookupOnly&&<button className="text-button" onClick={()=>changeMode('learn')}>改查场景词</button>}</div></div>}
   {partial&&<div className="vocab-status" role="status">{dictionaryLoading?'正在加载英汉词典… 输入已保留。':'通用词典尚未读入。'}{filtered.length>0&&' 当前仅显示场景词匹配，通用结果尚不完整。'}</div>}
   {(!initial||updating)&&!(detail&&singleColumn)&&<p className="word-result-count" role="status" aria-live="polite">{updating?(composing.current?'正在输入… ':'正在更新结果… ')+(searchText(deferredQuery)?`当前结果对应“${deferredQuery.trim()}”。`:'尚未执行这次输入。'):blockingEmpty&&!filtered.length?'结果尚未完整读入':`${filtered.length} 个结果${exact.length?' · 精确词头优先':''}`}</p>}
   <div className="vocab-results-layout">
    <div className="vocab-results" aria-label="词汇结果">
     {initial?<div className="vocab-empty"><Search size={28}/><h2>从一个词开始</h2><p>输入英文词头或中文释义。相关匹配不包含拼写纠错。</p></div>:visible.length?<>
      <div className="word-grid">{visible.map((w,i)=><article className={'word-row'+(detailId===w.id?' vocab-selected':'')} key={w.id}>{i===exact.length&&exact.length>0&&<span className="vocab-group-label">相关匹配</span>}<button id={domId('word-result-'+w.id)} className="word-open" onClick={()=>openDetail(w)} aria-current={detailId===w.id?true:undefined}><span className="vocab-result-head"><h2 lang="en">{w.word}</h2><span className="vocab-match">{searchText(deferredQuery)?searchText(w.word)===searchText(deferredQuery)?'精确':'相关':filter==='starred'?'生词':filter==='due'?'到期':'场景'}</span></span><p>{w.meaning}</p><small>{posLabel(w.pos)} · {CATEGORIES[w.category]||'通用词典'}</small></button><button className="word-star" aria-label={(wordState(w.id).starred?'移出生词本：':'加入生词本：')+w.word} aria-pressed={wordState(w.id).starred} disabled={!store.ready||!!store.error} onClick={()=>mark(w)}><Star size={18} fill={wordState(w.id).starred?'currentColor':'none'}/></button></article>)}</div>
      {filtered.length>limit&&<button className="button secondary word-more" onClick={()=>setLimit(n=>n+24)}>再显示 24 个</button>}
      {!!searchText(deferredQuery)&&<p className="word-footnote vocab-match-note">相关匹配：前缀、词内或释义；不包含拼写纠错。</p>}
     </>:blockingEmpty?<div className="vocab-empty" role="status"><BookOpen size={28}/><h2>{filter!=='all'&&!store.ready?'正在读取词库记录':dictionaryLoading?'正在准备词典':'内容尚未完整读入'}</h2><p>请先等待或重试读取，或查看已有场景词；不将读取失败当作零结果。</p>{dictionaryLoading&&<div className="vocab-skeleton" aria-hidden="true"><i/><i/><i/></div>}</div>:<div className="vocab-empty"><BookOpen size={28}/><h2>{filter==='starred'?'没有匹配的生词':filter==='due'?'这个范围没有到期词':`未找到“${deferredQuery.trim()}”`}</h2><p>{filter==='all'?'试试完整词头或中文释义。当前不提供自动拼写纠错。':'可以清除筛选或换个词。提前复练不提高间隔。'}</p><button className="button secondary" onClick={()=>{setFilter('all');setCategory('all');if(filter==='all'){setQuery('');setSearchQuery('');}reset();}}>{filter==='all'?'清空查询':'清除筛选'}</button></div>}
    </div>
    {detail?renderDetail(detail):<div className="vocab-detail vocab-detail-placeholder"><BookOpen size={30}/><h2>选择词条查看完整释义</h2><p>加入生词本后，再按自己的节奏复习。</p></div>}
   </div>
   {markError&&!(detail&&singleColumn)&&detail?.id!==markError.word.id&&<div className="vocab-alert" role="alert"><b>{markError.word.word} 的生词标记未保存</b><button className="text-button" disabled={!store.ready||!!store.error} onClick={()=>mark(markError.word,markError.starred)}>重试保存标记</button></div>}
   {!(detail&&singleColumn)&&<div className="vocab-study-actions"><span>{!store.ready?'正在读取生词与到期记录':store.error?'生词与到期记录暂不可读':<>生词 {starred} · 到期 {due} <small>{store.sync}</small></>}</span>{!lookupOnly&&<button id={domId('self-test')} className="button secondary" disabled={!filtered.length||!privateReady||initial} onClick={start}>词卡自测{privateReady&&` · ${Math.min(20,filtered.length)} 词`}<ArrowRight size={16}/></button>}</div>}
  </>}
  {!(detail&&singleColumn)&&!session&&<details className="word-notes"><summary>词库来源与记录备份</summary><p>{core.length+extraWords.length} 个场景词和 {questionWords.length} 个题内表达。场景释义为项目原创整理（含 AI 辅助），按 CC BY 4.0 分享；新增词没有现有例句时不生成。通用查词数据来自中文维基词典与 Kaikki，按 CC BY-SA 4.0 使用；已简体转换、归并和节选，未复制第三方音频或例句。两部分不是 ETS 官方词表。</p><p>{owner?'本机保留离线副本，联网后同步到当前账号。':'生词与词卡记录保存在本机，当前未接入账号同步。'}词库备份与听读、录音及模考备份分开。</p><div className="button-row"><button className="button secondary" disabled={!store.ready||!!store.error} onClick={saveBackup}><Download size={16}/>导出词库记录</button><button className="button secondary" disabled={!store.ready||!!store.error} onClick={()=>backupInput.current?.click()}><Upload size={16}/>导入词库记录</button><button className="text-button" onClick={store.retry}>重新同步</button></div><input ref={backupInput} type="file" accept="application/json,.json" hidden onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;const importingOwner=owner;try{if(file.size>20000000)throw Error('备份文件超过 20 MB。');const payload=JSON.parse(await file.text());if(ownerRef.current!==importingOwner)throw Error('账号已切换，未导入这份备份。');if(!activeStore.current.ready||activeStore.current.error)throw Error('词库记录暂未读入，未导入这份备份。');if(activeStore.current.restore(payload))toast.success('词库记录已合并，原记录已保留。');}catch(error){toast.error(error instanceof Error?error.message:'导入失败，原记录已保留。');}}}/></details>}
 </section>;
}
