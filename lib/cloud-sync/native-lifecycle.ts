import type {NativeAccountController,NativeAccountState} from '../native-account-controller';
import type {AccountAccess} from '../session-proof';

/** Native-only lease observation must never expose the Asset token to JS. */
export type NativeLeaseSnapshot=Readonly<{owner:string;seq:number}>;
export type NativeSyncLeasePort={
  snapshot:()=>Promise<NativeLeaseSnapshot|null>;
  subscribeRevocation:(listener:()=>void)=>()=>void;
  // Resolves only after both native bridges have actually left withSession.
  drain:()=>Promise<void>;
};
export type LocalSyncClient={activate:(owner:string)=>Promise<unknown>;cancel:()=>Promise<unknown>};
export type LifecycleStatus=Readonly<{phase:'blocked'|'checking'|'ready'|'disposed';owner:string|null}>;

const OWNER=/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function candidate(state:NativeAccountState):{owner:string;access:AccountAccess}|null {
  if(state.status!=='ready'||state.unavailable||!state.user||!OWNER.test(state.user.id)||
    state.access.owner!==state.user.id||state.access.user?.id!==state.user.id||
    !state.access.sessionSignal||state.access.sessionSignal.aborted||!state.access.assertAccess())return null;
  return {owner:state.user.id,access:state.access};
}
function snapshot(value:unknown):NativeLeaseSnapshot|null {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='owner,seq')return null;
  const v=value as Partial<NativeLeaseSnapshot>;
  return typeof v.owner==='string'&&OWNER.test(v.owner)&&typeof v.seq==='number'&&Number.isSafeInteger(v.seq)&&v.seq>=0?{owner:v.owner,seq:v.seq}:null;
}

/**
 * Default-off building block. The real product does not yet provide the
 * required native lease observer or a bridge drain port. This controller does
 * not enable synchronization, initiate auth requests, or accept credentials.
 * Native notifications and IDB commits are asynchronous, not one transaction.
 */
export function createNativeSyncLifecycle(account:Pick<NativeAccountController,'getSnapshot'|'subscribe'>,
 client:LocalSyncClient,native:NativeSyncLeasePort){
  if(!account||typeof account.getSnapshot!=='function'||typeof account.subscribe!=='function'||
    !client||typeof client.activate!=='function'||typeof client.cancel!=='function'||
    !native||typeof native.snapshot!=='function'||typeof native.drain!=='function'||typeof native.subscribeRevocation!=='function')throw Error('native sync lifecycle unavailable');
  let generation=0,disposed=false,poisoned=false,phase:LifecycleStatus['phase']='blocked',owner:string|null=null;
  let observed:AccountAccess|null=null,removeAbort:(()=>void)|null=null,tail:Promise<void>=Promise.resolve();
  const same=(id:number,state:NativeAccountState,access:AccountAccess)=>!disposed&&!poisoned&&generation===id&&
    account.getSnapshot()===state&&access.sessionSignal?.aborted===false&&access.canAccess();
  function detachAbort(){removeAbort?.();removeAbort=null;}
  function cancelNow():Promise<void>{
    try{return Promise.resolve(client.cancel()).then(()=>{});}catch{return Promise.reject(Error('sync cancellation failed'));}
  }
  function invalidate():Promise<void>{
    ++generation;owner=null;observed=null;phase=disposed?'disposed':'blocked';detachAbort();
    // Invoke immediately: async completion is joined below, but queue's local
    // AbortController must be revoked before the account listener returns.
    const cancelling=cancelNow().catch(error=>{poisoned=true;throw error;});cancelling.catch(()=>{});
    tail=tail.catch(()=>{}).then(()=>cancelling);return tail;
  }
  function onState(state:NativeAccountState):void {
    if(disposed)return;
    const next=candidate(state);
    if(next&&phase==='ready'&&observed===next.access&&owner===next.owner)return;
    const cancelled=invalidate(),id=generation;
    if(!next)return;
    observed=next.access;phase='checking';
    const abort=()=>{if(!disposed&&observed===next.access)void invalidate().catch(()=>{});};
    next.access.sessionSignal!.addEventListener('abort',abort,{once:true});
    removeAbort=()=>next.access.sessionSignal!.removeEventListener('abort',abort);
    let activationStarted=false;
    tail=cancelled.then(async()=>{
      if(!same(id,state,next.access))throw Error('session revoked');
      await native.drain();if(!same(id,state,next.access))throw Error('session revoked');
      const before=snapshot(await native.snapshot());
      if(!before||before.owner!==next.owner||!same(id,state,next.access))throw Error('native lease unavailable');
      activationStarted=true;await client.activate(next.owner);
      if(!same(id,state,next.access))throw Error('session revoked');
      const after=snapshot(await native.snapshot());
      if(!after||after.owner!==before.owner||after.seq!==before.seq||!same(id,state,next.access))throw Error('native lease changed');
      owner=next.owner;phase='ready';
    }).catch(async()=>{
      // A late activation is drained before a newer state can pass the serial
      // barrier, even if its underlying implementation ignored cancellation.
      if(activationStarted)await cancelNow().catch(()=>{poisoned=true;});
      if(id!==generation||disposed)return;
      owner=null;phase='blocked';
    });
  }
  const unsubscribe=account.subscribe(onState);
  let unsubscribeNative:()=>void;
  try{unsubscribeNative=native.subscribeRevocation(()=>{if(!disposed)void invalidate().catch(()=>{});});if(typeof unsubscribeNative!=='function')throw Error('missing unsubscribe');}
  catch{unsubscribe();throw Error('native sync lifecycle unavailable');}
  onState(account.getSnapshot());
  return Object.freeze({
    status:():LifecycleStatus=>Object.freeze({phase,owner}),
    settled:()=>tail,
    // A future account UI must await this before changing the native session;
    // merely subscribing here cannot delay NativeAccountController.mutate().
    async prepareAccountChange():Promise<void>{
      if(disposed||poisoned)throw Error('lifecycle unavailable');
      const id=generation+1;await invalidate();await native.drain();
      if(disposed||generation!==id)throw Error('account transition superseded');
    },
    dispose(){if(disposed)return;disposed=true;unsubscribe();unsubscribeNative();void invalidate().catch(()=>{});},
  });
}
