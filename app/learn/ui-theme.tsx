'use client';

import {Check, CircleAlert} from 'lucide-react';
import type {Theme} from '@/lib/study-model';
import {UI_THEME_BY_PERSISTED, UI_THEME_META, UI_THEME_ORDER} from '@/lib/ui-theme';

export type ThemeMotifProps = {theme: Theme};

export type ThemeBrandMarkProps = {size?: number; className?: string};

/** The user-approved icon, copied without editing. Decorative beside a text label. */
export function ThemeBrandMark({size = 40, className = ''}: ThemeBrandMarkProps) {
  return <img className={`phase2-brand-mark ${className}`.trim()}
    src="/phase2-theme/knight-icon-96.png"
    srcSet="/phase2-theme/knight-icon-48.png 48w, /phase2-theme/knight-icon-64.png 64w, /phase2-theme/knight-icon-96.png 96w, /phase2-theme/knight-icon-256.png 256w"
    sizes={`${size}px`} width={size} height={size} alt="" aria-hidden="true" decoding="async"/>;
}

export type ThemeSceneProps = {
  theme: Theme;
  scene?: 'blue-lake' | 'dirtmouth';
  caption?: string;
  className?: string;
};

/** Complete S1-r3 scene window, never a crop or a background behind reading text.
 * Only hollow displays game art; the other persisted themes retain their own UI.
 * The bounded display width and width-based srcSet preserve the supplied 1/2/3x set. */
export function ThemeScene({theme, scene = 'blue-lake', caption, className = ''}: ThemeSceneProps) {
  if (theme !== 'hollow') return null;
  const lake = scene === 'blue-lake';
  const widths = lake ? [448, 896, 1280] : [560, 1120, 1672];
  const label = caption ?? (lake ? '蓝湖 · 留一点时间，看看远处。' : '德特茅斯 · 这段旅途，可以稍歇。');
  return <figure className={`phase2-scene-window ${className}`.trim()} data-scene={scene}>
    <img src={`/phase2-theme/${scene}-hd-1x.webp`}
      srcSet={widths.map((width, index) => `/phase2-theme/${scene}-hd-${index + 1}x.webp ${width}w`).join(', ')}
      sizes="(max-width: 350px) calc(100vw - 32px), (max-width: 600px) calc(100vw - 40px), 560px"
      width={widths[0]} height={lake ? 252 : 315}
      alt={lake ? '奎若与小骑士坐在蓝湖边，完整洞顶、瀑布与湖面倒影构图' : '小骑士在德特茅斯长椅与暖灯下休憩的完整场景'}
      loading="lazy" decoding="async"/>
    <figcaption>{label}<span>既有 AI 同人场景 · 完整构图</span></figcaption>
  </figure>;
}

/** Ordinary page ornament only. The default themes deliberately render nothing. */
export function ThemeMotif({theme}: ThemeMotifProps) {
  if (theme === 'paper' || theme === 'crystal') return null;
  if (theme === 'hollow') return <ThemeBrandMark size={48} className="ui-theme-motif"/>;
  return <svg className="ui-theme-motif" viewBox="0 0 48 48" width="48" height="48"
    fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true" focusable="false">
    <>
      <path d="M10 40 34 8l6-4-2 7-25 31ZM32 12l4-5"/>
      <path d="M36 10C24 5 8 13 8 23c0 9 20 11 29 5 7-5 3-12-7-13-10-1-16 8-13 17"/>
      <path d="M18 28c0 6-3 8-6 10 7 3 16 4 24 1-5-2-8-5-9-10M20 41c3 3 7 3 10 0"/>
    </>
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
