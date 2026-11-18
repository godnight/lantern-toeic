import {canonicalStudyEvent} from '../study-journal';
import {validQuestionMark,validResourceTask} from '../study-model';

// This is a fixture-only inventory, not a migration or a product entry point.
// It accepts only the in-memory fixture below, never localStorage or IndexedDB.
// No bytes are deleted, acknowledged, queued, uploaded, or interpreted as proof
// of cross-device order. Real migration needs a write fence and further review.
const fixtures=new WeakSet<object>();
const ownerPattern=/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type SyntheticLease={owner:string;generation:number;active:boolean};
type EventKind='attempt'|'checkin';
type Event={kind:EventKind;id:string;data:unknown;sources:string[]};

export class SyntheticHistoryFixture {
 private readonly entries:Map<string,string>;
 onRead?: (name:string,source:SyntheticHistoryFixture)=>void;
 constructor(entries:Iterable<readonly [string,string]>){
  this.entries=new Map();
  for(const [name,bytes] of entries){if(typeof name!=='string'||typeof bytes!=='string'||this.entries.has(name))throw Error('invalid synthetic fixture');this.entries.set(name,bytes);}
  fixtures.add(this);
 }
 keys(){this.onRead?.('*',this);return [...this.entries.keys()];}
 get(name:string){this.onRead?.(name,this);return this.entries.get(name)??null;}
 set(name:string,bytes:string){this.entries.set(name,bytes);}
 delete(name:string){this.entries.delete(name);}
 bytes(){return [...this.entries.entries()];}
}

