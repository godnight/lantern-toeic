import {env} from 'cloudflare:workers';
import {phoneFlowAction} from '@/lib/phone-flow-service';
export async function GET(request:Request){return phoneFlowAction(request,'status',env);}
