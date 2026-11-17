import catalog from '../content/discovery-catalog.json';
export type DiscoveryKind='talk'|'person'|'film';
export type DiscoveryEntry={
 id:string;kind:DiscoveryKind;title:string;originalTitle:string;author:string;publisher:string;description:string;tags:string[];
 sourceUrl:string;durationSeconds:number|null;durationLabel:string|null;captions:string|null;difficulty:string|null;
 rights:{status:'link-only';holder:string;checkedAt:string;evidenceUrls:string[];reviewAfter:string|null;withdrawal:string;
  capabilities:{embed:false;host:false;excerpt:false;cover:false;subtitles:false;audio:false;ai:false}};
 availability:{platforms:string;regions:string;network:'not-verified';note:string};
};
const text=(value:unknown,max=500):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
export function safeDiscoveryUrl(value:unknown):value is string{
 if(!text(value,2048)||/[\u0000-\u0020\u007f\\]/.test(value))return false;
 try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!!url.hostname&&!url.username&&!url.password;}catch{return false;}
}
export function isDiscoveryEntry(value:unknown):value is DiscoveryEntry{
 if(!object(value)||!text(value.id,80)||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.id)||!['talk','person','film'].includes(String(value.kind))||
  !['title','originalTitle','author','publisher','description'].every(key=>text(value[key]))||!safeDiscoveryUrl(value.sourceUrl)||
  !Array.isArray(value.tags)||value.tags.length>30||!value.tags.every(tag=>text(tag,80))||
  !(value.durationSeconds===null||Number.isSafeInteger(value.durationSeconds)&&Number(value.durationSeconds)>0&&Number(value.durationSeconds)<=86400)||
  !(value.durationLabel===null||text(value.durationLabel,80))||!(value.captions===null||text(value.captions,120))||!(value.difficulty===null||text(value.difficulty,60)))return false;
 const rights=value.rights,availability=value.availability;
 return object(rights)&&rights.status==='link-only'&&text(rights.holder)&&typeof rights.checkedAt==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(rights.checkedAt)&&
  (rights.reviewAfter===null||typeof rights.reviewAfter==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(rights.reviewAfter))&&text(rights.withdrawal)&&
  Array.isArray(rights.evidenceUrls)&&rights.evidenceUrls.length>0&&rights.evidenceUrls.every(safeDiscoveryUrl)&&object(rights.capabilities)&&
  Object.keys(rights.capabilities).sort().join(',')==='ai,audio,cover,embed,excerpt,host,subtitles'&&Object.values(rights.capabilities).every(value=>value===false)&&
  object(availability)&&text(availability.platforms)&&text(availability.regions)&&availability.network==='not-verified'&&text(availability.note);
}
function readCatalog(value:unknown):readonly DiscoveryEntry[]{
 if(!object(value)||value.schemaVersion!==1||!Array.isArray(value.entries)||!value.entries.every(isDiscoveryEntry)||
  new Set(value.entries.map(entry=>entry.id)).size!==value.entries.length)throw Error('发现目录格式无效。');
 return value.entries as DiscoveryEntry[];
}
export const discoveryEntries=readCatalog(catalog);
export const DISCOVERY_KINDS:Readonly<Record<DiscoveryKind,string>>={talk:'演讲',person:'人物',film:'影视'};
export function filterDiscoveryEntries(entries:readonly DiscoveryEntry[],{kind='all',query='',favoritesOnly=false,savedIds=[]}:{
 kind?:DiscoveryKind|'all';query?:string;favoritesOnly?:boolean;savedIds?:readonly string[];
}={}):readonly DiscoveryEntry[]{
 const terms=query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean),saved=new Set(savedIds);
 return entries.filter(entry=>(kind==='all'||entry.kind===kind)&&(!favoritesOnly||saved.has(entry.id))&&
  terms.every(term=>[entry.title,entry.originalTitle,entry.author,entry.publisher,...entry.tags].join(' ').normalize('NFKC').toLocaleLowerCase().includes(term)));
}
export function discoveryDuration(seconds:number|null):string{
 if(seconds===null)return '时长以原站为准';
 return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}
