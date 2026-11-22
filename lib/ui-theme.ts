import type {Theme} from '@/lib/study-model';

/** Display names are separate from persisted Theme IDs. */
export type UiTheme = 'day' | 'night' | 'hollow' | 'silk' | 'whale-bay' | 'whale-moon';

export const UI_THEME_BY_PERSISTED = {
  paper: 'day',
  crystal: 'night',
  hollow: 'hollow',
  silk: 'silk',
  'whale-bay': 'whale-bay',
  'whale-moon': 'whale-moon',
} as const satisfies Record<Theme, UiTheme>;

export const UI_THEME_ORDER = ['paper', 'crystal', 'hollow', 'silk', 'whale-bay', 'whale-moon'] as const satisfies readonly Theme[];

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
  'whale-bay': {name: '咕噜海湾', description: '奶油白 · 海盐蓝 · 晨间小窝', game: false, colorScheme: 'light'},
  'whale-moon': {name: '澜音星海', description: '深海蓝 · 月白 · 夜间阅读角', game: false, colorScheme: 'dark'},
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
  day: {canvas:'#f5f5f5', surface:'#ffffff', surfaceMuted:'#eeeeed', text:'#252626', textSecondary:'#646966', primary:'#303331', onPrimary:'#ffffff', selection:'#e7ebe8', divider:'#e1e3e2', controlBorder:'#858a87', focus:'#4c6d5b', success:'#246b48', warning:'#825c1c', danger:'#9d3832', dangerSoft:'#f8e8e5', warningSoft:'#f5eddb'},
  night: {canvas:'#181a19', surface:'#222524', surfaceMuted:'#2c302e', text:'#edf0ee', textSecondary:'#afb5b1', primary:'#dce5df', onPrimary:'#222524', selection:'#343b37', divider:'#3b413d', controlBorder:'#838a85', focus:'#c0d5c8', success:'#a0d1bd', warning:'#e4c689', danger:'#e8aaa5', dangerSoft:'#482e35', warningSoft:'#443b2c'},
  hollow: {canvas:'#101820', surface:'#19252f', surfaceMuted:'#202c36', text:'#ecf1f4', textSecondary:'#a9b6c2', primary:'#b6d5e9', onPrimary:'#10212f', selection:'#263b4b', divider:'#303b46', controlBorder:'#8093a2', focus:'#b6d5e9', success:'#a0cfb7', warning:'#efcf8f', danger:'#f0aaa4', dangerSoft:'#48323d', warningSoft:'#443d2b'},
  silk: {canvas:'#201822', surface:'#2b212d', surfaceMuted:'#362937', text:'#f2e9e4', textSecondary:'#c7b4c5', primary:'#f18b70', onPrimary:'#291712', selection:'#4a3038', divider:'#503c51', controlBorder:'#a889a4', focus:'#ffc0a8', success:'#abd4b9', warning:'#e6c58c', danger:'#f1b1ad', dangerSoft:'#50313c', warningSoft:'#493b2c'},
  'whale-bay': {canvas:'#f4f1e9', surface:'#fffdf8', surfaceMuted:'#e5eef1', text:'#213642', textSecondary:'#536873', primary:'#285f79', onPrimary:'#ffffff', selection:'#d6e8ee', divider:'#cbd9dd', controlBorder:'#728a95', focus:'#1d658d', success:'#246b48', warning:'#825c1c', danger:'#9d3832', dangerSoft:'#f8e8e5', warningSoft:'#f5eddb'},
  'whale-moon': {canvas:'#0f1b30', surface:'#17263e', surfaceMuted:'#24364f', text:'#edf3f9', textSecondary:'#afbfd3', primary:'#c5def2', onPrimary:'#13233a', selection:'#2c4663', divider:'#3c506b', controlBorder:'#8199b7', focus:'#9ccff2', success:'#a0d1bd', warning:'#e4c689', danger:'#e8aaa5', dangerSoft:'#482e35', warningSoft:'#443b2c'},
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
