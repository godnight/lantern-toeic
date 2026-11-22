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
    if(!theme||!host||typeof host.apply!=='function')return false;
    return host.apply(theme)==='ACCEPTED';
  }catch{return false;}
}

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
    if(foreground)syncAppliedNativeTheme();
  });
  subscribed=true;
  // Native onActive can make the document visible after bridge-ready resync.
  // Retry on that actual transition, with all normal trust checks still active.
  const visibilityChanged=()=>{if(document.visibilityState==='visible')syncAppliedNativeTheme();};
  document.addEventListener('visibilitychange',visibilityChanged);
  const pageHidden=(event:PageTransitionEvent)=>{
    if(event.persisted)return;
    unsubscribe();document.removeEventListener('visibilitychange',visibilityChanged);
    window.removeEventListener('pagehide',pageHidden);nativeStateConfirmed=false;
    if(window.__LANTERN_THEME_SYNC__===syncAppliedNativeTheme)delete window.__LANTERN_THEME_SYNC__;
  };
  window.addEventListener('pagehide',pageHidden);
}
