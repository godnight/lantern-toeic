import {migrateStudyData, mergeData, mergeMutableRecords, compareMutableRecords, validQuestionMark, validResourceTask,
  type StudyData, type Attempt, type Checkin, type Profile, type Theme, type QuestionMark, type ResourceTask} from './study-model';

export type StudyOperation = {id:string; owner:string|null; type:'profile'|'theme'|'attempt'|'checkin'|'questionMark'|'resourceTask'; data:Profile|{theme:Theme}|Attempt|Checkin|QuestionMark|ResourceTask};
type StorageLike = Pick<Storage,'length'|'key'|'getItem'|'setItem'|'removeItem'>;
type Checkpoint = {kind:'lantern-study-checkpoint';version:1;owner:string|null;data:StudyData};
const suffix = ':checkpoint:';

// Coverage is about the complete immutable payload, never an ID/count alone.
export function canonicalStudyEvent(type:'attempt'|'checkin', value:unknown):string {
  if (!value || typeof value !== 'object') throw Error('学习事件格式无效');
  if (type === 'attempt') {
    const a = value as Attempt;
    if (typeof a.id!=='string'||!a.id||typeof a.qid!=='string'||!a.qid||!Number.isInteger(a.choice)||a.choice<0||a.choice>3||typeof a.correct!=='boolean'||typeof a.createdAt!=='string'||!Number.isFinite(Date.parse(a.createdAt))||!Number.isInteger(a.seconds)||a.seconds<0||a.seconds>7200||!['first','review'].includes(a.mode)) throw Error('答题事件格式无效');
    return JSON.stringify({id:a.id,qid:a.qid,choice:a.choice,correct:a.correct,createdAt:a.createdAt,seconds:a.seconds,mode:a.mode});
  }
  const c = value as Checkin;
  if(typeof c.id!=='string'||!c.id||typeof c.date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(c.date)||!Number.isInteger(c.minutes)||c.minutes<1||c.minutes>240||!['轻','刚好','重'].includes(c.load)||typeof c.note!=='string'||c.note.length>1000||typeof c.createdAt!=='string'||!Number.isFinite(Date.parse(c.createdAt))) throw Error('打卡事件格式无效');
  return JSON.stringify({id:c.id,date:c.date,minutes:c.minutes,load:c.load,note:c.note,createdAt:c.createdAt});
}
// correct/mode are server-assigned projections, deliberately excluded by the
// existing POST contract. Every submitted immutable wire field is compared.
export function canonicalStudyWireEvent(type:'attempt'|'checkin',value:unknown):string {
  const parsed=JSON.parse(canonicalStudyEvent(type,value));
  return type==='attempt'?JSON.stringify({id:parsed.id,qid:parsed.qid,choice:parsed.choice,createdAt:parsed.createdAt,seconds:parsed.seconds}):JSON.stringify(parsed);
}
function names(storage:StorageLike, prefix:string):string[] {
  const result:string[]=[];
  for(let i=0;i<storage.length;i++){const name=storage.key(i);if(name?.startsWith(prefix))result.push(name);}
  return result.sort();
}
function mergeStrict(a:StudyData,b:StudyData):StudyData {
  for(const [field,type] of [['attempts','attempt'],['checkins','checkin']] as const){
    const seen=new Map<string,string>();
    for(const item of [...a[field],...b[field]]){const value=canonicalStudyWireEvent(type,item);const old=seen.get(item.id);if(old!==undefined&&old!==value)throw Error('同一学习事件标识存在不同内容，已停止压缩');seen.set(item.id,value);}
  }
  const merged=mergeData(a,b);merged.profile=a.profile;
  const primaryAttempts=new Map(a.attempts.map(row=>[row.id,row]));
  merged.attempts=merged.attempts.map(row=>primaryAttempts.get(row.id)??row);
  const prior=new Map(a.recordings.map(row=>[row.id,row]));
  merged.recordings=merged.recordings.map(row=>prior.get(row.id)?.uploaded?{...row,uploaded:true}:row);
  return merged;
}
function parseCheckpoint(bytes:string,owner:string|null):Checkpoint {
  const value=JSON.parse(bytes) as Checkpoint;
  if(value?.kind!=='lantern-study-checkpoint'||value.version!==1||value.owner!==owner||!value.data||value.data.schemaVersion!==2)throw Error('学习压缩快照不受支持或记录范围不匹配');
  const data=migrateStudyData(value.data);
  // A damaged checkpoint must not silently filter away records during migration.
  for(const field of ['attempts','checkins','recordings','questionMarks','resourceTasks'] as const){
    if(!Array.isArray(value.data[field])||data[field].length!==value.data[field].length)throw Error('学习压缩快照损坏，原件保留');
  }
  return {...value,data};
}

