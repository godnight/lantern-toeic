import {env} from 'cloudflare:workers';
import {readSitesLegacyOwner,legacyPrivateJson} from '@/lib/sites-legacy-identity';
import {legacyReadPage,legacyExamDownload} from '@/lib/sites-legacy-readonly';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const owner=await readSitesLegacyOwner(request);if(owner instanceof Response)return owner;
 if(!env.DB||!env.BUCKET)return legacyPrivateJson({error:'旧版题包库暂不可用'},503);
 try{const query=new URL(request.url).searchParams,id=query.get('id');if(id)return await legacyExamDownload(env.DB,env.BUCKET,owner,id);
 const after=query.get('after')??'';if(after.length>512)return legacyPrivateJson({error:'分页参数无效'},400);
 return legacyPrivateJson({partition:'sites-legacy',readOnly:true,...await legacyReadPage(env.DB,owner,'exam_library',after)});
 }catch{return legacyPrivateJson({error:'旧版题包读取失败，请重试'},503);}
}
