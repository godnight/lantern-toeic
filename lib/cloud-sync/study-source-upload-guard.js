// Candidate-only fence for queued operations imported from the loose journal.
// The source and IDB are not one transaction: check the actual operation
// immediately before dispatch and again before accepting the response.
import {captureStudySource} from './study-source-snapshot.js';
function conflict(){const error=Error('study source changed; original records retained');error.code='NATIVE_EVENT_CONFLICT';return error;}
function stable(value){return Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`:JSON.stringify(value);}
function same(a,b){return stable(a)===stable(b);}
export function guardStudyJournalUpload(storage,client,transport){
 if(!storage||typeof storage.getItem!=='function'||!client||typeof client.readStudy!=='function'||!transport||typeof transport.upload!=='function'||typeof transport.pull!=='function')throw Error('study source guard unavailable');
 let lastUpload;
 return {
  async upload(payload){
   const session=client.session,wire=payload?.wire;
   const active=()=>!!session&&client.session===session&&!session.signal.aborted&&session.owner===payload?.owner&&wire?.owner===session.owner;
   if(!active()||!wire||typeof wire.id!=='string'||!['attempt','checkin'].includes(wire.type))throw conflict();
   const prefix='lantern-v1-'+session.owner, name=prefix+':op:'+wire.id, epoch=storage.getItem(prefix+':checkpoint-epoch');
   const raw=storage.getItem(name);let op;
   try{op=JSON.parse(raw);}catch{throw conflict();}
   if(!op||op.id!==wire.id||op.owner!==session.owner||op.type!==wire.type||!op.data||typeof op.data!=='object')throw conflict();
   const sourceCurrent=captureStudySource(storage,session.owner,op);
   const d=op.data;
   const data=op.type==='attempt'?{id:d.id,qid:d.qid,choice:d.choice,createdAt:d.createdAt,seconds:d.seconds,...(op.firstAttemptId===undefined?{}:{firstAttemptId:op.firstAttemptId})}:d;
   if(!same(data,wire.data))throw conflict();
   const current=()=>active()&&storage.getItem(prefix+':checkpoint-epoch')===epoch&&storage.getItem(name)===raw&&sourceCurrent();
   if(!current())throw conflict();
   const state=await client.readStudy();
   const rows=state?.pendingOperations?.filter(item=>item?.id===wire.id);
   if(!current()||!Array.isArray(rows)||rows.length!==1||!same(rows[0],op))throw conflict();
   lastUpload=current;const response=await transport.upload(payload);
   if(!current())throw conflict();
   return response;
  },
  assertUploadCurrent(){if(!lastUpload||!lastUpload())throw conflict();},
  pull:payload=>transport.pull(payload),
 };
}
