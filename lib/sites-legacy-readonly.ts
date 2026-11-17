import type {SitesLegacyOwner} from './sites-legacy-identity';

export const LEGACY_TABLES={profiles:'user_id',attempts:'id',checkins:'id',recordings:'id',question_marks:'entity_id',resource_tasks:'entity_id',vocabulary_events:'event_id',exam_library:'id'} as const;
export type LegacyTable=keyof typeof LEGACY_TABLES;
export type LegacyRow=Record<string,unknown>;
export const LEGACY_PAGE_SIZE=100;
const privateHeaders={'Cache-Control':'private, no-store, no-transform','Vary':'Cookie, oai-authenticated-user-id','X-Content-Type-Options':'nosniff'};
export function legacyTable(value:string|null):LegacyTable|null {
 return value!==null&&Object.prototype.hasOwnProperty.call(LEGACY_TABLES,value)?value as LegacyTable:null;
}
export async function legacyReadPage(db:D1Database,owner:SitesLegacyOwner,table:LegacyTable,after='') {
 if(after.length>512)throw new Error('Invalid legacy cursor');
 const key=LEGACY_TABLES[table];
 // Both interpolated identifiers come exclusively from the fixed allowlist.
 const {results}=await db.prepare(`SELECT * FROM ${table} WHERE user_id=? AND ${key}>? COLLATE BINARY ORDER BY ${key} COLLATE BINARY LIMIT ?`).bind(owner,after,LEGACY_PAGE_SIZE+1).all<LegacyRow>();
 const rows=results.slice(0,LEGACY_PAGE_SIZE);
 return {rows,nextCursor:results.length>LEGACY_PAGE_SIZE?String(rows.at(-1)![key]):null};
}
export async function legacySummary(db:D1Database,owner:SitesLegacyOwner) {
 const counts={} as Record<LegacyTable,number>;
 for(const table of Object.keys(LEGACY_TABLES) as LegacyTable[]){const row=await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id=?`).bind(owner).first<{count:number}>();counts[table]=Number(row?.count??0);}
 return counts;
}
/** A raw backup, intentionally separate from current-account import formats.
 * Consumers must require the final complete footer before accepting an export.
 * One bounded page remains live; ReadableStream pull respects backpressure. */
export function legacyExportResponse(db:D1Database,owner:SitesLegacyOwner):Response {
 async function* lines(){
  yield JSON.stringify({type:'header',format:'lantern-sites-legacy-readonly',version:1,partition:'sites-legacy',owner})+'\n';
  const counts={} as Record<LegacyTable,number>;
  for(const table of Object.keys(LEGACY_TABLES) as LegacyTable[]){
   counts[table]=0;let after='';
   for(;;){const page=await legacyReadPage(db,owner,table,after);for(const row of page.rows){counts[table]++;yield JSON.stringify({type:'row',table,row})+'\n';}if(!page.nextCursor)break;after=page.nextCursor;}
  }
  yield JSON.stringify({type:'footer',complete:true,counts})+'\n';
 }
 const iterator=lines(),encoder=new TextEncoder();
 const stream=new ReadableStream<Uint8Array>({async pull(controller){try{const part=await iterator.next();if(part.done)controller.close();else controller.enqueue(encoder.encode(part.value));}catch(error){controller.error(error);}},async cancel(){await iterator.return(undefined);}});
 return new Response(stream,{headers:{...privateHeaders,'Content-Type':'application/x-ndjson; charset=utf-8','Content-Disposition':'attachment; filename="lantern-sites-legacy.ndjson"'}});
}
export async function legacyExamDownload(db:D1Database,bucket:R2Bucket,owner:SitesLegacyOwner,id:string):Promise<Response> {
 if(!/^[a-f0-9-]{36}$/.test(id))return Response.json({error:'题包编号无效'},{status:400,headers:privateHeaders});
 const row=await db.prepare('SELECT object_key,bytes,sha256 FROM exam_library WHERE user_id=? AND id=? AND state=?').bind(owner,id,'ready').first<{object_key:string;bytes:number;sha256:string}>();
 if(!row)return Response.json({error:'未找到该旧版题包'},{status:404,headers:privateHeaders});
 const object=await bucket.get(row.object_key);
 if(!object||object.size!==row.bytes)return Response.json({error:'旧版题包暂不可用，请保留已有备份后重试'},{status:503,headers:privateHeaders});
 return new Response(object.body,{headers:{...privateHeaders,'Content-Type':'application/json; charset=utf-8','Content-Length':String(object.size),'Content-Disposition':`attachment; filename="lantern-legacy-exam-${id}.json"`,'X-Exam-Sha256':row.sha256}});
}
export async function legacyRecordingDownload(db:D1Database,bucket:R2Bucket,owner:SitesLegacyOwner,id:string):Promise<Response> {
 if(!/^[-a-z0-9]{36}$/.test(id))return Response.json({error:'录音编号无效'},{status:400,headers:privateHeaders});
 const row=await db.prepare('SELECT object_key FROM recordings WHERE user_id=? AND id=?').bind(owner,id).first<{object_key:string}>();
 if(!row)return Response.json({error:'未找到该旧版录音'},{status:404,headers:privateHeaders});
 const object=await bucket.get(row.object_key);
 if(!object)return Response.json({error:'旧版录音暂不可用，请保留已有备份后重试'},{status:503,headers:privateHeaders});
 const mime=object.httpMetadata?.contentType||'';
 return new Response(object.body,{headers:{...privateHeaders,'Content-Type':/^audio\/[a-z0-9.+-]+$/i.test(mime)?mime:'application/octet-stream','Content-Disposition':`attachment; filename="lantern-legacy-recording-${id}"`}});
}
