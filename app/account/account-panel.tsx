'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {PublicInfoLinks} from '../learn/legal-pages';
import {validateProductCredentials} from '@/lib/product-identity';
import type {NativeAccountState} from '@/lib/native-account-controller';

export function AccountPanel({state,initialMode='register',onSubmit,onRecheck,onLogout,onEnter,onBack,onLegacy}:{state:NativeAccountState;initialMode?:'register'|'login';onSubmit:(mode:'register'|'login',credentials:{username:string;password:string})=>Promise<void>;onRecheck:()=>void;onLogout:()=>void;onEnter:()=>void;onBack?:()=>void;onLegacy?:()=>void}){
 const [mode,setMode]=useState(initialMode),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[visible,setVisible]=useState(false),[switching,setSwitching]=useState(false),[error,setError]=useState('');
 const clear=()=>{setPassword('');setConfirmation('');setVisible(false);};
 useEffect(()=>{if(state.status!=='ready')clear();},[state.status]);
 useEffect(()=>{const hide=()=>clear();window.addEventListener('pagehide',hide);document.addEventListener('visibilitychange',hide);return()=>{window.removeEventListener('pagehide',hide);document.removeEventListener('visibilitychange',hide);};},[]);
 const busy=state.status==='checking',available=state.status==='ready'&&!state.unavailable&&state.capabilities.passwordLogin;
 const submit=async(event:FormEvent)=>{event.preventDefault();if(!available)return;const validation=validateProductCredentials(username,password,mode==='register'?confirmation:undefined);if(!validation.ok){setError(validation.message);return;}setError('');clear();await onSubmit(mode,validation.credentials);setSwitching(false);};
 return <main className="workspace-account"><section className="panel" style={{display:'grid',gap:16,padding:24,maxWidth:620,margin:'20px auto'}} aria-busy={busy}>
  <h1>微光账号</h1><p>每个人使用自己注册的账号。学习记录当前保存在本机，不自动上传。</p>
  <p role="status" aria-live="polite">{state.message|| (state.status==='ready'&&state.user?`当前已核对账号：${state.user.username}`:'注册微光账号，或使用已有账号登录。')}</p>
  {state.status==='ready'&&state.user&&<><p>当前已核对：<strong>{state.user.username}</strong></p><div className="button-row"><button className="button primary" type="button" onClick={onEnter}>进入本机学习</button><button className="button secondary" type="button" onClick={()=>{clear();setSwitching(true);setMode('login');}}>切换账号</button><button className="button secondary" type="button" onClick={()=>{clear();onLogout();}}>退出本机</button></div></>}
  {state.status==='blocked'&&<><p>原账号数据仍在原分区。若注册结果未知，请先核对；未登录并不证明注册失败，可再尝试登录同一账号。</p><button className="button primary" type="button" onClick={()=>{clear();onRecheck();}}>重新核对账号</button></>}
  {state.status==='ready'&&state.unavailable&&<p role="alert">账号服务尚未启用或当前设备不支持，暂时不能注册、登录。</p>}
  {available&&(!state.user||switching)&&<form noValidate onSubmit={event=>void submit(event)} style={{display:'grid',gap:12}}>
   <h2>{mode==='register'?'注册微光账号':'已有账号登录'}</h2><label className="field">用户名<input name="username" required autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={event=>setUsername(event.target.value)}/></label>
   <p className="small muted">3–32位英文字母、数字或下划线，不区分大小写。</p><label className="field">密码<input name="password" required autoComplete={mode==='register'?'new-password':'current-password'} type={visible?'text':'password'} value={password} onChange={event=>setPassword(event.target.value)}/></label>
   <button type="button" className="text-button" aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?'隐藏密码':'显示密码'}</button><p className="small muted">15–128个有效字符，首尾空白属于密码。</p>
   {mode==='register'&&<label className="field">再次输入密码<input name="confirmation" autoComplete="new-password" required type={visible?'text':'password'} value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>}
   {error&&<p role="alert">{error}</p>}<div className="button-row"><button className="button primary" type="submit">{mode==='register'?'注册并核对账号':'登录并核对账号'}</button><button className="button secondary" type="button" onClick={()=>{clear();setError('');setMode(mode==='register'?'login':'register');}}>{mode==='register'?'已有账号，去登录':'注册新账号'}</button>{switching&&<button type="button" className="text-button" onClick={()=>{clear();setSwitching(false);}}>取消切换</button>}</div>
  </form>}
  <div className="button-row">{onBack&&<button type="button" className="button secondary" onClick={()=>{clear();onBack();}}>安全返回</button>}{onLegacy&&<button type="button" className="text-button" onClick={()=>{clear();onLegacy();}}>查看旧本机数据与备份</button>}</div>
  <p className="small muted">此版账号为12小时单会话，另一设备登录会使旧会话失效。暂不支持找回密码或自助注销，可通过问题反馈咨询；发邮件不会自动重置账号。</p><PublicInfoLinks compact/>
 </section></main>;
}
