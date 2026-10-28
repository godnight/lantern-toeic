'use client';
import {useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import StudyApp from '@/app/study-app';
import {AccountPanel} from '@/app/account/account-panel';
import {GuestDataRecovery} from '@/app/learn/guest-data-recovery';
import {subscribeNativeState,registerNativeBack} from '@/lib/native-host';
import {createNativeAuthTransport} from '@/lib/native-auth-transport';
import {INITIAL_NATIVE_ACCOUNT_STATE,NativeAccountController,type NativeAccountState} from '@/lib/native-account-controller';
import {applyDocumentTheme} from '@/lib/ui-theme';

export default function NativeAccountRoot(){
 const [state,setState]=useState<NativeAccountState>(INITIAL_NATIVE_ACCOUNT_STATE),[accountOpen,setAccountOpen]=useState(false),[legacy,setLegacy]=useState(false);
 const controller=useRef<NativeAccountController|null>(null);
 useEffect(()=>{
  const value=new NativeAccountController(createNativeAuthTransport());controller.current=value;
  const off=value.subscribe((next,sync)=>{if(sync)flushSync(()=>setState(next));else setState(next);});
  let foreground=true,initialized=false;
  const hide=()=>value.suspend(),show=()=>{if(foreground&&document.visibilityState!=='hidden')value.resume();else value.suspend();};
  const native=subscribeNativeState(active=>{foreground=active;if(initialized){if(active)show();else hide();}});
  const visibility=()=>document.visibilityState==='hidden'?hide():show();
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);window.addEventListener('focus',show);document.addEventListener('visibilitychange',visibility);
  initialized=true;if(foreground&&document.visibilityState!=='hidden')value.start();else value.suspend(false);
  if(!document.documentElement.dataset.uiTheme)applyDocumentTheme('paper');
  return()=>{off();native();value.dispose();controller.current=null;window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);window.removeEventListener('focus',show);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 useEffect(()=>registerNativeBack(()=>{if(legacy){setLegacy(false);return true;}if(accountOpen){setAccountOpen(false);return true;}return false;},100),[accountOpen,legacy]);
 if(legacy)return <GuestDataRecovery nativeMode onBack={()=>setLegacy(false)}/>;
 if(state.status==='ready'&&state.user&&!accountOpen&&state.access.canAccess())return <StudyApp key={state.user.id+':'+state.access.epoch} owner={state.user.id} nativeMode access={state.access} onAccount={()=>setAccountOpen(true)}/>;
 const panelState:NativeAccountState=state.status==='ready'&&state.user&&!state.access.canAccess()?{status:'blocked',message:'会话有效期已结束，原分区已锁定。请联网重新核对账号。'}:state;
 return <AccountPanel state={panelState} onSubmit={async(mode,credentials)=>{await controller.current?.mutate(mode,credentials);setAccountOpen(true);}} onLogout={()=>{void controller.current?.mutate('logout');}} onRecheck={()=>controller.current?.recheck()} onEnter={()=>{if(state.status==='ready'&&state.access.assertAccess())setAccountOpen(false);}} onBack={()=>setAccountOpen(false)} onLegacy={()=>setLegacy(true)}/>;
}
