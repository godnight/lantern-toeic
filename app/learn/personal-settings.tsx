'use client';

import type {ComponentType} from 'react';
import {BookOpen,CalendarDays,ChevronRight,Cloud,Info,Mic,Palette,Settings2,ShieldCheck,Smartphone,UserRound} from 'lucide-react';
import type {Theme} from '@/lib/study-model';
import {UI_THEME_META} from '@/lib/ui-theme';
import {ThemeChooser} from './ui-theme';
import {PublicInfoLinks} from './legal-pages';

type SettingsRowProps={
  icon:ComponentType<{size?:number;className?:string;'aria-hidden'?:boolean}>;
  label:string;value?:string;onClick:()=>void;disabled?:boolean;
};
function SettingsRow({icon:Icon,label,value,onClick,disabled=false}:SettingsRowProps){
  return <button type="button" className="v040-settings-row" onClick={onClick} disabled={disabled}>
    <Icon size={20} className="v040-setting-icon" aria-hidden/>
    <span className="v040-setting-label">{label}</span>
    {value&&<span className="v040-setting-value">{value}</span>}
    <ChevronRight size={16} className="v040-setting-chevron" aria-hidden/>
  </button>;
}

export type PersonalSettingsProps={
  name:string;scope:string;theme:Theme;dailyNewLabel:string;accountLabel:string;syncLabel:string;
  onPlan:()=>void;onThemes:()=>void;onAccount:()=>void;onBackups:()=>void;
  onPreferences:()=>void;onRecordings:()=>void;onAbout:()=>void;onSync:()=>void;
  /** Disable changes while the current identity's records cannot be read. */
  disabled?:boolean;syncDisabled?:boolean;
};

export function PersonalSettings({name,scope,theme,dailyNewLabel,accountLabel,syncLabel,
  onPlan,onThemes,onAccount,onBackups,onPreferences,onRecordings,onAbout,onSync,
  disabled=false,syncDisabled=false}:PersonalSettingsProps){
  return <div className="v040-page v040-profile" data-v040-page="profile">
    <div className="v040-page-heading"><h1>我的</h1></div>
    <section className="v040-profile-card" aria-label="个人信息">
      <span className="v040-profile-avatar" aria-hidden="true"><UserRound size={24}/></span>
      <div><strong>{name}</strong><p>{scope}</p></div>
    </section>
    <h2 className="v040-group-label">学习与外观</h2>
    <div className="v040-settings-group">
      <SettingsRow icon={BookOpen} label="学习计划" value={dailyNewLabel} onClick={onPlan}/>
      <SettingsRow icon={Palette} label="外观主题" value={UI_THEME_META[theme].name} onClick={onThemes}/>
    </div>
    <h2 className="v040-group-label">账号与数据</h2>
    <div className="v040-settings-group">
      <SettingsRow icon={ShieldCheck} label="账号与安全" value={accountLabel} onClick={onAccount}/>
      <SettingsRow icon={Cloud} label="记录同步" value={syncLabel} onClick={onSync} disabled={syncDisabled||disabled}/>
      <SettingsRow icon={Settings2} label="数据管理" onClick={onBackups}/>
      <SettingsRow icon={Mic} label="录音历史" onClick={onRecordings}/>
    </div>
    <h2 className="v040-group-label">应用</h2>
    <div className="v040-settings-group"><PublicInfoLinks/><SettingsRow icon={Info} label="关于微光" onClick={onAbout}/></div>
  </div>;
}

export type ThemeSettingsProps={theme:Theme;onChange:(theme:Theme)=>void;disabled?:boolean};
export function ThemeSettings({theme,onChange,disabled=false}:ThemeSettingsProps){
  return <div className="v040-page v040-themes" data-v040-page="themes">
    <div className="v040-page-heading"><h1>选择主题</h1></div>
    <ThemeChooser theme={theme} onChange={onChange} disabled={disabled}/>
  </div>;
}

export type AboutSettingsProps={
  version:string;buildId:string;versionCode?:number;nativeMode?:boolean;
  onSources:()=>void;onInstall:()=>void;
};
export function AboutSettings({version,buildId,versionCode,nativeMode=false,onSources,onInstall}:AboutSettingsProps){
  return <div className="v040-page v040-about" data-v040-page="about">
    <div className="v040-page-heading"><h1>关于微光</h1></div>
    <section className="v040-about-card">
      <h2>微光</h2><p>托业学习</p>
      <dl className="v040-about-facts">
        <div><dt>应用版本</dt><dd>v{version}{versionCode!==undefined?` / ${versionCode}`:''}</dd></div>
        <div><dt>构建标识</dt><dd>{buildId}</dd></div>
        <div><dt>使用方式</dt><dd>{nativeMode?'鸿蒙本机应用':'网页版'}</dd></div>
      </dl>
      <p className="v040-about-note">TOEIC 是 ETS 注册商标，微光为独立学习工具。</p>
    </section>
    <div className="v040-settings-group">
      <SettingsRow icon={Info} label="内容来源与许可" onClick={onSources}/>
      <SettingsRow icon={Smartphone} label="设备与离线使用" onClick={onInstall}/>
    </div>
  </div>;
}
