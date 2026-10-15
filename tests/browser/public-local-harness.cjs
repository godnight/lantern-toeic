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
const EVIDENCE=path.resolve(REPO,'../dev-public-local');
const RUN=path.join(EVIDENCE,new Date().toISOString().replaceAll(':','-')+'-'+crypto.randomBytes(4).toString('hex'));
const token=crypto.randomBytes(16).toString('hex');
const report={scope:'Public local entry development browser regression',startedAt:new Date().toISOString(),limitations:['Shared React browser fixtures are not Harmony ArkWeb or device acceptance.','Synthetic local records only; no real account, production API, audio listening, or phone access.','Independent QA and visual acceptance remain separate.'],steps:[],screenshots:[],pageErrors:[],consoleErrors:[],httpErrors:[],blockedExternal:[],overflow:[]};
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
async function allocatePort(){for(let port=process.env.PUBLIC_LOCAL_MODE==='web'?42114:42214;port<(process.env.PUBLIC_LOCAL_MODE==='web'?42214:42314);port++){const ok=await new Promise(resolve=>{const probe=net.createServer();probe.once('error',()=>resolve(false));probe.listen({host:'127.0.0.1',port,exclusive:true},()=>probe.close(()=>resolve(true)));});if(ok)return port;}throw Error('No free isolated development port');}
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
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(RootStudyApp,{owner:null,nativeMode:${process.env.PUBLIC_LOCAL_MODE!=='web'}})));
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
async function fresh(width=430,theme='paper',dpr=3,{clean=false,timezoneId='America/New_York'}={}){
 if(context)await context.close();
 context=await browser.newContext({viewport:{width,height:920},deviceScaleFactor:dpr,locale:'zh-CN',timezoneId,serviceWorkers:'block',reducedMotion:'reduce'});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){report.blockedExternal.push(url.origin+url.pathname);return route.abort('blockedbyclient');}if(url.pathname.startsWith('/api/')){report.httpErrors.push({unexpectedApi:url.pathname});return route.fulfill({status:503,body:'{"error":"No external API in isolated native fixture"}'});}return route.continue();});
 await context.addInitScript(({data,clean})=>{if(!localStorage.getItem('phase2-development-fixture')){if(!clean)localStorage.setItem('lantern-v1-device',JSON.stringify({data}));localStorage.setItem('phase2-development-fixture','synthetic local-only fixture');}},{data:synthetic(theme),clean});
 await context.addInitScript(()=>{window.__ctSpeech={speak:0,cancel:0};Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],speak(){window.__ctSpeech.speak++;},cancel(){window.__ctSpeech.cancel++;}},configurable:true});});page=await context.newPage();page.setDefaultTimeout(12000);
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
module.exports={prepare,fresh,nav,readState,studyFacts,snapshot,step,eventually,pause,manifest,RUN,REPO,report,fs,path,get page(){return page;},async cleanup(){try{if(browser)await browser.close();}finally{if(server&&server.exitCode===null){await new Promise(resolve=>{const t=setTimeout(()=>{try{server.kill();}catch{}resolve();},3000);server.once('exit',()=>{clearTimeout(t);resolve();});server.send('close');});report.previewStopped=server.exitCode!==null||server.signalCode!==null;}}}};
