export type CooperativeTaskQueue={yield:()=>Promise<void>;close:()=>void};
const timerYield=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
const now=()=>typeof performance==='undefined'?Date.now():performance.now();
/** One queue per complete operation; no shared consumer can close another's.
 * Timer fallback retains bounded work on engines without MessageChannel. */
export function createCooperativeTaskQueue():CooperativeTaskQueue{
 try{
  if(typeof MessageChannel==='undefined')return {yield:timerYield,close:()=>{}};
  const channel=new MessageChannel();let resume:(()=>void)|null=null;
  channel.port1.onmessage=()=>{const wake=resume;resume=null;wake?.();};
  return {yield:()=>new Promise<void>(resolve=>{resume=resolve;try{channel.port2.postMessage(0);}catch{resume=null;setTimeout(resolve,0);}}),
   close:()=>{resume=null;channel.port1.onmessage=null;channel.port1.close();channel.port2.close();}};
 }catch{return {yield:timerYield,close:()=>{}};}
}
export async function runCooperativeSteps<T>(steps:Generator<void,T,void>,schedule?:()=>Promise<void>):Promise<T>{
 const queue=schedule?{yield:schedule,close:()=>{}}:createCooperativeTaskQueue();
 try{
  let next=steps.next();
  while(!next.done){
   const end=now()+4;let operations=0;
   do{next=steps.next();operations++;}while(!next.done&&operations<2048&&now()<end);
   if(!next.done)await queue.yield();
  }
  return next.value;
 }finally{queue.close();}
}
