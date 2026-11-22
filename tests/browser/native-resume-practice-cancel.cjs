'use strict';
// Actual workspace/IDB in Chromium with a synthetic native identity bridge.
// This does not exercise ArkWeb, real credentials, TLS or a physical device.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {build}=require('esbuild'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),origin='https://lantern.local';
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'},B={id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'};
const mime=f=>({'.json':'application/json','.js':'application/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'}[path.extname(f)]||'application/octet-stream');
async function main(){
 const built=await build({stdin:{resolveDir:root,sourcefile:'resume-fixture.jsx',loader:'jsx',contents:"import React from 'react';import{createRoot}from'react-dom/client';import NativeAccountRoot from './mobile/src/NativeAccountRoot';import{installHarmonyHost}from './lib/native-host';installHarmonyHost();createRoot(document.getElementById('root')).render(<NativeAccountRoot/>);"},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',jsx:'automatic',alias:{'@':root},loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'observe-fixture',setup(b){b.onLoad({filter:/NativeAccountRoot\.tsx$/},args=>{const input=fs.readFileSync(args.path,'utf8'),output=input.replace('savedWorkspace.current=resumeForOwner(snapshot,current.user.id);','savedWorkspace.current=resumeForOwner(snapshot,current.user.id);(window as any).__qaSnapshot=savedWorkspace.current;');assert.notEqual(input,output);return {contents:output,loader:'tsx',resolveDir:path.dirname(args.path)};});b.onLoad({filter:/[\\/]practice-workflow\.ts$/},args=>{const input=fs.readFileSync(args.path,'utf8'),output=input.replace('async resume(id:string):Promise<PracticeResult>{try{',"async resume(id:string):Promise<PracticeResult>{if((window as any).__qaHoldResume)await new Promise<void>(r=>{(window as any).__qaReleaseResume=r;});try{");assert.notEqual(input,output);return {contents:output,loader:'ts',resolveDir:path.dirname(args.path)};});}}],logLevel:'silent'});
 const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>#workspace-main{min-height:2000px}</style><script src="/practice-history-guard.js"></script></head><body><div id="root"></div><script>'+built.outputFiles[0].text+'</script></body></html>';
 const systemChrome='C:/Program Files/Google/Chrome/Application/chrome.exe',executablePath=fs.existsSync(systemChrome)?systemChrome:undefined;
 const browser=await chromium.launch({headless:true,executablePath,args:['--mute-audio']});
 try{const ctx=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai'});await ctx.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!==origin)return r.abort();if(u.pathname==='/')return r.fulfill({contentType:'text/html',body:html});const file=path.resolve(root,'public','.'+u.pathname);return file.startsWith(path.join(root,'public')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()?r.fulfill({contentType:mime(file),body:fs.readFileSync(file)}):r.abort();});
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(({A,B})=>{
  let owner=A,remote='ok',held=null;
  const caps={passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false};window.__sessionProofs=0;window.__nativeActions=[];
  const seed=u=>localStorage.setItem('lantern-v1-'+u.id,JSON.stringify({data:{schemaVersion:2,profile:{name:u.username,lrGoal:650,speakingGoal:130,examDate:'2026-12-20',dailyMinutes:25,timezone:'Asia/Shanghai',theme:'paper',weeklyTarget:4,onboarded:true},attempts:[],checkins:[],recordings:[],questionMarks:[],resourceTasks:[]}}));seed(A);seed(B);
  window.__test={background(){window.__LANTERN_HARMONY__.onAppState(false);},foreground(){window.__LANTERN_HARMONY__.onAppState(true);},offline(){remote='offline';},online(){remote='ok';},other(){owner=B;remote='ok';},hold(){remote='hold';},release(){remote='ok';held?.();held=null;}};
  window.LanternAuthHost={request(raw){const x=JSON.parse(raw),reply=(status,body)=>queueMicrotask(()=>window.__lanternAuthReceive?.({id:x.id,status,body,...x.version?{version:x.version}:{}}));window.__nativeActions.push(x.action);
   if(x.action==='providers')return reply(200,{huaweiLogin:false,huaweiBinding:false});
   if(x.action==='session'){const send=()=>{if(remote==='offline')reply(503,{code:'native-auth-unavailable'});else{window.__sessionProofs++;reply(200,{user:owner,capabilities:caps,session:{validForMs:3600000}});}};if(remote==='hold')held=send;else send();return;}
   return reply(503,{code:'native-auth-unavailable'});
  }};
 },{A,B});
 await p.goto(origin);assert.equal(await p.evaluate(()=>window.__lanternPracticeHistory?.version),1,'The native blocking practice history guard must load before the app');p.setDefaultTimeout(20000);await p.getByRole('heading',{name:'今日',exact:true}).waitFor();
 await p.getByRole('button',{name:'展开导航',exact:true}).click();await p.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'练习',exact:true}).click();
 await p.getByRole('button',{name:/听力\s*Part 1–4/}).click();await p.getByRole('button',{name:'听力 · Part 1 · 开始',exact:true}).click();
 const practice=p.locator('.listening-practice-page');await practice.waitFor();await practice.getByRole('radio').first().click();await practice.getByRole('button',{name:'确认答案',exact:true}).click();await practice.locator('.answer-feedback').waitFor();
 await p.waitForFunction(()=>window.__qaSnapshot?.practiceSessionId?.startsWith('practice:'));const initial=await p.evaluate(()=>window.__qaSnapshot);
 await p.evaluate(()=>window.__test.background());await p.waitForTimeout(240);await p.evaluate(()=>window.__test.foreground());await practice.locator('.answer-feedback').waitFor();console.log('PASS submitted answer survives initial background');
 await practice.getByRole('button',{name:'返回',exact:true}).click();await p.getByRole('heading',{name:'暂时退出练习？',exact:true}).waitFor();await p.getByRole('button',{name:'继续练习',exact:true}).click();
 await p.waitForFunction(id=>window.__qaSnapshot?.practiceSessionId===id,initial.practiceSessionId);await p.evaluate(()=>window.__test.background());await p.waitForTimeout(240);await p.evaluate(()=>window.__test.foreground());await practice.locator('.answer-feedback').waitFor();
 assert.equal((await p.evaluate(()=>window.__qaSnapshot)).practiceSessionId,initial.practiceSessionId);console.log('PASS cancel exit and background restore the same answered listening question');
 await practice.getByRole('button',{name:'返回',exact:true}).click();await p.getByRole('heading',{name:'暂时退出练习？',exact:true}).waitFor();
 const captured=await p.evaluate(()=>{window.__LANTERN_HARMONY__.onBackPress();const snap=window.__qaSnapshot;window.__test.background();return snap;});assert.equal(captured?.practiceSessionId,initial.practiceSessionId,'Native Back must recapture synchronously before background');
 await p.waitForTimeout(240);await p.evaluate(()=>window.__test.foreground());await practice.locator('.answer-feedback').waitFor();assert.equal((await p.evaluate(()=>window.__qaSnapshot)).practiceSessionId,initial.practiceSessionId);console.log('PASS native Back cancel immediately before background restores answered question');
 await practice.getByRole('button',{name:'返回',exact:true}).click();await p.getByRole('heading',{name:'暂时退出练习？',exact:true}).waitFor();await p.keyboard.press('Escape');await p.getByRole('heading',{name:'暂时退出练习？',exact:true}).waitFor({state:'hidden'});assert.equal((await p.evaluate(()=>window.__qaSnapshot))?.practiceSessionId,initial.practiceSessionId);console.log('PASS Escape cancel recaptures current practice');
 await practice.getByRole('button',{name:'返回',exact:true}).click();await p.getByRole('button',{name:'保存并返回',exact:true}).click();await practice.waitFor({state:'hidden'});await p.locator('.listening-page').waitFor();
 await p.evaluate(()=>window.__test.background());await p.waitForTimeout(240);await p.evaluate(()=>window.__test.foreground());await p.waitForFunction(()=>document.querySelector('.listening-page')||[...document.querySelectorAll('h1')].some(h=>h.textContent==='今日'));assert.equal(await practice.count(),0);console.log('PASS saved exit does not restore closed question after background');
 assert.deepEqual(errors,[]);await ctx.close();
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
