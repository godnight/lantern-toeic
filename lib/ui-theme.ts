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
  paper: {name: '奶油柔色', description: '奶油 · 嫩绿 · 柔桃', game: false, colorScheme: 'light'},
  crystal: {name: '默认夜间', description: '炭灰 · 薄荷 · 无游戏元素', game: false, colorScheme: 'dark'},
  hollow: {name: '空洞骑士', description: '蓝湖 · 雨城 · 小骑士', game: true, colorScheme: 'dark'},
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

/** S1-r3 day/hollow colors; night/silk remain compatible with the earlier UI.
 * CSS contains the same opaque palette. Decorative art is a separate layer. */
export const UI_THEME_PALETTES = {
  day: {canvas:'#f5eee2',surface:'#fffcf7',surfaceMuted:'#eee6d7',text:'#252b26',textSecondary:'#686c61',primary:'#607456',onPrimary:'#ffffff',selection:'#e0e7ce',divider:'#e1ddcf',controlBorder:'#7a877f',focus:'#526647',success:'#246b48',warning:'#825c1c',danger:'#aa3d38',dangerSoft:'#f8e8e5',warningSoft:'#f5eddb'},
  // One-channel lift from #768a7c also keeps the border above 3:1 on selection.
  night: {canvas:'#181d1c',surface:'#202724',surfaceMuted:'#2a332f',text:'#eef1ed',textSecondary:'#aab7af',primary:'#92c8b2',onPrimary:'#14251d',selection:'#2b4135',divider:'#3a453f',controlBorder:'#778b7d',focus:'#b1dec9',success:'#9ad2b2',warning:'#e3c17e',danger:'#f4a69e',dangerSoft:'#452d2c',warningSoft:'#423927'},
  hollow: {canvas:'#0d1420',surface:'#141e2b',surfaceMuted:'#1c2a3b',text:'#e9edf1',textSecondary:'#a3b1c0',primary:'#c6d6e4',onPrimary:'#15202d',selection:'#27384b',divider:'#34465b',controlBorder:'#738ca7',focus:'#bdd7f2',success:'#a0cfb7',warning:'#e1c68c',danger:'#f0a8a4',dangerSoft:'#443039',warningSoft:'#403927'},
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
