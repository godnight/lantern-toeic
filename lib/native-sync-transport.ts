// Candidate page adapter. No token or configurable network address passes here.
export type SyncAction = 'append' | 'begin' | 'page';
type Body = {owner:string;event?:object;pageSize?:number;snapshot?:string;cursor?:string};
type Reply = {id:string;status:number;body:unknown};
type NativeSyncError = Error & {code?:'NATIVE_BUSY'|'NATIVE_REQUEST_LIMIT'|'NATIVE_AUTH'|'NATIVE_CONFLICT'|'NATIVE_EVENT_CONFLICT'|'NATIVE_TRANSIENT'};
type Pending = {resolve:(body:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;abort:()=>void};
export type SyncWindow = {location:{origin:string};top?:unknown;self?:unknown;
  crypto:{randomUUID:()=>string};LanternSyncHost?:{request:(raw:string)=>void;cancel:(id:string)=>void};
  __lanternSyncReceive?:(reply:unknown)=>void};

export function createNativeSyncTransport(target:SyncWindow=window as unknown as SyncWindow) {
  const pending=new Map<string,Pending>();let disposed=false;
  const trusted=()=>target.location.origin==='https://lantern.local' && (target.top===undefined||target.top===target.self);
  const previous=target.__lanternSyncReceive;
  function finish(id:string, body?:unknown, error?:Error) {
    const item=pending.get(id);if(!item)return;pending.delete(id);clearTimeout(item.timer);item.abort();
    if(error)item.reject(error);else item.resolve(body);
  }
  const receive=(value:unknown)=>{
    if(disposed||!trusted()||!value||typeof value!=='object'||Array.isArray(value))return;
    const reply=value as Reply;
    if(typeof reply.id!=='string'||!pending.has(reply.id))return;
    if(Object.keys(value).sort().join(',')==='body,id,status' && reply.status===503 &&
      reply.body && typeof reply.body==='object' && !Array.isArray(reply.body) &&
      Object.keys(reply.body).join(',')==='code') {
      const code=(reply.body as {code?:unknown}).code;
      if(code==='busy'||code==='request_limit') {
        const error:NativeSyncError=new Error('sync unavailable');
        error.code=code==='busy'?'NATIVE_BUSY':'NATIVE_REQUEST_LIMIT';
        finish(reply.id,undefined,error);return;
      }
      if(code==='unavailable') {const error:NativeSyncError=new Error('sync unavailable');error.code='NATIVE_TRANSIENT';finish(reply.id,undefined,error);return;}
    }
    if(Object.keys(value).sort().join(',')==='body,id,status' && (reply.status===401||reply.status===409) &&
      reply.body && typeof reply.body==='object' && !Array.isArray(reply.body) && Object.keys(reply.body).join(',')==='code') {
      const code=(reply.body as {code?:unknown}).code;
      if((reply.status===401&&code==='unauthenticated')||(reply.status===409&&(code==='conflict'||code==='event_conflict'))){
        const error:NativeSyncError=new Error('sync unavailable');error.code=reply.status===401?'NATIVE_AUTH':code==='event_conflict'?'NATIVE_EVENT_CONFLICT':'NATIVE_CONFLICT';finish(reply.id,undefined,error);return;
      }
    }
    if(Object.keys(value).sort().join(',')!=='body,id,status'||reply.status!==200||
      !reply.body||typeof reply.body!=='object'||Array.isArray(reply.body)) {finish(reply.id,undefined,new Error('sync unavailable'));return;}
    finish(reply.id,reply.body);
  };
  if(trusted())target.__lanternSyncReceive=receive;
  function request(action:SyncAction,body:Body,signal:AbortSignal):Promise<unknown> {
    if(disposed||!trusted()||!target.LanternSyncHost||typeof target.crypto?.randomUUID!=='function')return Promise.reject(new Error('sync unavailable'));
    if(signal.aborted)return Promise.reject(new Error('sync cancelled'));
    const requestId=target.crypto.randomUUID();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)||pending.has(requestId))return Promise.reject(new Error('sync unavailable'));
    const nativeAction=action==='begin'?'snapshot':action;
    return new Promise((resolve,reject)=>{
      const abort=()=>{try{target.LanternSyncHost?.cancel(requestId);}catch{}finish(requestId,undefined,new Error('sync cancelled'));};
      const timer=setTimeout(()=>{try{target.LanternSyncHost?.cancel(requestId);}catch{}const error:NativeSyncError=new Error('sync timeout');error.code='NATIVE_TRANSIENT';finish(requestId,undefined,error);},15000);
      pending.set(requestId,{resolve,reject,timer,abort:()=>signal.removeEventListener('abort',abort)});
      signal.addEventListener('abort',abort,{once:true});
      const clean=action==='append'?{owner:body.owner,event:body.event}:action==='begin'?{owner:body.owner,pageSize:body.pageSize}:
        {owner:body.owner,snapshot:body.snapshot,cursor:body.cursor};
      try { target.LanternSyncHost!.request(JSON.stringify({id:requestId,action:nativeAction,...clean})); }
      catch { finish(requestId,undefined,new Error('sync unavailable')); }
    });
  }
  return {
    append:(body:Body,signal:AbortSignal)=>request('append',body,signal),
    begin:(body:Body,signal:AbortSignal)=>request('begin',body,signal),
    page:(body:Body,signal:AbortSignal)=>request('page',body,signal),
    dispose(){disposed=true;for(const id of [...pending.keys()]){try{target.LanternSyncHost?.cancel(id);}catch{}finish(id,undefined,new Error('sync cancelled'));}
      if(target.__lanternSyncReceive===receive){if(previous)target.__lanternSyncReceive=previous;else delete target.__lanternSyncReceive;}}
  };
}
