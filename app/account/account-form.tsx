'use client';
import {PublicInfoLinks} from '../learn/legal-pages';

import {useEffect,useMemo,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {broadcastProductSessionChange,useProductSession} from '@/lib/use-product-session';
import PhoneFlow from './phone-flow';
import {createWebPhoneTransport,parsePhonePublicReply,parsePhoneOutcome,phoneOutcomeMessage,type PhoneChallenge,type PhoneOutcome,type PhonePurpose,type PhoneVerification} from '@/lib/phone-auth-client';

type User = {id:string;username:string};
type Session = {status:'loading'|'guest'|'unavailable'|'error'|'native'} | {status:'authenticated';user:User};
type Mode = 'login'|'register';
type AuthOperation = {generation:number;controller:AbortController;timer:ReturnType<typeof setTimeout>|null;deadline:Promise<never>;reject:(reason:Error)=>void;active:boolean;invalidated:boolean;timedOut:boolean};

// Response validation is presentation only. Authentication and data ownership
// are decided by the server's opaque HttpOnly session, never this object.
function responseUser(value:unknown):User|null {
  if(!value||typeof value!=='object')return null;
  const user=(value as {user?:unknown}).user;
  if(!user||typeof user!=='object')return null;
  const {id,username}=user as {id?:unknown;username?:unknown};
  return typeof id==='string'&&/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)&&typeof username==='string'&&/^[a-z0-9_]{3,32}$/.test(username)?{id,username}:null;
}

