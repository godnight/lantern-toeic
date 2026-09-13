import {sql} from 'drizzle-orm';
import {questionMarks,resourceTasks} from './schema';
import {mutableRecordCancelled,serializeMutableRecord,type QuestionMark,type ResourceTask} from '../lib/study-model';

// D1 prepares this single parameterized statement. Its ordering is also used by
// compareMutableRecords; stale and duplicate requests are safe to acknowledge.
export function mutableStudyUpsert(kind:'questionMark'|'resourceTask',owner:string,record:QuestionMark|ResourceTask){
 const table=kind==='questionMark'?questionMarks:resourceTasks;
 const entityId='qid' in record?record.qid:record.id;
 return sql`INSERT INTO ${table} (user_id, entity_id, body, revision, cancelled, mutation_id)
 VALUES (${owner}, ${entityId}, ${serializeMutableRecord(record)}, ${record.revision}, ${Number(mutableRecordCancelled(record))}, ${record.mutationId})
 ON CONFLICT(user_id, entity_id) DO UPDATE SET body=excluded.body, revision=excluded.revision, cancelled=excluded.cancelled, mutation_id=excluded.mutation_id
 WHERE excluded.revision > revision
 OR (excluded.revision = revision AND excluded.cancelled > cancelled)
 OR (excluded.revision = revision AND excluded.cancelled = cancelled AND excluded.mutation_id > mutation_id COLLATE BINARY)
 OR (excluded.revision = revision AND excluded.cancelled = cancelled AND excluded.mutation_id = mutation_id AND excluded.body > body COLLATE BINARY)`;
}
