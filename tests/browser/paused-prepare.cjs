'use strict';
// Real Chrome / real HTMLAudio controller fixture. No StudyApp, database, SDK or device.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const ROOT = path.resolve(__dirname, '../..');
const req = createRequire(path.join(ROOT, 'package.json'));
const {chromium} = req('playwright');
const ts = req('typescript');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const args = process.argv.slice(2);
const expected = args.find(a => a.startsWith('--expect-source-sha='))?.split('=')[1];
const confirmedStable = args.includes('--runtime-stable');
const sourcePath = path.join(ROOT, 'lib/lesson-audio.ts');
const OUT = path.join(ROOT, 'reports/sustain-guard', new Date().toISOString().replaceAll(':', '-') + '-' + crypto.randomBytes(3).toString('hex'));
const report = {revision:'r14-development',scope:'Real Chrome HTMLAudio + current TypeScript controller, isolated fixture', status:'NOT_RUN', startedUtc:new Date().toISOString(),
  limitations:['Not ArkWeb, OS renderer, audible listening, actual Home/exit/cold lifecycle or independent QA.',
    'Fixture calls controller directly; no production state, StudyApp, repository, IndexedDB or localStorage is loaded.',
    'play/seek method wrappers only observe then delegate unchanged native APIs; no forged media events, clocks, currentTime or play promises.',
    'Early-stop negative case uses a real native pause after genuine first progression. It is not a renderer starvation simulation.',
    'Confirmation position includes elapsed playback; <=1 second positioning threshold is measured at native play call and first genuine playing, not by subtracting target from a later confirmation.',
    'Startup waiting is reported separately within the controller total 10-second bound; sustained rate starts from actual advancing timeupdates, not merely a playing event.',
    'The older r13 ~0.7-second post-playing flat media clock and whole-startup assertion failure remain in the old tree; this test does not establish their cause or erase them.'],
  checks:[], network:[], browserResponses:[], console:[], pageErrors:[], externalRequests:[], cleanup:{browserClosed:false,serverClosed:false}};
