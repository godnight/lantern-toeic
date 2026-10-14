'use strict';
// Development smoke only. Real shared React, isolated synthetic records; never QA/device acceptance.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {createRequire}=require('node:module');
const REPO=path.resolve(__dirname,'../..');
const req=createRequire(path.join(REPO,'package.json'));
const {chromium}=req('playwright');
const EVIDENCE=path.resolve(REPO,'../dev-browser');
const RUN=path.join(EVIDENCE,new Date().toISOString().replaceAll(':','-')+'-'+crypto.randomBytes(4).toString('hex'));
const token=crypto.randomBytes(16).toString('hex');
const report={scope:'Phase 2 development browser smoke',startedAt:new Date().toISOString(),limitations:['Desktop Chrome nativeMode fixture is not Harmony ArkWeb or device acceptance.','Synthetic local records only; no real account, production API, audio listening, or phone access.','Independent QA and visual acceptance remain separate.'],steps:[],screenshots:[],pageErrors:[],consoleErrors:[],httpErrors:[],blockedExternal:[],overflow:[]};
let browser,server,origin,page,context;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function manifest(){
 const files=[];
 async function walk(p){for(const entry of await fs.readdir(path.join(REPO,p),{withFileTypes:true})){const file=path.join(p,entry.name);if(entry.isDirectory())await walk(file);else if(/\.(tsx?|css|json|svg|png|webp)$/.test(file))files.push(file);}}
 for(const p of ['app','lib','components','content','public/phase2-theme'])await walk(p);
 files.push('package.json','package-lock.json','release-manifest.json','public/build-identity.json');
 const rows=[];for(const file of files.sort())rows.push({path:file.replaceAll('\\','/'),sha256:hash(await fs.readFile(path.join(REPO,file)))});
 return{sha256:hash(JSON.stringify(rows)),files:rows};
}
async function allocatePort(){for(let port=41914;port<42014;port++){const ok=await new Promise(resolve=>{const probe=net.createServer();probe.once('error',()=>resolve(false));probe.listen({host:'127.0.0.1',port,exclusive:true},()=>probe.close(()=>resolve(true)));});if(ok)return port;}throw Error('No free isolated development port');}
async function prepare(){
 await fs.mkdir(RUN,{recursive:true});
 report.buildIdentity=JSON.parse(await fs.readFile(path.join(REPO,'public/build-identity.json'),'utf8'));
 if(process.env.PHASE2_EXPECT_BUILD_ID)assert.equal(report.buildIdentity.buildId,process.env.PHASE2_EXPECT_BUILD_ID,'Refusing a different build identity');
 report.sourceBefore=await manifest();
 const fixture=path.join(RUN,'fixture');await fs.mkdir(fixture);
 const posix=s=>s.replaceAll('\\','/');
 const entry=`import React from ${JSON.stringify(posix(req.resolve('react')))};
import {createRoot} from ${JSON.stringify(posix(req.resolve('react-dom/client')))};
import RootStudyApp from ${JSON.stringify(posix(path.join(REPO,'app/study-app.tsx')))};
import ${JSON.stringify(posix(path.join(REPO,'app/globals.css')))};
import ${JSON.stringify(posix(path.join(REPO,'app/redesign.css')))};
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(RootStudyApp,{owner:null,nativeMode:true})));
`;
 await fs.writeFile(path.join(fixture,'entry.tsx'),entry,{flag:'wx'});
 await fs.writeFile(path.join(fixture,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>',{flag:'wx'});
 const configFile=path.join(fixture,'vite.config.mjs');
 await fs.writeFile(configFile,`import react from ${JSON.stringify(pathToFileURL(req.resolve('@vitejs/plugin-react')).href)};
import tailwind from ${JSON.stringify(pathToFileURL(req.resolve('@tailwindcss/postcss')).href)};
export default {root:${JSON.stringify(fixture)},base:'./',cacheDir:${JSON.stringify(path.join(RUN,'vite-cache'))},publicDir:${JSON.stringify(path.join(REPO,'public'))},plugins:[react()],css:{postcss:{plugins:[tailwind()]}},resolve:{alias:{'@':${JSON.stringify(REPO)}},dedupe:['react','react-dom']},build:{outDir:${JSON.stringify(path.join(RUN,'dist'))},emptyOutDir:false}};`,{flag:'wx'});
 const port=await allocatePort();origin='http://127.0.0.1:'+port;
 const cfg={vite:pathToFileURL(req.resolve('vite')).href,configFile,port,token};
 const worker=`const c=JSON.parse(process.argv[1]);(async()=>{const {build,preview}=await import(c.vite);await build({configFile:c.configFile,configLoader:'native',logLevel:'warn'});const s=await preview({configFile:c.configFile,configLoader:'native',logLevel:'warn',preview:{host:'127.0.0.1',port:c.port,strictPort:true,open:false},plugins:[{name:'owned-development-preview',configurePreviewServer(server){server.middlewares.use((req,res,next)=>{res.setHeader('X-Lantern-Development-Owner',c.token);next();});}}]});process.send({ready:true,pid:process.pid});process.on('message',m=>{if(m==='close')s.httpServer.close(()=>process.exit(0));});})().catch(e=>{console.error(e.stack||e);process.exit(1);});`;
 server=spawn(process.execPath,['-e',worker,JSON.stringify(cfg)],{cwd:REPO,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 let logs='';const capture=data=>{logs+=data;};server.stdout.on('data',capture);server.stderr.on('data',capture);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Build/preview timed out: '+logs.slice(-8000))),180000);server.once('error',e=>{clearTimeout(timer);reject(e);});server.once('exit',code=>{clearTimeout(timer);reject(Error('Build/preview exited '+code+': '+logs.slice(-8000)));});server.once('message',m=>{clearTimeout(timer);m?.ready&&m.pid===server.pid?resolve():reject(Error('Unexpected preview owner'));});});
 await fs.writeFile(path.join(RUN,'vite.log'),logs);
 const built=[];async function builtFiles(relative=''){for(const entry of await fs.readdir(path.join(RUN,'dist',relative),{withFileTypes:true})){const file=path.join(relative,entry.name);if(entry.isDirectory())await builtFiles(file);else built.push({path:file.replaceAll('\\','/'),sha256:hash(await fs.readFile(path.join(RUN,'dist',file)))});}}await builtFiles();built.sort((a,b)=>a.path.localeCompare(b.path));report.builtResources={sha256:hash(JSON.stringify(built)),count:built.length};await fs.writeFile(path.join(RUN,'built-resource-manifest.json'),JSON.stringify(built,null,2));
 const response=await fetch(origin,{signal:AbortSignal.timeout(10000)});assert.equal(response.headers.get('x-lantern-development-owner'),token);assert.equal(response.status,200);
 report.preview={origin,pid:server.pid,owned:true,cacheDir:path.join(RUN,'vite-cache')};
 let executablePath;
 if(!await fs.access(chromium.executablePath()).then(()=>true,()=>false)){
  for(const dir of [process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter(Boolean)){const p=path.join(dir,'Google/Chrome/Application/chrome.exe');if(await fs.access(p).then(()=>true,()=>false)){executablePath=p;break;}}
  if(!executablePath)throw Error('No installed Chromium/Chrome; no browser download is allowed');
 }
 browser=await chromium.launch({headless:true,...executablePath?{executablePath}:{}});
 report.browser={executable:executablePath||chromium.executablePath(),version:await browser.version(),playwright:req('playwright/package.json').version};
}
async function step(name,action,{optional=false}={}){const started=Date.now();try{const details=await action();report.steps.push({name,status:'passed',elapsedMs:Date.now()-started,...details===undefined?{}:{details}});console.log(JSON.stringify({step:name,status:'passed'}));return true;}catch(error){report.steps.push({name,status:'failed',elapsedMs:Date.now()-started,error:String(error.stack||error)});console.log(JSON.stringify({step:name,status:'failed',error:String(error)}));await fs.writeFile(path.join(RUN,'last-dom.txt'),await page?.locator('body').innerText().catch(()=>''));if(page)await page.screenshot({path:path.join(RUN,'failure-'+report.steps.length+'.png'),fullPage:true}).catch(()=>{});if(!optional)throw error;return false;}}
async function eventually(fn,message,ms=12000){const until=Date.now()+ms;let last;do{try{const value=await fn();if(value)return value;}catch(e){last=e;}await pause(80);}while(Date.now()<until);throw Error(message+(last?' '+last:''));}
function synthetic(theme){return{schemaVersion:2,profile:{name:'Phase 2 synthetic developer',lrGoal:650,speakingGoal:0,examDate:'2026-12-20',dailyMinutes:25,timezone:'Asia/Shanghai',theme,weeklyTarget:4,onboarded:true},attempts:[],checkins:[],recordings:[],questionMarks:[],resourceTasks:[]};}
async function fresh(width=430,theme='paper',dpr=3){
 if(context)await context.close();
 context=await browser.newContext({viewport:{width,height:920},deviceScaleFactor:dpr,locale:'zh-CN',timezoneId:'Asia/Shanghai',serviceWorkers:'block',reducedMotion:'reduce'});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){report.blockedExternal.push(url.origin+url.pathname);return route.abort('blockedbyclient');}if(url.pathname.startsWith('/api/')){report.httpErrors.push({unexpectedApi:url.pathname});return route.fulfill({status:503,body:'{"error":"No external API in isolated native fixture"}'});}return route.continue();});
 await context.addInitScript(({data})=>{if(!localStorage.getItem('phase2-development-fixture')){localStorage.setItem('lantern-v1-device',JSON.stringify({data}));localStorage.setItem('phase2-development-fixture','synthetic nativeMode');}},{data:synthetic(theme)});
 page=await context.newPage();page.setDefaultTimeout(12000);
 page.on('pageerror',error=>report.pageErrors.push({url:page.url(),error:String(error)}));page.on('console',msg=>{if(msg.type()==='error')report.consoleErrors.push(msg.text().slice(0,2000));});page.on('response',response=>{if(response.status()>=400&&response.url().startsWith(origin)&&!response.url().endsWith('/favicon.ico'))report.httpErrors.push({url:response.url(),status:response.status()});});
 await page.goto(origin,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'开始今日练习',exact:true}).waitFor();
 await eventually(()=>page.getByRole('button',{name:'制定单词计划',exact:true}).isEnabled(),'Word workflow ready');
}
async function nav(name){await page.locator('.workspace-mobile-nav').getByRole('button',{name,exact:true}).click();}
async function readState(){return page.evaluate(async()=>{
 const local=Object.fromEntries(Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).map(key=>{const raw=localStorage.getItem(key);try{return[key,JSON.parse(raw)];}catch{return[key,raw];}}));
 const databases=await indexedDB.databases();const workflow={};
 if(databases.some(d=>d.name==='lantern-workflow-v1'))await new Promise((resolve,reject)=>{const r=indexedDB.open('lantern-workflow-v1');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const tx=db.transaction([...db.objectStoreNames]);for(const name of db.objectStoreNames){const req=tx.objectStore(name).getAll();req.onsuccess=()=>workflow[name]=req.result;}tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});
 return{local,workflow};
 });}
