'use client';

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {flushSync} from 'react-dom';
import StudyApp from '@/app/study-app';
import {subscribeNativeState,registerNativeBack} from '@/lib/native-host';
import {createNativeAuthTransport,nativePhoneClient} from '@/lib/native-auth-transport';
import PhoneFlow from '@/app/account/phone-flow';
import type {PhoneChallenge,PhoneClientTransport,PhoneOutcome,PhonePurpose,PhoneVerification} from '@/lib/phone-auth-client';
import {INITIAL_NATIVE_ACCOUNT_STATE,NativeAccountController,type NativeAccountState} from '@/lib/native-account-controller';
import {validateProductCredentials} from '@/lib/product-identity';

/** The only native owner source is the controller's independent session proof. */
export default function NativeAccountRoot(){
  const [state,setState]=useState<NativeAccountState>(INITIAL_NATIVE_ACCOUNT_STATE);
  const [accountOpen,setAccountOpen]=useState(false),[switching,setSwitching]=useState(false);
  const [mode,setMode]=useState<'login'|'register'>('login'),[username,setUsername]=useState('');
  const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[error,setError]=useState('');
  const controller=useRef<NativeAccountController|null>(null);
  const [phoneTransport,setPhoneTransport]=useState<PhoneClientTransport|null>(null);
  const [phoneChallenge,setPhoneChallenge]=useState<{owner:string|null;challenge:PhoneChallenge}|null>(null);
  const [phoneOutcome,setPhoneOutcome]=useState<PhoneOutcome|null>(null);
  const closeRef=useRef<(fromPop?:boolean)=>void>(()=>{});
  useEffect(()=>{
    const transport=createNativeAuthTransport();const value=new NativeAccountController(transport);controller.current=value;setPhoneTransport(nativePhoneClient(transport));
    const unsubscribe=value.subscribe((next,synchronous)=>{if(synchronous)flushSync(()=>setState(next));else setState(next);});
    let foreground=true,initialized=false;
    const clear=()=>{setPassword('');setConfirmation('');setPhoneChallenge(null);setPhoneOutcome(null);};
    const hide=()=>{clear();value.suspend();};
    const show=()=>{clear();if(foreground&&document.visibilityState!=='hidden')value.recheck();else value.suspend();};
    const unsubscribeNative=subscribeNativeState(active=>{
      foreground=active;if(!initialized)return;
      // The first host onAppState(true) also confirms pageEnd/bridge readiness.
      // A pre-pageEnd probe may have been deliberately dropped by ArkWeb.
      if(!active)hide();else show();
    });
    const visibility=()=>{if(document.visibilityState==='hidden')hide();else show();};
    window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
    window.addEventListener('focus',show);document.addEventListener('visibilitychange',visibility);
    initialized=true;if(foreground&&document.visibilityState!=='hidden')value.start();else value.suspend(false);
    return()=>{unsubscribe();unsubscribeNative();value.dispose();if(controller.current===value)controller.current=null;
      window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);
      window.removeEventListener('focus',show);document.removeEventListener('visibilitychange',visibility);};
  },[]);
  const clearSecrets=()=>{setPassword('');setConfirmation('');};
  function closeAccount(fromPop=false){
    clearSecrets();setUsername('');setError('');setSwitching(false);setMode('login');setPhoneChallenge(null);setPhoneOutcome(null);setAccountOpen(false);
    // Back records the user's close intent even during a pending/unknown identity.
    // The global state gate below remains until independent session evidence is ready.
    if(!fromPop&&window.history.state?.lanternNativeAccount===true)window.history.back();
  }
  closeRef.current=closeAccount;
  useEffect(()=>{
    if(!accountOpen)return;
    const pop=()=>closeRef.current(true);
    window.addEventListener('popstate',pop);
    const unsubscribe=registerNativeBack(()=>{closeRef.current();return true;},100);
    return()=>{unsubscribe();window.removeEventListener('popstate',pop);};
  },[accountOpen]);
  function openAccount(){clearSecrets();setError('');setSwitching(false);setPhoneChallenge(null);setPhoneOutcome(null);
    window.history.pushState({...window.history.state,lanternNativeAccount:true},'');setAccountOpen(true);}
  async function phoneMutation(purpose:PhonePurpose,body:PhoneVerification){
    const value=controller.current;if(!value||state.status!=='ready')return;
    clearSecrets();setError('');setPhoneOutcome(null);
    const outcome=await value.mutatePhone(purpose,body);
    if(controller.current!==value||!outcome)return;
    setPhoneOutcome(outcome);if(outcome.status===200)setPhoneChallenge(null);
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(state.status!=='ready'||state.unavailable||!controller.current)return;
    const validation=validateProductCredentials(username,password,mode==='register'?confirmation:undefined);
    if(!validation.ok){setError(validation.message);return;}
    setError('');clearSecrets();await controller.current.mutate(mode,validation.credentials);setSwitching(false);
  }
  function recheck(){clearSecrets();setError('');controller.current?.recheck();}
  if(state.status!=='ready')return <main className="workspace-account" style={{padding:24}}>
    <section className="panel" aria-live="polite" aria-busy={state.status==='checking'}><h1>核对账号状态</h1>
      <p>{state.message}</p>{state.status==='blocked'&&<button type="button" className="button primary" onClick={recheck}>重新核对账号</button>}
      <p className="small muted">原账号和设备记录仍保留原归属。当前不会猜测身份或打开其他学习分区。</p>
    </section></main>;
  if(!accountOpen)return <StudyApp key={state.user?.id??'device-guest'} owner={state.user?.id??null} nativeMode onAccount={openAccount}/>;
  const available=state.capabilities.passwordLogin&&!state.unavailable;
  return <main className="workspace-account" style={{display:'grid',gap:20,padding:24}}>
    <section className="panel" style={{display:'grid',gap:12}}><h1>账号与本机记录</h1>
      {state.user?<p role="status">已由服务器验证：<b>{state.user.username}</b></p>:
        <p role="status">{state.unavailable?'原生账号能力尚未配置或当前系统不支持；可继续使用原设备访客记录。':'当前未登录，正在使用此设备的访客分区。'}</p>}
      <p>每个账号的学习记录分别保存在本机。切换或退出会保留原记录，访客记录仍属于此设备。</p>
      <p className="small muted">切换前请保存当前草稿和录音，并按需备份。当前不提供原生云同步。</p>
      <div className="button-row"><button type="button" className="button secondary" onClick={()=>closeAccount()}>返回学习</button>
        <button type="button" className="text-button" onClick={recheck}>重新核对账号</button>
        {state.user&&<><button type="button" className="button secondary" onClick={()=>{clearSecrets();setError('');setPhoneChallenge(null);setPhoneOutcome(null);setSwitching(true);}}>切换账号</button>
          <button type="button" className="button secondary" onClick={()=>{clearSecrets();setError('');setPhoneChallenge(null);setPhoneOutcome(null);void controller.current?.mutate('logout');}}>退出当前账号</button></>}
      </div>{state.message&&<p role="status">{state.message}</p>}
    </section>
    {available&&(!state.user||switching)&&<section className="panel" aria-labelledby="native-account-form-title">
      <h2 id="native-account-form-title">{mode==='login'?'登录账号':'注册新账号'}</h2>
      <form onSubmit={event=>void submit(event)}>
        <label className="field" htmlFor="native-account-username">用户名<input id="native-account-username" name="username" value={username}
          onChange={event=>setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required/></label>
        <p className="small muted">3–32 个英文字母、数字或下划线，大小写不区分，首尾空白会去除。</p>
        <label className="field" htmlFor="native-account-password">密码<input id="native-account-password" name="password" type="password" value={password}
          onChange={event=>setPassword(event.target.value)} autoComplete={mode==='register'?'new-password':'current-password'} required/></label>
        <p className="small muted">15–128 个字符，首尾空白属于密码。支持粘贴和密码管理器。</p>
        {mode==='register'&&<label className="field" htmlFor="native-account-confirmation">再次输入密码<input id="native-account-confirmation" name="password-confirmation"
          type="password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="new-password" required/></label>}
        {error&&<p role="alert" className="bad">{error}</p>}
        <div className="button-row"><button className="button primary" type="submit">{mode==='login'?'登录':'注册并登录'}</button>
          <button className="button secondary" type="button" onClick={()=>{clearSecrets();setError('');setMode(mode==='login'?'register':'login');}}>{mode==='login'?'注册新账号':'已有账号，去登录'}</button>
          {switching&&<button className="button secondary" type="button" onClick={()=>{clearSecrets();setSwitching(false);setError('');}}>取消切换</button>}
        </div>
      </form>
    </section>}
    {phoneTransport&&<PhoneFlow key={(state.user?.id??'guest')+(switching?':login':':'+(state.user?'bind':'login'))}
      purpose={state.user&&!switching?'bind':'login'} transport={phoneTransport} onMutation={phoneMutation}
      challenge={phoneChallenge?.owner===(state.user?.id??null)?phoneChallenge.challenge:null} outcome={phoneOutcome}
      onChallenge={challenge=>{setPhoneOutcome(null);setPhoneChallenge(challenge?{owner:state.user?.id??null,challenge}:null);}}/>}
    <section className="panel"><h2>恢复渠道</h2><p>当前没有已验证的密码恢复渠道，请妥善保管密码。生产短信提供方尚未配置，能力探测不会被当作已发送短信。</p></section>
  </main>;
}
