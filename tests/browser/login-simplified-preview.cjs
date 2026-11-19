'use strict';
// Synthetic desktop Chromium rendering of the actual AccountPanel and current CSS.
// No real credentials, phone, account service, or native host are used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..'), TMP=path.join(ROOT,'outputs','login-simplified'), OUT=path.resolve(process.env.LANTERN_LOGIN_PREVIEW_OUT||path.join(TMP,'screenshots'));
const entry=`import React from 'react';
import {createRoot} from 'react-dom/client';
import {AccountPanel} from '../../app/account/account-panel';
import '../../app/globals.css';
import '../../app/redesign.css';
import '../../app/v041-design-theme.css';
import '../../app/learn/v041-vocabulary.css';
import '../../app/learn/audio-redesign.css';
import '../../app/v041-app-redesign.css';
import '../../app/learn/legal-pages.css';
const kind=new URL(location.href).searchParams.get('state')||'normal';
const caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false};
const ready={status:'ready',user:null,capabilities:caps,unavailable:false,message:'',access:{owner:null,epoch:1,canAccess:()=>true,assertAccess:()=>true}};
const states={normal:ready,checking:{status:'checking',message:''},error:{status:'blocked',message:'暂时无法确认账号'},huawei:{status:'checking',message:'华为账号授权进行中，旧学习分区已暂停。'}};
const noop=()=>{};
createRoot(document.getElementById('root')).render(React.createElement(AccountPanel,{state:states[kind],simplified:true,initialMode:'register',onSubmit:async()=>{},onRecheck:noop,onLogout:noop,onEnter:noop,onLegacy:noop,huawei:{login:true,binding:false,onLogin:noop,onBind:noop}}));`;
(async()=>{
 fs.mkdirSync(TMP,{recursive:true});fs.mkdirSync(OUT,{recursive:true});
 fs.writeFileSync(path.join(TMP,'entry.jsx'),entry);
 fs.writeFileSync(path.join(TMP,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.jsx"></script></body></html>');
 const {createServer}=await import('vite'),react=(await import('@vitejs/plugin-react')).default,tailwind=(await import('@tailwindcss/postcss')).default;
 const vite=await createServer({configFile:false,root:ROOT,plugins:[react()],resolve:{alias:{'@':ROOT},dedupe:['react','react-dom']},css:{postcss:{plugins:[tailwind()]}},server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'});
 const pins=['app/account/account-panel.tsx','app/account/account-panel.css'].map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')}));
 let browser;const report={scope:'Synthetic states rendered with actual AccountPanel and current source CSS in desktop Chromium; not real native account or phone.',pins,cases:[],errors:[],externalRequests:[]};
 try{
  await vite.listen();const address=vite.httpServer.address();const origin=`http://127.0.0.1:${address.port}`;
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert(chrome,'Chrome executable not found');
  browser=await chromium.launch({headless:true,executablePath:chrome});
  for(const [width,height] of [[390,844],[840,650]])for(const state of ['normal','checking','error','huawei','password','register']){
   const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>report.errors.push(e.message));
   await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin){report.externalRequests.push(u.origin);return route.abort();}return route.continue();});
   await page.goto(`${origin}/outputs/login-simplified/index.html?state=${['password','register'].includes(state)?'normal':state}`,{waitUntil:'networkidle'});
   await page.locator('main').waitFor();
   if(state==='password'||state==='register')await page.getByRole('button',{name:/账号密码登录/}).click();
   if(state==='register')await page.getByRole('button',{name:/注册账号|注册新账号/}).click();
   if(state==='checking'||state==='huawei'){
    const status=page.getByRole('status'),label=state==='checking'?'正在核对账号':'正在登录';
    assert.equal((await status.innerText()).trim(),label);
    assert.equal(await status.locator('.login-simple-spinner').getAttribute('aria-hidden'),'true');
    const sr=await status.locator('.login-simple-sr-only').evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {position:s.position,width:r.width,height:r.height};});
    assert(sr.width<=1&&sr.height<=1&&sr.position==='absolute',JSON.stringify(sr));
   }
   await page.evaluate(()=>document.fonts.ready);
   const geometry=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],title:document.querySelector('h1')?.innerText||'',buttons:[...document.querySelectorAll('button')].map(e=>({text:e.innerText.trim(),width:Math.round(e.getBoundingClientRect().width),height:Math.round(e.getBoundingClientRect().height)}))}));
   assert(geometry.document[0]<=width+1,JSON.stringify({state,geometry}));
   const file=path.join(OUT,`${state}-${width}.png`);await page.screenshot({path:file,fullPage:true});
   if(state==='normal'){
    await page.getByRole('button',{name:'帮助',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'帮助'}),details=dialog.locator('details');
    assert.equal(await details.getAttribute('open'),null);
    await dialog.getByText('学习记录保存在本机。',{exact:true}).waitFor();
    await dialog.getByRole('link',{name:'问题反馈'}).waitFor();
    await dialog.getByText('账号规则',{exact:true}).click();assert.notEqual(await details.getAttribute('open'),null);
    await dialog.getByRole('button',{name:'关闭'}).click();
   }
   report.cases.push({state,width,height,file,geometry});await page.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.status='PASS';
 }catch(e){report.status='FAIL';report.error=e.stack||String(e);process.exitCode=1;}
 finally{await browser?.close();await vite.close();fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases.length,report:path.join(OUT,'report.json'),error:report.error}));}
})().catch(e=>{console.error(e);process.exitCode=1;});
