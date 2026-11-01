/** Owner-scoped M2a pagination. Unwired candidate: never initializes or
 * migrates production storage. Recording rows are excluded in SQL, including
 * from the cursor, so neither audio nor metadata leaves this boundary. */
import {DATA_SCHEMA_VERSION} from '../lib/study-model';
import {STUDY_SYNC_MAX_PAGE_BYTES,STUDY_SYNC_PAGE_SIZE,STUDY_SYNC_PROTOCOL,StudySyncError,decodeStudySyncToken,encodeStudySyncToken,parseStudySyncPage,parseStudySyncRequest,type StudySyncKind,type StudySyncPage} from '../lib/study-sync';

// M2a intentionally excludes recording metadata. Its checkpoints must never
// be mistaken for a complete Web pages-v1 checkpoint on the same account.
export const NATIVE_M2A_PROTOCOL = 'native-m2a-v1' as const;

type Row = {revision:number; kind:StudySyncKind; entityId:string; deleted:number; body:string|null};

const PREFIX = 'n1.'; // The dot makes a native token invalid in pages-v1.
const PADDED_BYTES = 1536, IV_BYTES = 12, TAG_BYTES = 16;
const b64 = (bytes:Uint8Array) => btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const aad = (owner:string) => new TextEncoder().encode(NATIVE_M2A_PROTOCOL+'\u0000'+owner);

/** Tokens are fixed length and AEAD encrypted with a server-only key. A plain
 * global revision, even inside base64, leaks cross-owner activity counts. */
async function wrapNativeToken(token:string,key:CryptoKey,owner:string):Promise<string> {
 const body = new TextEncoder().encode(JSON.stringify({scope:NATIVE_M2A_PROTOCOL,token}));
 if (body.byteLength > PADDED_BYTES-2) throw new StudySyncError('同步游标过大',503);
 const padded = new Uint8Array(PADDED_BYTES);
 new DataView(padded.buffer).setUint16(0,body.byteLength,false); padded.set(body,2);
 const iv=crypto.getRandomValues(new Uint8Array(IV_BYTES));
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(owner),tagLength:128},key,padded));
 const output=new Uint8Array(iv.byteLength+encrypted.byteLength);output.set(iv);output.set(encrypted,iv.byteLength);
 return PREFIX+b64(output);
}
async function unwrapNativeToken(encoded:string,key:CryptoKey,owner:string):Promise<string> {
 try {
  if (!encoded.startsWith(PREFIX) || !/^[A-Za-z0-9_-]{1,4096}$/.test(encoded.slice(PREFIX.length))) throw new Error('Invalid token');
  const payload=encoded.slice(PREFIX.length), raw=atob(payload.replace(/-/g,'+').replace(/_/g,'/'));
  const bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));
  if (bytes.byteLength!==IV_BYTES+PADDED_BYTES+TAG_BYTES || b64(bytes)!==payload) throw new Error('Invalid token');
  const clear=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,IV_BYTES),additionalData:aad(owner),tagLength:128},key,bytes.slice(IV_BYTES)));
  if (clear.byteLength!==PADDED_BYTES) throw new Error('Invalid token');
  const length=new DataView(clear.buffer,clear.byteOffset,clear.byteLength).getUint16(0,false);
  if (length===0 || length>PADDED_BYTES-2) throw new Error('Invalid token');
  const value:unknown = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(clear.slice(2,2+length)));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid token');
  const record=value as Record<string,unknown>;
  if (Object.keys(record).sort().join(',') !== 'scope,token' || record.scope !== NATIVE_M2A_PROTOCOL || typeof record.token !== 'string' || !/^[A-Za-z0-9_-]{1,4096}$/.test(record.token)) throw new Error('Invalid token');
  return record.token;
 } catch { throw new StudySyncError('同步游标范围不匹配，请保留本机记录后重新同步',409,true); }
}

