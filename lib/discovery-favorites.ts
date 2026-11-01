export type DiscoveryStorage=Pick<Storage,'getItem'|'setItem'>;
export type DiscoveryFavoritesResult=
 |{status:'ready';ids:readonly string[]}
 |{status:'blocked';reason:'access'|'storage'|'corrupt'|'invalid-id'};
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
export function discoveryFavoritesKey(owner:string|null):string {
 return 'lantern-discovery-favorites-v1:'+JSON.stringify(owner);
}
/** A separate local collection. It never writes study history or another owner. */
export function createDiscoveryFavoritesStore({owner,storage,canAccess,isCurrent=()=>true}:{
 owner:string|null;storage:DiscoveryStorage;canAccess:()=>boolean;isCurrent?:()=>boolean;
}){
 const key=discoveryFavoritesKey(owner),allowed=()=>isCurrent()&&canAccess();
 const read=():DiscoveryFavoritesResult=>{
  if(!allowed())return {status:'blocked',reason:'access'};
  let raw:string|null;
  try{raw=storage.getItem(key);}catch{return {status:'blocked',reason:'storage'};}
  if(!allowed())return {status:'blocked',reason:'access'};
  if(raw===null)return {status:'ready',ids:[]};
  try{
   if(raw.length>32768)return {status:'blocked',reason:'corrupt'};
   const value=JSON.parse(raw);
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='ids,kind,owner,schemaVersion'||
    value.kind!=='lantern-discovery-favorites'||value.schemaVersion!==1||value.owner!==owner||!Array.isArray(value.ids)||
    value.ids.length>300||!value.ids.every(validId)||new Set(value.ids).size!==value.ids.length)return {status:'blocked',reason:'corrupt'};
   return {status:'ready',ids:[...value.ids]};
  }catch{return {status:'blocked',reason:'corrupt'};}
 };
 return {key,read,toggle(id:string):DiscoveryFavoritesResult{
  if(!validId(id))return {status:'blocked',reason:'invalid-id'};
  const current=read();if(current.status!=='ready')return current;
  const next=new Set(current.ids);if(next.has(id))next.delete(id);else next.add(id);
  if(next.size>300)return {status:'blocked',reason:'storage'};
  if(!allowed())return {status:'blocked',reason:'access'};
  try{storage.setItem(key,JSON.stringify({kind:'lantern-discovery-favorites',schemaVersion:1,owner,ids:[...next].sort()}));}
  catch{return {status:'blocked',reason:'storage'};}
  if(!allowed())return {status:'blocked',reason:'access'};
  return {status:'ready',ids:[...next].sort()};
 }};
}
