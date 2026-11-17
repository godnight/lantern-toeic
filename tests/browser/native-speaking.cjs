'use strict';
// Actual React page, client, ETS session/recorder adapter and IndexedDB. Only
// OS capture/auth/port delivery are synthetic; ftyp bytes are NOT playable AAC.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {buildSync}=require('esbuild'),{chromium}=require('playwright');
const {nativeMediaRuntime}=require('../helpers/native-media-runtime.cjs');
const ROOT=path.resolve(__dirname,'../..'),SHARED=path.resolve(process.env.LANTERN_NATIVE_MEDIA_SHARED||path.join(ROOT,'mobile/dist')),ORIGIN='https://lantern.local';
const OUT=path.resolve(process.env.LANTERN_NATIVE_MEDIA_QA_OUT||path.join(ROOT,'.preview/native-speaking'));
const report={scope:'Actual native speaking components + ETS logic + real browser IndexedDB; controlled OS/lease/port seams',checks:[],errors:[],privateRequests:[],limits:['No microphone, OS permission prompt, physical AVRecorder, playable AAC, sound, ArkWeb or physical device tested.','Synthetic port handoff uses MessageEvent source=null; actual ArkWeb handoff shape remains NOT_RUN.','Explicit synthetic access provider is fixture-only; no product auth bypass is installed.']};
const toneFixture=process.env.LANTERN_NATIVE_MEDIA_TONE;
let browser,context,page,pair,offer;const lab=nativeMediaRuntime(toneFixture?{bytes:new Uint8Array(fs.readFileSync(toneFixture))}:{});
if(toneFixture){report.fixture={bytes:lab.payload.length,sha256:lab.digest,kind:'Reused QA-generated synthetic AAC/M4A tone; no physical capture'};report.limits[0]='No microphone, OS permission prompt, physical AVRecorder, audible output, ArkWeb or physical device tested. Controlled QA tone bytes only; capture/duration remain mocked.';}
function check(name,detail=true){report.checks.push({name,detail});process.stdout.write('PASS '+name+'\n');}
const script=buildSync({stdin:{sourcefile:'native-speaking-browser-fixture.jsx',loader:'jsx',resolveDir:ROOT,contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import SpeakingRoom from './app/learn/speaking';import {LearningAccessContext} from './lib/learning-access';
import {useStudy,getAudio} from './lib/use-study';import prompts from './content/speaking.json';
const owner='usr_aaaaaaaa-1111-4111-8111-111111111111',access={owner,epoch:1,canAccess:()=>true,assertAccess:()=>true};
window.fixture={saveCalls:0,failNextSave:false,gate:null,data:null,webTracksStopped:0};
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{const track={readyState:'live',stop(){this.readyState='ended';window.fixture.webTracksStopped++;}};return {getTracks:()=>[track]};}});
function Fixture(){const api=useStudy(owner,false),[open,setOpen]=useState(true);window.fixture.data=api.data;window.fixture.ready=api.ready;
window.fixture.blob=async id=>{const blob=await getAudio('lantern-v1-'+owner+':'+id);if(!blob)return null;return {mime:blob.type,bytes:blob.size,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('')};};
return <main>{api.ready&&open&&<SpeakingRoom nativeMode prompt={prompts[0]} timezone="Asia/Shanghai" feedbackScope={{ownerKey:owner,ownerGeneration:1,offlineJobSupported:false}} onClose={()=>setOpen(false)} onFinish={()=>{}} onSave={async(meta,blob)=>{window.fixture.saveCalls++;if(window.fixture.failNextSave){window.fixture.failNextSave=false;throw Error('Synthetic local save failure');}await new Promise(resolve=>window.fixture.gate=resolve);await api.addRecording(meta,blob);}}/>}</main>;}
createRoot(document.getElementById('root')).render(<LearningAccessContext.Provider value={access}><Fixture/></LearningAccessContext.Provider>);
`},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',alias:{'@':ROOT},loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].contents;
const originalCreate=lab.controller.createWebMessagePorts;
lab.controller.createWebMessagePorts=()=>{
 pair=originalCreate();pair[0].postMessageEvent=data=>{
  if(pair[0].closed)throw Error('closed');
  const message=typeof data==='string'?{control:data}:{bytes:Array.from(new Uint8Array(data))};
  void page.evaluate(message=>window.__nativeFixtureDeliver(message),message).catch(error=>report.errors.push(error.message));
 };return pair;
};
lab.controller.postMessage=(name,ports,origin)=>{offer={name,origin};};
(async()=>{fs.mkdirSync(OUT,{recursive:true});const before=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'app/learn/speaking.tsx'))).digest('hex');
 let executablePath=chromium.executablePath();if(!fs.existsSync(executablePath))executablePath='C:/Program Files/Google/Chrome/Application/chrome.exe';
 browser=await chromium.launch({headless:true,executablePath});report.browser=browser.version();context=await browser.newContext({viewport:{width:390,height:844}});
 const css=fs.readdirSync(path.join(SHARED,'assets')).filter(n=>n.endsWith('.css'));
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==ORIGIN||u.pathname.startsWith('/api/')){report.privateRequests.push(u.pathname);return route.abort();}
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN" data-ui-theme="paper"><head><meta name="viewport" content="width=device-width,initial-scale=1">'+css.map(n=>'<link rel="stylesheet" href="/assets/'+n+'">').join('')+'</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'});
  if(u.pathname==='/fixture.js')return route.fulfill({contentType:'application/javascript',body:Buffer.from(script)});
  const file=path.resolve(SHARED,'.'+u.pathname);if(!file.startsWith(SHARED+path.sep)||!fs.existsSync(file))return route.abort();
  return route.fulfill({body:fs.readFileSync(file),contentType:u.pathname.endsWith('.css')?'text/css':undefined});
 });
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));report.requests=[];page.on('request',r=>report.requests.push(new URL(r.url()).pathname));page.on('requestfailed',r=>report.requests.push({failed:new URL(r.url()).pathname,error:r.failure()?.errorText}));
 await page.exposeFunction('__nativeFixtureOpen',raw=>{offer=undefined;const status=lab.window.LanternSpeakingHost.open(raw);return {status,offer};});
 await page.exposeFunction('__nativeFixtureRequest',raw=>pair[0].receiver(raw));
 await page.exposeFunction('__nativeFixtureDetach',raw=>lab.window.LanternSpeakingHost.detach(raw));
 await page.addInitScript(()=>{window.LanternSpeakingHost={open(raw){void window.__nativeFixtureOpen(raw).then(result=>{if(result.status!=='OFFERED')return;const ports=new MessageChannel();ports.port1.onmessage=e=>{void window.__nativeFixtureRequest(e.data);};ports.port1.start();window.__nativeFixtureDeliver=message=>ports.port1.postMessage(message.control??new Uint8Array(message.bytes).buffer);window.dispatchEvent(new MessageEvent('message',{data:result.offer.name,origin:result.offer.origin,source:null,ports:[ports.port2]}));});return 'OFFERED';},detach:raw=>{void window.__nativeFixtureDetach(raw);}};});
 await page.goto(ORIGIN,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.fixture?.ready);const select=page.getByLabel('下一次录音方案');assert.equal(await select.inputValue(),'legacy');check('Legacy remains default in the actual DOM');await select.selectOption('aac');
 await page.getByRole('button',{name:'开始准备',exact:true}).click();await page.getByRole('button',{name:'准备好了，现在录音',exact:true}).click();await page.getByText('正在录音',{exact:true}).last().waitFor();
 assert(await page.evaluate(()=>window.fixture.webTracksStopped>0));lab.clock.advance(1000);await page.getByRole('button',{name:'结束录音',exact:true}).click();await page.waitForFunction(()=>window.fixture.saveCalls===1&&typeof window.fixture.gate==='function');
 assert.equal(lab.files.size,1);assert.equal(lab.recorders[0].stopCalls,1);assert.equal(await page.evaluate(()=>window.fixture.data.recordings.length),0);check('Pending actual local save retains native file and does not claim persistence');
 if(toneFixture)await page.waitForFunction(()=>document.querySelector('audio[aria-label="回听本次录音"]')?.readyState>=1);
 await page.screenshot({path:path.join(OUT,'native-saving-390.png'),fullPage:true});
 await page.evaluate(()=>window.fixture.gate());await page.getByText('录音已保存在本机',{exact:true}).waitFor();await page.waitForFunction(()=>window.fixture.data.recordings.length===1);for(let i=0;i<100&&lab.files.size;i++)await new Promise(r=>setTimeout(r,20));assert.equal(lab.files.size,0);
 const rows=await page.evaluate(()=>window.fixture.data.recordings),stored=await page.evaluate(id=>window.fixture.blob(id),rows[0].id);assert.equal(rows[0].captureImplementation,'harmony-avrecorder-aac');assert.equal(stored.mime,'audio/mp4');assert.equal(stored.bytes,lab.payload.length);assert.equal(stored.sha256,lab.digest);check('Actual IndexedDB bytes/hash and format metadata match; native cleanup follows successful save',stored);
 await page.getByText('此录音暂不支持口语识别。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'记录收获',exact:true}).isDisabled(),false);check('AAC recognition limitation is visible without a claim about playback');
 const order=await select.evaluate(el=>{const audio=document.querySelector('audio[aria-label="回听本次录音"]'),retry=[...document.querySelectorAll('button')].find(el=>el.textContent.includes('再说一次'));return {afterAudio:!!(el.compareDocumentPosition(audio)&Node.DOCUMENT_POSITION_PRECEDING),beforeRetry:!!(el.compareDocumentPosition(retry)&Node.DOCUMENT_POSITION_FOLLOWING),options:[...el.options].map(x=>x.textContent)};});assert.equal(order.afterAudio,true);assert.equal(order.beforeRetry,true);assert.deepEqual(order.options,['原方案（WAV）','原生（M4A）']);await select.selectOption('legacy');assert.equal(await page.evaluate(()=>window.fixture.data.recordings[0].captureImplementation),'harmony-avrecorder-aac');check('Next capture choice follows current playback and cannot relabel saved native metadata',order);
 await page.screenshot({path:path.join(OUT,'native-saved-390.png'),fullPage:true});
 await page.getByText('此录音暂不支持口语识别。',{exact:true}).evaluate(el=>{const host=el.closest('.speaking-room-scroll');host.scrollTop+=el.getBoundingClientRect().top-host.getBoundingClientRect().top;});await page.screenshot({path:path.join(OUT,'native-saved-asr-390.png'),fullPage:true});
 await page.locator('.speaking-room-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});await page.screenshot({path:path.join(OUT,'native-saved-actions-390.png'),fullPage:true});
 report.geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.equal(report.geometry.scrollWidth,report.geometry.width);check('390px actual saved page has no horizontal document overflow');
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'app/learn/speaking.tsx'))).digest('hex'),before);assert.deepEqual(report.privateRequests,[]);assert.deepEqual(report.errors,[]);report.status='PASS';
})().catch(async error=>{report.status='FAIL';report.error=error.stack;process.exitCode=1;if(page){await page.screenshot({path:path.join(OUT,'failure.png'),fullPage:true,timeout:5000}).catch(()=>{});report.dom=await page.evaluate(()=>({readyState:document.readyState,text:document.body.innerText.slice(0,2000),fixture:!!window.fixture})).catch(()=>null);}}).finally(async()=>{await context?.close();await browser?.close();lab.dispose();report.resourcesClosed=true;fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify({status:report.status,checks:report.checks.length,report:path.join(OUT,'report.json'),error:report.error})+'\n');});
