'use strict';
// Real mobile source and styles, isolated synthetic account and local storage.
// Chromium lifecycle simulation is not a substitute for ArkWeb/device validation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const owner={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_scroll'};

async function main(){
 const {createServer}=await import('vite');
 const server=await createServer({configFile:path.join(root,'mobile/vite.config.ts'),server:{host:'127.0.0.1',port:0},logLevel:'error'});
 let browser;
 try{
  await server.listen();
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
  browser=await chromium.launch({headless:true,executablePath:chrome,args:['--mute-audio']});
  for(const spec of [{width:390,height:844,font:16},{width:320,height:480,font:16},{width:390,height:844,font:32}]){
   const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},timezoneId:'Asia/Shanghai'});
   await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!=='https://lantern.local')return route.abort();const response=await route.fetch({url:origin+url.pathname+url.search});return route.fulfill({response});});
   const p=await context.newPage(),errors=[];p.on('pageerror',error=>errors.push(error.message));
   await p.addInitScript(({owner,font})=>{
    document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize=`${font}px`;},{once:true});
    localStorage.setItem('lantern-v1-'+owner.id,JSON.stringify({data:{schemaVersion:2,profile:{name:owner.username,lrGoal:650,speakingGoal:130,examDate:'2026-12-20',dailyMinutes:25,timezone:'Asia/Shanghai',theme:'paper',weeklyTarget:4,onboarded:true},attempts:[],checkins:[],recordings:[],questionMarks:[],resourceTasks:[]}}));
    window.LanternAuthHost={request(raw){const x=JSON.parse(raw),reply=(status,body)=>queueMicrotask(()=>window.__lanternAuthReceive?.({id:x.id,status,body,...x.version?{version:x.version}:{}}));
     if(x.action==='providers')return reply(200,{huaweiLogin:false,huaweiBinding:false});
     if(x.action==='session')return reply(200,{user:owner,capabilities:{passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false},session:{validForMs:3600000}});
     return reply(503,{code:'native-auth-unavailable'});
    }};
   },{owner,font:spec.font});
   await p.goto('https://lantern.local');p.setDefaultTimeout(30000);
   try{await p.getByRole('heading',{name:'今日',exact:true}).waitFor();}catch(error){console.error('startup diagnostics',await p.locator('body').innerText(),errors);throw error;}
   await p.getByRole('button',{name:'制定单词计划',exact:true}).click();
   await p.getByRole('checkbox',{name:'周六',exact:true}).check();await p.getByRole('checkbox',{name:'周日',exact:true}).check();
   await p.getByRole('button',{name:'保存计划',exact:true}).click();
   await p.getByRole('button',{name:'开始背词',exact:true}).click();
   const card=p.locator('.phase2-word-card');await card.waitFor();
   async function headingVisible(stage){
    await p.waitForTimeout(400);
    const metrics=await p.evaluate(()=>{
     const heading=document.querySelector('.phase2-word-session-heading'),bar=document.querySelector('.workspace-topbar');
     if(!heading||!bar)return null;
     const h=heading.getBoundingClientRect(),b=bar.getBoundingClientRect();
     const parts=[...heading.children].map(el=>{const r=el.getBoundingClientRect(),x=Math.min(innerWidth-1,Math.max(0,r.left+r.width/2)),y=Math.min(innerHeight-1,Math.max(0,r.top+r.height/2)),hit=document.elementFromPoint(x,y);return {text:el.textContent,top:r.top,bottom:r.bottom,hit:!!hit&&(el===hit||el.contains(hit))};});
     return {headingTop:h.top,headingBottom:h.bottom,barBottom:b.bottom,viewport:innerHeight,parts};
    });
    assert.ok(metrics,`${stage}: heading and bar present`);
    assert.ok(metrics.headingTop>=metrics.barBottom-1,`${stage}: header covers heading ${JSON.stringify(metrics)}`);
    assert.ok(metrics.headingBottom<=metrics.viewport+1,`${stage}: heading below viewport ${JSON.stringify(metrics)}`);
    assert.equal(metrics.parts.length,2);assert.ok(metrics.parts.every(part=>part.hit),`${stage}: hit test ${JSON.stringify(metrics)}`);
   }
   await headingVisible('start');
   const first=await card.locator('.phase2-current-word').innerText();
   const sizeBefore=await card.evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
   await card.getByRole('button',{name:'忘记',exact:true}).click();await card.getByText('已保存：忘记',{exact:true}).waitFor();
   const sizeAfter=await card.evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
   assert.deepEqual(sizeAfter,sizeBefore,'Rating should not change card dimensions');
   await card.getByRole('button',{name:'下一词',exact:true}).click();
   await p.waitForFunction(word=>document.querySelector('.phase2-current-word')?.textContent!==word,first);
   await headingVisible('next');
   await card.getByRole('button',{name:'上一词',exact:true}).click();
   await p.getByRole('button',{name:'返回当前词',exact:true}).waitFor();
   await headingVisible('previous');
   await p.evaluate(()=>{window.__LANTERN_HARMONY__.onAppState(false);window.__LANTERN_HARMONY__.onAppState(true);});
   await p.getByRole('button',{name:'返回当前词',exact:true}).waitFor();
   assert.equal(await p.locator('.phase2-current-word').innerText(),first);
   await headingVisible('foreground');
   await p.getByRole('button',{name:'返回当前词',exact:true}).click();
   await p.waitForFunction(word=>document.querySelector('.phase2-current-word')?.textContent!==word,first);
   await headingVisible('return to current');
   assert.deepEqual(errors,[]);await context.close();console.log(`PASS word scroll ${spec.width}x${spec.height} font ${spec.font}`);
  }
 }finally{await browser?.close();await server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
