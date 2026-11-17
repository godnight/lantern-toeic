'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),ROOT=path.resolve(__dirname,'../..'),req=createRequire(path.join(ROOT,'package.json'));
const {chromium}=req('playwright'),ts=req('typescript'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2),arg=name=>args.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const expected={wrapper:arg('expect-wrapper-sha'),inner:arg('expect-inner-sha'),practice:arg('expect-practice-sha')};
const paths={wrapper:'lib/explicit-bundled-playback.ts',inner:'lib/lesson-audio.ts',practice:'app/learn/practice.tsx'};
const MAIN='1935c17708c726884ac9.mp3',MAIN_PATH='/audio/offline/'+MAIN;
const OUT=path.join(ROOT,'reports/explicit-player',new Date().toISOString().replaceAll(':','-')+'-'+crypto.randomBytes(3).toString('hex'));
const report={revision:'r15-explicit-player',status:'NOT_RUN',startedUtc:new Date().toISOString(),checks:[],network:[],browserResponses:[],console:[],pageErrors:[],externalRequests:[],cleanup:{browserClosed:false,serverClosed:false},limitations:[
 'Actual wrapper/unchanged inner called directly. Practice is hash-gated, but SpeechPlayer integration is not executed.',
 'No StudyApp, repository, database or storage. Chrome is not ArkWeb, AudioPolicy, audible listening, Home/exit/cold lifecycle or independent QA.',
 'Pause is two real seconds; it does not reproduce the 52-second native idle failure.',
 'Native play/load/pause are observed then delegated. No forged media events, currentTime, clocks, mute or play promises.',
 'Original 13x100ms steady samples, 500ms gap cap, strict progression, 0.25-second slope error; original <=1-second positioning and 0.4-second startup-slope tolerances.',
 'A sparse genuine short tail may fail safely. Preserve every failure; no blanket rerun.',
 'Original packaged MP3 with an HTTP Range server; not the native intercept implementation.']};
