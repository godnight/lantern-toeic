import {canonicalJson,canonicalValue,canonicalHash,type JsonValue} from './domain-command';
export type {JsonValue} from './domain-command';

export type WorkflowScope={kind:'web-owner'|'harmony-owner';ownerId:string}|{kind:'web-local';partition:'existing-device'}|{kind:'harmony-device';partition:'existing-device'};
export const DOMAIN_COLLECTIONS=['plans','days','candidates','sessions','commands','events','outbox'] as const;
export type DomainCollection=typeof DOMAIN_COLLECTIONS[number];
export type DomainProvenance='local'|'restored-unverified';
export type DomainRecord<T=JsonValue>={id:string;revision:number;value:T;provenance?:DomainProvenance};
export type DomainExpectation={collection:DomainCollection;id:string;revision:number|null};
export type DomainWrite={collection:DomainCollection;id:string;revision:number;value:JsonValue};
export type DomainCommit={commandId:string;occurredAt:string;payload:JsonValue;expected:DomainExpectation[];writes:DomainWrite[]};
export type DomainCommitReceipt={commandId:string;payloadHash:string;eventIds:string[];revisions:{collection:DomainCollection;id:string;revision:number}[];durableAt:string};
export type DomainBlockedReason='scope'|'schema'|'corrupt'|'quota'|'unavailable'|'closed'|'aborted'|'reference-unverified';
export type DomainCommitResult={status:'committed'|'replayed';receipt:DomainCommitReceipt}|{status:'conflict';reason:'payload'|'revision'|'event';collection?:DomainCollection;id?:string}|{status:'blocked';reason:DomainBlockedReason}|{status:'unknown';commandId:string};
export type DomainStoredCommand={command:DomainCommit;canonicalPayload:string;payloadHash:string;receipt:DomainCommitReceipt;provenance:'local'|'restored-unverified'};
export type WorkflowBackup={kind:'lantern-workflow';schemaVersion:1;scope:WorkflowScope;records:{[K in DomainCollection]:DomainRecord[]};commands:DomainStoredCommand[]};
export type DomainRestoreResult={status:'committed'|'replayed';addedRecords:number;addedCommands:number;requiresReferenceVerification:boolean}|{status:'conflict';reason:'payload';collection?:DomainCollection|'receipts';id?:string}|{status:'blocked';reason:DomainBlockedReason};
export type DomainRestoreConfirmation={records:DomainWrite[];commands:{commandId:string;canonicalPayload:string}[]};
export type DomainRestoreConfirmationResult={status:'committed'|'replayed';confirmedRecords:number;confirmedCommands:number}|{status:'conflict';reason:'payload'}|{status:'blocked';reason:DomainBlockedReason};
type StoredRow=DomainRecord & {scopeKey:string;schemaVersion:1;canonicalValue:string;provenance:DomainProvenance};
type StoredCommand=DomainStoredCommand & {scopeKey:string;id:string;schemaVersion:1};
const STORES=[...DOMAIN_COLLECTIONS,'receipts'];
const DB_NAME='lantern-workflow-v1';
const MAX_RECORDS=100000,MAX_COMMANDS=100000;
const validId=(id:unknown):id is string=>typeof id==='string'&&id.length>0&&id.length<=300&&!/[\u0000-\u001f]/.test(id);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const revision=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=1&&Number(value)<Number.MAX_SAFE_INTEGER;
const strictKeys=(value:Record<string,unknown>,keys:string[])=>{if(Object.keys(value).some(key=>!keys.includes(key)))throw new DomainRepositoryError('corrupt','不支持的工作流字段');};
const request=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error??new DomainRepositoryError('unavailable'));});