export default function AccountForm({initialMode='login'}:{initialMode?:Mode}={}) {
  const [session,setSession]=useState<Session>({status:'loading'});
  const [mode,setMode]=useState<Mode>(initialMode);
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [passwordVisible,setPasswordVisible]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [review,setReview]=useState<'switch'|'logout'|null>(null);
  const [switching,setSwitching]=useState(false);
  const [check,setCheck]=useState(0);
  const [resultBarrier,setResultBarrier]=useState(false);
  const phoneTransport=useMemo(()=>createWebPhoneTransport(),[]);
  const [phoneChallenge,setPhoneChallenge]=useState<{owner:string|null;challenge:PhoneChallenge}|null>(null);
  const [phoneOutcome,setPhoneOutcome]=useState<PhoneOutcome|null>(null);
  const barrierChecked=useRef(false);
  const requestPending=useRef(false);
  const alive=useRef(true);
  const operationGeneration=useRef(0);
  const operation=useRef<AuthOperation|null>(null);
  const sessionGuard=useProductSession(session.status==='authenticated'?session.user.id:null,session.status==='native');

  useEffect(()=>{
    const clear=()=>{setPassword('');setConfirmation('');setPasswordVisible(false);};
    const visibility=()=>{if(document.visibilityState==='hidden')clear();};
    window.addEventListener('pagehide',clear);document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('pagehide',clear);document.removeEventListener('visibilitychange',visibility);};
  },[]);

  function belongsToPage(op:AuthOperation){return alive.current&&operation.current===op&&operationGeneration.current===op.generation;}
  function isActive(op:AuthOperation){return belongsToPage(op)&&op.active;}
  function cancelOperation(){
    const op=operation.current;
    if(!op)return;
    operation.current=null;operationGeneration.current++;op.active=false;
    if(op.timer!==null)clearTimeout(op.timer);
    op.controller.abort();op.reject(new Error('Authentication result superseded'));
    requestPending.current=false;
  }
  useEffect(()=>{
    alive.current=true;
    return ()=>{alive.current=false;cancelOperation();};
  },[]);
  useEffect(()=>{
    if(sessionGuard.status==='redirecting'){cancelOperation();return;}
    if(!resultBarrier)return;
    if(sessionGuard.status==='checking')barrierChecked.current=true;
    else if(sessionGuard.status==='ready'&&barrierChecked.current){
      // Only a completed independent server-session probe may lift this gate.
      barrierChecked.current=false;setResultBarrier(false);
    }
  },[sessionGuard.status,resultBarrier]);

  useEffect(()=>{
    if(window.__LANTERN_HARMONY__||window.location.origin==='https://lantern.local'){
      setSession({status:'native'});return;
    }
    const controller=new AbortController();
    setSession({status:'loading'});setError('');
    void (async()=>{
      try{
        const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
        if(controller.signal.aborted)return;
        if(response.status===401){setSession({status:'guest'});return;}
        if(response.status===503){setSession({status:'unavailable'});return;}
        if(!response.ok)throw new Error('Session unavailable');
        const body:unknown=await response.json();
        if(controller.signal.aborted)return;
        const user=responseUser(body);
        const capabilities=body&&typeof body==='object'?(body as {capabilities?:{passwordLogin?:unknown}}).capabilities:undefined;
        if(!user||capabilities?.passwordLogin!==true)throw new Error('Session unavailable');
        setSession({status:'authenticated',user});
      }catch{
        if(!controller.signal.aborted)setSession({status:'error'});
      }
    })();
    return ()=>controller.abort();
  },[check]);

  function changeMode(next:Mode){
    setMode(next);setPassword('');setConfirmation('');setPasswordVisible(false);setError('');
  }

  function invalidateIdentity(op:AuthOperation){
    if(!belongsToPage(op)||op.invalidated)return;
    op.invalidated=true;barrierChecked.current=false;setResultBarrier(true);
    broadcastProductSessionChange();
    sessionGuard.recheck();
  }

  async function mutate(kind:Mode|'logout'|'phone/bind'|'phone/login',credentials:{username:string;password:string}|PhoneVerification|Record<string,never>){
    const controller=new AbortController();
    let rejectDeadline!:(reason:Error)=>void;
    const deadline=new Promise<never>((_,reject)=>{rejectDeadline=reject;});
    const op:AuthOperation={generation:++operationGeneration.current,controller,timer:null,deadline,reject:rejectDeadline,active:true,invalidated:false,timedOut:false};
    operation.current=op;requestPending.current=true;setBusy(true);setError('');
    op.timer=setTimeout(()=>{
      if(!belongsToPage(op))return;
      op.active=false;op.timedOut=true;controller.abort();rejectDeadline(new Error('Authentication result timed out'));
    },15000);
    try{
      // The deadline races the complete operation, including a body reader that
      // never settles after abort. Every late continuation checks its generation.
      await Promise.race([(async()=>{
        const response=await fetch(`/api/auth/${kind}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(credentials),signal:controller.signal});
        if(!isActive(op))return;
        if(response.status!==200){
          if(kind==='phone/bind'||kind==='phone/login'){
            const body:unknown=await response.json();if(!isActive(op))return;
            const reply=parsePhonePublicReply(kind==='phone/bind'?'bind':'login',{status:response.status,body:body as Record<string,unknown>});
            const outcome=parsePhoneOutcome(reply);setPhoneOutcome(outcome);setError(phoneOutcomeMessage(outcome));
            if(outcome.code==='auth-state-unknown'||outcome.status>=500&&!['auth-disabled','phone-auth-disabled','phone-provider-unavailable','phone-unavailable','native-auth-unavailable'].includes(outcome.code))throw new Error('Phone mutation result unknown');
            return;
          }
          setError(kind==='logout'?'退出未获服务器确认，仍保留当前账号视图。请检查网络并重新核对登录状态。':response.status===429?'尝试过于频繁，请稍后再试。':response.status===503?'账号服务暂不可用，当前身份没有切换。':response.status===403?'请求未通过安全校验，请重新核对登录状态后再试。':kind==='login'?'登录失败，请检查用户名和密码，或稍后再试。':'未能注册，请检查用户名和密码要求，或稍后再试。');return;
        }
        // Set-Cookie may already have changed the browser identity. Invalidate
        // at response headers, before awaiting any mutation response body.
        invalidateIdentity(op);
        if(!isActive(op))return;
        const body:unknown=await response.json();
        if(!isActive(op))return;
        // The body is diagnostic only. It never selects an owner, lifts the
        // barrier, or navigates; the independent session guard does that.
        if(kind==='phone/bind'||kind==='phone/login'){
          const reply=parsePhonePublicReply(kind==='phone/bind'?'bind':'login',{status:response.status,body:body as Record<string,unknown>});
          setPhoneOutcome(parsePhoneOutcome(reply));setPhoneChallenge(null);
        }else if(kind==='logout'){
          if(!body||typeof body!=='object'||(body as {ok?:unknown}).ok!==true)throw new Error('Invalid response');
        }else if(!responseUser(body))throw new Error('Invalid response');
      })(),deadline]);
    }catch{
      if(!belongsToPage(op))return;
      setError(kind==='logout'?'退出结果未能确认。账号操作已暂停并重新核对服务器会话；此页不会假定已退出。':'请求结果未能确认。账号操作已暂停并重新核对服务器会话；此页不会假定已成功。');
      // Abort is not evidence of rollback. A timeout requires fresh independent
      // evidence even when an earlier header-triggered probe had confirmed A.
      if(op.timedOut&&op.invalidated){
        barrierChecked.current=false;setResultBarrier(true);sessionGuard.recheck();
      }else invalidateIdentity(op);
    }finally{
      if(belongsToPage(op)){
        if(op.timer!==null)clearTimeout(op.timer);
        op.active=false;operation.current=null;operationGeneration.current++;controller.abort();
        setPassword('');setConfirmation('');setPasswordVisible(false);requestPending.current=false;setBusy(false);
      }
    }
  }

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!alive.current||requestPending.current||busy||resultBarrier||sessionGuard.status!=='ready'||(session.status!=='guest'&&!(session.status==='authenticated'&&switching)))return;
    setError('');
    if(/[^\x00-\x7f]/.test(username)||!/^[a-zA-Z0-9_]{3,32}$/.test(username.trim())){
      setError('用户名须为 3–32 个英文字母、数字或下划线，首尾空白会去除，大小写不区分。');return;
    }
    const count=[...password].length;
    if(count<15||count>128){setError('密码须为 15–128 个字符，首尾空白属于密码。');return;}
    if(mode==='register'&&password!==confirmation){setError('两次输入的密码不一致。');return;}
    await mutate(mode,{username,password});
  }

  async function phoneMutation(purpose:PhonePurpose,body:PhoneVerification){
    if(!alive.current||requestPending.current||busy||resultBarrier||sessionGuard.status!=='ready'||
      purpose==='bind'&&(session.status!=='authenticated'||switching)||
      purpose==='login'&&session.status!=='guest'&&!(session.status==='authenticated'&&switching))return;
    setPhoneOutcome(null);setPassword('');setConfirmation('');
    // Reuse the established header-first invalidation lifetime. Broadcasting
    // before fetch would unmount this nested form and abort its own request.
    await mutate(purpose==='bind'?'phone/bind':'phone/login',body);
  }

  async function logout(){
    if(!alive.current||requestPending.current||busy||resultBarrier||sessionGuard.status!=='ready'||session.status!=='authenticated')return;
    await mutate('logout',{});
  }

  const available=session.status==='guest'||session.status==='authenticated';
  if(resultBarrier||sessionGuard.status!=='ready')return <section className="panel" aria-live="polite" aria-busy={resultBarrier&&sessionGuard.status==='ready'||sessionGuard.status==='checking'}><h2>核对账号状态</h2><p>{sessionGuard.status==='checking'||resultBarrier&&sessionGuard.status==='ready'?'正在重新核对服务器会话，账号操作已暂停。':sessionGuard.status==='redirecting'?'会话已变化，正在重新打开学习页。':'当前会话无法确认，账号操作保持暂停，请重试。'}</p>{error&&<p role="alert" className="bad">{error}</p>}<div className="button-row">{(sessionGuard.status==='error'||resultBarrier&&sessionGuard.status==='ready')&&<button className="button primary" onClick={sessionGuard.recheck}>重新核对账号</button>}<a className="button secondary" href="/">返回学习</a></div><PublicInfoLinks compact/></section>;
  return <div className="workspace-account" aria-busy={busy||session.status==='loading'} style={{display:'grid',gap:20}}>
    <section className="panel" aria-labelledby="account-session-title" style={{display:'grid',gap:16}}>
      <h2 id="account-session-title">当前账号状态</h2>
      {session.status==='loading'&&<p role="status">正在向服务器核对会话……</p>}
      {session.status==='guest'&&<p role="status">当前未登录。可继续使用此设备的访客记录，或登录自己的账号。</p>}
      {session.status==='unavailable'&&<p role="status">账号服务尚未启用或暂不可用；当前不能注册或登录，访客本机学习仍可使用。</p>}
      {session.status==='native'&&<p role="status">此网页入口不承接原生会话，请返回原生学习页的账号入口。</p>}
      {session.status==='error'&&<p role="status">未能确认当前会话。请检查网络并重试，暂不提供身份切换操作。</p>}
      {session.status==='authenticated'&&<><p role="status">已由服务器验证：<b>{session.user.username}</b></p><p className="small muted">用户名只是登录凭证，学习记录归属于同一个稳定账号身份。绑定手机号也不会建立第二套账号。</p><div className="button-row"><button className="button secondary" disabled={busy||review!==null||switching} onClick={()=>{setReview('switch');setError('');}}>切换账号</button><button className="button secondary" disabled={busy||review!==null} onClick={()=>{setReview('logout');setError('');}}>退出当前账号</button></div></>}
      {session.status!=='loading'&&session.status!=='native'&&<button className="text-button" disabled={busy} onClick={()=>{setSwitching(false);setReview(null);setPassword('');setConfirmation('');setCheck(value=>value+1);}}>重新核对登录状态</button>}
      {review&&<section aria-labelledby="account-review-title" className="workspace-save-error" style={{display:'grid',gap:12}}><h3 id="account-review-title">{review==='logout'?'退出前请确认':'切换前请确认'}</h3><p>请先回学习页保存草稿和录音，查看待同步项，并按需备份。旧队列和记录保留原归属；退出不会删除记录。已到达服务器的请求不能靠关闭页面撤销。</p><div className="button-row"><button autoFocus className="button secondary" disabled={busy} onClick={()=>setReview(null)}>取消</button><a className="button secondary" href="/">返回学习检查</a><button className="button primary" disabled={busy} onClick={()=>{if(review==='logout')void logout();else{setSwitching(true);setReview(null);setPassword('');setConfirmation('');}}}>{busy?'正在确认……':review==='logout'?'继续退出':'继续选择账号'}</button></div></section>}
      {error&&<p role="alert" className="bad">{error}</p>}
    </section>
    {available&&(session.status==='guest'||switching)&&<section className="panel" aria-labelledby="account-form-title">
      <h2 id="account-form-title">{mode==='login'?'登录账号':'注册新账号'}</h2>
      {switching&&<p className="small muted">当前会话在另一个账号登录成功前保持有效。取消切换不会退出当前账号。</p>}
      <form onSubmit={event=>void submit(event)}>
        <label className="field" htmlFor="account-username">用户名<input id="account-username" name="username" value={username} onChange={event=>setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby="account-username-help" required disabled={busy}/></label>
        <p id="account-username-help" className="small muted">3–32 位字母、数字或下划线。</p>
        <label className="field" htmlFor="account-password">密码<input id="account-password" name="password" type={passwordVisible?'text':'password'} value={password} onChange={event=>setPassword(event.target.value)} autoComplete={mode==='register'?'new-password':'current-password'} aria-describedby="account-password-help" required disabled={busy}/></label>
        <button type="button" className="text-button" aria-pressed={passwordVisible} disabled={busy} onClick={()=>setPasswordVisible(value=>!value)}>{passwordVisible?'隐藏密码':'显示密码'}</button>
        <p id="account-password-help" className="small muted">15–128 个字符，空格也属于密码。</p>
        {mode==='register'&&<label className="field" htmlFor="account-password-confirmation">再次输入密码<input id="account-password-confirmation" name="password-confirmation" type={passwordVisible?'text':'password'} value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="new-password" required disabled={busy}/></label>}
        <div className="button-row"><button className="button primary" type="submit" disabled={busy}>{busy?'正在提交……':mode==='login'?'登录':'注册并登录'}</button><button className="button secondary" type="button" disabled={busy} onClick={()=>changeMode(mode==='login'?'register':'login')}>{mode==='login'?'注册新账号':'已有账号，去登录'}</button>{switching&&<button className="button secondary" type="button" disabled={busy} onClick={()=>{setSwitching(false);setPassword('');setConfirmation('');setError('');}}>取消切换</button>}</div>
      </form>
    </section>}
    {(available||session.status==='unavailable')&&<PhoneFlow key={(session.status==='authenticated'?session.user.id:'guest')+(switching?':login':':'+(session.status==='authenticated'?'bind':'login'))}
      purpose={session.status==='authenticated'&&!switching?'bind':'login'} transport={phoneTransport} disabled={busy}
      challenge={phoneChallenge?.owner===(session.status==='authenticated'?session.user.id:null)?phoneChallenge.challenge:null}
      onChallenge={challenge=>{setPhoneOutcome(null);setPhoneChallenge(challenge?{owner:session.status==='authenticated'?session.user.id:null,challenge}:null);}} outcome={phoneOutcome} onMutation={phoneMutation}/>}
    <PublicInfoLinks compact/><details className="panel"><summary>账号与记录说明</summary><p>账号与访客记录分别保留，不会自动合并。</p><p>手机号按实际服务能力开放，仅支持中国大陆 +86。</p><p>暂不支持找回密码，请妥善保存。</p></details>
  </div>;
}
