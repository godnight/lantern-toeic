import {env} from 'cloudflare:workers';
import {readSitesLegacyOwner,legacyPrivateJson} from '@/lib/sites-legacy-identity';
import {legacyRecordingDownload} from '@/lib/sites-legacy-readonly';
export const dynamic='force-dynamic';
export async function GET(request:Request){const owner=await readSitesLegacyOwner(request);if(owner instanceof Response)return owner;if(!env.DB||!env.BUCKET)return legacyPrivateJson({error:'旧版录音暂不可用'},503);try{return await legacyRecordingDownload(env.DB,env.BUCKET,owner,new URL(request.url).searchParams.get('id')??'');}catch{return legacyPrivateJson({error:'旧版录音读取失败，请重试'},503);}}
