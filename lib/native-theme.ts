import {isNativeForeground,subscribeNativeState} from './native-host';
import type {Theme} from './study-model';

declare global {
  interface Window {
    LanternThemeHost?: {apply: (theme: string) => string};
    __LANTERN_THEME_SYNC__?: () => boolean;
  }
}

// Only the packaged main document can ask the native window to update. The
// host independently verifies the calling frame, lifecycle and allowlist.
let nativeStateConfirmed=false;
type ThemePermit={theme:Theme|null;canSync:()=>boolean};
let permit:ThemePermit|null=null;
function trustedMainDocument(): boolean {
  if(typeof window==='undefined'||typeof document==='undefined')return false;
  try{return window.top===window&&window.location.origin==='https://lantern.local'&&window.location.pathname==='/';}
  catch{return false;}
}

function persistedTheme(uiTheme:string|undefined):Theme|null {
  switch(uiTheme){
    case 'day':return 'paper';
    case 'night':return 'crystal';
    case 'hollow':return 'hollow';
    case 'silk':return 'silk';
    case 'whale-bay':return 'whale-bay';
    case 'whale-moon':return 'whale-moon';
    default:return null;
  }
}

/** Re-send only the theme already applied to both document roots.
 * true means the native host accepted the request, not that the OS applied it. */
export function syncAppliedNativeTheme():boolean {
  if(!trustedMainDocument())return false;
  try{
    if(!nativeStateConfirmed||!isNativeForeground()||document.visibilityState!=='visible')return false;
    const uiTheme=document.documentElement?.dataset.uiTheme;
    if(!uiTheme||document.body?.dataset.uiTheme!==uiTheme)return false;
    const theme=persistedTheme(uiTheme),host=window.LanternThemeHost;
    if(!theme||!permit||(permit.theme!==null&&permit.theme!==theme)||!permit.canSync()||!host||typeof host.apply!=='function')return false;
    return host.apply(theme)==='ACCEPTED';
  }catch{return false;}
}

/** Permit only a verified account's loaded preference, or a confirmed account page.
 * The returned cleanup cannot revoke a newer owner's permit. */
export function permitNativeTheme(theme:Theme,canSync:()=>boolean):()=>void {
  const granted:ThemePermit={theme,canSync};permit=granted;
  syncAppliedNativeTheme();
  return ()=>{if(permit===granted)permit=null;};
}

/** A confirmed signed-out account page retains whichever theme it renders. */
export function permitCurrentNativeTheme(canSync:()=>boolean):()=>void {
  // The 401 proof may arrive before the default DOM theme is initialized.
  const granted:ThemePermit={theme:null,canSync};permit=granted;
  syncAppliedNativeTheme();
  return ()=>{if(permit===granted)permit=null;};
}

export function revokeNativeTheme():void {permit=null;}

/** The native host calls this again after its bridge becomes ready or resumes. */
export function installNativeThemeSync():void {
  if(!trustedMainDocument()||window.__LANTERN_THEME_SYNC__)return;
  window.__LANTERN_THEME_SYNC__=syncAppliedNativeTheme;
  // subscribeNativeState immediately emits its default; only a subsequent
  // native onAppState signal proves that the host has supplied a lifecycle.
  let subscribed=false;
  const unsubscribe=subscribeNativeState(foreground=>{
    if(!subscribed)return;
    nativeStateConfirmed=true;
    if(foreground)syncAppliedNativeTheme();else revokeNativeTheme();
  });
  subscribed=true;
  // Native onActive can make the document visible after bridge-ready resync.
  // Retry on that actual transition, with all normal trust checks still active.
  const visibilityChanged=()=>{if(document.visibilityState==='visible')syncAppliedNativeTheme();else revokeNativeTheme();};
  document.addEventListener('visibilitychange',visibilityChanged);
  const pageHidden=(event:PageTransitionEvent)=>{
    if(event.persisted)return;
    revokeNativeTheme();unsubscribe();document.removeEventListener('visibilitychange',visibilityChanged);
    window.removeEventListener('pagehide',pageHidden);nativeStateConfirmed=false;
    if(window.__LANTERN_THEME_SYNC__===syncAppliedNativeTheme)delete window.__LANTERN_THEME_SYNC__;
  };
  window.addEventListener('pagehide',pageHidden);
}