function parse(bytes:string):Record<string,unknown>{
 let value:unknown;try{value=JSON.parse(bytes);}catch{throw Error('history bytes are invalid');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('history envelope is invalid');
 return value as Record<string,unknown>;
}
function stringId(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=200;}
function sameKeys(a:string[],b:string[]){return a.length===b.length&&a.every((value,index)=>value===b[index]);}

export function inspectSyntheticHistory(source:SyntheticHistoryFixture,lease:SyntheticLease){
 if(!source||!fixtures.has(source)||!lease||!ownerPattern.test(lease.owner)||!Number.isSafeInteger(lease.generation)||lease.generation<0||lease.active!==true)throw Error('synthetic fixture and active account required');
 const owner=lease.owner,generation=lease.generation,key='lantern-v1-'+owner,epochKey=key+':checkpoint-epoch';
 const active=()=>lease.active===true&&lease.owner===owner&&lease.generation===generation;
 const scoped=()=>source.keys().filter(name=>name===key||name.startsWith(key+':')).sort();
 let bytes:Map<string,string>|undefined;
 for(let retry=0;retry<4;retry++){
  if(!active())throw Error('account lease changed');
  const epoch=source.get(epochKey),names=scoped(),candidate=new Map<string,string>();let changed=false;
  for(const name of names){const value=source.get(name);if(value===null){changed=true;break;}candidate.set(name,value);}
  if(!active())throw Error('account lease changed');
  if(!changed&&!sameKeys(names,scoped()))changed=true;
  if(!changed)for(const [name,value] of candidate)if(source.get(name)!==value){changed=true;break;}
  if(!active())throw Error('account lease changed');
  if(!changed&&source.get(epochKey)===epoch){bytes=candidate;break;}
 }
 if(!bytes)throw Error('history changed while reading');

 const events=new Map<string,Event>(),payloads=new Map<string,string>();
 const unsupported=new Set<string>(['production lease and atomic write fence','account ownership proof','cross-device answer ordering','old history migration']);
 function event(kind:EventKind,value:unknown,name:string){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid study event');
  const item=value as Record<string,unknown>;
  const allowed=kind==='attempt'?['id','qid','choice','correct','createdAt','seconds','mode']:['id','date','minutes','load','note','createdAt'];
  if(Object.keys(item).some(field=>!allowed.includes(field)))throw Error('unknown study event field');
  const payload=canonicalStudyEvent(kind,value),id=item.id;
  if(!stringId(id))throw Error('invalid study event id');
  const eventKey=kind+':'+id,prior=payloads.get(eventKey);
  if(prior!==undefined&&prior!==payload)throw Error('conflicting study event');
  payloads.set(eventKey,payload);
  const existing=events.get(eventKey);
  if(existing)existing.sources.push(name);else events.set(eventKey,{kind,id,data:JSON.parse(payload),sources:[name]});
 }
 function studyData(data:unknown,name:string){
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid study snapshot');
  const raw=data as Record<string,unknown>,version=raw.schemaVersion;
  if(version!==undefined&&version!==1&&version!==2)throw Error('unsupported study schema');
  for(const field of ['attempts','checkins','recordings'] as const)if(!Array.isArray(raw[field]))throw Error('missing study records');
  for(const field of ['questionMarks','resourceTasks'] as const)if((version===2||raw[field]!==undefined)&&!Array.isArray(raw[field]))throw Error('missing study records');
  for(const value of raw.attempts as unknown[])event('attempt',value,name);
  for(const value of raw.checkins as unknown[])event('checkin',value,name);
  for(const value of raw.recordings as unknown[]){if(!value||typeof value!=='object'||!stringId((value as {id?:unknown}).id))throw Error('invalid recording');unsupported.add('recording metadata and audio');}
  for(const value of (raw.questionMarks??[]) as unknown[]){if(!validQuestionMark(value))throw Error('invalid question mark');unsupported.add('question marks');}
  for(const value of (raw.resourceTasks??[]) as unknown[]){if(!validResourceTask(value))throw Error('invalid resource task');unsupported.add('resource tasks');}
  if(raw.profile!==undefined)unsupported.add('profile and settings');
  const allowed=['schemaVersion','profile','attempts','checkins','recordings','questionMarks','resourceTasks'];
  if(Object.keys(raw).some(field=>!allowed.includes(field)))unsupported.add('unknown snapshot fields');
 }
 const required=bytes.get(key+':required-schema');
 if(required!==undefined){const raw=parse(required);if(raw.schemaVersion!==undefined&&raw.schemaVersion!==1&&raw.schemaVersion!==2)throw Error('unsupported required schema');}
 const primary=bytes.get(key);
 if(primary!==undefined){
  const envelope=parse(primary);if(envelope.owner!==undefined&&envelope.owner!==owner)throw Error('snapshot owner mismatch');
  if(envelope.studySync!==undefined)unsupported.add('prior sync state');
  if(Object.keys(envelope).some(field=>!['owner','data','studySync'].includes(field)))unsupported.add('unknown snapshot envelope fields');
  studyData(envelope.data,key);
 }
 let checkpoints=0,operations=0;
 for(const [name,value] of bytes){
  if(name.startsWith(key+':checkpoint:')){
   if(!stringId(name.slice((key+':checkpoint:').length)))throw Error('invalid checkpoint key');
   const checkpoint=parse(value);
   if(checkpoint.kind!=='lantern-study-checkpoint'||checkpoint.version!==1||checkpoint.owner!==owner)throw Error('checkpoint owner or version mismatch');
   if(Object.keys(checkpoint).some(field=>!['kind','version','owner','data'].includes(field)))unsupported.add('unknown checkpoint envelope fields');
   const data=checkpoint.data as Record<string,unknown>|undefined;
   if(!data||data.schemaVersion!==2)throw Error('unsupported checkpoint schema');
   studyData(data,name);checkpoints++;
  }else if(name.startsWith(key+':op:')){
   const op=parse(value),opId=name.slice((key+':op:').length);
   if(!stringId(opId)||op.id!==opId||op.owner!==owner||typeof op.type!=='string'||!op.data||typeof op.data!=='object'||Array.isArray(op.data))throw Error('invalid operation owner or payload');
   if(Object.keys(op).some(field=>!['id','owner','type','data'].includes(field)))unsupported.add('unknown operation fields');
   if(op.type==='attempt'||op.type==='checkin')event(op.type,op.data,name);
   else if(op.type==='questionMark'){if(!validQuestionMark(op.data))throw Error('invalid question mark');unsupported.add('question marks');}
   else if(op.type==='resourceTask'){if(!validResourceTask(op.data))throw Error('invalid resource task');unsupported.add('resource tasks');}
   else if(op.type==='profile'||op.type==='theme')unsupported.add('profile and settings');
   else throw Error('unsupported operation');
   operations++;
  }else if(name.startsWith(key+':recording:')){
   const rec=parse(value);if(!stringId(rec.id)||name!==key+':recording:'+rec.id)throw Error('invalid recording');unsupported.add('recording metadata and audio');
  }else if(name===key+':profile'){
   const profile=parse(value);if(typeof profile.name!=='string')throw Error('invalid profile');unsupported.add('profile and settings');
  }else if(name.startsWith(key+':ack:')){
   if(!stringId(name.slice((key+':ack:').length))||value!=='1')throw Error('invalid acknowledgement');unsupported.add('prior acknowledgements');
  }else if(name.startsWith(key+':sync:')){
   unsupported.add('prior sync state');
  }else if(name!==key&&name!==epochKey&&name!==key+':required-schema'){
   unsupported.add('unknown local history fields');
  }
 }
 if(!active())throw Error('account lease changed');
 return {ready:false as const,owner,generation,requiresExclusiveLease:true as const,events:[...events.values()],checkpoints,operations,unsupported:[...unsupported].sort(),sourceBytes:[...bytes.entries()]};
}
