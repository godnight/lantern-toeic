'use strict';
// Fresh local QA contexts only; never attaches to a user browser or phone.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..');
const OUT=path.resolve(process.env.LANTERN_DICTIONARY_QA_DIR||path.join(ROOT,'reports/dictionary-browser-'+Date.now()));
const report={scope:'Local production shared frontend, fresh Chrome profiles; not Harmony device acceptance or Service Worker offline caching',steps:[],errors:[]};
let server,browser,outputReady=false;
async function step(name,fn){await fn();report.steps.push({name,status:'passed'});}
(async()=>{
 await fs.mkdir(path.dirname(OUT),{recursive:true});
 await fs.mkdir(OUT,{recursive:false});outputReady=true;
 const dist=path.join(ROOT,'mobile/dist');
 const metadata=JSON.parse(await fs.readFile(path.join(ROOT,'content/dictionary-metadata.json'),'utf8'));
 await step('built dictionary bytes and SHA match the current source metadata',async()=>{
  const bytes=await fs.readFile(path.join(dist,'dictionaries',metadata.file));
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const payload=JSON.parse(bytes);
  assert.equal(sha256,metadata.sha256);assert.equal(bytes.length,metadata.dictionaryBytes);
  assert.equal(payload.source,metadata.source);assert.equal(payload.entries.length,metadata.count);
  report.dictionary={file:metadata.file,sha256,bytes:bytes.length,count:payload.entries.length,source:payload.source};
 });
 server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const file=path.resolve(dist,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(dist+path.sep))throw Error('path');const bytes=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.mp3':'audio/mpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);}catch{res.statusCode=404;res.end('Not found');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 let executablePath=process.env.LANTERN_BROWSER_EXECUTABLE;
 if(!executablePath&&process.platform==='win32')executablePath='C:/Program Files/Google/Chrome/Application/chrome.exe';
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 async function context(){const c=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',timezoneId:'Asia/Shanghai',acceptDownloads:true,serviceWorkers:'block'});await c.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());return c;}
 async function enter(page){page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(String(e)));await page.goto(origin);await page.getByRole('navigation',{name:'手机主导航',exact:true}).getByRole('button',{name:'单词',exact:true}).click();await page.getByText('浏览全部词条、旧词卡与收藏备份',{exact:true}).click();await page.getByLabel('搜索单词或中文释义').waitFor();}
 const c=await context(),page=await c.newPage();const dictionaryRequests=[];
 page.on('request',request=>{const pathname=new URL(request.url()).pathname;if(pathname.startsWith('/dictionaries/'))dictionaryRequests.push(pathname);});
 await enter(page);
 const input=page.getByLabel('搜索单词或中文释义');
 await step('807 scene words and original question expressions are available',async()=>{await input.fill('administration');await page.getByRole('heading',{name:'administration',exact:true}).waitFor();assert.match(await page.locator('.vocab-catalog-count').innerText(),/807/);});
 await step('dictionary exact match and source detail render',async()=>{await page.getByRole('button',{name:'英汉查词',exact:true}).click();await page.locator('[data-dictionary-ready="true"]').waitFor();assert.deepEqual(dictionaryRequests,['/dictionaries/'+metadata.file]);await input.fill('ＡＢＡＮＤＯＮ');await page.getByRole('heading',{name:'abandon',exact:true}).waitFor();assert.equal(await page.locator('.word-grid h2').first().innerText(),'abandon');await page.locator('.word-open').filter({has:page.getByRole('heading',{name:'abandon',exact:true})}).click();await page.getByRole('heading',{name:'词典释义',exact:true}).waitFor();await page.getByText('词源参考',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'CC-BY-SA-4.0',exact:true}).count(),1);await page.keyboard.press('Escape');});
 await step('common apple meaning and IPA survive dictionary lookup and detail rendering',async()=>{await input.fill('apple');await page.getByRole('heading',{name:'apple',exact:true}).waitFor();assert.equal(await page.locator('.word-grid h2').first().innerText(),'apple');const row=page.locator('.word-open').filter({has:page.getByRole('heading',{name:'apple',exact:true})});assert.match(await row.innerText(),/苹果（水果）/);await row.click();assert.match(await page.locator('.vocab-detail .word-phonetic').innerText(),/ˈæp\(ə\)l/);await page.keyboard.press('Escape');await input.fill('abandon');await page.getByRole('heading',{name:'abandon',exact:true}).waitFor();});
 await step('lookup word stays searchable by later Chinese sense after starring',async()=>{await page.getByRole('button',{name:'加入生词本：abandon',exact:true}).click();await input.fill('沉湎');await page.getByRole('button',{name:'我的生词',exact:true}).click();await page.getByRole('heading',{name:'abandon',exact:true}).waitFor();});
 await step('word form remains searchable in starred list',async()=>{await input.fill('abandoned');await page.getByRole('heading',{name:'abandon',exact:true}).waitFor();});
 await step('dictionary flashcard records only after reveal and explicit grade',async()=>{await input.fill('');await page.getByRole('button',{name:'词卡自测 · 1 词',exact:true}).click();assert.equal(await page.locator('.word-definition').count(),0);await page.getByRole('button',{name:'查看释义与例句',exact:true}).click();await page.getByRole('button',{name:/^记住了/}).click();await page.getByRole('heading',{name:'这一组，复习完成',exact:true}).waitFor();await page.getByRole('button',{name:'回到词库',exact:true}).click();});
 const backup=path.join(OUT,'synthetic-vocabulary-backup.json');
 await step('actual download contains one mark and one review',async()=>{await page.getByText('词库来源与记录备份',{exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出词库记录',exact:true}).click();await(await download).saveAs(backup);const data=JSON.parse(await fs.readFile(backup,'utf8'));assert.equal(data.kind,'lantern-vocabulary');assert.equal(data.events.length,2);assert.deepEqual(data.events.map(e=>e.type).sort(),['mark','review']);assert.ok(data.events.every(e=>e.wordId==='dict-df864c0596aa1a432205'));});
 await step('reload preserves lookup word learning records',async()=>{await page.reload();await enter(page);await page.getByRole('button',{name:'我的生词',exact:true}).click();await page.getByRole('heading',{name:'abandon',exact:true}).waitFor();assert.match(await page.locator('.vocab-study-actions').innerText(),/生词 1/);});
 for(const width of [320,390,840])await step('responsive layout '+width,async()=>{await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));await page.screenshot({path:path.join(OUT,'vocabulary-'+width+'.png'),fullPage:true});});
 await c.close();
 const restoredContext=await context(),restored=await restoredContext.newPage();await enter(restored);
 await step('restore into a fresh context is idempotent and keeps lookup card',async()=>{await restored.getByText('词库来源与记录备份',{exact:true}).click();const notice=restored.getByText('词库记录已合并，原记录已保留。',{exact:true});for(let i=0;i<2;i++){await notice.waitFor({state:'hidden'});const chooser=restored.waitForEvent('filechooser');await restored.getByRole('button',{name:'导入词库记录',exact:true}).click();await(await chooser).setFiles(backup);await notice.waitFor({state:'visible'});const events=await restored.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('lantern-vocab-v1:device:')).flatMap(([,v])=>JSON.parse(v).events));assert.equal(events.length,2,'Restore '+(i+1)+' must complete without duplicating events');}await restored.getByRole('button',{name:'我的生词',exact:true}).click();await restored.getByRole('heading',{name:'abandon',exact:true}).waitFor();});
 await restoredContext.close();
 const failedContext=await context();let fail=true;await failedContext.route('**/dictionaries/zh-en-*.json',async route=>{if(fail){fail=false;await route.fulfill({status:200,contentType:'application/json',body:'{"corrupt":true}'});}else await route.continue();});
 const failed=await failedContext.newPage();await enter(failed);
 await step('bad checksum leaves original words usable and retry recovers',async()=>{await failed.getByLabel('搜索单词或中文释义').fill('reservation');await failed.getByRole('button',{name:'英汉查词',exact:true}).click();await failed.getByRole('alert').filter({hasText:'词典文件校验失败'}).waitFor();await failed.getByLabel('搜索单词或中文释义').fill('reservation');await failed.getByRole('heading',{name:'reservation',exact:true}).waitFor();await failed.getByRole('button',{name:'重试加载词典',exact:true}).click();await failed.getByRole('button',{name:'英汉查词',exact:true}).click();await failed.locator('[data-dictionary-ready="true"]').waitFor();});
 await failedContext.close();
 assert.deepEqual(report.errors,[]);report.status='passed';
})().catch(error=>{report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));report.finishedAt=new Date().toISOString();if(outputReady)await fs.writeFile(path.join(OUT,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.steps.length,output:OUT,error:report.error}));});
