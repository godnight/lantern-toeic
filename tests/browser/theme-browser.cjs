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
const UI_THEME_ORDER=['paper','crystal','hollow','silk'];
const UI_THEME_BY_PERSISTED={paper:'day',crystal:'night',hollow:'hollow',silk:'silk'};
const UI_THEME_META={paper:{name:'奶油柔色'},crystal:{name:'默认夜间'},hollow:{name:'空洞骑士'},silk:{name:'丝之歌'}};
const EXPECTED_COLORS={paper:['rgb(245, 238, 226)','rgb(37, 43, 38)'],crystal:['rgb(24, 29, 28)','rgb(238, 241, 237)'],hollow:['rgb(13, 20, 32)','rgb(233, 237, 241)'],silk:['rgb(33, 25, 29)','rgb(241, 234, 226)']};

const MODE=process.argv.includes('--web')?'web':process.env.LANTERN_THEME_QA_MODE||'native';
assert.ok(['native','web'].includes(MODE),'LANTERN_THEME_QA_MODE must be native or web');
const PORT = Number(process.env.LANTERN_THEME_QA_PORT || (MODE==='web'?4188:4187));
assert.ok(Number.isInteger(PORT) && PORT >= 1024 && PORT <= 65535, 'Invalid local QA port');
const ORIGIN = `http://127.0.0.1:${PORT}`;
let OUT;
const report = {scope:'Independent navigation scenes and palettes in isolated '+MODE+' frontend QA',mode:MODE,origin:ORIGIN,
  limitations:['Desktop Chrome at four viewport widths is not physical-device or ArkWeb acceptance.', 'Screenshot inspection remains a separate visual review step.'],
  startedAt:new Date().toISOString(),steps:[],screenshots:[],pageErrors:[],consoleErrors:[],blockedExternal:[],httpErrors:[]};
let browser, context, page, preview, cleanupPromise;
let ownsOutput = false;
const ownerToken = crypto.randomBytes(24).toString('hex');
const QA_OWNER='synthetic-theme-qa-'+ownerToken;
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
 const directory=path.join(OUT,'web-fixture');await fs.mkdir(directory);
 const posix=file=>file.replaceAll('\\','/');
 const entry=`import React from ${JSON.stringify(posix(repoRequire.resolve('react')))};
import {createRoot} from ${JSON.stringify(posix(repoRequire.resolve('react-dom/client')))};
import StudyApp from ${JSON.stringify(posix(path.join(REPO,'app/study-app.tsx')))};
import ${JSON.stringify(posix(path.join(REPO,'app/globals.css')))};
import ${JSON.stringify(posix(path.join(REPO,'app/redesign.css')))};
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(StudyApp,{owner:${JSON.stringify(QA_OWNER)}})));
`;
 await fs.writeFile(path.join(directory,'entry.tsx'),entry,{flag:'wx'});
 await fs.writeFile(path.join(directory,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>',{flag:'wx'});
 const config=`import react from ${JSON.stringify(pathToFileURL(repoRequire.resolve('@vitejs/plugin-react')).href)};
import tailwind from ${JSON.stringify(pathToFileURL(repoRequire.resolve('@tailwindcss/postcss')).href)};
export default {root:${JSON.stringify(directory)},base:'./',publicDir:${JSON.stringify(path.join(REPO,'public'))},plugins:[react()],css:{postcss:{plugins:[tailwind()]}},resolve:{alias:{'@':${JSON.stringify(REPO)}},dedupe:['react','react-dom']},build:{outDir:'dist',emptyOutDir:true}};
`;
 const configFile=path.join(directory,'vite.config.mjs');await fs.writeFile(configFile,config,{flag:'wx'});
 report.webFixture={syntheticOwner:QA_OWNER,directory,studyAppSha256:crypto.createHash('sha256').update(await fs.readFile(path.join(REPO,'app/study-app.tsx'))).digest('hex'),nativeMode:false,api:'context-local in-memory /api/study mock; no real login or production endpoint'};
 report.limitations.push('Web fixture tests real StudyApp with nativeMode=false and a synthetic owner; authentication, SSR and D1/R2 are not exercised.');
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
      if(browser)await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Browser close exceeded 10 seconds')),10000);
        Promise.resolve(browser.close()).then(resolve,reject).finally(()=>clearTimeout(timeout));
      });
    }finally{await stopPreview();}
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



