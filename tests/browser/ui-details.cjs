'use strict';
// Real mobile entry and components with synthetic accounts and isolated local
// storage. This does not build a release or exercise a phone/ArkWeb.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const owner={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_ui_details'};
const palettes={
 paper:{ui:'day',canvas:'rgb(245, 245, 245)',surface:'rgb(255, 255, 255)',muted:'rgb(238, 238, 237)',text:'rgb(37, 38, 38)',secondary:'rgb(100, 105, 102)',primary:'rgb(48, 51, 49)',onPrimary:'rgb(255, 255, 255)',selection:'rgb(231, 235, 232)',border:'rgb(133, 138, 135)'},
 crystal:{ui:'night',canvas:'rgb(24, 26, 25)',surface:'rgb(34, 37, 36)',muted:'rgb(44, 48, 46)',text:'rgb(237, 240, 238)',secondary:'rgb(175, 181, 177)',primary:'rgb(220, 229, 223)',onPrimary:'rgb(34, 37, 36)',selection:'rgb(52, 59, 55)',border:'rgb(131, 138, 133)'},
 hollow:{ui:'hollow',canvas:'rgb(16, 24, 32)'},silk:{ui:'silk',canvas:'rgb(32, 24, 34)'},'whale-bay':{ui:'whale-bay',canvas:'rgb(244, 241, 233)'},'whale-moon':{ui:'whale-moon',canvas:'rgb(15, 27, 48)'}
};
const screenshotDir=path.join(root,'reports','ui-details-local');
const referenceCss=process.env.LANTERN_DETAILS_REFERENCE?fs.readFileSync(process.env.LANTERN_DETAILS_REFERENCE,'utf8'):null;
const style=locator=>locator.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {background:s.backgroundColor,color:s.color,border:s.borderTopColor,radius:s.borderRadius,shadow:s.boxShadow,opacity:s.opacity,outline:s.outlineStyle,outlineWidth:parseFloat(s.outlineWidth),rect:{x:r.x,y:r.y,width:r.width,height:r.height},disabled:el.matches(':disabled')};});
async function settleElement(page,locator){const el=await locator.elementHandle();try{await page.waitForFunction(node=>!node.getAnimations().some(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime)),el);}finally{await el.dispose();}}
function expected(actual,fields,description){for(const [key,value] of Object.entries(fields))assert.equal(actual[key],value,`${description}: ${key}; ${JSON.stringify(actual)}`);}
const rgb=s=>(s.match(/\d+/g)||[]).slice(0,3).map(Number);
function contrast(a,b){const lum=c=>{const v=c.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function disabledContrast(foreground,background,surface,opacity){const blend=(a,b)=>a.map((v,i)=>v*opacity+b[i]*(1-opacity));return contrast(blend(rgb(foreground),rgb(surface)),blend(rgb(background),rgb(surface)));}
async function main(){
 const {createServer}=await import('vite');
 const server=await createServer({configFile:path.join(root,'mobile/vite.config.ts'),server:{host:'127.0.0.1',port:0},logLevel:'error'});
 let browser;
 try{
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
  browser=await chromium.launch({headless:true,...(chrome?{executablePath:chrome}:{}),args:['--mute-audio']});
  fs.mkdirSync(screenshotDir,{recursive:true});
  const checks=[];
  for(const theme of Object.keys(palettes))for(const width of (theme==='paper'||theme==='crystal'?[390,840]:[390])){
   const context=await browser.newContext({viewport:{width,height:844},timezoneId:'Asia/Shanghai'});
   await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!=='https://lantern.local')return route.abort();return route.fulfill({response:await route.fetch({url:origin+u.pathname+u.search})});});
   const p=await context.newPage();p.setDefaultTimeout(30000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
   await p.addInitScript(({owner,theme})=>{
    localStorage.setItem('lantern-v1-'+owner.id,JSON.stringify({data:{schemaVersion:2,profile:{name:owner.username,lrGoal:650,speakingGoal:130,examDate:'2026-12-20',dailyMinutes:25,timezone:'Asia/Shanghai',theme,weeklyTarget:4,onboarded:true},attempts:[],checkins:[],recordings:[],questionMarks:[],resourceTasks:[]}}));
    window.LanternAuthHost={request(raw){const x=JSON.parse(raw),reply=(status,body)=>queueMicrotask(()=>window.__lanternAuthReceive?.({id:x.id,status,body,...x.version?{version:x.version}:{}}));
     if(x.action==='providers')return reply(200,{huaweiLogin:false,huaweiBinding:false});
     if(x.action==='session')return reply(200,{user:owner,capabilities:{passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false},session:{validForMs:3600000}});
     return reply(503,{code:'native-auth-unavailable'});}};
   },{owner,theme});
   await p.goto('https://lantern.local');await p.getByRole('heading',{name:'今日',exact:true}).waitFor();
   await p.waitForFunction(ui=>document.body.dataset.uiTheme===ui,palettes[theme].ui);
   const canvas=await p.locator('.v040-workspace-shell').evaluate(el=>getComputedStyle(el,'::before').backgroundColor);
   assert.equal(canvas,palettes[theme].canvas,`${theme}/${width}: actual workspace canvas`);
   async function openDrawer(){const b=p.getByRole('button',{name:'展开导航',exact:true});if(await b.count())await b.click();await p.getByRole('navigation',{name:'主导航',exact:true}).waitFor();}
   const todayTitle=await style(p.getByRole('heading',{name:'今日',exact:true})),topbar=await style(p.locator('.workspace-topbar'));
   await openDrawer();const sidebar=await style(p.locator('.workspace-sidebar'));
   if(theme==='paper'||theme==='crystal'){
    expected(todayTitle,{color:palettes[theme].text},`${theme} today title`);
    expected(topbar,{background:palettes[theme].canvas},`${theme} topbar`);
    expected(sidebar,{background:palettes[theme].surface},`${theme} drawer`);
   }
   await p.locator('.workspace-sidebar-bottom').getByRole('button',{name:'设置',exact:true}).click();
   await p.getByRole('button',{name:'数据管理',exact:true}).click();await p.locator('.v041-data-management').waitFor();
   const data=p.locator('.v041-data-management'),panel=data.locator(':scope > .panel').first(),save=data.locator(':scope > .panel').nth(1).getByRole('button',{name:'导出学习记录',exact:true}),disabled=data.getByRole('button',{name:'导出计划文本',exact:true});
   await p.waitForFunction(()=>{const b=[...document.querySelectorAll('.v041-data-management button')].find(x=>x.textContent.includes('导出学习记录'));return !!b&&!b.disabled;});
   const dataStyles={panel:await style(panel),primary:await style(save),disabled:await style(disabled)};
   async function compareReference(section,label){
    if(!referenceCss)return null;
    await p.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime)));
    const snapshot=()=>section.evaluate(root=>[root,...root.querySelectorAll('*')].filter(el=>el.getClientRects().length).map(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {tag:el.tagName,rect:[r.x,r.y,r.width,r.height],style:[s.backgroundColor,s.color,s.borderTopColor,s.borderRadius,s.boxShadow,s.opacity]};
    }));
    const before=await snapshot(),sheet=await p.addStyleTag({content:referenceCss});
    await p.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime)));
    const after=await snapshot();
    assert.equal(after.length,before.length,`${label}: visible element count`);
    let maxGeometryDelta=0;
    for(let i=0;i<before.length;i++){
     assert.equal(after[i].tag,before[i].tag,`${label}: element order at ${i}`);
     for(let j=0;j<4;j++)maxGeometryDelta=Math.max(maxGeometryDelta,Math.abs(after[i].rect[j]-before[i].rect[j]));
     assert.deepEqual(after[i].style,before[i].style,`${label}: effective style at ${i} (${before[i].tag})`);
    }
    assert.ok(maxGeometryDelta<=.05,`${label}: geometry moved ${maxGeometryDelta}px`);
    await sheet.evaluate(el=>el.remove());
    return {elements:before.length,maxGeometryDelta};
   }
   await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(screenshotDir,`${theme}-${width}-data.png`),fullPage:true});
   const dataReference=await compareReference(data,`${theme}/${width} data`);
   let contrastReport=null;
   if(theme==='paper'||theme==='crystal'){
    const t=palettes[theme];expected(dataStyles.panel,{background:t.surface,border:'rgba(0, 0, 0, 0)',radius:'14px',shadow:'none'},`${theme} data panel`);
    expected(dataStyles.primary,{background:t.primary,color:t.onPrimary,radius:'10px',disabled:false},`${theme} data primary`);
    expected(dataStyles.disabled,{background:t.muted,color:t.secondary,border:'rgba(0, 0, 0, 0)',radius:'10px',opacity:'0.78',disabled:true},`${theme} data disabled`);
    contrastReport={normal:contrast(rgb(t.text),rgb(t.surface)),secondary:contrast(rgb(t.secondary),rgb(t.surface)),disabledComposited:disabledContrast(t.secondary,t.muted,t.surface,.78)};
    assert.ok(contrastReport.normal>=4.5&&contrastReport.secondary>=4.5,`${theme} ordinary text contrast: ${JSON.stringify(contrastReport)}`);
   }
   const drawer=await p.getByRole('button',{name:'展开导航',exact:true}).count();if(drawer)await openDrawer();
   await p.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'练习',exact:true}).click();
   await p.locator('.listening-entry').click();await p.locator('.listening-selection').waitFor();
   const selection=p.locator('.listening-selection'),selected=selection.locator('.listening-collections button').first(),other=selection.locator('.listening-collections button').nth(1),whole=selection.locator('.listening-whole button[data-task-primary]'),part=selection.locator('.practice-task-row').first().locator('button[data-task-primary]');
   await whole.waitFor();
   const listening={panel:await style(selection),selected:await style(selected),range:await style(other),whole:await style(whole),part:await style(part)};
   const listeningReference=await compareReference(p.locator('.listening-page'),`${theme}/${width} listening`);
   if(theme==='paper'||theme==='crystal'){
    const t=palettes[theme];expected(listening.panel,{background:t.surface,border:'rgba(0, 0, 0, 0)',radius:'14px',shadow:'none'},`${theme} listening panel`);
    expected(listening.selected,{background:t.selection,color:t.text,border:t.primary,radius:'10px'},`${theme} selected collection`);
    expected(listening.range,{background:t.surface,color:t.text,border:t.border,radius:'10px'},`${theme} collection`);
    expected(listening.whole,{background:t.muted,color:t.secondary,border:'rgba(0, 0, 0, 0)',radius:'10px',opacity:'0.78',disabled:true},`${theme} actual disabled whole`);
    expected(listening.part,{background:t.muted,color:t.text,border:t.border,radius:'10px'},`${theme} part action`);
    await whole.evaluate(el=>{window.__syntheticDisabledClicks=0;el.addEventListener('click',()=>window.__syntheticDisabledClicks++);});
    await whole.evaluate(el=>el.click());assert.equal(await p.evaluate(()=>window.__syntheticDisabledClicks),0,'Disabled whole must not dispatch a click');
    // Isolated CSS probe only: the actual whole-group origin is currently invalid,
    // so it is disabled in the product. This does not claim an enabled user path.
    await p.mouse.move(0,0);await whole.evaluate(el=>{el.disabled=false;});await settleElement(p,whole);const enabledWhole=await style(whole);
    expected(enabledWhole,{background:t.primary,color:t.onPrimary,border:t.primary,radius:'10px',disabled:false},`${theme} synthetic enabled whole style`);
    await p.keyboard.press('Tab');await whole.focus();
    const focused=await style(whole);assert.ok(focused.outline!=='none'&&focused.outlineWidth>=2,`${theme} whole focus must remain visible: ${JSON.stringify(focused)}`);
    await whole.evaluate(el=>{el.disabled=true;});await other.click();assert.equal(await other.getAttribute('aria-pressed'),'true','Collection selection should respond to click');
   }else{
    assert.equal(listening.panel.radius,'18px',`${theme} art-theme listening panel must not inherit day/night override`);
   }
   await p.screenshot({path:path.join(screenshotDir,`${theme}-${width}-listening.png`),fullPage:true});
   assert.deepEqual(errors,[],`${theme}/${width}: page errors`);
   checks.push({theme,width,canvas,todayTitle,topbar,sidebar,data:dataStyles,listening,contrast:contrastReport,reference:{data:dataReference,listening:listeningReference}});await context.close();console.log(`PASS ${theme} ${width}${contrastReport?' disabled contrast '+contrastReport.disabledComposited.toFixed(2):''}`);
  }
  fs.writeFileSync(path.join(screenshotDir,'report.json'),JSON.stringify({scope:'Real mobile source, isolated synthetic accounts; disabled state is synthetic DOM state. No phone/ArkWeb.',checks},null,2));
 }finally{await browser?.close();await server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
