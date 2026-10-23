'use client';

import {useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';

const CHANNEL='lantern-product-session-v1';
const STORAGE_KEY='lantern-product-session-notice-v1';
const NOTICE={type:'session-changed',version:1} as const;
type Status='ready'|'checking'|'error'|'redirecting';

function nativeContext(){return !!window.__LANTERN_HARMONY__||window.location.origin==='https://lantern.local';}
function isNotice(value:unknown){return !!value&&typeof value==='object'&&(value as typeof NOTICE).type===NOTICE.type&&(value as typeof NOTICE).version===NOTICE.version;}

/** Invalidation only: never send a user ID, username, password or session token. */
export function broadcastProductSessionChange(){
  if(nativeContext())return;
  try{
    if(typeof window.BroadcastChannel==='function'){
      const channel=new window.BroadcastChannel(CHANNEL);
      channel.postMessage(NOTICE);channel.close();
    }
  }catch{/* Storage notification and foreground probes remain available. */}
  try{
    // A non-sensitive nonce ensures repeated notices also trigger storage events.
    // Remove immediately; this key never stores account or learning information.
    window.localStorage.setItem(STORAGE_KEY,JSON.stringify({...NOTICE,nonce:`${Date.now()}:${Math.random()}`}));
    window.localStorage.removeItem(STORAGE_KEY);
  }catch{/* Restricted storage cannot make successful server auth appear to fail. */}
}

/** Suspend the old workspace before any asynchronous session probe. */
export function useProductSession(owner:string|null,nativeMode:boolean){
  const [state,setState]=useState<{owner:string|null;status:Status}>(()=>({owner,status:nativeMode||owner===null?'ready':'checking'}));
  const probeRef=useRef<()=>void>(()=>{});
  const previousOwner=useRef(owner);

  useEffect(()=>{
    if(nativeMode||nativeContext()){
      setState({owner,status:'ready'});probeRef.current=()=>{};return;
    }
    let alive=true,generation=0,navigating=false,suspended=owner!==null;
    let controller:AbortController|null=null;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const visible=()=>document.visibilityState!=='hidden';
    function cancel(){generation++;controller?.abort();controller=null;if(timer!==undefined){clearTimeout(timer);timer=undefined;}}
    function update(status:Status,synchronous=false){
      if(!alive)return;
      suspended=status!=='ready';
      if(synchronous)flushSync(()=>setState({owner,status}));else setState({owner,status});
    }
    function suspend(){cancel();update('checking',true);}
    function redirect(){
      navigating=true;update('redirecting');
      // Only the server-rendered page may select the new owner partition.
      window.location.assign('/');
    }
    async function check(synchronous=true){
      if(!alive||navigating)return;
      if(synchronous)suspend();else{cancel();update('checking');}
      if(!visible())return;
      const current=++generation;
      const request=new AbortController();controller=request;
      timer=setTimeout(()=>{
        if(!alive||current!==generation)return;
        cancel();update('error');
      },15000);
      try{
        const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:request.signal});
        if(!alive||current!==generation)return;
        if(response.status===401){
          if(owner!==null)redirect();else update('ready');
          return;
        }
        if(response.status===503&&owner===null){
          const disabled:unknown=await response.json();
          if(!alive||current!==generation)return;
          // Only an explicit server capability decision can keep the existing
          // guest partition usable. A database/network failure is unknown.
          if(disabled&&typeof disabled==='object'&&(disabled as {code?:unknown}).code==='auth-disabled'&&(disabled as {capabilities?:{passwordLogin?:unknown}}).capabilities?.passwordLogin===false){update('ready');return;}
        }
        if(response.status!==200)throw new Error('Session unconfirmed');
        const body:unknown=await response.json();
        if(!alive||current!==generation)return;
        const id=body&&typeof body==='object'?(body as {user?:{id?:unknown}}).user?.id:undefined;
        if(typeof id!=='string'||!/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('Session unconfirmed');
        if(id!==owner)redirect();else update('ready');
      }catch{
        if(alive&&current===generation)update('error');
      }finally{
        if(current===generation){controller=null;if(timer!==undefined){clearTimeout(timer);timer=undefined;}}
      }
    }
    const recheck=()=>{void check();};
    const hide=()=>suspend();
    const pageShow=(event:PageTransitionEvent)=>{
      // A BFCache document can resume after its previous navigation completed.
      // Drop only that stale navigation lock; fresh session evidence is still required.
      if(event.persisted)navigating=false;
      if(event.persisted||suspended)recheck();
    };
    const visibility=()=>{if(visible())recheck();else hide();};
    const storage=(event:StorageEvent)=>{
      if(event.key!==STORAGE_KEY||event.newValue===null)return;
      try{if(isNotice(JSON.parse(event.newValue)))recheck();}catch{/* Unrelated malformed storage is not identity evidence. */}
    };
    let channel:BroadcastChannel|null=null;
    try{if(typeof window.BroadcastChannel==='function'){channel=new window.BroadcastChannel(CHANNEL);channel.onmessage=event=>{if(isNotice(event.data))recheck();};}}catch{/* Storage and page lifecycle probes remain active. */}
    window.addEventListener('pagehide',hide);
    window.addEventListener('pageshow',pageShow);
    window.addEventListener('focus',recheck);
    window.addEventListener('storage',storage);
    document.addEventListener('visibilitychange',visibility);
    probeRef.current=recheck;
    // SSR guest remains usable when auth is disabled. Existing product owners
    // must be revalidated before their first workspace mount (stale HTML).
    if(owner!==null||previousOwner.current!==owner)void check(false);
    previousOwner.current=owner;
    return ()=>{
      alive=false;cancel();probeRef.current=()=>{};channel?.close();
      window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',pageShow);
      window.removeEventListener('focus',recheck);window.removeEventListener('storage',storage);
      document.removeEventListener('visibilitychange',visibility);
    };
  },[owner,nativeMode]);

  return {status:nativeMode?'ready' as const:state.owner===owner?state.status:'checking' as const,recheck:()=>probeRef.current()};
}