export class DomainRepositoryError extends Error {
 constructor(readonly reason:DomainBlockedReason,message='本机工作流不可用，原记录保留'){super(message);this.name='DomainRepositoryError';}
}
export function workflowScopeKey(input:WorkflowScope):string {
 if(!object(input))throw new DomainRepositoryError('scope');
 if(input.kind==='web-owner'||input.kind==='harmony-owner'){
  strictKeys(input,['kind','ownerId']);if(!validId(input.ownerId)||!input.ownerId.trim())throw new DomainRepositoryError('scope');
  return canonicalJson({kind:input.kind,ownerId:input.ownerId});
 }
 if((input.kind==='web-local'||input.kind==='harmony-device')&&input.partition==='existing-device'){
  strictKeys(input,['kind','partition']);return canonicalJson({kind:input.kind,partition:input.partition});
 }
 throw new DomainRepositoryError('scope');
}
function collection(value:unknown):value is DomainCollection{return typeof value==='string'&&(DOMAIN_COLLECTIONS as readonly string[]).includes(value);}
function parseCommand(input:unknown):DomainCommit {
 if(!object(input))throw new DomainRepositoryError('corrupt');strictKeys(input,['commandId','occurredAt','payload','expected','writes']);
 if(!validId(input.commandId)||typeof input.occurredAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(input.occurredAt)||!Number.isFinite(Date.parse(input.occurredAt))||!Array.isArray(input.expected)||!Array.isArray(input.writes)||input.expected.length>1000||input.writes.length>1000)throw new DomainRepositoryError('corrupt','工作流命令格式不支持');
 const expected:DomainExpectation[]=[],writes:DomainWrite[]=[],seenExpected=new Set<string>(),seenWrites=new Set<string>();
 for(const item of input.expected){
  if(!object(item))throw new DomainRepositoryError('corrupt');strictKeys(item,['collection','id','revision']);
  if(!collection(item.collection)||!validId(item.id)||(item.revision!==null&&!revision(item.revision)))throw new DomainRepositoryError('corrupt');
  const key=canonicalJson([item.collection,item.id]);if(seenExpected.has(key))throw new DomainRepositoryError('corrupt');seenExpected.add(key);
  expected.push({collection:item.collection,id:item.id,revision:item.revision as number|null});
 }
 for(const item of input.writes){
  if(!object(item))throw new DomainRepositoryError('corrupt');strictKeys(item,['collection','id','revision','value']);
  if(!collection(item.collection)||!validId(item.id)||!revision(item.revision))throw new DomainRepositoryError('corrupt');
  const key=canonicalJson([item.collection,item.id]);if(seenWrites.has(key))throw new DomainRepositoryError('corrupt');seenWrites.add(key);
  const prior=expected.find(row=>row.collection===item.collection&&row.id===item.id);
  if(!prior||item.revision!==(prior.revision??0)+1||(item.collection==='events'&&(item.revision!==1||prior.revision!==null)))throw new DomainRepositoryError('corrupt','写入必须对应唯一预期revision');
  writes.push({collection:item.collection,id:item.id,revision:item.revision,value:canonicalValue(item.value)});
 }
 const order=(a:{collection:string;id:string},b:{collection:string;id:string})=>a.collection<b.collection?-1:a.collection>b.collection?1:a.id<b.id?-1:a.id>b.id?1:0;
 return {commandId:input.commandId,occurredAt:new Date(input.occurredAt).toISOString(),payload:canonicalValue(input.payload),expected:expected.sort(order),writes:writes.sort(order)};
}
function storedRow(raw:unknown,scopeKey:string):StoredRow {
 if(!object(raw)||raw.scopeKey!==scopeKey||raw.schemaVersion!==1||!validId(raw.id)||!revision(raw.revision)||(raw.provenance!=='local'&&raw.provenance!=='restored-unverified')||typeof raw.canonicalValue!=='string'||canonicalJson(raw.value)!==raw.canonicalValue)throw new DomainRepositoryError('corrupt');
 return raw as StoredRow;
}
function externalRow(row:StoredRow):DomainRecord{return {id:row.id,revision:row.revision,value:canonicalValue(row.value),provenance:row.provenance};}
function parseReceipt(input:unknown,command:DomainCommit,hash:string):DomainCommitReceipt {
 if(!object(input))throw new DomainRepositoryError('corrupt');strictKeys(input,['commandId','payloadHash','eventIds','revisions','durableAt']);
 if(input.commandId!==command.commandId||input.payloadHash!==hash||typeof input.durableAt!=='string'||!Number.isFinite(Date.parse(input.durableAt))||canonicalJson(input.eventIds)!==canonicalJson(command.writes.filter(row=>row.collection==='events').map(row=>row.id))||canonicalJson(input.revisions)!==canonicalJson(command.writes.map(({collection,id,revision})=>({collection,id,revision}))))throw new DomainRepositoryError('corrupt');
 return canonicalValue(input) as unknown as DomainCommitReceipt;
}
function commandRow(raw:unknown,scopeKey:string):StoredCommand {
 if(!object(raw)||raw.scopeKey!==scopeKey||raw.schemaVersion!==1||!validId(raw.id)||(raw.provenance!=='local'&&raw.provenance!=='restored-unverified'))throw new DomainRepositoryError('corrupt');
 const command=parseCommand(raw.command),canonicalPayload=canonicalJson(command),payloadHash=canonicalHash(canonicalPayload);
 if(raw.id!==command.commandId||raw.canonicalPayload!==canonicalPayload||raw.payloadHash!==payloadHash)throw new DomainRepositoryError('corrupt');
 return {...raw,command,receipt:parseReceipt(raw.receipt,command,payloadHash)} as StoredCommand;
}
function externalCommand(row:StoredCommand):DomainStoredCommand {const {command,canonicalPayload,payloadHash,receipt,provenance}=row;return canonicalValue({command,canonicalPayload,payloadHash,receipt,provenance}) as unknown as DomainStoredCommand;}
function failure(error:unknown):DomainBlockedReason {
 if(error instanceof DomainRepositoryError)return error.reason;
 const name=object(error)?error.name:undefined;
 return name==='QuotaExceededError'?'quota':name==='VersionError'?'schema':name==='AbortError'?'aborted':'unavailable';
}

