// The owner holds the D1 lock throughout this lifecycle. A failed disposal or
// an unreturned runtime leaves the lock retained by openLockedD1.
import {verifyAccountDatabase} from './account-db-preflight.candidate.mjs';
import {verifyPhoneDatabase} from './phone-runtime.candidate.mjs';
import {prepareCloudService} from './service.candidate.mjs';
export function createSwitchableD1(initial,createRuntime){
 if(!initial||typeof initial.dispose!=='function'||typeof createRuntime!=='function')throw Error('invalid D1 runtime');
 let current=initial,poisoned=false,disposed=false;
 return Object.freeze({
  get mf(){if(!current||disposed)throw Error('D1 runtime unavailable');return current},
  async replace(spec){
   if(!current||poisoned||disposed)throw Error('D1 runtime unavailable');
   try{await current.dispose()}catch{poisoned=true;throw Error('old D1 runtime did not stop; lock retained')}
   current=null;
   try{current=await createRuntime(spec)}catch{poisoned=true;throw Error('new D1 runtime outcome unknown; lock retained')}
   if(!current||typeof current.dispose!=='function'){poisoned=true;throw Error('new D1 runtime outcome unknown; lock retained')}
   await current.ready;
  },
  async dispose(){
   if(disposed)return;if(poisoned)throw Error('D1 runtime outcome unknown; lock retained');
   if(current)await current.dispose();current=null;disposed=true;
  },
 });
}

// This trusted in-process function runs while openLockedD1 owns the lock.
// buildPhone is supplied only by the fixed launcher, never by config or HTTP.
export async function prepareLockedCloudService({runtime,origin,phone,buildPhone,settings,privateRoot,key,proxy,phoneKey,modelInfo}={}){
 await verifyAccountDatabase(await runtime.mf.getD1Database('DB'));
 let phoneEnabled=false;
 if(phone){
  if(typeof buildPhone!=='function')throw Error('phone preflight unavailable');
  const candidate=await buildPhone(runtime.mf);
  if(candidate?.enabled!==true)throw Error('phone preflight unavailable');
  await runtime.replace(candidate);
  await verifyAccountDatabase(await runtime.mf.getD1Database('DB'));
  await verifyPhoneDatabase({mf:runtime.mf,policy:phone.policy});phoneEnabled=true;
 }
 return prepareCloudService({enabled:true,mf:runtime.mf,origin,phoneEnabled,settings,privateRoot,key,proxy,phoneKey,modelInfo});
}