const WIDTHS=[320,390,840,1440];
const PALETTES=[...UI_THEME_ORDER];
let paletteSamples=[];
async function step(name,action){const began=Date.now();try{const details=await action();report.steps.push({name,status:'passed',elapsedMs:Date.now()-began,...(details===undefined?{}:{details})});console.log(JSON.stringify({step:name,status:'passed'}));}catch(error){report.steps.push({name,status:'failed',elapsedMs:Date.now()-began,error:String(error.stack||error)});throw error;}}
async function eventually(check,message,timeout=15000){const end=Date.now()+timeout;let last;do{try{const result=await check();if(result)return result;}catch(error){last=error;}await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<end);throw new Error(message+(last?': '+last.message:''));}
async function screenshot(name){const file=path.join(OUT,name+'.png');await page.screenshot({path:file,fullPage:true,animations:'disabled'});report.screenshots.push(file);}
function webState(){return{owner:QA_OWNER,schemaVersion:2,profile:{name:'Synthetic theme QA',lrGoal:650,speakingGoal:0,examDate:'2026-12-20',dailyMinutes:25,timezone:'Asia/Shanghai',theme:'hollow',weeklyTarget:4,onboarded:true},hasProfile:true,attempts:[],checkins:[],recordings:[],questionMarks:[],resourceTasks:[]};}
async function freshPage(width){
 if(context)await context.close();const remote=webState();
 context=await browser.newContext({viewport:{width,height:width===1440?1000:900},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'no-preference',serviceWorkers:'block'});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if((url.protocol==='http:'||url.protocol==='https:')&&url.origin!==ORIGIN){report.blockedExternal.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(MODE==='web'&&url.pathname==='/api/study'){
   const row={width,method:request.method(),at:Date.now()};mockCalls.push(row);
   if(request.method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(remote)});
   if(request.method()==='POST'){
    try{const operation=request.postDataJSON();row.type=operation.type;row.theme=operation.data?.theme;
    assert.equal(request.headers()['x-lantern-owner'],QA_OWNER,'Web UI must identify the synthetic owner');
    assert.equal(operation.type,'theme','Palette UI must use the dedicated theme operation');assert.deepEqual(Object.keys(operation.data),['theme'],'Theme operation must not send the entire profile');assert.ok(PALETTES.includes(operation.data.theme));
    const before=structuredClone(remote);remote.profile={...remote.profile,theme:operation.data.theme};remote.hasProfile=true;assert.deepEqual({...remote,profile:{...remote.profile,theme:before.profile.theme},hasProfile:before.hasProfile},before,'Theme update changed other learning state');return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
    }catch(error){report.mockErrors||=[];report.mockErrors.push(String(error.stack||error));return route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:'Synthetic QA contract failure'})});}
   }
   return route.fulfill({status:405,body:'Unsupported QA API method'});
  }
  if(MODE==='web'&&url.pathname==='/api/vocabulary')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({owner:QA_OWNER,events:[]})});
  return route.continue();
 });
 if(MODE==='native')await context.addInitScript(data=>{if(!localStorage.getItem('lantern-theme-qa-seeded')){const {owner,hasProfile,...localData}=data;localStorage.setItem('lantern-v1-device',JSON.stringify({data:localData}));localStorage.setItem('lantern-theme-qa-seeded','true');}},webState());
 page=await context.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',error=>report.pageErrors.push(String(error)));
 page.on('console',msg=>{if(msg.type()==='error')report.consoleErrors.push(msg.text().slice(0,1000));});
 page.on('response',response=>{if(response.status()>=400&&response.url().startsWith(ORIGIN)&&!response.url().endsWith('/favicon.ico'))report.httpErrors.push({url:response.url(),status:response.status()});});
 await page.goto(ORIGIN+'/',{waitUntil:'networkidle'});assert.equal(new URL(page.url()).origin,ORIGIN);await ready();
}
async function ready(){await eventually(()=>page.getByRole('button',{name:'开始今日练习',exact:true}).isEnabled(),'Today screen did not become ready');}
// Current workspace contract. The complete former atlas suite is retained in
// theme-atlas-legacy.cjs; it is not claimed as passing against the redesigned UI.
const NAV=['今日','单词','练习','复习','进度','资料'];
async function rootTheme(id){await page.waitForFunction(expected=>document.body.dataset.uiTheme===expected,UI_THEME_BY_PERSISTED[id]);}
function navigation(){return page.getByRole('navigation',{name:page.viewportSize().width<1024?'手机主导航':'桌面主导航',exact:true});}
async function navigate(label){const button=navigation().getByRole('button',{name:label,exact:true});await button.click();await eventually(()=>button.getAttribute('aria-current').then(value=>value==='page'),'Current navigation is not '+label);await page.locator('#workspace-main').waitFor({state:'visible'});}
async function layout(label){const dimensions=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));assert.ok(dimensions.document<=dimensions.width+1,label+' document overflow '+JSON.stringify(dimensions));assert.ok(dimensions.body<=dimensions.width+1,label+' body overflow '+JSON.stringify(dimensions));return dimensions;}
async function accessibleControl(locator){await locator.scrollIntoViewIfNeeded();const result=await locator.evaluate(el=>{const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,hit:top===el||el.contains(top)};});assert.ok(result.left>=-1&&result.right<=result.width+1&&result.top>=-1&&result.bottom<=result.height+1,'Control outside viewport '+JSON.stringify(result));assert.equal(result.hit,true,'Control covered '+JSON.stringify(result));return result;}
async function facts(){return page.evaluate(()=>{const rows={};for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);let value;try{value=JSON.parse(localStorage.getItem(key));}catch{continue;}if(key==='lantern-v1-device'||key.startsWith('lantern-v1-owner:')){const data=value.data;if(data){rows[key]={...data,profile:{...data.profile,theme:undefined}};}}if(key.startsWith('lantern-vocab-v1:'))rows[key]=value;}return rows;});}
async function imageInfo(locator){await locator.scrollIntoViewIfNeeded();await eventually(()=>locator.evaluate(img=>img.complete&&img.naturalWidth>0),'Image failed to decode');return locator.evaluate(async img=>{const r=img.getBoundingClientRect();const bitmap=await createImageBitmap(await(await fetch(img.currentSrc)).blob());const pixelWidth=bitmap.width;bitmap.close();return{pixelWidth,path:new URL(img.currentSrc).pathname,width:img.naturalWidth,height:img.naturalHeight,displayWidth:r.width,displayHeight:r.height,fit:getComputedStyle(img).objectFit};});}
async function artwork(id){await navigate('今日');const brand=page.locator(page.viewportSize().width<1024?'.workspace-mobile-brand':'.workspace-brand');await accessibleControl(brand);const scenes=page.locator('.phase2-scene-window');if(id==='hollow'){assert.equal(await brand.locator('.phase2-brand-mark').count(),1);const icon=await imageInfo(brand.locator('img'));assert.match(icon.path,/\/phase2-theme\/knight-icon-(48|64|96|256)\.png$/);assert.equal(await scenes.count(),1);const image=await imageInfo(scenes.locator('img'));assert.match(image.path,/\/phase2-theme\/blue-lake-hd-[123]x\.webp$/);assert.equal(image.fit,'contain');assert.ok(Math.abs(image.displayWidth/image.displayHeight-image.width/image.height)<.01,'Complete scene aspect ratio changed');assert.ok(image.pixelWidth>=448);const art=await page.locator('.lantern-workspace').evaluate(el=>getComputedStyle(el,'::before').backgroundImage);assert.match(art,/rain-city-hd/);return{icon,image};}assert.equal(await scenes.count(),0,'Other themes must not inherit Hollow Knight scene');assert.equal(await brand.locator('.phase2-brand-mark').count(),0);assert.equal(await page.locator('.workspace-day-grid .phase2-brand-mark').count(),0);return{gameSceneAbsent:true};}
async function choose(id,method){await page.locator('.workspace-topbar').getByRole('button',{name:'外观与偏好',exact:true}).click();const group=page.getByRole('group',{name:'界面主题',exact:true});await group.waitFor();assert.equal(await group.getByRole('button').count(),4);const button=group.getByRole('button',{name:new RegExp('^'+UI_THEME_META[id].name+'，')});await accessibleControl(button);if(method==='preview')await button.locator('.ui-theme-preview').click();else if(method==='caption')await button.locator('.ui-theme-caption-name').click();else{await button.focus();await page.keyboard.press(method==='space'?'Space':'Enter');}await eventually(()=>button.getAttribute('aria-pressed').then(value=>value==='true'),'Theme selection did not become pressed');assert.equal(await group.locator('button[aria-pressed="true"]').count(),1);await rootTheme(id);await accessibleControl(button);return layout('theme-picker-'+id);}
async function colors(id,width){const sample=await page.locator('body').evaluate(el=>({background:getComputedStyle(el).backgroundColor,foreground:getComputedStyle(el).color}));assert.deepEqual([sample.background,sample.foreground],EXPECTED_COLORS[id],'Rendered palette must match accepted workspace colors');paletteSamples.push({id,width,...sample});return sample;}
(async()=>{
 await allocateOutput();await startPreview();browser=await launchBrowser();
 for(const width of WIDTHS){
  await step(`${width}px: fresh ${MODE} workspace has six accessible learning routes`,async()=>{await freshPage(width);await rootTheme('hollow');assert.deepEqual((await navigation().getByRole('button').allTextContents()).slice(0,6).map(x=>x.trim()),NAV);for(const label of NAV)await accessibleControl(navigation().getByRole('button',{name:label,exact:true}));return layout('fresh');});
  for(const [index,id] of PALETTES.entries()){
   const before=await facts();
   await step(`${width}px: ${id} selection via ${['preview','caption','enter','space'][index]} persists without changing learning facts`,async()=>{await choose(id,['preview','caption','enter','space'][index]);const sample=await colors(id,width);await page.reload({waitUntil:'networkidle'});await ready();await rootTheme(id);assert.deepEqual(await colors(id,width),sample);assert.deepEqual(await facts(),before,'Theme switch changed learning facts or goals');return{sample,layout:await layout('reloaded-'+id)};});
   await step(`${width}px: ${id} artwork and all six route layouts`,async()=>{const art=await artwork(id);const layouts=[];for(const label of NAV){await navigate(label);await accessibleControl(navigation().getByRole('button',{name:label,exact:true}));await rootTheme(id);layouts.push({label,...await layout(id+'-'+label)});}await navigate('今日');await screenshot(`${id}-${width}`);assert.deepEqual(await facts(),before);return{art,layouts};});
   await step(`${width}px: ${id} real practice dialog remains readable and closes without writing an answer`,async()=>{await page.getByRole('button',{name:'开始今日练习',exact:true}).click();const dialog=page.getByRole('dialog').filter({has:page.locator('.practice-footer')});await dialog.waitFor({state:'visible'});assert.ok(await dialog.getByRole('radio').count()>=3);const control=dialog.getByRole('button',{name:'确认答案',exact:true});assert.equal(await control.isDisabled(),true);await accessibleControl(control);const dimensions=await layout('practice-'+id);await screenshot(`practice-${id}-${width}`);await page.keyboard.press('Escape');const confirmation=page.getByRole('dialog',{name:'先结束这组练习？',exact:true});await confirmation.waitFor({state:'visible'});await confirmation.getByRole('button',{name:'保存并返回',exact:true}).click();await eventually(()=>page.getByRole('dialog').count().then(n=>n===0),'Practice did not close');assert.deepEqual(await facts(),before);return dimensions;});
  }
  await step(`${width}px: four distinct rendered palettes and reduced motion respected`,async()=>{const samples=paletteSamples.filter(x=>x.width===width);assert.equal(new Set(samples.map(x=>x.background)).size,4);assert.equal(new Set(samples.map(x=>x.foreground)).size,4);await page.emulateMedia({reducedMotion:'reduce'});const running=await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running'&&Number(a.effect?.getComputedTiming().duration)>1).map(a=>({name:a.animationName,duration:a.effect.getComputedTiming().duration})));assert.deepEqual(running,[],'Reduced-motion preference left a long running animation');await page.reload({waitUntil:'networkidle'});await ready();await rootTheme('silk');await page.emulateMedia({reducedMotion:'no-preference'});return{palettes:4,reducedMotion:true};});
 }
 await step('no unhandled errors, failed local requests or external traffic',async()=>{assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.mockErrors||[],[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.httpErrors,[]);assert.deepEqual(report.blockedExternal,[]);if(MODE==='web'){assert.ok(mockCalls.some(x=>x.method==='GET'));for(const id of PALETTES)assert.ok(mockCalls.some(x=>x.method==='POST'&&x.type==='theme'&&x.theme===id),'Missing owner-scoped theme write '+id);}return{mockCalls:mockCalls.length};});report.status='passed';
})().catch(async error=>{report.status='failed';report.error=String(error.stack||error);if(page&&!page.isClosed()){try{await screenshot('failure');report.lastUrl=page.url();report.lastBody=(await page.locator('body').innerText()).slice(0,15000);}catch{}}process.exitCode=1;}).finally(async()=>{try{await cleanup();}catch(error){report.status='failed';report.cleanupError=String(error.stack||error);process.exitCode=1;}report.finishedAt=new Date().toISOString();report.outputDirectory=OUT;report.mockCalls=mockCalls;report.paletteSamples=paletteSamples;if(ownsOutput)await fs.writeFile(path.join(OUT,'result.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({mode:MODE,status:report.status,passed:report.steps.filter(x=>x.status==='passed').length,failed:report.steps.filter(x=>x.status==='failed').length,output:OUT,error:report.error?.split('\n').slice(0,3).join('\n')}));if(report.cleanupError)setTimeout(()=>process.exit(1),100).unref();});
