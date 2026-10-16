import {env} from 'cloudflare:workers';
import {credentialAction} from '@/lib/auth-service';
export async function POST(request:Request){return credentialAction(request,'login',env);}
