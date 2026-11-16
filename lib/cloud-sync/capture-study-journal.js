// Synthetic-only journal capture. This module is not connected to the app.
// A loose journal is not a complete migration: snapshots, compacted records,
// settings and recordings require a separate migration and lifecycle fence.
const OWNER=/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Preserve operation ids across rescans and process restarts. A source entry
// is never deleted or acknowledged here; an uncertain enqueue can be retried.
export async function scanSyntheticStudyJournal(storage,owner,client){
 if(!storage||typeof storage.key!=='function'||typeof storage.getItem!=='function'||
    !Number.isSafeInteger(storage.length)||storage.length<0||storage.length>100000||
    typeof owner!=='string'||!OWNER.test(owner)||!client||typeof client.answer!=='function')throw Error('journal capture unavailable');
 const session=client.session;
 const active=()=>!!session&&client.session===session&&session.owner===owner&&!session.signal.aborted;
 if(!active())throw Error('session revoked');
 const key='lantern-v1-'+owner,prefix=key+':op:',epoch=storage.getItem(key+':checkpoint-epoch'),entries=[],seen=new Set();
 const count=storage.length;
 for(let i=0;i<count;i++){
  const name=storage.key(i);if(typeof name!=='string'||!name.startsWith(prefix))continue;
  const id=name.slice(prefix.length),raw=storage.getItem(name);
  if(!UUID.test(id)||seen.has(name)||typeof raw!=='string'||raw.length>16384)throw Error('invalid journal entry');
  seen.add(name);let operation;
  try{operation=JSON.parse(raw);}catch{throw Error('invalid journal entry');}
  if(!operation||typeof operation!=='object'||Array.isArray(operation)||operation.id!==id||operation.owner!==owner||typeof operation.type!=='string')throw Error('invalid journal entry');
  if(operation.type==='attempt'||operation.type==='checkin')entries.push({name,raw,operation});
 }
 if(storage.getItem(key+':checkpoint-epoch')!==epoch)throw Error('journal changed');
 // Storage key enumeration is not creation order. Prioritize explicit roots
 // before their dependent reviews, then send ambiguous legacy attempts last.
 const priority=({operation})=>operation.type==='attempt'&&operation.firstAttemptId===operation.data?.id?0:
  operation.type==='checkin'?1:operation.type==='attempt'&&operation.firstAttemptId?2:3;
 entries.sort((a,b)=>priority(a)-priority(b));
 for(const {name,raw,operation} of entries){
  if(!active()||storage.getItem(key+':checkpoint-epoch')!==epoch||storage.getItem(name)!==raw)throw Error('journal changed or session revoked');
  const enqueue=()=>client.answer(operation.type,operation.data,session,operation.id,operation.firstAttemptId);
  try{await enqueue();}catch(error){
   if(error?.code!=='NATIVE_QUEUE_FULL'||typeof client.run!=='function')throw error;
   // Empty acknowledged work before attempting this same durable source
   // operation again. A record conflict may leave other work safely drained;
   // if nothing was freed, stop rather than spin or discard a pending item.
   let conflict;
   try{await client.run(session);}catch(next){if(next?.code!=='NATIVE_EVENT_CONFLICT')throw next;conflict=next;}
   if(!active()||storage.getItem(key+':checkpoint-epoch')!==epoch||storage.getItem(name)!==raw)throw Error('journal changed or session revoked');
   try{await enqueue();}catch(next){if(next?.code==='NATIVE_QUEUE_FULL'&&conflict)throw conflict;throw next;}
  }
  if(!active()||storage.getItem(key+':checkpoint-epoch')!==epoch||storage.getItem(name)!==raw)throw Error('journal changed or session revoked');
 }
 return entries.length;
}
