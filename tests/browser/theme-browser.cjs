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
const repoCandidates = [process.env.LANTERN_THEME_QA_REPO, path.resolve(__dirname, '../..'), path.resolve(__dirname, '../site')].filter(Boolean);
const REPO = repoCandidates.find(candidate => require('node:fs').existsSync(path.join(candidate, 'app/study-app.tsx')));
if (!REPO) throw new Error('Set LANTERN_THEME_QA_REPO to the repository containing app/study-app.tsx');
const repoRequire = createRequire(path.join(REPO, 'package.json'));
const {chromium} = repoRequire('playwright');
const catalogue = repoRequire('./art/themes.json');

const PORT = Number(process.env.LANTERN_THEME_QA_PORT || 4187);
assert.ok(Number.isInteger(PORT) && PORT >= 1024 && PORT <= 65535, 'Invalid local QA port');
const ORIGIN = `http://127.0.0.1:${PORT}`;
let OUT;
const report = {scope:'Theme QA on an owned local production build; isolated headless browser only',origin:ORIGIN,
  limitations:['Desktop Chrome at four viewport widths is not physical-device or ArkWeb acceptance.', 'Screenshot inspection remains a separate visual review step.'],
  startedAt:new Date().toISOString(),steps:[],screenshots:[],pageErrors:[],consoleErrors:[],blockedExternal:[],httpErrors:[]};
