'use strict';
// Real candidate React + controller and bridge contract, synthetic fixture only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {build}=require('esbuild'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),site=root;
const stub={
  'study':`import React from 'react';export default function StudyApp(){return <h1>今日学习</h1>}`,
  'legal':`import React from 'react';export const PublicInfoLink=({kind,children})=><a href={'/'+kind}>{children}</a>;export const PublicInfoLinks=()=>null`,
  'recovery':`import React from 'react';export const GuestDataRecovery=()=>null`,
  'theme':`export const applyDocumentTheme=()=>{}`,
};
const resolveFile=p=>[p,p+'.tsx',p+'.ts',p+'.js',path.join(p,'index.tsx'),path.join(p,'index.ts')].find(x=>fs.existsSync(x)&&fs.statSync(x).isFile());
async function main(){const code=(await build({stdin:{resolveDir:root,sourcefile:'fixture.jsx',loader:'jsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import NativeAccountRoot from './mobile/src/NativeAccountRoot';import {installHarmonyHost} from '@/lib/native-host';installHarmonyHost();createRoot(document.getElementById('root')).render(<NativeAccountRoot/>);`},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-fixtures',setup(b){
 b.onResolve({filter:/legal-pages/},()=>({path:'legal',namespace:'fixture'}));
 b.onResolve({filter:/^@\/app\/study-app$/},()=>({path:'study',namespace:'fixture'}));
 b.onResolve({filter:/^@\/app\/learn\/guest-data-recovery$/},()=>({path:'recovery',namespace:'fixture'}));
 b.onResolve({filter:/^@\/lib\/ui-theme$/},()=>({path:'theme',namespace:'fixture'}));
 b.onResolve({filter:/^@\//},a=>{const p=a.path.slice(2),f=resolveFile(path.join(root,p))||resolveFile(path.join(site,p));if(!f)throw Error('Missing fixture import '+a.path);return {path:f};});
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stub[a.path],loader:'jsx',resolveDir:root}));
 }}],logLevel:'silent'})).outputFiles[0].text;
