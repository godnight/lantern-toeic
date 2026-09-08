'use client';
import {useState} from 'react';
import {ArrowLeft,ArrowUpRight,Check,Download,Palette} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import catalogue from '@/art/themes.json';
import referenceData from '@/art/references.json';
import type {Theme} from '@/lib/study-model';

type Reference={id:string;theme:string;title:string;category:string;author:string;sourceUrl:string;imageUrl:string|null;width:number|null;height:number|null;rightsStatus:string;checkedAt:string};
export default function ThemeLibrary({selected,onApply,onBack}:{selected:Theme;onApply:(id:string)=>void;onBack:()=>void}){
 const [id,setId]=useState<string>(selected);const [category,setCategory]=useState('all');
 const theme=catalogue.themes.find(t=>t.id===id)||catalogue.themes[0];
 const references=(referenceData.references as Reference[]).filter(r=>r.theme===id&&(category==='all'||r.category===category));
 return <section className="art-library">
  <button className="text-button" onClick={onBack}><ArrowLeft size={16}/>回到学习</button>
  <Tabs value={id} onValueChange={value=>{setId(value);setCategory('all');}}><TabsList className="resource-tabs art-theme-tabs">{catalogue.themes.map(t=><TabsTrigger value={t.id} key={t.id}>{t.name}</TabsTrigger>)}</TabsList></Tabs>
  <div className={'art-overview art-'+theme.id}>
   <div className="art-overview-image">{theme.image?<img src={theme.image} alt={theme.name+'原创环境'} width={1672} height={941}/>:<Palette size={70}/>}</div>
   <div className="art-overview-copy"><p className="eyebrow">{theme.english} / {theme.version}</p><h2>{theme.name}</h2><p>{theme.direction}</p><div className="art-swatches">{theme.palette.map(color=><span key={color}><i style={{background:color}}/>{color}</span>)}</div><button className="button primary" onClick={()=>onApply(theme.id)}>{selected===theme.id?<><Check size={16}/>正在使用</>:<>使用这个主题<ArrowUpRight size={16}/></>}</button></div>
  </div>
  <div className="section-heading"><h2>应用素材</h2><span>{theme.assets.length} 幅 · 原创生成</span></div>
  {theme.assets.length?<div className="art-asset-grid">{theme.assets.map(asset=><article className="art-asset" key={asset.id}><div className={'art-asset-image '+(asset.height>asset.width?'portrait':'')}><img src={asset.path} alt={asset.title} width={asset.width} height={asset.height} loading="lazy"/></div><div className="art-asset-copy"><h3>{asset.title}</h3><p>{asset.width} × {asset.height} · AI 生成</p><a href={asset.path} target="_blank" rel="noreferrer" className="text-button">打开原图<Download size={15}/></a></div></article>)}</div>:<p className="art-note">这套主题以纯色和排版呈现，无背景插画。</p>}
  {id!=='paper'&&<><div className="section-heading art-reference-heading"><h2>灵感参考库</h2><span>原作入口</span></div><p className="art-note">按角色、场景与 Boss 整理。点开查看官方或作者原作；参考图不随应用打包。</p><Tabs value={category} onValueChange={setCategory}><TabsList className="resource-tabs">{[{id:'all',label:'全部'},{id:'character',label:'角色'},{id:'scene',label:'场景'},{id:'boss',label:'Boss'}].map(c=><TabsTrigger value={c.id} key={c.id}>{c.label}</TabsTrigger>)}</TabsList></Tabs><div className="art-reference-grid">{references.map(r=><article key={r.id} className="art-reference"><span className="eyebrow">{r.category.toUpperCase()}</span><h3>{r.title}</h3><p>{r.author}{r.width&&r.height?` · ${r.width} × ${r.height}`:''}</p><div><a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-button">查看原作<ArrowUpRight size={15}/></a>{r.imageUrl&&<a href={r.imageUrl} target="_blank" rel="noreferrer" className="text-button">原图入口<ArrowUpRight size={15}/></a>}</div><small>{r.rightsStatus==='pending'?'二创 · 待确认使用范围':'官方参考 · 仅外链'} · 核验 {r.checkedAt}</small></article>)}</div>{references.length===0&&<p className="art-note">这个分类暂未收录，切换其他分类查看。</p>}</>}
 </section>;
}
