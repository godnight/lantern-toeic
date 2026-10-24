import naturalManifest from '../content/natural-audio-manifest.json';
import type {NaturalAudioSelector} from './natural-audio';
import {naturalAudioCatalogRegistry as naturalAudioRegistry} from './natural-audio-catalog';
export {naturalAudioCatalogRegistry as naturalAudioRegistry} from './natural-audio-catalog';
let naturalPreparation:Promise<{status:'ready'|'failed'|'superseded';reason?:string}>|null=null;
let localCandidateAudioAuthorized=false;
/** Root explicitly opts this private candidate in; no publication approval is implied. */
export function prepareProductLessonAudio(options:{allowLocalCandidate?:boolean}={}){
  localCandidateAudioAuthorized=options.allowLocalCandidate===true;
  if(naturalPreparation)return naturalPreparation;
  if(naturalAudioRegistry.getSnapshot().phase==='ready')return Promise.resolve({status:'ready' as const});
  const promise=naturalAudioRegistry.activate(naturalManifest,{allowLocalCandidate:localCandidateAudioAuthorized});
  naturalPreparation=promise;
  void promise.finally(()=>{if(naturalPreparation===promise)naturalPreparation=null;});
  return promise;
}
export const subscribeProductLessonAudio=naturalAudioRegistry.subscribe;
export const productLessonAudioState=naturalAudioRegistry.getSnapshot;
export const naturalLessonDescriptor=(text:string,selector:NaturalAudioSelector={})=>naturalAudioRegistry.resolve(text,selector);
export const retryProductLessonAudio=()=>prepareProductLessonAudio({allowLocalCandidate:localCandidateAudioAuthorized});

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