function studyFacts(state){const attempts=new Map(),checkins=new Map(),reviews=new Map();for(const [key,value] of Object.entries(state.local)){if(key==='lantern-v1-device'){for(const row of value.data.attempts)attempts.set(row.id,row);for(const row of value.data.checkins)checkins.set(row.id,row);}if(key.startsWith('lantern-v1-device:op:')){if(value.type==='attempt')attempts.set(value.data.id,value.data);if(value.type==='checkin')checkins.set(value.data.id,value.data);}if(key.startsWith('lantern-vocab-v1:device:'))for(const row of value.events||[])if(row.type==='review')reviews.set(row.id,row);}return{attempts:[...attempts.values()],checkins:[...checkins.values()],reviews:[...reviews.values()]};}
async function snapshot(name){const out=path.join(RUN,name+'.png');await page.screenshot({path:out,fullPage:true,animations:'disabled'});report.screenshots.push({name,path:out,viewport:page.viewportSize(),dpr:await page.evaluate(()=>devicePixelRatio)});const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,offenders:[...document.querySelectorAll('main *')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.right>innerWidth+1&&getComputedStyle(el).position!=='fixed';}).slice(0,10).map(el=>({tag:el.tagName,class:el.className,right:el.getBoundingClientRect().right}))}));report.overflow.push({name,...overflow});assert.ok(overflow.document<=overflow.viewport+1,'Horizontal overflow '+JSON.stringify(overflow));}
async function savePlan(){
 await nav('单词');await page.getByRole('button',{name:'建立计划',exact:true}).click();await page.getByLabel('总覆盖目标').fill('8');await page.getByLabel('每日新词量').fill('3');
 const checks=page.locator('.phase2-weekday-picker input');for(let i=0;i<await checks.count();i++)await checks.nth(i).check();
 await page.getByRole('button',{name:'保存计划',exact:true}).click();await page.locator('.phase2-plan-editor').waitFor({state:'hidden'});await page.getByText('每周 7 天 · 每天 3 个新词 · 21 个／周',{exact:true}).waitFor();
}
async function testVocabulary(){
 await step('Save real total / daily / all-week plan',async()=>{await savePlan();const s=await readState();assert.equal(s.workflow.plans.length,1);assert.equal(studyFacts(s).reviews.length,0);await snapshot('native-paper-430-plan');return s.workflow.plans[0];});
 await step('Today is the same plan, not a separate counter',async()=>{await nav('今日');const today=page.locator('.phase2-today-vocabulary');assert.match(await today.innerText(),/3\s*待学新词/);await today.getByRole('button',{name:'开始今日词组',exact:true}).click();await page.locator('.phase2-current-word').waitFor();assert.equal(await page.locator('.phase2-word-meaning').count(),0);});
 for(const [i,rating] of ['认识','模糊','忘记'].entries())await step('Three-grade durable feedback '+rating,async()=>{
  const word=await page.locator('.phase2-current-word').innerText();const before=studyFacts(await readState());await page.getByRole('button',{name:rating,exact:true}).click();await page.locator('.phase2-word-meaning').waitFor();const after=studyFacts(await readState());assert.equal(after.reviews.length,before.reviews.length+1);const priorIds=new Set(before.reviews.map(e=>e.id));assert.equal(after.reviews.find(e=>!priorIds.has(e.id)).grade,i===0?'remembered':'again');
  if(i===0){
   await snapshot('native-paper-430-revealed-word');
   const trigger=page.locator('.phase2-word-meaning .example-word').first();const text=await trigger.innerText();await trigger.click();await page.getByRole('dialog',{name:'例句 · 就地查词',exact:true}).waitFor();await snapshot('native-paper-430-example-lookup');
   assert.equal(await page.locator('.practice-lookup-dialog .example-word').count(),0,'No recursive lookup');
   const lookupFacts=studyFacts(await readState());assert.equal(lookupFacts.reviews.length,after.reviews.length);assert.equal(lookupFacts.checkins.length,0);
   await page.goBack();await page.getByRole('dialog',{name:'例句 · 就地查词',exact:true}).waitFor({state:'hidden'});assert.equal(await page.locator('.phase2-current-word').innerText(),word);assert.equal(await page.locator('.phase2-word-meaning').count(),1);await eventually(()=>page.evaluate(t=>document.activeElement?.textContent===t,text),'Focus returns to original example token');
   await page.reload({waitUntil:'networkidle'});await nav('单词');await page.locator('.phase2-word-meaning').waitFor();assert.equal(await page.locator('.phase2-current-word').innerText(),word);assert.equal(studyFacts(await readState()).reviews.length,1);
  }
  await page.getByRole('button',{name:i===2?'完成这一组':'下一词',exact:true}).click();if(i<2)await eventually(async()=>await page.locator('.phase2-current-word').innerText()!==word,'Explicit next changes card');else await page.locator('.phase2-word-finished').waitFor();
  return{word,reviewCount:after.reviews.length,rawRating:rating};
 });
 await step('Candidate add is membership only; daily progress unchanged',async()=>{
  await page.getByRole('button',{name:'回到单词计划',exact:true}).click();await page.getByRole('button',{name:'去查词添加候选',exact:true}).click();const search=page.locator('input[type=search]');await search.fill('invoice');
  await page.locator('.word-open').filter({has:page.getByRole('heading',{name:'invoice',exact:true})}).first().click();const candidate=page.getByRole('button',{name:/加入新学候选.*invoice/i});await candidate.first().waitFor();const before=studyFacts(await readState());await candidate.first().click();await page.getByRole('button',{name:/已加入新学候选.*invoice/i}).first().waitFor();const after=studyFacts(await readState());assert.equal(after.reviews.length,before.reviews.length);assert.equal(after.checkins.length,0);await snapshot('native-paper-430-search-candidate');await page.goBack();await page.getByRole('button',{name:'返回来源页',exact:true}).click();await page.locator('.workspace-mobile-nav').waitFor({state:'visible'});
 });
}
async function practiceDialog(){return page.getByRole('dialog').filter({has:page.locator('.practice-footer')});}
async function answerGroup({reloadFirst=false}={}){
 const qids=[];let count=0;
 for(;;){
  const dialog=await practiceDialog();await dialog.waitFor();const state=await readState();const active=state.workflow.sessions.map(row=>row.value).find(s=>s.kind==='practice-session'&&s.status==='active');
  // Persisted shape is inspected read-only, with the UI remaining the writer.
  const qid=active?.questionIds?.[active.cursor];if(qid)qids.push(qid);
  await dialog.getByRole('radio').first().click();await dialog.getByRole('button',{name:'确认答案',exact:true}).click();await dialog.locator('.answer-feedback').waitFor();count++;
  if(reloadFirst&&count===1){const facts=studyFacts(await readState());assert.equal(facts.attempts.length,1);await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'恢复这一组',exact:true}).click();await (await practiceDialog()).locator('.answer-feedback').waitFor();assert.equal(studyFacts(await readState()).attempts.length,1);}
  const current=await practiceDialog();const complete=current.getByRole('button',{name:'完成本组',exact:true});if(await complete.count()){await complete.click();break;}await current.getByRole('button',{name:'下一题',exact:true}).click();
 }
 await page.getByRole('button',{name:'记录时间与收获',exact:true}).waitFor();return{count,qids};
}
async function testPractice(){
 await step('Durable complete target-5 practice; answer survives reload',async()=>{
  await nav('练习');await page.getByLabel('练习专项').selectOption('3');await page.getByRole('button',{name:'开始自选练习',exact:true}).click();const group=await answerGroup({reloadFirst:true});assert.ok(group.count>=5);const catalog=req('./content/questions.json');const ids=new Set(group.qids);for(const qid of ids){const q=catalog.find(q=>q.id===qid);for(const sibling of catalog.filter(other=>other.part===q.part&&other.groupId===q.groupId))assert.ok(ids.has(sibling.id),'Whole group preserved');}report.firstPractice=group;await snapshot('native-paper-430-practice-complete');
  const s=await readState();assert.equal(studyFacts(s).attempts.length,group.count);assert.equal(studyFacts(s).checkins.length,0);return group;
 });
 await step('Continue next group is disjoint; prior unconfirmed draft survives',async()=>{
  await page.getByRole('button',{name:'继续一组',exact:true}).click();const second=await answerGroup();const facts=studyFacts(await readState());const firstIds=new Set(report.firstPractice.qids);assert.ok(second.qids.every(id=>!firstIds.has(id)));assert.equal(facts.attempts.length,report.firstPractice.count+second.count);assert.equal(facts.checkins.length,0);report.secondPractice=second;const s=await readState();const sessions=s.workflow.sessions.map(row=>row.value).filter(s=>s.kind==='practice-session');assert.equal(sessions.filter(s=>s.status==='completed'&&s.settlement.status==='draft').length,2);return second;
 });
 await step('Completion → settlement survives old Practice history cleanup; later saves draft',async()=>{
  await page.getByRole('button',{name:'记录时间与收获',exact:true}).click();const dialog=page.getByRole('dialog',{name:'确认这一组的实际用时',exact:true});await dialog.waitFor();await pause(600);assert.equal(await dialog.isVisible(),true);await dialog.getByLabel('实际学习分钟').fill('7');await dialog.getByLabel('一个收获或卡点').fill('synthetic development settlement');await snapshot('native-paper-430-settlement');await dialog.getByRole('button',{name:'稍后确认',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(studyFacts(await readState()).checkins.length,0);
  await page.reload({waitUntil:'networkidle'});const drafts=page.getByRole('button',{name:'确认这组时间',exact:true});assert.equal(await drafts.count(),2);for(let i=0;i<2;i++){await drafts.nth(i).click();await dialog.waitFor();if(await dialog.getByLabel('实际学习分钟').inputValue()==='7')break;await dialog.getByRole('button',{name:'稍后确认',exact:true}).click();await dialog.waitFor({state:'hidden'});}assert.equal(await dialog.getByLabel('实际学习分钟').inputValue(),'7');assert.equal(await dialog.getByLabel('一个收获或卡点').inputValue(),'synthetic development settlement');
  await dialog.getByRole('button',{name:'确认并记下时间',exact:true}).dblclick();await dialog.waitFor({state:'hidden'});const facts=studyFacts(await readState());assert.equal(facts.checkins.length,1);assert.equal(facts.checkins[0].minutes,7);report.firstCheckin=facts.checkins[0];await page.reload({waitUntil:'networkidle'});assert.equal(studyFacts(await readState()).checkins.length,1);return facts.checkins[0];
 });
 await step('Reload keeps one confirmed Checkin and the other settlement draft',async()=>{
  const facts=studyFacts(await readState());assert.equal(facts.checkins.length,1);assert.equal(facts.attempts.length,report.firstPractice.count+report.secondPractice.count);assert.equal(await page.getByRole('button',{name:'确认这组时间',exact:true}).count(),1);return{firstCount:report.firstPractice.count,secondCount:report.secondPractice.count,checkins:facts.checkins.length};
 });
}
async function screenshots(){
 for(const [theme,label] of [['paper','cream'],['hollow','hollow']])for(const width of [320,430]){
  await fresh(width,theme,width===320?2:3);await snapshot(`native-${label}-${width}-today`);await savePlan();await snapshot(`native-${label}-${width}-plan`);
  await page.locator('.phase2-today-vocabulary').getByRole('button',{name:'开始今日词组',exact:true}).click();await page.getByRole('button',{name:'认识',exact:true}).click();await page.locator('.phase2-word-meaning').waitFor();await snapshot(`native-${label}-${width}-word`);
  await page.locator('.phase2-word-meaning .example-word').first().click();await page.getByRole('dialog',{name:'例句 · 就地查词',exact:true}).waitFor();await snapshot(`native-${label}-${width}-lookup`);
 }
}
async function cleanup(){try{if(browser)await browser.close();}finally{if(server&&server.exitCode===null){await new Promise(resolve=>{const t=setTimeout(()=>{try{server.kill();}catch{}resolve();},3000);server.once('exit',()=>{clearTimeout(t);resolve();});server.send('close');});report.previewStopped=server.exitCode!==null||server.signalCode!==null;}}}
(async()=>{
 try{await prepare();await fresh();await testVocabulary();await testPractice();await fs.writeFile(path.join(RUN,'workflow-checkpoint.json'),JSON.stringify(await readState(),null,2));await step('Cream / Hollow 320 DPR2 and 430 DPR3 screenshots and overflow',screenshots,{optional:true});await step('Browser, console, resources and external isolation remain clean',async()=>{assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.httpErrors,[]);assert.deepEqual(report.blockedExternal,[]);});report.status=report.steps.every(s=>s.status==='passed')?'passed':'failed';}
 catch(error){report.status='failed';report.error=String(error.stack||error);}
 finally{if(page)await fs.writeFile(path.join(RUN,'final-state.json'),JSON.stringify(await readState().catch(e=>({error:String(e)})),null,2));await cleanup().catch(e=>report.cleanupError=String(e));report.sourceAfter=await manifest().catch(e=>({error:String(e)}));report.sourceChangedDuringRun=report.sourceBefore?.sha256!==report.sourceAfter?.sha256;if(process.env.PHASE2_EXPECT_BUILD_ID&&report.sourceChangedDuringRun){report.status='failed';report.error='Frozen runtime source changed during the run';}report.finishedAt=new Date().toISOString();await fs.mkdir(RUN,{recursive:true});await fs.writeFile(path.join(RUN,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:path.join(RUN,'report.json'),steps:report.steps.map(s=>({name:s.name,status:s.status})),error:report.error}));if(report.status!=='passed')process.exitCode=1;}
})();
