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
  paper: {name: '日间', description: '奶油 · 嫩绿 · 柔桃', game: false, colorScheme: 'light'},
  crystal: {name: '夜间', description: '炭灰 · 薄荷 · 无游戏元素', game: false, colorScheme: 'dark'},
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

/** Approved r1 theme tokens, shared with CSS; imagery is a separate layer. */
export const UI_THEME_PALETTES = {
  day: {canvas:'#f4f1e9', surface:'#fffcf7', surfaceMuted:'#e9eddf', text:'#29342b', textSecondary:'#606c5f', primary:'#536c51', onPrimary:'#fffdf7', selection:'#e1e8d6', divider:'#d8dfd2', controlBorder:'#73816d', focus:'#4c6d4f', success:'#246b48', warning:'#825c1c', danger:'#9d3832', dangerSoft:'#f8e8e5', warningSoft:'#f5eddb'},
  night: {canvas:'#121c23', surface:'#1b2932', surfaceMuted:'#253641', text:'#e4eff0', textSecondary:'#afc0c4', primary:'#9cc7ce', onPrimary:'#15252b', selection:'#2b424d', divider:'#3a505d', controlBorder:'#6f8994', focus:'#c0e3e8', success:'#a0d1bd', warning:'#e4c689', danger:'#e8aaa5', dangerSoft:'#482e35', warningSoft:'#443b2c'},
  hollow: {canvas:'#101b29', surface:'#172435', surfaceMuted:'#213044', text:'#edf0ed', textSecondary:'#b0becb', primary:'#efbd75', onPrimary:'#291e12', selection:'#3b3540', divider:'#34485a', controlBorder:'#8093a2', focus:'#f3cd96', success:'#a0cfb7', warning:'#efcf8f', danger:'#f0aaa4', dangerSoft:'#48323d', warningSoft:'#443d2b'},
  silk: {canvas:'#201822', surface:'#2b212d', surfaceMuted:'#362937', text:'#f2e9e4', textSecondary:'#c7b4c5', primary:'#f18b70', onPrimary:'#291712', selection:'#4a3038', divider:'#503c51', controlBorder:'#a889a4', focus:'#ffc0a8', success:'#abd4b9', warning:'#e6c58c', danger:'#f1b1ad', dangerSoft:'#50313c', warningSoft:'#493b2c'},
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
