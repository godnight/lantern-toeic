// Default-disabled deployment preflight; reads no data unless explicitly used.
import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import path from 'node:path';
const manifestFile=path.join(path.dirname(fileURLToPath(import.meta.url)),'unified-sync-schema-manifest.candidate.json');
const manifestHash='464016aa9e78f90465a751f14281758251a9b9ba5488f2488c6ffb2a11446da8';
const hash=value=>createHash('sha256').update(value).digest('hex');
const exact=(v,k)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('\0')===[...k].sort().join('\0');
export function parseProductionSyncSettings(value,origin,privateRoot){
 if(exact(value,['enabled'])&&value.enabled===false)return {enabled:false};
 if(!exact(value,['enabled','origin','cursorKeyFile','modelSha256'])||value.enabled!==true||value.origin!==origin||typeof value.cursorKeyFile!=='string'||!path.isAbsolute(value.cursorKeyFile)||path.dirname(value.cursorKeyFile)!==privateRoot||typeof value.modelSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.modelSha256))throw Error('invalid protected sync settings');
 return {...value};
}
export async function importPinnedSyncModel(info,expected){
 if(!info||typeof info.sha!=='string'||!/^[a-f0-9]{64}$/.test(expected)||info.sha!==expected||typeof info.importModel!=='function')throw Error('sync model does not match reviewed build');
 return info.importModel();
}
export function requireIndependentSyncKey(key,proxy,phone){
 if(!Buffer.isBuffer(key)||key.length!==32||!Buffer.isBuffer(proxy)||proxy.length!==32||key.equals(proxy)||phone!==undefined&&(!Buffer.isBuffer(phone)||phone.length!==32||key.equals(phone)))throw Error('sync key must be independent');
}
async function manifest(){const data=await readFile(manifestFile);if(hash(data)!==manifestHash)throw Error('sync manifest changed');return JSON.parse(data.toString('utf8'));}
export async function validateSyncDatabase(db){
 if(!db||typeof db.prepare!=='function')throw Error('database unavailable');
 const expected=await manifest(),names=expected.schema.map(x=>x.name),tables=expected.schema.filter(x=>x.type==='table').map(x=>x.name),placeholders=n=>Array(n).fill('?').join(',');
 const rows=(await db.prepare(`SELECT type,name,tbl_name AS tblName,sql FROM sqlite_schema WHERE sql IS NOT NULL AND (name IN (${placeholders(names.length)}) OR tbl_name IN (${placeholders(tables.length)})) ORDER BY type,name`).bind(...names,...tables).all()).results;
 const actual=rows.map(x=>({type:x.type,name:x.name,tblName:x.tblName,sha:hash(x.sql.replace(/\r\n/g,'\n'))}));
 if(JSON.stringify(actual)!==JSON.stringify(expected.schema))throw Error('sync schema mismatch');
 const migrationNames=Object.keys(expected.migrations),ledger=(await db.prepare(`SELECT name,sha FROM _lantern_local_migrations WHERE name IN (${placeholders(migrationNames.length)})`).bind(...migrationNames).all()).results;
 if(ledger.length!==migrationNames.length||ledger.some(row=>!expected.migrations[row.name]?.includes(row.sha)))throw Error('sync migration ledger mismatch');
 const clock=await db.prepare('SELECT epoch,revision,ready FROM study_sync_clock WHERE id=1').first();
 if(!clock||!/^[a-f0-9]{32}$/.test(clock.epoch)||!Number.isSafeInteger(clock.revision)||clock.revision<0||clock.ready!==1)throw Error('sync clock not ready');
 const maximum=await db.prepare('SELECT COALESCE(MAX(revision),0) AS n FROM study_sync_index').first();if(!maximum||maximum.n>clock.revision)throw Error('sync clock mismatch');
 // Older Web records and currently unsupported profile/mark/task records must
 // never disappear silently on enabling the narrower native sync protocol.
 for(const table of ['vocabulary_events','profiles','question_marks','resource_tasks'])if(await db.prepare(`SELECT 1 AS found FROM ${table} LIMIT 1`).first())throw Error('existing unsupported records need migration');
 for(const [table,kind] of [['attempts','attempt'],['checkins','checkin']]){
  const missing=await db.prepare(`SELECT 1 AS found FROM ${table} a LEFT JOIN study_sync_index i ON i.user_id=a.user_id AND i.kind=? AND i.entity_id=a.id AND i.deleted=0 WHERE i.user_id IS NULL LIMIT 1`).bind(kind).first();
  if(missing)throw Error('study index incomplete');
  const orphan=await db.prepare(`SELECT 1 AS found FROM study_sync_index i LEFT JOIN ${table} a ON a.user_id=i.user_id AND a.id=i.entity_id WHERE i.kind=? AND i.deleted=0 AND a.id IS NULL LIMIT 1`).bind(kind).first();
  if(orphan)throw Error('study index inconsistent');
 }
 return true;
}
