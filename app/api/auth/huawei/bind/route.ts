import {env} from 'cloudflare:workers';
import {huaweiAuthAction} from '@/lib/huawei-auth-service';
export async function POST(request:Request){return huaweiAuthAction(request,'bind',env);}
