import {mergeVocabularyEvents,parseVocabularyBackup,validVocabularyEvent,vocabularyKey,vocabularyReviewHash,type VocabularyEvent} from '../vocabulary-model';

// Read-only inventory of the actual owner-scoped localStorage format. This is
// not a production sync entry point: IDB enqueue/ack and localStorage have no
// shared transaction. A caller must establish an account lifecycle and a
// recovery protocol before using this snapshot to publish or apply data.
type StorageLike=Pick<Storage,'length'|'key'|'getItem'>;
type Lease={readonly owner:string;readonly signal:AbortSignal;readonly isCurrent:()=>boolean};
type SourceChunk=Readonly<{name:string;bytes:string}>;
export type NativeVocabularySource=Readonly<{
 owner:string;chunks:readonly SourceChunk[];events:readonly VocabularyEvent[];
 deferredCorrectionIds:readonly string[];
}>;

const OWNER=/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS={review:['id','wordId','createdAt','type','grade'],mark:['id','wordId','createdAt','type','starred','revision'],'review-correction':['id','wordId','createdAt','type','reviewId','reviewHash','grade']} as const;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).sort().join('\0')===[...keys].sort().join('\0');
function active(lease:Lease,owner:string):boolean{
 try{return !!lease&&lease.owner===owner&&OWNER.test(owner)&&!!lease.signal&&!lease.signal.aborted&&typeof lease.isCurrent==='function'&&lease.isCurrent()===true;}catch{return false;}
}
function names(storage:StorageLike,prefix:string):string[]{
 if(!storage||!Number.isSafeInteger(storage.length)||storage.length<0||storage.length>100000)throw Error('vocabulary source unavailable');
 const result:string[]=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(prefix))result.push(key);}
 result.sort();if(new Set(result).size!==result.length)throw Error('vocabulary source changed');return result;
}
const same=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every((x,i)=>x===b[i]);

/** Capture all durable owner chunks, including ordinary review and correction
 * chunks, without reading guest/other-owner values or mutating the source. */
export function captureNativeVocabularySource(storage:StorageLike,lease:Lease):NativeVocabularySource{
 const owner=lease?.owner;if(!owner||!active(lease,owner))throw Error('account lease unavailable');
 const prefix=vocabularyKey(owner),keys=names(storage,prefix),chunks:SourceChunk[]=[],all:VocabularyEvent[]=[];let total=0;
 for(const name of keys){
  if(!active(lease,owner))throw Error('account lease changed');
  const bytes=storage.getItem(name);if(bytes===null)throw Error('vocabulary source changed');
  total+=new TextEncoder().encode(bytes).length;if(total>32*1024*1024)throw Error('vocabulary source too large');
  let value:unknown;try{value=JSON.parse(bytes);}catch{throw Error('invalid vocabulary source');}
  if(!plain(value)||!exact(value,['kind','schemaVersion','events'])||!Array.isArray(value.events))throw Error('unknown vocabulary source');
  for(const raw of value.events){
   if(!plain(raw)||typeof raw.type!=='string'||!Object.hasOwn(FIELDS,raw.type)||!exact(raw,FIELDS[raw.type as keyof typeof FIELDS])||!validVocabularyEvent(raw))throw Error('unknown vocabulary event');
  }
  let parsed:VocabularyEvent[];try{parsed=parseVocabularyBackup(value).events;}catch{throw Error('invalid vocabulary source');}
  if(all.length+parsed.length>100000)throw Error('too many vocabulary events');
  all.push(...parsed);chunks.push(Object.freeze({name,bytes}));
 }
 if(!active(lease,owner)||!same(keys,names(storage,prefix))||chunks.some(chunk=>storage.getItem(chunk.name)!==chunk.bytes)||!active(lease,owner))throw Error('vocabulary source changed');
 let events:VocabularyEvent[];try{events=mergeVocabularyEvents([],all);}catch{throw Error('conflicting vocabulary events');}
 const byId=new Map(events.map(event=>[event.id,event])),deferred:string[]=[];
 for(const event of events){
  if(event.type!=='review-correction')continue;
  const original=byId.get(event.reviewId);
  if(!original){deferred.push(event.id);continue;}
  if(original.type!=='review'||original.grade!=='remembered'||original.wordId!==event.wordId||Date.parse(event.createdAt)<Date.parse(original.createdAt)||vocabularyReviewHash(original)!==event.reviewHash)throw Error('conflicting vocabulary correction');
 }
 // Original reviews must be queued before their corrections regardless of key
 // enumeration order. Unresolved corrections remain in the source for retry.
 const withheld=new Set(deferred);
 events=events.filter(event=>!withheld.has(event.id)).sort((a,b)=>Number(a.type==='review-correction')-Number(b.type==='review-correction'));
 return Object.freeze({owner,chunks:Object.freeze(chunks),events:Object.freeze(events.map(event=>Object.freeze({...event}))),deferredCorrectionIds:Object.freeze(deferred.sort())});
}

/** A recheck detects changes, but is NOT an atomic localStorage/IDB commit. */
export function nativeVocabularySourceIsCurrent(storage:StorageLike,lease:Lease,source:NativeVocabularySource):boolean{
 try{return active(lease,source.owner)&&same(source.chunks.map(chunk=>chunk.name),names(storage,vocabularyKey(source.owner)))&&source.chunks.every(chunk=>storage.getItem(chunk.name)===chunk.bytes)&&active(lease,source.owner);}catch{return false;}
}
