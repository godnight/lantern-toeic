'use strict';
// Independent Playwright micro-check of the waiting helper, not the CI-only
// word-card workflow. Uses only a synthetic scroll box and no product data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {waitForWordHeaderEdge}=require('./word-header-edge.cjs');

async function verifyWordHeaderEdge(page){
    await page.setContent('<div class="phase2-word-header" tabindex="0" style="height:80px;width:200px;overflow:auto"><div style="height:400px">Synthetic scrolling</div></div>');
    const header=page.locator('.phase2-word-header');
    await header.evaluate(el=>{el.scrollTop=100;});
    let settled=false;
    const start=waitForWordHeaderEdge(page,header,'start','synthetic').then(()=>{settled=true;});
    await page.waitForTimeout(80);
    assert.equal(settled,false,'Start wait must not accept an off-edge value');
    await header.evaluate(el=>{el.scrollTop=2;});
    await page.waitForTimeout(80);
    assert.equal(settled,false,'Start wait must not accept the 2px intermediate frame');
    await header.evaluate(el=>{
      el.scrollTop=0;window.__edgeFrames=0;
      const tick=()=>{window.__edgeFrames++;requestAnimationFrame(tick);};requestAnimationFrame(tick);
    });
    await start;
    assert.equal(await header.evaluate(el=>el.scrollTop),0);
    assert.ok(await page.evaluate(()=>window.__edgeFrames)>=2,'Start wait must observe two animation frames');
    settled=false;
    const end=waitForWordHeaderEdge(page,header,'end','synthetic').then(()=>{settled=true;});
    await page.waitForTimeout(80);
    assert.equal(settled,false,'End wait must not accept the start position');
    await header.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await end;
    assert.ok(await header.evaluate(el=>Math.abs(el.scrollTop-(el.scrollHeight-el.clientHeight))<=1));
    console.log('PASS synchronous edge waits reject off-edge positions and require stable frames');
}
async function main(){
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,...(chrome?{executablePath:chrome}:{})});
  try{await verifyWordHeaderEdge(await browser.newPage());}finally{await browser.close();}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={verifyWordHeaderEdge};
