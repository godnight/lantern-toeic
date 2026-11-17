import {env} from 'cloudflare:workers';
import {huaweiProvidersAction} from '@/lib/huawei-auth-service';
export async function GET(request:Request){return huaweiProvidersAction(request,env);}
