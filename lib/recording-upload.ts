type RecordingRow={id:string;userId:string;objectKey:string;body:string;createdAt:string};
type RecordingMetadata={id:string;promptId:string;title:string;duration:number;createdAt:string;uploadedAt:string;mime:string;note:string};
export type RecordingUploadStore={
 read:()=>Promise<RecordingRow|undefined>;
 insert:(row:RecordingRow)=>Promise<unknown>;
 put:(key:string,bytes:ArrayBuffer,mime:string,sha256:string)=>Promise<unknown>;
 object:(key:string)=>Promise<{bytes:ArrayBuffer;mime:string}|null>;
 remove:(key:string)=>Promise<unknown>;
};
const digest=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
// uploadedAt and title are server-derived. Re-upload is not an edit operation.
function semantics(meta:Partial<RecordingMetadata>){
 return JSON.stringify([meta.promptId,meta.createdAt,meta.duration,meta.mime,meta.note??'']);
}

/** An inserted row is the immutable winner. A private, per-request object key
 * means losing or uncertain requests can never overwrite an existing recording.
 * Existing rows, including pre-upgrade object keys, remain readable unchanged. */
export async function storeRecordingUpload(store:RecordingUploadStore,owner:string,meta:RecordingMetadata,bytes:ArrayBuffer):Promise<200|409|503>{
 const sha256=await digest(bytes);
 async function matches(row:RecordingRow):Promise<200|409|503>{
  if(row.userId!==owner)return 409;
  let saved:Partial<RecordingMetadata>;try{saved=JSON.parse(row.body);}catch{return 503;}
  if(!saved||typeof saved!=='object'||semantics(saved)!==semantics(meta))return 409;
  const object=await store.object(row.objectKey);
  if(!object)return 503;
  return object.mime===meta.mime&&object.bytes.byteLength===bytes.byteLength&&await digest(object.bytes)===sha256?200:409;
 }
 const existing=await store.read();
 if(existing)return matches(existing);
 const key=`recordings/${owner}/${meta.id}/${crypto.randomUUID()}`;
 const row={id:meta.id,userId:owner,objectKey:key,body:JSON.stringify(meta),createdAt:meta.createdAt};
 // This key belongs exclusively to this request. Cleanup is best effort; an
 // outage can retain an unreferenced private object, never destroy a winner.
 const remove=async()=>{try{await store.remove(key);}catch{/* preserve outcome */}};
 try{
  await store.put(key,bytes,meta.mime,sha256);
  const stored=await store.object(key);
  if(!stored||stored.mime!==meta.mime||stored.bytes.byteLength!==bytes.byteLength||await digest(stored.bytes)!==sha256){await remove();return 503;}
 }catch{await remove();return 503;}
 // insert may commit and lose its acknowledgement. Always read the winner,
 // including after an exception; never delete on an unknown database outcome.
 let insertUncertain=false;
 try{await store.insert(row);}catch{insertUncertain=true;/* resolve through the persisted row */}
 let winner:RecordingRow|undefined;
 try{winner=await store.read();}catch{return 503;}
 if(!winner){if(!insertUncertain)await remove();return 503;}
 if(winner.objectKey!==key)await remove();
 return matches(winner);
}
