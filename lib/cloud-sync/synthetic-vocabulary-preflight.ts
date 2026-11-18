import {mergeVocabularyEvents,parseVocabularyBackup,vocabularyKey,vocabularyReviewHash,type VocabularyEvent} from '../vocabulary-model';

// A fixture-only inventory: never connects to localStorage, IndexedDB, a sync
// queue, or a user account. A stable double read is NOT an atomic write fence.
// Raw bytes remain untouched, and this result is never migration-ready.
const fixtures=new WeakSet<object>();
const OWNER=/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields={review:['id','wordId','createdAt','type','grade'],mark:['id','wordId','createdAt','type','starred','revision'],'review-correction':['id','wordId','createdAt','type','reviewId','reviewHash','grade']} as const;
const exact=(x:Record<string,unknown>,keys:readonly string[])=>Object.keys(x).sort().join('\0')===[...keys].sort().join('\0');
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const same=(a:string[],b:string[])=>a.length===b.length&&a.every((x,i)=>x===b[i]);
type Lease={owner:string;generation:number;active:boolean};

export class SyntheticVocabularyFixture {
 private readonly entries:Map<string,string>;
 onRead?: (name:string,source:SyntheticVocabularyFixture)=>void;
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

export function inspectSyntheticVocabulary(source:SyntheticVocabularyFixture,lease:Lease){
 if(!source||!fixtures.has(source)||!lease||!OWNER.test(lease.owner)||!Number.isSafeInteger(lease.generation)||lease.generation<0||lease.active!==true)throw Error('synthetic fixture and active account required');
 const owner=lease.owner,generation=lease.generation,prefix=vocabularyKey(owner),devicePrefix=vocabularyKey(null);
 const active=()=>lease.active===true&&lease.owner===owner&&lease.generation===generation;
 const names=()=>source.keys().filter(name=>name.startsWith(prefix)).sort();
 let snapshot:Map<string,string>|undefined,deviceDataPresent=false;
 for(let retry=0;retry<4;retry++){
  if(!active())throw Error('account lease changed');
  const keys=source.keys();deviceDataPresent=keys.some(name=>name.startsWith(devicePrefix));
  const scoped=keys.filter(name=>name.startsWith(prefix)).sort();
  if(scoped.length>100000)throw Error('too many synthetic chunks');
  const candidate=new Map<string,string>();let changed=false,total=0;
  for(const name of scoped){const bytes=source.get(name);if(bytes===null){changed=true;break;}total+=bytes.length;if(total>32*1024*1024)throw Error('synthetic inventory too large');candidate.set(name,bytes);}
  if(!active())throw Error('account lease changed');
  if(!changed&&!same(scoped,names()))changed=true;
  if(!changed)for(const [name,bytes] of candidate)if(source.get(name)!==bytes){changed=true;break;}
  if(!active())throw Error('account lease changed');
  if(!changed){snapshot=candidate;break;}
 }
 if(!snapshot)throw Error('vocabulary changed while reading');
 const all:VocabularyEvent[]=[],sources=new Map<string,string[]>();
 for(const [name,bytes] of snapshot){
  let chunk:unknown;try{chunk=JSON.parse(bytes);}catch{throw Error('invalid vocabulary bytes');}
  if(!record(chunk)||!exact(chunk,['kind','schemaVersion','events'])||!Array.isArray(chunk.events))throw Error('unknown vocabulary envelope');
  for(const event of chunk.events){
   if(!record(event)||typeof event.type!=='string'||!Object.hasOwn(fields,event.type)||!exact(event,fields[event.type as keyof typeof fields]))throw Error('unknown vocabulary event');
  }
  let parsed:VocabularyEvent[];
  try{parsed=parseVocabularyBackup(chunk).events;}catch{throw Error('invalid or conflicting vocabulary event');}
  if(all.length+parsed.length>100000)throw Error('too many vocabulary events');for(const event of parsed)all.push(event);
  for(const event of parsed){const prior=sources.get(event.id)??[];prior.push(name);sources.set(event.id,prior);}
 }
 let events:VocabularyEvent[];try{events=mergeVocabularyEvents([],all);}catch{throw Error('invalid or conflicting vocabulary event');}
 const byId=new Map(events.map(event=>[event.id,event])),unresolvedCorrectionIds:string[]=[];
 for(const event of events){
  if(event.type!=='review-correction')continue;
  const review=byId.get(event.reviewId);
  if(!review){unresolvedCorrectionIds.push(event.id);continue;}
  if(review.type!=='review'||review.wordId!==event.wordId||review.grade!=='remembered'||Date.parse(event.createdAt)<Date.parse(review.createdAt)||vocabularyReviewHash(review)!==event.reviewHash)throw Error('conflicting vocabulary correction');
 }
 if(!active())throw Error('account lease changed');
 return {ready:false as const,owner,generation,requiresExclusiveLease:true as const,deviceDataPresent,
  events:events.map(event=>({event,sources:sources.get(event.id)??[]})),unresolvedCorrectionIds:unresolvedCorrectionIds.sort(),sourceBytes:[...snapshot.entries()],
  unsupported:['production atomic write fence','account ownership proof','device data ownership','cloud snapshot completeness','old vocabulary migration']};
}