let server,browser,context,page,fixtureCounter=0,mainBytes,media,modules={},sourceBytes={};
const sockets=new Set(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function write(){await fs.writeFile(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');}
async function until(fn,label,timeout=12000){const end=Date.now()+timeout;do{if(await fn())return;await sleep(35);}while(Date.now()<end);throw Error(label);}
async function evidence(name){const value=await page.evaluate(()=>window.fixture.snapshot());await fs.writeFile(path.join(OUT,name+'.json'),JSON.stringify(value,null,2)+'\n');return value;}
async function check(name,fn){const started=Date.now();try{const details=await fn();report.checks.push({name,status:'PASS',elapsedMs:Date.now()-started,details});console.log(JSON.stringify({name,status:'PASS'}));}catch(e){const file='failure-'+(report.checks.length+1);if(page)await evidence(file).catch(()=>{});report.checks.push({name,status:'FAIL',elapsedMs:Date.now()-started,error:String(e.stack||e),evidence:file+'.json'});console.log(JSON.stringify({name,status:'FAIL',error:String(e)}));}await write();}
async function state(){return page.evaluate(()=>window.fixture.state());}
async function request(method,rate,target){return page.evaluate(({method,rate,target})=>window.fixture.request(method,rate,target),{method,rate,target});}
async function confirmedAfter(sequence){await until(async()=>{const s=await page.evaluate(()=>window.fixture.snapshot());assert.equal(s.failed.filter(p=>p.requestSequence===sequence).length,0,'Current request failed');return s.confirmed.some(p=>p.requestSequence===sequence);},'Actual sustained confirmation');}
async function naturalEndAfter(sequence){await until(async()=>{const s=await page.evaluate(()=>window.fixture.snapshot());assert.equal(s.failed.filter(p=>p.requestSequence===sequence).length,0,'Short tail failed');return s.state.ended&&s.events.some(e=>e.requestSequence===sequence&&e.mediaId===s.state.mediaId&&e.type==='ended'&&e.trusted);},'Actual natural ended event',5000);}
function scoped(log,sequence,id){return {...log,events:log.events.filter(x=>x.requestSequence===sequence&&x.mediaId===id),calls:log.calls.filter(x=>x.requestSequence===sequence&&x.mediaId===id),samples:log.samples.filter(x=>x.requestSequence===sequence&&x.mediaId===id),confirmed:log.confirmed.filter(x=>x.requestSequence===sequence&&x.mediaId===id)};}
function releasedBeforeFactory(log,id){const made=log.factories.find(f=>f.mediaId===id);assert(made);assert(made.predecessors.every(p=>!p.connected&&p.srcAttribute===null&&p.paused),'Old nodes released before factory');
 for(const old of made.predecessors){const empty=log.calls.filter(c=>c.mediaId===old.mediaId&&c.type==='load-call'&&c.srcAttribute===null&&c.now<=made.now).at(-1);assert(empty,'Old resource had native empty load');assert(log.calls.some(c=>c.mediaId===old.mediaId&&c.type==='pause-call'&&c.now<=empty.now),'Old resource paused before empty load');}return made;}

async function steadyAfterConfirmation(sequence,rate) {
  const samples=await page.evaluate(async()=>{const samples=[];for(let i=0;i<13;i++){samples.push(window.fixture.state());if(i<12)await new Promise(resolve=>setTimeout(resolve,100));}return samples;});
  const log=await page.evaluate(()=>window.fixture.snapshot());
  const elapsed=(samples.at(-1).now-samples[0].now)/1000,advance=samples.at(-1).currentTime-samples[0].currentTime;
  const evidenceFile='steady-fixture-'+samples[0].fixtureId+'-request-'+sequence+'.json';await fs.writeFile(path.join(OUT,evidenceFile),JSON.stringify({sequence,rate,samples,elapsed,advance},null,2)+'\n');
  assert(elapsed>=1,'Observe at least one independent second after confirmation');
  assert(samples.every(p=>p.requestSequence===sequence&&p.mediaId===samples[0].mediaId&&p.fixtureId===samples[0].fixtureId&&p.source===samples[0].source&&!p.paused&&!p.seeking&&!p.ended&&p.mediaErrorCode===null&&p.rate===rate&&Number.isFinite(p.currentTime)&&Number.isFinite(p.now)&&Number.isFinite(p.duration)&&p.duration>0&&Math.abs(p.duration-samples[0].duration)<=.01),'All post-confirmation samples remain finite, same-source playing at the requested rate without error');
  const intervals=[];for(let i=1;i<samples.length;i++){
    const milliseconds=samples[i].now-samples[i-1].now,seconds=samples[i].currentTime-samples[i-1].currentTime;
    assert(milliseconds>0&&milliseconds<=500,'A multi-point steady observation cannot bridge a sampling gap over 500ms');
    assert(seconds>.001,'No stationary or backward post-confirmation interval');intervals.push({milliseconds,mediaAdvanceSeconds:seconds});
  }
  assert(advance>rate*.7);assert(Math.abs(advance-elapsed*rate)<.25,'Keep the original post-confirmation 0.25-second rate tolerance');
  assert.equal(log.failed.filter(e=>e.requestSequence===sequence).length,0,'No controller error after confirmation');
  assert(!log.events.some(e=>e.requestSequence===sequence&&e.now>=samples[0].now&&e.now<=samples.at(-1).now&&['waiting','stalled','error','pause','ended'].includes(e.type)),'No interruption during independent steady observation');
  return {elapsed,advance,ratio:advance/elapsed,absoluteRateErrorSeconds:Math.abs(advance-elapsed*rate),samples,intervals,evidence:evidenceFile};
}
function positioning(log, sequence, target, rate, {shortEnd=false}={}) {
  const calls=log.calls.filter(r=>r.requestSequence===sequence&&r.type==='play-call');assert.equal(calls.length,1,'Exactly one actual play, no muted priming');
  const call=calls[0];assert.equal(call.paused,true);assert.equal(call.seeking,false);assert.equal(call.muted,false);assert(Math.abs(call.currentTime-target)<=1,'Actual play starts at requested position');
  const first=log.events.find(r=>r.requestSequence===sequence&&r.type==='playing'&&r.now>=call.now);assert(first,'Keep first playing event after actual play, including zero if observed');assert.equal(first.trusted,true);assert(Math.abs(first.currentTime-target)<=1,'First genuine playing position within 1 second');
  const confirmed=log.confirmed.find(r=>r.requestSequence===sequence);assert(confirmed);const elapsed=(confirmed.now-call.now)/1000;
  const request=log.requests.find(r=>r.requestSequence===sequence);assert(request);assert(confirmed.now-request.now<=10000,'Confirmation remains inside the total 10-second request bound');
  assert(confirmed.currentTime>=first.currentTime);
  for(const point of [call,first,confirmed])assert(Number.isFinite(point.currentTime)&&Number.isFinite(point.duration)&&point.duration>0,'Prepared/playing/confirmed duration and position must be finite');
  assert(Math.abs(call.duration-first.duration)<=.01&&Math.abs(call.duration-confirmed.duration)<=.01,'Duration stays consistent across actual play and confirmation');
  const observations=[...log.samples.map(p=>({...p,observation:'50ms-sample'})),...log.events.filter(e=>e.type==='timeupdate'&&e.trusted).map(p=>({...p,observation:'trusted-timeupdate'}))].filter(p=>p.requestSequence===sequence&&p.now>=first.now&&p.now<=confirmed.now&&!p.paused&&!p.seeking).sort((a,b)=>a.now-b.now);
  const firstActualAdvance=observations.find(p=>p.currentTime>first.currentTime+.001);assert(firstActualAdvance,'A playing event alone cannot prove actual progression');
  const startup={requestToPlayingMs:first.now-request.now,playCallToPlayingMs:first.now-call.now,playingToFirstObservedAdvanceMs:firstActualAdvance.now-first.now,firstActualAdvance,lastObservedStillPosition:observations.filter(p=>p.now<firstActualAdvance.now&&Math.abs(p.currentTime-first.currentTime)<=.001).at(-1)??null,requestToConfirmedMs:confirmed.now-request.now,measurementResolution:'Periodic samples are nominally 50ms; the first observed advance is not the exact physical start instant.'};
  const advances=log.events.filter(r=>r.requestSequence===sequence&&r.type==='timeupdate'&&r.trusted&&r.now>=call.now&&r.now<=confirmed.now&&!r.seeking&&!r.paused);
  if(shortEnd){
    assert(advances.length>=1,'Short tail needs a genuine intermediate progressing sample');
    const middle=advances.filter(p=>p.currentTime>target+.001&&p.currentTime<confirmed.duration-.005);assert(middle.length>=1,'A lone final ended tick cannot prove a short tail');
    assert(confirmed.currentTime>middle.at(-1).currentTime+.001,'Natural end must advance beyond intermediate progress');
    assert(log.events.some(e=>e.requestSequence===sequence&&e.type==='ended'&&e.trusted),'Keep genuine natural ended event evidence');
    assert(log.events.some(e=>e.requestSequence===sequence&&['pause','ended'].includes(e.type)&&e.trusted&&e.ended&&e.now<=confirmed.now),'Confirmation must follow genuine native natural-end state, including pause-before-ended ordering');
    assert(!log.events.some(e=>e.requestSequence===sequence&&['waiting','stalled'].includes(e.type)&&e.now>=call.now&&e.now<=confirmed.now),'Short-tail exception cannot accept stalled startup');
    assert(elapsed>=((confirmed.duration-target)/rate)*.8,'Short-ended exception still requires actual elapsed duration');
  }
  let continuousWindow=null;
  if(!shortEnd){
    let chain=[],previous=first.currentTime;
    for(const point of advances){
      const moved=point.currentTime>previous+.001;
      if(!moved)chain=[];
      else if(!chain.length||point.now-chain.at(-1).now>500)chain=[point];
      else chain.push(point);
      previous=point.currentTime;
    }
    assert(chain.length>=4,'Confirmation requires a current chain of actual advancing timeupdates, not old accumulated events');
    assert(chain.every(p=>p.source===call.source&&p.mediaId===call.mediaId&&p.fixtureId===call.fixtureId&&p.rate===rate&&p.mediaErrorCode===null&&Number.isFinite(p.currentTime)&&Number.isFinite(p.now)&&Number.isFinite(p.duration)&&p.duration>0&&Math.abs(p.duration-call.duration)<=.01),'Every continuous point is genuine, same-source, finite and at the selected rate');
    const head=chain[0],tail=chain.at(-1),windowSeconds=(confirmed.now-head.now)/1000,windowAdvance=confirmed.currentTime-head.currentTime;
    assert(tail.now<=confirmed.now&&confirmed.now-tail.now<=500,'Confirmation remains adjacent to a new actual advance');
    assert(windowSeconds>=.75,'Require at least 750ms continuous actual advancement, not the first tick');
    assert(windowAdvance>=Math.max(.05,rate*.5),'Continuous window must contain actual progression');
    assert(Math.abs(windowAdvance-windowSeconds*rate)<.4,'Keep original 0.4-second tolerance on the actually advancing window');
    assert(!log.events.some(e=>e.requestSequence===sequence&&e.now>=head.now&&e.now<=confirmed.now&&['waiting','stalled','pause','error','ended'].includes(e.type)),'No interruption inside the continuous confirmation window');
    continuousWindow={seconds:windowSeconds,mediaAdvanceSeconds:windowAdvance,expectedAdvanceSeconds:windowSeconds*rate,absoluteRateErrorSeconds:Math.abs(windowAdvance-windowSeconds*rate),samples:chain};
  }
  return {playCall:call,firstPlaying:first,firstPlayingErrorSeconds:Math.abs(first.currentTime-target),confirmed,elapsedSeconds:elapsed,startup,continuousWindow,allPreConfirmationProgress:advances};
}

function positioned(log,sequence,target,rate,shortEnd=false){
 const id=log.requests.find(r=>r.requestSequence===sequence).newMediaId,selected=scoped(log,sequence,id),result=positioning(selected,sequence,target,rate,{shortEnd});
 assert(selected.events.some(e=>e.type==='loadedmetadata'&&e.trusted&&e.now<=result.playCall.now),'Fresh real metadata before play');
 if(target>0){const seeked=selected.events.find(e=>e.type==='seeked'&&e.trusted&&e.now<=result.playCall.now);assert(seeked,'Real trusted seeked before nonzero play');assert(!seeked.seeking&&seeked.paused);assert(Math.abs(seeked.currentTime-target)<=1);result.prePlaySeeked=seeked;}
 assert.equal(log.factories.filter(f=>f.createdByAction===sequence).length,1);assert(log.calls.filter(c=>c.requestSequence===sequence&&c.type==='play-call').every(c=>c.mediaId===id),'No retired element plays');result.factory=releasedBeforeFactory(log,id);return result;
}
function browserFixture(createExplicitBundledPlayback){
 const log={events:[],calls:[],changed:[],failed:[],confirmed:[],requests:[],samples:[],factories:[]},host=document.createElement('div');host.hidden=true;document.body.append(host);
 let audio=null,controller,sequence=0,mediaId=0;const fixtureId=window.__fixtureId,records=[],ranges=r=>Array.from({length:r.length},(_,i)=>[r.start(i),r.end(i)]);
 const state=(node=audio,id=mediaId)=>({now:performance.now(),utc:new Date().toISOString(),fixtureId,mediaId:id,requestSequence:sequence,currentTime:node?.currentTime??null,duration:Number.isFinite(node?.duration)?node.duration:null,paused:node?.paused??true,seeking:node?.seeking??false,ended:node?.ended??false,muted:node?.muted??false,rate:node?.playbackRate??null,mediaErrorCode:node?.error?.code??null,readyState:node?.readyState??0,source:node?(node.currentSrc||node.src):'',seekable:node?ranges(node.seekable):[],srcAttribute:node?.getAttribute('src')??null,connected:node?.isConnected??false,position:controller?.position()??0});
 const mediaState=()=>records.map(({node,id,createdByAction})=>({mediaId:id,createdByAction,connected:node.isConnected,srcAttribute:node.getAttribute('src'),currentSrc:node.currentSrc,paused:node.paused,currentTime:node.currentTime}));
 const factory=()=>{const predecessors=mediaState(),node=new Audio(),id=++mediaId;audio=node;node.preload='none';node.src='/audio/offline/1935c17708c726884ac9.mp3';node.hidden=true;
  const play=node.play.bind(node),pause=node.pause.bind(node),load=node.load.bind(node);
  node.play=function(){log.calls.push({type:'play-call',...state(node,id)});return play();};
  node.pause=function(){log.calls.push({type:'pause-call',...state(node,id)});return pause();};
  node.load=function(){log.calls.push({type:'load-call',...state(node,id)});return load();};
  for(const type of ['loadstart','loadedmetadata','canplay','progress','durationchange','play','playing','pause','seeking','seeked','ratechange','volumechange','ended','error','emptied','abort','timeupdate','waiting','stalled'])node.addEventListener(type,event=>log.events.push({type,trusted:event.isTrusted,createdByAction:records.find(r=>r.id===id)?.createdByAction,...state(node,id)}));
  host.append(node);records.push({node,id,createdByAction:sequence});log.factories.push({now:performance.now(),mediaId:id,createdByAction:sequence,predecessors});return node;};
 controller=createExplicitBundledPlayback(factory,value=>log.changed.push({playing:value,...state()}),()=>log.failed.push(state()),()=>log.confirmed.push(state()),position=>log.calls.push({type:'wrapper-tick',numericPosition:position,...state()}));
 const timer=setInterval(()=>{if(audio)log.samples.push(state());},50);
 window.fixture={state:()=>state(),request(method,rate,target){sequence++;const row={...state(),method,requestedRate:rate,requestedTarget:target??null};log.requests.push(row);if(target===undefined)controller[method](rate);else controller[method](rate,target);row.newMediaId=mediaId;return sequence;},pause(){const p=controller.pause();return {...state(),returnedPosition:p};},snapshot(){return {...log,state:state(),media:mediaState(),storageTouches:window.__storageTouches.slice()};},dispose(){clearInterval(timer);controller.dispose();return {state:state(),media:mediaState()};}};
}
function fixtureHtml(){return '<!doctype html><meta charset="utf-8"><title>Explicit fresh media fixture</title><h1>Real Chrome media fixture</h1><p>No application state or storage.</p><script type="module">import {createExplicitBundledPlayback} from "/wrapper.js";('+browserFixture.toString()+')(createExplicitBundledPlayback);</script>';}
async function fresh(){
 if(context)await context.close();const fixtureId=++fixtureCounter;context=await browser.newContext({viewport:{width:900,height:720},serviceWorkers:'block'});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==report.origin){report.externalRequests.push(u.origin+u.pathname);return route.abort('blockedbyclient');}return route.continue();});
 await context.addInitScript(id=>{window.__fixtureId=id;const touched=[];window.__storageTouches=touched;for(const key of ['indexedDB','localStorage','sessionStorage'])Object.defineProperty(window,key,{configurable:true,get(){touched.push(key);throw Error('Storage forbidden in explicit fixture');}});},fixtureId);
 page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.pageErrors.push(String(e)));page.on('console',m=>{if(m.text().startsWith('Bundled playback '))report.console.push({fixtureId,utc:new Date().toISOString(),text:m.text()});});
 page.on('response',async response=>{if(response.url().includes('.mp3'))report.browserResponses.push({fixtureId,url:response.url(),status:response.status(),requestHeaders:await response.request().allHeaders(),headers:await response.allHeaders()});});
 await page.goto(report.origin+'/',{waitUntil:'load'});await page.waitForFunction(()=>!!window.fixture);
}
async function normalRate(rate,target){
 await fresh();const first=await request('resume',rate,target);await confirmedAfter(first);let log=await page.evaluate(()=>window.fixture.snapshot());
 const initial={target,...positioned(log,first,target,rate),postConfirmationSlope:await steadyAfterConfirmation(first,rate)};
 const oldId=(await state()).mediaId,paused=await page.evaluate(()=>window.fixture.pause());await sleep(2000);const quiet=await state();
 assert(quiet.paused&&quiet.connected);assert.equal(quiet.mediaId,oldId);assert.equal(quiet.position,paused.position);assert(Math.abs(quiet.currentTime-paused.currentTime)<.05);assert(quiet.now-paused.now>=2000);
 const second=await request('resume',rate),pending=await state();assert.notEqual(pending.mediaId,oldId);assert.equal(pending.position,paused.position);await confirmedAfter(second);
 log=await page.evaluate(()=>window.fixture.snapshot());const resumed={target:paused.position,...positioned(log,second,paused.position,rate),postConfirmationSlope:await steadyAfterConfirmation(second,rate)};
 assert(log.media.filter(m=>m.mediaId!==pending.mediaId).every(m=>!m.connected&&m.srcAttribute===null));
 const beforeReplay=await page.evaluate(()=>window.fixture.pause()),replay=await request('play',rate,0);await confirmedAfter(replay);log=await page.evaluate(()=>window.fixture.snapshot());
 const restarted={oldPosition:beforeReplay.position,...positioned(log,replay,0,rate),postConfirmationSlope:await steadyAfterConfirmation(replay,rate)};
 assert(log.requests.length===3&&log.factories.length===3);assert(beforeReplay.position>10);assert(log.events.filter(e=>e.type==='volumechange').every(e=>!e.muted));await page.evaluate(()=>window.fixture.pause());
 const file='rate-'+String(rate).replace('.','_'),final=await evidence(file);assert.equal(final.storageTouches.length,0);const cleanup=await page.evaluate(()=>window.fixture.dispose());assert(cleanup.media.every(m=>!m.connected&&m.srcAttribute===null&&m.paused));
 return {rate,initial,resumed,replay:restarted,pauseIntervalObservedMs:quiet.now-paused.now,quiet,cleanup,evidence:file+'.json'};
}
function rangeResponse(request,response,raw){
 const headers={'Content-Type':'audio/mpeg','Cache-Control':'no-store','Accept-Ranges':'bytes'};let start=0,end=raw.length-1,status=200;
 if(request.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(request.headers.range);if(m){if(m[1]==='')start=Math.max(0,raw.length-Number(m[2]));else{start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;}}if(!m||!Number.isInteger(start)||start<0||start>=raw.length||end<start){headers['Content-Range']='bytes */'+raw.length;headers['Content-Length']=0;response.writeHead(416,headers);response.end();return;}status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+raw.length;}
 const body=raw.subarray(start,end+1);headers['Content-Length']=body.length;const row={fixtureId:fixtureCounter,utc:new Date().toISOString(),method:request.method,path:request.url,requestRange:request.headers.range??null,status,headers,bodySha256:sha(body),bodyBytes:body.length};report.network.push(row);response.writeHead(status,headers);response.end(request.method==='HEAD'?undefined:body);row.sentUtc=new Date().toISOString();
}
async function main(){
 assert(args.includes('--runtime-stable')&&args.includes('--parent-go'),'Refuse execution until root runtimeStable and explicit GO');
 for(const key of Object.keys(paths)){assert(/^[a-f0-9]{64}$/.test(expected[key]||''),'Supply --expect-'+key+'-sha');sourceBytes[key]=await fs.readFile(path.join(ROOT,paths[key]));assert.equal(sha(sourceBytes[key]),expected[key],'Stable source '+key);}
 await fs.mkdir(OUT,{recursive:true});report.output=OUT;report.status='RUNNING';report.sources=Object.fromEntries(Object.keys(paths).map(key=>[key,{path:paths[key],sha256:sha(sourceBytes[key]),bytes:sourceBytes[key].length}]));report.harnessSha256=sha(await fs.readFile(__filename));
 const manifest=JSON.parse(await fs.readFile(path.join(ROOT,'mobile/offline-audio/manifest.json'),'utf8'));media=manifest.clips.find(c=>c.file===MAIN);assert(media);mainBytes=await fs.readFile(path.join(ROOT,'mobile/offline-audio/mp3',MAIN));assert.equal(mainBytes.length,media.bytes);assert.equal(sha(mainBytes),media.sha256);report.media={file:MAIN,bytes:mainBytes.length,sha256:sha(mainBytes),manifestDuration:media.durationSeconds};
 for(const key of ['wrapper','inner']){const result=ts.transpileModule(sourceBytes[key].toString('utf8'),{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}});assert.equal(result.diagnostics?.length||0,0);modules[key]=result.outputText;await fs.writeFile(path.join(OUT,key+'-source.ts'),sourceBytes[key]);}report.compiledFixtureSha256={wrapper:sha(modules.wrapper),inner:sha(modules.inner)};
 const html=fixtureHtml();await fs.writeFile(path.join(OUT,'fixture.html'),html);server=http.createServer((request,response)=>{const p=new URL(request.url,'http://localhost').pathname;if(p==='/'){response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});response.end(html);}else if(p==='/wrapper.js'||p==='/lesson-audio'){response.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});response.end(modules[p==='/wrapper.js'?'wrapper':'inner']);}else if(p===MAIN_PATH)rangeResponse(request,response,mainBytes);else{response.writeHead(404);response.end();}});
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});report.origin='http://127.0.0.1:'+server.address().port;
 let executable;for(const candidate of [process.env.LANTERN_CHROME,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',chromium.executablePath()].filter(Boolean))if(await fs.access(candidate).then(()=>true,()=>false)){executable=candidate;break;}assert(executable,'Existing Chrome required; no install/download');browser=await chromium.launch({headless:true,executablePath:executable,args:['--autoplay-policy=no-user-gesture-required']});report.browser={executable,version:await browser.version(),playwright:req('playwright/package.json').version,autoplay:'Direct API allowed, not product user-gesture proof'};
 await check('1x direct nonzero / two-second pause / fresh resume / fresh replay',()=>normalRate(1,14.376));
 await check('0.85x direct nonzero / two-second pause / fresh resume / fresh replay',()=>normalRate(.85,10.218));
 await check('actual nonzero last 0.4-second natural short tail at 1x',async()=>{await fresh();const target=media.durationSeconds-.4,sequence=await request('resume',1,target);await naturalEndAfter(sequence);const log=await evidence('short-tail-1');assert.equal(log.failed.length,0);assert.equal(log.confirmed.length,1);assert(log.confirmed[0].ended);assert(Math.abs(log.state.position-log.state.duration)<.03);const result=positioned(log,sequence,target,1,true),cleanup=await page.evaluate(()=>window.fixture.dispose());assert(cleanup.media.every(m=>!m.connected&&m.srcAttribute===null));return {...result,target,remainingSeconds:log.state.duration-target,cleanup,evidence:'short-tail-1.json'};});
 await check('actual Range206 / source and asset unchanged / storage isolation',async()=>{assert(report.network.some(r=>r.status===206&&r.requestRange&&r.path===MAIN_PATH));assert(report.browserResponses.some(r=>r.status===206&&new URL(r.url).pathname===MAIN_PATH));assert.equal(report.externalRequests.length,0);assert.equal(report.pageErrors.length,0);for(const key of Object.keys(paths))assert.equal(sha(await fs.readFile(path.join(ROOT,paths[key]))),expected[key]);assert.equal(sha(await fs.readFile(path.join(ROOT,'mobile/offline-audio/mp3',MAIN))),media.sha256);assert.equal((await page.evaluate(()=>window.fixture.snapshot())).storageTouches.length,0);return {sourceUnchanged:true,assetUnchanged:true,server206:report.network.filter(r=>r.status===206&&r.sentUtc).length,browser206:report.browserResponses.filter(r=>r.status===206).length};});
 report.status=report.checks.some(c=>c.status==='FAIL')?'FAIL':'PASS_LIMITED_CHROME_EXPLICIT_PLAYER';if(report.status==='FAIL')process.exitCode=1;
}
main().catch(e=>{report.status='FAIL_TOOL_OR_PRECONDITION';report.error=String(e.stack||e);process.exitCode=1;console.error(e);}).finally(async()=>{
 try{if(context)await context.close();}catch(e){report.cleanup.contextError=String(e);report.status='FAIL_TOOL_CLEANUP';process.exitCode=1;}
 try{if(browser){await browser.close();report.cleanup.browserClosed=true;}}catch(e){report.cleanup.browserError=String(e);report.status='FAIL_TOOL_CLEANUP';process.exitCode=1;}
 if(server){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));report.cleanup.serverClosed=true;}
 report.finishedUtc=new Date().toISOString();report.counts={pass:report.checks.filter(c=>c.status==='PASS').length,fail:report.checks.filter(c=>c.status==='FAIL').length};
 if(await fs.access(OUT).then(()=>true,()=>false)){await write();const inventory=[];for(const name of (await fs.readdir(OUT)).sort()){const p=path.join(OUT,name);if((await fs.stat(p)).isFile()){const bytes=await fs.readFile(p);inventory.push({path:name,bytes:bytes.length,sha256:sha(bytes)});}}await fs.writeFile(path.join(OUT,'SHA256SUMS.json'),JSON.stringify(inventory,null,2)+'\n');}
 console.log(JSON.stringify({status:report.status,counts:report.counts,cleanup:report.cleanup,report:path.join(OUT,'report.json')}));
});
