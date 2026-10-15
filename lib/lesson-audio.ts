type Clip = {text:string; file:string; sha256?:string};
let bundledSources = new Map<string,string>();
let bundledClips = new Map<string,string>();
let active: ReturnType<typeof createBundledPlayback> | null = null;

// Both entries may register existing packaged clips; callers supply only their shipped assets.
export function installBundledLessonAudio(clips:Clip[]) {
  const next = new Map<string,string>();
  const sources = new Map<string,string>();
  for (const clip of clips) {
    if (!/^[a-f0-9]{20}\.mp3$/.test(clip.file)) throw new Error('Invalid bundled audio filename');
    if (next.has(clip.text)) throw new Error('Duplicate bundled audio text');
    next.set(clip.text, '/audio/offline/' + clip.file);
    sources.set(clip.text,'bundled:'+clip.file+':'+(clip.sha256??clip.file));
  }
  bundledClips = next;bundledSources=sources;
}

export function bundledLessonAudio(text:string) { return bundledClips.get(text) ?? null; }
export function bundledLessonSource(text:string) {return bundledSources.get(text)??null;}
/** Explicit user/navigation boundary: stop every old lesson/TTS/replay before another source. */
export function stopLessonAudio(){
 active?.stop();
 if(typeof window!=='undefined'){window.dispatchEvent(new Event('lantern-stop-lesson-audio'));window.speechSynthesis?.cancel();}
 if(typeof document!=='undefined')document.querySelectorAll('audio,video').forEach(media=>(media as HTMLMediaElement).pause());
}

export function createBundledPlayback(audio:HTMLAudioElement, changed:(playing:boolean)=>void, failed:()=>void) {
  let disposed = false;
  let generation = 0;
  let pendingPosition:number|null=null;
  const stopped = () => {
    generation++;
    if (active === playback) active = null;
    if (!disposed) changed(false);
  };
  const error = () => { stopped(); if (!disposed) failed(); };
  // Media events are queued. A pause/end from an earlier play must not clear a restart.
  const paused = () => { if (audio.paused) stopped(); };
  const ended = () => { if (audio.ended) stopped(); };
  const currentPosition=():number=>pendingPosition??(Number.isFinite(audio.currentTime)?Math.max(0,audio.currentTime):0);
  const playback = {
    play(rate:number,positionSeconds=0) {
      if (disposed) return;
      active?.stop();
      active = playback;
      const token = ++generation;
      audio.playbackRate = rate;
      const position=Number.isFinite(positionSeconds)?Math.max(0,positionSeconds):0;
      pendingPosition=position;
      const seek=()=>{if(disposed||token!==generation)return;try{audio.currentTime=Number.isFinite(audio.duration)?Math.min(position,Math.max(0,audio.duration-.01)):position;if(audio.readyState!==0)pendingPosition=null;}catch{/* metadata may be unavailable; loadedmetadata retries it */}};
      seek();
      if(position>0&&audio.readyState===0)audio.addEventListener('loadedmetadata',seek,{once:true});
      changed(true);
      try {
        void audio.play().catch(() => {
          if (!disposed && token === generation) error();
        });
      } catch { if (!disposed && token === generation) error(); }
    },
    resume(rate:number,positionSeconds=currentPosition()){playback.play(rate,positionSeconds);},
    pause(){playback.stop();return playback.position();},
    position:currentPosition,
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
