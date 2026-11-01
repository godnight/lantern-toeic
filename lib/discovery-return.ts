export type DiscoveryCategory='all'|'talk'|'person'|'film'|'library';
export type ResourceLibraryReturnState={category:string;query:string;selectedId:string|null;listPosition:{scroll:number;id:string};scroll:number};
export type DiscoveryReturnState={category:DiscoveryCategory;query:string;savedOnly:boolean;scroll:number;entryId:string|null;library?:ResourceLibraryReturnState};
type ReturnStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const CATEGORIES:readonly DiscoveryCategory[]=['all','talk','person','film','library'];
const key=(owner:string|null)=>'lantern-discovery-return-v1:'+JSON.stringify(owner);
const lifetime=30*60*1000;
function availableStorage():ReturnStorage|null{try{return typeof window==='undefined'?null:window.sessionStorage;}catch{return null;}}
export function readDiscoveryReturn(owner:string|null,storage:ReturnStorage|null=availableStorage(),now=Date.now()):DiscoveryReturnState|null{
 if(!storage||!Number.isFinite(now))return null;
 try{
  const raw=storage.getItem(key(owner));if(!raw||raw.length>16384)return null;
  const value=JSON.parse(raw),state=value?.state;
  if(value?.schemaVersion!==1||value.owner!==owner||typeof value.savedAt!=='number'||!Number.isFinite(value.savedAt)||value.savedAt>now||now-value.savedAt>lifetime||
   !state||!CATEGORIES.includes(state.category)||typeof state.query!=='string'||state.query.length>200||typeof state.savedOnly!=='boolean'||
   !Number.isFinite(state.scroll)||state.scroll<0||state.scroll>10000000||!(state.entryId===null||typeof state.entryId==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(state.entryId)))return null;
  const library=state.library;
  if(library!==undefined&&(!library||typeof library.category!=='string'||library.category.length>40||typeof library.query!=='string'||library.query.length>1000||
   !(library.selectedId===null||typeof library.selectedId==='string'&&library.selectedId.length<=100)||
   !library.listPosition||!Number.isFinite(library.listPosition.scroll)||library.listPosition.scroll<0||library.listPosition.scroll>10000000||typeof library.listPosition.id!=='string'||library.listPosition.id.length>100||
   !Number.isFinite(library.scroll)||library.scroll<0||library.scroll>10000000))return null;
  return {category:state.category,query:state.query,savedOnly:state.savedOnly,scroll:state.scroll,entryId:state.entryId,...library?{library:{category:library.category,query:library.query,selectedId:library.selectedId,listPosition:{scroll:library.listPosition.scroll,id:library.listPosition.id},scroll:library.scroll}}:{}};
 }catch{return null;}
}
export function hasDiscoveryReturn(owner:string|null):boolean{return readDiscoveryReturn(owner)!==null;}
export function rememberDiscoveryReturn(owner:string|null,state:DiscoveryReturnState,storage:ReturnStorage|null=availableStorage(),now=Date.now()):boolean{
 if(!storage)return false;
 try{const encoded=JSON.stringify({schemaVersion:1,owner,savedAt:now,state});
  if(!readDiscoveryReturn(owner,{getItem:()=>encoded,setItem(){},removeItem(){}},now))return false;
  storage.setItem(key(owner),encoded);return true;}catch{return false;}
}
export function clearDiscoveryReturn(owner:string|null,storage:ReturnStorage|null=availableStorage()):void{
 try{storage?.removeItem(key(owner));}catch{/* Never clear any learning data or another owner's state. */}
}