/** Read checkpoints with an epoch fence. A compactor commits the new segment
 * before removing any old key; a reader crossing that commit retries. */
export function readStudyCheckpoints(storage:StorageLike,key:string,owner:string|null,base:StudyData):StudyData {
  for(let retry=0;retry<4;retry++){
    const epoch=storage.getItem(key+':checkpoint-epoch');let result=base;
    for(const name of names(storage,key+suffix)){
      const bytes=storage.getItem(name);if(bytes!==null)result=mergeStrict(result,parseCheckpoint(bytes,owner).data);
    }
    if(storage.getItem(key+':checkpoint-epoch')===epoch)return result;
  }
  throw Error('学习快照正在整理，请稍后重试；原始记录保留');
}

/** The fence must cover the primary snapshot AND the loose journal, not just
 * checkpoint enumeration, because a compactor may delete loose ops mid-read. */
export function readStableStudyJournal(storage:StorageLike,key:string,read:()=>StudyData):StudyData {
  for(let retry=0;retry<4;retry++){
    const epoch=storage.getItem(key+':checkpoint-epoch');const result=read();
    if(storage.getItem(key+':checkpoint-epoch')===epoch)return result;
  }
  throw Error('学习快照正在整理，请稍后重试；原始记录保留');
}

/** Bulk replay avoids N full-array scans per operation. Immutable conflicts
 * are surfaced before a summary or checkpoint can choose one payload by ID. */
export function replayStudyOperations(base:StudyData,ops:StudyOperation[],owner:string|null):StudyData {
  const result={...base};
  for(const [field,type] of [['attempts','attempt'],['checkins','checkin']] as const){
    const records=new Map<string,Attempt|Checkin>();const payloads=new Map<string,string>();
    const add=(item:Attempt|Checkin)=>{const payload=canonicalStudyWireEvent(type,item),old=payloads.get(item.id);if(old!==undefined&&old!==payload)throw Error('同一学习事件标识存在不同内容，已停止确认');payloads.set(item.id,payload);if(!records.has(item.id))records.set(item.id,item);};
    for(const item of base[field])add(item);
    for(const op of ops)if(op.owner===owner&&op.type===type)add(op.data as Attempt|Checkin);
    (result[field] as Array<Attempt|Checkin>)=[...records.values()];
  }
  const owned=ops.filter(op=>op.owner===owner);
  result.questionMarks=mergeMutableRecords([...base.questionMarks,...owned.filter(op=>op.type==='questionMark'&&validQuestionMark(op.data)).map(op=>op.data as QuestionMark)]);
  result.resourceTasks=mergeMutableRecords([...base.resourceTasks,...owned.filter(op=>op.type==='resourceTask'&&validResourceTask(op.data)).map(op=>op.data as ResourceTask)]);
  return result;
}

function covered(data:StudyData,op:StudyOperation,durableProfile:Profile|null,eventPayloads:{attempt:Map<string,string>;checkin:Map<string,string>}):boolean {
  switch(op.type){
    case 'attempt': return eventPayloads.attempt.get((op.data as Attempt).id)===(op.owner===null?canonicalStudyEvent('attempt',op.data):canonicalStudyWireEvent('attempt',op.data));
    case 'checkin': return eventPayloads.checkin.get((op.data as Checkin).id)===canonicalStudyEvent('checkin',op.data);
    case 'questionMark': return validQuestionMark(op.data)&&data.questionMarks.some(row=>row.qid===(op.data as QuestionMark).qid&&compareMutableRecords(row,op.data as QuestionMark)>=0);
    case 'resourceTask': return validResourceTask(op.data)&&data.resourceTasks.some(row=>row.id===(op.data as ResourceTask).id&&compareMutableRecords(row,op.data as ResourceTask)>=0);
    // The durable profile projection is the established last explicit choice.
    // Old settings ops are not replayed over it even in the pre-compaction reader.
    case 'profile': case 'theme': return durableProfile!==null&&JSON.stringify(durableProfile)===JSON.stringify(data.profile);
    default:return false;
  }
}
export type JournalCompactionResult={status:'compacted'|'below-threshold'|'lock-unavailable';removedOps:number;removedAcks:number;checkpoints:number};
export type JournalCompactionOptions={
  storage:StorageLike;key:string;owner:string|null;readSnapshot:()=>StudyData;
  withLock?:<T>(name:string,work:()=>Promise<T>)=>Promise<T>;createId:()=>string;threshold?:number;
};

