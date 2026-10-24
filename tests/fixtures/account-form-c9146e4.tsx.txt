'use client';

import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {broadcastProductSessionChange,useProductSession} from '@/lib/use-product-session';

type User = {id:string;username:string};
type Session = {status:'loading'|'guest'|'unavailable'|'error'|'native'} | {status:'authenticated';user:User};
type Mode = 'login'|'register';

// Response validation is presentation only. Authentication and data ownership
// are decided by the server's opaque HttpOnly session, never this object.
function responseUser(value:unknown):User|null {
  if(!value||typeof value!=='object')return null;
  const user=(value as {user?:unknown}).user;
  if(!user||typeof user!=='object')return null;
  const {id,username}=user as {id?:unknown;username?:unknown};
  return typeof id==='string'&&/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)&&typeof username==='string'&&/^[a-z0-9_]{3,32}$/.test(username)?{id,username}:null;
}

export default function AccountForm() {
  const [session,setSession]=useState<Session>({status:'loading'});
  const [mode,setMode]=useState<Mode>('login');
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [review,setReview]=useState<'switch'|'logout'|null>(null);
  const [switching,setSwitching]=useState(false);
  const [check,setCheck]=useState(0);
  const requestPending=useRef(false);
  const sessionGuard=useProductSession(session.status==='authenticated'?session.user.id:null,session.status==='native');

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
    setMode(next);setPassword('');setConfirmation('');setError('');
  }

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(requestPending.current||busy||sessionGuard.status!=='ready'||(session.status!=='guest'&&!(session.status==='authenticated'&&switching)))return;
    setError('');
    if(/[^\x00-\x7f]/.test(username)||!/^[a-zA-Z0-9_]{3,32}$/.test(username.trim())){
      setError('用户名须为 3–32 个英文字母、数字或下划线，首尾空白会去除，大小写不区分。');return;
    }
    const count=[...password].length;
    if(count<15||count>128){setError('密码须为 15–128 个字符，首尾空白属于密码。');return;}
    if(mode==='register'&&password!==confirmation){setError('两次输入的密码不一致。');return;}
    requestPending.current=true;setBusy(true);
    try{
      const response=await fetch(`/api/auth/${mode}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({username,password})});
      if(response.status!==200){
        setError(response.status===429?'尝试过于频繁，请稍后再试。':response.status===503?'账号服务暂不可用，当前身份没有切换。':response.status===403?'请求未通过安全校验，请重新核对登录状态后再试。':mode==='login'?'登录失败，请检查用户名和密码，或稍后再试。':'未能注册，请检查用户名和密码要求，或稍后再试。');return;
      }
      if(!responseUser(await response.json()))throw new Error('Invalid response');
      broadcastProductSessionChange();
      // Full navigation drops the old owner's in-memory views and requests.
      window.location.assign('/');
    }catch{
      setError('请求结果未能确认。请重新核对登录状态，确认后再继续；此页不会假定已成功。');
      // The mutation may have committed (and Set-Cookie may have arrived) even
      // when fetching/parsing its response fails. Invalidate, never infer success.
      broadcastProductSessionChange();
      sessionGuard.recheck();
    }finally{
      setPassword('');setConfirmation('');requestPending.current=false;setBusy(false);
    }
  }

  async function logout(){
    if(requestPending.current||busy||sessionGuard.status!=='ready'||session.status!=='authenticated')return;
    requestPending.current=true;setBusy(true);setError('');
    try{
      const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:'{}'});
      if(response.status!==200){setError('退出未获服务器确认，仍保留当前账号视图。请检查网络并重新核对登录状态。');return;}
      broadcastProductSessionChange();
      window.location.assign('/');
    }catch{
      setError('退出结果未能确认。账号操作已暂停并重新核对服务器会话；此页不会假定已退出。');
      broadcastProductSessionChange();
      sessionGuard.recheck();
    }finally{requestPending.current=false;setBusy(false);}
  }

  const available=session.status==='guest'||session.status==='authenticated';
  if(sessionGuard.status!=='ready')return <section className="panel" aria-live="polite" aria-busy={sessionGuard.status==='checking'}><h2>核对账号状态</h2><p>{sessionGuard.status==='checking'?'正在重新核对服务器会话，账号操作已暂停。':sessionGuard.status==='redirecting'?'会话已变化，正在重新打开学习页。':'当前会话无法确认，账号操作保持暂停，请重试。'}</p>{error&&<p role="alert" className="bad">{error}</p>}<div className="button-row">{sessionGuard.status==='error'&&<button className="button primary" onClick={sessionGuard.recheck}>重新核对账号</button>}<a className="button secondary" href="/">返回学习</a></div></section>;
  return <div className="workspace-account" aria-busy={busy||session.status==='loading'} style={{display:'grid',gap:20}}>
    <section className="panel" aria-labelledby="account-session-title" style={{display:'grid',gap:16}}>
      <h2 id="account-session-title">当前账号状态</h2>
      {session.status==='loading'&&<p role="status">正在向服务器核对会话……</p>}
      {session.status==='guest'&&<p role="status">当前未登录。可继续使用此设备的访客记录，或登录自己的账号。</p>}
      {session.status==='unavailable'&&<p role="status">账号服务尚未启用或暂不可用；当前不能注册或登录，访客本机学习仍可使用。</p>}
      {session.status==='native'&&<p role="status">鸿蒙原生版目前仅使用本机记录，用户名密码账号入口尚未接入原生会话。</p>}
      {session.status==='error'&&<p role="status">未能确认当前会话。请检查网络并重试，暂不提供身份切换操作。</p>}
      {session.status==='authenticated'&&<><p role="status">已由服务器验证：<b>{session.user.username}</b></p><p className="small muted">用户名只是登录凭证，学习记录归属于同一个稳定账号身份。未来绑定手机号也不会建立第二套账号。</p><div className="button-row"><button className="button secondary" disabled={busy||review!==null||switching} onClick={()=>{setReview('switch');setError('');}}>切换账号</button><button className="button secondary" disabled={busy||review!==null} onClick={()=>{setReview('logout');setError('');}}>退出当前账号</button></div></>}
      {session.status!=='loading'&&session.status!=='native'&&<button className="text-button" disabled={busy} onClick={()=>{setSwitching(false);setReview(null);setPassword('');setConfirmation('');setCheck(value=>value+1);}}>重新核对登录状态</button>}
      {review&&<section aria-labelledby="account-review-title" className="workspace-save-error" style={{display:'grid',gap:12}}><h3 id="account-review-title">{review==='logout'?'退出前请确认':'切换前请确认'}</h3><p>请先回学习页保存草稿和录音，查看待同步项，并按需备份。旧队列和记录保留原归属；退出不会删除记录。已到达服务器的请求不能靠关闭页面撤销。</p><div className="button-row"><button autoFocus className="button secondary" disabled={busy} onClick={()=>setReview(null)}>取消</button><a className="button secondary" href="/">返回学习检查</a><button className="button primary" disabled={busy} onClick={()=>{if(review==='logout')void logout();else{setSwitching(true);setReview(null);setPassword('');setConfirmation('');}}}>{busy?'正在确认……':review==='logout'?'继续退出':'继续选择账号'}</button></div></section>}
      {error&&<p role="alert" className="bad">{error}</p>}
    </section>
    {available&&(session.status==='guest'||switching)&&<section className="panel" aria-labelledby="account-form-title">
      <h2 id="account-form-title">{mode==='login'?'登录账号':'注册新账号'}</h2>
      {switching&&<p className="small muted">当前会话在另一个账号登录成功前保持有效。取消切换不会退出当前账号。</p>}
      <form onSubmit={event=>void submit(event)}>
        <label className="field" htmlFor="account-username">用户名<input id="account-username" name="username" value={username} onChange={event=>setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby="account-username-help" required disabled={busy}/></label>
        <p id="account-username-help" className="small muted">3–32 个英文字母、数字或下划线，大小写不区分，首尾空白会去除。</p>
        <label className="field" htmlFor="account-password">密码<input id="account-password" name="password" type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete={mode==='register'?'new-password':'current-password'} aria-describedby="account-password-help" required disabled={busy}/></label>
        <p id="account-password-help" className="small muted">15–128 个字符，首尾空白属于密码。支持粘贴和密码管理器，请妥善保管。</p>
        {mode==='register'&&<label className="field" htmlFor="account-password-confirmation">再次输入密码<input id="account-password-confirmation" name="password-confirmation" type="password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="new-password" required disabled={busy}/></label>}
        <div className="button-row"><button className="button primary" type="submit" disabled={busy}>{busy?'正在提交……':mode==='login'?'登录':'注册并登录'}</button><button className="button secondary" type="button" disabled={busy} onClick={()=>changeMode(mode==='login'?'register':'login')}>{mode==='login'?'注册新账号':'已有账号，去登录'}</button>{switching&&<button className="button secondary" type="button" disabled={busy} onClick={()=>{setSwitching(false);setPassword('');setConfirmation('');setError('');}}>取消切换</button>}</div>
      </form>
    </section>}
    <section className="panel" style={{display:'grid',gap:12}}><h2>新账号与原记录</h2><p>注册或登录不会认领、复制或上传访客及旧站记录。新账号从自己的独立分区开始；原记录仍保留在原分区。当前没有跨账号迁移或静默合并功能。</p><p>手机号登录尚未开通，第一版号码范围仅为中国大陆 +86，号码格式合法不代表已验证归属。</p><p>当前没有经过验证的短信、邮箱或恢复码渠道，不能找回密码，也不能仅凭用户名重置。请在使用前确认能妥善保存密码；可信恢复方案仍是公开发布前的待办。</p><p className="small muted">本地开发候选，未真实短信联调，未公开上线。鸿蒙原生账号接入另行验收。</p></section>
  </div>;
}
