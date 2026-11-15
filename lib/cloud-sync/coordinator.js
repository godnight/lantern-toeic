'use strict';
// Synthetic-only orchestration. fence.commit MUST compare its durable lease and
// call isLive immediately before its write inside the SAME transaction.
const OWNER=/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function cancelled(){const error=new Error('session revoked');error.code='CANCELLED';return error;}
function guarded(promise,signal){
 if(signal.aborted)return Promise.reject(cancelled());
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(fn,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);fn(value);};
  const abort=()=>finish(reject,cancelled());signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>finish(resolve,value),error=>finish(reject,error));
  if(signal.aborted)abort();
 });
}
function sleep(ms,signal){return new Promise((resolve,reject)=>{
 if(signal.aborted){reject(cancelled());return;}
 const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
 const abort=()=>{clearTimeout(timer);reject(cancelled());};signal.addEventListener('abort',abort,{once:true});
});}
function createCoordinator({fence,vocabulary,study,maxBusyRetries=2,wait=sleep}){
 if(!fence||!['activate','revoke','commit'].every(k=>typeof fence[k]==='function')||
  typeof vocabulary!=='function'||typeof study!=='function'||typeof wait!=='function'||
  !Number.isInteger(maxBusyRetries)||maxBusyRetries<0||maxBusyRetries>5)throw Error('invalid configuration');
 let current=null,epoch=0,fenceQueue=Promise.resolve();
 const enqueueFence=work=>{const p=fenceQueue.then(work);fenceQueue=p.catch(()=>{});return p;};
 const live=s=>current===s&&!s.controller.signal.aborted;
 const ensure=s=>{if(!live(s))throw cancelled();};
 function revokeLocal(){const old=current;current=null;if(old)old.controller.abort();return old;}
 function activate(owner){
  if(typeof owner!=='string'||!OWNER.test(owner))return Promise.reject(Error('invalid owner'));
  const previous=revokeLocal();const s={owner,epoch:++epoch,controller:new AbortController(),ticket:null,ready:false,running:false};current=s;
  return enqueueFence(async()=>{
   if(previous?.ticket!=null)await fence.revoke(previous.ticket);
   ensure(s);const ticket=await fence.activate(owner);
   if(ticket===null||ticket===undefined)throw Error('invalid fence ticket');s.ticket=ticket;ensure(s);s.ready=true;
   return Object.freeze({owner:s.owner,epoch:s.epoch});
  }).catch(error=>{if(current===s)revokeLocal();throw error;});
 }
 function cancel(){++epoch;const old=revokeLocal();return enqueueFence(()=>old?.ticket!=null?fence.revoke(old.ticket):undefined);}
 function session(){const s=current;if(!s||!s.ready)throw cancelled();ensure(s);
  return Object.freeze({owner:s.owner,epoch:s.epoch,ticket:s.ticket,signal:s.controller.signal});}
 async function run(){
  const s=current;if(!s||!s.ready)throw cancelled();ensure(s);if(s.running)throw Error('sync busy');s.running=true;
  const signal=s.controller.signal;
  const context=Object.freeze({owner:s.owner,epoch:s.epoch,ticket:s.ticket,signal,
   commit:async payload=>{ensure(s);await fence.commit(s.ticket,payload,()=>live(s));ensure(s);},
   assertActive:()=>ensure(s)});
  try{
   for(const step of [vocabulary,study]){
    let retries=0;
    for(;;){
     ensure(s);
     try{await guarded(Promise.resolve().then(()=>step(context)),signal);ensure(s);break;}
     catch(error){
      // Re-entering a whole step is safe only when its adapter explicitly
      // guarantees that already acknowledged events cannot be duplicated.
      ensure(s);if(error?.code!=='BUSY'||error?.safeToRetry!==true||retries>=maxBusyRetries)throw error;
      const ms=Math.min(1000,50*(2**retries++));await guarded(Promise.resolve().then(()=>wait(ms,signal)),signal);ensure(s);
     }
    }
   }
  }finally{s.running=false;}
 }
 return Object.freeze({activate,cancel,run,session});
}
export {createCoordinator};
