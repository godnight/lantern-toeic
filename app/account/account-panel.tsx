'use client';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {PublicInfoLinks} from '../learn/legal-pages';
import {validateProductCredentials} from '@/lib/product-identity';
import type {NativeAccountState} from '@/lib/native-account-controller';
import './account-panel.css';
import {LegacyAccountPanel} from './account-panel-legacy';

type Field='username'|'password'|'confirmation';
type Errors=Partial<Record<Field,string>>;
export type HuaweiAccountActions={login:boolean;binding:boolean;onLogin:()=>void;onBind:()=>void};
export function accountNotice(state:NativeAccountState,mode:'register'|'login'){
 if(state.status==='checking')return state.message==='华为账号授权进行中，旧学习分区已暂停。'?'请在华为账号窗口完成授权。':'正在确认账号，请稍候。';
 if(state.status==='blocked'){
  if(/到期|有效期/.test(state.message))return '登录已过期，学习记录仍保存在本机。';
  if(/账号操作|结果未知|结果尚未确认|结果未确认/.test(state.message))return '操作结果尚未确认，学习记录已暂时保护。';
  return '暂时无法确认账号，学习记录已暂时保护。';
 }
 if(!state.message)return '';
 if(['华为账号已绑定，学习记录仍属于当前账号。','华为账号授权已取消。','该华为账号已绑定其他微光账号，请使用原账号登录。','华为账号操作未获确认，请稍后重试。'].includes(state.message))return state.message;
 if(/这不确认原账号操作结果/.test(state.message))return state.user?'已确认当前账号；之前操作的结果仍未确认。':'当前尚未登录。之前操作的结果仍未确认，可尝试登录同一账号。';
 if(/已退出本机/.test(state.message))return '已退出本机。';
 if(/退出/.test(state.message))return '退出结果仍未确认，请核对当前账号。';
 if(/频繁/.test(state.message))return '尝试过于频繁，请稍后再试。';
 if(/账号操作未获确认/.test(state.message))return mode==='register'?'注册未被接受。请检查输入，或尝试登录。':'登录未被接受。请检查输入，或稍后再试。';
 return '请核对当前账号后继续。';
}
function SimplifiedAccountPanel({state,initialMode='register',onSubmit,onRecheck,onLogout,onEnter,onBack,onLegacy,huawei}:{state:NativeAccountState;initialMode?:'register'|'login';onSubmit:(mode:'register'|'login',credentials:{username:string;password:string})=>Promise<void>;onRecheck:()=>void;onLogout:()=>void;onEnter:()=>void;onBack?:()=>void;onLegacy?:()=>void;huawei?:HuaweiAccountActions}){
 const [mode,setMode]=useState<'register'|'login'>('login'),[formRequested,setFormRequested]=useState(false),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[visible,setVisible]=useState(false),[switching,setSwitching]=useState(false),[errors,setErrors]=useState<Errors>({});
 const prefix=useId(),inputs=useRef<Partial<Record<Field,HTMLInputElement|null>>>({}),help=useRef<HTMLDialogElement>(null),lastSubmit=useRef(initialMode);
 const clear=()=>{setPassword('');setConfirmation('');setVisible(false);setErrors({});};
 useEffect(()=>{if(state.status!=='ready')clear();},[state.status]);
 useEffect(()=>{const hide=()=>clear();window.addEventListener('pagehide',hide);document.addEventListener('visibilitychange',hide);return()=>{window.removeEventListener('pagehide',hide);document.removeEventListener('visibilitychange',hide);};},[]);
 const available=state.status==='ready'&&!state.unavailable&&state.capabilities.passwordLogin;
 const formOpen=available&&(!state.user||switching)&&formRequested,notice=accountNotice(state,lastSubmit.current),resultUnknown=state.status==='blocked'&&/账号操作|结果未知|结果尚未确认|结果未确认/.test(state.message);
 const change=(field:Field,value:string)=>{if(field==='username')setUsername(value);else if(field==='password')setPassword(value);else setConfirmation(value);setErrors(previous=>{const next={...previous};delete next[field];if(field==='password')delete next.confirmation;return next;});};
 const submit=async(event:FormEvent)=>{event.preventDefault();if(!available)return;const validation=validateProductCredentials(username,password,mode==='register'?confirmation:undefined);if(!validation.ok){setErrors({[validation.field]:validation.message});requestAnimationFrame(()=>{const input=inputs.current[validation.field];input?.focus({preventScroll:true});(input?.closest('label')??input)?.scrollIntoView({block:'start',behavior:'auto'});});return;}lastSubmit.current=mode;clear();await onSubmit(mode,validation.credentials);setSwitching(false);};
 const field=(name:Field,label:string,value:string)=>{
  const hint=undefined;
  const placeholder=name==='username'?(mode==='register'?'3–32 位字母、数字或下划线':'输入用户名'):name==='password'?(mode==='register'?'8–128 个字符':'输入密码'):'再次输入密码';
  return <div className="login-simple-field" style={{display:'grid',gap:6,minWidth:0}}><label style={{fontSize:'1rem',scrollMarginTop:16}} htmlFor={prefix+'-'+name}>{label}<input id={prefix+'-'+name} ref={element=>{inputs.current[name]=element;}} name={name} placeholder={placeholder} required style={{scrollMarginTop:16,fontSize:'1rem'}} autoComplete={name==='username'?'username':mode==='register'?'new-password':'current-password'} autoCapitalize={name==='username'?'none':undefined} autoCorrect={name==='username'?'off':undefined} spellCheck={name==='username'?false:undefined} type={name==='username'||visible?'text':'password'} value={value} aria-invalid={errors[name]?true:undefined} aria-describedby={errors[name]?prefix+'-'+name+'-error':hint?prefix+'-'+name+'-hint':undefined} onChange={event=>change(name,event.target.value)}/></label>{name==='password'&&<button type="button" className="login-simple-eye" aria-pressed={visible} aria-label={visible?'隐藏密码':'显示密码'} onClick={()=>setVisible(!visible)}><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{visible&&<path d="M4 4l16 16"/>}</svg></button>}{errors[name]?<p id={prefix+'-'+name+'-error'} role="alert" style={{margin:0,overflowWrap:'anywhere'}}>{errors[name]}</p>:hint&&<p id={prefix+'-'+name+'-hint'} style={{margin:0,fontSize:'0.875rem',color:'var(--muted-foreground)',overflowWrap:'anywhere'}}>{hint}</p>}</div>;
 };
 const checking=state.status==='checking',blocked=state.status==='blocked',authorization=checking&&/华为账号授权进行中/.test(state.message);
 const expired=blocked&&/到期|有效期/.test(state.message);
 const unavailable=state.status==='ready'&&!state.user&&(state.unavailable||(!available&&!huawei?.login));
 const title=authorization?'正在登录':checking?'正在核对账号':blocked?(expired?'登录已过期':resultUnknown?'上次操作尚未确认':'暂时无法核对账号'):unavailable?'账号服务暂不可用':state.status==='ready'&&state.user&&!switching?'微光账号':formOpen?(mode==='register'?'注册微光账号':'账号密码登录'):'登录微光';
 const hint=authorization?'请在华为账号窗口完成授权':checking?'请稍候':blocked?(expired?'请重新核对后继续学习':resultUnknown?'请重新核对，本机记录会保留。':'请稍后重试，本机记录会保留。'):unavailable?'请稍后重试，本机记录会保留。':formOpen&&mode==='login'?'使用已有的微光账号':'学习记录保存在本机';
 const back=()=>{clear();if(mode==='register'){setMode('login');return;}setFormRequested(false);setSwitching(false);};
 return <main className={`workspace-account login-simple${formOpen?' login-simple--form':''}`} aria-busy={checking}>
  <nav className="login-simple-top">{formOpen&&<button type="button" onClick={back} aria-label="返回">‹ <span>返回</span></button>}</nav>
  <section className="login-simple-content" aria-labelledby={prefix+'-heading'}>
   <img className="login-simple-brand" src="/icons/login-approved.png" width="72" height="72" alt="微光"/>
   <div className="login-simple-heading"><h1 id={prefix+'-heading'}>{title}</h1><p>{hint}</p></div>
   <div className="login-simple-actions">
    {checking&&<div className="login-simple-check" role="status"><span className="login-simple-spinner" aria-hidden="true"/><span className="login-simple-sr-only">{authorization?'正在登录':'正在核对账号'}</span></div>}
    {(blocked||unavailable)&&<button className="login-simple-primary" type="button" onClick={()=>{clear();onRecheck();}}>{expired||resultUnknown?'重新核对':'重试'}</button>}
    {state.status==='ready'&&state.user&&!switching&&<><p>当前账号：<strong>{state.user.username}</strong></p><button className="login-simple-primary" type="button" onClick={onBack??onEnter}>{onBack?'返回学习':'进入本机学习'}</button><button className="login-simple-secondary" type="button" onClick={()=>{clear();setSwitching(true);setMode('login');setFormRequested(true);}}>切换账号</button><button className="login-simple-secondary" type="button" onClick={()=>{clear();onLogout();}}>退出本机</button>{!state.unavailable&&huawei?.binding&&<><button className="login-simple-secondary" type="button" onClick={()=>{clear();huawei.onBind();}}>绑定华为账号</button><p>绑定到当前微光账号，保留现有学习记录与登录方式，不会合并其他微光账号。</p></>}</>}
    {state.status==='ready'&&!state.unavailable&&(!state.user||switching)&&!formOpen&&<>{huawei?.login&&<button className="login-simple-primary" type="button" onClick={()=>{clear();huawei.onLogin();}}>华为账号登录</button>}{available&&<button className={huawei?.login?'login-simple-secondary':'login-simple-primary'} type="button" onClick={()=>{clear();setMode('login');setFormRequested(true);}}>账号密码登录</button>}</>}
    {state.status==='ready'&&notice&&<p role="status" aria-live="polite" className="login-simple-notice">{notice}</p>}
    {formOpen&&<form noValidate onSubmit={event=>void submit(event)} className="login-simple-form">
     {field('username','用户名',username)}{field('password','密码',password)}
     {mode==='register'&&field('confirmation','再次输入密码',confirmation)}
     <button className="login-simple-primary" type="submit">{mode==='register'?'注册':'登录'}</button>
     <button className="login-simple-secondary" type="button" onClick={()=>{clear();setMode(mode==='register'?'login':'register');}}>{mode==='register'?'已有账号，去登录':'注册账号'}</button>
    </form>}
   </div>
  </section>
  <footer className="login-simple-footer"><div className="login-simple-support">{onLegacy&&<><button type="button" onClick={()=>{clear();onLegacy();}}>旧本机数据与备份</button><span aria-hidden="true">·</span></>}<button type="button" onClick={()=>help.current?.showModal()}>帮助</button></div><PublicInfoLinks compact kinds={['privacy','terms']} className="login-simple-legal"/></footer>
  <dialog ref={help} className="login-simple-help" aria-labelledby={prefix+'-help-title'}><div className="login-simple-help-head"><h2 id={prefix+'-help-title'}>帮助</h2><button type="button" aria-label="关闭" onClick={()=>help.current?.close()}>×</button></div><p>学习记录保存在本机。</p><details><summary>账号规则</summary><p>用户名为 3–32 位英文字母、数字或下划线，不区分大小写，首尾空白会去除。</p><p>密码为 8–128 个有效字符，不含空字符；首尾空白属于密码。</p><p>登录有效期为 12 小时；另一设备登录会使旧会话失效。账号核对需要联网，本机学习记录不会自动随账号迁移。</p><p>暂不支持找回密码或自助注销，可通过问题反馈咨询；发邮件不会自动重置账号。</p></details><div onClick={()=>help.current?.close()}><PublicInfoLinks compact kinds={['support']}/></div></dialog>
 </main>;
}


export function AccountPanel(props:Parameters<typeof SimplifiedAccountPanel>[0]&{simplified?:boolean}){
 const {simplified,...rest}=props;
 return simplified&&!(rest.state.status==='ready'&&rest.state.user)?<SimplifiedAccountPanel {...rest}/>:<LegacyAccountPanel {...rest}/>;
}
