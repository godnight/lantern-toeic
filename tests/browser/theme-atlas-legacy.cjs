// Historical atlas suite, retained unchanged below for its matching v0.3.3 UI.
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
const catalogue = repoRequire('./art/themes.json');

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
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(StudyApp,{owner:${JSON.stringify(QA_OWNER)}})));
`;
 await fs.writeFile(path.join(directory,'entry.tsx'),entry,{flag:'wx'});
 await fs.writeFile(path.join(directory,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>',{flag:'wx'});
 const config=`import react from ${JSON.stringify(pathToFileURL(repoRequire.resolve('@vitejs/plugin-react')).href)};
import tailwind from ${JSON.stringify(pathToFileURL(repoRequire.resolve('@tailwindcss/postcss')).href)};
export default {root:${JSON.stringify(directory)},base:'./',publicDir:${JSON.stringify(path.join(REPO,'public'))},plugins:[react()],css:{postcss:{plugins:[tailwind()]}},resolve:{alias:{'@':${JSON.stringify(REPO)}},dedupe:[]},build:{outDir:'dist',emptyOutDir:true}};
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
const PALETTES=['hollow','paper','silk','crystal'];
const BACKGROUNDS={hollow:'rgb(12, 24, 38)',paper:'rgb(236, 237, 230)',silk:'rgb(28, 20, 27)',crystal:'rgb(27, 25, 41)'};
let paletteSamples=[];
const SCENES=[
 {id:'today',label:'今日旅程',slug:'blue-lake',image:'/images/themes-v3/blue-lake-wide.webp',mobile:'/images/themes-v3/blue-lake-mobile.webp',thumbnail:'/images/themes-v3/blue-lake-thumb.webp',motion:'water'},
 {id:'train',label:'训练之境',slug:'crystal-peak',image:'/images/themes-v3/crystal-peak-wide.webp',mobile:'/images/themes-v3/crystal-peak-mobile.webp',thumbnail:'/images/themes-v3/crystal-peak-thumb.webp',motion:'crystal'},
 {id:'review',label:'温故知新',slug:'city-of-tears',image:'/images/maps/city-of-tears.webp',mobile:'/images/maps/city-of-tears-mobile.webp',thumbnail:'/images/maps/city-of-tears-thumb.webp',motion:'rain'},
 {id:'progress',label:'成长足迹',slug:'snowy-ridge',image:'/images/themes-v3/snowy-ridge-wide.webp',mobile:'/images/themes-v3/snowy-ridge-mobile.webp',thumbnail:'/images/themes-v3/snowy-ridge-thumb.webp',motion:'snow'},
 {id:'resources',label:'学习书库',slug:'white-flowers',image:'/images/themes-v3/white-flowers-wide.webp',mobile:'/images/themes-v3/white-flowers-mobile.webp',thumbnail:'/images/themes-v3/white-flowers-thumb.webp',motion:'petals'}
];
const TASK_IMAGES=['/images/maps/listening.webp','/images/maps/reading.webp','/images/maps/speaking.webp'];
const MOTION_KEY='lantern-scene-motion-v1';
const labelOf=theme=>theme.paletteName||theme.name;
async function step(name,action){const began=Date.now();try{const details=await action();report.steps.push({name,status:'passed',elapsedMs:Date.now()-began,...(details===undefined?{}:{details})});console.log(JSON.stringify({step:name,status:'passed'}));}catch(error){report.steps.push({name,status:'failed',elapsedMs:Date.now()-began,error:String(error.stack||error)});throw error;}}
async function eventually(check,message,timeout=15000){const end=Date.now()+timeout;let last;do{try{const result=await check();if(result)return result;}catch(error){last=error;}await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<end);throw new Error(message+(last?': '+last.message:''));}
async function screenshot(name){const file=path.join(OUT,name+'.png');await page.screenshot({path:file,fullPage:true,animations:'disabled'});report.screenshots.push(file);}
function webState(){return{owner:QA_OWNER,schemaVersion:2,profile:{name:'Synthetic theme QA',lrGoal:650,speakingGoal:0,examDate:'2026-12-20',dailyMinutes:25,timezone:'Asia/Shanghai',theme:'hollow',weeklyTarget:4,onboarded:true},hasProfile:false,attempts:[],checkins:[],recordings:[],questionMarks:[],resourceTasks:[]};}
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
    remote.profile={...remote.profile,theme:operation.data.theme};remote.hasProfile=true;return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
    }catch(error){report.mockErrors||=[];report.mockErrors.push(String(error.stack||error));return route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:'Synthetic QA contract failure'})});}
   }
   return route.fulfill({status:405,body:'Unsupported QA API method'});
  }
  return route.continue();
 });
 page=await context.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',error=>report.pageErrors.push(String(error)));
 page.on('console',msg=>{if(msg.type()==='error')report.consoleErrors.push(msg.text().slice(0,1000));});
 page.on('response',response=>{if(response.status()>=400&&response.url().startsWith(ORIGIN)&&!response.url().endsWith('/favicon.ico'))report.httpErrors.push({url:response.url(),status:response.status()});});
 await page.goto(ORIGIN+'/',{waitUntil:'networkidle'});assert.equal(new URL(page.url()).origin,ORIGIN);await ready();
}
async function ready(){await eventually(()=>page.getByRole('button',{name:'开始今日练习',exact:true}).isEnabled(),'Today screen did not become ready');}
async function paletteColors(id,width){const colors=await page.locator('.atlas-workspace').evaluate(el=>({background:getComputedStyle(el).backgroundColor,foreground:getComputedStyle(el).color}));assert.equal(colors.background,BACKGROUNDS[id],'Palette '+id+' is selected but its visible workspace background is overridden');paletteSamples.push({width,id,...colors});return colors;}
async function rootTheme(id){await page.waitForFunction(expected=>document.documentElement.dataset.theme===expected,id);}
async function active(value){await eventually(async()=>await page.locator('.theme-atmosphere').getAttribute('data-active')===String(value),'Atmosphere active state should be '+value);}
async function closeModal(){await page.keyboard.press('Escape');await eventually(async()=>await page.getByRole('dialog').count()===0,'Dialog did not close');}
async function openPicker(){await page.getByRole('button',{name:'选择主题',exact:true}).click();await page.getByRole('dialog',{name:'选择主题',exact:true}).waitFor({state:'visible'});}
async function finishPicker(){await page.getByRole('dialog',{name:'选择主题',exact:true}).getByRole('button',{name:'完成',exact:true}).click();await eventually(async()=>await page.getByRole('dialog').count()===0,'Done button did not close picker');}
async function navigate(scene,width){const button=width<768?page.locator('.mobile-nav').getByRole('button',{name:scene.label,exact:true}):page.locator('.study-sidebar .atlas-nav').filter({hasText:scene.label});await button.click();await page.locator('.atlas-workspace[data-region="'+scene.id+'"]').waitFor({state:'visible'});await page.locator('.region-map').scrollIntoViewIfNeeded();}
async function imageInfo(locator){await eventually(()=>locator.evaluate(img=>img.complete&&img.naturalWidth>0),'Image failed to decode');return locator.evaluate(img=>({path:new URL(img.currentSrc).pathname,width:img.naturalWidth,height:img.naturalHeight,alt:img.alt,fit:getComputedStyle(img).objectFit,position:getComputedStyle(img).objectPosition}));}
async function hero(scene,width){
 const image=page.locator('.region-art img'),expected=width<=767?scene.mobile:scene.image;
 await eventually(()=>image.evaluate((img,wanted)=>img.complete&&img.naturalWidth>0&&new URL(img.currentSrc).pathname===wanted,expected),'Wrong/undecoded '+scene.id+' hero at '+width);
 const info=await imageInfo(image);assert.ok(info.width>=600&&info.height>=330,'Unexpected low-resolution hero');
 if(scene.motion==='none')assert.equal(await page.locator('.scene-motion-toggle').count(),0,'Static review scene must not offer unrelated motion');
 else {assert.equal(await page.locator('.theme-atmosphere').getAttribute('data-kind'),scene.motion,'Motion must follow navigation scene, not global palette');await motionControlClear();}
 return info;
}
async function motionControlClear(){
 const result=await page.locator('.region-map').evaluate(scene=>{
  const control=scene.querySelector('.scene-motion-toggle').getBoundingClientRect().toJSON();
  const text=[...scene.querySelectorAll('.region-copy h1,.region-copy p,.region-topline')].filter(node=>getComputedStyle(node).visibility!=='hidden').flatMap(node=>{const range=document.createRange();range.selectNodeContents(node);return [...range.getClientRects()].map(rect=>({text:node.textContent,rect:rect.toJSON()}));});
  return{control,overlaps:text.filter(({rect})=>Math.min(rect.right,control.right)-Math.max(rect.left,control.left)>1&&Math.min(rect.bottom,control.bottom)-Math.max(rect.top,control.top)>1)};
 });
 assert.deepEqual(result.overlaps,[],'Motion control covers a scene title, description or top-line label: '+JSON.stringify(result));
 return result;
}
async function pickerControlsVisible(){
 const dialog=page.getByRole('dialog',{name:'选择主题',exact:true});
 const controls=[['title',dialog.locator('[data-slot=dialog-title]')],['close',dialog.locator('[data-slot=dialog-close]')],['done',dialog.getByRole('button',{name:'完成',exact:true})]];
 const viewport=page.viewportSize(),bounds=await dialog.boundingBox(),results=[];
 for(const [name,locator]of controls){const box=await locator.boundingBox();assert.ok(await locator.isVisible()&&box,'Picker '+name+' is not visible');assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,'Picker '+name+' left the viewport after selecting a card');assert.ok(bounds&&box.x>=bounds.x-1&&box.y>=bounds.y-1&&box.x+box.width<=bounds.x+bounds.width+1&&box.y+box.height<=bounds.y+bounds.height+1,'Picker '+name+' lies outside its dialog');const unobscured=await locator.evaluate(el=>{const rect=el.getBoundingClientRect(),top=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return top===el||el.contains(top);});assert.ok(unobscured,'Picker '+name+' is covered by another element after selection');results.push({name,...box});}
 return results;
}
async function layout(stage){const dimensions=await page.evaluate(()=>({width:innerWidth,clientWidth:document.documentElement.clientWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,overflowing:[...document.querySelectorAll('main,section,article,button,[role=dialog]')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left < -1||r.right > innerWidth+1);}).slice(0,12).map(el=>({tag:el.tagName,cls:String(el.className),right:el.getBoundingClientRect().right}))}));assert.ok(dimensions.documentWidth<=dimensions.clientWidth+1,stage+' document overflow '+JSON.stringify(dimensions));assert.ok(dimensions.bodyWidth<=dimensions.clientWidth+1,stage+' body overflow '+JSON.stringify(dimensions));if(await page.getByRole('dialog').count()){const box=await page.getByRole('dialog').boundingBox();assert.ok(box&&box.x>=-1&&box.x+box.width<=dimensions.width+1,'Dialog exceeds viewport');}return dimensions;}
async function preference(value){assert.equal(await page.evaluate(key=>localStorage.getItem(key),MOTION_KEY),value);}
async function computedMotion(expected){
 const styles=await page.locator('.theme-atmosphere').evaluate(layer=>[...layer.querySelectorAll('.ambient-particle,.ambient-glow,.ambient-water')].filter(node=>!node.classList.contains('ambient-water')||layer.dataset.kind==='water').map(node=>({className:node.className,state:getComputedStyle(node).animationPlayState,name:getComputedStyle(node).animationName,opacity:getComputedStyle(node).opacity})));
 assert.equal(styles.filter(style=>style.className==='ambient-particle').length,9);
 assert.equal(styles.filter(style=>style.className==='ambient-glow').length,1);
 if(expected==='reduced')assert.ok(styles.every(style=>style.name==='none'&&Number(style.opacity)===0),'Reduced motion still animates a particle, glow or water layer');
 else assert.ok(styles.every(style=>style.name!=='none'&&style.state===expected),'Unexpected atmosphere animation state '+JSON.stringify(styles));
 return styles;
}
async function animationProgress(expected){
 // Inspect real browser CSS animations, not only data-active or a CSS declaration.
 // Sample after two frames to let running/paused state changes reach the timeline.
 const samples=await page.locator('.theme-atmosphere').evaluate(async layer=>{
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));await frame();await frame();
  const nodes=[layer.querySelector('.ambient-particle'),layer.querySelector('.ambient-glow'),...(layer.dataset.kind==='water'?[layer.querySelector('.ambient-water')]:[])];
  const take=node=>{const style=getComputedStyle(node);return{className:node.className,transform:style.transform,opacity:style.opacity,animations:node.getAnimations().map(animation=>({name:animation.animationName,state:animation.playState,time:animation.currentTime}))};};
  const before=nodes.map(take);await new Promise(resolve=>setTimeout(resolve,250));await frame();
  return nodes.map((node,index)=>({before:before[index],after:take(node)}));
 });
 for(const {before,after} of samples){
  assert.ok(before.animations.length>0,after.className+' has no real CSS animation');
  assert.equal(after.animations.length,before.animations.length);
  for(let index=0;index<after.animations.length;index++){
   const start=before.animations[index],end=after.animations[index];
   assert.equal(end.name,start.name);assert.equal(end.state,expected);
   assert.equal(typeof start.time,'number');assert.equal(typeof end.time,'number');
   if(expected==='running')assert.ok(end.time-start.time>=100,after.className+' animation timeline did not advance');
   else assert.ok(Math.abs(end.time-start.time)<=2,after.className+' animation timeline moved while paused');
  }
  if(expected==='running')assert.ok(after.transform!==before.transform||after.opacity!==before.opacity,after.className+' timeline advanced without a rendered visual change');
 }
 return samples;
}
async function choosePalette(theme,method){
 await openPicker();const dialog=page.getByRole('dialog',{name:'选择主题',exact:true}),radio=dialog.getByRole('radio',{name:labelOf(theme),exact:true}),card=dialog.locator('.theme-option').filter({has:page.getByRole('radio',{name:labelOf(theme),exact:true})});
 if(method==='image')await card.locator('.theme-image').click();
 else if(method==='title')await card.getByRole('heading',{name:labelOf(theme),exact:true}).click();
 else if(method==='radio')await radio.click();
 else{
  // Radix defers arrow focus to a macrotask. Keep the key down through that focus
  // change, as a real keypress does, instead of racing it with a zero-delay keyup.
  const previous=catalogue.themes.find(theme=>theme.id==='crystal');await dialog.getByRole('radio',{name:labelOf(previous),exact:true}).focus();
  await page.keyboard.down('ArrowRight');try{await eventually(()=>radio.isChecked(),'ArrowRight did not wrap crystal to hollow');}finally{await page.keyboard.up('ArrowRight');}
 }
 await eventually(()=>radio.isChecked(),method+' did not select '+theme.id);await rootTheme(theme.id);
 assert.equal(await dialog.isVisible(),true,'Picker must stay open while comparing palettes');
 await layout('palette-'+method);await pickerControlsVisible();return{dialog,radio};
}
(async()=>{
 await allocateOutput();assert.deepEqual(catalogue.themes.map(theme=>theme.id),PALETTES,'Expected four palette IDs in radio order');
 await startPreview();browser=await launchBrowser();
 for(const width of WIDTHS){
  await step(`${width}px: fresh ${MODE} entry defaults on with real CSS animation progress`,async()=>{await freshPage(width);await rootTheme('hollow');await active(true);await preference(null);assert.equal(await page.locator('.scene-motion-toggle').getAttribute('aria-pressed'),'true');await computedMotion('running');return{image:await hero(SCENES[0],width),animation:await animationProgress('running')};});
  await step(`${width}px: three distinct task images and original sidebar artwork`,async()=>{
   const tasks=page.locator('.task-scene');assert.equal(await tasks.count(),3);const taskImages=[];
   for(let index=0;index<3;index++){const task=tasks.nth(index);await task.scrollIntoViewIfNeeded();const info=await imageInfo(task);assert.equal(info.path,TASK_IMAGES[index]);taskImages.push(info);}
   if(width>=768){for(const scene of SCENES){const image=page.locator('.study-sidebar .atlas-nav').filter({hasText:scene.label}).locator('img');const info=await imageInfo(image);assert.equal(info.path,scene.thumbnail,'Wrong sidebar thumbnail for '+scene.id);}const rest=page.locator('.rest-stop img');await rest.scrollIntoViewIfNeeded();assert.equal((await imageInfo(rest)).path,'/images/maps/dirtmouth.webp');}
   await page.locator('.region-map').scrollIntoViewIfNeeded();return{taskImages,sidebarChecked:width>=768};
  });
  for(const scene of SCENES)await step(`${width}px: ${scene.id} keeps its own scene, motion and layout`,async()=>{
   await navigate(scene,width);const image=await hero(scene,width);const dimensions=await layout(scene.id);
   if(scene.motion!=='none'){if(await page.locator('.scene-motion-toggle').getAttribute('aria-pressed')!=='true')await page.getByRole('button',{name:'开启轻动效',exact:true}).click();await active(true);await computedMotion('running');await animationProgress('running');await page.getByRole('button',{name:'关闭轻动效',exact:true}).click();await active(false);await computedMotion('paused');}
   await screenshot(`${scene.id}-${width}`);return{image,motion:scene.motion,dimensions};
  });
  const interactions=[['paper','image'],['silk','title'],['crystal','radio'],['hollow','keyboard']];
  for(const [index,[id,method]]of interactions.entries())await step(`${width}px: palette ${id} by ${method}, fixed scenes and reload`,async()=>{
   const scene=SCENES[index+1],theme=catalogue.themes.find(theme=>theme.id===id);await navigate(scene,width);const before=await hero(scene,width);await choosePalette(theme,method);
   if(index===0){assert.equal(await page.getByRole('dialog').getByRole('radio').count(),4);await screenshot(`palette-picker-${width}`);}
   await finishPicker();const colors=await paletteColors(id,width);assert.deepEqual(await hero(scene,width),before,'Palette changed current navigation artwork');
   await page.reload({waitUntil:'networkidle'});await ready();await rootTheme(id);assert.deepEqual(await paletteColors(id,width),colors,'Visible palette colors changed after reload');await hero(SCENES[0],width);
   await navigate(scene,width);await hero(scene,width);const dimensions=await layout('palette-'+id);await screenshot(`palette-${id}-${width}`);
   return{interaction:method,currentScene:scene.id,theme:id,colors,dimensions,unchangedSceneAfterPaletteAndReload:true};
  });
  await step(`${width}px: all four palettes have distinct rendered background and foreground`,async()=>{const samples=paletteSamples.filter(row=>row.width===width);assert.equal(new Set(samples.map(row=>row.background)).size,4,'Four palette choices collapse to fewer workspace background colors');assert.equal(new Set(samples.map(row=>row.foreground)).size,4,'Four palette choices collapse to fewer text colors');return samples;});
  await step(`${width}px: explicit on and off survive reload; off freezes all animation timelines`,async()=>{
   await navigate(SCENES[0],width);await page.getByRole('button',{name:'开启轻动效',exact:true}).click();await active(true);await preference('on');
   await page.reload({waitUntil:'networkidle'});await ready();await active(true);await preference('on');
   await page.getByRole('button',{name:'关闭轻动效',exact:true}).click();await active(false);await preference('off');await page.reload({waitUntil:'networkidle'});await ready();await active(false);await preference('off');await computedMotion('paused');return await animationProgress('paused');
  });
  await step(`${width}px: theme and practice dialogs pause motion and closing resumes`,async()=>{
   await page.getByRole('button',{name:'开启轻动效',exact:true}).click();await active(true);await openPicker();await active(false);await computedMotion('paused');await finishPicker();await active(true);
   await page.getByRole('button',{name:'开始今日练习',exact:true}).click();await page.locator('.practice-dialog').waitFor({state:'visible'});await active(false);await computedMotion('paused');const dimensions=await layout('practice');await screenshot(`practice-${width}`);await closeModal();await page.locator('.region-map').scrollIntoViewIfNeeded();await active(true);return dimensions;
  });
  await step(`${width}px: system reduced motion disables effects and restores preference`,async()=>{
   await page.emulateMedia({reducedMotion:'reduce'});await active(false);const control=page.getByRole('button',{name:'系统已减弱动态',exact:true});await eventually(()=>control.isDisabled(),'Reduced motion button remains enabled');await computedMotion('reduced');await preference('on');
   await page.reload({waitUntil:'networkidle'});await ready();await active(false);await computedMotion('reduced');await preference('on');await page.emulateMedia({reducedMotion:'no-preference'});await active(true);await computedMotion('running');await page.getByRole('button',{name:'关闭轻动效',exact:true}).click();await active(false);await preference('off');
  });
 }
 await step('no unhandled errors, failed local requests or external traffic',async()=>{assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.mockErrors||[],[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.httpErrors,[]);assert.deepEqual(report.blockedExternal,[]);if(MODE==='web'){assert.ok(mockCalls.some(row=>row.method==='GET'));for(const id of PALETTES)assert.ok(mockCalls.some(row=>row.method==='POST'&&row.type==='theme'&&row.theme===id),'No synthetic-owner theme POST for '+id);}return{pageErrors:0,httpErrors:0,blockedExternal:0,consoleErrors:0,mockCalls:mockCalls.length};});
 report.status='passed';
})().catch(async error=>{report.status='failed';report.error=String(error.stack||error);if(page&&!page.isClosed()){try{await screenshot('failure');report.lastUrl=page.url();report.lastBody=(await page.locator('body').innerText()).slice(0,15000);}catch{}}process.exitCode=1;}).finally(async()=>{try{await cleanup();}catch(error){report.status='failed';report.cleanupError=String(error.stack||error);process.exitCode=1;}report.finishedAt=new Date().toISOString();report.outputDirectory=OUT;report.mockCalls=mockCalls;report.paletteSamples=paletteSamples;if(ownsOutput)await fs.writeFile(path.join(OUT,'result.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({mode:MODE,status:report.status,passed:report.steps.filter(step=>step.status==='passed').length,failed:report.steps.filter(step=>step.status==='failed').length,output:OUT,error:report.error?.split('\n').slice(0,3).join('\n')}));if(report.cleanupError)setTimeout(()=>process.exit(1),100).unref();});
