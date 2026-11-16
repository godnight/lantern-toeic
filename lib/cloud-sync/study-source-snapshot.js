// Candidate-only read of the product study source. No source writes or cloud
// operations: the returned guard also fences edits across asynchronous work.
import {migrateStudyData,validQuestionMark,validResourceTask,THEME_IDS} from '../study-model';
import {readStableStudyJournal,readStudyCheckpoints,replayStudyOperations,canonicalStudyEvent,canonicalStudyWireEvent} from '../study-journal';
function conflict(){const error=Error('study source invalid or changed; original records retained');error.code='NATIVE_EVENT_CONFLICT';return error;}
function object(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
function inventory(storage,key){
 if(!Number.isSafeInteger(storage.length)||storage.length<0||storage.length>100000||typeof storage.key!=='function')throw conflict();
 const names=[key,key+':required-schema',key+':checkpoint-epoch'];
 for(let i=0;i<storage.length;i++){const name=storage.key(i);if(typeof name==='string'&&[key+':checkpoint:',key+':op:',key+':ack:'].some(p=>name.startsWith(p)))names.push(name);}
 names.sort();if(new Set(names).size!==names.length)throw conflict();
 let size=0;return names.map(name=>{const raw=storage.getItem(name);if(raw!==null){size+=raw.length;if(size>32*1024*1024)throw conflict();}return {name,raw};});
}
const equal=(a,b)=>a.length===b.length&&a.every((entry,i)=>entry.name===b[i].name&&entry.raw===b[i].raw);
function strictData(value){
 if(!object(value))throw conflict();const data=migrateStudyData(value);
 if(value.profile!==undefined&&(!object(value.profile)||typeof value.profile.name!=='string'))throw conflict();
 for(const field of ['attempts','checkins','recordings','questionMarks','resourceTasks']){
  if(value[field]!==undefined&&(!Array.isArray(value[field])||value[field].length!==data[field].length))throw conflict();
 }
 for(const item of data.attempts)canonicalStudyEvent('attempt',item);
 for(const item of data.checkins)canonicalStudyEvent('checkin',item);
 return data;
}
export function captureStudySource(storage,owner,operation){
 try{
  const key='lantern-v1-'+owner,before=inventory(storage,key),byName=new Map(before.map(x=>[x.name,x.raw]));
  const required=byName.get(key+':required-schema');if(required!==null){const schema=JSON.parse(required);if(!object(schema)||!Object.hasOwn(schema,'schemaVersion'))throw conflict();migrateStudyData(schema);}
  const primary=byName.get(key);let base=migrateStudyData(undefined),sources=[];
  if(primary!==null){const envelope=JSON.parse(primary);if(!object(envelope)||!object(envelope.data))throw conflict();base=strictData(envelope.data);sources.push(base);}
  const ops=[];
  for(const {name,raw} of before){
   if(name.startsWith(key+':checkpoint:')){
    const checkpoint=JSON.parse(raw);if(!object(checkpoint)||checkpoint.kind!=='lantern-study-checkpoint'||checkpoint.version!==1||checkpoint.owner!==owner||checkpoint.data?.schemaVersion!==2)throw conflict();
    sources.push(strictData(checkpoint.data));
   }
   if(name.startsWith(key+':op:')){
    const op=JSON.parse(raw);if(!object(op)||op.owner!==owner||typeof op.id!=='string'||name!==key+':op:'+op.id||!['profile','theme','attempt','checkin','questionMark','resourceTask'].includes(op.type)||!object(op.data))throw conflict();
    if(op.type==='attempt'||op.type==='checkin')canonicalStudyEvent(op.type,op.data);
    if(op.type==='questionMark'&&!validQuestionMark(op.data)||op.type==='resourceTask'&&!validResourceTask(op.data)||op.type==='profile'&&typeof op.data.name!=='string'||op.type==='theme'&&!THEME_IDS.includes(op.data.theme))throw conflict();
    ops.push(op);
   }
  }
  // Keep useStudy's selected primary/checkpoint/replay semantics, including its
  // epoch fence; malformed or conflicting wire payloads throw during replay.
  const projected=readStableStudyJournal(storage,key,()=>replayStudyOperations(readStudyCheckpoints(storage,key,owner,base),ops,owner));
  const acknowledged=byName.get(key+':ack:'+operation.id)==='1';
  const canonical=acknowledged&&operation.type==='attempt'?canonicalStudyWireEvent:canonicalStudyEvent;
  const expected=canonical(operation.type,operation.data),field=operation.type==='attempt'?'attempts':'checkins';
  for(const source of [...sources,projected])for(const record of source[field])if(record.id===operation.data.id&&canonical(operation.type,record)!==expected)throw conflict();
  for(const op of ops)if(op.type===operation.type&&op.data.id===operation.data.id&&canonical(operation.type,op.data)!==expected)throw conflict();
  const records=projected[field].filter(record=>record.id===operation.data.id);if(records.length!==1||canonical(operation.type,records[0])!==expected)throw conflict();
  if(!equal(before,inventory(storage,key)))throw conflict();
  return ()=>{try{return equal(before,inventory(storage,key));}catch{return false;}};
 }catch{throw conflict();}
}