/** Scope-bound storage primitive. Committed means this IDB batch only, never legacy/remote ack. */
export class LearningDomainRepository {
 readonly scope:Readonly<WorkflowScope>;readonly scopeKey:string;
 private closed=false;
 constructor(private db:IDBDatabase|null,scope:WorkflowScope,private unavailable?:DomainBlockedReason){this.scope=Object.freeze(canonicalValue(scope) as WorkflowScope);this.scopeKey=workflowScopeKey(this.scope);}
 close(){this.closed=true;this.db?.close();}
 private async transaction<T>(mode:IDBTransactionMode,action:(tx:IDBTransaction)=>Promise<T>):Promise<T>{
  if(this.closed)throw new DomainRepositoryError('closed');if(!this.db||this.unavailable)throw new DomainRepositoryError(this.unavailable??'unavailable');
  const tx=this.db.transaction(STORES,mode);
  const done=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??new DomainRepositoryError('aborted'));tx.onerror=()=>{};});void done.catch(()=>{});
  try{const result=await action(tx);await done;return result;}catch(error){try{tx.abort();}catch{/* already terminal */}await done.catch(()=>{});throw error;}
 }
 private async row(tx:IDBTransaction,name:DomainCollection,id:string):Promise<StoredRow|undefined>{
  const value=await request(tx.objectStore(name).get([this.scopeKey,id]));return value===undefined?undefined:storedRow(value,this.scopeKey);
 }
 private async receipt(tx:IDBTransaction,id:string):Promise<StoredCommand|undefined>{
  const value=await request(tx.objectStore('receipts').get([this.scopeKey,id]));return value===undefined?undefined:commandRow(value,this.scopeKey);
 }
 private async capacity(tx:IDBTransaction,addRecords=0,addCommands=0){
  const counts=await Promise.all(STORES.map(name=>request(tx.objectStore(name).index('scope').count(this.scopeKey))));
  if(counts.slice(0,-1).reduce((total,n)=>total+n,addRecords)>MAX_RECORDS||counts[counts.length-1]+addCommands>MAX_COMMANDS)throw new DomainRepositoryError('quota','工作流记录达到安全容量，请保留备份');
 }
 async read<T=JsonValue>(name:DomainCollection,id:string):Promise<DomainRecord<T>|undefined>{
  if(!collection(name)||!validId(id))throw new DomainRepositoryError('corrupt');
  return this.transaction('readonly',async tx=>{const row=await this.row(tx,name,id);return row?externalRow(row) as DomainRecord<T>:undefined;});
 }
 async list<T=JsonValue>(name:DomainCollection):Promise<DomainRecord<T>[]>{
  if(!collection(name))throw new DomainRepositoryError('corrupt');
  return this.transaction('readonly',async tx=>(await request(tx.objectStore(name).index('scope').getAll(this.scopeKey))).map(value=>externalRow(storedRow(value,this.scopeKey)) as DomainRecord<T>));
 }
 async readCommand(id:string):Promise<DomainStoredCommand|undefined>{
  if(!validId(id))throw new DomainRepositoryError('corrupt');return this.transaction('readonly',async tx=>{const row=await this.receipt(tx,id);return row?externalCommand(row):undefined;});
 }
 async getReceipt(id:string):Promise<DomainCommitReceipt|undefined>{const row=await this.readCommand(id);return row?.provenance==='local'?row.receipt:undefined;}
 async commit(input:DomainCommit):Promise<DomainCommitResult>{
  try{
   const command=parseCommand(input),canonicalPayload=canonicalJson(command),payloadHash=canonicalHash(canonicalPayload);
   return await this.transaction('readwrite',async tx=>{
    // A durable replay must win over the now-stale expectedRevision check.
    const old=await this.receipt(tx,command.commandId);
    if(old){if(old.canonicalPayload!==canonicalPayload)return {status:'conflict',reason:'payload'};if(old.provenance!=='local')return {status:'blocked',reason:'reference-unverified'};return {status:'replayed',receipt:old.receipt};}
    for(const expected of command.expected){const oldRow=await this.row(tx,expected.collection,expected.id);if(oldRow?.provenance==='restored-unverified')return {status:'blocked',reason:'reference-unverified'};if((oldRow?.revision??null)!==expected.revision)return {status:'conflict',reason:expected.collection==='events'?'event':'revision',collection:expected.collection,id:expected.id};}
    await this.capacity(tx,command.writes.filter(write=>command.expected.some(expected=>expected.collection===write.collection&&expected.id===write.id&&expected.revision===null)).length,1);
    const receipt:DomainCommitReceipt={commandId:command.commandId,payloadHash,eventIds:command.writes.filter(row=>row.collection==='events').map(row=>row.id),revisions:command.writes.map(({collection,id,revision})=>({collection,id,revision})),durableAt:new Date().toISOString()};
    for(const write of command.writes){const {collection:name,id,revision,value}=write;await request(tx.objectStore(name).put({scopeKey:this.scopeKey,schemaVersion:1,id,revision,value,canonicalValue:canonicalJson(value),provenance:'local'} satisfies StoredRow));}
    await request(tx.objectStore('receipts').add({scopeKey:this.scopeKey,id:command.commandId,schemaVersion:1,command,canonicalPayload,payloadHash,receipt,provenance:'local'} satisfies StoredCommand));
    return {status:'committed',receipt};
   });
  }catch(error){return {status:'blocked',reason:failure(error)};}
 }
 async exportBackup():Promise<WorkflowBackup>{
  return this.transaction('readonly',async tx=>{
   await this.capacity(tx);
   const records={} as WorkflowBackup['records'];
   for(const name of DOMAIN_COLLECTIONS)records[name]=(await request(tx.objectStore(name).index('scope').getAll(this.scopeKey))).map(value=>externalRow(storedRow(value,this.scopeKey)));
   const commands=(await request(tx.objectStore('receipts').index('scope').getAll(this.scopeKey))).map(value=>externalCommand(commandRow(value,this.scopeKey)));
   return {kind:'lantern-workflow',schemaVersion:1,scope:canonicalValue(this.scope) as WorkflowScope,records,commands};
  });
 }
 /** Restore never executes an intent, changes scope, or trusts an imported legacy acknowledgement. */
 async restoreBackup(input:unknown):Promise<DomainRestoreResult>{
  try{
   const backup=this.parseBackup(input); // Full validation and canonical identity before any write transaction.
   return await this.transaction('readwrite',async tx=>{
    let addedRecords=0,addedCommands=0,incomingRecords=0,incomingCommands=0,requiresReferenceVerification=false;
    // Preflight all collisions before writes. Any ID/content mismatch rejects the whole merge.
    for(const name of DOMAIN_COLLECTIONS)for(const row of backup.records[name]){const old=await this.row(tx,name,row.id);if(old&&(old.revision!==row.revision||old.canonicalValue!==canonicalJson(row.value)))return {status:'conflict',reason:'payload',collection:name,id:row.id};if(!old)incomingRecords++;if(!old||old.provenance==='restored-unverified')requiresReferenceVerification=true;}
    for(const row of backup.commands){const old=await this.receipt(tx,row.command.commandId);if(old&&old.canonicalPayload!==row.canonicalPayload)return {status:'conflict',reason:'payload',collection:'receipts',id:row.command.commandId};if(!old)incomingCommands++;if(!old||old.provenance==='restored-unverified')requiresReferenceVerification=true;}
    await this.capacity(tx,incomingRecords,incomingCommands);
    for(const name of DOMAIN_COLLECTIONS)for(const row of backup.records[name]){if(await this.row(tx,name,row.id))continue;await request(tx.objectStore(name).add({...row,scopeKey:this.scopeKey,schemaVersion:1,canonicalValue:canonicalJson(row.value),provenance:'restored-unverified'} satisfies StoredRow));addedRecords++;}
    for(const row of backup.commands){if(await this.receipt(tx,row.command.commandId))continue;await request(tx.objectStore('receipts').add({...row,scopeKey:this.scopeKey,id:row.command.commandId,schemaVersion:1,provenance:'restored-unverified'} satisfies StoredCommand));addedCommands++;}
    return {status:addedRecords||addedCommands?'committed':'replayed',addedRecords,addedCommands,requiresReferenceVerification};
   });
  }catch(error){return {status:'blocked',reason:failure(error)};}
 }
 /** Explicit reconciliation only, AFTER the caller validates domain schema and exact legacy references.
  * This changes provenance only; it never writes legacy events or executes a restored intent. */
 async confirmRestored(input:DomainRestoreConfirmation):Promise<DomainRestoreConfirmationResult>{
  try{
   if(!object(input))throw new DomainRepositoryError('corrupt');strictKeys(input,['records','commands']);
   if(!Array.isArray(input.records)||!Array.isArray(input.commands)||input.records.length>1000||input.commands.length>1000)throw new DomainRepositoryError('corrupt');
   const records:DomainWrite[]=[],commands:{commandId:string;canonicalPayload:string}[]=[],seen=new Set<string>();
   for(const raw of input.records){if(!object(raw))throw new DomainRepositoryError('corrupt');strictKeys(raw,['collection','id','revision','value']);if(!collection(raw.collection)||!validId(raw.id)||!revision(raw.revision))throw new DomainRepositoryError('corrupt');const key=canonicalJson([raw.collection,raw.id]);if(seen.has(key))throw new DomainRepositoryError('corrupt');seen.add(key);records.push({collection:raw.collection,id:raw.id,revision:raw.revision,value:canonicalValue(raw.value)});}
   for(const raw of input.commands){if(!object(raw))throw new DomainRepositoryError('corrupt');strictKeys(raw,['commandId','canonicalPayload']);if(!validId(raw.commandId)||typeof raw.canonicalPayload!=='string'||seen.has('receipt:'+raw.commandId))throw new DomainRepositoryError('corrupt');seen.add('receipt:'+raw.commandId);const parsed=parseCommand(JSON.parse(raw.canonicalPayload));if(canonicalJson(parsed)!==raw.canonicalPayload||parsed.commandId!==raw.commandId)throw new DomainRepositoryError('corrupt');commands.push({commandId:raw.commandId,canonicalPayload:raw.canonicalPayload});}
   return await this.transaction('readwrite',async tx=>{
    const confirmedRows:{collection:DomainCollection;row:StoredRow}[]=[],confirmedCommands:StoredCommand[]=[];
    for(const expected of records){const old=await this.row(tx,expected.collection,expected.id);if(!old||old.revision!==expected.revision||old.canonicalValue!==canonicalJson(expected.value))return {status:'conflict',reason:'payload'};if(old.provenance==='restored-unverified')confirmedRows.push({collection:expected.collection,row:old});}
    for(const expected of commands){const old=await this.receipt(tx,expected.commandId);if(!old||old.canonicalPayload!==expected.canonicalPayload)return {status:'conflict',reason:'payload'};if(old.provenance==='restored-unverified')confirmedCommands.push(old);}
    // An acknowledged command cannot bypass an unverified state snapshot that it wrote.
    for(const old of confirmedCommands)for(const write of old.command.writes){const row=await this.row(tx,write.collection,write.id);if(row?.provenance==='restored-unverified'&&!records.some(record=>record.collection===write.collection&&record.id===write.id))return {status:'blocked',reason:'reference-unverified'};}
    for(const {collection,row} of confirmedRows)await request(tx.objectStore(collection).put({...row,provenance:'local'}));
    for(const row of confirmedCommands)await request(tx.objectStore('receipts').put({...row,provenance:'local'}));
    return {status:confirmedRows.length||confirmedCommands.length?'committed':'replayed',confirmedRecords:confirmedRows.length,confirmedCommands:confirmedCommands.length};
   });
  }catch(error){return {status:'blocked',reason:failure(error)};}
 }
 private parseBackup(input:unknown):WorkflowBackup{
  if(typeof input==='string'){try{input=JSON.parse(input);}catch{throw new DomainRepositoryError('corrupt');}}
  if(!object(input))throw new DomainRepositoryError('corrupt');strictKeys(input,['kind','schemaVersion','scope','records','commands']);
  if(input.kind!=='lantern-workflow'||input.schemaVersion!==1)throw new DomainRepositoryError('schema');
  if(workflowScopeKey(input.scope as WorkflowScope)!==this.scopeKey)throw new DomainRepositoryError('scope');
  if(!object(input.records)||!Array.isArray(input.commands)||input.commands.length>MAX_COMMANDS)throw new DomainRepositoryError('corrupt');strictKeys(input.records,[...DOMAIN_COLLECTIONS]);
  const records={} as WorkflowBackup['records'];let count=0;
  for(const name of DOMAIN_COLLECTIONS){const items=input.records[name];if(!Array.isArray(items))throw new DomainRepositoryError('corrupt');const seen=new Set<string>();records[name]=items.map(raw=>{
   if(++count>MAX_RECORDS||!object(raw))throw new DomainRepositoryError('corrupt');strictKeys(raw,['id','revision','value','provenance']);if(!validId(raw.id)||!revision(raw.revision)||seen.has(raw.id)||(name==='events'&&raw.revision!==1)||(raw.provenance!==undefined&&raw.provenance!=='local'&&raw.provenance!=='restored-unverified'))throw new DomainRepositoryError('corrupt');seen.add(raw.id);return {id:raw.id,revision:raw.revision,value:canonicalValue(raw.value),provenance:'restored-unverified'};
  });}
  const seen=new Set<string>();
  const commands=input.commands.map(raw=>{
   if(!object(raw))throw new DomainRepositoryError('corrupt');strictKeys(raw,['command','canonicalPayload','payloadHash','receipt','provenance']);
   const parsed=commandRow({...raw,id:object(raw.command)?raw.command.commandId:undefined,scopeKey:this.scopeKey,schemaVersion:1},this.scopeKey);
   if(seen.has(parsed.id))throw new DomainRepositoryError('corrupt');seen.add(parsed.id);return externalCommand(parsed);
  });
  return {kind:'lantern-workflow',schemaVersion:1,scope:canonicalValue(this.scope) as WorkflowScope,records,commands};
 }
}

