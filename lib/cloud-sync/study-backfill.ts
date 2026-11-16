import {migrateStudyData,type Attempt,type Checkin,type StudyData} from '../study-model';
import {canonicalStudyEvent,readStableStudyJournal,readStudyCheckpoints,replayStudyOperations,type StudyOperation} from '../study-journal';

// Disabled candidate. The caller must hold the account lifecycle and prevent
// queue uploads while this scan/staging runs. localStorage and IndexedDB do not
// share a transaction; a changed scan must be retried before any upload.
type StorageLike=Pick<Storage,'length'|'key'|'getItem'|'setItem'|'removeItem'>;
type Session={owner:string;signal:AbortSignal};
type Client={readonly session:Session|null;answer:(type:'attempt'|'checkin',event:Attempt|Checkin,session:Session,id:string,firstAttemptId?:string)=>Promise<unknown>};
type Entry={name:string;bytes:string};
const OWNER=/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const active=(client:Client,session:Session)=>client.session===session&&!session.signal.aborted;
function list(storage:StorageLike,key:string):Entry[]{
 if(!Number.isSafeInteger(storage.length)||storage.length<0||storage.length>100000)throw Error('study source unavailable');
 const selected=new Set<string>([key,key+':required-schema',key+':checkpoint-epoch']);
 for(let i=0;i<storage.length;i++){const name=storage.key(i);if(name&&(name.startsWith(key+':checkpoint:')||name.startsWith(key+':op:')))selected.add(name);}
 let size=0;const result:Entry[]=[];
 for(const name of [...selected].sort()){const bytes=storage.getItem(name);if(bytes!==null){size+=new TextEncoder().encode(bytes).length;if(size>32*1024*1024)throw Error('study source too large');result.push({name,bytes});}}
 return result;
}
const same=(a:Entry[],b:Entry[])=>a.length===b.length&&a.every((x,i)=>x.name===b[i].name&&x.bytes===b[i].bytes);
function parse(bytes:string):unknown{try{return JSON.parse(bytes);}catch{throw Error('invalid study source');}}
function checkedData(raw:unknown):StudyData{
 if(raw!==undefined&&!object(raw))throw Error('invalid study source');
 const data=migrateStudyData(raw);
 if(object(raw))for(const field of ['attempts','checkins'] as const){
  const rows=raw[field];if(rows!==undefined&&(!Array.isArray(rows)||rows.length!==data[field].length))throw Error('invalid study source');
  if(Array.isArray(rows))for(const row of rows)canonicalStudyEvent(field==='attempts'?'attempt':'checkin',row);
 }
 return data;
}
async function operationId(owner:string,type:string,id:string):Promise<string>{
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`lantern-study-backfill-v1\0${owner}\0${type}\0${id}`)));
 const b=hash.slice(0,16);b[6]=(b[6]&15)|0x80;b[8]=(b[8]&63)|0x80;
 const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

/** Repeatedly staging a stable owner-scoped scan uses the same operation IDs.
 * It never deletes source bytes, sends network requests, imports guest data or
 * claims that a local scan is a complete account history. */
