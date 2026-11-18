// Candidate-only ArkWeb adapter; credentials and URL stay in native code.
type Pending={resolve:(body:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;cleanup:()=>void};
type NativeStudyError=Error & {code?:'NATIVE_BUSY'|'NATIVE_REQUEST_LIMIT'|'NATIVE_AUTH'|'NATIVE_CONFLICT'|'NATIVE_EVENT_CONFLICT'|'NATIVE_TRANSIENT'};
type Target={location:{origin:string};top?:unknown;self?:unknown;crypto:{randomUUID:()=>string};
  LanternStudySyncHost?:{request:(raw:string)=>void;cancel:(id:string)=>void};__lanternStudySyncReceive?:(payload:unknown)=>void};
type Payload={owner:string;wire?:unknown;checkpoint?:string|null;continuation?:string|null;signal:AbortSignal};
export function createNativeStudyTransport(target:Target=window as unknown as Target){
 const pending=new Map<string,Pending>();let disposed=false;
 const trusted=()=>target.location.origin==='https://lantern.local'&&(target.top===undefined||target.top===target.self);
 const previous=target.__lanternStudySyncReceive;
 function finish(id:string,body?:unknown,error?:Error){const item=pending.get(id);if(!item)return;pending.delete(id);clearTimeout(item.timer);item.cleanup();if(error)item.reject(error);else item.resolve(body);}
 const receive=(input:unknown)=>{
  if(disposed||!trusted()||!input||typeof input!=='object'||Array.isArray(input))return;
  const value=input as {id?:unknown;status?:unknown;body?:unknown};if(typeof value.id!=='string'||!pending.has(value.id))return;
  if(Object.keys(input).sort().join(',')==='body,id,status'&&value.status===503&&value.body&&typeof value.body==='object'&&!Array.isArray(value.body)&&Object.keys(value.body).join(',')==='code'){
   const code=(value.body as {code?:unknown}).code;
   if(code==='busy'||code==='request_limit'||code==='unavailable'){const error:NativeStudyError=Error('study sync unavailable');error.code=code==='busy'?'NATIVE_BUSY':code==='request_limit'?'NATIVE_REQUEST_LIMIT':'NATIVE_TRANSIENT';return finish(value.id,undefined,error);}
  }
  if(Object.keys(input).sort().join(',')==='body,id,status'&&(value.status===401||value.status===409)&&value.body&&typeof value.body==='object'&&!Array.isArray(value.body)&&Object.keys(value.body).join(',')==='code'){
   const code=(value.body as {code?:unknown}).code;
   if((value.status===401&&code==='unauthenticated')||(value.status===409&&(code==='conflict'||code==='event_conflict'))){const error:NativeStudyError=Error('study sync unavailable');error.code=value.status===401?'NATIVE_AUTH':code==='event_conflict'?'NATIVE_EVENT_CONFLICT':'NATIVE_CONFLICT';return finish(value.id,undefined,error);}
  }
  if(Object.keys(input).sort().join(',')!=='body,id,status'||value.status!==200||!value.body||typeof value.body!=='object'||Array.isArray(value.body))return finish(value.id,undefined,Error('study sync unavailable'));
  finish(value.id,value.body);
 };
 if(trusted())target.__lanternStudySyncReceive=receive;
 function request(action:'upload'|'pull',payload:Payload):Promise<unknown>{
  if(disposed||!trusted()||!target.LanternStudySyncHost||typeof target.crypto?.randomUUID!=='function'||payload.signal.aborted)return Promise.reject(Error('study sync unavailable'));
  const id=target.crypto.randomUUID();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)||pending.has(id))return Promise.reject(Error('study sync unavailable'));
  const fields=action==='upload'?{owner:payload.owner,wire:payload.wire}:{owner:payload.owner,checkpoint:payload.checkpoint??null,continuation:payload.continuation??null};
  return new Promise((resolve,reject)=>{
   const abort=()=>{try{target.LanternStudySyncHost?.cancel(id);}catch{}finish(id,undefined,Error('study sync cancelled'));};
   const timer=setTimeout(()=>{try{target.LanternStudySyncHost?.cancel(id);}catch{}const error:NativeStudyError=Error('study sync timeout');error.code='NATIVE_TRANSIENT';finish(id,undefined,error);},15000);pending.set(id,{resolve,reject,timer,cleanup:()=>payload.signal.removeEventListener('abort',abort)});
   payload.signal.addEventListener('abort',abort,{once:true});
   try{target.LanternStudySyncHost!.request(JSON.stringify({id,action,...fields}));}catch{finish(id,undefined,Error('study sync unavailable'));}
  });
 }
 return {async upload(payload:Payload){return {status:200,body:await request('upload',payload)};},
  pull:(payload:Payload)=>request('pull',payload),
  dispose(){disposed=true;for(const id of [...pending.keys()]){try{target.LanternStudySyncHost?.cancel(id);}catch{}finish(id,undefined,Error('study sync cancelled'));}
   if(target.__lanternStudySyncReceive===receive){if(previous)target.__lanternStudySyncReceive=previous;else delete target.__lanternStudySyncReceive;}}
 };
}