export async function openLearningDomainRepository(scope:WorkflowScope,options:{factory?:IDBFactory;name?:string}={}):Promise<LearningDomainRepository>{
 workflowScopeKey(scope);
 try{
  const factory=options.factory??globalThis.indexedDB;if(!factory)return new LearningDomainRepository(null,scope,'unavailable');
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
   const req=factory.open(options.name??DB_NAME,1);let settled=false;
   req.onupgradeneeded=()=>{for(const name of STORES){const store=req.result.createObjectStore(name,{keyPath:['scopeKey','id']});store.createIndex('scope','scopeKey');}};
   req.onsuccess=()=>{if(settled){req.result.close();return;}settled=true;resolve(req.result);};
   req.onerror=()=>{if(!settled){settled=true;reject(req.error);}};
   req.onblocked=()=>{if(!settled){settled=true;reject(new DomainRepositoryError('unavailable'));}};
  });
  const valid=STORES.every(name=>db.objectStoreNames.contains(name));
  if(!valid){db.close();return new LearningDomainRepository(null,scope,'schema');}
  const check=db.transaction(STORES,'readonly');
  for(const name of STORES){const store=check.objectStore(name);if(canonicalJson(store.keyPath)!==canonicalJson(['scopeKey','id'])||!store.indexNames.contains('scope')||store.index('scope').keyPath!=='scopeKey'||store.index('scope').unique||store.index('scope').multiEntry){db.close();return new LearningDomainRepository(null,scope,'schema');}}
  db.onversionchange=()=>db.close();
  return new LearningDomainRepository(db,scope);
 }catch(error){return new LearningDomainRepository(null,scope,failure(error));}
}
