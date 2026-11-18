import type {NativeAccountController} from '../native-account-controller';
import {createNativeSyncLifecycle,type LocalSyncClient,type NativeSyncLeasePort} from './native-lifecycle';
import {createNativeSyncLeasePort} from './native-lifecycle-port';

// This gate is deliberately independent of the native bridge gate. A real
// account-scoped product client, transport and migration are not ready yet.
export const NATIVE_ACCOUNT_SYNC_ENABLED:boolean=false;
type Port=NativeSyncLeasePort&{dispose:()=>void};
type Dependencies={enabled:boolean;createClient?:()=>LocalSyncClient;createPort?:()=>Port};

/** Install synchronously before the controller starts; never open real data here. */
export function attachNativeAccountSync(account:NativeAccountController,dependencies?:Dependencies):()=>void {
  if(!(dependencies?.enabled??NATIVE_ACCOUNT_SYNC_ENABLED))return ()=>{};
  let port:Port|undefined,client:LocalSyncClient|undefined;
  try{
    // There is intentionally no production client factory yet. In particular,
    // the synthetic-only candidate must never be mistaken for a real queue.
    if(!dependencies?.createClient)throw Error('account sync client unavailable');
    client=dependencies.createClient();
    port=(dependencies.createPort??createNativeSyncLeasePort)();
    const lifecycle=createNativeSyncLifecycle(account,client,port);
    let disposed=false;
    return ()=>{if(disposed)return;disposed=true;lifecycle.dispose();port?.dispose();};
  }catch{
    port?.dispose();
    try{void Promise.resolve(client?.cancel()).catch(()=>{});}catch{/* Fail closed below. */}
    // If a future build enables this before its dependencies are ready, do not
    // let an account mutation race an unguarded native sync operation.
    return account.setSyncTransitionGuard({
      prepare:async()=>{throw Error('account sync unavailable');},
      complete:async()=>{throw Error('account sync unavailable');},
    });
  }
}
