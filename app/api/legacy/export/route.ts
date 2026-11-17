import {env} from 'cloudflare:workers';
import {readSitesLegacyOwner,legacyPrivateJson} from '@/lib/sites-legacy-identity';
import {legacyExportResponse} from '@/lib/sites-legacy-readonly';
export const dynamic='force-dynamic';
export async function GET(request:Request){const owner=await readSitesLegacyOwner(request);if(owner instanceof Response)return owner;if(!env.DB)return legacyPrivateJson({error:'旧版记录暂不可用'},503);return legacyExportResponse(env.DB,owner);}
