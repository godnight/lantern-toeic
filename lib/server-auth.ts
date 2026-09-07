import {headers} from 'next/headers';
export async function userId(){return (await headers()).get('oai-authenticated-user-id');}
export function safeMutation(request:Request){const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin;}
export function privateJson(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});}
