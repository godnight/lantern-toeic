'use strict';
// Development-only rendering of the real TodayDashboard, ThemeScene and shell.
// No real account, learning records, external network, simulator or phone.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..');
const TMP=path.join(ROOT,'outputs','kimi-scene-check');
const OUT=path.join(TMP,'screenshots');
const entry=`import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../app/globals.css';
import '../../app/redesign.css';
import '../../app/v041-design-theme.css';
import '../../app/learn/v041-vocabulary.css';
import '../../app/learn/audio-redesign.css';
import '../../app/v041-app-redesign.css';
import '../../app/learn/legal-pages.css';
import {applyDocumentTheme} from '../../lib/ui-theme';
import {TodayDashboard} from '../../app/learn/today-dashboard';
import {WorkspaceShell} from '../../app/learn/workspace-shell';
const theme=new URL(location.href).searchParams.get('theme')||'paper';
applyDocumentTheme(theme);
const noop=()=>{};
const task=<section className="v040-word-task"><h2>今日单词</h2><p>本组 20 词 · 已保存 10 词</p><button type="button" className="button primary">继续背词</button></section>;
createRoot(document.getElementById('root')).render(<WorkspaceShell nav="today" theme={theme} name="测试" scope="合成" syncLabel="本机" reviewCount={0} onNavigate={noop} onSearch={noop} onSync={noop}><TodayDashboard theme={theme} dateLabel="11 月 22 日 · 星期日" wordTask={task} wordSummary="" reviewSummary="" onOpenPlan={noop} onOpenPractice={noop} onOpenReview={noop}/></WorkspaceShell>);`;
async function run(){
 fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(TMP,'entry.jsx'),entry);
 fs.writeFileSync(path.join(TMP,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.jsx"></script></body></html>');
 const {createServer}=await import('vite'),react=(await import('@vitejs/plugin-react')).default,tailwind=(await import('@tailwindcss/postcss')).default;
 const vite=await createServer({configFile:false,root:ROOT,plugins:[react()],resolve:{alias:{'@':ROOT},dedupe:['react','react-dom']},css:{postcss:{plugins:[tailwind()]}},server:{host:'127.0.0.1',port:0},logLevel:'error'});
 const report={scope:'Actual shell, TodayDashboard and ThemeScene; synthetic task, desktop Chromium. No phone or ArkWeb.',cases:[],errors:[],blockedRequests:[]};let browser;
 try{
  await vite.listen();const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert(chrome,'Chrome unavailable');browser=await chromium.launch({headless:true,executablePath:chrome});
  for(const [width,height,opened] of [[390,844,false],[840,650,false],[840,650,true]])for(const theme of ['paper','crystal','hollow','silk','whale-bay','whale-moon']){
   const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});page.on('pageerror',e=>report.errors.push(e.message));
   await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin){report.blockedRequests.push(u.origin);return route.abort();}return route.continue();});
   await page.goto(`${origin}/outputs/kimi-scene-check/index.html?theme=${theme}`,{waitUntil:'networkidle'});await page.locator('.v040-today-lead').waitFor();
   if(opened){await page.getByRole('button',{name:'展开导航',exact:true}).click();await page.locator('.v040-workspace-shell[data-drawer-open="true"]').waitFor();await page.waitForFunction(()=>{const body=document.querySelector('.workspace-body'),drawer=document.querySelector('.workspace-sidebar');return Math.abs(parseFloat(getComputedStyle(body).marginLeft)-drawer.getBoundingClientRect().width)<1;});}
   await page.evaluate(async()=>{await document.fonts.ready;const img=document.querySelector('.v041-today-calm img');if(img){await img.decode();}});
   const v=await page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};const f=document.querySelector('.v041-today-calm'),img=f.querySelector('img');return {viewport:[innerWidth,innerHeight],documentWidth:document.documentElement.scrollWidth,task:rect('.v040-word-action'),frame:rect('.v041-today-calm'),source:f.dataset.sceneSource,status:f.dataset.sceneStatus,img:img?{src:img.currentSrc,complete:img.complete,natural:[img.naturalWidth,img.naturalHeight],fit:getComputedStyle(img).objectFit}:null};});
   const file=path.join(OUT,`${theme}-${width}${opened?'-drawer':''}.png`);await page.screenshot({path:file,fullPage:true});report.cases.push({theme,width,height,opened,...v,file});
   assert(v.documentWidth<=width+1,JSON.stringify({issue:'overflow',theme,width,opened,...v}));assert.equal(v.status,'available',JSON.stringify(v));assert(Math.abs(v.frame.w/v.frame.h-2)<.025,JSON.stringify({issue:'aspect',theme,width,opened,...v}));
   if(v.img){assert(v.img.complete&&v.img.natural[0]>0&&v.img.natural[1]>0,JSON.stringify(v));assert.equal(v.img.fit,'contain',JSON.stringify(v));}else assert(['paper','crystal'].includes(theme),'unexpected missing scene image '+theme);
   if(width<700)assert(v.frame.y>=v.task.bottom-1,JSON.stringify({issue:'stack',...v}));else {assert(v.frame.x>=v.task.right-1,JSON.stringify({issue:'columns',...v}));assert(Math.abs(v.frame.y-v.task.y)<2,JSON.stringify({issue:'alignment',...v}));}
   await page.close();
  }
  for(const [width,opened] of [[390,false],[840,false],[840,true]]){const rows=report.cases.filter(x=>x.width===width&&x.opened===opened),base=rows[0].frame;for(const x of rows)for(const k of ['x','y','w','h'])assert(Math.abs(x.frame[k]-base[k])<1,JSON.stringify({issue:'theme-geometry',base,row:x}));}
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.blockedRequests,[]);report.status='PASS';
 }catch(e){report.status='FAIL';report.error=e.stack||String(e);process.exitCode=1;}
 finally{await browser?.close();await vite.close();fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases.length,report:path.join(OUT,'report.json'),error:report.error}));}
}
run().catch(e=>{console.error(e);process.exitCode=1});