export async function readNativeStudyPage(db:D1Database, owner:string, url:URL, key:CryptoKey) {
 const clock = await db.prepare('SELECT epoch, revision FROM study_sync_clock WHERE id=1 AND ready=1').first<{epoch:string;revision:number}>();
 if (!clock) throw new StudySyncError('同步索引尚未准备完成',503);
 const internalUrl = new URL(url);
 for (const name of ['cursor','checkpoint'] as const) {
  const token = url.searchParams.get(name);
  if (!token) continue;
  const inner = await unwrapNativeToken(token,key,owner);
  const decoded = decodeStudySyncToken(inner) as {after?:{kind?:unknown}} | null;
  if (!decoded || (name === 'cursor' && !['profile','attempt','checkin','questionMark','resourceTask'].includes(String(decoded.after?.kind)))) throw new StudySyncError('同步游标范围不匹配，请保留本机记录后重新同步',409,true);
  internalUrl.searchParams.set(name,inner);
 }
 const cursor = parseStudySyncRequest(internalUrl,owner,clock);
 const query = `SELECT i.revision, i.kind, i.entity_id AS entityId, i.deleted,
 CASE i.kind
 WHEN 'profile' THEN (SELECT p.body FROM profiles p WHERE p.user_id=i.user_id)
 WHEN 'attempt' THEN (SELECT json_object('id',a.id,'qid',a.qid,'choice',a.choice,'correct',json(CASE WHEN a.correct=1 THEN 'true' ELSE 'false' END),'createdAt',a.created_at,'seconds',a.seconds,'mode',a.mode) FROM attempts a WHERE a.user_id=i.user_id AND a.id=i.entity_id)
 WHEN 'checkin' THEN (SELECT c.body FROM checkins c WHERE c.user_id=i.user_id AND c.id=i.entity_id)
 WHEN 'questionMark' THEN (SELECT m.body FROM question_marks m WHERE m.user_id=i.user_id AND m.entity_id=i.entity_id)
 WHEN 'resourceTask' THEN (SELECT t.body FROM resource_tasks t WHERE t.user_id=i.user_id AND t.entity_id=i.entity_id)
 END AS body FROM study_sync_index i
 WHERE i.user_id=? AND i.kind IN ('profile','attempt','checkin','questionMark','resourceTask')
 AND i.revision>? AND i.revision<=? AND (i.deleted=0 OR ?>0)
 AND (i.revision>? OR (i.revision=? AND i.kind>? COLLATE BINARY)
 OR (i.revision=? AND i.kind=? AND i.entity_id>? COLLATE BINARY))
 ORDER BY i.revision ASC, i.kind COLLATE BINARY ASC, i.entity_id COLLATE BINARY ASC LIMIT ?`;
 const response = await db.prepare(query).bind(owner,cursor.since,cursor.watermark,cursor.since,cursor.after.revision,cursor.after.revision,cursor.after.kind,cursor.after.revision,cursor.after.kind,cursor.after.id,STUDY_SYNC_PAGE_SIZE+1).all<Row>();
 if (!response.success) throw new StudySyncError('同步暂时不可用',503);
 const rows = response.results;
 const profile = await db.prepare('SELECT 1 AS present FROM profiles WHERE user_id=?').bind(owner).first<{present:number}>();
 const selected:Row[] = [], changes:StudySyncPage['changes'] = []; let bytes = 0;
 for (const row of rows.slice(0,STUDY_SYNC_PAGE_SIZE)) {
  if (row.deleted || row.body === null) throw new StudySyncError('云端记录已删除或索引不一致，请保留本机备份后检查',409,true);
  const change = {revision:row.revision,kind:row.kind,id:row.entityId,data:JSON.parse(row.body)};
  const size = new TextEncoder().encode(JSON.stringify(change)).byteLength;
  if (bytes + size > STUDY_SYNC_MAX_PAGE_BYTES - 8192) { if (!selected.length) throw new StudySyncError('单条记录过大',503); break; }
  selected.push(row); changes.push(change); bytes += size;
 }
 const more = rows.length > selected.length, tail = selected.at(-1);
 const checkpoint = more ? null : {version:1 as const,owner,epoch:cursor.epoch,revision:cursor.watermark};
 const nextCursor = more && tail ? encodeStudySyncToken({...cursor,after:{revision:tail.revision,kind:tail.kind,id:tail.entityId}}) : null;
 // Validate before returning: owner, ordering, byte limits and schema are
 // identical to the existing pages-v1 client contract.
 const checked = parseStudySyncPage({syncProtocol:STUDY_SYNC_PROTOCOL,schemaVersion:DATA_SCHEMA_VERSION,owner,hasProfile:!!profile,changes,nextCursor,checkpoint},owner);
 const nativeNext = checked.nextCursor ? await wrapNativeToken(checked.nextCursor,key,owner) : null;
 const nativeCheckpoint = checkpoint ? await wrapNativeToken(encodeStudySyncToken(checkpoint),key,owner) : null;
 // Array order is authoritative. Do not emit global per-row revisions either;
 // those would disclose other owners' activity between this owner's writes.
 return {syncProtocol:NATIVE_M2A_PROTOCOL,schemaVersion:checked.schemaVersion,owner:checked.owner,hasProfile:checked.hasProfile,profilePolicy:'preserve-local-when-absent' as const,changes:checked.changes.map(({kind,id,data})=>({kind,id,data})),nextCursor:nativeNext,checkpoint:nativeCheckpoint};
}
