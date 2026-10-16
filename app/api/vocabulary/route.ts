import {getDb} from '@/db';
import {sql} from 'drizzle-orm';
import {userId,safeMutation,privateJson} from '@/lib/server-auth';
import {parseVocabularyBackup} from '@/lib/vocabulary-model';
import {readBoundedRequestBody,RequestBodyTooLargeError} from '@/lib/request-body';

export async function GET(request?:Request){
 const owner=await userId(request);if(!owner)return privateJson({error:'请登录后同步'},401);
 try{const rows=await getDb().all<{body:string}>(sql`SELECT body FROM vocabulary_events WHERE user_id = ${owner}`);return privateJson({owner,kind:'lantern-vocabulary',schemaVersion:1,events:rows.map(row=>JSON.parse(row.body))});}
 catch{return privateJson({error:'词库同步暂时不可用，本机记录会保留'},503);}
}
export async function POST(request:Request){
 const owner=await userId(request);if(!owner)return privateJson({error:'请登录后同步'},401);
 if(request.headers.get('x-lantern-owner')!==owner)return privateJson({error:'账号已切换，请刷新'},409);
 if(!safeMutation(request))return privateJson({error:'请求来源不匹配'},403);
 let raw:string;try{raw=await new Response(await readBoundedRequestBody(request,100000)).text();}catch(error){return error instanceof RequestBodyTooLargeError?privateJson({error:'请求过大'},413):privateJson({error:'词库请求读取失败，请稍后重试'},503);}
 let backup;try{backup=parseVocabularyBackup(JSON.parse(raw));if(backup.events.length>25)throw Error('batch');}catch{return privateJson({error:'词库记录格式或批次无效'},400);}
 try{const db=getDb();if(!backup.events.length)return privateJson({ok:true});const values=backup.events.map(event=>sql`(${owner},${event.id},${JSON.stringify(event)})`);await db.run(sql`INSERT INTO vocabulary_events (user_id,event_id,body) VALUES ${sql.join(values,sql`, `)} ON CONFLICT (user_id,event_id) DO NOTHING`);const ids=sql.join(backup.events.map(event=>sql`${event.id}`),sql`, `);const rows=await db.all<{event_id:string;body:string}>(sql`SELECT event_id,body FROM vocabulary_events WHERE user_id=${owner} AND event_id IN (${ids})`);if(backup.events.some(event=>rows.find(row=>row.event_id===event.id)?.body!==JSON.stringify(event))){const response=privateJson({code:'event-payload-conflict',error:'词库记录标识冲突'},409);response.headers.set('X-Lantern-Conflict','event-payload');return response;}return privateJson({ok:true});}
 catch{return privateJson({error:'词库同步暂时不可用'},503);}
}