let browser, context, page, preview, cleanupPromise;
let ownsOutput = false;
const ownerToken = crypto.randomBytes(24).toString('hex');

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
async function startPreview() {
  await fs.access(path.join(REPO,'mobile/dist/index.html')).catch(()=>{throw new Error('Build the shared production frontend first: npm --prefix mobile run build');});
  // Friendly early failure, followed by strictPort inside the actual Vite process.
  await new Promise((resolve,reject)=>{
    const probe=net.createServer(); probe.once('error',error=>reject(new Error(`Local QA port ${PORT} is unavailable: ${error.code}`)));
    probe.listen({host:'127.0.0.1',port:PORT,exclusive:true},()=>probe.close(resolve));
  });
  const config = {vite:pathToFileURL(repoRequire.resolve('vite')).href,configFile:path.join(REPO,'mobile/vite.config.ts'),port:PORT,token:ownerToken};
  const worker = `const c=JSON.parse(process.argv[1]); (async()=>{const {preview}=await import(c.vite);const server=await preview({configFile:c.configFile,logLevel:'error',preview:{host:'127.0.0.1',port:c.port,strictPort:true,open:false},plugins:[{name:'lantern-owned-qa-preview',configurePreviewServer(s){s.middlewares.use((req,res,next)=>{res.setHeader('X-Lantern-QA-Owner',c.token);next();});}}]});process.send({ready:true,pid:process.pid}); const close=()=>server.httpServer.close(()=>process.exit(0)); process.on('SIGTERM',close); process.on('SIGINT',close);})().catch(error=>{console.error(error.stack||error);process.exit(1);});`;
  preview = spawn(process.execPath,['-e',worker,JSON.stringify(config)],{cwd:REPO,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true,detached:process.platform!=='win32'});
  let logs=''; const capture=data=>{logs=(logs+data.toString()).slice(-12000);}; preview.stdout.on('data',capture);preview.stderr.on('data',capture);
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Owned Vite preview did not become ready: '+logs)),30000);
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
const EXPECTED_THEMES=[
  {id:'hollow',slug:'blue-lake',motion:'water'},
  {id:'paper',slug:'white-flowers',motion:'petals'},
  {id:'silk',slug:'snowy-ridge',motion:'snow'},
  {id:'crystal',slug:'crystal-peak',motion:'crystal'}
];
const MOTION_KEY='lantern-scene-motion-v1';
async function step(name, action) {
  const begin=Date.now();
  try {const details=await action();report.steps.push({name,status:'passed',elapsedMs:Date.now()-begin,...(details===undefined?{}:{details})});console.log(JSON.stringify({step:name,status:'passed'}));}
  catch(error){report.steps.push({name,status:'failed',elapsedMs:Date.now()-begin,error:String(error.stack||error)});throw error;}
}
async function eventually(check,message,timeout=15000) {
  const until=Date.now()+timeout;let last;
  do{try{const result=await check();if(result)return result;}catch(error){last=error;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }while(Date.now()<until);
  throw new Error(message+(last?': '+last.message:''));
}
async function screenshot(name) {
  const file=path.join(OUT,name+'.png');await page.screenshot({path:file,fullPage:true,animations:'disabled'});report.screenshots.push(file);
}
async function freshPage(width) {
  if(context)await context.close();
  context=await browser.newContext({viewport:{width,height:width===1440?1000:900},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'no-preference',serviceWorkers:'block'});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if((url.protocol==='http:'||url.protocol==='https:')&&url.origin!==ORIGIN){report.blockedExternal.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
    return route.continue();
  });
  page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>report.pageErrors.push(String(error)));
  page.on('console',msg=>{if(msg.type()==='error')report.consoleErrors.push(msg.text().slice(0,1000));});
  page.on('response',response=>{if(response.status()>=400&&response.url().startsWith(ORIGIN)&&!response.url().endsWith('/favicon.ico'))report.httpErrors.push({url:response.url(),status:response.status()});});
  await page.goto(ORIGIN+'/',{waitUntil:'networkidle'});
  assert.equal(new URL(page.url()).origin,ORIGIN);
  await ready();
}
async function ready(){await eventually(()=>page.getByRole('button',{name:'开始今日练习',exact:true}).isEnabled(),'Today practice did not become ready');}
async function rootTheme(id){await page.waitForFunction(expected=>document.documentElement.dataset.theme===expected,id);}
async function active(value){await eventually(async()=>await page.locator('.theme-atmosphere').getAttribute('data-active')===String(value),'Atmosphere active state should be '+value);}
async function closeModal(){await page.keyboard.press('Escape');await eventually(async()=>await page.getByRole('dialog').count()===0,'Modal did not close with Escape');}
async function openPicker(){await page.getByRole('button',{name:'选择主题',exact:true}).click();await page.getByRole('dialog',{name:'选择主题',exact:true}).waitFor({state:'visible'});}
async function selectTheme(theme){
  await openPicker();
  const radio=page.getByRole('dialog',{name:'选择主题',exact:true}).getByRole('radio',{name:theme.name,exact:true});
  await radio.click();await eventually(()=>radio.isChecked(),'Selected theme radio did not become checked');await rootTheme(theme.id);await closeModal();
}
async function layout(stage){
  const dimensions=await page.evaluate(()=>({width:innerWidth,clientWidth:document.documentElement.clientWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,
    overflowing:[...document.querySelectorAll('main,section,article,button,[role=dialog]')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left < -1||r.right > innerWidth+1);}).slice(0,12).map(el=>({tag:el.tagName,cls:String(el.className),right:el.getBoundingClientRect().right}))}));
  assert.ok(dimensions.documentWidth<=dimensions.clientWidth+1,stage+' document horizontal overflow: '+JSON.stringify(dimensions));
  assert.ok(dimensions.bodyWidth<=dimensions.clientWidth+1,stage+' body horizontal overflow: '+JSON.stringify(dimensions));
  const dialog=page.getByRole('dialog');
  if(await dialog.count()){
    const box=await dialog.boundingBox();assert.ok(box&&box.x>=-1&&box.x+box.width<=dimensions.width+1,stage+' dialog extends beyond viewport');
  }
  return dimensions;
}
async function hero(theme,width){
  const expected=width<=767?theme.portrait:theme.image;
  const img=page.locator('.region-art img');
  await eventually(()=>img.evaluate((image,expectedPath)=>image.complete&&image.naturalWidth>0&&new URL(image.currentSrc).pathname===expectedPath,expected),'Wrong or undecoded hero '+theme.id+' at '+width);
  const info=await img.evaluate(image=>({src:new URL(image.currentSrc).pathname,width:image.naturalWidth,height:image.naturalHeight,alt:image.alt,fit:getComputedStyle(image).objectFit,box:{width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height}}));
  assert.equal(info.alt,theme.alt);assert.ok(info.width>=900&&info.height>=500,'Hero is unexpectedly low resolution');
  if(width<=1000){assert.equal(info.fit,'contain','Mobile/tablet hero should preserve the complete character');assert.ok(Math.abs(info.box.width/info.box.height-16/9)<0.025,'Mobile hero should retain landscape aspect ratio');}
  assert.equal(await page.locator('.theme-atmosphere').getAttribute('data-kind'),theme.motion);
  // Other visible image elements must decode too; offscreen lazy images are not forced into the page.
  const visibleImages=page.locator('img:visible');
  for(let i=0;i<await visibleImages.count();i++){
    const image=visibleImages.nth(i),bounds=await image.boundingBox();
    if(bounds&&bounds.y<900&&bounds.y+bounds.height>0)await eventually(()=>image.evaluate(el=>el.complete&&el.naturalWidth>0),'Visible image failed to decode');
  }
  return info;
}
async function preference(expected){assert.equal(await page.evaluate(key=>localStorage.getItem(key),MOTION_KEY),expected);}
async function computedMotion(expected){
  const styles=await page.locator('.ambient-particle').evaluateAll(nodes=>nodes.map(node=>({state:getComputedStyle(node).animationPlayState,name:getComputedStyle(node).animationName,opacity:getComputedStyle(node).opacity})));
  assert.equal(styles.length,9);
  if(expected==='reduced')assert.ok(styles.every(style=>style.name==='none'&&Number(style.opacity)===0),'Reduced-motion must hide and remove particle animations');
  else assert.ok(styles.every(style=>style.state===expected),'Unexpected particle play states: '+JSON.stringify(styles));
  return styles;
}
(async()=>{
  await allocateOutput();
  assert.deepEqual(catalogue.themes.map(theme=>theme.id),EXPECTED_THEMES.map(theme=>theme.id),'Expected the four approved themes only');
  for(const expected of EXPECTED_THEMES){const actual=catalogue.themes.find(theme=>theme.id===expected.id);assert.equal(actual.slug,expected.slug);assert.equal(actual.motion,expected.motion);}
  await startPreview();browser=await launchBrowser();
  for(const width of WIDTHS){
    await step(`${width}px: fresh context defaults to blue lake and no motion`,async()=>{
      await freshPage(width);await rootTheme('hollow');await active(false);assert.equal(await page.getByRole('button',{name:'开启轻动效',exact:true}).getAttribute('aria-pressed'),'false');return{width,emptyIsolatedContext:true};
    });
    await step(`${width}px: picker presents four decoded previews without overflow`,async()=>{
      await openPicker();const modal=page.getByRole('dialog',{name:'选择主题',exact:true});assert.equal(await modal.getByRole('radio').count(),4);
      for(const theme of catalogue.themes)await modal.getByRole('radio',{name:theme.name,exact:true}).waitFor({state:'visible'});
      const images=await modal.locator('.theme-image').evaluateAll(async nodes=>Promise.all(nodes.map(async node=>{
        const raw=getComputedStyle(node).backgroundImage;const match=raw.match(/^url\(["']?(.*?)["']?\)$/);if(!match)throw new Error('Theme preview has no image');
        const image=new Image();image.src=match[1];await image.decode();return{path:new URL(image.src).pathname,width:image.naturalWidth,height:image.naturalHeight};
      })));
      assert.equal(images.length,4);for(const theme of catalogue.themes)assert.ok(images.some(image=>image.path===theme.image&&image.width>0),'Missing picker image '+theme.id);
      const dimensions=await layout('theme-picker');await screenshot(`theme-picker-${width}`);await closeModal();return{images,dimensions};
    });
    for(const theme of catalogue.themes){
      await step(`${width}px: ${theme.slug} selection, image, motion and reload persistence`,async()=>{
        await selectTheme(theme);const before=await hero(theme,width);await active(false);
        await page.getByRole('button',{name:'开启轻动效',exact:true}).click();await active(true);await computedMotion('running');await preference('on');
        await page.reload({waitUntil:'networkidle'});await ready();await rootTheme(theme.id);await hero(theme,width);await active(true);await preference('on');
        await page.getByRole('button',{name:'关闭轻动效',exact:true}).click();await active(false);await computedMotion('paused');await preference('off');
        await page.reload({waitUntil:'networkidle'});await ready();await rootTheme(theme.id);await hero(theme,width);await active(false);await preference('off');
        const dimensions=await layout(theme.slug);await screenshot(`${theme.slug}-${width}`);return{image:before,dimensions,themeAndBothMotionPreferencesSurviveReload:true};
      });
    }
    await step(`${width}px: open theme and practice modals pause motion, close resumes`,async()=>{
      await page.getByRole('button',{name:'开启轻动效',exact:true}).click();await active(true);
      await openPicker();await active(false);await computedMotion('paused');await closeModal();await active(true);
      await page.getByRole('button',{name:'开始今日练习',exact:true}).click();await page.locator('.practice-dialog').waitFor({state:'visible'});
      await active(false);await computedMotion('paused');const dimensions=await layout('practice-modal');await screenshot(`practice-modal-${width}`);
      await closeModal();await page.locator('.region-map').scrollIntoViewIfNeeded();await active(true);await preference('on');return{themeDialog:true,practiceDialog:true,dimensions};
    });
    await step(`${width}px: prefers-reduced-motion disables effects without erasing preference`,async()=>{
      await page.emulateMedia({reducedMotion:'reduce'});await active(false);
      const button=page.getByRole('button',{name:'系统已减弱动态',exact:true});await eventually(()=>button.isDisabled(),'Reduced-motion toggle should be disabled');assert.equal(await button.getAttribute('aria-pressed'),'true');await computedMotion('reduced');await preference('on');
      await page.reload({waitUntil:'networkidle'});await ready();await active(false);await computedMotion('reduced');await preference('on');
      await page.emulateMedia({reducedMotion:'no-preference'});await active(true);await computedMotion('running');await preference('on');
      await page.getByRole('button',{name:'关闭轻动效',exact:true}).click();await active(false);await preference('off');return{disabledWhileReduced:true,preferenceRetained:true,resumedAfterSettingRestored:true};
    });
  }
  await step('no uncaught JavaScript errors, failed local requests or external traffic',async()=>{
    assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.httpErrors,[]);assert.deepEqual(report.blockedExternal,[]);assert.deepEqual(report.consoleErrors,[]);
    return{pageErrors:0,httpErrors:0,blockedExternal:0,consoleErrors:0};
  });
  report.status='passed';
})().catch(async error=>{
  report.status='failed';report.error=String(error.stack||error);
  if(page&&!page.isClosed()){try{await screenshot('failure');report.lastUrl=page.url();report.lastBody=(await page.locator('body').innerText()).slice(0,15000);}catch{}}
  process.exitCode=1;
}).finally(async()=>{
  try{await cleanup();}catch(error){report.status='failed';report.cleanupError=String(error.stack||error);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();report.outputDirectory=OUT;
  if(ownsOutput)await fs.writeFile(path.join(OUT,'result.json'),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:report.status,passed:report.steps.filter(step=>step.status==='passed').length,failed:report.steps.filter(step=>step.status==='failed').length,output:OUT,error:report.error?.split('\n').slice(0,3).join('\n')}));
  if(report.cleanupError)setTimeout(()=>process.exit(1),100).unref();
});
