'use client';
import {useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {NativeAccountController,INITIAL_NATIVE_ACCOUNT_STATE,type NativeAccountState} from './native-account-controller';
import {createWebAuthTransport,authResultHeld,setAuthResultHold,watchAuthHold} from './web-auth-transport';
import type {AccountAccess} from './session-proof';

export function broadcastProductSessionChange(){setAuthResultHold(false);}
export function useProductSession(owner:string|null,nativeMode:boolean,enabled=true){
 const [state,setState]=useState<NativeAccountState>(INITIAL_NATIVE_ACCOUNT_STATE),controller=useRef<NativeAccountController|null>(null),explicit=useRef(false);
 useEffect(()=>{
  if(nativeMode||!enabled)return;
  const value=new NativeAccountController(createWebAuthTransport());controller.current=value;
  const off=value.subscribe((next,sync)=>{if(next.status==='ready'&&(authResultHeld()||explicit.current)){explicit.current=false;setAuthResultHold(false);}if(next.status==='ready'&&next.user?.id!==(owner??undefined)){window.location.assign('/');return;}if(sync)flushSync(()=>setState(next));else setState(next);});
  const recheck=()=>{if(authResultHeld())value.hold('账号操作结果未确认，请显式重新核对账号。');else value.resume();};
  const hide=()=>value.suspend();const visibility=()=>document.visibilityState==='hidden'?hide():recheck();
  const notice=watchAuthHold(hold=>{if(hold)value.hold('账号操作结果未确认，旧学习分区已暂停。');else value.resume();});
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',recheck);window.addEventListener('focus',recheck);document.addEventListener('visibilitychange',visibility);
  if(authResultHeld())value.hold('账号操作结果未确认，请显式重新核对账号。');else value.start();
  return()=>{off();notice();value.dispose();controller.current=null;window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',recheck);window.removeEventListener('focus',recheck);document.removeEventListener('visibilitychange',visibility);};
 },[owner,nativeMode,enabled]);
 const access:AccountAccess|null=state.status==='ready'?state.access:null;
 return {status:nativeMode||!enabled?'ready' as const:state.status==='ready'?'ready' as const:state.status==='checking'?'checking' as const:'error' as const,access,message:state.message,recheck:()=>{explicit.current=true;setAuthResultHold(false,false,false);controller.current?.recheck();}};
}