let server, browser, context, page, sourceBytes, mainBytes, shortBytes, fixtureCounter=0;
const sockets = new Set(), pending = new Set();
async function write() {await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');}
async function until(fn, label, timeout=12000) {const end=Date.now()+timeout;let last;do{try{const v=await fn();if(v)return v;}catch(e){last=e;}await sleep(35);}while(Date.now()<end);throw Error(label+(last?': '+last:''));}
async function check(name, fn) {const start=Date.now();try{const details=await fn();report.checks.push({name,status:'PASS',elapsedMs:Date.now()-start,details});console.log(JSON.stringify({name,status:'PASS'}));}
  catch(e){const failureEvidence='failure-'+String(report.checks.length+1);if(page)await evidence(failureEvidence).catch(()=>{});report.checks.push({name,status:'FAIL',elapsedMs:Date.now()-start,error:String(e.stack||e),evidence:failureEvidence+'.json'});console.log(JSON.stringify({name,status:'FAIL',error:String(e)}));}
  await write();}
async function evidence(name) {const value=await page.evaluate(()=>window.fixture.snapshot());await fs.writeFile(path.join(OUT,name+'.json'),JSON.stringify(value,null,2)+'\n');return value;}
async function fresh(source='main', behavior={}) {
  if(context)await context.close();
  const fixtureId=++fixtureCounter;
  context=await browser.newContext({viewport:{width:900,height:720},serviceWorkers:'block'});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==report.origin){report.externalRequests.push(u.origin+u.pathname);return route.abort('blockedbyclient');}return route.continue();});
  await context.addInitScript(()=>{
    const touched=[];window.__storageTouches=touched;
    for(const key of ['indexedDB','localStorage','sessionStorage'])Object.defineProperty(window,key,{configurable:true,get(){touched.push(key);throw Error('Storage forbidden in controller fixture');}});
  });
  page=await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',e=>report.pageErrors.push(String(e)));
  page.on('console',m=>{if(m.text().startsWith('Bundled playback '))report.console.push({fixtureId,utc:new Date().toISOString(),text:m.text()});});
  page.on('response',async response=>{if(response.url().includes('.mp3'))report.browserResponses.push({fixtureId,url:response.url(),status:response.status(),requestHeaders:await response.request().allHeaders(),headers:await response.allHeaders()});});
  await page.goto(report.origin+'/',{waitUntil:'load'});
  await page.waitForFunction(()=>!!window.fixture);
  await page.evaluate(({source,behavior,fixtureId})=>window.fixture.create(source,behavior,fixtureId),{source,behavior,fixtureId});
}
async function state(){return page.evaluate(()=>window.fixture.state());}
async function request(method,rate,target) {
  return page.evaluate(({method,rate,target})=>window.fixture.request(method,rate,target),{method,rate,target});
}
async function confirmedAfter(sequence) {await until(async()=>{const s=await page.evaluate(()=>window.fixture.snapshot());if(s.failed.length)throw Error('Controller failed: '+JSON.stringify(s.failed));return s.confirmed.some(c=>c.requestSequence===sequence);},'real sustained playback confirmation');return state();}
async function naturalEndAfter(sequence) {await until(async()=>{const log=await page.evaluate(()=>window.fixture.snapshot());return log.state.ended&&log.events.some(e=>e.requestSequence===sequence&&e.type==='ended'&&e.trusted);},'actual natural ended event and completed event handlers',5000);return page.evaluate(()=>window.fixture.snapshot());}
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
async function normalRate(rate,target) {
  await fresh();const identity=(await state()).mediaId;
  const resume=[];
  for(let i=0;i<3;i++){
    const t=i===0?target:(await state()).position;
    const sequence=await request('resume',rate,i===0?target:undefined);await confirmedAfter(sequence);
    const log=await page.evaluate(()=>window.fixture.snapshot());const postConfirmationSlope=await steadyAfterConfirmation(sequence,rate);const end=await state();
    assert.equal(end.mediaId,identity);assert.equal(end.paused,false);assert.equal(end.rate,rate);
    const paused=await page.evaluate(()=>window.fixture.pause());assert(paused.position>=t);assert(Math.abs(paused.position-paused.currentTime)<.1);
    resume.push({iteration:i+1,target:t,...positioning(log,sequence,t,rate),postConfirmationSlope,paused});
    await sleep(180);const quiet=await state();assert.equal(quiet.paused,true);assert.equal(quiet.position,paused.position);
  }
  const old=(await state()).position,sequence=await request('play',rate,0);await confirmedAfter(sequence);
  const replayLog=await page.evaluate(()=>window.fixture.snapshot());const replay={...positioning(replayLog,sequence,0,rate),postConfirmationSlope:await steadyAfterConfirmation(sequence,rate)};assert(old>10);await page.evaluate(()=>window.fixture.pause());
  const log=await evidence('rate-'+String(rate).replace('.','_'));assert.equal(log.storageTouches.length,0);assert(log.events.filter(e=>e.type==='volumechange').every(e=>!e.muted));
  return {rate,initialTarget:target,mediaId:identity,resume,replay,oldPositionBeforeReplay:old,evidence:'rate-'+String(rate).replace('.','_')+'.json'};
}
function fixtureHtml(code) {return '<!doctype html><meta charset="utf-8"><title>Paused prepare real media fixture</title><body><h1>Real HTMLAudio controller fixture</h1><p>No application state or storage.</p><script type="module">'+code+`\n
  const log={events:[],calls:[],changed:[],failed:[],confirmed:[],requests:[],samples:[]};let audio,controller,sequence=0,mediaId=0,timer,behavior={},fixtureId;
  const ranges=r=>Array.from({length:r.length},(_,i)=>[r.start(i),r.end(i)]);
  const state=()=>({now:performance.now(),utc:new Date().toISOString(),fixtureId,mediaId,requestSequence:sequence,currentTime:audio.currentTime,duration:Number.isFinite(audio.duration)?audio.duration:null,paused:audio.paused,seeking:audio.seeking,ended:audio.ended,muted:audio.muted,rate:audio.playbackRate,mediaErrorCode:audio.error?.code??null,readyState:audio.readyState,source:audio.currentSrc||audio.src,seekable:ranges(audio.seekable),position:controller?.position()??null});
  window.fixture={create(source,options,id){fixtureId=id;behavior=options;audio=new Audio();mediaId++;audio.controls=true;audio.preload='none';audio.src='/'+source+'.mp3?fixture='+fixtureId;document.body.append(audio);
    const play=audio.play.bind(audio),load=audio.load.bind(audio),pause=audio.pause.bind(audio);
    audio.play=function(){log.calls.push({type:'play-call',...state()});return play();};
    audio.load=function(){log.calls.push({type:'load-call',...state()});return load();};
    audio.pause=function(){log.calls.push({type:'pause-call',...state()});return pause();};
    let playing=false,stoppedEarly=false,firstPlayingPosition=0;
    for(const type of ['loadstart','loadedmetadata','canplay','progress','durationchange','play','playing','pause','seeking','seeked','ratechange','volumechange','ended','error','emptied','abort','timeupdate','waiting','stalled'])audio.addEventListener(type,e=>{
      log.events.push({type,trusted:e.isTrusted,...state()});if(type==='playing'){playing=true;firstPlayingPosition=audio.currentTime;}
      if(behavior.stopAfterFirstProgress&&!stoppedEarly&&playing&&type==='timeupdate'&&audio.currentTime>firstPlayingPosition+.005){stoppedEarly=true;log.calls.push({type:'real-early-stop',...state()});audio.pause();}
    });
    controller=createBundledPlayback(audio,value=>log.changed.push({playing:value,...state()}),()=>log.failed.push(state()),()=>log.confirmed.push(state()));
    timer=setInterval(()=>log.samples.push(state()),50);return state();},state,
    request(method,rate,target){sequence++;log.requests.push({...state(),method,requestedRate:rate,requestedTarget:target??null});if(target===undefined)controller[method](rate);else controller[method](rate,target);return sequence;},
    pause(reload=false){const p=controller.pause(reload);return {...state(),returnedPosition:p};},
    changeSource(){audio.src='/other.mp3?fixture='+fixtureId;audio.load();},reload(){audio.load();},
    snapshot(){return {...log,state:state(),storageTouches:window.__storageTouches.slice()};},dispose(){clearInterval(timer);controller.dispose();}};
  </script></body>`;}
