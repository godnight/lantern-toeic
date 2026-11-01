import { createBundledPlayback } from './lesson-audio';

type InnerPlayback = ReturnType<typeof createBundledPlayback>;
type AudioLease = {
  audio: HTMLAudioElement;
  inner: InnerPlayback;
  action: number;
  confirmed: boolean;
  live: boolean;
  timeupdate: () => void;
};

/** A stable logical checkpoint over a fresh DOM media resource for each explicit action. */
export function createExplicitBundledPlayback(
  createAudio: () => HTMLAudioElement,
  changed: (playing: boolean) => void,
  failed: () => void,
  confirmed?: () => void,
  tick?: (position: number) => void
) {
  let disposed = false, generation = 0, baseline = 0, hasBaseline = false;
  let current: AudioLease | null = null;
  const valid = (lease: AudioLease) =>
    !disposed && current === lease && lease.live && lease.action === generation;
  const snapshot = (lease = current) => {
    // A fresh inner replay begins at zero. Until confirmation it has no checkpoint ownership.
    if (lease && current === lease && lease.confirmed) {
      const actual = lease.inner.position();
      if (Number.isFinite(actual) && actual >= 0) {
        baseline = actual;
        hasBaseline = true;
      }
    }
    return baseline;
  };
  const releaseAudio = (audio: HTMLAudioElement) => {
    // Run every release step even if a platform operation fails.
    let problem: unknown;
    for (const release of [
      () => audio.pause(),
      () => audio.removeAttribute('src'),
      () => audio.load(),
      () => audio.remove()
    ]) {
      try { release(); } catch (cause) { problem ??= cause; }
    }
    if (problem) throw problem;
  };
  const retire = (lease: AudioLease | null) => {
    if (!lease) return;
    lease.live = false;
    if (current === lease) current = null;
    let problem: unknown;
    try { lease.audio.removeEventListener('timeupdate', lease.timeupdate); } catch (cause) { problem = cause; }
    try { lease.inner.dispose(); } catch (cause) { problem ??= cause; }
    try { releaseAudio(lease.audio); } catch (cause) { problem ??= cause; }
    if (problem) throw problem;
  };
  const begin = (restart: boolean, rate: number, target: number) => {
    if (disposed) return;
    snapshot();
    const action = ++generation;
    if (!restart && !hasBaseline) {
      baseline = Number.isFinite(target) ? Math.max(0, target) : 0;
      hasBaseline = true;
    }
    const old = current;
    try { retire(old); } catch {
      if (!disposed && action === generation) { changed(false); if (!disposed && action === generation) failed(); }
      return;
    }
    if (disposed || action !== generation) return;
    let audio: HTMLAudioElement;
    try { audio = createAudio(); } catch {
      if (!disposed && action === generation) { changed(false); if (!disposed && action === generation) failed(); }
      return;
    }
    if (disposed || action !== generation) { releaseAudio(audio); return; }
    const lease: AudioLease = {
      audio, action, confirmed: false, live: true,
      inner: null as unknown as InnerPlayback,
      timeupdate: () => { if (valid(lease)) tick?.(snapshot(lease)); }
    };
    current = lease;
    lease.inner = createBundledPlayback(audio,
      value => {
        if (!valid(lease)) return;
        if (!value) snapshot(lease);
        changed(value);
      },
      () => {
        if (!valid(lease)) return;
        snapshot(lease);
        lease.live = false;
        failed();
      },
      () => {
        if (!valid(lease)) return;
        lease.confirmed = true;
        snapshot(lease);
        confirmed?.();
      });
    audio.addEventListener('timeupdate', lease.timeupdate);
    if (restart) lease.inner.play(rate, target);
    else lease.inner.resume(rate, target);
  };
  const halt = (reload = false) => {
    if (disposed) return baseline;
    const position = snapshot(), lease = current;
    const action = ++generation;
    if (lease) {
      lease.live = false;
      lease.inner.pause(reload);
    }
    // Inner callbacks from the stopped action are already invalid. Notify only this halt.
    if (!disposed && action === generation) changed(false);
    return position;
  };
  return {
    play(rate: number, target = 0) { begin(true, rate, target); },
    resume(rate: number, target = snapshot()) { begin(false, rate, target); },
    pause(reload = false) { return halt(reload); },
    position() { return snapshot(); },
    completed() { const lease=current;return !!lease&&valid(lease)&&lease.confirmed&&lease.inner.completed(); },
    duration() { const duration=current?.audio.duration;return typeof duration==='number'&&Number.isFinite(duration)&&duration>0?duration:0; },
    seek(target: number) {
      if(disposed||!Number.isFinite(target)||target<0)return;
      const duration=current?.audio.duration;
      const bounded=typeof duration==='number'&&Number.isFinite(duration)&&duration>0?Math.min(target,duration):target;
      const lease=current;halt();retire(lease);baseline=bounded;hasBaseline=true;tick?.(baseline);
    },
    stop() { halt(); },
    dispose() {
      if (disposed) return;
      snapshot();
      disposed = true;
      generation++;
      retire(current);
    }
  };
}
