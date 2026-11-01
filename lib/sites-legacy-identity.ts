import {env} from 'cloudflare:workers';
import {notFound} from 'next/navigation';
import {getChatGPTUser,requireChatGPTUser} from '@/app/chatgpt-auth';

export type SitesLegacyOwner=string & {readonly __sitesLegacyOwner:unique symbol};
type LegacyConfig={LANTERN_SITES_LEGACY_READONLY_ENABLED?:string;LANTERN_SITES_LEGACY_ORIGIN?:string};

/** Server configuration only. Authentication is supplied by Sites dispatch and
 * the official server helper; a client flag/header cannot enable this adapter.
 * Never configure this on a directly reachable Worker or local/native build. */
export function sitesLegacyOrigin(config:LegacyConfig):string|null {
 if(config.LANTERN_SITES_LEGACY_READONLY_ENABLED!=='true'||!config.LANTERN_SITES_LEGACY_ORIGIN)return null;
 try{const u=new URL(config.LANTERN_SITES_LEGACY_ORIGIN);return u.protocol==='https:'&&u.origin===config.LANTERN_SITES_LEGACY_ORIGIN?u.origin:null;}catch{return null;}
}
function owner(value:unknown):SitesLegacyOwner|null {
 return typeof value==='string'&&value.length>0&&value.length<=256&&value===value.trim()&&!/[\x00-\x1f\x7f]/.test(value)&&!value.startsWith('usr_')?value as SitesLegacyOwner:null;
}
export function legacyPrivateJson(data:unknown,status=200):Response {
 return Response.json(data,{status,headers:{'Cache-Control':'private, no-store, no-transform','Vary':'Cookie, oai-authenticated-user-id','X-Content-Type-Options':'nosniff'}});
}
export async function readSitesLegacyOwner(request:Request):Promise<SitesLegacyOwner|Response> {
 const origin=sitesLegacyOrigin(env as LegacyConfig);
 if(!origin||new URL(request.url).origin!==origin)return legacyPrivateJson({error:'未启用旧版记录入口'},404);
 // Request query/body and request.headers never provide an owner here.
 const identity=await getChatGPTUser();
 const id=owner(identity?.userId);
 return id??legacyPrivateJson({error:'请使用原 Sites 账号登录后查看旧版记录'},401);
}
export async function requireSitesLegacyOwner():Promise<SitesLegacyOwner> {
 if(!sitesLegacyOrigin(env as LegacyConfig))notFound();
 const identity=await requireChatGPTUser('/legacy');
 const id=owner(identity.userId);if(!id)notFound();return id;
}
