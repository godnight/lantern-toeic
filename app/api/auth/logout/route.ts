import {env} from 'cloudflare:workers';
import {sessionAction} from '@/lib/auth-service';
export async function POST(request:Request){return sessionAction(request,'logout',env);}
