/** Inactive chunk staging + atomic publication, using the integrator's IDBDatabase. */
export const RUNS='v040ImportRuns',CHUNKS='v040ImportChunks';
export function createSpoolStores(db){
  if(!db.objectStoreNames.contains(RUNS))db.createObjectStore(RUNS,{keyPath:'runId'});
  if(!db.objectStoreNames.contains(CHUNKS)){const store=db.createObjectStore(CHUNKS,{keyPath:['runId','asset','seq']});store.createIndex('runId','runId');}
}
export const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error??new Error('IndexedDB request failed'));});
async function transaction(db,names,mode,work,signal){
  if(signal?.aborted)throw signal.reason??new Error('Cancelled');
  const tx=db.transaction([...new Set(names)],mode),done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error??new Error('Transaction aborted'));tx.onerror=()=>{};});void done.catch(()=>{});
  const abort=()=>{try{tx.abort();}catch{}};signal?.addEventListener('abort',abort,{once:true});
  try{const value=await work(tx);await done;return value;}catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw signal?.aborted?(signal.reason??error):error;}finally{signal?.removeEventListener('abort',abort);}
}
export class IdbSpool {
  static async begin(db,ownerId,runId=crypto.randomUUID()){
    if(typeof ownerId!=='string'||!ownerId.trim())throw new Error('Owner required');
    await transaction(db,[RUNS],'readwrite',tx=>request(tx.objectStore(RUNS).add({runId,ownerId,status:'staging',createdAt:Date.now()})));
    return new IdbSpool(db,ownerId,runId);
  }
  constructor(db,ownerId,runId,counts={}){this.db=db;this.ownerId=ownerId;this.runId=runId;this.counts={...counts};this.nextId=Object.keys(counts).length;this.closed=false;this.sealed=Object.keys(counts).length>0;}
  async createSink(){
    if(this.closed||this.sealed)throw new Error('Stage closed or sealed');const id=String(this.nextId++);let seq=0,closed=false;
    return {id,write:async bytes=>{if(closed||this.closed)throw new Error('Stage closed');await transaction(this.db,[CHUNKS],'readwrite',tx=>request(tx.objectStore(CHUNKS).add({runId:this.runId,asset:id,seq,bytes})));seq++;},close:async()=>{closed=true;this.counts[id]=seq;}};
  }
  async *read(id){
    const count=this.counts[id];if(!Number.isInteger(count))throw new Error('Unfinished or unknown asset');
    for(let seq=0;seq<count;seq++){const row=await transaction(this.db,[CHUNKS],'readonly',tx=>request(tx.objectStore(CHUNKS).get([this.runId,id,seq])));if(!row)throw new Error('Missing staged chunk');yield row.bytes;}
  }
  async retain(ids){
    this.sealed=true;
    const keep=new Set(ids);
    await transaction(this.db,[CHUNKS],'readwrite',tx=>new Promise((resolve,reject)=>{
      const store=tx.objectStore(CHUNKS),cursor=store.index('runId').openCursor(this.runId);
      cursor.onerror=()=>reject(cursor.error);cursor.onsuccess=()=>{const row=cursor.result;if(!row){resolve();return;}if(!keep.has(row.value.asset))row.delete();row.continue();};
    }));
    this.counts=Object.fromEntries(Object.entries(this.counts).filter(([id])=>keep.has(id)));
  }
  async activate(manifest,{stores=[],write,signal}={}){
    await transaction(this.db,[RUNS,...stores],'readwrite',async tx=>{
      const store=tx.objectStore(RUNS),run=await request(store.get(this.runId));
      if(!run||run.status!=='staging'||run.ownerId!==this.ownerId||manifest.ownerId!==this.ownerId)throw new Error('Invalid or stale stage');
      // write must use only this transaction (IDB requests), no network/hash/timers.
      await write?.(tx,manifest);
      await request(store.put({...run,status:'active',manifest,counts:this.counts}));
    },signal);
  }
  async discard(){
    this.closed=true;
    await transaction(this.db,[RUNS,CHUNKS],'readwrite',async tx=>{
      const store=tx.objectStore(CHUNKS);
      await new Promise((resolve,reject)=>{const cursor=store.index('runId').openKeyCursor(this.runId);cursor.onerror=()=>reject(cursor.error);cursor.onsuccess=()=>{const row=cursor.result;if(!row){resolve();return;}store.delete(row.primaryKey);row.continue();};});
      await request(tx.objectStore(RUNS).delete(this.runId));
    });
  }
}
export async function activeManifest(db,ownerId,runId){const run=await transaction(db,[RUNS],'readonly',tx=>request(tx.objectStore(RUNS).get(runId)));if(!run||run.status!=='active'||run.ownerId!==ownerId)throw new Error('No active import for current owner');return run;}
export async function readActiveAssetBlob(db,ownerId,runId,spoolId){
  const run=await activeManifest(db,ownerId,runId),asset=run.manifest.packages.flatMap(p=>p.assets).find(a=>a.spoolId===spoolId);
  if(!asset)throw new Error('Asset not published');
  const stage=new IdbSpool(db,ownerId,runId,run.counts),parts=[];let bytes=0;
  for await(const chunk of stage.read(spoolId)){parts.push(chunk);bytes+=chunk.length;}
  if(bytes!==asset.bytes)throw new Error('Stored asset length mismatch');
  return new Blob(parts,{type:asset.mime});
}
