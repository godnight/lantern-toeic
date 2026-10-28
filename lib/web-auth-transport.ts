import type {NativeAuthTransport,NativeAuthReply} from './native-auth-transport';
import {monotonicNow,readSessionProof} from './session-proof';

const HOLD='lantern-auth-result-hold-v1',NOTICE='lantern-product-session-notice-v1';
let held=false;
const SOURCE=typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'?crypto.randomUUID():String(Math.random());
export function authResultHeld(){try{return held||sessionStorage.getItem(HOLD)==='1';}catch{return held;}}
export function setAuthResultHold(value:boolean,broadcast=true,notify=value){
  held=value;try{if(value)sessionStorage.setItem(HOLD,'1');else sessionStorage.removeItem(HOLD);}catch{/* Memory remains conservative. */}
  if(typeof window==='undefined')return;
  if(notify)window.dispatchEvent(new CustomEvent('lantern-auth-hold',{detail:value}));
  if(!broadcast)return;
  const notice={type:'session-changed',version:1,hold:value,source:SOURCE,nonce:Math.random()};
  try{const c=new BroadcastChannel('lantern-product-session-v1');c.postMessage(notice);c.close();}catch{}
  try{localStorage.setItem(NOTICE,JSON.stringify(notice));localStorage.removeItem(NOTICE);}catch{}
}
export function watchAuthHold(listener:(hold:boolean,local:boolean)=>void){
  const local=(event:Event)=>listener((event as CustomEvent<boolean>).detail,true);
  const receive=(data:unknown)=>{if(data&&typeof data==='object'&&(data as {type?:unknown}).type==='session-changed'&&(data as {version?:unknown}).version===1&&(data as {source?:unknown}).source!==SOURCE){const value=(data as {hold?:unknown}).hold===true;setAuthResultHold(value,false,false);listener(value,false);}};
  const storage=(event:StorageEvent)=>{if(event.key===NOTICE&&event.newValue)try{receive(JSON.parse(event.newValue));}catch{}};
  let channel:BroadcastChannel|undefined;try{channel=new BroadcastChannel('lantern-product-session-v1');channel.onmessage=event=>receive(event.data);}catch{}
  window.addEventListener('lantern-auth-hold',local);window.addEventListener('storage',storage);
  return()=>{channel?.close();window.removeEventListener('lantern-auth-hold',local);window.removeEventListener('storage',storage);};
}
export function createWebAuthTransport():NativeAuthTransport {
  const active=new Map<AbortController,()=>void>();let disposed=false,mutation=false,retryAt=0;
  return {async request(action,body,signal,version){
    if(disposed)throw Error('Authentication transport disposed');
    if(!['session','register','login','logout'].includes(action)||version!==undefined&&(version!==2||action!=='session'||body!==undefined))throw Error('Unsupported account action');
    if(signal?.aborted)throw Error('Account request cancelled');
    if(action!=='session'&&mutation)throw Error('Account mutation pending');
    const now=monotonicNow();
    if(action!=='session'&&Number.isFinite(now)&&now<retryAt)return {status:429,body:{code:'too-many-attempts',error:'请稍后重试。'}};
    const controller=new AbortController();
    let rejectDeadline!:(error:Error)=>void;
    const deadline=new Promise<never>((_,reject)=>{rejectDeadline=reject;});
    const abort=()=>{controller.abort();rejectDeadline(Error('Account request cancelled'));};active.set(controller,abort);signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{controller.abort();rejectDeadline(Error('Account result unconfirmed'));},15000);
    if(action!=='session'){mutation=true;setAuthResultHold(true);}
    try{return await Promise.race([(async()=>{
      const response=await fetch('/api/auth/'+action,{method:action==='session'?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...action==='session'&&version===2?{'X-Lantern-Session-Proof':'2'}:{},...action!=='session'?{'Content-Type':'application/json'}:{}},...action!=='session'?{body:JSON.stringify(body??{})}:{},signal:controller.signal});
      const value:unknown=await response.json();if(controller.signal.aborted||disposed)throw Error('Account result unconfirmed');
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Account response invalid');
      const result:NativeAuthReply={status:response.status,body:value as Record<string,unknown>};
      if(action==='session'&&version===2){result.version=2;if(response.status===200){const proof=readSessionProof(value,'http',monotonicNow()-now);if(!proof)throw Error('Session proof invalid');result.body={user:proof.user,capabilities:proof.capabilities,session:{validForMs:proof.validForMs}};}}
      if(response.status===429){const raw=response.headers.get('retry-after');if(raw&&/^\d+$/.test(raw)){const seconds=Number(raw);if(Number.isSafeInteger(seconds)&&seconds>0&&seconds<=86400)retryAt=monotonicNow()+seconds*1000;}}
      return result;
    })(),deadline]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);active.delete(controller);if(action!=='session')mutation=false;}
  },cancelAll(){for(const cancel of active.values())cancel();active.clear();},dispose(){disposed=true;for(const cancel of active.values())cancel();active.clear();}};
}
