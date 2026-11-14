export type DiscoveryCategory='all'|'video'|'podcast'|'article'|'library';
export type ResourceLibraryReturnState={category:string;query:string;selectedId:string|null;listPosition:{scroll:number;id:string};scroll:number};
export type DiscoveryReturnState={category:DiscoveryCategory;query:string;savedOnly:boolean;scroll:number;entryId:string|null;sourceIds?:string[];library?:ResourceLibraryReturnState};
type ReturnStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const CATEGORIES:readonly string[]=['all','video','podcast','article','library','talk','person','film'];
const LEGACY_CATEGORIES:Readonly<Record<string,DiscoveryCategory>>={talk:'video',person:'article',film:'video'};
const key=(owner:string|null)=>'lantern-discovery-return-v1:'+JSON.stringify(owner);
const lifetime=30*60*1000;
let returnRevision=0;
function nextRevision():string{
 // The revision distinguishes identical state written in the same millisecond.
 // It is an identity token, not an authentication credential.
 try{if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return crypto.randomUUID();}catch{/* fall back below */}
 return `${Date.now().toString(36)}-${(++returnRevision).toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function availableStorage():ReturnStorage|null{try{return typeof window==='undefined'?null:window.sessionStorage;}catch{return null;}}
export function readDiscoveryReturn(owner:string|null,storage:ReturnStorage|null=availableStorage(),now=Date.now()):DiscoveryReturnState|null{
 if(!storage||!Number.isFinite(now))return null;
 try{
  const raw=storage.getItem(key(owner));if(!raw||raw.length>16384)return null;
  const value=JSON.parse(raw),state=value?.state;
  if(value?.schemaVersion!==1||value.owner!==owner||typeof value.savedAt!=='number'||!Number.isFinite(value.savedAt)||value.savedAt>now||now-value.savedAt>lifetime||
   !state||!CATEGORIES.includes(state.category)||typeof state.query!=='string'||state.query.length>200||typeof state.savedOnly!=='boolean'||
   !Number.isFinite(state.scroll)||state.scroll<0||state.scroll>10000000||!(state.entryId===null||typeof state.entryId==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(state.entryId)))return null;
  const sourceIds=state.sourceIds;
  if(sourceIds!==undefined&&(!Array.isArray(sourceIds)||sourceIds.length>50||!sourceIds.every((id:unknown)=>typeof id==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(id))||new Set(sourceIds).size!==sourceIds.length))return null;
  const library=state.library;
  if(library!==undefined&&(!library||typeof library.category!=='string'||library.category.length>40||typeof library.query!=='string'||library.query.length>1000||
   !(library.selectedId===null||typeof library.selectedId==='string'&&library.selectedId.length<=100)||
   !library.listPosition||!Number.isFinite(library.listPosition.scroll)||library.listPosition.scroll<0||library.listPosition.scroll>10000000||typeof library.listPosition.id!=='string'||library.listPosition.id.length>100||
   !Number.isFinite(library.scroll)||library.scroll<0||library.scroll>10000000))return null;
  return {category:LEGACY_CATEGORIES[state.category]??state.category,query:state.query,savedOnly:state.savedOnly,scroll:state.scroll,entryId:state.entryId,...sourceIds===undefined?{}:{sourceIds:[...sourceIds]},...library?{library:{category:library.category,query:library.query,selectedId:library.selectedId,listPosition:{scroll:library.listPosition.scroll,id:library.listPosition.id},scroll:library.scroll}}:{}};
 }catch{return null;}
}
export function hasDiscoveryReturn(owner:string|null):boolean{return readDiscoveryReturn(owner)!==null;}
/** Validate the exact same bytes returned as token; callers must not persist it. */
export function readDiscoveryReturnSnapshot(owner:string|null,storage:ReturnStorage|null=availableStorage(),now=Date.now()):{state:DiscoveryReturnState;token:string}|null{
 if(!storage)return null;
 try{
  const token=storage.getItem(key(owner));if(token===null)return null;
  const state=readDiscoveryReturn(owner,{getItem:()=>token,setItem(){},removeItem(){}},now);
  return state?{state,token}:null;
 }catch{return null;}
}
export function rememberDiscoveryReturn(owner:string|null,state:DiscoveryReturnState,storage:ReturnStorage|null=availableStorage(),now=Date.now()):boolean{
 if(!storage)return false;
 try{const encoded=JSON.stringify({schemaVersion:1,owner,savedAt:now,revision:nextRevision(),state});
  if(!readDiscoveryReturn(owner,{getItem:()=>encoded,setItem(){},removeItem(){}},now))return false;
  storage.setItem(key(owner),encoded);return true;}catch{return false;}
}
export function clearDiscoveryReturn(owner:string|null,storage:ReturnStorage|null=availableStorage()):void{
 try{storage?.removeItem(key(owner));}catch{/* Never clear any learning data or another owner's state. */}
}
