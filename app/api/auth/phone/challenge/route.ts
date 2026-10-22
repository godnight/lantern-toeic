import {env} from 'cloudflare:workers';
import {phoneFlowAction} from '@/lib/phone-flow-service';
export async function POST(request:Request){return phoneFlowAction(request,'challenge',env);}
