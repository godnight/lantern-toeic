type Clip = {text:string; file:string; sha256?:string};
let bundledSources = new Map<string,string>();
let bundledClips = new Map<string,string>();
let active: ReturnType<typeof createBundledPlayback> | null = null;
let playbackSequence=0;

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
  const player=++playbackSequence;
  let disposed=false,generation=0,baseline=0,hasBaseline=false,validated=false,requested:number|null=null;
  let cleanupRequest=()=>{},needsReload=false,preparing=false,preparedSource='';
  let pendingEnded=()=>{};
  let diagnostic: (event:string,reason?:string,cause?:unknown)=>void=()=>{};
  const source=()=>audio.currentSrc||audio.src||'';
  let expectedSource='',expectedDeclaredSource='';
  const finitePosition=()=>Number.isFinite(audio.currentTime)?Math.max(0,audio.currentTime):null;
  const sourceMatches=()=>!!expectedSource&&(audio.src||'')===expectedDeclaredSource&&source()===expectedSource;
  const sample=()=>{
    if(requested!==null||!validated||audio.seeking||!sourceMatches())return baseline;
    const actual=finitePosition();if(actual!==null&&actual>=baseline-.25){baseline=Math.max(baseline,actual);hasBaseline=true;}
    return baseline;
  };
  const stopped=()=>{generation++;cleanupRequest();cleanupRequest=()=>{};validated=false;preparing=false;if(active===playback)active=null;if(!disposed)changed(false);};
  const error=(reason:string,cause?:unknown)=>{if(disposed)return;diagnostic('rejected',reason,cause);stopped();audio.pause();failed();};
  const paused=()=>{if(audio.paused&&active===playback&&!preparing){if(audio.ended&&requested!==null){pendingEnded();return;}diagnostic('pause');sample();stopped();}};
  const ended=()=>{if(audio.ended&&active===playback){if(requested!==null){pendingEnded();return;}diagnostic('ended');sample();stopped();}};
  const mediaError=()=>{if(active===playback)error('media-error',audio.error);};
  const begin=(rate:number,positionSeconds:number,restoring:boolean)=>{
    if(disposed)return;
    active?.stop();active=playback;
    const token=++generation;cleanupRequest();
    const target=Number.isFinite(positionSeconds)?Math.max(0,positionSeconds):0;
    if(restoring&&!hasBaseline){baseline=target;hasBaseline=true;}
    requested=target;validated=false;expectedDeclaredSource=audio.src||'';expectedSource=expectedDeclaredSource||source();
    const reload=needsReload||preparedSource!==expectedSource||audio.readyState===0;needsReload=false;preparing=true;
    let stage='metadata',targetPosition=target,started=false,seekAssigned=false,seekComplete=false,seekEventSeen=false,playingSeen=false,startedAt=0,highestStartup:number|null=null;
    let windowAt:number|null=null,playingAt:number|null=null,windowPosition=0,lastProgress:number|null=null,advances=0,interrupted=false;
    let preparedPosition:number|null=null,preparedDuration:number|null=null,firstProgressPosition:number|null=null,firstProgressElapsed:number|null=null,diagnosticCount=0;
    const events:Record<string,number>={};
    const clock=()=>typeof performance!=='undefined'?performance.now():Date.now();
    let seekPoll:ReturnType<typeof setTimeout>|undefined,preparePoll:ReturnType<typeof setTimeout>|undefined,metadataSeen=!reload;
    const valid=()=>!disposed&&token===generation&&active===playback;
    diagnostic=(event,reason,cause)=>{
      if(!valid())return;
      try{
      events[event]=(events[event]||0)+1;
      if(diagnosticCount>=32&&!['rejected','confirmed','confirmed-short-end','stop','pause','ended'].includes(event))return;
      diagnosticCount++;
      const ranges:number[][]=[];
      try{for(let i=0;i<Math.min(audio.seekable?.length||0,8);i++)ranges.push([audio.seekable.start(i),audio.seekable.end(i)]);}catch{/* A transitioning native TimeRanges may be unavailable. */}
      const exception=cause as {name?:unknown;code?:unknown}|undefined;
      const exceptionName=typeof exception?.name==='string'&&/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(exception.name)?exception.name:undefined;
      const exceptionCode=typeof exception?.code==='number'?exception.code:undefined;
      // No URL, lesson text, account, recording or arbitrary exception message is logged.
      console.info('Bundled playback '+JSON.stringify({player,request:token,stage,event,reason,target,targetPosition,current:finitePosition(),baseline,preparedPosition,preparedDuration,firstProgressPosition,firstProgressElapsed,readyState:audio.readyState,duration:audio.duration,seekable:ranges,paused:audio.paused,seeking:audio.seeking,muted:audio.muted,rate:audio.playbackRate,sourceMatches:sourceMatches(),metadataSeen,seekAssigned,seekEventSeen,seekComplete,playingSeen,advances,interrupted,elapsed:started?Math.max(0,clock()-startedAt):0,events,exceptionName,exceptionCode}));
      }catch{/* Diagnostics must not change media control or checkpoint behavior. */}
    };
    const fail=(reason:string,cause?:unknown)=>{if(valid())error(reason,cause);};
    const nearTarget=()=>{const actual=finitePosition();return actual!==null&&Math.abs(actual-targetPosition)<=1;};
    const validStartPosition=()=>{
      const actual=finitePosition(),elapsed=Math.max(0,clock()-startedAt)/1000;
      if(actual===null||actual<targetPosition-1||actual>targetPosition+1+elapsed*Math.max(0,rate)||(highestStartup!==null&&actual<highestStartup-1))return false;
      highestStartup=highestStartup===null?actual:Math.max(highestStartup,actual);return true;
    };
    const accept=()=>{
      if(requested===null||!valid()||!seekComplete||!playingSeen||windowAt===null||advances<3||clock()-windowAt<750||audio.paused||audio.seeking||!sourceMatches())return;
      const actual=finitePosition();
      if(actual===null||lastProgress===null||actual<lastProgress-.025||actual-windowPosition<Math.max(.05,rate*.5))return;
      if(!validStartPosition()){fail('startup-position');return;}
      requested=null;baseline=actual;hasBaseline=true;validated=true;stage='playing';
      clearTimeout(timeout);diagnostic('confirmed');confirmed?.();
    };
    const playing=()=>{if(!valid()||!started||requested===null)return;diagnostic('playing');playingSeen=true;if(playingAt===null)playingAt=clock();if(!validStartPosition()||!sourceMatches()){fail('playing-position');return;}accept();};
    const progress=()=>{
      if(!valid()||!started||audio.paused||audio.seeking)return;
      if(requested!==null){
        if(!playingSeen){diagnostic('timeupdate');return;}
        if(firstProgressPosition===null&&finitePosition()!>(preparedPosition??Infinity)+.001){firstProgressPosition=finitePosition();firstProgressElapsed=Math.max(0,clock()-startedAt);}
        diagnostic('timeupdate');
        if(!validStartPosition()||!sourceMatches()){fail('progress-position');return;}
        const actual=finitePosition()!;
        if(windowAt===null){windowAt=clock();windowPosition=actual;lastProgress=actual;advances=0;}
        else if(actual>(lastProgress??actual)+.001){lastProgress=actual;advances++;}
        accept();return;
      }
      const actual=finitePosition();if(actual===null||!sourceMatches()||actual<baseline-1){fail('confirmed-position');return;}baseline=Math.max(baseline,actual);
    };
    const start=()=>{
      if(!valid()||started||!seekComplete)return;
      if(!audio.paused||audio.seeking||!sourceMatches()||!nearTarget()){fail('not-prepared-paused');return;}
      preparing=false;started=true;startedAt=clock();preparedPosition=finitePosition();preparedDuration=audio.duration;stage='confirming-progress';
      if(preparePoll!==undefined){clearTimeout(preparePoll);preparePoll=undefined;}
      try{audio.playbackRate=rate;diagnostic('play');void audio.play().then(()=>{if(valid())diagnostic('play-resolved');},cause=>fail('play-rejected',cause));}catch(cause){fail('play-threw',cause);}
    };
    const seeked=()=>{
      if(seekPoll!==undefined){clearTimeout(seekPoll);seekPoll=undefined;}
      if(!valid()||!seekAssigned||!seekEventSeen||requested===null||started)return;
      // ArkWeb may dispatch seeked before clearing its seeking flag. The genuine event
      // starts a bounded wait; do not mistake that transitional state for a failed seek.
      if(audio.seeking){seekPoll=setTimeout(seeked,25);return;}
      if(!audio.paused||!nearTarget()||!sourceMatches()){fail('paused-seek-position');return;}
      seekComplete=true;diagnostic('seek-settled');start();
    };
    const onSeeked=()=>{if(!valid()||!seekAssigned||started)return;seekEventSeen=true;diagnostic('seeked');seeked();};
    const ready=()=>{
      if(!valid())return;
      if((audio.src||'')!==expectedDeclaredSource){fail('source-changed');return;}
      if(seekAssigned||started)return;
      if(!metadataSeen||audio.readyState===0||!Number.isFinite(audio.duration)||audio.duration<=0)return;
      if(!sourceMatches()){fail('metadata-source');return;}
      if(!audio.paused){fail('preparation-not-paused');return;}
      if(audio.seeking)return;
      preparedSource=expectedSource;
      if(target===0){
        targetPosition=0;
        if(!audio.seeking&&Math.abs(finitePosition()??Infinity)<.025){seekComplete=true;start();return;}
      }else{
        // A Continue request never turns an ended track into a restart.
        targetPosition=Math.min(target,Math.max(0,audio.duration-.01));
      }
      // An empty seekable range is observed, not a permanent prerequisite for a paused seek.
      // A setter echo is never proof: only a real seeked, same source and settled position may play.
      stage='paused-seek';seekAssigned=true;diagnostic('seek-request');
      if(preparePoll!==undefined){clearTimeout(preparePoll);preparePoll=undefined;}
      try{audio.currentTime=targetPosition;}catch(cause){fail('seek-threw',cause);}
    };
    const metadata=()=>{if(!valid())return;metadataSeen=true;diagnostic('loadedmetadata');ready();};
    const available=(event:Event)=>{diagnostic(event.type);ready();};
    const wait=(event:Event)=>{if(!valid()||!started)return;if(playingAt!==null)interrupted=true;diagnostic(event.type);if(requested!==null){playingSeen=false;windowAt=null;lastProgress=null;advances=0;}};
    const aborted=()=>{if(!valid())return;diagnostic('abort');if(!preparing||metadataSeen)fail('media-aborted');};
    const emptied=()=>{if(!valid())return;diagnostic('emptied');if(started)fail('media-emptied');};
    const poll=()=>{if(!valid()||started||seekAssigned)return;ready();if(valid()&&!started&&!seekAssigned)preparePoll=setTimeout(poll,100);};
    const timeout=setTimeout(()=>fail('confirmation-timeout'),10000);
    pendingEnded=()=>{
      if(!valid())return;
      const actual=finitePosition(),duration=audio.duration,elapsed=playingAt===null?0:Math.max(0,clock()-playingAt);
      const remaining=preparedPosition===null||preparedDuration===null?Infinity:preparedDuration-preparedPosition;
      const expectedMs=rate>0?remaining/rate*1000:Infinity;
      // A fully observed short remainder may end before the normal confirmation window.
      // A first-point jump, instant ended, interrupted startup or a long-track ended is not proof.
      if(!started||!seekComplete||!playingSeen||interrupted||audio.seeking||!sourceMatches()||!Number.isFinite(duration)||duration<=0||preparedDuration===null||Math.abs(duration-preparedDuration)>.01||actual===null||preparedPosition===null||remaining<=.02||expectedMs>1500||firstProgressPosition===null||firstProgressElapsed===null||firstProgressPosition<=preparedPosition+.001||actual<=firstProgressPosition+.001||actual<duration-.05||actual>duration+.05||elapsed<expectedMs*.8||!validStartPosition()){
        fail('ended-before-confirmation');return;
      }
      requested=null;baseline=actual;hasBaseline=true;validated=true;stage='playing';clearTimeout(timeout);diagnostic('confirmed-short-end');confirmed?.();diagnostic('ended');stopped();
    };
    audio.addEventListener('loadedmetadata',metadata);
    audio.addEventListener('canplay',available);audio.addEventListener('progress',available);audio.addEventListener('durationchange',available);
    audio.addEventListener('seeked',onSeeked);audio.addEventListener('playing',playing);audio.addEventListener('timeupdate',progress);
    audio.addEventListener('waiting',wait);audio.addEventListener('stalled',wait);audio.addEventListener('abort',aborted);audio.addEventListener('emptied',emptied);
    cleanupRequest=()=>{clearTimeout(timeout);if(preparePoll!==undefined)clearTimeout(preparePoll);if(seekPoll!==undefined)clearTimeout(seekPoll);audio.removeEventListener('loadedmetadata',metadata);audio.removeEventListener('canplay',available);audio.removeEventListener('progress',available);audio.removeEventListener('durationchange',available);audio.removeEventListener('seeked',onSeeked);audio.removeEventListener('playing',playing);audio.removeEventListener('timeupdate',progress);audio.removeEventListener('waiting',wait);audio.removeEventListener('stalled',wait);audio.removeEventListener('abort',aborted);audio.removeEventListener('emptied',emptied);};
    changed(true);diagnostic('begin');if(reload){try{audio.preload='auto';diagnostic('load');audio.load();}catch(cause){fail('load-threw',cause);return;}}poll();
  };
  const playback={
    play(rate:number,positionSeconds=0){begin(rate,positionSeconds,false);},
    resume(rate:number,positionSeconds=sample()){begin(rate,positionSeconds,true);},
    pause(reload=false){if(reload)needsReload=true;playback.stop();return baseline;},
    position:sample,
    stop(){if(disposed)return;diagnostic('stop');sample();stopped();audio.pause();},
    dispose(){playback.stop();disposed=true;audio.removeEventListener('pause',paused);audio.removeEventListener('ended',ended);audio.removeEventListener('error',mediaError);},
  };
  audio.addEventListener('pause',paused);audio.addEventListener('ended',ended);audio.addEventListener('error',mediaError);
  return playback;
}
