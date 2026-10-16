import {env} from 'cloudflare:workers';
import {sessionAction} from '@/lib/auth-service';
export async function GET(request:Request){return sessionAction(request,'read',env);}
