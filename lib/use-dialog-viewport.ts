'use client';

import {useEffect, useState, type CSSProperties} from 'react';

type Viewport = {left: number; top: number; width: number; height: number};

// Local to the speaking portals: never change the document viewport or other dialogs.
export function useDialogViewport() {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  useEffect(() => {
    const visual = window.visualViewport;
    const update = () => {
      const width = visual?.width ?? window.innerWidth;
      const height = visual?.height ?? window.innerHeight;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      const next = {left: Math.max(0, visual?.offsetLeft ?? 0), top: Math.max(0, visual?.offsetTop ?? 0), width, height};
      setViewport(previous => previous && Object.keys(next).every(key => previous[key as keyof Viewport] === next[key as keyof Viewport]) ? previous : next);
    };
    update();
    window.addEventListener?.('resize', update);
    visual?.addEventListener?.('resize', update);
    visual?.addEventListener?.('scroll', update);
    return () => {
      window.removeEventListener?.('resize', update);
      visual?.removeEventListener?.('resize', update);
      visual?.removeEventListener?.('scroll', update);
    };
  }, []);
  return (maxWidth: number, fullOnNarrow = false): CSSProperties | undefined => {
    if (!viewport) return undefined;
    const gutter = fullOnNarrow && viewport.width <= 700 ? 0 : Math.min(24, viewport.width / 16, viewport.height / 16);
    const width = Math.min(maxWidth, viewport.width - gutter * 2);
    return {
      '--speaking-dialog-left': `${viewport.left + (viewport.width - width) / 2}px`,
      '--speaking-dialog-top': `${viewport.top + gutter}px`,
      '--speaking-dialog-width': `${width}px`,
      '--speaking-dialog-height': `${viewport.height - gutter * 2}px`,
    } as CSSProperties;
  };
}
