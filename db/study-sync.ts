import {sql} from 'drizzle-orm';
import type {getDb} from './index';
import {DATA_SCHEMA_VERSION} from '../lib/study-model';
import {STUDY_SYNC_PROTOCOL,STUDY_SYNC_PAGE_SIZE,STUDY_SYNC_MAX_PAGE_BYTES,StudySyncError,parseStudySyncRequest,encodeStudySyncToken,type StudySyncKind,type StudySyncPage} from '../lib/study-sync';

type Db=ReturnType<typeof getDb>;
type IndexedRow={revision:number;kind:StudySyncKind;entityId:string;deleted:number;body:string|null};
/** Every table mutation and index revision are one SQLite trigger transaction.
 * Only one latest revision per entity is retained: this is not an ever-growing
 * operation log. A moving entity above this run's watermark is read next run. */
export async function readStudySyncPage(db:Db,owner:string,url:URL):Promise<StudySyncPage>{
 const clock=await db.get<{epoch:string;revision:number}>(sql`SELECT epoch, revision FROM study_sync_clock WHERE id=1 AND ready=1`);
 if(!clock)throw new StudySyncError('同步索引尚未准备完成',503);
 const cursor=parseStudySyncRequest(url,owner,clock);
 const rows=await db.all<IndexedRow>(sql`
 SELECT i.revision, i.kind, i.entity_id AS entityId, i.deleted,
 CASE i.kind
 WHEN 'profile' THEN (SELECT p.body FROM profiles p WHERE p.user_id=i.user_id)
 WHEN 'attempt' THEN (SELECT json_object('id',a.id,'qid',a.qid,'choice',a.choice,'correct',json(CASE WHEN a.correct=1 THEN 'true' ELSE 'false' END),'createdAt',a.created_at,'seconds',a.seconds,'mode',a.mode) FROM attempts a WHERE a.user_id=i.user_id AND a.id=i.entity_id)
 WHEN 'checkin' THEN (SELECT c.body FROM checkins c WHERE c.user_id=i.user_id AND c.id=i.entity_id)
 WHEN 'recording' THEN (SELECT r.body FROM recordings r WHERE r.user_id=i.user_id AND r.id=i.entity_id)
 WHEN 'questionMark' THEN (SELECT m.body FROM question_marks m WHERE m.user_id=i.user_id AND m.entity_id=i.entity_id)
 WHEN 'resourceTask' THEN (SELECT t.body FROM resource_tasks t WHERE t.user_id=i.user_id AND t.entity_id=i.entity_id)
 END AS body
 FROM study_sync_index i
 WHERE i.user_id=${owner} AND i.revision>${cursor.since} AND i.revision<=${cursor.watermark}
 AND (i.deleted=0 OR ${cursor.since}>0)
 AND (i.revision>${cursor.after.revision}
 OR (i.revision=${cursor.after.revision} AND i.kind>${cursor.after.kind} COLLATE BINARY)
 OR (i.revision=${cursor.after.revision} AND i.kind=${cursor.after.kind} AND i.entity_id>${cursor.after.id} COLLATE BINARY))
 ORDER BY i.revision ASC, i.kind COLLATE BINARY ASC, i.entity_id COLLATE BINARY ASC
 LIMIT ${STUDY_SYNC_PAGE_SIZE+1}`);
 const profile=await db.get<{present:number}>(sql`SELECT 1 AS present FROM profiles WHERE user_id=${owner}`);
 const selected:IndexedRow[]=[];
 const changes:StudySyncPage['changes']=[];
 // Count and UTF-8 byte bounds both apply: 100 valid Chinese notes can exceed
 // the byte cap even though each note satisfies the existing POST schema.
 let bytes=0;
 for(const row of rows.slice(0,STUDY_SYNC_PAGE_SIZE)){
  // An incremental reader sees an explicit reset; a fresh baseline contains
  // only currently present rows. Local facts are never deleted by this helper.
  if(row.deleted||row.body===null)throw new StudySyncError('云端记录已删除或索引不一致，请保留本机备份后检查',409,true);
  const change={revision:row.revision,kind:row.kind,id:row.entityId,data:JSON.parse(row.body)};
  const size=new TextEncoder().encode(JSON.stringify(change)).byteLength;
  if(bytes+size>STUDY_SYNC_MAX_PAGE_BYTES-8192){if(!selected.length)throw new StudySyncError('单条同步记录超过安全大小，请保留本机记录后检查',503);break;}
  selected.push(row);changes.push(change);bytes+=size;
 }
 const more=rows.length>selected.length;
 const tail=selected.at(-1);
 const checkpoint=more?null:{version:1 as const,owner,epoch:cursor.epoch,revision:cursor.watermark};
 const nextCursor=more&&tail?encodeStudySyncToken({...cursor,after:{revision:tail.revision,kind:tail.kind,id:tail.entityId}}):null;
 const page:StudySyncPage={syncProtocol:STUDY_SYNC_PROTOCOL,schemaVersion:DATA_SCHEMA_VERSION,owner,hasProfile:!!profile,changes,nextCursor,checkpoint};
 if(new TextEncoder().encode(JSON.stringify(page)).byteLength>STUDY_SYNC_MAX_PAGE_BYTES)throw new StudySyncError('同步分页超过安全大小，请保留本机记录后检查',503);
 return page;
}