/** No unsafe fallback: all compactors must share an origin Web Lock. Ordinary
 * writers remain append-only and need no lock. A crash at any write/delete
 * boundary leaves either original ops/segments or the complete new checkpoint. */
export async function compactStudyJournal(options:JournalCompactionOptions):Promise<JournalCompactionResult>{
  const {storage,key,owner,readSnapshot,withLock,createId}=options;
  if(!withLock)return {status:'lock-unavailable',removedOps:0,removedAcks:0,checkpoints:0};
  return withLock('lantern-study-compaction:'+key,async()=>{
    const before=readSnapshot();
    const oldSegments=names(storage,key+suffix).map(name=>({name,bytes:storage.getItem(name)}));
    const ops=names(storage,key+':op:').map(name=>({name,bytes:storage.getItem(name)}));
    const allOperations=ops.flatMap(item=>{
      if(item.bytes===null)return [];
      const op=JSON.parse(item.bytes) as StudyOperation;
      if(!op||typeof op.id!=='string'||item.name!==key+':op:'+op.id)throw Error('学习日志损坏，未压缩');
      if(op.owner!==owner)return [];
      return [{...item,op}];
    });
    for(const [field,type] of [['attempts','attempt'],['checkins','checkin']] as const){
      const canonical=owner===null?canonicalStudyEvent:canonicalStudyWireEvent;
      const payloads=new Map<string,string>(before[field].map(item=>[item.id,canonical(type,item)] as const));
      for(const item of allOperations)if(item.op.type===type){
        const event=item.op.data as Attempt|Checkin,value=canonical(type,event),prior=payloads.get(event.id);
        if(prior!==undefined&&prior!==value)throw Error('同一学习事件标识存在不同内容，原日志保留');
        payloads.set(event.id,value);
      }
    }
    const acknowledged=allOperations.filter(item=>owner===null||storage.getItem(key+':ack:'+item.op.id)==='1');
    const orphanAcks=names(storage,key+':ack:').filter(name=>storage.getItem(key+':op:'+name.slice((key+':ack:').length))===null);
    if(acknowledged.length<(options.threshold??128)&&oldSegments.length<=1&&orphanAcks.length<(options.threshold??128))return {status:'below-threshold',removedOps:0,removedAcks:0,checkpoints:oldSegments.length};
    let data=before;
    for(const item of oldSegments)if(item.bytes!==null)data=mergeStrict(data,parseCheckpoint(item.bytes,owner).data);
    let durableProfile:Profile|null=null;
    const profileBytes=storage.getItem(key+':profile');if(profileBytes!==null){const raw=JSON.parse(profileBytes);if(raw&&typeof raw.name==='string')durableProfile=raw;}
    const eventPayloads={attempt:new Map(data.attempts.map(item=>[item.id,(owner===null?canonicalStudyEvent:canonicalStudyWireEvent)('attempt',item)])),checkin:new Map(data.checkins.map(item=>[item.id,canonicalStudyEvent('checkin',item)]))};
    const removable=acknowledged.filter(item=>covered(data,item.op,durableProfile,eventPayloads));
    // Malformed or uncovered ops remain present, including their ack.
    if(!removable.length&&!orphanAcks.length&&oldSegments.length<=1)return {status:'below-threshold',removedOps:0,removedAcks:0,checkpoints:oldSegments.length};
    const checkpoint:Checkpoint={kind:'lantern-study-checkpoint',version:1,owner,data};
    const bytes=JSON.stringify(checkpoint),name=key+suffix+createId();
    storage.setItem(name,bytes);
    if(storage.getItem(name)!==bytes)throw Error('压缩快照未完整保存，原日志保留');
    // Fence publication precedes removal so readers cannot miss both copies.
    storage.setItem(key+':checkpoint-epoch',createId());
    let removedOps=0,removedAcks=0;
    for(const item of removable){
      if(storage.getItem(item.name)!==item.bytes)continue;
      if(owner!==null&&storage.getItem(key+':ack:'+item.op.id)!=='1')continue;
      storage.removeItem(item.name);removedOps++;
      const ack=key+':ack:'+item.op.id;if(storage.getItem(item.name)===null&&storage.getItem(ack)!==null){storage.removeItem(ack);removedAcks++;}
      storage.removeItem(key+':sync:op:'+item.op.id);
    }
    for(const ack of orphanAcks)if(storage.getItem(key+':op:'+ack.slice((key+':ack:').length))===null){storage.removeItem(ack);removedAcks++;}
    for(const item of oldSegments)if(item.bytes!==null&&storage.getItem(item.name)===item.bytes)storage.removeItem(item.name);
    return {status:'compacted',removedOps,removedAcks,checkpoints:1};
  });
}
