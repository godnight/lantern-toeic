type Clip = {text:string; file:string};
let bundledClips = new Map<string,string>();
let active: ReturnType<typeof createBundledPlayback> | null = null;

// Only the native entry registers the packaged recordings. Web retains system TTS.
export function installBundledLessonAudio(clips:Clip[]) {
  const next = new Map<string,string>();
  for (const clip of clips) {
    if (!/^[a-f0-9]{20}\.mp3$/.test(clip.file)) throw new Error('Invalid bundled audio filename');
    if (next.has(clip.text)) throw new Error('Duplicate bundled audio text');
    next.set(clip.text, '/audio/offline/' + clip.file);
  }
  bundledClips = next;
}

export function bundledLessonAudio(text:string) { return bundledClips.get(text) ?? null; }

export function createBundledPlayback(audio:HTMLAudioElement, changed:(playing:boolean)=>void, failed:()=>void) {
  let disposed = false;
  let generation = 0;
  const stopped = () => {
    generation++;
    if (active === playback) active = null;
    if (!disposed) changed(false);
  };
  const error = () => { stopped(); if (!disposed) failed(); };
  // Media events are queued. A pause/end from an earlier play must not clear a restart.
  const paused = () => { if (audio.paused) stopped(); };
  const ended = () => { if (audio.ended) stopped(); };
  const playback = {
    play(rate:number) {
      if (disposed) return;
      active?.stop();
      active = playback;
      const token = ++generation;
      audio.playbackRate = rate;
      audio.currentTime = 0;
      changed(true);
      try {
        void audio.play().catch(() => {
          if (!disposed && token === generation) error();
        });
      } catch { if (!disposed && token === generation) error(); }
    },
    stop() {
      if (disposed) return;
      stopped();
      audio.pause();
    },
    dispose() {
      playback.stop();
      disposed = true;
      audio.removeEventListener('pause', paused);
      audio.removeEventListener('ended', ended);
      audio.removeEventListener('error', error);
    },
  };
  audio.addEventListener('pause', paused);
  audio.addEventListener('ended', ended);
  audio.addEventListener('error', error);
  return playback;
}
