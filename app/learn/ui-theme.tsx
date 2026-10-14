'use client';

import {Check, CircleAlert} from 'lucide-react';
import type {Theme} from '@/lib/study-model';
import {UI_THEME_BY_PERSISTED, UI_THEME_META, UI_THEME_ORDER} from '@/lib/ui-theme';

export type ThemeMotifProps = {theme: Theme};

/** Ordinary page ornament only. The default themes deliberately render nothing. */
export function ThemeMotif({theme}: ThemeMotifProps) {
  if (theme === 'paper' || theme === 'crystal') return null;
  return <svg className="ui-theme-motif" viewBox="0 0 48 48" width="48" height="48"
    fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true" focusable="false">
    {theme === 'hollow' ? <>
      <path d="M4 43V22C4 10 12 4 24 4s20 6 20 18v21M10 43V22c0-8 5-12 14-12s14 4 14 12v21"/>
      <path d="M17 17c4 3 10 3 14 0l-1 12c-3 4-9 4-12 0Z" fill="currentColor" stroke="none"/>
      <ellipse cx="21" cy="24" rx="1.5" ry="2.5" fill="var(--ui-canvas)" stroke="none"/>
      <ellipse cx="27" cy="24" rx="1.5" ry="2.5" fill="var(--ui-canvas)" stroke="none"/>
    </> : <>
      <path d="M10 40 34 8l6-4-2 7-25 31ZM32 12l4-5"/>
      <path d="M36 10C24 5 8 13 8 23c0 9 20 11 29 5 7-5 3-12-7-13-10-1-16 8-13 17"/>
      <path d="M18 28c0 6-3 8-6 10 7 3 16 4 24 1-5-2-8-5-9-10M20 41c3 3 7 3 10 0"/>
    </>}
  </svg>;
}

export type ThemeChooserProps = {
  theme: Theme;
  onChange: (theme: Theme) => void;
  disabled?: boolean;
};

/** One real button per theme. Every preview action/status is static and hidden to AT. */
export function ThemeChooser({theme, onChange, disabled = false}: ThemeChooserProps) {
  return <div className="ui-theme-chooser" role="group" aria-label="界面主题">
    {UI_THEME_ORDER.map(candidate => {
      const meta = UI_THEME_META[candidate];
      const selected = theme === candidate;
      return <button key={candidate} type="button" className="ui-theme-card"
        aria-pressed={selected} disabled={disabled}
        aria-label={`${meta.name}，${meta.description}${selected ? '，正在使用' : ''}`}
        onClick={() => {if (!selected) onChange(candidate);}}>
        <span className="ui-theme-preview" data-ui-theme={UI_THEME_BY_PERSISTED[candidate]} aria-hidden="true">
          <span className="ui-theme-preview-title"><strong>词卡自测</strong>
            {meta.game ? <ThemeMotif theme={candidate}/> : <span className="ui-theme-plain-mark">Aa</span>}
          </span>
          <span className="ui-theme-preview-description">先回忆词义，再揭示释义。</span>
          <span className="ui-theme-preview-word">
            <span><strong lang="en">schedule</strong><span className="ui-theme-preview-meaning">日程表；安排</span></span>
            <span className="ui-theme-preview-selected"><Check size={14}/>选中</span>
          </span>
          <span className="ui-theme-preview-action">查看释义</span>
          <span className="ui-theme-preview-states">
            <span className="ui-theme-preview-states-label">组件状态示例</span>
            <span className="ui-theme-preview-success"><Check size={14}/>反馈已保存</span>
            <span className="ui-theme-preview-failure">
              <strong><CircleAlert size={14}/>反馈未保存</strong>
              <span>选择保留，可重试。</span>
              <span className="ui-theme-preview-retry">重试保存</span>
            </span>
          </span>
        </span>
        <span className="ui-theme-caption">
          <span><span className="ui-theme-caption-name">{meta.name}</span>
            <span className="ui-theme-caption-description">{meta.description}</span></span>
          {selected && <span className="ui-theme-current"><Check size={15} aria-hidden="true"/>正在使用</span>}
        </span>
      </button>;
    })}
  </div>;
}
