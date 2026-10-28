'use client';
import {useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {NativeAccountController,INITIAL_NATIVE_ACCOUNT_STATE,type NativeAccountState} from '@/lib/native-account-controller';
import {createWebAuthTransport,authResultHeld,setAuthResultHold,watchAuthHold} from '@/lib/web-auth-transport';
import {AccountPanel} from './account-panel';

export default function AccountForm({initialMode='register'}:{initialMode?:'register'|'login'}={}){
 const [state,setState]=useState<NativeAccountState>(INITIAL_NATIVE_ACCOUNT_STATE),controller=useRef<NativeAccountController|null>(null),mutating=useRef(false),explicit=useRef(false);
 useEffect(()=>{
  const value=new NativeAccountController(createWebAuthTransport());controller.current=value;
  const off=value.subscribe((next,sync)=>{if(sync)flushSync(()=>setState(next));else setState(next);if(next.status==='ready'&&(authResultHeld()||explicit.current)){explicit.current=false;setAuthResultHold(false);}});
  const notice=watchAuthHold((hold,local)=>{if(local&&mutating.current)return;if(hold)value.hold();else value.resume();});
  const hide=()=>value.suspend();const show=()=>{if(authResultHeld())value.hold();else value.resume();};const visibility=()=>document.visibilityState==='hidden'?hide():show();
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);window.addEventListener('focus',show);document.addEventListener('visibilitychange',visibility);
  if(authResultHeld())value.hold();else value.start();
  return()=>{off();notice();value.dispose();controller.current=null;window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);window.removeEventListener('focus',show);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 const panelState:NativeAccountState=state.status==='ready'&&state.user&&!state.access.canAccess()?{status:'blocked',message:'会话有效期已结束，原分区已锁定。请联网重新核对账号。'}:state;
 return <AccountPanel state={panelState} initialMode={initialMode} onSubmit={async(mode,credentials)=>{mutating.current=true;try{await controller.current?.mutate(mode,credentials);}finally{mutating.current=false;}}} onLogout={()=>{mutating.current=true;void controller.current?.mutate('logout').finally(()=>{mutating.current=false;});}} onRecheck={()=>{explicit.current=true;setAuthResultHold(false,false,false);controller.current?.recheck();}} onEnter={()=>{if(state.status==='ready'&&state.access.assertAccess())window.location.assign('/');}} onBack={()=>window.location.assign('/')}/>;
}
