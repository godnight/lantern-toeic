'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,Download,Search,Star,Upload} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {toast} from 'sonner';
import {registerNativeBack} from '@/lib/native-host';
import {useVocabulary} from '@/lib/use-vocabulary';
import {vocabularyId,CATEGORIES,searchText,searchWords,vocabularyState,type Word} from '@/lib/vocabulary-model';
import wordData from '@/content/vocabulary.json';
import questions from '@/content/questions.json';
import {SpeechPlayer} from './practice';
const core=wordData as Word[];
const questionWords:Word[]=[];
for(const q of questions)for(const v of q.vocabulary||[])if(!core.some(w=>searchText(w.word)===searchText(v.word))&&!questionWords.some(w=>searchText(w.word)===searchText(v.word)))questionWords.push({id:'qv-'+v.word.toLowerCase().replace(/[^a-z0-9]+/g,'-'),word:v.word,pos:'词汇与表达',meaning:v.meaning,category:'questions',example:v.example,translation:'',collocation:''});
const words=[...core,...questionWords];
export function VocabularyEntry({onOpen}:{onOpen:()=>void}){return <button className="vocabulary-entry panel" onClick={onOpen}><span className="vocabulary-entry-icon"><BookOpen size={27}/></span><span><b>托业场景词库</b><small>{core.length} 个场景词 · 释义、例句与词卡自测</small></span><ArrowRight size={20}/></button>;}
export default function VocabularyLibrary({owner,onQuestion}:{owner:string|null;onQuestion:(id:string)=>void}){
 const store=useVocabulary(owner);const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[filter,setFilter]=useState('all'),[limit,setLimit]=useState(24);
 const [detail,setDetail]=useState<Word|null>(null),[session,setSession]=useState<string[]|null>(null),[index,setIndex]=useState(0),[revealed,setRevealed]=useState(false),[now,setNow]=useState(Date.now());
 const input=useRef<HTMLInputElement>(null),answered=useRef(new Set<string>()),sessionId=useRef('');
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
 useEffect(()=>registerNativeBack(()=>{if(detail){setDetail(null);return true;}if(session){setSession(null);return true;}return false;},30),[detail,session]);
 useEffect(()=>{setSession(null);setDetail(null);},[owner]);
 const states=new Map(words.map(w=>[w.id,vocabularyState(store.events,w.id)]));
 const starred=words.filter(w=>states.get(w.id)!.starred).length;const due=words.filter(w=>states.get(w.id)!.due>0&&states.get(w.id)!.due<=now).length;
 const filtered=searchWords(words,query,category).filter(w=>filter==='starred'?states.get(w.id)!.starred:filter==='due'?states.get(w.id)!.due>0&&states.get(w.id)!.due<=now:true);
 const card=session?words.find(w=>w.id===session[index]):null;const finished=!!session&&index>=session.length;
 const reset=()=>setLimit(24);
 const start=()=>{sessionId.current=vocabularyId();answered.current.clear();setSession(filtered.slice(0,20).map(w=>w.id));setIndex(0);setRevealed(false);window.scrollTo({top:0});};
 const grade=(value:'again'|'remembered')=>{if(!card||!revealed)return;const id=sessionId.current+'-'+index;if(answered.current.has(id))return;if(!store.review(card.id,value,id))return;answered.current.add(id);setIndex(i=>i+1);setRevealed(false);setNow(Date.now());};
 const mark=(w:Word)=>store.mark(w.id,!states.get(w.id)!.starred);
 const saveBackup=()=>{try{const url=URL.createObjectURL(new Blob([JSON.stringify(store.backup(),null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='lantern-vocabulary-records.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}catch{toast.error('备份无法读取，请保留浏览器数据后重试。');}};
 const meaning=(w:Word)=><div className="word-definition"><p><span className="word-pos">{w.pos}</span>{w.meaning}</p>{w.collocation&&<p className="word-collocation" lang="en">{w.collocation}</p>}<blockquote lang="en">{w.example}</blockquote>{w.translation&&<p className="muted">{w.translation}</p>}</div>;
 const audio=(w:Word)=><SpeechPlayer key={w.id} text={w.word} label="听单词发音"/>;
 const starButton=(w:Word)=><button className="button secondary" aria-pressed={states.get(w.id)!.starred} disabled={!store.ready||!!store.error} onClick={()=>mark(w)}><Star size={17} fill={states.get(w.id)!.starred?'currentColor':'none'}/>{states.get(w.id)!.starred?'已加入生词本':'加入生词本'}</button>;
 return <section className="vocabulary-library" aria-label="托业场景词库">
 <div className="word-summary"><span><b>{core.length}</b> 场景词</span><span><b>{starred}</b> 生词</span><span><b>{due}</b> 到期复习</span><small role="status">{store.sync}</small></div>
 {store.error&&<div className="panel" role="alert"><p>{store.error}</p><button className="text-button" onClick={store.retry}>重新读取</button></div>}
 {!store.ready?<p role="status">正在读取词库记录…</p>:session?<>
 <div className="word-session-heading"><button className="text-button" onClick={()=>setSession(null)}><ArrowLeft size={16}/>返回词库</button><span>{Math.min(index+1,session.length)} / {session.length}</span></div>
 {finished?<div className="word-flashcard panel"><BookOpen size={36}/><h2>这一组，复习完成</h2><p>已记录 {session.length} 张词卡。忘记的词约 10 分钟后再见；按时记住的词会逐步延长复习间隔。</p><button className="button primary" onClick={()=>setSession(null)}>回到词库</button></div>:card&&<article className="word-flashcard panel" key={card.id}><p className="eyebrow">{CATEGORIES[card.category]} · 先回想，再翻卡</p><h2 lang="en">{card.word}</h2>{audio(card)}{revealed?<>{meaning(card)}<div className="button-row"><button className="button secondary" disabled={!!store.error} onClick={()=>grade('again')}>还没记住</button><button className="button primary" disabled={!!store.error} onClick={()=>grade('remembered')}>记住了<ArrowRight size={16}/></button></div></>:<button className="button primary" onClick={()=>setRevealed(true)}>查看释义与例句</button>}{starButton(card)}<p className="word-footnote">提前自测不会增加复习间隔。词卡自评不计入听读正确率。</p></article>}
 </>:<>
 <div className="word-controls"><label className="word-search"><Search size={19}/><input aria-label="搜索单词或中文释义" placeholder="搜索单词、中文释义或搭配" value={query} onChange={e=>{setQuery(e.target.value);reset();}}/></label><Select value={category} onValueChange={v=>{setCategory(v);reset();}}><SelectTrigger className="word-category" aria-label="词汇场景"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">全部场景</SelectItem>{Object.entries(CATEGORIES).map(([id,label])=><SelectItem value={id} key={id}>{label}</SelectItem>)}</SelectContent></Select></div>
 <div className="word-toolbar"><div className="word-filters" aria-label="词库筛选">{[['all','全部'],['starred','我的生词'],['due','到期复习']].map(([id,label])=><button key={id} aria-pressed={filter===id} onClick={()=>{setFilter(id);reset();}}>{label}</button>)}</div><button className="button primary" disabled={!filtered.length||!!store.error} onClick={start}>词卡自测 · {Math.min(20,filtered.length)} 词<ArrowRight size={16}/></button></div>
 <p className="word-result-count" role="status">找到 {filtered.length} 个词{filtered.length>20?' · 每组自测前 20 个，可按场景或到期状态筛选':''}</p>
 {filtered.length?<div className="word-grid">{filtered.slice(0,limit).map(w=><article className="word-row" key={w.id}><button className="word-open" onClick={()=>setDetail(w)}><small>{CATEGORIES[w.category]}</small><h2 lang="en">{w.word}</h2><p>{w.meaning}</p><span>{states.get(w.id)!.reviews?(states.get(w.id)!.due<=now?'待复习':'已安排复习'):'查看释义与例句'}</span></button><button className="word-star" aria-label={(states.get(w.id)!.starred?'移出生词本：':'加入生词本：')+w.word} aria-pressed={states.get(w.id)!.starred} disabled={!!store.error} onClick={()=>mark(w)}><Star size={20} fill={states.get(w.id)!.starred?'currentColor':'none'}/></button></article>)}</div>:<div className="empty-state"><BookOpen size={30}/><h3>{filter==='starred'?'这里还没有生词':filter==='due'?'暂时没有到期词汇':'没有找到匹配词汇'}</h3><p>可以换个关键词，或查看全部词汇。</p><button className="button secondary" onClick={()=>{setQuery('');setCategory('all');setFilter('all');reset();}}>查看全部词汇</button></div>}
 {filtered.length>limit&&<button className="button secondary word-more" onClick={()=>setLimit(n=>n+24)}>再显示 24 个</button>}
 </>}
 <details className="word-notes"><summary>词库来源与记录备份</summary><p>240 个常见职场与生活场景词，另收录现有练习中的表达。释义、搭配与例句为本项目原创整理（含 AI 辅助），按 CC BY 4.0 分享；不是 ETS 官方词表，也不代表完整考试范围。</p><p>{owner?'本机保留离线副本，联网后同步到当前账号。':'生词与词卡记录保存在本机，当前未接入账号同步。'}词库备份与听读、录音备份分开。卸载或清理应用数据前请导出。</p><div className="button-row"><button className="button secondary" disabled={!store.ready||!!store.error} onClick={saveBackup}><Download size={16}/>导出词库记录</button><button className="button secondary" disabled={!store.ready||!!store.error} onClick={()=>input.current?.click()}><Upload size={16}/>导入词库记录</button><button className="text-button" onClick={store.retry}>重新同步</button></div><input ref={input} type="file" accept="application/json,.json" hidden onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try{if(file.size>20000000)throw Error('备份文件超过 20 MB。');if(store.restore(JSON.parse(await file.text())))toast.success('词库记录已合并，原记录已保留。');}catch(error){toast.error(error instanceof Error?error.message:'导入失败，原记录已保留。');}}}/></details>
 <Dialog open={!!detail} onOpenChange={open=>{if(!open)setDetail(null);}}><DialogContent className="word-dialog"><DialogHeader><DialogTitle lang="en">{detail?.word}</DialogTitle><DialogDescription>{detail&&CATEGORIES[detail.category]}</DialogDescription></DialogHeader>{detail&&<>{audio(detail)}{meaning(detail)}{starButton(detail)}{questions.filter(q=>q.vocabulary?.some(v=>searchText(v.word)===searchText(detail.word))).length>0&&<div className="word-question-links"><h3>在练习里认识它</h3>{questions.filter(q=>q.vocabulary?.some(v=>searchText(v.word)===searchText(detail.word))).map(q=><div key={q.id}>{q.vocabulary.filter(v=>searchText(v.word)===searchText(detail.word)).map((v,i)=><p key={i}>{v.meaning} · <span lang="en">{v.example}</span></p>)}<button className="text-button" onClick={()=>{setDetail(null);onQuestion(q.id);}}>Part {q.part} · {q.title}<ArrowRight size={16}/></button></div>)}</div>}</>}</DialogContent></Dialog>
 </section>;
}
