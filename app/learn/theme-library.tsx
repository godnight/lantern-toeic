'use client';
import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowUpRight,Check,Download,Palette} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {registerNativeBack} from '@/lib/native-host';
import catalogue from '@/art/themes.json';
import referenceData from '@/art/references.json';
import type {Theme} from '@/lib/study-model';

type Reference={id:string;theme:string;title:string;category:string;author:string;sourceUrl:string;imageUrl:string|null;width:number|null;height:number|null;rightsStatus:string;checkedAt:string};
export default function ThemeLibrary({selected,onApply,onBack}:{selected:Theme;onApply:(id:string)=>void;onBack:()=>void}){
 const [id,setId]=useState<string>(selected);const [category,setCategory]=useState('all');
 const [preview,setPreview]=useState<{path:string;title:string;width:number;height:number}|null>(null);
 useEffect(()=>registerNativeBack(()=>{if(!preview)return false;setPreview(null);return true;},50),[preview]);
 const theme=catalogue.themes.find(t=>t.id===id)||catalogue.themes[0];
 const references=(referenceData.references as Reference[]).filter(r=>r.theme===id&&(category==='all'||r.category===category));
 return <section className="art-library">
  <button className="text-button" onClick={onBack}><ArrowLeft size={16}/>�ص�ѧϰ</button>
  <Tabs value={id} onValueChange={value=>{setId(value);setCategory('all');}}><TabsList className="resource-tabs art-theme-tabs">{catalogue.themes.map(t=><TabsTrigger value={t.id} key={t.id}>{t.name}</TabsTrigger>)}</TabsList></Tabs>
  <div className={'art-overview art-'+theme.id}>
   <div className="art-overview-image">{theme.image?<img src={theme.image} alt={theme.name+'ԭ������'} width={1672} height={941}/>:<Palette size={70}/>}</div>
   <div className="art-overview-copy"><p className="eyebrow">{theme.english} / {theme.version}</p><h2>{theme.name}</h2><p>{theme.direction}</p><div className="art-swatches">{theme.palette.map(color=><span key={color}><i style={{background:color}}/>{color}</span>)}</div><button className="button primary" onClick={()=>onApply(theme.id)}>{selected===theme.id?<><Check size={16}/>����ʹ��</>:<>ʹ���������<ArrowUpRight size={16}/></>}</button></div>
  </div>
  {theme.download&&<div className="art-download-row"><a className="button primary" href={theme.download} download><Download size={16}/>����ԭ���زİ�</a><p>�����ͼ���ֻ���ͼ������Դ��ʹ��˵����</p></div>}
  <div className="section-heading"><h2>Ӧ���ز�</h2><span>{theme.assets.length} �� �� ԭ������</span></div>
  {theme.assets.length?<div className="art-asset-grid">{theme.assets.map(asset=><article className="art-asset" key={asset.id}><div className={'art-asset-image '+(asset.height>asset.width?'portrait':'')}><img src={asset.path} alt={asset.title} width={asset.width} height={asset.height} loading="lazy"/></div><div className="art-asset-copy"><h3>{asset.title}</h3><p>{asset.width} �� {asset.height} �� AI ����</p><button onClick={()=>setPreview(asset)} className="text-button">��ԭͼ<ArrowUpRight size={15}/></button></div></article>)}</div>:<p className="art-note">���������Դ�ɫ���Ű���֣��ޱ����廭��</p>}
  <Dialog open={!!preview} onOpenChange={open=>{if(!open)setPreview(null);}}><DialogContent style={{maxWidth:'min(1100px, calc(100vw - 24px))'}}><DialogHeader><DialogTitle>{preview?.title||'�ز�Ԥ��'}</DialogTitle><DialogDescription>{preview?`${preview.width} �� ${preview.height} �� ԭʼ�ز�`:'�鿴����ԭͼ'}</DialogDescription></DialogHeader>{preview&&<img src={preview.path} alt={preview.title} width={preview.width} height={preview.height} style={{display:'block',width:'100%',maxHeight:'70dvh',objectFit:'contain'}}/>}</DialogContent></Dialog>
  {id!=='paper'&&<><div className="section-heading art-reference-heading"><h2>��вο���</h2><span>ԭ�����</span></div><p className="art-note">����ɫ�������� Boss �������㿪�鿴�ٷ�������ԭ�����ο�ͼ����Ӧ�ô����</p><div className="art-download-row"><a className="button secondary" target="_blank" rel="noreferrer" href={id==='hollow'?'https://drive.google.com/drive/folders/1SPCRaalJJepKYOQ4fdxZEzqNukJiUQCo':'https://drive.google.com/drive/folders/1VE_YoUA36IwZRHnZhvEGUhqgU2GIEm4y'}>�򿪹ٷ��زİ�<ArrowUpRight size={16}/></a><p>����Ϸ�����ṩ��ʹ�÷�Χ��ԭվ˵��Ϊ׼��</p></div><Tabs value={category} onValueChange={setCategory}><TabsList className="resource-tabs">{[{id:'all',label:'ȫ��'},{id:'character',label:'��ɫ'},{id:'scene',label:'����'},{id:'boss',label:'Boss'}].map(c=><TabsTrigger value={c.id} key={c.id}>{c.label}</TabsTrigger>)}</TabsList></Tabs><div className="art-reference-grid">{references.map(r=><article key={r.id} className="art-reference"><span className="eyebrow">{r.category.toUpperCase()}</span><h3>{r.title}</h3><p>{r.author}{r.width&&r.height?` �� ${r.width} �� ${r.height}`:''}</p><div><a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-button">�鿴ԭ��<ArrowUpRight size={15}/></a>{r.imageUrl&&<a href={r.imageUrl} target="_blank" rel="noreferrer" className="text-button">ԭͼ���<ArrowUpRight size={15}/></a>}</div><small>{r.rightsStatus==='pending'?'���� �� ��ȷ��ʹ�÷�Χ':'�ٷ��ο� �� ������'} �� ���� {r.checkedAt}</small></article>)}</div>{references.length===0&&<p className="art-note">���������δ��¼���л���������鿴��</p>}</>}
 </section>;
}
