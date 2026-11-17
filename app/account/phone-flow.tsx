'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {normalizeMainlandPhone,parsePhoneCapabilities,parsePhoneChallenge,parsePhoneOutcome,phoneOutcomeMessage,
  type PhoneChallenge,type PhoneClientTransport,type PhoneOutcome,type PhonePurpose,type PhoneVerification} from '@/lib/phone-auth-client';

export type PhoneFlowProps={purpose:PhonePurpose;transport:PhoneClientTransport;
  onMutation:(purpose:PhonePurpose,body:PhoneVerification)=>Promise<void>;
  challenge?:PhoneChallenge|null;onChallenge?:(challenge:PhoneChallenge|null)=>void;outcome?:PhoneOutcome|null;disabled?:boolean};

/** Shared real React form; successful mutation never authenticates or selects an owner. */
export default function PhoneFlow({purpose,transport,onMutation,challenge:resume,onChallenge,outcome,disabled=false}:PhoneFlowProps){
  const [phase,setPhase]=useState<'loading'|'ready'|'unavailable'|'unknown'>('loading');
  const [phone,setPhone]=useState(resume?.purpose===purpose?resume.phone:'');const [code,setCode]=useState('');
  const [challenge,setChallenge]=useState<PhoneChallenge|null>(resume?.purpose===purpose?resume:null);
  const [retryAt,setRetryAt]=useState<string|null>(resume?.purpose===purpose?resume.resendAt:null),[challengeError,setChallengeError]=useState<PhoneOutcome|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[now,setNow]=useState(Date.now());
  const generation=useRef(0),alive=useRef(false),pending=useRef<AbortController|null>(null),locked=useRef(false);
  const id='phone-'+purpose;
  function cancel(){generation.current++;pending.current?.abort();pending.current=null;locked.current=false;}
  function clearChallenge(){setChallenge(null);onChallenge?.(null);setCode('');}
  async function status(){
    cancel();const current=++generation.current,controller=new AbortController();pending.current=controller;setPhase('loading');setBusy(false);setMessage('');
    try{const reply=await transport.request('status',undefined,controller.signal);if(!alive.current||current!==generation.current)return;
      const capabilities=reply.status===200?parsePhoneCapabilities(reply.body):null;
      if(!capabilities){
        const closed=reply.body.capabilities as {phoneLogin?:unknown;phoneBinding?:unknown}|undefined;
        if(reply.status===503&&closed?.phoneLogin===false&&closed.phoneBinding===false&&['native-auth-unavailable','auth-disabled','phone-auth-disabled','phone-unavailable','phone-provider-unavailable'].includes(String(reply.body.code))){setPhase('unavailable');clearChallenge();return;}
        throw Error('Unknown phone capabilities');
      }
      const enabled=purpose==='bind'?capabilities.phoneBinding:capabilities.phoneLogin;
      setPhase(enabled?'ready':'unavailable');if(!enabled)clearChallenge();
    }catch{if(alive.current&&current===generation.current){setPhase('unknown');clearChallenge();}}
    finally{if(current===generation.current)pending.current=null;}
  }
  useEffect(()=>{
    alive.current=true;void status();
    const leave=()=>{cancel();setPhone('');setCode('');setBusy(false);clearChallenge();setPhase('unknown');setMessage('页面已离开，请重新核对手机号服务。');};
    const visibility=()=>{if(document.visibilityState==='hidden')leave();};
    const timer=setInterval(()=>setNow(Date.now()),1000);
    window.addEventListener('pagehide',leave);document.addEventListener('visibilitychange',visibility);
    return()=>{alive.current=false;cancel();clearInterval(timer);window.removeEventListener('pagehide',leave);document.removeEventListener('visibilitychange',visibility);};
    // Transport is created once by the account shell. Purpose changes create a fresh form.
  },[transport,purpose]);
  const normalized=normalizeMainlandPhone(phone),verifyRetryTime=outcome?.retryAt?Date.parse(outcome.retryAt):0;
  const resendSeconds=Math.max(0,Math.ceil((Math.max(challenge?Date.parse(challenge.resendAt):0,retryAt?Date.parse(retryAt):0)-now)/1000));
  const expired=!!challenge&&Date.parse(challenge.expiresAt)<=now;
  async function send(){
    if(disabled||locked.current||phase!=='ready'||!normalized||resendSeconds>0)return;
    cancel();const current=++generation.current,controller=new AbortController();pending.current=controller;locked.current=true;
    setBusy(true);setCode('');setMessage('');
    try{const reply=await transport.request('challenge',{purpose,phone:normalized},controller.signal);
      if(!alive.current||current!==generation.current)return;
      if(reply.status!==202){const error=parsePhoneOutcome(reply);setChallengeError(error);setRetryAt(error.retryAt??null);setMessage(phoneOutcomeMessage(error));
        if(reply.status>=500){setPhase('unknown');clearChallenge();}return;}
      const accepted=parsePhoneChallenge(reply.body,purpose,normalized);if(!accepted)throw Error('Invalid challenge confirmation');
      setChallengeError(null);setRetryAt(accepted.resendAt);setChallenge(accepted);onChallenge?.(accepted);setNow(Date.now());setMessage('验证码发送请求已获确认，请查看短信。');
    }catch{if(alive.current&&current===generation.current){setPhase('unknown');clearChallenge();setMessage('发送结果无法确认，请重新核对状态；不会假定短信已发送。');}}
    finally{if(alive.current&&current===generation.current){pending.current=null;locked.current=false;setBusy(false);}}
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(disabled||locked.current||phase!=='ready'||!challenge||expired||verifyRetryTime>now||outcome?.attemptsRemaining===0||normalized!==challenge.phone||!/^[0-9]{6}$/.test(code))return;
    const body={challengeId:challenge.challengeId,phone:challenge.phone,code};setCode('');locked.current=true;setBusy(true);setMessage('');
    const current=generation.current;
    try{await onMutation(purpose,body);}catch{if(alive.current&&current===generation.current){setPhase('unknown');setMessage('提交结果未知，请先重新核对账号；不会假定已绑定或登录。');}}
    finally{body.code='';if(alive.current&&current===generation.current){locked.current=false;setBusy(false);}}
  }
  const blocked=disabled||busy||phase!=='ready';
  return <section className="panel" aria-labelledby={id+'-title'} aria-busy={busy||phase==='loading'} style={{display:'grid',gap:12}}>
    <h2 id={id+'-title'}>{purpose==='bind'?'绑定手机号':'手机号登录'}</h2>
    {phase==='loading'&&<p role="status">正在核对手机号服务能力……</p>}
    {phase==='unavailable'&&<p role="status">手机号服务尚未配置，当前不能发送短信、绑定或登录。</p>}
    {phase==='unknown'&&<p role="alert">手机号服务状态无法确认，请重新核对；当前操作已暂停。</p>}
    <p className="small muted">仅支持中国大陆 +86。格式合法不代表已验证；账号记录仍属于原稳定身份。</p>
    {phase==='ready'&&<form onSubmit={event=>void submit(event)} style={{display:'grid',gap:12}}>
      <label className="field" htmlFor={id+'-number'}>手机号（+86）<input id={id+'-number'} name="phone" type="tel" inputMode="tel" autoComplete="tel-national" value={phone}
        disabled={disabled||busy} onChange={event=>{setPhone(event.target.value);clearChallenge();setMessage('');}} required aria-describedby={id+'-help'}/></label>
      <p id={id+'-help'} className="small muted">输入 11 位手机号或完整 +86 号码。</p>
      <button type="button" className="button secondary" disabled={blocked||!normalized||resendSeconds>0} onClick={()=>void send()}>
        {busy?'正在处理……':resendSeconds>0?`${resendSeconds} 秒后可重发`:challenge?'重新发送验证码':'发送验证码'}</button>
      {challenge&&<><label className="field" htmlFor={id+'-code'}>短信验证码<input id={id+'-code'} name="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
        onChange={event=>setCode(event.target.value)} disabled={blocked||expired} required pattern="[0-9]{6}"/></label>
        <p className="small muted">{expired?'验证码已过期，请重新获取。':'请输入 6 位数字验证码。'}</p>
        <button type="submit" className="button primary" disabled={blocked||expired||verifyRetryTime>now||outcome?.attemptsRemaining===0||normalized!==challenge.phone||!/^[0-9]{6}$/.test(code)}>{purpose==='bind'?'确认绑定手机号':'使用验证码登录'}</button></>}
    </form>}
    {message&&<p role="status">{message}</p>}
    {challengeError?.attemptsRemaining!==undefined&&<p role="alert">剩余尝试次数：{challengeError.attemptsRemaining}。</p>}
    {outcome&&<p role={outcome.status===200?'status':'alert'}>{phoneOutcomeMessage(outcome)}{outcome.attemptsRemaining!==undefined?` 剩余尝试次数：${outcome.attemptsRemaining}。`:''}{outcome.retryAt?` 可重试时间：${outcome.retryAt}。`:''}</p>}
    {phase==='unknown'&&<button type="button" className="button secondary" disabled={busy||disabled} onClick={()=>void status()}>重新核对手机号服务</button>}
  </section>;
}
