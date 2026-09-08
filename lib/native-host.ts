type BackHandler = { priority: number; handle: () => boolean };
const backHandlers = new Set<BackHandler>();
const stateListeners = new Set<(foreground: boolean) => void>();
let foreground = true;

declare global {
  interface Window {
    __LANTERN_HARMONY__?: {
      onAppState: (value: boolean) => boolean;
      onBackPress: () => boolean;
    };
  }
}

export function isNativeForeground() { return foreground; }

export function subscribeNativeState(listener: (foreground: boolean) => void) {
  stateListeners.add(listener);
  listener(foreground);
  return () => { stateListeners.delete(listener); };
}

export function registerNativeBack(handle: () => boolean, priority = 0) {
  const handler = { handle, priority };
  backHandlers.add(handler);
  return () => { backHandlers.delete(handler); };
}

// Only the packaged HarmonyOS entry installs this one-way, fixed protocol.
// It exposes no filesystem, network, identity or arbitrary native operations.
export function installHarmonyHost() {
  if (window.location.origin !== 'https://lantern.local' || window.__LANTERN_HARMONY__) return;
  window.__LANTERN_HARMONY__ = {
    onAppState(value) {
      if (typeof value !== 'boolean') return false;
      foreground = value;
      for (const listener of stateListeners) {
        try { listener(value); } catch { /* Other consumers must still pause. */ }
      }
      if (!value) {
        window.speechSynthesis?.cancel();
        document.querySelectorAll('audio,video').forEach(media => (media as HTMLMediaElement).pause());
      }
      return true;
    },
    onBackPress() {
      if (!foreground || !backHandlers.size) return true;
      for (const handler of [...backHandlers].sort((a, b) => b.priority - a.priority)) {
        try { if (handler.handle()) return true; } catch { return true; }
      }
      return false;
    }
  };
  // Preserve a real tapped navigation for ArkWeb onLoadIntercept. A new window
  // can vary by ArkWeb version, so ordinary resource links navigate in one frame.
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    if (link instanceof HTMLAnchorElement && link.protocol === 'https:') link.target = '_self';
  }, true);
}
