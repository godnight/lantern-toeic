'use strict';
// Actual shell and source CSS, synthetic navigation callbacks; no user data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const fixture=path.join(root,'outputs','workspace-drawer-test');
const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{WorkspaceShell}from'../../app/learn/workspace-shell';
import '../../app/globals.css';import '../../app/redesign.css';import '../../app/workspace-redesign.css';import '../../app/v040-interface.css';import '../../app/v041-design-theme.css';import '../../app/v041-app-redesign.css';import '../../app/learn/discovery.css';
function App(){const [nav,setNav]=useState('today');const [focused,setFocused]=useState(false);return <WorkspaceShell nav={nav} theme="paper" reviewCount={0} onNavigate={setNav} onSearch={()=>setNav('search')} focused={focused} discoveryFeedActive={nav==='resources'}><p data-page>{nav}</p><button onClick={()=>setFocused(!focused)}>{focused?'结束专注':'进入专注'}</button></WorkspaceShell>}document.body.dataset.uiTheme='paper';createRoot(document.getElementById('root')).render(<App/>);`;

(async()=>{
 fs.mkdirSync(fixture,{recursive:true});
 fs.writeFileSync(path.join(fixture,'entry.jsx'),entry);
 fs.writeFileSync(path.join(fixture,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./entry.jsx"></script>');
 const {createServer}=await import('vite'),react=(await import('@vitejs/plugin-react')).default,tailwind=(await import('@tailwindcss/postcss')).default;
 const server=await createServer({configFile:false,root,plugins:[react()],resolve:{alias:{'@':root},dedupe:['react','react-dom']},css:{postcss:{plugins:[tailwind()]}},server:{host:'127.0.0.1',port:0},logLevel:'error'});
 let browser;
 try{
  await server.listen();
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
  browser=await chromium.launch({headless:true,executablePath:chrome});
  for(const width of [390,840]){
   const page=await browser.newPage({viewport:{width,height:844}});
   await page.goto(origin+'/outputs/workspace-drawer-test/index.html');
   const toggle=page.locator('.workspace-drawer-toggle');
   await toggle.click();
   const nav=page.getByRole('navigation',{name:'主导航'});
   await nav.locator('button').first().waitFor();
   assert.equal(await nav.getByRole('button').count(),6);
   if(width<700){
    const close=page.locator('.workspace-drawer-head button');
    const last=page.locator('.workspace-sidebar-bottom').getByRole('button',{name:'设置',exact:true});
    // The slide transition must have finished: focusing an element still offscreen can fail.
    await page.waitForFunction(()=>Math.abs(document.querySelector('.workspace-sidebar').getBoundingClientRect().left)<1);
    assert.equal(await close.evaluate(el=>document.activeElement===el),true,'Mouse-open must move focus inside the drawer');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await last.evaluate(el=>document.activeElement===el),true,'Shift+Tab wraps from first to last');
    await page.keyboard.press('Tab');
    assert.equal(await close.evaluate(el=>document.activeElement===el),true,'Tab wraps from last to first');
    for(let i=0;i<24;i++){
     await page.keyboard.press('Tab');
     assert.equal(await page.evaluate(()=>document.querySelector('.workspace-sidebar').contains(document.activeElement)),true,'Tab must stay inside the open drawer');
    }
    await toggle.focus();
    await page.keyboard.press('Tab');
    assert.equal(await close.evaluate(el=>document.activeElement===el),true,'Tab from outside returns to the drawer');
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    assert.equal(await toggle.evaluate(el=>document.activeElement===el),true,'Escape returns focus to the opener');
    await toggle.click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('.workspace-sidebar').getBoundingClientRect().left)<1);
    await close.click();
    assert.equal(await toggle.evaluate(el=>document.activeElement===el),true,'Close button returns focus to the opener');
    await toggle.click();
    await page.locator('.workspace-drawer-backdrop').click({position:{x:360,y:300}});
    assert.equal(await toggle.evaluate(el=>document.activeElement===el),true,'Backdrop close returns focus to the opener');
    await toggle.click();
   }else{
    const contentButton=page.getByRole('button',{name:'进入专注',exact:true});
    await contentButton.focus();
    assert.equal(await contentButton.evaluate(el=>document.activeElement===el),true,'Wide drawer must not trap body focus');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.querySelector('.workspace-sidebar').contains(document.activeElement)),false,'Wide drawer must leave page keyboard access available');
   }
   await nav.getByRole('button',{name:'发现',exact:true}).click();
   assert.equal(await page.locator('[data-page]').textContent(),'resources');
   if(width<700){
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    assert.equal(await toggle.evaluate(el=>document.activeElement===el),true,'Choosing a destination returns focus to the opener');
    await toggle.click();
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
    await toggle.click();
   }else assert.equal(await toggle.getAttribute('aria-expanded'),'true');
   await page.getByRole('button',{name:'查词',exact:true}).click();
   assert.equal(await page.locator('[data-page]').textContent(),'search');
   if(width<700)await toggle.click();
   await page.getByRole('button',{name:'设置',exact:true}).click();
   assert.equal(await page.locator('[data-page]').textContent(),'profile');
   assert((await page.evaluate(()=>document.documentElement.scrollWidth))<=width+1);
   await page.close();
   console.log(`PASS drawer ${width}`);
  }
 }finally{await browser?.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
