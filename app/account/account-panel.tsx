'use client';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {PublicInfoLinks} from '../learn/legal-pages';
import {validateProductCredentials} from '@/lib/product-identity';
import type {NativeAccountState} from '@/lib/native-account-controller';

type Field='username'|'password'|'confirmation';
type Errors=Partial<Record<Field,string>>;
export function accountNotice(state:NativeAccountState,mode:'register'|'login'){
 if(state.status==='checking')return '正在确认账号，请稍候。';
 if(state.status==='blocked'){
  if(/到期|有效期/.test(state.message))return '登录已过期，学习记录仍保存在本机。';
  if(/账号操作|结果未知|结果尚未确认|结果未确认/.test(state.message))return '操作结果尚未确认，学习记录已暂时保护。';
  return '暂时无法确认账号，学习记录已暂时保护。';
 }
 if(!state.message)return '';
 if(/这不确认原账号操作结果/.test(state.message))return state.user?'已确认当前账号；之前操作的结果仍未确认。':'当前尚未登录。之前操作的结果仍未确认，可尝试登录同一账号。';
 if(/已退出本机/.test(state.message))return '已退出本机。';
 if(/退出/.test(state.message))return '退出结果仍未确认，请核对当前账号。';
 if(/频繁/.test(state.message))return '尝试过于频繁，请稍后再试。';
 if(/账号操作未获确认/.test(state.message))return mode==='register'?'注册未被接受。请检查输入，或尝试登录。':'登录未被接受。请检查输入，或稍后再试。';
 return '请核对当前账号后继续。';
}
export function AccountPanel({state,initialMode='register',onSubmit,onRecheck,onLogout,onEnter,onBack,onLegacy}:{state:NativeAccountState;initialMode?:'register'|'login';onSubmit:(mode:'register'|'login',credentials:{username:string;password:string})=>Promise<void>;onRecheck:()=>void;onLogout:()=>void;onEnter:()=>void;onBack?:()=>void;onLegacy?:()=>void}){
 const [mode,setMode]=useState(initialMode),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[visible,setVisible]=useState(false),[switching,setSwitching]=useState(false),[errors,setErrors]=useState<Errors>({});
 const prefix=useId(),inputs=useRef<Partial<Record<Field,HTMLInputElement|null>>>({}),lastSubmit=useRef(initialMode);
 const clear=()=>{setPassword('');setConfirmation('');setVisible(false);setErrors({});};
 useEffect(()=>{if(state.status!=='ready')clear();},[state.status]);
 useEffect(()=>{const hide=()=>clear();window.addEventListener('pagehide',hide);document.addEventListener('visibilitychange',hide);return()=>{window.removeEventListener('pagehide',hide);document.removeEventListener('visibilitychange',hide);};},[]);
 const available=state.status==='ready'&&!state.unavailable&&state.capabilities.passwordLogin;
 const formOpen=available&&(!state.user||switching),notice=accountNotice(state,lastSubmit.current),resultUnknown=state.status==='blocked'&&/账号操作|结果未知|结果尚未确认|结果未确认/.test(state.message);
 const change=(field:Field,value:string)=>{if(field==='username')setUsername(value);else if(field==='password')setPassword(value);else setConfirmation(value);setErrors(previous=>{const next={...previous};delete next[field];if(field==='password')delete next.confirmation;return next;});};
 const submit=async(event:FormEvent)=>{event.preventDefault();if(!available)return;const validation=validateProductCredentials(username,password,mode==='register'?confirmation:undefined);if(!validation.ok){setErrors({[validation.field]:validation.message});requestAnimationFrame(()=>{const input=inputs.current[validation.field];input?.focus({preventScroll:true});(input?.closest('label')??input)?.scrollIntoView({block:'start',behavior:'auto'});});return;}lastSubmit.current=mode;clear();await onSubmit(mode,validation.credentials);setSwitching(false);};
 const field=(name:Field,label:string,value:string)=> <div style={{display:'grid',gap:6,minWidth:0}}><label className="field" style={{fontSize:'1rem',scrollMarginTop:16}} htmlFor={prefix+'-'+name}>{label}<input id={prefix+'-'+name} ref={element=>{inputs.current[name]=element;}} name={name} required style={{scrollMarginTop:16,fontSize:'1rem'}} autoComplete={name==='username'?'username':mode==='register'?'new-password':'current-password'} autoCapitalize={name==='username'?'none':undefined} autoCorrect={name==='username'?'off':undefined} spellCheck={name==='username'?false:undefined} type={name==='username'||visible?'text':'password'} value={value} aria-invalid={errors[name]?true:undefined} aria-describedby={errors[name]?prefix+'-'+name+'-error':undefined} onChange={event=>change(name,event.target.value)}/></label>{errors[name]&&<p id={prefix+'-'+name+'-error'} role="alert" style={{margin:0,overflowWrap:'anywhere'}}>{errors[name]}</p>}</div>;
 return <main className="workspace-account"><section className="panel" style={{display:'grid',gap:16,padding:24,maxWidth:620,minWidth:0,margin:'20px auto',fontSize:'1rem',lineHeight:1.6,overflowWrap:'anywhere'}} aria-busy={state.status==='checking'}>
  <h1 style={{fontSize:'1.5rem',margin:0}}>{state.status==='blocked'?'账号需要核对':formOpen?(mode==='register'?'注册微光账号':'登录微光账号'):'微光账号'}</h1>
  <p style={{margin:0}}>学习记录保存在本机，不自动上传。</p>
  {notice&&<p role="status" aria-live="polite" style={{margin:0}}>{notice}</p>}
  {state.status==='ready'&&state.user&&<><p style={{margin:0}}>当前账号：<strong>{state.user.username}</strong></p><div className="button-row"><button style={{fontSize:'1rem'}} className="button primary" type="button" onClick={onBack??onEnter}>{onBack?'返回学习':'进入本机学习'}</button><button style={{fontSize:'1rem'}} className="button secondary" type="button" onClick={()=>{clear();setSwitching(true);setMode('login');}}>切换账号</button><button style={{fontSize:'1rem'}} className="button secondary" type="button" onClick={()=>{clear();onLogout();}}>退出本机</button></div></>}
  {state.status==='blocked'&&<><p style={{margin:0}}>{resultUnknown?'未登录不代表注册失败。请先重新核对，再尝试登录同一账号。':'请联网重新核对账号后继续。'}</p><button style={{fontSize:'1rem'}} className="button primary" type="button" onClick={()=>{clear();onRecheck();}}>重新核对账号</button></>}
  {state.status==='ready'&&state.unavailable&&<p role="alert">账号服务尚未启用或当前设备不支持，暂时不能注册、登录。</p>}
  {formOpen&&<form noValidate onSubmit={event=>void submit(event)} style={{display:'grid',gap:16,minWidth:0}}>
   {field('username','用户名',username)}{field('password','密码',password)}
   <button type="button" style={{fontSize:'1rem'}} className="text-button" aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?'隐藏密码':'显示密码'}</button>
   {mode==='register'&&field('confirmation','再次输入密码',confirmation)}
   <div className="button-row"><button style={{fontSize:'1rem'}} className="button primary" type="submit">{mode==='register'?'注册':'登录'}</button><button style={{fontSize:'1rem'}} className="button secondary" type="button" onClick={()=>{clear();setMode(mode==='register'?'login':'register');}}>{mode==='register'?'已有账号，去登录':'注册新账号'}</button>{switching&&<button type="button" style={{fontSize:'1rem'}} className="text-button" onClick={()=>{clear();setSwitching(false);}}>取消切换</button>}</div>
  </form>}
  {onLegacy&&<button type="button" style={{fontSize:'1rem'}} className="text-button" onClick={()=>{clear();onLegacy();}}>查看旧本机数据与备份</button>}
  <details><summary>账号说明</summary><div style={{display:'grid',gap:10,paddingTop:12}}><p>用户名为3–32位英文字母、数字或下划线，不区分大小写，首尾空白会去除。</p><p>密码为15–128个有效字符，不含空字符；首尾空白属于密码。</p><p>登录有效期为12小时；另一设备登录会使旧会话失效。账号核对需要联网，本机学习记录不会自动随账号迁移。</p><p>暂不支持找回密码或自助注销，可通过问题反馈咨询；发邮件不会自动重置账号。</p></div></details><PublicInfoLinks compact/>
 </section></main>;
}
