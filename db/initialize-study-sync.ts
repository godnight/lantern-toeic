/** Bounded derived-index initialization, invoked after product authentication.
 * Does not create schema, mutate original facts, assign owners or reset ready.
 * D1 batch is one transaction; each invocation inserts at most 6*limit entries. */
const kinds=[['profiles','profile','user_id'],['attempts','attempt','id'],['checkins','checkin','id'],['recordings','recording','id'],['question_marks','questionMark','entity_id'],['resource_tasks','resourceTask','entity_id']] as const;
export async function initializeStudySyncBatch(db:D1Database,limit=100){
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Initialization batch limit must be 1–100');
 const epoch=crypto.randomUUID().replace(/-/g,'');
 const statements=[db.prepare(`INSERT OR IGNORE INTO study_sync_clock(id,epoch,revision,ready) SELECT 1,?,MAX(COALESCE(MAX(revision),1),1),0 FROM study_sync_index`).bind(epoch)];
 for(const [table,kind,key] of kinds)statements.push(db.prepare(`INSERT OR IGNORE INTO study_sync_index(user_id,kind,entity_id,revision,deleted)
 SELECT t.user_id,?,t.${key},(SELECT revision FROM study_sync_clock WHERE id=1),0 FROM ${table} t
 WHERE (SELECT ready FROM study_sync_clock WHERE id=1)=0 AND NOT EXISTS
 (SELECT 1 FROM study_sync_index i WHERE i.user_id=t.user_id AND i.kind=? AND i.entity_id=t.${key})
 ORDER BY t.user_id COLLATE BINARY,t.${key} COLLATE BINARY LIMIT ?`).bind(kind,kind,limit));
 const missing=kinds.map(([table,kind,key])=>`NOT EXISTS(SELECT 1 FROM ${table} t WHERE NOT EXISTS(SELECT 1 FROM study_sync_index i WHERE i.user_id=t.user_id AND i.kind='${kind}' AND i.entity_id=t.${key}) LIMIT 1)`).join(' AND ');
 statements.push(db.prepare(`UPDATE study_sync_clock SET ready=1 WHERE id=1 AND ready=0 AND ${missing}`));
 const result=await db.batch(statements);
 const clock=await db.prepare('SELECT revision,ready FROM study_sync_clock WHERE id=1').first<{revision:number;ready:number}>();
 if(!clock)throw new Error('Initialization clock is missing');
 return {ready:clock.ready===1,revision:clock.revision,inserted:result.slice(1,7).reduce((sum,r)=>sum+Number(r.meta.changes??0),0),maxInserted:6*limit};
}
