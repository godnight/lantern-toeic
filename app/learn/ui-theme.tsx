'use client';

import {Check} from 'lucide-react';
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
    <figcaption>{label}</figcaption>
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

/** One real action per row; selected state comes from the persisted profile theme. */
export function ThemeChooser({theme,onChange,disabled=false}:ThemeChooserProps){
  const descriptions:Record<Theme,string>={paper:'奶油 · 嫩绿 · 柔桃',crystal:'炭灰 · 薄荷',hollow:'蓝湖 · 雨城',silk:'绛红 · 丝线'};
  return <div className="ui-theme-chooser v040-theme-list" role="group" aria-label="界面主题">
    {UI_THEME_ORDER.map(candidate=>{
      const selected=theme===candidate;
      return <button key={candidate} type="button" className="ui-theme-card v040-theme-option"
        aria-pressed={selected} disabled={disabled}
        aria-label={`${UI_THEME_META[candidate].name}，${descriptions[candidate]}${selected?'，正在使用':''}`}
        onClick={()=>{if(!selected)onChange(candidate);}}>
        <span className={`v040-theme-swatch v040-swatch-${UI_THEME_BY_PERSISTED[candidate]}`} aria-hidden="true">
          {candidate==='hollow'&&<img src="/phase2-theme/blue-lake-hd-1x.webp" width={448} height={252} alt="" decoding="async"/>}
        </span>
        <span className="v040-theme-copy"><strong>{UI_THEME_META[candidate].name}</strong><small>{descriptions[candidate]}</small></span>
        <span className="v040-choice-mark" aria-hidden="true"><Check size={14}/></span>
      </button>;
    })}
  </div>;
}