const css=fs.readFileSync(path.join(root,'app/account/account-choice.css'),'utf8');
const styles=fs.readdirSync(path.join(site,'mobile/dist/assets')).filter(name=>name.endsWith('.css')).map(name=>fs.readFileSync(path.join(site,'mobile/dist/assets',name),'utf8')).join('\n');
const html=`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}\n${css}</style></head><body><div id="root"></div><script>${code}</script></body></html>`;
const override=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const chrome=override||[chromium.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
assert(chrome&&fs.existsSync(chrome),'Install Playwright Chromium or provide PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH');
const browser=await chromium.launch({headless:true,executablePath:chrome});try{
 for(const viewport of [{width:390,height:844},{width:840,height:650}]){
  const ctx=await browser.newContext({viewport}),errors=[];
  await ctx.route('**/*',r=>{const url=new URL(r.request().url());return url.origin==='https://lantern.local'?r.fulfill({contentType:'text/html',body:html}):r.abort();});
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{let authenticated=false,hold=false,waiting=null,challengeCount=0;const calls=[];window.__calls=calls;
   const user={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},caps={passwordLogin:true,phoneLogin:true,passwordRecovery:false,cloudSync:false};
   window.__releaseSession=()=>{hold=false;if(waiting){const send=waiting;waiting=null;send();}};
   window.LanternAuthHost={request(raw){const r=JSON.parse(raw);calls.push(r.action);const reply=(status,body)=>queueMicrotask(()=>window.__lanternAuthReceive?.({id:r.id,status,body,...r.version?{version:r.version}:{}}));
    if(r.action==='session'){const send=()=>authenticated?reply(200,{user,capabilities:caps,session:{validForMs:3600000}}):reply(401,{code:'unauthenticated'});if(hold)waiting=send;else send();}
    else if(r.action==='providers')reply(200,{huaweiLogin:true,huaweiBinding:true});
    else if(r.action==='phone-status'){if(new URLSearchParams(location.search).has('disabled'))reply(503,{code:'phone-unavailable',capabilities:{phoneLogin:false,phoneBinding:false}});else reply(200,{capabilities:{phoneLogin:true,phoneBinding:true}});}
    else if(r.action==='phone-challenge'){challengeCount++;reply(202,{challengeId:(challengeCount===1?'c':'d').repeat(32),phone:r.body.phone,purpose:'login',expiresAt:new Date(Date.now()+300000).toISOString(),resendAt:new Date(Date.now()-1000).toISOString()});}
    else if(r.action==='phone-login'){if(r.body.code==='000000')reply(401,{code:'invalid-code',attemptsRemaining:0});else{authenticated=true;hold=true;reply(200,{user,capabilities:caps});}}
    else if(r.action==='huawei-login'){authenticated=true;hold=true;reply(200,{user,capabilities:caps});}
    else if(r.action==='login'){authenticated=true;hold=true;reply(200,{user,capabilities:caps});}
    else throw Error('Unexpected fixture action '+r.action);
   }};
  });
  await page.goto('https://lantern.local/');try{await page.getByRole('heading',{name:'登录微光'}).waitFor({timeout:5000});}catch(error){console.error('DEBUG',await page.locator('body').innerText(),errors,await page.evaluate(()=>window.__calls));throw error;}
  const huawei=page.getByRole('button',{name:'使用华为账号登录'});await huawei.waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('.auth-choice-primary').disabled);
  if(process.env.LANTERN_AUTH_QA_DIR){fs.mkdirSync(process.env.LANTERN_AUTH_QA_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.LANTERN_AUTH_QA_DIR,`actual-choice-${viewport.width}.png`)});}
  await huawei.click();assert.equal(await page.getByRole('alert').innerText(),'请先阅读并同意用户协议和隐私政策。');assert(!(await page.evaluate(()=>window.__calls)).includes('huawei-login'));
  assert.equal(await page.getByRole('link',{name:'用户协议'}).getAttribute('href'),'/terms');assert.equal(await page.getByRole('link',{name:'隐私政策'}).getAttribute('href'),'/privacy');
  await page.getByRole('button',{name:'手机号登录',exact:true}).click();await page.getByRole('heading',{name:'手机号登录'}).waitFor();await page.waitForFunction(()=>window.__calls.includes('phone-status'));
  if(process.env.LANTERN_AUTH_QA_DIR){fs.mkdirSync(process.env.LANTERN_AUTH_QA_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.LANTERN_AUTH_QA_DIR,`actual-phone-${viewport.width}.png`)});}
  await page.getByRole('button',{name:'账号密码登录'}).click();await page.getByRole('heading',{name:'登录微光账号'}).waitFor();await page.getByLabel('用户名',{exact:true}).fill('synthetic_a');await page.getByLabel('密码',{exact:true}).fill('syntheticpass');await page.getByRole('button',{name:'登录',exact:true}).click();assert.equal(await page.getByRole('alert').innerText(),'请先阅读并同意用户协议和隐私政策。');assert(!(await page.evaluate(()=>window.__calls)).includes('login'));assert.equal(await page.evaluate(()=>window.__LANTERN_HARMONY__.onBackPress()),true);await page.getByRole('heading',{name:'手机号登录'}).waitFor();
  await page.getByLabel('手机号',{exact:true}).fill('13800138000');await page.getByRole('button',{name:'获取验证码'}).click();assert.equal(await page.getByRole('alert').innerText(),'请先阅读并同意用户协议和隐私政策。');assert(!(await page.evaluate(()=>window.__calls)).includes('phone-challenge'));
  await page.locator('input[type=checkbox]').check();await page.getByRole('button',{name:'获取验证码'}).click();await page.getByLabel('验证码',{exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('[name=code]').disabled);
  // Root receives native background first, then document visibility. On return,
  // it independently rechecks account and the phone capability.
  await page.getByLabel('验证码',{exact:true}).fill('123');await page.evaluate(()=>{window.__LANTERN_HARMONY__.onAppState(false);Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await page.getByRole('heading',{name:'账号需要核对'}).waitFor();
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));window.__LANTERN_HARMONY__.onAppState(true);});await page.getByRole('heading',{name:'手机号登录'}).waitFor();await page.waitForFunction(()=>!document.querySelector('[name=code]').disabled);assert.equal(await page.getByLabel('手机号',{exact:true}).inputValue(),'+8613800138000');assert.equal(await page.getByLabel('验证码',{exact:true}).inputValue(),'');assert.equal((await page.evaluate(()=>window.__calls)).filter(x=>x==='phone-challenge').length,1);
  await page.getByLabel('验证码',{exact:true}).fill('000000');await page.getByRole('button',{name:'登录 / 注册'}).click();await page.getByText(/验证码未获确认/).waitFor();await page.waitForFunction(()=>!document.querySelector('[name=code]').disabled);assert.equal(await page.getByRole('heading',{name:'今日学习'}).count(),0);assert.equal(await page.getByLabel('验证码',{exact:true}).inputValue(),'');await page.getByLabel('验证码',{exact:true}).fill('731428');assert.equal(await page.getByRole('button',{name:'登录 / 注册'}).isDisabled(),true,'exhausted code remains disabled');await page.getByRole('button',{name:'重新获取'}).click();await page.waitForFunction(()=>window.__calls.filter(x=>x==='phone-challenge').length===2);await page.waitForFunction(()=>document.querySelector('[name=code]').value==='');
  await page.getByLabel('验证码',{exact:true}).fill('731428');assert.equal(await page.getByRole('button',{name:'登录 / 注册'}).isEnabled(),true,'fresh challenge clears exhausted state');await page.getByLabel('验证码',{exact:true}).fill('000000');await page.getByRole('button',{name:'登录 / 注册'}).click();await page.getByText(/验证码未获确认/).waitFor();await page.waitForFunction(()=>!document.querySelector('[name=code]').disabled);await page.getByLabel('手机号',{exact:true}).fill('13900139000');assert.equal(await page.getByText(/验证码未获确认/).count(),0,'changing phone clears old outcome');await page.getByRole('button',{name:'获取验证码'}).click();await page.waitForFunction(()=>window.__calls.filter(x=>x==='phone-challenge').length===3&&!document.querySelector('[name=code]').disabled);
  await page.getByLabel('验证码',{exact:true}).fill('731428');await page.getByRole('button',{name:'登录 / 注册'}).click();await page.waitForFunction(()=>window.__calls.filter(x=>x==='phone-login').length===3);await page.waitForFunction(()=>window.__calls.filter(x=>x==='session').length>=5);
  assert.equal(await page.getByRole('heading',{name:'今日学习'}).count(),0,'must await independent session proof');await page.evaluate(()=>window.__releaseSession());await page.getByRole('heading',{name:'今日学习'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.reload();await page.getByRole('heading',{name:'登录微光'}).waitFor();await page.waitForFunction(()=>!document.querySelector('.auth-choice-primary').disabled);await page.locator('input[type=checkbox]').check();await page.getByRole('button',{name:'使用华为账号登录'}).click();await page.waitForFunction(()=>window.__calls.includes('huawei-login'));await page.waitForFunction(()=>window.__calls.filter(x=>x==='session').length===2);assert.equal(await page.getByRole('heading',{name:'今日学习'}).count(),0,'Huawei also waits for independent session proof');await page.evaluate(()=>window.__releaseSession());await page.getByRole('heading',{name:'今日学习'}).waitFor();
  await page.goto('https://lantern.local/?disabled=1');await page.getByRole('heading',{name:'登录微光'}).waitFor();await page.getByRole('button',{name:'手机号登录',exact:true}).click();await page.getByText('手机号服务尚未配置，暂时不能登录。').waitFor();assert.equal(await page.getByRole('button',{name:'获取验证码'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'账号密码登录'}).isVisible(),true);assert(!(await page.evaluate(()=>window.__calls)).includes('phone-challenge'));
  await page.getByRole('button',{name:'账号密码登录'}).click();await page.getByRole('heading',{name:'登录微光账号'}).waitFor();await page.locator('input[type=checkbox]').check();await page.getByLabel('用户名',{exact:true}).fill('synthetic_a');await page.getByLabel('密码',{exact:true}).fill('syntheticpass');await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForFunction(()=>window.__calls.includes('login'));await page.waitForFunction(()=>window.__calls.filter(x=>x==='session').length===2);assert.equal(await page.getByRole('heading',{name:'今日学习'}).count(),0,'password login waits for independent session proof');await page.evaluate(()=>window.__releaseSession());await page.getByRole('heading',{name:'今日学习'}).waitFor();
  assert.deepEqual(errors,[]);await ctx.close();console.log('native synthetic login flow PASS',viewport.width);
 }
}finally{await browser.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