function rangeResponse(request,response,raw,mode){
  const headers={'Content-Type':'audio/mpeg','Cache-Control':'no-store','Accept-Ranges':'bytes'};let start=0,end=raw.length-1,status=200;
  if(request.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(request.headers.range);if(m){if(m[1]===''){start=Math.max(0,raw.length-Number(m[2]));}else{start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;}}if(!m||!Number.isInteger(start)||start<0||start>=raw.length||end<start){headers['Content-Range']='bytes */'+raw.length;headers['Content-Length']=0;response.writeHead(416,headers);response.end();return;}status=206;headers['Content-Range']=`bytes ${start}-${end}/${raw.length}`;}
  const body=raw.subarray(start,end+1);headers['Content-Length']=body.length;
  const requestUrl=new URL(request.url,'http://localhost');const row={fixtureId:Number(requestUrl.searchParams.get('fixture')),utc:new Date().toISOString(),method:request.method,path:requestUrl.pathname,url:request.url,requestRange:request.headers.range??null,status,headers,bodySha256:sha(body),mode};report.network.push(row);
  const send=()=>{pending.delete(response);if(response.destroyed)return;response.writeHead(status,headers);response.end(request.method==='HEAD'?undefined:body);row.sentUtc=new Date().toISOString();};
  if(mode==='timeout'){pending.add(response);response.on('close',()=>pending.delete(response));return;}
  if(mode==='delayed'){pending.add(response);const timer=setTimeout(send,1000);response.on('close',()=>{clearTimeout(timer);pending.delete(response);});return;}send();
}
async function main(){
  assert(confirmedStable,'Refusing formal execution without parent runtimeStable signal: pass --runtime-stable');
  assert(expected&&/^[a-f0-9]{64}$/.test(expected),'Supply --expect-source-sha=<stable lib/lesson-audio.ts SHA256>');
  sourceBytes=await fs.readFile(sourcePath);assert.equal(sha(sourceBytes),expected,'Stable controller source SHA');
  await fs.mkdir(OUT,{recursive:true});report.status='RUNNING';report.output=OUT;report.controller={path:'lib/lesson-audio.ts',sha256:sha(sourceBytes),bytes:sourceBytes.length};report.harnessSha256=sha(await fs.readFile(__filename));
  const manifest=JSON.parse(await fs.readFile(path.join(ROOT,'mobile/offline-audio/manifest.json'),'utf8'));
  const main=manifest.clips.find(c=>c.file==='1935c17708c726884ac9.mp3');const short=manifest.clips.find(c=>c.file==='e53657178cb6855ac4b2.mp3');
  mainBytes=await fs.readFile(path.join(ROOT,'mobile/offline-audio/mp3',main.file));shortBytes=await fs.readFile(path.join(ROOT,'mobile/offline-audio/mp3',short.file));
  assert.equal(sha(mainBytes),main.sha256);assert.equal(sha(shortBytes),short.sha256);report.media={main:{file:main.file,bytes:mainBytes.length,sha256:sha(mainBytes),manifestDuration:main.durationSeconds},short:{file:short.file,bytes:shortBytes.length,sha256:sha(shortBytes),manifestDuration:short.durationSeconds}};
  const transpiled=ts.transpileModule(sourceBytes.toString('utf8'),{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}});assert.equal((transpiled.diagnostics||[]).length,0);report.compiledFixtureSha256=sha(transpiled.outputText);
  const html=fixtureHtml(transpiled.outputText);await fs.writeFile(path.join(OUT,'fixture.html'),html);await fs.writeFile(path.join(OUT,'controller-source.ts'),sourceBytes);
  server=http.createServer((request,response)=>{const p=new URL(request.url,'http://localhost').pathname;if(p==='/'){response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});response.end(html);}else if(['/main.mp3','/other.mp3','/delayed.mp3','/timeout.mp3','/short.mp3'].includes(p)){rangeResponse(request,response,p==='/short.mp3'?shortBytes:mainBytes,p==='/delayed.mp3'?'delayed':p==='/timeout.mp3'?'timeout':'normal');}else{response.writeHead(404);response.end();}});
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});report.origin='http://127.0.0.1:'+server.address().port;
  let executable;for(const p of [process.env.LANTERN_CHROME,String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,chromium.executablePath()].filter(Boolean))if(await fs.access(p).then(()=>true,()=>false)){executable=p;break;}assert(executable,'Existing Chrome required; no install/download');
  browser=await chromium.launch({headless:true,executablePath:executable,args:['--autoplay-policy=no-user-gesture-required']});report.browser={executable,version:await browser.version(),playwright:req('playwright/package.json').version,autoplay:'Fixture deliberately allows controller calls; not proof of product user gesture policy'};
  await check('new Audio 1x nonzero + two same-element resumes + explicit replay',()=>normalRate(1,14.376));
  await check('new Audio 0.85x nonzero + two same-element resumes + explicit replay',()=>normalRate(.85,10.218));
  await check('real source/load replacement cancels pending metadata and preserves target',async()=>{await fresh('delayed');await request('resume',1,14.376);await page.evaluate(()=>window.fixture.changeSource());await until(async()=>(await state()).paused,'source replacement quiet');await sleep(1300);const log=await evidence('source-replacement');assert.equal(log.confirmed.length,0);assert.equal(log.calls.filter(c=>c.type==='play-call').length,0);assert.equal(log.state.position,14.376);assert(log.failed.length>=1);return {evidence:'source-replacement.json',state:log.state,failures:log.failed};});
  await check('explicit pause/reload cancels late load without autoplay or checkpoint loss',async()=>{await fresh('delayed');await request('resume',.85,10.218);await page.evaluate(()=>{window.fixture.pause(true);window.fixture.reload();});await sleep(1600);const log=await evidence('pause-load-cancel');assert.equal(log.confirmed.length,0);assert.equal(log.failed.length,0);assert.equal(log.calls.filter(c=>c.type==='play-call').length,0);assert(log.state.paused);assert.equal(log.state.position,10.218);return {evidence:'pause-load-cancel.json',state:log.state};});
  await check('real no-metadata network timeout preserves nonzero checkpoint',async()=>{await fresh('timeout');await request('resume',.85,10.218);await until(async()=>{const log=await page.evaluate(()=>window.fixture.snapshot());return log.failed.length;},'bounded controller timeout',12500);const log=await evidence('timeout');assert.equal(log.confirmed.length,0);assert.equal(log.state.position,10.218);assert(log.state.paused);assert.equal(log.calls.filter(c=>c.type==='play-call').length,0);return {evidence:'timeout.json',state:log.state,failures:log.failed};});
  await check('first genuine short progression then real pause cannot confirm',async()=>{await fresh('main',{stopAfterFirstProgress:true});await request('resume',1,14.376);await until(async()=>{const log=await page.evaluate(()=>window.fixture.snapshot());return log.calls.some(c=>c.type==='real-early-stop');},'first genuine progress followed by native pause');await sleep(1100);const log=await evidence('early-progress-stop');assert(log.events.some(e=>e.type==='timeupdate'&&e.currentTime>14.376&&e.trusted&&!e.paused));assert.equal(log.confirmed.length,0);assert.equal(log.failed.length,0);assert.equal(log.state.position,14.376);assert(log.state.paused);return {evidence:'early-progress-stop.json',stop:log.calls.find(c=>c.type==='real-early-stop'),state:log.state};});
  for(const rate of [1,.85])await check('short actual 1.049-second packaged clip remains playable at '+rate+'x',async()=>{await fresh('short');const sequence=await request('play',rate,0);await naturalEndAfter(sequence);const log=await evidence('short-'+rate);assert(Math.abs(log.state.duration-short.durationSeconds)<.03);assert.equal(log.failed.length,0,'A fully played short clip must not become controller error');assert.equal(log.confirmed.length,1,'Short clip must retain usable confirmed playback');const result=positioning(log,sequence,0,rate,{shortEnd:!!log.confirmed[0].ended});return {evidence:'short-'+rate+'.json',...result,ended:log.state};});
  for(const rate of [1,.85])await check('nonzero paused seek to actual last 0.4 seconds naturally ends at '+rate+'x',async()=>{await fresh('main');const target=main.durationSeconds-.4,sequence=await request('resume',rate,target);await naturalEndAfter(sequence);const log=await evidence('short-tail-'+rate);assert.equal(log.failed.length,0,'A genuinely progressing natural short tail must not fail');assert.equal(log.confirmed.length,1,'Short tail needs confirmation from progression plus natural end');assert(log.confirmed[0].ended);assert(Math.abs(log.state.position-log.state.duration)<.03);const result=positioning(log,sequence,target,rate,{shortEnd:true});return {evidence:'short-tail-'+rate+'.json',target,remainingSeconds:log.state.duration-target,...result,ended:log.state};});
  await check('real Range206 and immutable source/assets/storage isolation',async()=>{assert(report.network.some(r=>r.status===206&&r.requestRange&&r.path==='/main.mp3'));assert(report.browserResponses.some(r=>r.status===206&&r.url.includes('/main.mp3')));assert.equal(report.externalRequests.length,0);assert.equal(report.pageErrors.length,0);assert.equal(sha(await fs.readFile(sourcePath)),expected);assert.equal(sha(await fs.readFile(path.join(ROOT,'mobile/offline-audio/mp3',main.file))),main.sha256);assert.equal(sha(await fs.readFile(path.join(ROOT,'mobile/offline-audio/mp3',short.file))),short.sha256);return {controllerUnchanged:true,mediaUnchanged:true,range206:{browserActuallyObserved:report.browserResponses.filter(r=>r.status===206).length,serverCompleted:report.network.filter(r=>r.status===206&&r.sentUtc).length,serverPlanned:report.network.filter(r=>r.status===206).length}};});
  report.status=report.checks.some(c=>c.status==='FAIL')?'FAIL':'PASS_LIMITED_CHROME_CONTROLLER';if(report.status==='FAIL')process.exitCode=1;
}
main().catch(e=>{report.status='FAIL_TOOL_OR_PRECONDITION';report.error=String(e.stack||e);process.exitCode=1;console.error(e);}).finally(async()=>{
  try{if(context)await context.close();}catch(e){report.cleanup.contextError=String(e);report.status='FAIL_TOOL_CLEANUP';process.exitCode=1;}
  try{if(browser){await browser.close();report.cleanup.browserClosed=true;}}catch(e){report.cleanup.browserError=String(e);report.status='FAIL_TOOL_CLEANUP';process.exitCode=1;}
  if(server){for(const response of pending)response.destroy();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));report.cleanup.serverClosed=true;}
  report.finishedUtc=new Date().toISOString();report.counts={pass:report.checks.filter(c=>c.status==='PASS').length,fail:report.checks.filter(c=>c.status==='FAIL').length};
  if(await fs.access(OUT).then(()=>true,()=>false)){await write();const inventory=[];for(const name of (await fs.readdir(OUT)).sort()){const p=path.join(OUT,name);if((await fs.stat(p)).isFile()){const bytes=await fs.readFile(p);inventory.push({path:name,bytes:bytes.length,sha256:sha(bytes)});}}await fs.writeFile(path.join(OUT,'SHA256SUMS.json'),JSON.stringify(inventory,null,2)+'\n');}
  console.log(JSON.stringify({status:report.status,counts:report.counts,cleanup:report.cleanup,report:path.join(OUT,'report.json')}));
});
