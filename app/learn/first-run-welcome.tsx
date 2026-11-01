'use client';

import {ArrowRight,BookOpen,CalendarCheck,Headphones,ShieldCheck,Sunrise} from 'lucide-react';
import {PublicInfoLinks} from './legal-pages';
import './first-run-welcome.css';

export type FirstRunWelcomeProps={
  accountAvailable:boolean;
  onRegister:()=>void;
  onLogin:()=>void;
  onGuest:()=>void;
  busy?:boolean;
  error?:string;
};

/**
 * Presentation only. The parent must resolve identity and first-run persistence
 * before selecting this screen; no button here creates or assumes a session.
 */
export function FirstRunWelcome({
  accountAvailable,onRegister,onLogin,onGuest,busy=false,error,
}:FirstRunWelcomeProps){
  const message=error?.trim();
  return <main className="v041-first-run" data-first-run="welcome" aria-busy={busy}>
    <div className="v041-first-run-content">
      <header className="v041-first-run-brand">
        <span><Sunrise size={23} aria-hidden="true"/><strong>微光</strong></span>
        <p>TOEIC 学习</p>
      </header>

      <section className="v041-first-run-intro" aria-labelledby="v041-first-run-title">
        <div className="v041-first-run-light" aria-hidden="true"><Sunrise size={51} strokeWidth={1.3}/></div>
        <p className="v041-first-run-eyebrow">LANTERN · 微光</p>
        <h1 id="v041-first-run-title">从今天开始，<br/>点亮每一点进步。</h1>
        <p className="v041-first-run-description">把单词与听力，<br/>放进适合你的学习节奏。</p>
      </section>

      <ul className="v041-first-run-benefits" aria-label="微光学习内容">
        <li><BookOpen size={22} aria-hidden="true"/><span>积累词汇</span><small>从一组开始</small></li>
        <li><Headphones size={22} aria-hidden="true"/><span>练习听力</span><small>听懂每一步</small></li>
        <li><CalendarCheck size={22} aria-hidden="true"/><span>建立节奏</span><small>按自己的步调</small></li>
      </ul>

      <section className="v041-first-run-actions" aria-label="选择开始方式">
        {!accountAvailable&&<p className="v041-first-run-unavailable" role="status">账号服务暂未开放，可以先体验本机学习。</p>}
        {message&&<p className="v041-first-run-error" role="alert">{message}</p>}
        {accountAvailable?<>
          <button type="button" className="v041-first-run-primary" data-first-run-action="register" disabled={busy} onClick={onRegister}>
            注册账号<ArrowRight size={18} aria-hidden="true"/>
          </button>
          <button type="button" className="v041-first-run-secondary" data-first-run-action="login" disabled={busy} onClick={onLogin}>已有账号登录</button>
          <button type="button" className="v041-first-run-guest" data-first-run-action="guest" disabled={busy} onClick={onGuest}>先体验</button>
        </>:<>
          <button type="button" className="v041-first-run-primary" data-first-run-action="guest" disabled={busy} onClick={onGuest}>
            开始体验<ArrowRight size={18} aria-hidden="true"/>
          </button>
          <div className="v041-first-run-closed-actions">
            <button type="button" className="v041-first-run-secondary" data-first-run-action="register" disabled onClick={onRegister}>注册账号</button>
            <button type="button" className="v041-first-run-secondary" data-first-run-action="login" disabled onClick={onLogin}>已有账号登录</button>
          </div>
        </>}
        {busy&&<p className="v041-first-run-busy" role="status">正在处理，请稍候。</p>}
      </section>

      <footer className="v041-first-run-footer">
        <p className="v041-first-run-records"><ShieldCheck size={17} aria-hidden="true"/><span>本机游客记录不会自动转入账号。</span></p>
        <PublicInfoLinks className="v041-first-run-public-links" compact/>
      </footer>
    </div>
  </main>;
}

export default FirstRunWelcome;
