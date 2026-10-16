import {headers} from 'next/headers';
import {env} from 'cloudflare:workers';
import {readProductIdentity,sameOriginMutation,authConfiguration,authJson} from './auth-service';
export async function userId(request?:Request){
 try{
  if(request&&new URL(request.url).origin!==authConfiguration(env)?.origin)return null;
  return (await readProductIdentity(request?.headers??new Headers(await headers()),env))?.id??null;
 }
 catch{return null;}
}
export function safeMutation(request:Request){return sameOriginMutation(request);}
export const privateJson=authJson;
