import {env} from 'cloudflare:workers';
import {phoneAuthAction} from '@/lib/phone-auth-service';
export async function POST(request:Request){return phoneAuthAction(request,'bind',env);}
