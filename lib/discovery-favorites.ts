import { DISCOVERY_SEED, restoreSavedDiscoveryItem } from './discovery-feed';
import type { DiscoveryItem } from './discovery-feed-contract';
export type DiscoveryStorage=Pick<Storage,'getItem'|'setItem'>;
type SavedRef={id:string;title:string;sourceUrl:string;publishedAt:string|null};
export type DiscoveryFavoritesResult=
 |{status:'ready';ids:readonly string[];entries:readonly DiscoveryItem[]}
 |{status:'blocked';reason:'access'|'storage'|'corrupt'|'invalid-id'};
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
export function discoveryFavoritesKey(owner:string|null):string {
 return 'lantern-discovery-favorites-v1:'+JSON.stringify(owner);
}
/** One owner-scoped atomic record holds IDs and bounded public references. */
export function createDiscoveryFavoritesStore({owner,storage,canAccess,isCurrent=()=>true}:{
 owner:string|null;storage:DiscoveryStorage;canAccess:()=>boolean;isCurrent?:()=>boolean;
}){
 const key=discoveryFavoritesKey(owner),allowed=()=>{try{return isCurrent()&&canAccess();}catch{return false;}};
 type RecordData={ids:string[];items:SavedRef[]};
 const load=():{status:'ready';data:RecordData}|Extract<DiscoveryFavoritesResult,{status:'blocked'}>=>{
  if(!allowed())return {status:'blocked',reason:'access'};
  let raw:string|null;
  try{raw=storage.getItem(key);}catch{return {status:'blocked',reason:'storage'};}
  if(!allowed())return {status:'blocked',reason:'access'};
  if(raw===null)return {status:'ready',data:{ids:[],items:[]}};
  try{
   if(raw.length>512*1024)return {status:'blocked',reason:'corrupt'};
   const value=JSON.parse(raw);
   if(!value||typeof value!=='object'||Array.isArray(value)||value.kind!=='lantern-discovery-favorites'||value.owner!==owner||
    !Array.isArray(value.ids)||value.ids.length>300||!value.ids.every(validId)||new Set(value.ids).size!==value.ids.length)return {status:'blocked',reason:'corrupt'};
   if(value.schemaVersion===1){
    if(Object.keys(value).sort().join(',')!=='ids,kind,owner,schemaVersion'||raw.length>32768)return {status:'blocked',reason:'corrupt'};
    return {status:'ready',data:{ids:[...value.ids],items:[]}};
   }
   if((value.schemaVersion!==2&&value.schemaVersion!==3)||Object.keys(value).sort().join(',')!=='ids,items,kind,owner,schemaVersion'||!Array.isArray(value.items)||value.items.length>300)return {status:'blocked',reason:'corrupt'};
   const seen=new Set<string>(),items:SavedRef[]=[];
   for(const ref of value.items){
    if(!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).sort().join(',')!==(value.schemaVersion===2?'id,sourceUrl,title':'id,publishedAt,sourceUrl,title')||!value.ids.includes(ref.id)||seen.has(ref.id)||(value.schemaVersion===3&&ref.publishedAt!==null&&typeof ref.publishedAt!=='string')||!restoreSavedDiscoveryItem(ref))return {status:'blocked',reason:'corrupt'};
    seen.add(ref.id);items.push({id:ref.id,title:ref.title,sourceUrl:ref.sourceUrl,publishedAt:value.schemaVersion===2?null:ref.publishedAt});
   }
   return {status:'ready',data:{ids:[...value.ids],items}};
  }catch{return {status:'blocked',reason:'corrupt'};}
 };
 const result=(data:RecordData):DiscoveryFavoritesResult=>{
  const ids=new Set(data.ids),entries:DiscoveryItem[]=[];
  for(const item of DISCOVERY_SEED)if(ids.has(item.id))entries.push(item);
  for(const ref of data.items){const item=restoreSavedDiscoveryItem(ref);if(item)entries.push(item);}
  return {status:'ready',ids:[...data.ids],entries};
 };
 const save=(data:RecordData):DiscoveryFavoritesResult=>{
  if(!allowed())return {status:'blocked',reason:'access'};
  const raw=JSON.stringify({kind:'lantern-discovery-favorites',schemaVersion:3,owner,ids:data.ids.sort(),items:data.items.sort((a,b)=>a.id.localeCompare(b.id))});
  if(raw.length>512*1024)return {status:'blocked',reason:'storage'};
  try{storage.setItem(key,raw);}catch{return {status:'blocked',reason:'storage'};}
  if(!allowed())return {status:'blocked',reason:'access'};
  return result(data);
 };
 const refFor=(entry:DiscoveryItem):SavedRef|null=>{
  const ref={id:entry.id,title:entry.title,sourceUrl:entry.sourceUrl,publishedAt:entry.publishedAt??null};
  return (entry.sourceId==='99pi'||entry.sourceId.startsWith('cgtn-'))&&entry.kind==='podcast'&&entry.language==='en'&&entry.originalLanguage==='en'&&restoreSavedDiscoveryItem(ref)?ref:null;
 };
 const read=():DiscoveryFavoritesResult=>{const state=load();return state.status==='ready'?result(state.data):state;};
 return {key,read,toggle(id:string,entry?:DiscoveryItem):DiscoveryFavoritesResult{
  if(!validId(id)||entry&&entry.id!==id)return {status:'blocked',reason:'invalid-id'};
  const state=load();if(state.status!=='ready')return state;
  const {ids,items}=state.data,index=ids.indexOf(id);
  if(index>=0){ids.splice(index,1);state.data.items=items.filter(ref=>ref.id!==id);}
  else{
   if(ids.length>=300)return {status:'blocked',reason:'storage'};
   const ref=entry?refFor(entry):null;
   if((id.startsWith('99pi-')||id.startsWith('cgtn-'))&&!DISCOVERY_SEED.some(item=>item.id===id)&&!ref)return {status:'blocked',reason:'invalid-id'};
   ids.push(id);if(ref)items.push(ref);
  }
  return save(state.data);
 },capture(entries:readonly DiscoveryItem[]):DiscoveryFavoritesResult{
  const state=load();if(state.status!=='ready')return state;
  const ids=new Set(state.data.ids),existing=new Set(state.data.items.map(x=>x.id));let changed=false;
  for(const entry of entries){if(!ids.has(entry.id)||existing.has(entry.id))continue;const ref=refFor(entry);if(ref){state.data.items.push(ref);existing.add(ref.id);changed=true;}}
  return changed?save(state.data):result(state.data);
 }};
}
