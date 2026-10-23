/* Independent QA only. Never load production or an existing browser profile. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const PORT = 4175;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const REPO = path.resolve(__dirname, '../..');
let OUT;
const OWNER = 'harmony-local-device';
const DB = 'lantern-private-exams-v1';
const BASE_TIME = new Date('2026-10-11T06:00:00.000Z');
const report = { scope: 'Local production Harmony shared frontend; synthetic QA only', origin: ORIGIN,
  limitations: ['Synthetic 200-question structures are not TOEIC test papers.', '20-second and 45:53 silent WAVs check decoder/playback events and timing compatibility, not audible sound or complete listening content.', 'Desktop Chrome with resized viewports is not ArkWeb/real-device acceptance.', 'Clock fast-forward validates deadline logic, not two-hour endurance.'],
  startedAt: new Date().toISOString(), steps: [], screenshots: [], pageErrors: [], consoleErrors: [], blockedExternal: [], httpErrors: [] };
let browser, context, page, preview, cleanupPromise;
let ownsOutput = false;
const ownerToken = crypto.randomBytes(24).toString('hex');

async function allocateOutput() {
  if (process.env.LANTERN_BROWSER_QA_DIR) {
    OUT = path.resolve(process.env.LANTERN_BROWSER_QA_DIR);
    await fs.mkdir(path.dirname(OUT), {recursive:true});
    // Explicit output must be new: never truncate existing reports or user files.
    await fs.mkdir(OUT);
  } else OUT = await fs.mkdtemp(path.join(os.tmpdir(),'lantern-exam-browser-'));
  ownsOutput = true;
}
async function launchBrowser() {
  const override = process.env.LANTERN_BROWSER_EXECUTABLE;
  let executablePath;
  if (override) { executablePath = path.resolve(override); await fs.access(executablePath); }
  else {
    const bundled = await fs.access(chromium.executablePath()).then(()=>true,()=>false);
    if (!bundled && process.platform === 'win32') {
      for (const directory of [process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA]) {
        if (!directory) continue;
        const candidate = path.join(directory,'Google/Chrome/Application/chrome.exe');
        if (await fs.access(candidate).then(()=>true,()=>false)) {executablePath=candidate;break;}
      }
    }
    if (!bundled && !executablePath) throw new Error('Playwright Chromium is missing. Install it separately with npx playwright install chromium; this test never installs browsers.');
  }
  report.browser = {executable:executablePath || chromium.executablePath(),playwright:require('playwright/package.json').version};
  return chromium.launch({...(executablePath ? {executablePath} : {}),headless:true});
}
async function startPreview() {
  await fs.access(path.join(REPO,'mobile/dist/index.html')).catch(()=>{throw new Error('Build the shared production frontend first: npm --prefix mobile run build');});
  // Friendly early failure, followed by strictPort inside the actual Vite process.
  await new Promise((resolve,reject)=>{
    const probe=net.createServer(); probe.once('error',error=>reject(new Error(`Local QA port ${PORT} is unavailable: ${error.code}`)));
    probe.listen({host:'127.0.0.1',port:PORT,exclusive:true},()=>probe.close(resolve));
  });
  const config = {vite:pathToFileURL(require.resolve('vite')).href,configFile:path.join(REPO,'mobile/vite.config.ts'),port:PORT,token:ownerToken};
  const worker = `const c=JSON.parse(process.argv[1]); (async()=>{const {preview}=await import(c.vite);const server=await preview({configFile:c.configFile,logLevel:'error',preview:{host:'127.0.0.1',port:c.port,strictPort:true,open:false},plugins:[{name:'lantern-owned-qa-preview',configurePreviewServer(s){s.middlewares.use((req,res,next)=>{res.setHeader('X-Lantern-QA-Owner',c.token);next();});}}]});process.send({ready:true,pid:process.pid}); const close=()=>server.httpServer.close(()=>process.exit(0)); process.on('SIGTERM',close); process.on('SIGINT',close);})().catch(error=>{console.error(error.stack||error);process.exit(1);});`;
  preview = spawn(process.execPath,['-e',worker,JSON.stringify(config)],{cwd:REPO,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true,detached:process.platform!=='win32'});
  let logs=''; const capture=data=>{logs=(logs+data.toString()).slice(-12000);}; preview.stdout.on('data',capture);preview.stderr.on('data',capture);
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Owned Vite preview did not become ready: '+logs)),30000);
    preview.once('error',error=>{clearTimeout(timeout);reject(error);});
    preview.once('exit',(code,signal)=>{clearTimeout(timeout);reject(new Error(`Owned Vite preview exited (${code}/${signal}): ${logs}`));});
    preview.once('message',message=>{if(message?.ready && message.pid===preview.pid){clearTimeout(timeout);resolve();}else{clearTimeout(timeout);reject(new Error('Unexpected preview readiness message'));}});
  });
  const response=await fetch(ORIGIN+'/',{signal:AbortSignal.timeout(10000),redirect:'error'});
  assert.equal(response.status,200,'Owned preview did not return HTML');
  assert.equal(response.headers.get('x-lantern-qa-owner'),ownerToken,'Port belongs to another process; refusing to test it');
  assert.equal(preview.exitCode,null); assert.equal(preview.signalCode,null);
  report.preview={pid:preview.pid,origin:ORIGIN,ownershipVerified:true,htmlSha256:crypto.createHash('sha256').update(await response.text()).digest('hex')};
}
async function stopPreview() {
  if(!preview || preview.exitCode!==null || preview.signalCode!==null || !preview.pid)return;
  const exited=new Promise(resolve=>preview.once('exit',resolve));
  if(process.platform==='win32') {
    // Only the still-live child spawned by this test; never kill by port/name.
    await new Promise(resolve=>{
      const kill=spawn('taskkill.exe',['/PID',String(preview.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
      let finished=false;
      const finish=()=>{if(finished)return;finished=true;clearTimeout(timeout);resolve();};
      const timeout=setTimeout(()=>{
        report.cleanupWarnings ||= [];report.cleanupWarnings.push('taskkill helper exceeded 5 seconds; stopped helper and continuing bounded child fallback');
        try{kill.kill('SIGKILL');}catch{}finish();
      },5000);
      timeout.unref();kill.unref();kill.once('error',finish);kill.once('exit',finish);
    });
  } else {try{process.kill(-preview.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}}
  let done=false; void exited.then(()=>{done=true;});
  await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,2000))]);
  if(!done && preview.exitCode===null && preview.signalCode===null) {
    if(process.platform==='win32') {report.cleanupWarnings ||= [];report.cleanupWarnings.push('Falling back to direct preview SIGKILL; descendant termination is not confirmed.');}
    if(process.platform==='win32')preview.kill('SIGKILL');else{try{process.kill(-preview.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
    await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,2000))]);
  }
  report.previewStopped=preview.exitCode!==null || preview.signalCode!==null;
  if(!report.previewStopped)throw new Error('Owned preview process did not stop');
}
async function cleanup() {
  return cleanupPromise ||= (async()=>{
    try{
      if(browser)await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Browser close exceeded 10 seconds')),10000);
        Promise.resolve(browser.close()).then(resolve,reject).finally(()=>clearTimeout(timeout));
      });
    }finally{await stopPreview();}
  })();
}
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{
  const code=signal==='SIGINT'?130:143;
  void cleanup().catch(error=>{report.cleanupError=String(error);}).finally(async()=>{
    report.status='interrupted';report.signal=signal;report.finishedAt=new Date().toISOString();
    if(ownsOutput)await fs.writeFile(path.join(OUT,'interrupted.json'),JSON.stringify(report,null,2),{flag:'wx'}).catch(()=>{});
    process.exit(code);
  });
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function png() {
  const chunk = (type, data) => { const name = Buffer.from(type); const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); name.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([name, data])), out.length - 4); return out; };
  const width = 24, height = 16, ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (1 + width * 3) + 1 + x * 3;
    raw[offset] = 30 + x * 6; raw[offset + 1] = 60 + y * 7; raw[offset + 2] = 160;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function wav(seconds = 20) {
  const samples = seconds * 8000, out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(8000, 24); out.writeUInt32LE(16000, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(samples * 2, 40);
  return out;
}
async function fixtures() {
  const synthetic = require(path.join(REPO, 'tests/fixtures/synthetic-exam.cjs'));
  const packages = ['alpha', 'beta'].map(name => {
    const exam = synthetic('browser-qa-' + name);
    exam.title = '浏览器合成验证 ' + name + ' · 非真实试卷';
    exam.source = {classification: 'original', title: 'Synthetic browser QA only', publisher: 'Local QA',
      reference: 'Not a real examination paper. Temporary private browser context only.',
      rightsStatement: 'Original artificial QA data. Not official TOEIC content. Silent audio does not establish listening completeness.'};
    exam.assets.find(a => a.mime === 'image/png').base64 = png().toString('base64');
    exam.assets.find(a => a.mime === 'audio/wav').base64 = wav().toString('base64');
    return exam;
  });
  const bad = structuredClone(packages[0]); bad.id = 'browser-qa-invalid'; bad.questions.pop();
  const files = [];
  for (const [i, object] of [...packages, bad].entries()) {
    const file = path.join(OUT, `qa-only-${i < 2 ? ['alpha','beta'][i] : 'invalid'}.json`);
    await fs.writeFile(file, JSON.stringify(object)); files.push(file);
  }
  report.fixtures = {questionsPerValidPackage: 200, packages: packages.map(p => p.id), pngSha256: crypto.createHash('sha256').update(png()).digest('hex'), wavSha256: crypto.createHash('sha256').update(wav()).digest('hex'), wavSeconds: 20};
  return {packages, files};
}
async function step(name, action) {
  const begin = Date.now();
  try { const details = await action(); report.steps.push({name, status: 'passed', elapsedMs: Date.now() - begin, ...(details === undefined ? {} : {details})}); console.log(JSON.stringify({step:name, status:'passed'})); }
  catch (error) { report.steps.push({name, status:'failed', elapsedMs:Date.now() - begin, error:String(error.stack || error)}); throw error; }
}
async function eventually(check, message, timeout = 15000) {
  const until = Date.now() + timeout; let last;
  do { try { const result = await check(); if (result) return result; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < until);
  throw new Error(message + (last ? ': ' + last.message : ''));
}
async function visible(locator) { await locator.waitFor({state:'visible', timeout:15000}); return locator; }
async function enabled(locator) { await visible(locator); await eventually(() => locator.isEnabled(), 'Control never enabled: ' + locator); return locator; }
async function click(name) { await (await enabled(page.getByRole('button', {name, exact:true}))).click(); }
async function idle() { await eventually(async () => await page.getByRole('region',{name:'完整听读模考',exact:true}).getAttribute('aria-busy')==='false', 'Local transaction did not finish'); }
async function newPage(at = BASE_TIME) {
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  page.on('console', msg => { if (msg.type() === 'error') report.consoleErrors.push(msg.text().slice(0,1000)); });
  page.on('response', response => { if (response.status() >= 400 && response.url().startsWith(ORIGIN) && !response.url().endsWith('/favicon.ico')) report.httpErrors.push({url:response.url(),status:response.status()}); });
  await page.clock.install({time:at});
  await page.goto(ORIGIN + '/', {waitUntil:'networkidle'});
  assert.equal(new URL(page.url()).origin, ORIGIN);
}
async function freshContext() {
  if(context)await context.close();
  context=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',timezoneId:'Asia/Shanghai',acceptDownloads:true,serviceWorkers:'block'});
  await context.route('**/*', route=>{
    const url=new URL(route.request().url());
    if ((url.protocol==='http:' || url.protocol==='https:') && url.origin!==ORIGIN) {
      report.blockedExternal.push(url.origin+url.pathname);return route.abort('blockedbyclient');
    }
    return route.continue();
  });
}
async function enter(section = '练习') {
  // At 390px the app has a visible mobile nav, while its sidebar duplicate is hidden.
  await page.setViewportSize({width:390,height:844});
  const nav = page.getByRole('navigation', {name:'手机主导航',exact:true});
  const welcome=page.locator('[data-first-run="welcome"]');
  await Promise.race([welcome.waitFor(),nav.waitFor()]);
  if(await welcome.isVisible())await welcome.locator('[data-first-run-action="guest"]').click();
  await (await visible(nav.getByRole('button', {name:section,exact:true}))).click();
  if(section==='资料'){await page.getByText('题包与模考',{exact:true}).click();await click('本机题包与模考');}
  else await (await visible(page.getByRole('button', {name:/完整听读模考/}))).click();
  await visible(page.getByRole('button', {name:'导入题包 JSON',exact:true}));
  await idle();
}
async function importViaUI(button, files) {
  const chooser = page.waitForEvent('filechooser'); await click(button); await (await chooser).setFiles(files); await idle();
}
async function state() {
  return page.evaluate(async dbName => {
    const database = await new Promise((resolve,reject) => { const request = indexedDB.open(dbName); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); request.onupgradeneeded=()=>{ request.transaction.abort(); reject(new Error('Read-only QA: app has not created database')); }; });
    try {
      return await new Promise((resolve,reject) => {
        const transaction = database.transaction(['catalog','attempts'], 'readonly'), result = {};
        for (const name of ['catalog','attempts']) { const request = transaction.objectStore(name).getAll(); request.onsuccess=()=>{result[name]=request.result;}; }
        transaction.oncomplete=()=>resolve(result); transaction.onerror=()=>reject(transaction.error); transaction.onabort=()=>reject(transaction.error);
      });
    } finally { database.close(); }
  }, DB);
}
async function currentAttempt(predicate = () => true) {
  return eventually(async () => (await state()).attempts.find(row => predicate(row.attempt, row)), 'Expected durable attempt not found');
}
async function screenshot(name) {
  const file = path.join(OUT, name + '.png'); await page.screenshot({path:file,fullPage:true,animations:'disabled'}); report.screenshots.push(file);
}
async function layout(stage) {
  const rows=[];
  for (const width of [320,390,768]) {
    await page.setViewportSize({width,height:844});
    const dimensions = await page.evaluate(() => ({innerWidth, clientWidth:document.documentElement.clientWidth, documentWidth:document.documentElement.scrollWidth, bodyWidth:document.body.scrollWidth,
      overflowing:[...document.querySelectorAll('main,section,article,aside,button,audio,table')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0 && (r.left < -1 || r.right > innerWidth+1);}).slice(0,10).map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right}))}));
    assert.ok(dimensions.documentWidth <= dimensions.clientWidth + 1, `${stage} horizontal overflow at ${width}: ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.bodyWidth <= dimensions.clientWidth + 1, `${stage} body overflow at ${width}: ${JSON.stringify(dimensions)}`);
    rows.push({width,...dimensions}); await screenshot(`${stage}-${width}`);
  }
  await page.setViewportSize({width:390,height:844}); return rows;
}
async function preflight(title, allowStart = true, expectedSeconds = 20) {
  const localTab=page.getByRole('navigation',{name:'模考资料范围'}).getByRole('button',{name:/^本机题包/});
  if(await localTab.count())await localTab.click();
  const card = page.locator('.mock-catalog article').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await (await enabled(card.getByRole('button',{name:'音频预检与新考试',exact:true}))).click();
  const start = page.getByRole('button',{name:'开始新考试 · 立即计时',exact:true});
  await visible(start); assert.equal(await start.isDisabled(), true);
  const audio = page.locator('.mock-audio audio');
  await eventually(()=>audio.evaluate((a,seconds)=>a.readyState>=2 && a.duration===seconds && !a.error,expectedSeconds), 'Synthetic PCM audio did not decode');
  // Click Chrome's native audio-control play button; do not call play() or dispatch events.
  const box = await audio.boundingBox(); assert.ok(box && box.width > 50 && box.height > 20);
  await audio.click({position:{x:25,y:box.height/2}});
  await eventually(()=>audio.evaluate(a=>!a.paused && a.currentTime>0), 'Native player click did not start decoded audio');
  await page.getByRole('checkbox').check();
  if(allowStart)await enabled(start);else assert.equal(await start.isDisabled(),true,'Failed media checks must prevent starting even after audio preview');
  return {durationSeconds:await audio.evaluate(a=>a.duration),decoded:true,playing:true,confirmation:'Automated only for synthetic QA; no human hearing/full-paper acceptance claimed'};
}
async function answer(number, choice) {
  const question = page.getByRole('article',{name:`第 ${number} 题`,exact:true});
  await visible(question);
  assert.equal(await page.locator('.mock-explanation').count(),0,'Answers leaked before durable submission');
  // Selection is rendered after its IndexedDB commit, so check()'s immediate
  // controlled-input assertion is too early. Click and verify durable + UI state.
  await question.getByRole('radio').nth(choice).click(); await idle();
  await currentAttempt(a=>a.status!=='submitted' && a.answers[number]?.choice===choice);
  await eventually(()=>question.getByRole('radio').nth(choice).isChecked(),'Saved answer did not render selected');
}
async function resultSummary(correct,unanswered) {
  await visible(page.getByRole('heading',{name:'这一次，已交卷并保存。',exact:true}));
  assert.match(await page.locator('.mock-results').innerText(),new RegExp('正确 '+correct+' / 200'));
  assert.match(await page.locator('.mock-result-metrics>div').filter({hasText:'整卷漏答'}).innerText(),new RegExp('整卷漏答\\s*'+unanswered+'\\s* / 200'));
}
async function downloadBackup(name) {
  const pending = page.waitForEvent('download'); await click('导出完整备份'); const download = await pending;
  assert.equal(download.suggestedFilename(),'lantern-exam-backup.json'); const file=path.join(OUT,name); await download.saveAs(file);
  const backup = JSON.parse(await fs.readFile(file,'utf8')); assert.equal(backup.ownerId,OWNER); assert.equal(backup.kind,'lantern-exam-backup'); return {file,backup};
}

(async()=>{
  await allocateOutput();
  await startPreview();
  const {packages,files}=await fixtures();
  browser=await launchBrowser();
  await freshContext();
  let firstId, originalFirst, backupFile;
  await step('fresh local context and train/resources entry',async()=>{
    await newPage(); await enter('资料'); await click('返回学习'); await enter();
    const db=await state(); assert.equal(db.catalog.length,0); assert.equal(db.attempts.length,0);
    return {owner:OWNER,empty:true};
  });
  await step('two valid JSON files imported through chooser',async()=>{
    await importViaUI('导入题包 JSON',files.slice(0,2));
    const db=await state(); assert.equal(db.catalog.length,2); assert.ok(db.catalog.every(x=>x.ownerId===OWNER));
    assert.equal(await page.locator('.mock-catalog article').count(),2); return {packages:2};
  });
  await step('bad package rejection and idempotent package import',async()=>{
    await importViaUI('导入题包 JSON',files[2]); await visible(page.getByRole('alert'));
    const rejection=await page.getByRole('alert').innerText(); assert.match(rejection,/200|试题|数量|完整/); assert.equal((await state()).catalog.length,2);
    await click('重新读取记录'); await idle(); await importViaUI('导入题包 JSON',files[0]);
    assert.match(await page.locator('.mock-status').innerText(),/未重复导入/); assert.equal((await state()).catalog.length,2);
    return {rejection};
  });
  await step('catalog responsive widths',()=>layout('catalog'));
  await step('real image/audio decoding and native player preflight',()=>preflight(packages[0].title));
  await step('start listening, choose and durably save answers',async()=>{
    await click('开始新考试 · 立即计时'); await visible(page.getByText('听力 LC',{exact:true}));
    let row=await currentAttempt(a=>a.status==='listening'); firstId=row.attempt.id;
    assert.equal(row.attempt.ordinal,1); assert.equal(row.attempt.listeningDeadline-row.attempt.startedAt,45*60*1000);
    assert.equal(row.attempt.readingDeadline-row.attempt.startedAt,120*60*1000);
    await answer(1,1); await click('下一题'); await answer(2,0);
    const submitDuringListening=page.getByRole('button',{name:'提交整卷',exact:true});
    assert.ok(await submitDuringListening.count()===0 || await submitDuringListening.isDisabled(),'Listening phase unexpectedly allows submission');
    const image=page.locator('.mock-scan img'); await eventually(()=>image.evaluate(img=>img.complete && img.naturalWidth===24),'QA PNG not decoded');
    return {firstId,savedAnswers:2};
  });
  await step('listening responsive widths',()=>layout('listening'));
  await step('cold page replacement restores exact answers/deadlines',async()=>{
    const before=(await currentAttempt(a=>a.id===firstId)).attempt, nextTime=await page.evaluate(()=>Date.now()+2000);
    await page.close(); await newPage(new Date(nextTime)); await enter(); await click('继续考试');
    await visible(page.getByRole('article',{name:'第 2 题',exact:true}));
    const row=await currentAttempt(a=>a.id===firstId && a.interruptions.some(x=>x.reason==='audio-interrupted')); assert.deepEqual(row.attempt.answers,before.answers); assert.equal(row.attempt.listeningDeadline,before.listeningDeadline); assert.equal(row.attempt.readingDeadline,before.readingDeadline);
    assert.equal(await page.getByRole('radio').nth(0).isChecked(),true);
    assert.ok(row.attempt.interruptions.some(x=>x.reason==='audio-interrupted')); return {savedAnswers:Object.keys(row.attempt.answers).length,deadlineUnchanged:true};
  });
  await step('clock advances at listening deadline and locks LC',async()=>{
    const attempt=(await currentAttempt(a=>a.id===firstId)).attempt;
    const delta=attempt.listeningDeadline-await page.evaluate(()=>Date.now())+1200; assert.ok(delta>0);
    await page.clock.fastForward(delta); await visible(page.getByText('阅读 RC',{exact:true}));
    await currentAttempt(a=>a.id===firstId && a.status==='reading'); await visible(page.getByRole('article',{name:'第 101 题',exact:true}));
    await page.locator('.mock-answer-card summary').click();
    assert.equal(await page.getByRole('button',{name:/^第 1 题，/}).count(),0); assert.equal(await page.getByRole('button',{name:/^第 101 题，/}).count(),1);
    await answer(101,1); return {phase:'reading',listeningLocked:true};
  });
  await step('reading responsive widths',()=>layout('reading'));
  await step('manual submit, derived score and review',async()=>{
    await click('提交整卷'); await visible(page.getByRole('dialog')); await click('继续答题');
    assert.equal((await currentAttempt(a=>a.id===firstId)).attempt.status,'reading');
    await click('提交整卷'); await click('确认交卷');
    await resultSummary(2,197);
    await visible(page.getByRole('region',{name:'交卷后解析',exact:true}));
    originalFirst=(await currentAttempt(a=>a.id===firstId)).attempt;
    const row=await currentAttempt(a=>a.id===firstId); assert.equal(row.result.firstAttempt,true); assert.equal(row.result.correct,2);
    assert.equal(row.result.unanswered,197); assert.equal(row.result.listeningCorrect,1); assert.equal(row.result.readingCorrect,1); assert.equal(row.result.parts.length,7);
    assert.equal(await page.getByRole('radio').nth(1).isDisabled(),true); return {correct:2,unanswered:197,submittedReason:row.attempt.submittedReason};
  });
  await step('results responsive widths',()=>layout('results'));
  await step('backup download and repeated restore through UI',async()=>{
    await click('回到题包与记录'); const downloaded=await downloadBackup('qa-first-backup.json'); backupFile=downloaded.file;
    assert.equal(downloaded.backup.packages.length,2); assert.equal(downloaded.backup.attempts.length,1);
    for (let i=0;i<2;i++) { await importViaUI('恢复本机备份',backupFile); assert.match(await page.locator('.mock-status').innerText(),/新增 0 套题包、0 次记录/); }
    const db=await state(); assert.equal(db.catalog.length,2); assert.equal(db.attempts.length,1); assert.deepEqual(db.attempts[0].attempt,originalFirst);
    const foreign=structuredClone(downloaded.backup); foreign.ownerId='qa-other-owner'; const foreignFile=path.join(OUT,'qa-foreign-owner-backup.json'); await fs.writeFile(foreignFile,JSON.stringify(foreign));
    await importViaUI('恢复本机备份',foreignFile); await visible(page.getByRole('alert')); assert.match(await page.getByRole('alert').innerText(),/其他账号/);
    assert.equal((await state()).attempts.length,1); await click('重新读取记录'); await idle(); return {packages:2,attempts:1,repeatedRestores:2,foreignOwnerRejected:true};
  });
  await step('retake preserves first result and automatically submits at total deadline',async()=>{
    await preflight(packages[0].title); await click('开始新考试 · 立即计时');
    const row=await currentAttempt(a=>a.ordinal===2 && a.status==='listening'); await answer(1,0);
    const delta=row.attempt.readingDeadline-await page.evaluate(()=>Date.now())+1200; await page.clock.fastForward(delta);
    await resultSummary(0,199);
    const retake=await currentAttempt(a=>a.ordinal===2 && a.status==='submitted');
    assert.equal(retake.attempt.submittedReason,'timeout'); assert.equal(retake.attempt.submittedAt,retake.attempt.readingDeadline); assert.equal(retake.result.firstAttempt,false); assert.equal(retake.result.elapsedMs,120*60*1000);
    assert.deepEqual((await currentAttempt(a=>a.id===firstId)).attempt,originalFirst);
    await screenshot('retake-timeout'); await click('回到题包与记录');
    const finalBackup=await downloadBackup('qa-final-backup.json'); assert.equal(finalBackup.backup.attempts.length,2);
    return {ordinal:retake.attempt.ordinal,reason:retake.attempt.submittedReason,firstAttemptUnchanged:true,finalBackup:finalBackup.file};
  });
  await step('valid PNG header with corrupt image bytes cannot pass preflight',async()=>{
    await freshContext();await newPage();await enter();
    const corrupt=structuredClone(packages[0]);corrupt.id='browser-qa-bad-png';corrupt.title='损坏图片合成验证 · 非真实试卷';
    corrupt.assets.find(a=>a.mime==='image/png').base64=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(32)]).toString('base64');
    const file=path.join(OUT,'qa-corrupt-image.json');await fs.writeFile(file,JSON.stringify(corrupt));await importViaUI('导入题包 JSON',file);
    assert.equal((await state()).catalog.length,1);await preflight(corrupt.title,false);
    await visible(page.getByText('材料图片预检失败，不能开始新考试。',{exact:true}));
    assert.equal(await page.getByRole('button',{name:'开始新考试 · 立即计时',exact:true}).isDisabled(),true);
    assert.equal((await state()).attempts.length,0);await screenshot('bad-png-blocked');return {headerAccepted:true,decodeRejected:true,attempts:0};
  });
  await step('future-dated backup rejected before any private records are imported',async()=>{
    await freshContext();await newPage();await enter();
    const future=JSON.parse(await fs.readFile(backupFile,'utf8')),shift=24*60*60*1000;
    for(const attempt of future.attempts) {
      for(const key of ['startedAt','listeningDeadline','readingDeadline','lastObservedAt','submittedAt'])if(typeof attempt[key]==='number')attempt[key]+=shift;
      for(const value of Object.values(attempt.answers))value.savedAt+=shift;
      for(const interruption of attempt.interruptions)interruption.at+=shift;
    }
    const file=path.join(OUT,'qa-future-backup.json');await fs.writeFile(file,JSON.stringify(future));await importViaUI('恢复本机备份',file);
    await visible(page.getByRole('alert'));const rejection=await page.getByRole('alert').innerText();assert.match(rejection,/未来|时间/);
    const db=await state();assert.equal(db.catalog.length,0);assert.equal(db.attempts.length,0);await screenshot('future-backup-blocked');return {rejection,packages:0,attempts:0};
  });
  await step('simulated quota failure keeps saved answer and allows explicit exit',async()=>{
    await freshContext();await newPage();await enter();await importViaUI('导入题包 JSON',files[0]);await preflight(packages[0].title);await click('开始新考试 · 立即计时');await answer(1,1);
    const before=(await currentAttempt(a=>a.status==='listening')).attempt;
    // Fault injection applies only to attempts.put in this new temporary context.
    // It never writes data or changes the business flow and is restored below.
    await page.evaluate(dbName=>{
      const original=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){if(this.name==='attempts' && this.transaction.db.name===dbName)throw new DOMException('Synthetic QA quota failure','QuotaExceededError');return original.apply(this,args);};
      window.__restoreQaPut=()=>{IDBObjectStore.prototype.put=original;delete window.__restoreQaPut;};
    },DB);
    try {
      await click('保存并退出');await page.getByRole('dialog').getByRole('button',{name:'保存并退出',exact:true}).click();await visible(page.getByRole('button',{name:'中断标记未保存，仍退出（计时继续）',exact:true}));
      const failed=(await currentAttempt(a=>a.id===before.id)).attempt;assert.deepEqual(failed.answers,before.answers);assert.equal(failed.listeningDeadline,before.listeningDeadline);
      await screenshot('quota-exit-recovery');await click('中断标记未保存，仍退出（计时继续）');await click('确认未保存仍退出');await visible(page.getByRole('navigation',{name:'手机主导航',exact:true}));
    } finally {await page.evaluate(()=>window.__restoreQaPut?.());}
    await enter();await click('继续考试');await visible(page.getByRole('article',{name:'第 1 题',exact:true}));
    const restored=(await currentAttempt(a=>a.id===before.id)).attempt;assert.deepEqual(restored.answers,before.answers);assert.equal(restored.listeningDeadline,before.listeningDeadline);
    return {fault:'QuotaExceededError on attempts.put',savedAnswerRetained:true,explicitExitWorked:true,resumeWorked:true};
  });
  if(process.env.LANTERN_PAGE_PACK_QA_DIR) {
    await freshContext();await newPage();
    await require('./page-pack-flow.cjs')({page,step,click,importViaUI,preflight,idle,enter,currentAttempt,screenshot,layout,resultSummary,fixtureDir:process.env.LANTERN_PAGE_PACK_QA_DIR});
  }
  await require('./listening-duration-flow.cjs')({getPage:()=>page,step,click,importViaUI,preflight,idle,enter,currentAttempt,
    screenshot,state,freshContext,newPage,eventually,visible,output:OUT,basePackage:packages[0]});
  await step('no uncaught JS errors, local HTTP failures or external requests',async()=>{assert.deepEqual(report.pageErrors,[]); assert.deepEqual(report.httpErrors,[]);assert.deepEqual(report.blockedExternal,[]);return {pageErrors:0,httpErrors:0,blockedExternal:0,consoleErrors:report.consoleErrors};});
  report.status='passed';
})().catch(async error=>{
  report.status='failed'; report.error=String(error.stack||error);
  if(page && !page.isClosed()) {try{await screenshot('failure'); report.lastUrl=page.url(); report.lastBody=(await page.locator('body').innerText()).slice(0,15000);}catch{}}
  process.exitCode=1;
}).finally(async()=>{
  try{await cleanup();}catch(error){report.status='failed';report.cleanupError=String(error.stack||error);process.exitCode=1;}
  report.finishedAt=new Date().toISOString(); report.outputDirectory=OUT;
  if (ownsOutput) await fs.writeFile(path.join(OUT,'result.json'),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:report.status,passed:report.steps.filter(s=>s.status==='passed').length,failed:report.steps.filter(s=>s.status==='failed').length,output:OUT,error:report.error?.split('\n').slice(0,3).join('\n')}));
  // A failed cleanup cannot leave this runner held open by browser/IPC handles.
  // The written report explicitly states that termination was not confirmed.
  if(report.cleanupError)setTimeout(()=>process.exit(1),100).unref();
});
