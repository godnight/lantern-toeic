/* Independent QA only. Never load production or an existing browser profile. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const {createRequire} = require('node:module');
const repoCandidates = [process.env.LANTERN_THEME_QA_REPO, path.resolve(__dirname, '../..'), path.resolve(__dirname, '../site'), path.resolve(__dirname, '../../theme-redesign-20261012/site')].filter(Boolean);
const REPO = repoCandidates.find(candidate => require('node:fs').existsSync(path.join(candidate, 'app/study-app.tsx')));
if (!REPO) throw new Error('Set LANTERN_THEME_QA_REPO to the repository containing app/study-app.tsx');
const repoRequire = createRequire(path.join(REPO, 'package.json'));
const {chromium} = repoRequire('playwright');
const UI_THEME_ORDER=['paper','crystal','hollow','silk','whale-bay','whale-moon'];
const UI_THEME_BY_PERSISTED={paper:'day',crystal:'night',hollow:'hollow',silk:'silk','whale-bay':'whale-bay','whale-moon':'whale-moon'};
const UI_THEME_META={paper:{name:'日间'},crystal:{name:'夜间'},hollow:{name:'空洞骑士'},silk:{name:'丝之歌'},'whale-bay':{name:'咕噜海湾'},'whale-moon':{name:'澜音星海'}};
const EXPECTED_COLORS={paper:['rgb(245, 245, 245)','rgb(37, 38, 38)'],crystal:['rgb(24, 26, 25)','rgb(237, 240, 238)'],hollow:['rgb(16, 24, 32)','rgb(236, 241, 244)'],silk:['rgb(32, 24, 34)','rgb(242, 233, 228)'],'whale-bay':['rgb(244, 241, 233)','rgb(33, 54, 66)'],'whale-moon':['rgb(15, 27, 48)','rgb(237, 243, 249)']};

const MODE=process.argv.includes('--web')?'web':process.env.LANTERN_THEME_QA_MODE||'native';
assert.ok(['native','web'].includes(MODE),'LANTERN_THEME_QA_MODE must be native or web');
const PORT = Number(process.env.LANTERN_THEME_QA_PORT || (MODE==='web'?4188:4187));
assert.ok(Number.isInteger(PORT) && PORT >= 1024 && PORT <= 65535, 'Invalid local QA port');
const ORIGIN = `http://127.0.0.1:${PORT}`;
const NATIVE_ORIGIN='https://lantern.local';
const nativeUser={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'theme_qa_synthetic'};
let OUT;
const report = {scope:'Controlled navigation scenes and palettes in isolated '+MODE+' browser fixture',mode:MODE,origin:MODE==='native'?NATIVE_ORIGIN:ORIGIN,
  limitations:['Desktop Chrome and a synthetic native host/session are not physical-device or ArkWeb acceptance.', 'Web mode uses a synthetic authenticated component fixture; native mode reads the built Shared assets through a controlled origin.', 'Screenshot inspection remains a separate visual review step.'],
  startedAt:new Date().toISOString(),steps:[],screenshots:[],pageErrors:[],consoleErrors:[],blockedExternal:[],httpErrors:[]};
let browser, context, page, preview, nativeHost, cleanupPromise;
let ownsOutput = false;
const ownerToken = crypto.randomBytes(24).toString('hex');
let QA_OWNER=MODE==='native'?nativeUser.id:null,authFixture,authUser;
let webFixture;
let mockCalls=[];

async function allocateOutput() {
  if (process.env.LANTERN_THEME_QA_DIR) {
    OUT = path.resolve(process.env.LANTERN_THEME_QA_DIR);
    await fs.mkdir(path.dirname(OUT), {recursive:true});
    // Explicit output must be new: never truncate existing reports or user files.
    await fs.mkdir(OUT);
  } else OUT = await fs.mkdtemp(path.join(os.tmpdir(),'lantern-theme-browser-'));
  ownsOutput = true;
}
async function launchBrowser() {
  const override = process.env.LANTERN_BROWSER_EXECUTABLE;
  let executablePath;
  if (override) { executablePath = path.resolve(override); await fs.access(executablePath); }
  else {
    const bundled = await fs.access(chromium.executablePath()).then(()=>true,()=>false);
    if (!bundled && process.platform === 'win32') {
      for (const directory of [process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA]) {
        if (!directory) continue;
        const candidate = path.join(directory,'Google/Chrome/Application/chrome.exe');
        if (await fs.access(candidate).then(()=>true,()=>false)) {executablePath=candidate;break;}
      }
    }
    if (!bundled && !executablePath) throw new Error('Playwright Chromium is missing. Install it separately with npx playwright install chromium; this test never installs browsers.');
  }
  report.browser = {executable:executablePath || chromium.executablePath(),playwright:repoRequire('playwright/package.json').version};
  return chromium.launch({...(executablePath ? {executablePath} : {}),headless:true});
}
async function prepareWebFixture(){
 process.env.LANTERN_REVIEW_ROOT=REPO;authFixture=repoRequire('./tests/helpers/product-auth-harness.cjs').environment();authUser=await authFixture.register('themeqa_'+ownerToken.slice(0,12));QA_OWNER=authUser.id;const proof=await authFixture.call('session','GET',{cookie:authUser.cookie,headers:{'X-Lantern-Session-Proof':'2'}});assert.equal(proof.status,200);const proofBody=await proof.json();assert.equal(proofBody.user.id,QA_OWNER);assert.equal(proofBody.session.version,2);assert.ok(proofBody.session.remainingMs>0);
 const directory=path.join(OUT,'web-fixture');await fs.mkdir(directory);
 const posix=file=>file.replaceAll('\\','/');
 const entry=`import React from ${JSON.stringify(posix(repoRequire.resolve('react')))};
import {createRoot} from ${JSON.stringify(posix(repoRequire.resolve('react-dom/client')))};
import StudyApp from ${JSON.stringify(posix(path.join(REPO,'app/study-app.tsx')))};
import ${JSON.stringify(posix(path.join(REPO,'app/style-entry.ts')))};
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(StudyApp,{owner:${JSON.stringify(QA_OWNER)},remoteLearningEnabled:true})));
`;
 await fs.writeFile(path.join(directory,'entry.tsx'),entry,{flag:'wx'});
 await fs.writeFile(path.join(directory,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>',{flag:'wx'});
 const config=`import react from ${JSON.stringify(pathToFileURL(repoRequire.resolve('@vitejs/plugin-react')).href)};
import tailwind from ${JSON.stringify(pathToFileURL(repoRequire.resolve('@tailwindcss/postcss')).href)};
export default {root:${JSON.stringify(directory)},base:'./',publicDir:${JSON.stringify(path.join(REPO,'public'))},plugins:[react()],css:{postcss:{plugins:[tailwind()]}},resolve:{alias:{'@':${JSON.stringify(REPO)}},dedupe:['react','react-dom']},build:{outDir:'dist',emptyOutDir:true}};
`;
 const configFile=path.join(directory,'vite.config.mjs');await fs.writeFile(configFile,config,{flag:'wx'});
 report.webFixture={syntheticOwner:QA_OWNER,directory,studyAppSha256:crypto.createHash('sha256').update(await fs.readFile(path.join(REPO,'app/study-app.tsx'))).digest('hex'),nativeMode:false,api:'Actual registration/password verification/session and study/vocabulary routes with synthetic Node SQLite+D1 I/O adapter; cookie kept in test Node process only'};
 report.limitations.push('Web fixture explicitly enables the optional remote-learning path to test authenticated theme persistence; that opt-in does not mean cloud sync is enabled for users. It uses real product registered-cookie/session proof with synthetic SQLite/R2 I/O. Browser routes forward that context cookie only in Node; no real HTTPS, deployed Worker, SSR, SMS or real account claim.');
 return{configFile,directory};
}
async function startPreview() {
 if(MODE==='web')webFixture=await prepareWebFixture();
 else await fs.access(path.join(REPO,'mobile/dist/index.html')).catch(()=>{throw new Error('Build the shared production frontend first: npm --prefix mobile run build');});
  // Friendly early failure, followed by strictPort inside the actual Vite process.
  await new Promise((resolve,reject)=>{
    const probe=net.createServer(); probe.once('error',error=>reject(new Error(`Local QA port ${PORT} is unavailable: ${error.code}`)));
    probe.listen({host:'127.0.0.1',port:PORT,exclusive:true},()=>probe.close(resolve));
  });
  const config = {vite:pathToFileURL(repoRequire.resolve('vite')).href,configFile:webFixture?.configFile||path.join(REPO,'mobile/vite.config.ts'),buildFirst:MODE==='web',port:PORT,token:ownerToken};
  const worker = `const c=JSON.parse(process.argv[1]); (async()=>{const {build,preview}=await import(c.vite);if(c.buildFirst)await build({configFile:c.configFile,configLoader:'native',logLevel:'error'});const server=await preview({configFile:c.configFile,...(c.buildFirst?{configLoader:'native'}:{}),logLevel:'error',preview:{host:'127.0.0.1',port:c.port,strictPort:true,open:false},plugins:[{name:'lantern-owned-qa-preview',configurePreviewServer(s){s.middlewares.use((req,res,next)=>{res.setHeader('X-Lantern-QA-Owner',c.token);next();});}}]});process.send({ready:true,pid:process.pid}); const close=()=>server.httpServer.close(()=>process.exit(0)); process.on('SIGTERM',close); process.on('SIGINT',close);})().catch(error=>{console.error(error.stack||error);process.exit(1);});`;
  preview = spawn(process.execPath,['-e',worker,JSON.stringify(config)],{cwd:REPO,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true,detached:process.platform!=='win32'});
  let logs=''; const capture=data=>{logs=(logs+data.toString()).slice(-12000);}; preview.stdout.on('data',capture);preview.stderr.on('data',capture);
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Owned Vite preview did not become ready: '+logs)),120000);
    preview.once('error',error=>{clearTimeout(timeout);reject(error);});
    preview.once('exit',(code,signal)=>{clearTimeout(timeout);reject(new Error(`Owned Vite preview exited (${code}/${signal}): ${logs}`));});
    preview.once('message',message=>{if(message?.ready && message.pid===preview.pid){clearTimeout(timeout);resolve();}else{clearTimeout(timeout);reject(new Error('Unexpected preview readiness message'));}});
  });
  const response=await fetch(ORIGIN+'/',{signal:AbortSignal.timeout(10000),redirect:'error'});
  assert.equal(response.status,200,'Owned preview did not return HTML');
  assert.equal(response.headers.get('x-lantern-qa-owner'),ownerToken,'Port belongs to another process; refusing to test it');
  assert.equal(preview.exitCode,null); assert.equal(preview.signalCode,null);
  report.preview={pid:preview.pid,origin:ORIGIN,ownershipVerified:true,htmlSha256:crypto.createHash('sha256').update(await response.text()).digest('hex')};
}
async function stopPreview() {
  if(!preview || preview.exitCode!==null || preview.signalCode!==null || !preview.pid)return;
  const exited=new Promise(resolve=>preview.once('exit',resolve));
  if(process.platform==='win32') {
    // Only the still-live child spawned by this test; never kill by port/name.
    await new Promise(resolve=>{
      const kill=spawn('taskkill.exe',['/PID',String(preview.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
      let finished=false;
      const finish=()=>{if(finished)return;finished=true;clearTimeout(timeout);resolve();};
      const timeout=setTimeout(()=>{
        report.cleanupWarnings ||= [];report.cleanupWarnings.push('taskkill helper exceeded 5 seconds; stopped helper and continuing bounded child fallback');
        try{kill.kill('SIGKILL');}catch{}finish();
      },5000);
      timeout.unref();kill.unref();kill.once('error',finish);kill.once('exit',finish);
    });
  } else {try{process.kill(-preview.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}}
  let done=false; void exited.then(()=>{done=true;});
  await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,2000))]);
  if(!done && preview.exitCode===null && preview.signalCode===null) {
    if(process.platform==='win32') {report.cleanupWarnings ||= [];report.cleanupWarnings.push('Falling back to direct preview SIGKILL; descendant termination is not confirmed.');}
    if(process.platform==='win32')preview.kill('SIGKILL');else{try{process.kill(-preview.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
    await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,2000))]);
  }
  report.previewStopped=preview.exitCode!==null || preview.signalCode!==null;
  if(!report.previewStopped)throw new Error('Owned preview process did not stop');
}
async function cleanup() {
  return cleanupPromise ||= (async()=>{
    try{
      nativeHost?.dispose();nativeHost=undefined;
      if(browser)await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Browser close exceeded 10 seconds')),10000);
        Promise.resolve(browser.close()).then(resolve,reject).finally(()=>clearTimeout(timeout));
      });
    }finally{try{await stopPreview();}finally{authFixture?.close();}}
  })();
}
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{
  const code=signal==='SIGINT'?130:143;
  void cleanup().catch(error=>{report.cleanupError=String(error);}).finally(async()=>{
    report.status='interrupted';report.signal=signal;report.finishedAt=new Date().toISOString();
    if(ownsOutput)await fs.writeFile(path.join(OUT,'interrupted.json'),JSON.stringify(report,null,2),{flag:'wx'}).catch(()=>{});
    process.exit(code);
  });
});



const WIDTHS=[390,940];
const PALETTES=[...UI_THEME_ORDER];
let paletteSamples=[];
async function step(name,action){const began=Date.now();try{const details=await action();report.steps.push({name,status:'passed',elapsedMs:Date.now()-began,...(details===undefined?{}:{details})});console.log(JSON.stringify({step:name,status:'passed'}));}catch(error){report.steps.push({name,status:'failed',elapsedMs:Date.now()-began,error:String(error.stack||error)});throw error;}}
async function eventually(check,message,timeout=15000){const end=Date.now()+timeout;let last;do{try{const result=await check();if(result)return result;}catch(error){last=error;}await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<end);throw new Error(message+(last?': '+last.message:''));}
async function screenshot(name,{fullPage=true}={}){const file=path.join(OUT,name+'.png');await page.screenshot({path:file,fullPage,animations:'disabled'});report.screenshots.push(file);return file;}
async function blueLakeViewportScreenshot(){
 const scene=page.locator('[data-scene="todayRest"][data-scene-source="hollow-lake"]');
 const saved=await page.evaluate(()=>({x:scrollX,y:scrollY})),originalViewport=page.viewportSize();
 const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 try{
  await page.setViewportSize({width:390,height:844});await frames();
  await scene.locator('img').evaluate(image=>image.decode());
  await scene.scrollIntoViewIfNeeded();
  await scene.evaluate(element=>{
   const rect=element.getBoundingClientRect(),header=document.querySelector('.workspace-topbar'),nav=document.querySelector('.workspace-mobile-nav');
   const top=Math.max(0,header?.getBoundingClientRect().bottom??0);
   const bottom=nav&&getComputedStyle(nav).position==='fixed'?Math.min(innerHeight,nav.getBoundingClientRect().top):innerHeight;
   scrollTo({top:Math.max(0,scrollY+rect.top-top-(bottom-top-rect.height)/2),behavior:'instant'});
  });
  await frames();
  const geometry=await scene.evaluate(element=>{
   const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
   const image=element.querySelector('img'),nav=document.querySelector('.workspace-mobile-nav'),header=document.querySelector('.workspace-topbar');
   return{scene:box(element),image:box(image),nav:box(nav),header:box(header),navFixed:!!nav&&getComputedStyle(nav).position==='fixed',viewport:{width:innerWidth,height:innerHeight,visualHeight:visualViewport?.height??innerHeight},scrollX,scrollY,source:new URL(image.currentSrc).pathname,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,fit:getComputedStyle(image).objectFit};
  });
  assert.equal(geometry.source,'/design-r1/hollow-lake.webp');assert.equal(geometry.naturalWidth,1672);assert.equal(geometry.naturalHeight,941);assert.equal(geometry.fit,'contain');
  const top=Math.max(0,geometry.header?.bottom??0),bottom=geometry.navFixed?Math.min(geometry.viewport.height,geometry.nav.top):geometry.viewport.height;
  assert.ok(geometry.image.top>=top-1&&geometry.image.bottom<=bottom+1,'Blue lake is covered by fixed navigation/header: '+JSON.stringify(geometry));
  assert.ok(geometry.image.left>=-1&&geometry.image.right<=geometry.viewport.width+1,'Blue lake exceeds viewport width');
  assert.ok(Math.abs(geometry.scene.width/geometry.scene.height-2)<.025,'Blue lake frame must retain the approved 2:1 window');
  const file=await screenshot('hollow-blue-lake-viewport-390',{fullPage:false});
  report.blueLakeViewports??=[];report.blueLakeViewports.push({file,fullPage:false,geometry});
  return geometry;
 }finally{await page.setViewportSize(originalViewport);await page.evaluate(saved=>scrollTo({left:saved.x,top:saved.y,behavior:'instant'}),saved);await frames();}
}
async function homeViewportScreenshot(id,width,height){
 const originalViewport=page.viewportSize(),saved=await page.evaluate(()=>({x:scrollX,y:scrollY}));
 const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 try{
  await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo({top:0,left:0,behavior:'instant'}));await frames();
  await eventually(async()=>await page.locator('.workflow-resume .button.primary,.v040-word-action .button.primary').count()>0,'Today primary learning action did not mount');
  const geometry=await page.evaluate(()=>{
   const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
   const nav=document.querySelector('.workspace-mobile-nav'),header=document.querySelector('.workspace-topbar');
   const top=Math.max(0,header?.getBoundingClientRect().bottom??0),bottom=nav&&getComputedStyle(nav).position==='fixed'?Math.min(innerHeight,nav.getBoundingClientRect().top):innerHeight;
   const actions=[...document.querySelectorAll('.workflow-resume .button.primary,.v040-word-action .button.primary')].filter(e=>e.getClientRects().length&&!e.disabled).map(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{text:e.textContent.trim(),rect:box(e),reachable:hit===e||e.contains(hit)};});
   return{viewport:{width:innerWidth,height:innerHeight},scrollX,scrollY,header:box(header),nav:box(nav),usableTop:top,usableBottom:bottom,actions};
  });
  assert.equal(geometry.viewport.width,width);assert.equal(geometry.viewport.height,height);assert.equal(geometry.scrollY,0);
  assert.ok(geometry.actions.some(action=>action.rect.top>=geometry.usableTop-1&&action.rect.bottom<=geometry.usableBottom+1&&action.rect.height>=44&&action.reachable),'No primary learning entry reachable in the initial viewport: '+JSON.stringify(geometry));
  const file=await screenshot(`today-viewport-${id}-${width}x${height}`,{fullPage:false});
  report.homeViewports??=[];report.homeViewports.push({file,fullPage:false,theme:id,geometry});return geometry;
 }finally{await page.setViewportSize(originalViewport);await page.evaluate(saved=>scrollTo({left:saved.x,top:saved.y,behavior:'instant'}),saved);await frames();}
}
function webState(){return{owner:QA_OWNER,schemaVersion:2,profile:{name:'Synthetic theme QA',lrGoal:650,speakingGoal:0,examDate:'2026-12-20',dailyMinutes:25,timezone:'Asia/Shanghai',theme:'hollow',weeklyTarget:4,onboarded:true},hasProfile:true,attempts:[],checkins:[],recordings:[],questionMarks:[],resourceTasks:[]};}
async function freshPage(width){
 if(context)await context.close();nativeHost?.dispose();nativeHost=undefined;if(MODE==='web'){const seeded=await authFixture.call('study','POST',{cookie:authUser.cookie,owner:QA_OWNER,body:{type:'profile',data:webState().profile}});assert.equal(seeded.status,200);}
 context=await browser.newContext({viewport:{width,height:width===1440?1000:900},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'no-preference',serviceWorkers:'block'});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(MODE==='native'&&url.origin===NATIVE_ORIGIN){
   if(url.pathname.startsWith('/api/'))return route.abort('blockedbyclient');
   const local=await fetch(ORIGIN+url.pathname+url.search,{redirect:'error'});
   return route.fulfill({status:local.status,headers:{'content-type':local.headers.get('content-type')||'application/octet-stream'},body:Buffer.from(await local.arrayBuffer())});
  }
  // Controlled empty feeds avoid relying on external network during layout checks.
  if(route.request().method()==='GET'&&['https://cgtn-radio-data.cgtn.com/rss/program/11','https://cgtn-radio-data.cgtn.com/rss/program/5','https://cgtn-radio-data.cgtn.com/rss/program/46','https://feeds.simplecast.com/BqbsxVfO'].includes(url.href))return route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/rss+xml'},body:'<rss><channel><language>en</language></channel></rss>'});
  if((url.protocol==='http:'||url.protocol==='https:')&&url.origin!==ORIGIN){report.blockedExternal.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(MODE==='web'&&['/api/auth/session','/api/study','/api/vocabulary'].includes(url.pathname)){
   const api=url.pathname==='/api/auth/session'?'session':url.pathname.slice(5),row={width,method:request.method(),api};mockCalls.push(row);
   const proof=request.headers()['x-lantern-session-proof'];
   if(api==='session')assert.equal(proof,'2','Web session must request the current session proof');
   const init={cookie:authUser.cookie,owner:request.headers()['x-lantern-owner'],query:url.search,...(api==='session'?{headers:{'X-Lantern-Session-Proof':proof}}:{})};
   if(request.method()==='POST'){
    const operation=request.postDataJSON();row.type=operation.type;row.theme=operation.data?.theme;
    assert.equal(init.owner,QA_OWNER,'Only independently registered/session-verified owner can sync');
    assert.equal(operation.type,'theme','Palette UI must use the dedicated theme operation');assert.deepEqual(Object.keys(operation.data),['theme']);assert.ok(PALETTES.includes(operation.data.theme));init.body=operation;
   }
   const before=api==='study'&&request.method()==='POST'?await(await authFixture.call('study','GET',{cookie:authUser.cookie,owner:QA_OWNER})).json():null;
   const response=await authFixture.call(api,request.method(),init);assert.equal(response.status,200,'Real authenticated product route must succeed');
   if(api==='session'){const value=await response.clone().json();assert.equal(value.user.id,QA_OWNER);assert.equal(value.session.version,2);assert.ok(value.session.remainingMs>0);}
   if(before){const after=await(await authFixture.call('study','GET',{cookie:authUser.cookie,owner:QA_OWNER})).json();assert.deepEqual({...after,profile:{...after.profile,theme:before.profile.theme}},before,'Theme write changed other server facts');}
   return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
  }
  return route.continue();
 });
 page=await context.newPage();page.setDefaultTimeout(15000);
 if(MODE==='native'){
  const {hostRuntime,response}=repoRequire('./tests/helpers/native-auth-host-runtime.cjs');
  nativeHost=hostRuntime({initialToken:'a'.repeat(64),dispatch:async(url,options)=>{
   const pathname=new URL(url).pathname;
   if(pathname==='/api/auth/providers')return response(200,{huaweiLogin:false,huaweiBinding:false});
   assert.equal(pathname,'/api/auth/session');
   return response(200,{user:nativeUser,capabilities:{passwordLogin:true,phoneLogin:false,passwordRecovery:false},...options.header['X-Lantern-Session-Proof']==='2'?{session:{version:2,remainingMs:3600000}}:{}});
  }});
  await page.exposeFunction('__themeQaHost',raw=>nativeHost.invoke(JSON.parse(raw)));
  await page.addInitScript(data=>{window.LanternAuthHost={request(raw){void window.__themeQaHost(raw).then(reply=>window.__lanternAuthReceive?.(reply));}};if(!localStorage.getItem('lantern-theme-qa-seeded')){const {owner,hasProfile,...localData}=data;localStorage.setItem('lantern-v1-'+owner,JSON.stringify({data:localData}));localStorage.setItem('lantern-theme-qa-seeded','true');}},webState());
 }
 page.on('pageerror',error=>report.pageErrors.push(String(error)));
 page.on('console',msg=>{if(msg.type()==='error')report.consoleErrors.push(msg.text().slice(0,1000));});
 page.on('response',response=>{if(response.status()>=400&&response.url().startsWith(MODE==='native'?NATIVE_ORIGIN:ORIGIN)&&!response.url().endsWith('/favicon.ico'))report.httpErrors.push({url:response.url(),status:response.status()});});
 const target=MODE==='native'?NATIVE_ORIGIN:ORIGIN;
 await page.goto(target+'/',{waitUntil:'networkidle'});assert.equal(new URL(page.url()).origin,target);await ready();
}
async function ready(){const welcome=page.locator('[data-first-run="welcome"]');await Promise.race([welcome.waitFor(),page.getByRole('heading',{name:'今日',exact:true}).waitFor()]);if(await welcome.isVisible())await welcome.locator('[data-first-run-action="guest"]').click();await page.getByRole('heading',{name:'今日',exact:true}).waitFor();await eventually(()=>page.locator('#workspace-main button:enabled').count().then(count=>count>0),'Today screen did not become ready');}
// Current workspace contract. The complete former atlas suite is retained in
// theme-atlas-legacy.cjs; it is not claimed as passing against the redesigned UI.
const NAV=['今日','单词','练习','复习','进度','发现'];
async function rootTheme(id){await page.waitForFunction(expected=>document.body.dataset.uiTheme===expected,UI_THEME_BY_PERSISTED[id]);}
function navigation(){return page.getByRole('navigation',{name:'主导航',exact:true});}
async function openNavigation(){const toggle=page.locator('.workspace-drawer-toggle');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await navigation().waitFor({state:'visible'});await page.waitForFunction(()=>{const drawer=document.querySelector('.workspace-sidebar'),body=document.querySelector('.workspace-body'),rect=drawer.getBoundingClientRect(),margin=parseFloat(getComputedStyle(body).marginLeft);return Math.abs(rect.left)<.02&&(innerWidth<700||Math.abs(margin-rect.width)<.02);});}
async function closeNavigation(){const toggle=page.locator('.workspace-drawer-toggle');if(await toggle.getAttribute('aria-expanded')==='true')await page.locator('.workspace-drawer-head').getByRole('button',{name:'收起导航',exact:true}).click();await page.locator('.workspace-sidebar').waitFor({state:'hidden'});await page.waitForFunction(()=>Math.abs(parseFloat(getComputedStyle(document.querySelector('.workspace-body')).marginLeft))<.02);}
async function navigate(label){await openNavigation();await navigation().getByRole('button',{name:label,exact:true}).click();await eventually(()=>page.locator('.workspace-sidebar nav button[aria-current="page"] span').first().textContent().then(value=>value===label),'Current navigation is not '+label);await closeNavigation();await page.locator('#workspace-main').waitFor({state:'visible'});}
async function accessibleNavigation(label){await openNavigation();await accessibleControl(navigation().getByRole('button',{name:label,exact:true}));await closeNavigation();}
const routeGeometry=new Map();
async function layout(label){
 const dimensions=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
 assert.ok(dimensions.document<=dimensions.width+1,label+' document overflow '+JSON.stringify(dimensions));assert.ok(dimensions.body<=dimensions.width+1,label+' body overflow '+JSON.stringify(dimensions));
 if(label.startsWith('route:')){
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const geometry=await page.evaluate(()=>{
   const main=document.querySelector('#workspace-main'),shown=el=>!!el&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
   const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height};};
   const values=selector=>[...main.querySelectorAll(selector)].filter(shown).map(rect);
   const nav=document.querySelector('.workspace-sidebar');
   return {headings:values('h1'),scenes:values('figure.v041-theme-scene'),panels:values('.panel'),buttons:values('button.button.primary,button.phase2-primary,button.primary').slice(0,4),navigation:nav&&shown(nav)?rect(nav):null};
  });
  const key=dimensions.width+':'+label,reference=routeGeometry.get(key);
  if(!reference)routeGeometry.set(key,geometry);
  else{
   for(const field of ['headings','scenes','panels','buttons']){
    assert.equal(geometry[field].length,reference[field].length,`${key} ${field} changed structure across themes`);
    for(let i=0;i<reference[field].length;i++)for(const dimension of ['x','y','width','height'])assert.ok(Math.abs(geometry[field][i][dimension]-reference[field][i][dimension])<=1,`${key} ${field}[${i}].${dimension} differed across themes: ${JSON.stringify({reference:reference[field][i],actual:geometry[field][i]})}`);
   }
   // Fixed navigation is in viewport coordinates: page scroll is irrelevant.
   assert.equal(Boolean(geometry.navigation),Boolean(reference.navigation),`${key} navigation changed structure`);
   if(geometry.navigation)for(const dimension of ['x','width','height'])assert.ok(Math.abs(geometry.navigation[dimension]-reference.navigation[dimension])<=1,`${key} navigation ${dimension} changed`);
  }
  return {...dimensions,geometry};
 }
 return dimensions;
}
async function accessibleControl(locator){await locator.scrollIntoViewIfNeeded();const result=await locator.evaluate(el=>{const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,hit:top===el||el.contains(top)};});assert.ok(result.left>=-1&&result.right<=result.width+1&&result.top>=-1&&result.bottom<=result.height+1,'Control outside viewport '+JSON.stringify(result));assert.equal(result.hit,true,'Control covered '+JSON.stringify(result));return result;}
function collectLearningFacts(storage = globalThis.localStorage) {
 const rows = {};
 const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
 const exactKeys = (value, keys) => record(value) && Object.keys(value).sort().join(',') === keys;
 for (let i = 0; i < storage.length; i++) {
  const key = storage.key(i);
  let value;
  try { value = JSON.parse(storage.getItem(key)); } catch { continue; }
  if (key.startsWith('lantern-v1-')) {
   if (key.includes(':op:')) {
    // StudyOperation and enqueue/saveTheme persist one owner-scoped operation.
    // Exempt only the complete theme-only schema; retain every other journal row.
    const themeOnly = exactKeys(value, 'data,id,owner,type') && value.type === 'theme'
     && typeof value.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
     && (value.owner === null || (typeof value.owner === 'string' && value.owner.length > 0))
     && key === 'lantern-v1-' + (value.owner === null ? 'device' : value.owner) + ':op:' + value.id
     && exactKeys(value.data, 'theme') && ['paper', 'crystal', 'hollow', 'silk', 'whale-bay', 'whale-moon'].includes(value.data.theme);
    if (!themeOnly) rows[key] = value;
    continue;
   }
   const data = value?.data;
   if (data) rows[key] = {...data, profile: {...data.profile, theme: undefined}};
  }
  if (key.startsWith('lantern-vocab-v1:')) rows[key] = value;
 }
 return rows;
}
async function facts(){return page.evaluate(collectLearningFacts);}
async function sceneScreenshotReady(id) {
 const scenes = page.locator('[data-scene="todayHero"], [data-scene="todayRest"]');
 await eventually(async () => await scenes.count() === 1,'Today must render its one page-owned scene frame');
 const frameNames=await scenes.evaluateAll(elements=>elements.map(el=>el.getAttribute('data-scene')));
 assert.deepEqual(frameNames,['todayRest']);
 const sources={paper:'neutral-paper',crystal:'neutral-crystal',hollow:'hollow-lake',silk:'silk-calm','whale-bay':'bay-01-today','whale-moon':'moon-01-today'};
 assert.equal(await scenes.first().getAttribute('data-scene-source'),sources[id]);
 const images = await scenes.locator('img').evaluateAll(async elements => {
  let timer;
  try {
   await Promise.race([
    (async () => {
     await Promise.all(elements.map(img => img.decode()));
     await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Final scene decode/paint readiness exceeded 15 seconds')), 15000); }),
   ]);
  } finally { clearTimeout(timer); }
  return elements.map(img => {
   const rect = img.getBoundingClientRect();
   let visible = true;
   for (let node = img; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) visible = false;
   }
   return {path: new URL(img.currentSrc).pathname, connected: img.isConnected, complete: img.complete,
    naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, visible,
    x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    sceneStatus: img.closest('.phase2-scene-window')?.getAttribute('data-scene-status') ?? null};
  });
 });
 for (const img of images) {
  assert.equal(img.connected && img.complete && img.visible, true, 'Screenshot scene image must remain mounted, loaded and visible');
  assert.ok(img.naturalWidth>0&&img.naturalHeight>0,'Scene image must decode');
  assert.ok(img.width > 0 && img.height > 0, 'Screenshot scene image must occupy visible layout space');
  assert.notEqual(img.sceneStatus, 'unavailable', 'Screenshot scene image must not be a failure placeholder');
 }
 if(id==='paper'||id==='crystal')assert.equal(images.length,0,'Neutral day/night scenes do not invent art');
 else assert.equal(images.length,1,'The selected illustrated theme must render its approved Today image');
 return {images,frameNames, afterDecodeAnimationFrames: 2};
}
async function imageInfo(locator){await locator.scrollIntoViewIfNeeded();await eventually(()=>locator.evaluate(img=>img.complete&&img.naturalWidth>0),'Image failed to decode');return locator.evaluate(async img=>{const r=img.getBoundingClientRect();const bitmap=await createImageBitmap(await(await fetch(img.currentSrc)).blob());const pixelWidth=bitmap.width;bitmap.close();return{pixelWidth,path:new URL(img.currentSrc).pathname,width:img.naturalWidth,height:img.naturalHeight,displayWidth:r.width,displayHeight:r.height,fit:getComputedStyle(img).objectFit};});}
async function artwork(id){await navigate('今日');const brand=page.locator('.workspace-mobile-brand');await accessibleControl(brand);const icon=brand.locator('img');assert.equal(await icon.count(),1);assert.equal(await icon.getAttribute('src'),'/icons/login-approved.png');await eventually(()=>icon.evaluate(img=>img.complete&&img.naturalWidth>0),'Approved brand image must decode');const scenes=page.locator('[data-scene="todayHero"], [data-scene="todayRest"]');assert.equal(await scenes.count(),1,'Every theme must use the same today slot');const data=[];for(const scene of await scenes.all()){const image=scene.locator('img');data.push({slot:await scene.getAttribute('data-scene'),source:await scene.getAttribute('data-scene-source'),...(await image.count()?{image:await imageInfo(image)}:{neutral:true})});}return{scenes:data};}
// Inspect the actual page-owned frames. Screenshots remain available for a
// human to check character placement; contain and decoded dimensions prove the
// entire source image is fitted into the existing frame.
const WHALE_SCENES=[
 {nav:'今日',slot:'todayRest',suffix:'01-today'},
 {nav:'单词',slot:'vocabularyOverview',suffix:'02-vocabulary'},
 {nav:'练习',slot:'practiceOverview',suffix:'03-practice'},
 {nav:'复习',slot:'reviewOverview',suffix:'04-review'},
 {nav:'进度',slot:'progressOverview',suffix:'05-progress'},
 {nav:'发现',slot:'resourceLibrary',suffix:'06-discover',library:true}
];
const whaleFrameGeometry=new Map();
async function checkWhaleScenes(theme,width){
 const prefix=theme==='whale-bay'?'bay':'moon',result=[];
 for(const item of WHALE_SCENES){
  await navigate(item.nav);
  const scene=page.locator(`[data-scene="${item.slot}"]`);
  if(item.library){
   assert.equal(await scene.count(),0,'The discovery feed must not acquire the library illustration');
   await page.getByRole('button',{name:'资料库',exact:true}).click();
  }
  await scene.waitFor({state:'visible'});
  const expected=`${prefix}-${item.suffix}`;
  assert.equal(await scene.getAttribute('data-scene-source'),expected);
  assert.equal(await scene.getAttribute('data-scene-status'),'available');
  const image=scene.locator('img');assert.equal(await image.count(),1);
  const info=await imageInfo(image);
  assert.equal(info.path,`/images/whale-character-scenes-20261122/${expected}.webp`);
  assert.deepEqual([info.width,info.height],[1672,941]);
  assert.equal(info.fit,'contain',`${expected} must display the whole source image`);
  const frame=await scene.evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height};});
  assert.ok(frame.width>0&&frame.height>0);
  if(item.slot==='todayRest')assert.ok(Math.abs(frame.width/frame.height-2)<0.03,'Today keeps its 2:1 art window');
  const key=`${width}:${item.slot}`,previous=whaleFrameGeometry.get(key);
  if(previous)for(const axis of ['width','height'])assert.ok(Math.abs(frame[axis]-previous[axis])<=1,`${key} ${axis} changed between themes`);
  else whaleFrameGeometry.set(key,frame);
  const file=path.join(OUT,`${theme}-${item.suffix}-${width}.png`);
  await scene.screenshot({path:file,animations:'disabled'});report.screenshots.push(file);
  result.push({slot:item.slot,frame,image:info,screenshot:file});
 }
 return result;
}
async function choose(id,method){await openNavigation();await page.locator('.workspace-sidebar-bottom').getByRole('button',{name:'设置',exact:true}).click();await closeNavigation();await page.getByRole('button',{name:/^外观主题/}).click();const group=page.getByRole('group',{name:'界面主题',exact:true});await group.waitFor();assert.equal(await group.getByRole('button').count(),6);const button=group.locator('[data-theme-choice="'+id+'"]');await accessibleControl(button);if(method==='preview')await button.locator('.v041-theme-thumb').click();else if(method==='caption')await button.locator('.v041-theme-option-name').click();else{await button.focus();await page.keyboard.press(method==='space'?'Space':'Enter');}await eventually(()=>button.getAttribute('aria-pressed').then(value=>value==='true'),'Theme selection did not become pressed');assert.equal(await group.locator('button[aria-pressed="true"]').count(),1);await rootTheme(id);await accessibleControl(button);return layout('theme-picker-'+id);}
async function colors(id,width){const sample=await page.locator('body').evaluate(el=>({background:getComputedStyle(el).backgroundColor,foreground:getComputedStyle(el).color}));assert.deepEqual([sample.background,sample.foreground],EXPECTED_COLORS[id],'Rendered palette must match accepted workspace colors');paletteSamples.push({id,width,...sample});return sample;}
(async()=>{
 await allocateOutput();await startPreview();browser=await launchBrowser();
 for(const width of WIDTHS){
  await step(`${width}px: fresh ${MODE} workspace has six accessible learning routes`,async()=>{await freshPage(width);await rootTheme('hollow');await openNavigation();assert.deepEqual((await navigation().getByRole('button').allTextContents()).slice(0,6).map(x=>x.trim()),NAV);for(const label of NAV)await accessibleControl(navigation().getByRole('button',{name:label,exact:true}));await closeNavigation();return layout('fresh');});
  for(const [index,id] of PALETTES.entries()){
   const before=await facts();
   await step(`${width}px: ${id} selection via ${['preview','caption','enter','space'][index%4]} persists without changing learning facts`,async()=>{await choose(id,['preview','caption','enter','space'][index%4]);const sample=await colors(id,width);await page.reload({waitUntil:'networkidle'});await ready();await rootTheme(id);assert.deepEqual(await colors(id,width),sample);assert.deepEqual(await facts(),before,'Theme switch changed learning facts or goals');return{sample,layout:await layout('reloaded-'+id)};});
   await step(`${width}px: ${id} artwork and all six route layouts`,async()=>{const art=await artwork(id);const layouts=[];for(const label of NAV){await navigate(label);await accessibleNavigation(label);await rootTheme(id);layouts.push({label,...await layout('route:'+label)});}await navigate('今日');const screenshotArt=await sceneScreenshotReady(id);await screenshot(`${id}-${width}`);const homeViewport=width===390?await homeViewportScreenshot(id,390,844):null;const lakeViewport=id==='hollow'&&width===390?await blueLakeViewportScreenshot():null;assert.deepEqual(await facts(),before);return{art,layouts,screenshotArt,homeViewport,lakeViewport};});
  }
  const beforePractice=await facts();await step(`${width}px: representative practice dialog remains readable and closes without writing an answer`,async()=>{await navigate('练习');const task=page.locator('.practice-task-row').filter({hasText:'Part 5 ·'});await task.locator('[data-task-primary]').click();const dialog=page.getByRole('dialog').filter({has:page.locator('.practice-footer')});await dialog.waitFor({state:'visible'});assert.ok(await dialog.getByRole('radio').count()>=3);const control=dialog.getByRole('button',{name:'确认答案',exact:true});assert.equal(await control.isDisabled(),true);await accessibleControl(control);const dimensions=await layout('practice-representative');await screenshot(`practice-representative-${width}`);await page.keyboard.press('Escape');const confirmation=page.getByRole('dialog',{name:'暂时退出练习？',exact:true});await confirmation.waitFor({state:'visible'});await confirmation.getByRole('button',{name:'保存并返回',exact:true}).click();await eventually(()=>page.getByRole('dialog').count().then(n=>n===0),'Practice did not close');assert.deepEqual(await facts(),beforePractice);return dimensions;});
  await step(`${width}px: six distinct rendered palettes and reduced motion respected`,async()=>{const samples=paletteSamples.filter(x=>x.width===width);assert.equal(new Set(samples.map(x=>x.background+' / '+x.foreground)).size,6);await page.emulateMedia({reducedMotion:'reduce'});const running=await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running'&&Number(a.effect?.getComputedTiming().duration)>1).map(a=>({name:a.animationName,duration:a.effect?.getComputedTiming().duration})));assert.deepEqual(running,[],'Reduced-motion preference left a long running animation');await page.reload({waitUntil:'domcontentloaded'});await ready();await rootTheme(PALETTES.at(-1));await page.emulateMedia({reducedMotion:'no-preference'});return{palettes:6,reducedMotion:true};});
 }
 for(const width of [390,840]){
  await freshPage(width);
  for(const theme of ['whale-bay','whale-moon']){
   await step(`${width}px: ${theme} six character illustrations decode in existing frames`,async()=>{
    await choose(theme,'caption');
    return {scenes:await checkWhaleScenes(theme,width)};
   });
  }
 }
 await step('no unhandled errors, failed local requests or external traffic',async()=>{assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.mockErrors||[],[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.httpErrors,[]);assert.deepEqual(report.blockedExternal,[]);if(MODE==='web'){assert.ok(mockCalls.some(x=>x.method==='GET'));for(const id of PALETTES)assert.ok(mockCalls.some(x=>x.method==='POST'&&x.type==='theme'&&x.theme===id),'Missing owner-scoped theme write '+id);}return{mockCalls:mockCalls.length};});report.status='passed';
})().catch(async error=>{report.status='failed';report.error=String(error.stack||error);if(page&&!page.isClosed()){try{await screenshot('failure');report.lastUrl=page.url();report.lastBody=(await page.locator('body').innerText()).slice(0,15000);}catch{}}process.exitCode=1;}).finally(async()=>{try{await cleanup();}catch(error){report.status='failed';report.cleanupError=String(error.stack||error);process.exitCode=1;}report.finishedAt=new Date().toISOString();report.outputDirectory=OUT;report.mockCalls=mockCalls;report.paletteSamples=paletteSamples;if(ownsOutput)await fs.writeFile(path.join(OUT,'result.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({mode:MODE,status:report.status,passed:report.steps.filter(x=>x.status==='passed').length,failed:report.steps.filter(x=>x.status==='failed').length,output:OUT,error:report.error?.split('\n').slice(0,3).join('\n')}));if(report.cleanupError)setTimeout(()=>process.exit(1),100).unref();});
