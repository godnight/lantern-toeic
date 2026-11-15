import type {NativeLeaseSnapshot,NativeSyncLeasePort} from './native-lifecycle';

type NativeBridge={drain:(id:string)=>void};
type Target={location:{origin:string};top?:unknown;self?:unknown;crypto:{randomUUID:()=>string};
  LanternLifecycleHost?:{snapshot:(id:string)=>void;hold:(id:string)=>void;complete:(id:string)=>void;resume:(id:string)=>void};
  LanternSyncHost?:NativeBridge;LanternStudySyncHost?:NativeBridge;
  __lanternLifecycleReceive?:(message:unknown)=>void;__lanternSyncDrainReceive?:(message:unknown)=>void};
type Kind='snapshot'|'hold'|'complete'|'resume'|'drain';
type Pending={kind:Kind;source?:'vocabulary'|'study';resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER=/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string)=>Object.keys(value).sort().join(',')===keys;

/** Only the verified owner ID/sequence crosses this port; Asset tokens remain native. */
export function createNativeSyncLeasePort(target:Target=window as unknown as Target,timeoutMs=10000):NativeSyncLeasePort&{dispose:()=>void}{
 if(!target||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('native lease unavailable');
 const trusted=()=>target.location.origin==='https://lantern.local'&&(target.top===undefined||target.top===target.self);
 if(!trusted()||target.__lanternLifecycleReceive!==undefined||target.__lanternSyncDrainReceive!==undefined)throw Error('native lease unavailable');
 const pending=new Map<string,Pending>(),listeners=new Set<()=>void>();let disposed=false,lastSeq=-1;
 function notify(){for(const listener of listeners){try{listener();}catch{/* one consumer cannot block revocation */}}}
 function finish(id:string,value?:unknown,error?:Error){const item=pending.get(id);if(!item)return;pending.delete(id);clearTimeout(item.timer);if(error)item.reject(error);else item.resolve(value);}
 function lifecycle(value:unknown){
  if(disposed||!trusted()||!record(value)||typeof value.kind!=='string'||!Number.isSafeInteger(value.seq)||(value.seq as number)<0)return;
  const seq=value.seq as number;
  if(value.kind==='revoked'&&exact(value,'kind,seq')){if(seq>lastSeq){lastSeq=seq;notify();}return;}
  if(typeof value.id!=='string')return;const item=pending.get(value.id);if(!item)return;
  const expected=item.kind==='snapshot'?'snapshot':item.kind==='hold'?'held':item.kind==='complete'?'completed':item.kind==='resume'?'resumed':'';
  if(value.kind!==expected||!exact(value,item.kind==='snapshot'?'id,kind,owner,seq':'id,kind,seq')||seq<lastSeq){finish(value.id,undefined,Error('native lease unavailable'));return;}
  if(seq>lastSeq&&lastSeq>=0){lastSeq=seq;notify();finish(value.id,undefined,Error('native lease changed'));return;}
  lastSeq=seq;
  if(item.kind==='snapshot'){
   if(value.owner!==null&&(typeof value.owner!=='string'||!OWNER.test(value.owner))){finish(value.id,undefined,Error('native lease unavailable'));return;}
   finish(value.id,value.owner===null?null:{owner:value.owner,seq});return;
  }
  finish(value.id);
 }
 function drained(value:unknown){
  if(disposed||!trusted()||!record(value)||!exact(value,'id,source')||typeof value.id!=='string')return;
  const item=pending.get(value.id);if(!item||item.kind!=='drain')return;
  if(value.source!==item.source){finish(value.id,undefined,Error('native drain unavailable'));return;}
  finish(value.id);
 }
 target.__lanternLifecycleReceive=lifecycle;target.__lanternSyncDrainReceive=drained;
 function invoke(kind:Kind,source?:'vocabulary'|'study'):Promise<unknown>{
  if(disposed||!trusted()||typeof target.crypto?.randomUUID!=='function'||pending.size>=16)return Promise.reject(Error('native lease unavailable'));
  const bridge=kind==='drain'?(source==='vocabulary'?target.LanternSyncHost:target.LanternStudySyncHost):target.LanternLifecycleHost;
  const method=kind==='drain'?'drain':kind;
  if(!bridge||typeof (bridge as unknown as Record<string,unknown>)[method]!=='function')return Promise.reject(Error('native lease unavailable'));
  const id=target.crypto.randomUUID();if(!UUID.test(id)||pending.has(id))return Promise.reject(Error('native lease unavailable'));
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>finish(id,undefined,Error('native lease timeout')),timeoutMs);
   pending.set(id,{kind,source,resolve,reject,timer});
   try{(bridge as unknown as Record<string,(id:string)=>void>)[method](id);}catch{finish(id,undefined,Error('native lease unavailable'));}
  });
 }
 return Object.freeze({
  snapshot:()=>invoke('snapshot') as Promise<NativeLeaseSnapshot|null>,
  hold:async()=>{await invoke('hold');},complete:async()=>{await invoke('complete');},resume:async()=>{await invoke('resume');},
  async drain(){if(!target.LanternSyncHost||!target.LanternStudySyncHost)throw Error('native drain unavailable');await Promise.all([invoke('drain','vocabulary'),invoke('drain','study')]);},
  subscribeRevocation(listener:()=>void){if(disposed||typeof listener!=='function')throw Error('native lease unavailable');listeners.add(listener);return()=>{listeners.delete(listener);};},
  dispose(){if(disposed)return;disposed=true;for(const id of [...pending.keys()])finish(id,undefined,Error('native lease unavailable'));listeners.clear();
   if(target.__lanternLifecycleReceive===lifecycle)delete target.__lanternLifecycleReceive;
   if(target.__lanternSyncDrainReceive===drained)delete target.__lanternSyncDrainReceive;},
 });
}
