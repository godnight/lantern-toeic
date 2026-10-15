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

export function createBundledPlayback(audio:HTMLAudioElement, changed:(playing:boolean)=>void, failed:()=>void, confirmed?:()=>void) {
  let disposed=false,generation=0,baseline=0,hasBaseline=false,validated=false,requested:number|null=null;
  let cleanupRequest=()=>{},releaseSound=()=>{},needsReload=false,reloading=false;
  const source=()=>audio.currentSrc||audio.src||'';
  let expectedSource='';
  const finitePosition=()=>Number.isFinite(audio.currentTime)?Math.max(0,audio.currentTime):null;
  const sourceMatches=()=>!expectedSource||source()===expectedSource;
  const sample=()=>{
    if(requested!==null||!validated||audio.seeking||!sourceMatches())return baseline;
    const actual=finitePosition();if(actual!==null&&actual>=baseline-.25){baseline=Math.max(baseline,actual);hasBaseline=true;}
    return baseline;
  };
  const stopped=()=>{generation++;cleanupRequest();cleanupRequest=()=>{};validated=false;reloading=false;if(active===playback)active=null;if(!disposed)changed(false);};
  const error=()=>{if(disposed)return;console.warn('Bundled playback rejected '+JSON.stringify({actual:finitePosition(),baseline,requested,paused:audio.paused,seeking:audio.seeking,rate:audio.playbackRate,readyState:audio.readyState,duration:audio.duration}));stopped();audio.pause();releaseSound();failed();};
  const paused=()=>{if(audio.paused&&active===playback&&!reloading){sample();stopped();releaseSound();}};
  const ended=()=>{if(audio.ended&&active===playback){sample();stopped();releaseSound();}};
  const mediaError=()=>{if(active===playback)error();};
  const begin=(rate:number,positionSeconds:number,restoring:boolean)=>{
    if(disposed)return;
    active?.stop();active=playback;
    const token=++generation;cleanupRequest();const reload=needsReload;needsReload=false;reloading=reload;
    const target=Number.isFinite(positionSeconds)?Math.max(0,positionSeconds):0;
    if(restoring&&!hasBaseline){baseline=target;hasBaseline=true;}
    requested=target;validated=false;expectedSource=source();
    const originalMuted=audio.muted;audio.muted=true;releaseSound=()=>{audio.muted=originalMuted;releaseSound=()=>{};};
    let targetPosition=target,started=false,seekAssigned=false,seekComplete=false,playingSeen=false,progressSeen=false,startedAt=0,highestStartup:number|null=null;
    const clock=()=>typeof performance!=='undefined'?performance.now():Date.now();
    let seekPoll:ReturnType<typeof setTimeout>|undefined,reloadMetadataSeen=!reload;
    const valid=()=>!disposed&&token===generation&&active===playback;
    const fail=()=>{if(valid())error();};
    const nearTarget=()=>{const actual=finitePosition();return actual!==null&&Math.abs(actual-targetPosition)<=1;};
    const validStartPosition=()=>{
      const actual=finitePosition(),elapsed=Math.max(0,clock()-startedAt)/1000;
      if(actual===null||actual<targetPosition-1||actual>targetPosition+1+elapsed*Math.max(0,rate)||(highestStartup!==null&&actual<highestStartup-1))return false;
      highestStartup=highestStartup===null?actual:Math.max(highestStartup,actual);return true;
    };
    const accept=()=>{
      if(requested===null||!valid()||!seekComplete||!playingSeen||!progressSeen||audio.paused||audio.seeking||!sourceMatches())return;
      if(!validStartPosition()){fail();return;}
      const actual=finitePosition()!;requested=null;baseline=actual;hasBaseline=true;validated=true;
      clearTimeout(timeout);releaseSound();confirmed?.();
    };
    const playing=()=>{if(!valid()||!started||requested===null)return;playingSeen=true;if(!seekComplete||audio.seeking)return;if(!validStartPosition()||!sourceMatches()){fail();return;}accept();};
    const progress=()=>{
      if(!valid()||!started||audio.paused||audio.seeking)return;
      if(requested!==null){if(!seekComplete)return;progressSeen=true;if(!validStartPosition()||!sourceMatches()){fail();return;}accept();return;}
      const actual=finitePosition();if(actual===null||!sourceMatches()||actual<baseline-1){fail();return;}baseline=Math.max(baseline,actual);
    };
    const start=()=>{
      if(!valid()||started||(!seekAssigned&&!seekComplete))return;started=true;startedAt=clock();
      try{audio.playbackRate=rate;void audio.play().then(()=>{if(valid()&&requested!==null){playingSeen=true;if(seekComplete&&!audio.seeking){if(!validStartPosition()||!sourceMatches())fail();else accept();}}},fail);}catch{fail();}
    };
    const seeked=()=>{
      if(seekPoll!==undefined){clearTimeout(seekPoll);seekPoll=undefined;}
      if(!valid()||!seekAssigned||requested===null)return;
      // ArkWeb may dispatch seeked before clearing its seeking flag. The genuine event
      // starts a bounded wait; do not mistake that transitional state for a failed seek.
      if(audio.seeking){seekPoll=setTimeout(seeked,25);return;}
      if(!nearTarget()||!sourceMatches()){fail();return;}
      seekComplete=true;start();
    };
    const ready=()=>{
      if(!valid()||seekAssigned||started)return;
      if(reloading){if(!reloadMetadataSeen||audio.readyState===0)return;reloading=false;}
      if(target===0){
        targetPosition=0;
        if(!audio.seeking&&Math.abs(finitePosition()??Infinity)<.025){seekComplete=true;start();return;}
        if(audio.readyState===0)return;
        seekAssigned=true;try{audio.currentTime=0;start();}catch{fail();}return;
      }
      if(audio.readyState===0||!Number.isFinite(audio.duration)||audio.duration<=0)return;
      // A Continue request never turns an ended track into a restart.
      targetPosition=Math.min(target,Math.max(0,audio.duration-.01));
      let seekable=false;for(let i=0;i<(audio.seekable?.length||0);i++){if(audio.seekable.start(i)<=targetPosition&&audio.seekable.end(i)>=targetPosition){seekable=true;break;}}
      if(!seekable)return;
      if(!audio.seeking&&Math.abs((finitePosition()??-Infinity)-targetPosition)<.025){seekComplete=true;start();return;}
      seekAssigned=true;
      try{audio.currentTime=targetPosition;start();}catch{fail();}
    };
    const metadata=()=>{reloadMetadataSeen=true;ready();};
    const timeout=setTimeout(fail,10000);
    audio.addEventListener('loadedmetadata',metadata);audio.addEventListener('canplay',ready);audio.addEventListener('progress',ready);audio.addEventListener('durationchange',ready);
    audio.addEventListener('seeked',seeked);audio.addEventListener('playing',playing);audio.addEventListener('timeupdate',progress);
    cleanupRequest=()=>{clearTimeout(timeout);if(seekPoll!==undefined){clearTimeout(seekPoll);seekPoll=undefined;}audio.removeEventListener('loadedmetadata',metadata);audio.removeEventListener('canplay',ready);audio.removeEventListener('progress',ready);audio.removeEventListener('durationchange',ready);audio.removeEventListener('seeked',seeked);audio.removeEventListener('playing',playing);audio.removeEventListener('timeupdate',progress);};
    changed(true);if(reload){try{audio.load();}catch{fail();return;}}ready();
  };
  const playback={
    play(rate:number,positionSeconds=0){begin(rate,positionSeconds,false);},
    resume(rate:number,positionSeconds=sample()){begin(rate,positionSeconds,true);},
    pause(reload=false){if(reload)needsReload=true;playback.stop();return baseline;},
    position:sample,
    stop(){if(disposed)return;sample();stopped();audio.pause();releaseSound();},
    dispose(){playback.stop();disposed=true;audio.removeEventListener('pause',paused);audio.removeEventListener('ended',ended);audio.removeEventListener('error',mediaError);},
  };
  audio.addEventListener('pause',paused);audio.addEventListener('ended',ended);audio.addEventListener('error',mediaError);
  return playback;
}
