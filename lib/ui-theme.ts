import type {Theme} from '@/lib/study-model';

/** Display names are separate from the four existing persisted Theme values. */
export type UiTheme = 'day' | 'night' | 'hollow' | 'silk';

export const UI_THEME_BY_PERSISTED = {
  paper: 'day',
  crystal: 'night',
  hollow: 'hollow',
  silk: 'silk',
} as const satisfies Record<Theme, UiTheme>;

export const UI_THEME_ORDER = ['paper', 'crystal', 'hollow', 'silk'] as const satisfies readonly Theme[];

export type UiThemeDefinition = Readonly<{
  name: string;
  description: string;
  game: boolean;
  colorScheme: 'light' | 'dark';
}>;

export const UI_THEME_META = {
  paper: {name: '默认日间', description: '暖白 · 墨绿 · 无游戏元素', game: false, colorScheme: 'light'},
  crystal: {name: '默认夜间', description: '炭灰 · 薄荷 · 无游戏元素', game: false, colorScheme: 'dark'},
  hollow: {name: '空洞骑士', description: '对称门拱 · 骨白切面', game: true, colorScheme: 'dark'},
  silk: {name: '丝之歌', description: '斜针 · 丝环 · 钟线', game: true, colorScheme: 'dark'},
} as const satisfies Record<Theme, UiThemeDefinition>;

export type UiThemePalette = Readonly<{
  canvas: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textSecondary: string;
  primary: string;
  onPrimary: string;
  selection: string;
  divider: string;
  controlBorder: string;
  focus: string;
  success: string;
  warning: string;
  danger: string;
  dangerSoft: string;
  warningSoft: string;
}>;

/** Opaque colors from the accepted design. CSS contains the same palette. */
export const UI_THEME_PALETTES = {
  day: {canvas:'#f5f4f0',surface:'#ffffff',surfaceMuted:'#efeee9',text:'#202822',textSecondary:'#606862',primary:'#244e41',onPrimary:'#ffffff',selection:'#e6eee8',divider:'#e1e4dd',controlBorder:'#7a877f',focus:'#244e41',success:'#246b48',warning:'#825c1c',danger:'#aa3d38',dangerSoft:'#f8e8e5',warningSoft:'#f5eddb'},
  // One-channel lift from #768a7c also keeps the border above 3:1 on selection.
  night: {canvas:'#181d1c',surface:'#202724',surfaceMuted:'#2a332f',text:'#eef1ed',textSecondary:'#aab7af',primary:'#92c8b2',onPrimary:'#14251d',selection:'#2b4135',divider:'#3a453f',controlBorder:'#778b7d',focus:'#b1dec9',success:'#9ad2b2',warning:'#e3c17e',danger:'#f4a69e',dangerSoft:'#452d2c',warningSoft:'#423927'},
  hollow: {canvas:'#101824',surface:'#172332',surfaceMuted:'#213044',text:'#eeede5',textSecondary:'#a8b7cb',primary:'#a7bed9',onPrimary:'#142134',selection:'#294058',divider:'#34465b',controlBorder:'#738ca7',focus:'#bdd7f2',success:'#a0cfb7',warning:'#e1c68c',danger:'#f0a8a4',dangerSoft:'#443039',warningSoft:'#403927'},
  silk: {canvas:'#21191d',surface:'#2b2025',surfaceMuted:'#38282f',text:'#f1eae2',textSecondary:'#beabb0',primary:'#d397aa',onPrimary:'#2a1820',selection:'#4c2d39',divider:'#523b45',controlBorder:'#a17e8d',focus:'#f1b5c8',success:'#aad1b6',warning:'#e4c38e',danger:'#f3aea9',dangerSoft:'#503039',warningSoft:'#463629'},
} as const satisfies Record<UiTheme, UiThemePalette>;

/** Call from an effect before any early-return branch. No settings are persisted. */
export function applyDocumentTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const uiTheme = UI_THEME_BY_PERSISTED[theme];
  const colorScheme = UI_THEME_META[theme].colorScheme;
  document.documentElement.dataset.uiTheme = uiTheme;
  document.documentElement.style.colorScheme = colorScheme;
  if (document.body) {
    document.body.dataset.uiTheme = uiTheme;
    document.body.style.colorScheme = colorScheme;
  }
}