export function bundledLessonAudio(text:string,selector:NaturalAudioSelector={}) {const natural=naturalAudioRegistry.resolve(text,selector);if(natural)return natural.url;if(naturalAudioRegistry.isBlocked(text)||naturalAudioRegistry.hasText(text)||Object.values(selector).some(Boolean))return null;return bundledClips.get(text)??null;}
export function bundledLessonSource(text:string,selector:NaturalAudioSelector={}) {const natural=naturalAudioRegistry.resolve(text,selector);if(natural)return natural.sourceId;if(naturalAudioRegistry.isBlocked(text)||naturalAudioRegistry.hasText(text)||Object.values(selector).some(Boolean))return null;return bundledSources.get(text)??null;}
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
  let pendingEnded=()=>{},acceptedDuration:number|null=null,ensureDuration=()=>false,validTerminal=()=>false;
  let completed=false,completedDuration:number|null=null;
  let diagnostic: (event:string,reason?:string,cause?:unknown)=>void=()=>{};
  const source=()=>audio.currentSrc||audio.src||'';
  let expectedSource='',expectedDeclaredSource='';
  const finitePosition=()=>{const actual=audio.currentTime;return Number.isFinite(actual)?Math.max(0,actual):null;};
  const sourceMatches=()=>!!expectedSource&&(audio.src||'')===expectedDeclaredSource&&source()===expectedSource;
  const sample=()=>{
    const token=generation;
    if(requested!==null||!validated||audio.seeking||!sourceMatches()||!ensureDuration())return baseline;
    const trusted=baseline,duration=acceptedDuration,actual=finitePosition();
    if(token!==generation||requested!==null||!validated||baseline!==trusted||acceptedDuration!==duration)return baseline;
    if(actual!==null&&actual>=baseline-.25){baseline=Math.max(baseline,actual);hasBaseline=true;}
    return baseline;
  };
  const stopped=()=>{generation++;cleanupRequest();cleanupRequest=()=>{};validated=false;acceptedDuration=null;ensureDuration=()=>false;validTerminal=()=>false;preparing=false;if(active===playback)active=null;if(!disposed)changed(false);};
  const error=(reason:string,cause?:unknown)=>{if(disposed)return;completed=false;completedDuration=null;diagnostic('rejected',reason,cause);stopped();audio.pause();failed();};
  const paused=()=>{const token=generation;if(audio.paused&&active===playback&&!preparing){if(audio.ended){ended();return;}if(requested===null&&!ensureDuration()){if(token===generation)error('confirmed-position');return;}if(token!==generation)return;diagnostic('pause');sample();if(token===generation)stopped();}};
  const ended=()=>{const token=generation;if(audio.ended&&active===playback){if(requested!==null){pendingEnded();return;}if(!ensureDuration()){if(token===generation)error('confirmed-position');return;}if(token!==generation)return;const trustedEnd=validTerminal();if(token!==generation)return;diagnostic('ended');sample();if(token!==generation)return;if(trustedEnd&&validTerminal()){completed=true;completedDuration=acceptedDuration;}if(token===generation)stopped();}};
  const mediaError=()=>{if(active===playback)error('media-error',audio.error);};
  const begin=(rate:number,positionSeconds:number,restoring:boolean)=>{
    if(disposed)return;
    active?.stop();active=playback;
    const token=++generation;cleanupRequest();
    const target=Number.isFinite(positionSeconds)?Math.max(0,positionSeconds):0;
    if(restoring&&!hasBaseline){baseline=target;hasBaseline=true;}
    requested=target;validated=false;completed=false;completedDuration=null;acceptedDuration=null;ensureDuration=()=>false;validTerminal=()=>false;expectedDeclaredSource=audio.src||'';expectedSource=expectedDeclaredSource||source();
    const reload=needsReload||preparedSource!==expectedSource||audio.readyState===0;needsReload=false;preparing=true;
    let stage='metadata',targetPosition=target,started=false,seekAssigned=false,seekComplete=false,seekEventSeen=false,playingSeen=false,startedAt=0,highestStartup:number|null=null;
    let windowAt:number|null=null,lastAdvanceAt:number|null=null,playingAt:number|null=null,windowPosition=0,lastProgress:number|null=null,advances=0,interrupted=false;
    let metadataDuration:number|null=null,maximumDuration:number|null=null,metadataRevised=false;
    let confirmedPosition:number|null=null,confirmedAt:number|null=null;
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
    const finiteDuration=(value:number|null):value is number=>value!==null&&Number.isFinite(value)&&value>0;
    // Duration is observed at every consumer: a queued durationchange is not a prerequisite.
    // No metadata observation is a seek, progress advance, checkpoint or confirmation.
    const durationState=(): 'valid'|'pending'|'invalid'=>{
      if(!valid()||!metadataSeen||!finiteDuration(metadataDuration))return 'invalid';
      const previous=acceptedDuration,request=requested,trusted=baseline,wasValidated=validated;
      const progressAtRead=lastProgress,advanceAtRead=lastAdvanceAt,highestAtRead=highestStartup;
      const confirmedAtRead=confirmedPosition,confirmedTimeAtRead=confirmedAt;
      const duration=audio.duration,actual=audio.currentTime,effectiveRate=audio.playbackRate;
      const ready=audio.readyState>0&&!audio.error,seeking=audio.seeking,paused=audio.paused,sameSource=sourceMatches(),observedAt=clock();
      if(!valid()||requested!==request||validated!==wasValidated||acceptedDuration!==previous||baseline!==trusted||lastProgress!==progressAtRead||lastAdvanceAt!==advanceAtRead||highestStartup!==highestAtRead||confirmedPosition!==confirmedAtRead||confirmedAt!==confirmedTimeAtRead)return 'invalid';
      if(!sameSource||!ready||!finiteDuration(previous)||!finiteDuration(duration)||!Number.isFinite(rate)||rate<=0)return 'invalid';
      if(duration!==previous)metadataRevised=true;
      if(duration===previous)return seeking?(started?'invalid':'pending'):'valid';
      const extent=Math.min(previous,duration);
      if(targetPosition<0||targetPosition>extent)return 'invalid';
      // Finite compatible metadata may arrive while the one requested paused seek is
      // unsettled. Keep D0/target fixed and wait for its genuine seeked, under the same deadline.
      if(!started&&(!seekComplete||seeking)){maximumDuration=Math.max(maximumDuration??metadataDuration,duration);return 'pending';}
      if(!Number.isFinite(actual)||actual<0||actual>duration)return 'invalid';
      if(!started){if(!paused||Math.abs(actual-targetPosition)>1)return 'invalid';}
      else{
        const pending=request!==null,lastPosition=pending?(lastProgress??preparedPosition):confirmedPosition,lastAt=pending?(lastAdvanceAt??startedAt):confirmedAt;
        const history=[targetPosition,preparedPosition,firstProgressPosition,windowAt===null?null:windowPosition,lastProgress,highestStartup,lastPosition,...(pending?[]:[trusted])].filter((point):point is number=>point!==null);
        const elapsed=lastAt===null?NaN:(observedAt-lastAt)/1000;
        if(seeking||!Number.isFinite(effectiveRate)||Math.abs(effectiveRate-rate)>.000001||lastPosition===null||!Number.isFinite(elapsed)||elapsed<0||history.some(point=>!Number.isFinite(point)||point<0||point>extent)||actual<lastPosition-1||actual>lastPosition+1+elapsed*rate||actual<(pending?targetPosition:trusted)-1||(pending&&(actual>targetPosition+1+Math.max(0,observedAt-startedAt)/1000*rate||(highestStartup!==null&&actual<highestStartup-1))))return 'invalid';
      }
      acceptedDuration=duration;maximumDuration=Math.max(maximumDuration??metadataDuration,duration);return 'valid';
    };
    ensureDuration=()=>durationState()==='valid';
    // Completion needs the real ended state and the same confirmed media timeline.
    // A saved near-end checkpoint, a paused position, or an unconfirmed ended event
    // cannot turn a Continue request into a restart.
    validTerminal=()=>{
      if(!valid()||requested!==null||!validated||!audio.ended||!ensureDuration())return false;
      const previous=acceptedDuration,trusted=baseline,lastPosition=confirmedPosition,lastAt=confirmedAt;
      const actual=audio.currentTime,duration=audio.duration,effectiveRate=audio.playbackRate,observedAt=clock();
      const sameSource=sourceMatches(),ready=audio.readyState>0&&!audio.error,seeking=audio.seeking,atEnd=audio.ended;
      const elapsed=lastAt===null?NaN:(observedAt-lastAt)/1000;
      if(!valid()||requested!==null||!validated||acceptedDuration!==previous||baseline!==trusted||confirmedPosition!==lastPosition||confirmedAt!==lastAt)return false;
      return atEnd&&sameSource&&ready&&!seeking&&finiteDuration(previous)&&finiteDuration(duration)&&Math.abs(duration-previous)<=.01&&Number.isFinite(actual)&&actual>=duration-.05&&actual<=duration+.05&&actual>=trusted-.25&&lastPosition!==null&&actual>=lastPosition-.25&&Number.isFinite(elapsed)&&elapsed>=0&&Number.isFinite(effectiveRate)&&Math.abs(effectiveRate-rate)<=.000001&&actual<=lastPosition+1+elapsed*rate;
    };
    const durationMatches=ensureDuration;
    const nearTarget=()=>{const actual=finitePosition();return actual!==null&&Math.abs(actual-targetPosition)<=1;};
    const validStartPosition=()=>{
      const actual=finitePosition(),elapsed=Math.max(0,clock()-startedAt)/1000;
      if(!metadataSeen||audio.readyState===0||!durationMatches()||!Number.isFinite(rate)||rate<=0||actual===null||actual<targetPosition-1||actual>targetPosition+1+elapsed*rate||(highestStartup!==null&&actual<highestStartup-1))return false;
      highestStartup=highestStartup===null?actual:Math.max(highestStartup,actual);return true;
    };
    // Called only by the current advancing timeupdate, never by playing, promise or stationary events.
    const accept=(actual:number,observedAt:number)=>{
      if(requested===null||!valid()||!seekComplete||!playingSeen||windowAt===null||lastAdvanceAt!==observedAt||advances<3||observedAt-windowAt<750||audio.paused||audio.seeking||!sourceMatches())return;
      if(lastProgress===null||actual!==lastProgress||actual-windowPosition<Math.max(.05,rate*.5))return;
      if(!validStartPosition()){fail('startup-position');return;}
      if(!valid()||requested===null||lastProgress!==actual||lastAdvanceAt!==observedAt||advances<3||windowAt===null||observedAt-windowAt<750)return;
      requested=null;baseline=actual;hasBaseline=true;validated=true;confirmedPosition=actual;confirmedAt=observedAt;stage='playing';
      clearTimeout(timeout);diagnostic('confirmed');confirmed?.();
    };
    const playing=()=>{if(!valid()||!started||requested===null)return;diagnostic('playing');playingSeen=true;if(playingAt===null)playingAt=clock();if(!validStartPosition()||!sourceMatches()){fail('playing-position');return;}};
    const progress=()=>{
      if(!valid()||!started||audio.paused||audio.seeking)return;
      if(requested!==null){
        if(!playingSeen){diagnostic('timeupdate');return;}
        if(firstProgressPosition===null&&finitePosition()!>(preparedPosition??Infinity)+.001){firstProgressPosition=finitePosition();firstProgressElapsed=Math.max(0,clock()-startedAt);}
        diagnostic('timeupdate');
        if(!validStartPosition()||!sourceMatches()){fail('progress-position');return;}
        const actual=finitePosition()!,observedAt=clock();
        if(windowAt===null){windowAt=observedAt;windowPosition=actual;lastProgress=actual;lastAdvanceAt=observedAt;advances=0;return;}
        if(lastProgress===null||actual<=lastProgress+.001)return;
        const gap=lastAdvanceAt===null?Infinity:observedAt-lastAdvanceAt;
        // A burst or long gap cannot reuse old advances and fill the window with idle time.
        if(!Number.isFinite(gap)||gap<=0||gap>500){windowAt=observedAt;windowPosition=actual;lastProgress=actual;lastAdvanceAt=observedAt;advances=0;return;}
        lastProgress=actual;lastAdvanceAt=observedAt;advances++;
        accept(actual,observedAt);return;
      }
      if(!durationMatches()){fail('confirmed-position');return;}
      const previous=acceptedDuration,trusted=baseline;
      const actual=audio.currentTime,duration=audio.duration,sameSource=sourceMatches(),observedAt=clock(),elapsed=confirmedAt===null?NaN:(observedAt-confirmedAt)/1000;
      if(!valid()||requested!==null||!validated||acceptedDuration!==previous||baseline!==trusted)return;
      if(!finiteDuration(previous)||!finiteDuration(duration)||Math.abs(duration-previous)>.01||!Number.isFinite(actual)||actual<0||!sameSource||actual<trusted-1||confirmedPosition===null||!Number.isFinite(elapsed)||elapsed<0||actual>confirmedPosition+1+elapsed*rate||actual>previous){fail('confirmed-position');return;}
      baseline=Math.max(baseline,actual);
      if(actual>confirmedPosition+.001){confirmedPosition=actual;confirmedAt=observedAt;}
      diagnostic('timeupdate');
    };
    const start=()=>{
      if(!valid()||started||!seekComplete)return;
      if(!metadataSeen||audio.readyState===0||!durationMatches()||!Number.isFinite(rate)||rate<=0||!audio.paused||audio.seeking||!sourceMatches()||!nearTarget()){fail('not-prepared-paused');return;}
      preparing=false;started=true;startedAt=clock();preparedPosition=finitePosition();preparedDuration=metadataDuration;stage='confirming-progress';
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
    const onSeeking=()=>{if(valid()&&started&&audio.seeking)fail('progress-position');};
    const onSeeked=()=>{if(!valid()||!seekAssigned||started)return;seekEventSeen=true;diagnostic('seeked');seeked();};
    const ready=()=>{
      if(!valid()||requested===null||started)return;
      if((audio.src||'')!==expectedDeclaredSource){fail('source-changed');return;}
      if(seekAssigned){if(durationState()==='invalid')fail('startup-position');return;}
      const duration=audio.duration;
      if(!metadataSeen||audio.readyState===0||!finiteDuration(duration))return;
      if(!sourceMatches()){fail('metadata-source');return;}
      if(!audio.paused){fail('preparation-not-paused');return;}
      if(audio.seeking)return;
      if(!valid())return;
      preparedSource=expectedSource;metadataDuration=duration;acceptedDuration=duration;maximumDuration=duration;
      if(target===0){
        targetPosition=0;
        if(!audio.seeking&&Math.abs(finitePosition()??Infinity)<.025){seekComplete=true;start();return;}
      }else{
        // A Continue request never turns an ended track into a restart.
        targetPosition=Math.min(target,Math.max(0,metadataDuration-.01));
      }
      // An empty seekable range is observed, not a permanent prerequisite for a paused seek.
      // A setter echo is never proof: only a real seeked, same source and settled position may play.
      stage='paused-seek';seekAssigned=true;diagnostic('seek-request');
      if(preparePoll!==undefined){clearTimeout(preparePoll);preparePoll=undefined;}
      try{audio.currentTime=targetPosition;}catch(cause){fail('seek-threw',cause);}
    };
    const metadata=()=>{if(!valid()||requested===null||started)return;metadataSeen=true;diagnostic('loadedmetadata');ready();};
    const available=(event:Event)=>{
      if(!valid())return;diagnostic(event.type);if(!valid())return;
      if(started){if(!durationMatches())fail(requested===null?'confirmed-position':'startup-position');return;}
      ready();
    };
    const wait=(event:Event)=>{if(!valid()||!started)return;if(playingAt!==null)interrupted=true;diagnostic(event.type);if(requested!==null){playingSeen=false;windowAt=null;lastAdvanceAt=null;lastProgress=null;advances=0;}};
    const aborted=()=>{if(!valid())return;diagnostic('abort');if(!preparing||metadataSeen)fail('media-aborted');};
    const emptied=()=>{if(!valid())return;diagnostic('emptied');if(started)fail('media-emptied');};
    const poll=()=>{if(!valid()||started||seekAssigned)return;ready();if(valid()&&!started&&!seekAssigned)preparePoll=setTimeout(poll,100);};
    const timeout=setTimeout(()=>fail('confirmation-timeout'),10000);
    pendingEnded=()=>{
      if(!valid())return;
      if(!durationMatches()){fail('ended-before-confirmation');return;}
      const durationAtRead=acceptedDuration,maximumAtRead=maximumDuration;
      const actual=finitePosition(),duration=audio.duration,elapsed=playingAt===null?0:Math.max(0,clock()-playingAt);
      const remaining=preparedPosition===null||!Number.isFinite(preparedPosition)||!finiteDuration(maximumDuration)?Infinity:maximumDuration-preparedPosition;
      const minimumRemaining=preparedPosition===null||!finiteDuration(preparedDuration)||!finiteDuration(acceptedDuration)?Infinity:Math.min(preparedDuration,acceptedDuration)-preparedPosition;
      const expectedMs=Number.isFinite(rate)&&rate>0?remaining/rate*1000:Infinity;
      const minimumExpectedMs=Number.isFinite(rate)&&rate>0?minimumRemaining/rate*1000:Infinity;
      const tailMs=firstProgressPosition===null||!finiteDuration(maximumDuration)||!Number.isFinite(rate)||rate<=0?Infinity:(maximumDuration-firstProgressPosition)/rate*1000;
      const observedTailMs=firstProgressElapsed===null?0:clock()-startedAt-firstProgressElapsed;
      const firstPlayedMs=firstProgressElapsed===null||playingAt===null?Infinity:startedAt+firstProgressElapsed-playingAt;
      const lastAdvanceGap=lastAdvanceAt===null?Infinity:clock()-lastAdvanceAt;
      // Some decoders expose an initial media-time offset on a very short clip.
      // Accept that zero-start case only when two real progress events prove the
      // remaining timeline. A reset/burst/one-point jump cannot supply this proof.
      const observedAdvance=firstProgressPosition===null||lastProgress===null?0:lastProgress-firstProgressPosition;
      const observedAdvanceMs=windowAt===null||lastAdvanceAt===null?0:lastAdvanceAt-windowAt;
      const observedShortStart=!metadataRevised&&target===0&&targetPosition===0&&preparedPosition===0&&rate===1&&
        maximumDuration!==null&&maximumDuration<=1.5&&preparedDuration===maximumDuration&&acceptedDuration===maximumDuration&&
        Math.abs(audio.playbackRate-rate)<=.000001&&windowAt!==null&&windowPosition===firstProgressPosition&&
        firstProgressElapsed!==null&&windowAt>=startedAt+firstProgressElapsed-.01&&advances>=1&&
        Number.isFinite(observedAdvance)&&observedAdvance>=Math.min(.05,duration*.2)&&
        Number.isFinite(observedAdvanceMs)&&observedAdvanceMs>=observedAdvance/rate*800&&
        lastProgress!==null&&actual!==null&&actual>=lastProgress&&
        lastAdvanceGap>=(actual-lastProgress)/rate*800;
      // A fully observed short remainder may end before the normal confirmation window.
      // A first-point jump, instant ended, interrupted startup or a long-track ended is not proof.
      // The first advance must be timely and precede the final fifth of the remainder.
      // A stationary first segment followed by one near-end jump cannot prove a short clip.
      if(!started||!seekComplete||!playingSeen||interrupted||audio.seeking||!sourceMatches()||!durationMatches()||!finiteDuration(preparedDuration)||!finiteDuration(duration)||actual===null||preparedPosition===null||!Number.isFinite(remaining)||remaining<=.02||!Number.isFinite(minimumRemaining)||minimumRemaining<=.02||!Number.isFinite(expectedMs)||expectedMs<=0||expectedMs>1500||!Number.isFinite(minimumExpectedMs)||minimumExpectedMs<=0||minimumExpectedMs>1500||!Number.isFinite(elapsed)||!Number.isFinite(tailMs)||tailMs<=0||!Number.isFinite(observedTailMs)||observedTailMs<tailMs*.8||!Number.isFinite(firstPlayedMs)||firstPlayedMs<0||firstPlayedMs>Math.min(500,minimumExpectedMs*.8)||!Number.isFinite(lastAdvanceGap)||lastAdvanceGap<0||lastAdvanceGap>500||firstProgressPosition===null||firstProgressElapsed===null||firstProgressPosition<=preparedPosition+.001||firstProgressPosition>preparedPosition+minimumRemaining*.8||actual<=firstProgressPosition+.001||actual<duration-.05||actual>duration+.05||(elapsed<expectedMs*.8&&!observedShortStart)||!validStartPosition()){
        fail('ended-before-confirmation');return;
      }
      if(!valid()||requested===null)return;
      // A short-ending proof cannot mix endpoint/timing fields from different
      // native metadata snapshots, even if the last getter returns to the old value.
      if(acceptedDuration!==durationAtRead||maximumDuration!==maximumAtRead){fail('ended-before-confirmation');return;}
      requested=null;baseline=actual;hasBaseline=true;validated=true;stage='playing';clearTimeout(timeout);diagnostic('confirmed-short-end');confirmed?.();if(!valid())return;diagnostic('ended');completed=true;completedDuration=acceptedDuration;stopped();
    };
    audio.addEventListener('loadedmetadata',metadata);
    audio.addEventListener('canplay',available);audio.addEventListener('progress',available);audio.addEventListener('durationchange',available);
    audio.addEventListener('seeking',onSeeking);audio.addEventListener('seeked',onSeeked);audio.addEventListener('playing',playing);audio.addEventListener('timeupdate',progress);
    audio.addEventListener('waiting',wait);audio.addEventListener('stalled',wait);audio.addEventListener('abort',aborted);audio.addEventListener('emptied',emptied);
    cleanupRequest=()=>{clearTimeout(timeout);if(preparePoll!==undefined)clearTimeout(preparePoll);if(seekPoll!==undefined)clearTimeout(seekPoll);audio.removeEventListener('loadedmetadata',metadata);audio.removeEventListener('canplay',available);audio.removeEventListener('progress',available);audio.removeEventListener('durationchange',available);audio.removeEventListener('seeking',onSeeking);audio.removeEventListener('seeked',onSeeked);audio.removeEventListener('playing',playing);audio.removeEventListener('timeupdate',progress);audio.removeEventListener('waiting',wait);audio.removeEventListener('stalled',wait);audio.removeEventListener('abort',aborted);audio.removeEventListener('emptied',emptied);};
    changed(true);diagnostic('begin');if(reload){try{audio.preload='auto';diagnostic('load');audio.load();}catch(cause){fail('load-threw',cause);return;}}poll();
  };
  const playback={
    play(rate:number,positionSeconds=0){begin(rate,positionSeconds,false);},
    resume(rate:number,positionSeconds=sample()){begin(rate,positionSeconds,true);},
    pause(reload=false){if(reload)needsReload=true;playback.stop();return baseline;},
    position:sample,
    completed(){const token=generation,duration=audio.duration;return !disposed&&completed&&audio.ended&&!audio.error&&sourceMatches()&&completedDuration!==null&&duration===completedDuration&&token===generation;},
    stop(){if(disposed)return;completed=false;completedDuration=null;diagnostic('stop');sample();stopped();audio.pause();},
    dispose(){playback.stop();disposed=true;audio.removeEventListener('pause',paused);audio.removeEventListener('ended',ended);audio.removeEventListener('error',mediaError);},
  };
  audio.addEventListener('pause',paused);audio.addEventListener('ended',ended);audio.addEventListener('error',mediaError);
  return playback;
}