export async function backfillNativeStudy(options:{enabled?:boolean;storage:StorageLike;client:Client}):Promise<{staged:number;deferred:string[]}> {
 if(options.enabled!==true)throw Error('study backfill disabled');
 const {storage,client}=options,session=client?.session;
 if(!session||!OWNER.test(session.owner)||!session.signal||!active(client,session))throw Error('account lease unavailable');
 const owner=session.owner,key='lantern-v1-'+owner,before=list(storage,key),entries=new Map(before.map(x=>[x.name,x.bytes]));
 const allAttempts=new Map<string,string>(),allCheckins=new Map<string,string>();
 const add=(type:'attempt'|'checkin',value:unknown)=>{const payload=canonicalStudyEvent(type,value),row=JSON.parse(payload) as Attempt|Checkin,map=type==='attempt'?allAttempts:allCheckins,old=map.get(row.id);if(old!==undefined&&old!==payload)throw Error('conflicting study event');map.set(row.id,payload);};
 const collect=(data:StudyData)=>{for(const a of data.attempts)add('attempt',a);for(const c of data.checkins)add('checkin',c);};
 const result=readStableStudyJournal(storage,key,()=>{
  const required=entries.get(key+':required-schema');if(required!==undefined)migrateStudyData(parse(required));
  const primary=entries.get(key);let raw:unknown;
  if(primary!==undefined){const value=parse(primary);if(!object(value)||!object(value.data))throw Error('invalid study snapshot');raw=value.data;}
  const base=checkedData(raw);collect(base);
  for(const entry of before)if(entry.name.startsWith(key+':checkpoint:')){
   const value=parse(entry.bytes);if(!object(value)||value.kind!=='lantern-study-checkpoint'||value.version!==1||value.owner!==owner||!object(value.data)||value.data.schemaVersion!==2)throw Error('invalid study checkpoint');
   collect(checkedData(value.data));
  }
  const ops:StudyOperation[]=[];
  for(const entry of before)if(entry.name.startsWith(key+':op:')){
   const value=parse(entry.bytes);if(!object(value)||value.id!==entry.name.slice((key+':op:').length)||value.owner!==owner||typeof value.type!=='string')throw Error('invalid study journal');
   if(value.type==='attempt'||value.type==='checkin')add(value.type,value.data);
   ops.push(value as StudyOperation);
  }
  return replayStudyOperations(readStudyCheckpoints(storage,key,owner,base),ops,owner);
 });
 // Verify the actual merged reader did not silently drop selected facts.
 for(const a of result.attempts){const v=allAttempts.get(a.id);if(v!==canonicalStudyEvent('attempt',a))throw Error('conflicting study event');}
 for(const c of result.checkins){const v=allCheckins.get(c.id);if(v!==canonicalStudyEvent('checkin',c))throw Error('conflicting study event');}
 if(!active(client,session)||!same(before,list(storage,key)))throw Error('study source changed');
 const attempts=[...allAttempts.values()].map(x=>JSON.parse(x) as Attempt),checkins=[...allCheckins.values()].map(x=>JSON.parse(x) as Checkin),roots=new Map<string,Attempt[]>();
 for(const row of attempts)if(row.mode==='first'){const previous=roots.get(row.qid);if(previous)previous.push(row);else roots.set(row.qid,[row]);}
 const deferred:string[]=[],items:{type:'attempt'|'checkin';event:Attempt|Checkin;first?:string}[]=[];
 for(const row of attempts){const first=roots.get(row.qid)??[];if(!UUID.test(row.id)||first.length!==1||!UUID.test(first[0].id)){deferred.push(row.id);continue;}items.push({type:'attempt',event:row,first:first[0].id});}
 for(const row of checkins){if(!UUID.test(row.id)){deferred.push(row.id);continue;}items.push({type:'checkin',event:row});}
 items.sort((a,b)=>Number(!(a.type==='attempt'&&(a.event as Attempt).mode==='first'))-Number(!(b.type==='attempt'&&(b.event as Attempt).mode==='first')));
 let staged=0;const unavailableRoots=new Set<string>();
 for(const item of items){
  if(!active(client,session))throw Error('account lease changed');
  if(item.type==='attempt'&&(item.event as Attempt).mode==='review'&&item.first&&unavailableRoots.has(item.first)){deferred.push(item.event.id);continue;}
  const id=await operationId(owner,item.type,item.event.id);if(!active(client,session))throw Error('account lease changed');
  try{await client.answer(item.type,item.event,session,id,item.first);staged++;}
  catch(error){if(error instanceof Error&&['event conflict','event mapping unavailable'].includes(error.message)){deferred.push(item.event.id);if(item.type==='attempt'&&(item.event as Attempt).mode==='first')unavailableRoots.add(item.event.id);continue;}throw error;}
 }
 if(!active(client,session)||!same(before,list(storage,key)))throw Error('study source changed');
 return {staged,deferred:[...new Set(deferred)].sort()};
}
