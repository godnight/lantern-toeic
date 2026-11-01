import {env} from 'cloudflare:workers';
import {readSitesLegacyOwner,legacyPrivateJson} from '@/lib/sites-legacy-identity';
import {legacyTable,legacyReadPage,legacySummary} from '@/lib/sites-legacy-readonly';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const owner=await readSitesLegacyOwner(request);if(owner instanceof Response)return owner;
 if(!env.DB)return legacyPrivateJson({error:'旧版记录暂不可用'},503);
 try{const query=new URL(request.url).searchParams;if(!query.has('table'))return legacyPrivateJson({partition:'sites-legacy',readOnly:true,counts:await legacySummary(env.DB,owner)});
 const table=legacyTable(query.get('table')),after=query.get('after')??'';if(!table||after.length>512)return legacyPrivateJson({error:'分页参数无效'},400);
 return legacyPrivateJson({partition:'sites-legacy',readOnly:true,table,...await legacyReadPage(env.DB,owner,table,after)});
 }catch{return legacyPrivateJson({error:'旧版记录读取失败，请重试'},503);}
}
