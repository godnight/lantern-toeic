'use client';
import {useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import StudyApp from '@/app/study-app';
import {AccountPanel} from '@/app/account/account-panel';
import {GuestDataRecovery} from '@/app/learn/guest-data-recovery';
import {subscribeNativeState,registerNativeBack} from '@/lib/native-host';
import {createNativeAuthTransport,nativePhoneClient} from '@/lib/native-auth-transport';
import type {PhoneClientTransport,PhoneVerification} from '@/lib/phone-auth-client';
import {INITIAL_NATIVE_ACCOUNT_STATE,NativeAccountController,type NativeAccountState} from '@/lib/native-account-controller';
import {applyDocumentTheme} from '@/lib/ui-theme';

export default function NativeAccountRoot(){
 const [state,setState]=useState<NativeAccountState>(INITIAL_NATIVE_ACCOUNT_STATE),[accountOpen,setAccountOpen]=useState(false),[legacy,setLegacy]=useState(false),[returnOwner,setReturnOwner]=useState<string|null>(null),[providers,setProviders]=useState({huaweiLogin:false,huaweiBinding:false});
 const [phoneTransport,setPhoneTransport]=useState<PhoneClientTransport|null>(null);
 const controller=useRef<NativeAccountController|null>(null);
 useEffect(()=>{
  const transport=createNativeAuthTransport();const value=new NativeAccountController(transport);controller.current=value;setPhoneTransport(nativePhoneClient(transport));
  const off=value.subscribe((next,sync)=>{if(sync)flushSync(()=>setState(next));else setState(next);});
  let foreground=true,initialized=false,alive=true;
  const hide=()=>value.suspend(true,true),leave=()=>value.suspend(true,false),show=()=>{if(foreground&&document.visibilityState!=='hidden'){if(value.getSnapshot().status!=='ready')value.resume();}else hide();};
  const native=subscribeNativeState(active=>{foreground=active;if(initialized){if(active)show();else hide();}});
  const visibility=()=>document.visibilityState==='hidden'?hide():show();
  window.addEventListener('pagehide',leave);window.addEventListener('pageshow',show);window.addEventListener('focus',show);document.addEventListener('visibilitychange',visibility);
  initialized=true;if(foreground&&document.visibilityState!=='hidden')value.start();else value.suspend(false);
  void value.getProviders().then(next=>{if(alive)setProviders(next);},()=>{if(alive)setProviders({huaweiLogin:false,huaweiBinding:false});});
  if(!document.documentElement.dataset.uiTheme)applyDocumentTheme('paper');
  return()=>{alive=false;off();native();value.dispose();controller.current=null;window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',show);window.removeEventListener('focus',show);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 const canReturn=accountOpen&&state.status==='ready'&&!!state.user&&state.user.id===returnOwner&&state.access.owner===returnOwner&&state.access.canAccess();
 const enter=()=>{if(state.status!=='ready'||!state.user||controller.current?.getSnapshot()!==state||state.access.owner!==state.user.id||!state.access.assertAccess())return false;setAccountOpen(false);return true;};
 const submit=async(mode:'register'|'login',credentials:{username:string;password:string})=>{
  const active=controller.current;if(!active)return;
  setAccountOpen(true);
  if(!await active.mutate(mode,credentials)||controller.current!==active)return;
  const confirmed=active.getSnapshot();
  if(confirmed.status==='ready'&&confirmed.user&&confirmed.access.owner===confirmed.user.id&&confirmed.access.assertAccess())setAccountOpen(false);
 };
 const huawei=async(purpose:'login'|'bind')=>{
  const active=controller.current;if(!active)return;
  setAccountOpen(true);
  if(!await active.mutateHuawei(purpose)||controller.current!==active||purpose==='bind')return;
  const confirmed=active.getSnapshot();
  if(confirmed.status==='ready'&&confirmed.user&&confirmed.access.owner===confirmed.user.id&&confirmed.access.assertAccess())setAccountOpen(false);
 };
 const phoneLogin=async(body:PhoneVerification)=>{
  const active=controller.current;if(!active)return;
  setAccountOpen(true);
  const outcome=await active.mutatePhone('login',body);
  if(controller.current!==active||!outcome||outcome.status!==200)return outcome;
  const confirmed=active.getSnapshot();
  if(confirmed.status==='ready'&&confirmed.user&&confirmed.access.owner===confirmed.user.id&&confirmed.access.assertAccess())setAccountOpen(false);
  return outcome;
 };
 useEffect(()=>registerNativeBack(()=>{if(legacy){setLegacy(false);return true;}return canReturn?enter():false;},100),[canReturn,state,legacy]);
 if(legacy)return <GuestDataRecovery nativeMode onBack={()=>setLegacy(false)}/>;
 if(state.status==='ready'&&state.user&&!accountOpen&&state.access.canAccess())return <StudyApp key={state.user.id+':'+state.access.epoch} owner={state.user.id} nativeMode access={state.access} onAccount={()=>{setReturnOwner(state.user!.id);setAccountOpen(true);}}/>;
 const panelState:NativeAccountState=state.status==='ready'&&state.user&&!state.access.canAccess()?{status:'blocked',message:'会话有效期已结束，原分区已锁定。请联网重新核对账号。'}:state;
 return <AccountPanel state={panelState} onSubmit={submit} onLogout={()=>{void controller.current?.mutate('logout');}} onRecheck={()=>controller.current?.recheck()} onEnter={enter} onBack={canReturn?enter:undefined} onLegacy={()=>setLegacy(true)} huawei={{login:providers.huaweiLogin,binding:providers.huaweiBinding,onLogin:()=>{void huawei('login');},onBind:()=>{void huawei('bind');}}} phone={phoneTransport?{transport:phoneTransport,onLogin:phoneLogin}:undefined}/>;
}
