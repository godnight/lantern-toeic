/* CI-only synthetic I/O around the actual VocabularyStudyCard and WorkspaceShell.
 * This script must not be used to bypass a stopped local browser workflow. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {createRequire} = require('node:module');
const {pathToFileURL} = require('node:url');

const REPO = path.resolve(process.env.LANTERN_WORDCARD_QA_REPO || path.join(__dirname, '../..'));
const repoRequire = createRequire(path.join(REPO, 'package.json'));
const REFERENCE_ONLY = process.argv.includes('--reference-only');
const CONDITIONS = [
  {id: 'paper-320', theme: 'paper', width: 320, height: 640, font: 100},
  {id: 'hollow-390', theme: 'hollow', width: 390, height: 844, font: 100},
  {id: 'silk-390', theme: 'silk', width: 390, height: 844, font: 100},
  {id: 'night-wide', theme: 'crystal', width: 1024, height: 768, font: 100},
  {id: 'paper-short', theme: 'paper', width: 320, height: 480, font: 100},
  {id: 'hollow-font200', theme: 'hollow', width: 390, height: 844, font: 200},
].filter(condition => !REFERENCE_ONLY || ['paper-320', 'hollow-390', 'hollow-font200'].includes(condition.id));
const RATINGS = ['known', 'fuzzy', 'forgotten'];
const LABELS = {known: '认识', fuzzy: '模糊', forgotten: '忘记'};
const report = {
  schemaVersion: 1, status: 'RUNNING', mode: REFERENCE_ONLY ? 'reference-only' : 'full-word-card', scope: 'Actual word-card/source CSS geometry with isolated synthetic workflow I/O',
  startedAt: new Date().toISOString(), conditions: [], screenshots: [], pageErrors: [], blockedExternal: [],
  limitations: [
    'Synthetic promises/receipts validate component transitions and callback counts, not IndexedDB durability or actual SRS scheduling.',
    'Desktop Chromium source-fixture geometry does not prove physical phone, keyboard/IME or ArkWeb behavior.',
    'Audio cases append explicit synthetic status text to the actual SpeechPlayer feedback element; no playback or microphone acceptance is claimed.',
    'The actual WorkspaceShell is used; Today hierarchy and complete blue-lake rendering remain outside this focused fixture.',
    'Input traces observe document capture only. Intercepted trial input may not reach those listeners; missing down/click events do not prove no native input. Trial may affect hover and is not a pure CDP experiment.',
    'Each page records at most1000 events; these bounded observations are not an exhaustive native input trace.',
    'The2CSSpx acceptance applies to recorded geometry samples, not continuous per-frame proof that every transient position stays inside that range.',
  ],
};
let OUT, origin, preview, browser, context, page;
let ownsOutput = false, stopped = false;
const owner = crypto.randomBytes(24).toString('hex');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const posix = value => value.replaceAll('\\', '/');

async function outputDirectory() {
  if (process.env.LANTERN_WORDCARD_QA_DIR) {
    OUT = path.resolve(process.env.LANTERN_WORDCARD_QA_DIR);
    await fs.mkdir(path.dirname(OUT), {recursive: true});
    await fs.mkdir(OUT); // Refuse existing output; do not replace old evidence.
  } else OUT = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-word-card-layout-'));
  ownsOutput = true;
}
async function pins() {
  const inputs = ['app/learn/vocabulary-plan.tsx', 'app/learn/workspace-shell.tsx', 'app/globals.css',
    'app/redesign.css', 'app/v041-design-theme.css', 'app/learn/v041-vocabulary.css',
    'app/learn/audio-redesign.css', 'app/v041-app-redesign.css', 'app/learn/legal-pages.css',
    'app/learn/word-card-reference.ts', 'content/word-card-reference.json', 'public/build-identity.json'];
  report.sourcePins = [];
  for (const relative of inputs) {
    const bytes = await fs.readFile(path.join(REPO, relative));
    report.sourcePins.push({path: relative, bytes: bytes.length, sha256: digest(bytes)});
  }
  report.buildIdentity = JSON.parse(await fs.readFile(path.join(REPO, 'public/build-identity.json'), 'utf8'));
  const fixture = await fs.readFile(path.join(__dirname, 'word-card-layout.fixture.jsx'));
  report.fixturePin = {bytes: fixture.length, sha256: digest(fixture)};
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function prepareFixture() {
  const directory = path.join(OUT, 'fixture');
  await fs.mkdir(directory);
  const source = (await fs.readFile(path.join(__dirname, 'word-card-layout.fixture.jsx'), 'utf8'))
    .replace("'__QA_REACT__'", JSON.stringify(posix(repoRequire.resolve('react'))))
    .replace("'__QA_REACT_DOM__'", JSON.stringify(posix(repoRequire.resolve('react-dom/client'))));
  await fs.writeFile(path.join(directory, 'entry.jsx'), source, {flag: 'wx'});
  await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.jsx"></script></body></html>', {flag: 'wx'});
  const aliases = [{find: '@', replacement: REPO},
    {find: /^react$/, replacement: repoRequire.resolve('react')},
    {find: /^react\/jsx-runtime$/, replacement: repoRequire.resolve('react/jsx-runtime')},
    {find: /^react\/jsx-dev-runtime$/, replacement: repoRequire.resolve('react/jsx-dev-runtime')},
    {find: /^react-dom\/client$/, replacement: repoRequire.resolve('react-dom/client')}];
  const aliasCode = aliases.map(alias => `{find:${alias.find instanceof RegExp ? alias.find.toString() : JSON.stringify(alias.find)},replacement:${JSON.stringify(posix(alias.replacement))}}`).join(',');
  const config = `import react from ${JSON.stringify(pathToFileURL(repoRequire.resolve('@vitejs/plugin-react')).href)};
import tailwind from ${JSON.stringify(pathToFileURL(repoRequire.resolve('@tailwindcss/postcss')).href)};
export default {root:${JSON.stringify(directory)},base:'./',publicDir:${JSON.stringify(path.join(REPO, 'public'))},plugins:[react()],css:{postcss:{plugins:[tailwind()]}},resolve:{alias:[${aliasCode}]},build:{outDir:'dist',emptyOutDir:true}};\n`;
  const configFile = path.join(directory, 'vite.config.mjs');
  await fs.writeFile(configFile, config, {flag: 'wx'});
  return configFile;
}
async function startPreview(configFile) {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  const worker = `const c=JSON.parse(process.argv[1]);(async()=>{const{build,preview}=await import(c.vite);await build({configFile:c.configFile,configLoader:'native',logLevel:'error'});const s=await preview({configFile:c.configFile,configLoader:'native',logLevel:'error',preview:{host:'127.0.0.1',port:c.port,strictPort:true,open:false},plugins:[{name:'owned-word-card-qa',configurePreviewServer(server){server.middlewares.use((req,res,next)=>{res.setHeader('X-Lantern-QA-Owner',c.owner);next();});}}]});let closing=false;const close=async()=>{if(closing)return;closing=true;await s.close();process.exit(0);};process.once('SIGTERM',close);process.once('SIGINT',close);process.send({ready:true,pid:process.pid});})().catch(e=>{console.error(e.stack||e);process.exit(1);});`;
  preview = spawn(process.execPath, ['-e', worker, JSON.stringify({vite: pathToFileURL(repoRequire.resolve('vite')).href, configFile, port, owner})],
    {cwd: REPO, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: process.platform !== 'win32', windowsHide: true});
  let log = '';
  const capture = chunk => {log = (log + chunk.toString()).slice(-12000);};
  preview.stdout.on('data', capture); preview.stderr.on('data', capture);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned fixture build/preview deadline: ' + log)), 120000);
    preview.once('error', error => {clearTimeout(timer); reject(error);});
    preview.once('exit', (code, signal) => {clearTimeout(timer); reject(new Error(`Owned fixture exited ${code}/${signal}: ${log}`));});
    preview.once('message', message => {clearTimeout(timer); message?.ready && message.pid === preview.pid ? resolve() : reject(new Error('Unowned preview readiness'));});
  });
  const response = await fetch(origin + '/', {redirect: 'error', signal: AbortSignal.timeout(10000)});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-lantern-qa-owner'), owner);
  report.preview = {origin, pid: preview.pid, ownershipVerified: true, htmlSha256: digest(await response.text())};
}
async function stopPreview() {
  if (!preview || preview.exitCode !== null || preview.signalCode !== null) {stopped = true; return;}
  const exit = new Promise(resolve => preview.once('exit', resolve));
  // This harness is CI-only. Kill only the still-owned process/group we created.
  if (process.platform === 'win32') preview.kill('SIGTERM');
  else process.kill(-preview.pid, 'SIGTERM');
  await Promise.race([exit, sleep(5000)]);
  if (preview.exitCode === null && preview.signalCode === null) {
    if (process.platform === 'win32') preview.kill('SIGKILL');
    else {try {process.kill(-preview.pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}}
    await Promise.race([exit, sleep(2000)]);
  }
  stopped = preview.exitCode !== null || preview.signalCode !== null;
  assert.equal(stopped, true, 'Owned preview did not stop');
}
async function settleFrames() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function state() {return page.evaluate(() => window.__wordCardQA.read());}
async function snapshot(condition, wordIndex, phase, extra = {}) {
  await settleFrames();
  const value = await page.evaluate(() => {
    const rect = element => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return {x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom,
        documentX: r.x + scrollX, documentY: r.y + scrollY};
    };
    const content = document.querySelector('.phase2-word-content');
    const typography = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return {fontSizePx: parseFloat(style.fontSize), lineHeight: style.lineHeight};
    };
    return {card: rect(document.querySelector('.v045-stable-word-card')),
      controls: rect(document.querySelector('.phase2-word-controls')),
      buttons: [...document.querySelectorAll('.phase2-word-controls .button')].map(element => ({text: element.textContent.trim(), rect: rect(element)})),
      content: {rect: rect(content), scrollTop: content.scrollTop, scrollHeight: content.scrollHeight, clientHeight: content.clientHeight},
      viewport: {width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
        scrollY, visualHeight: visualViewport?.height ?? innerHeight},
      typography: {root: typography('html'), heading: typography('.phase2-current-word'), meaning: typography('.phase2-word-meaning'), action: typography('.phase2-word-controls .button')},
      focus: {tag: document.activeElement?.tagName, className: document.activeElement?.className || ''}};
  });
  assert.ok(value.card && value.controls, 'Missing actual card or controls');
  assert.ok(value.viewport.documentWidth <= value.viewport.width + 1 && value.viewport.bodyWidth <= value.viewport.width + 1,
    'Horizontal document overflow: ' + JSON.stringify(value.viewport));
  assert.ok(value.content.clientHeight >= 24, 'No usable reading slot: ' + JSON.stringify(value.content));
  for (const button of value.buttons) assert.ok(button.rect.width >= 44 && button.rect.height >= 44, 'Button below44px: ' + JSON.stringify(button));
  if (value.buttons.length === 3) {
    assert.ok(Math.max(...value.buttons.map(button => button.rect.width)) - Math.min(...value.buttons.map(button => button.rect.width)) <= 1, 'Unequal rating widths');
    assert.ok(Math.max(...value.buttons.map(button => button.rect.height)) - Math.min(...value.buttons.map(button => button.rect.height)) <= 1, 'Unequal rating heights');
  }
  const row = {wordIndex, phase, ...value, ...extra};
  condition.geometry.push(row);
  return row;
}
function stable(reference, actual) {
  for (const element of ['card', 'controls']) for (const field of ['x', 'y', 'documentX', 'documentY', 'width', 'height']) {
    assert.ok(Math.abs(reference[element][field] - actual[element][field]) <= 2,
      `${element}.${field} moved over2CSSpx: ${reference[element][field]} -> ${actual[element][field]} (${actual.phase})`);
  }
  const before = reference.buttons[0].rect, after = actual.buttons[0].rect;
  for (const field of ['y', 'documentY', 'height']) assert.ok(Math.abs(before[field] - after[field]) <= 2, `Actual action ${field} changed over2CSSpx`);
}
function wholeSequenceSpans(condition) {
  const result = {};
  for (const element of ['card', 'controls']) {
    result[element] = {};
    for (const field of ['x', 'y', 'documentX', 'documentY', 'width', 'height']) {
      const values = condition.geometry.map(row => row[element][field]);
      const min = Math.min(...values), max = Math.max(...values);
      result[element][field] = {min, max, span: max - min};
      assert.ok(max - min <= 2, `${condition.id} whole-sequence ${element}.${field} span exceeds2CSSpx: ${max - min}`);
    }
  }
  result.action = {};
  for (const field of ['y', 'documentY', 'height']) {
    const values = condition.geometry.map(row => row.buttons[0].rect[field]);
    const min = Math.min(...values), max = Math.max(...values);
    result.action[field] = {min, max, span: max - min};
    assert.ok(max - min <= 2, `${condition.id} whole-sequence action.${field} span exceeds2CSSpx: ${max - min}`);
  }
  return result;
}
async function screenshot(condition, suffix) {
  const name = `${condition.id}-${suffix}.png`;
  await page.screenshot({path: path.join(OUT, name), animations: 'disabled', caret: 'hide'});
  const bytes = await fs.readFile(path.join(OUT, name));
  report.screenshots.push({condition: condition.id, file: name, bytes: bytes.length, sha256: digest(bytes)});
}
async function reachControls() {
  await page.locator('.phase2-word-controls').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const button = document.querySelector('.phase2-word-controls .button');
    const r = button.getBoundingClientRect();
    const nav = document.querySelector('.workspace-mobile-nav');
    const n = nav?.getBoundingClientRect();
    const boundary = n && getComputedStyle(nav).position === 'fixed' ? n.top : innerHeight;
    if (r.bottom > boundary - 8) scrollBy(0, r.bottom - boundary + 8);
  });
  await settleFrames();
  const hit = await page.locator('.phase2-word-controls .button').first().evaluate(element => {
    const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const target = document.elementFromPoint(x, y);
    return {visible: x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight, hit: target === element || element.contains(target)};
  });
  assert.ok(hit.visible && hit.hit, 'Action unreachable or under fixed navigation: ' + JSON.stringify(hit));
}
async function visiblePointerClick(locator,condition,wordIndex,phase,reference) {
  const before=await snapshot(condition,wordIndex,`${phase}-neutral-preclick`);
  stable(reference,before);
  const hit = await locator.evaluate(element => {
    const r = element.getBoundingClientRect(), nav = document.querySelector('.workspace-mobile-nav');
    const n = nav?.getBoundingClientRect();
    const header=document.querySelector('.workspace-topbar'),headerRect=header?.getBoundingClientRect();
    const usableTop=headerRect&&headerRect.height>0?Math.max(0,headerRect.bottom):0;
    const boundary = n && n.height > 0 && getComputedStyle(nav).position === 'fixed' ? Math.min(innerHeight, n.top) : innerHeight;
    const position={x:element.clientWidth/2,y:element.clientHeight/2};
    const point={x:r.left+element.clientLeft+position.x,y:r.top+element.clientTop+position.y};
    const target = document.elementFromPoint(point.x,point.y);
    return {visible: r.left >= 0 && r.right <= innerWidth && r.top >= usableTop-1 && r.bottom <= boundary + 1,
      hit: target === element || element.contains(target),rect:{x:r.x,y:r.y,width:r.width,height:r.height},position,point,usableTop,boundary};
  });
  assert.ok(hit.rect.width>=44&&hit.rect.height>=44,'Pointer target below44px: '+JSON.stringify(hit));
  assert.ok(hit.visible && hit.hit, 'Real pointer target is not fully reachable: ' + JSON.stringify(hit));
  // The target is already reachable. Keep normal actionability/hit checks and
  // actual mouse events, without Playwright's extra pre-action scroll command.
  // Native browser focus scrolling remains enabled and is still measured.
  const start=await page.evaluate(()=>window.__wordCardInputEvents.length);
  await locator.click({scroll:'none',position:hit.position});
  await settleFrames();
  report.pointerActions ||= [];
  const events=await page.evaluate(start=>window.__wordCardInputEvents.slice(start),start);
  const down=events.find(event=>event.type==='pointerdown'||event.type==='mousedown');
  assert.ok(down&&down.isTrusted,'No trusted real pointer event observed');
  assert.ok(Math.abs(down.clientX-hit.point.x)<=1&&Math.abs(down.clientY-hit.point.y)<=1,'Real pointer point differs from verified hit point');
  report.pointerActions.push({condition:condition.id,wordIndex,phase,input:'locator.click({scroll:none,position:verifiedPaddingCenter})',hit,events});
}
async function inputPreparationControl(condition) {
  const read = () => page.evaluate(() => {
    const card = document.querySelector('.v045-stable-word-card'), button = document.querySelector('.phase2-rating-actions button');
    const r = card.getBoundingClientRect(), b = button.getBoundingClientRect();
    return {scrollX, scrollY, documentMaxScroll: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
      viewport:{width:innerWidth,height:innerHeight,visualHeight:visualViewport?.height??innerHeight},
      focus:{tag:document.activeElement?.tagName,className:document.activeElement?.className??null},
      hovered:[...document.querySelectorAll(':hover')].map(e=>({tag:e.tagName,className:typeof e.className==='string'?e.className:null})),
      card: {x: r.x, y: r.y, documentY: r.y + scrollY, width: r.width, height: r.height},
      button: {top: b.top, bottom: b.bottom, scrollMarginTop: getComputedStyle(button).scrollMarginTop, scrollMarginBottom: getComputedStyle(button).scrollMarginBottom},
      rootScrollPaddingBottom: getComputedStyle(document.documentElement).scrollPaddingBottom};
  });
  const before = await read(), factsBefore = await state();
  const eventStart=await page.evaluate(()=>window.__wordCardInputEvents.length);
  // A Playwright trial may send intercepted pointer input and change hover.
  // It is not a pure CDP experiment and lives in its own disposable context.
  await page.getByRole('button', {name: LABELS.known, exact: true}).click({trial: true});
  await settleFrames();
  const afterTrial = await read();
  const factsAfter=await state();
  assert.deepEqual(factsAfter, factsBefore, 'Trial preparation called the learning workflow');
  assert.equal(afterTrial.card.documentY, before.card.documentY);
  assert.equal(afterTrial.card.width, before.card.width); assert.equal(afterTrial.card.height, before.card.height);
  report.inputPreparationControls ||= [];
  const control={condition: condition.id, phase: 'AUTOMATION_PREPARATION_ONLY_NOT_USER_STATE', before, afterTrial,
    observedScrollDelta: afterTrial.scrollY - before.scrollY, noLearningCallback: true,
    learningBefore:{cursor:factsBefore.cursor,attempts:factsBefore.attempts.length,saved:factsBefore.saved.length,next:factsBefore.next.length},
    learningAfterTrial:{cursor:factsAfter.cursor,attempts:factsAfter.attempts.length,saved:factsAfter.saved.length,next:factsAfter.next.length},
    events:await page.evaluate(start=>window.__wordCardInputEvents.slice(start),eventStart),
    trialMaySendInterceptedPointerInput:true,separateFreshContext:true,
    matrixInput:'Separate fresh contexts;visible hit-tested locator.click({scroll:none,position:verifiedPaddingCenter});realmouse/focus retained'};
  report.inputPreparationControls.push(control);
  control.scrollRestoration='NONE_CONTEXT_IS_DISCARDED';
  return control;
}
async function audioStatusPressure(condition, wordIndex, reference, preserveReading = false) {
  const feedback = page.locator('.v041-word-heading .speech-audio-feedback');
  assert.equal(await feedback.count(), 1, 'Actual SpeechPlayer status slot missing');
  // A growing status above the text may change scrollTop to preserve its visual anchor.
  // Compare the same teaching paragraph in the viewport, including after clearing status.
  const readingAnchor = () => page.locator('.phase2-word-content').evaluate(element => {
    const paragraph = element.querySelector('.phase2-word-etymology > p') || element.querySelector('.phase2-word-meaning > p:last-child');
    const rect = paragraph.getBoundingClientRect();
    return {text: paragraph.textContent, top: rect.top, bottom: rect.bottom};
  });
  const anchored = preserveReading ? await readingAnchor() : null;
  const assertReadingAnchor = async row => {
    if (!anchored) return;
    const current = await readingAnchor();
    row.readingAnchor = {...current, topDelta: current.top - anchored.top, bottomDelta: current.bottom - anchored.bottom};
    assert.equal(current.text, anchored.text, 'Audio status replaced the current reading paragraph');
    assert.ok(Math.abs(row.readingAnchor.topDelta) <= 2 && Math.abs(row.readingAnchor.bottomDelta) <= 2,
      'Audio status moved the current reading paragraph in the viewport');
  };
  for (const [phase, message] of [['loading', '正在准备音频…'], ['error', '合成音频失败：请稍后重试。此处仅验证较长错误文字不撑动卡片和操作位。'], ['replay', '合成重播状态：音频已更新，请从头播放。']]) {
    await feedback.evaluate((element, message) => {
      const span = document.createElement('span'); span.dataset.qaSyntheticAudio = 'true';
      span.setAttribute('role', message.includes('失败') ? 'alert' : 'status'); span.textContent = message; element.append(span);
    }, message);
    const actual = await snapshot(condition, wordIndex, `synthetic-audio-${phase}`, {syntheticAudioStateOnly: true});
    stable(reference, actual);
    await assertReadingAnchor(actual);
    await feedback.locator('[data-qa-synthetic-audio]').evaluateAll(elements => elements.forEach(element => element.remove()));
    const neutral=await snapshot(condition,wordIndex,`synthetic-audio-${phase}-cleared-neutral`,{syntheticAudioStateOnly:true});
    stable(reference,neutral);
    await assertReadingAnchor(neutral);
  }
}
async function openFixturePage(config) {
  context = await browser.newContext({viewport: {width: config.width, height: config.height}, deviceScaleFactor: 1,
    serviceWorkers: 'block', acceptDownloads: false, permissions: []});
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    report.blockedExternal.push({url: url.origin + url.pathname, resourceType: request.resourceType()});
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value: () => {throw new Error('Microphone disabled in synthetic layout QA');}});
    window.__wordCardInputEvents=[];
    for(const type of ['pointermove','mousemove','pointerdown','pointerup','mousedown','mouseup','focusin','focusout','click','scroll'])document.addEventListener(type,event=>{
      const card=document.querySelector('.v045-stable-word-card'),r=card?.getBoundingClientRect(),target=event.target;
      const events=window.__wordCardInputEvents;
      if(events.length>=1000)return;
      events.push({type,time:performance.now(),isTrusted:event.isTrusted,clientX:typeof event.clientX==='number'?event.clientX:null,clientY:typeof event.clientY==='number'?event.clientY:null,scrollX,scrollY,card:r?{y:r.y,documentY:r.y+scrollY,width:r.width,height:r.height}:null,
        target:{tag:target?.tagName??null,className:typeof target?.className==='string'?target.className:null},
        focus:{tag:document.activeElement?.tagName,className:document.activeElement?.className??null}});
    },{capture:true,passive:true});
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', error => report.pageErrors.push({condition: config.id, message: error.message}));
  await page.goto(`${origin}/?theme=${config.theme}&font=${config.font}`, {waitUntil: 'networkidle'});
  await page.waitForFunction(() => !!window.__wordCardQA);
  await page.locator('.v045-stable-word-card').waitFor({state: 'visible'});
  if (config.prepareControls !== false) await reachControls();
}
async function runFreshPreparationControl(){
  let control;
  try{await openFixturePage({...CONDITIONS[0],id:'paper-320-independent-trial'});control=await inputPreparationControl({id:'paper-320-independent-trial'});}
  finally{await context?.close();context=null;page=null;if(control)control.contextClosedBeforeMatrix=true;}
}
async function assertWordReference(word, revealed) {
  const phonetic = page.locator('.word-phonetic');
  assert.equal((await phonetic.innerText()).trim(), word.phonetics.length ? word.phonetics.join(' · ') : '暂无音标');
  const layout = await phonetic.evaluate(element => {
    const style = getComputedStyle(element);
    return {clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, lineClamp: style.webkitLineClamp, overflow: style.overflow};
  });
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, 'Phonetic variants overflow horizontally');
  assert.ok(!layout.lineClamp || layout.lineClamp === 'none', 'Phonetics were line-clamped');
  assert.notEqual(layout.overflow, 'hidden', 'Phonetics were clipped');
  const etymology = page.locator('.phase2-word-etymology');
  assert.equal(await etymology.count(), revealed && word.etymology ? 1 : 0, 'Etymology revealed before a confirmed rating or missing after it');
  if(revealed && word.etymology) assert.equal((await etymology.locator('p').innerText()).trim(), word.etymology.trim());
}
async function runCondition(config) {
  const condition = {...config, status: 'RUNNING', geometry: [], flow: []}; report.conditions.push(condition);
  await openFixturePage({...config, prepareControls: config.id !== 'hollow-390'});
  const first = await snapshot(condition, 0, 'before');
  await screenshot(condition, 'before');
  await audioStatusPressure(condition, 0, first);
  for (let index = 0; index < 10; index++) {
    const beforeState = await state(), word = beforeState.words[index], rating = RATINGS[index % 3], label = LABELS[rating];
    assert.equal(beforeState.cursor, index);
    assert.equal(await page.getByText(word.answerMarker, {exact: false}).count(), 0, 'Unrevealed answer is mounted in DOM');
    assert.equal(await page.locator('.phase2-word-meaning').count(), 0);
    await assertWordReference(word, false);
    const before = index === 0 ? first : await snapshot(condition, index, 'before'); stable(first, before);
    const savedBefore = beforeState.saved.length, attemptBefore = beforeState.attempts.length;
    await visiblePointerClick(page.getByRole('button', {name: label, exact: true}),condition,index,'rating',first);
    await page.waitForFunction(() => window.__wordCardQA.read().pending);
    assert.equal(await page.getByText(/待确认：|请重试原反馈/).count(), 0, 'Normal pending rendered recovery text');
    assert.equal(await page.locator('.phase2-word-meaning').count(), 0);
    assert.equal((await state()).attempts.length, attemptBefore + 1);
    await page.locator(`.phase2-rating-actions button[aria-pressed="true"]`).evaluate(element => {element.click(); element.click();});
    assert.equal((await state()).attempts.length, attemptBefore + 1, 'Repeated pending clicks duplicated callback');
    stable(first, await snapshot(condition, index, 'pending'));
    if (index === 4) {
      await page.evaluate(() => window.__wordCardQA.settle('failure'));
      await page.waitForFunction(() => !window.__wordCardQA.read().pending);
      await page.getByText('合成保存失败：', {exact: false}).waitFor();
      assert.equal(await page.locator('.phase2-word-meaning').count(), 0);
      for (const other of RATINGS.filter(value => value !== rating)) assert.equal(await page.getByRole('button', {name: LABELS[other], exact: true}).isDisabled(), true);
      stable(first, await snapshot(condition, index, 'save-failure'));
      await screenshot(condition, 'save-failure');
      await visiblePointerClick(page.getByRole('button', {name: label, exact: true}),condition,index,'retry',first);
      await page.waitForFunction(() => window.__wordCardQA.read().pending);
      const pending = await state();
      assert.deepEqual(pending.attempts.slice(-2).map(item => item.rating), [rating, rating]);
      stable(first, await snapshot(condition, index, 'retry-pending'));
    }
    await page.evaluate(() => window.__wordCardQA.settle('success'));
    await page.locator('.phase2-word-meaning').waitFor({state: 'visible'});
    await page.waitForFunction(() => !window.__wordCardQA.read().pending);
    const saved = await state();
    assert.equal(saved.cursor, index, 'Saving automatically advanced the word');
    assert.equal(saved.saved.length, savedBefore + 1, 'Feedback was not saved exactly once');
    assert.equal(saved.saved.at(-1).rating, rating);
    assert.equal(saved.next.length, index, 'Next callback ran before explicit Next');
    assert.ok((await page.locator('.phase2-word-meaning').innerText()).includes(word.answerMarker));
    await assertWordReference(word, true);
    const revealed = await snapshot(condition, index, 'revealed'); stable(first, revealed);
    assert.equal(await page.evaluate(() => document.activeElement?.matches('.phase2-word-content')), true,
      'First confirmed reveal lost focus instead of moving to the reading region');
    if (config.id === 'hollow-390' && index === 0) {
      const visible = await page.locator('.phase2-word-content').evaluate(element => {
        const area = element.getBoundingClientRect();
        const targets = [...element.querySelectorAll('.phase2-current-word,.word-phonetic,.phase2-word-meaning > p,.phase2-word-example,.phase2-word-etymology')];
        const button = element.querySelector('.phase2-word-example .speech-audio-icon');
        const rect = button.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {scrollTop: element.scrollTop, fits: element.scrollHeight <= element.clientHeight + 1,
          allVisible: targets.every(target => {const r = target.getBoundingClientRect(); return r.top >= Math.max(0, area.top) - 1 && r.bottom <= Math.min(innerHeight, area.bottom) + 1;}),
          exampleAudioHit: hit === button || button.contains(hit)};
      });
      assert.deepEqual(visible, {scrollTop: 0, fits: true, allVisible: true, exampleAudioHit: true},
        'Typical revealed card must show phonetics, meaning, example, translation and etymology with a reachable example-audio target before scrolling');
      condition.typicalFirstScreen = visible;
      await screenshot(condition, 'typical-revealed-first-screen');
    }
    const reading = await page.locator('.phase2-word-content').evaluate(element => {
      element.scrollTop = element.scrollHeight;
      const last = element.querySelector('.phase2-word-etymology > p') || element.querySelector('.phase2-word-meaning > p:last-child');
      const r = element.getBoundingClientRect(), l = last.getBoundingClientRect();
      return {scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
        lastText: last.textContent, lastBottom: l.bottom, contentBottom: r.bottom, lastHeight: l.height};
    });
    assert.ok((await page.locator('.phase2-word-meaning').innerText()).includes(word.finalMarker));
    assert.ok(reading.lastText.includes(word.etymology || word.finalMarker));
    assert.ok(reading.lastBottom <= reading.contentBottom + 2 && reading.lastHeight > 0, 'Last teaching text cannot be scrolled into reading slot');
    if (word.long) assert.ok(reading.scrollHeight > reading.clientHeight && reading.scrollTop > 0, 'Long-content fixture did not exercise reading scroll');
    if (index === 1) {
      await audioStatusPressure(condition, index, first, true);
      await screenshot(condition, 'long-meaning-end');
    }
    condition.flow.push({wordIndex: index, rating, saveAttempts: saved.attempts.filter(item => item.cursor === index).length, savedOnce: true, reading});
    const next = page.locator('.phase2-next-word');
    await visiblePointerClick(next,condition,index,'next',first);
    if (index < 9) {
      await page.waitForFunction(expected => window.__wordCardQA.read().cursor === expected, index + 1);
      await settleFrames();
      assert.equal(await page.locator('.phase2-word-content').evaluate(element => element.scrollTop), 0, 'Next word retained old meaning scroll');
      assert.equal(await page.evaluate(() => document.activeElement?.matches('.phase2-current-word')), true, 'Next word lost focus rather than focusing its heading');
      assert.equal(await page.getByText(word.answerMarker, {exact: false}).count(), 0, 'Previous word answer leaked into next word');
    } else await page.getByRole('heading', {name: '本组完成', exact: true}).waitFor();
  }
  const final = await state();
  assert.equal(final.saved.length, 10); assert.equal(final.next.length, 10); assert.equal(final.attempts.length, 11);
  assert.equal(final.blockedAlternateCalls, 0); assert.equal(final.status, 'completed');
  condition.wholeSequenceSpans = wholeSequenceSpans(condition);
  condition.final = final; condition.status = 'PASS';
  await context.close(); context = null; page = null;
}
async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'CI-only browser regression: local browser execution is intentionally disabled');
  assert.equal(process.platform, 'linux', 'This owned-process browser regression is prepared for Linux CI only');
  await outputDirectory(); await pins();
  const configFile = await prepareFixture(); await startPreview(configFile);
  const {chromium} = repoRequire('playwright');
  await fs.access(chromium.executablePath()); // Never install a browser here.
  browser = await chromium.launch({headless: true});
  report.browser = {playwright: repoRequire('playwright/package.json').version, executable: chromium.executablePath()};
  await runFreshPreparationControl();
  for (const condition of CONDITIONS) await runCondition(condition);
  const ordinary = report.conditions.find(condition => condition.id === 'hollow-390').geometry.find(row => row.typography.meaning);
  const enlarged = report.conditions.find(condition => condition.id === 'hollow-font200').geometry.find(row => row.typography.meaning);
  report.fontEnlargement = {};
  for (const part of ['root', 'heading', 'meaning', 'action']) {
    const before = ordinary.typography[part].fontSizePx, after = enlarged.typography[part].fontSizePx;
    report.fontEnlargement[part] = {ordinaryPx: before, enlargedPx: after, ratio: after / before};
    assert.ok(after >= before * 1.99, `200% did not actually enlarge ${part} text: ${before} -> ${after}`);
  }
  assert.deepEqual(report.pageErrors, [], 'Actual component emitted page errors');
  report.status = 'PASS';
}
(async () => {
  try {await main();}
  catch (error) {report.status = 'FAIL'; report.error = {message: error.message, stack: error.stack}; process.exitCode = 1;}
  finally {
    try {await context?.close(); await browser?.close();} catch (error) {report.cleanupError = error.message; report.status = 'FAIL'; process.exitCode = 1;}
    try {await stopPreview();} catch (error) {report.previewCleanupError = error.message; report.status = 'FAIL'; process.exitCode = 1;}
    report.previewStopped = stopped; report.finishedAt = new Date().toISOString();
    if (ownsOutput) await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
    process.stdout.write(JSON.stringify({status: report.status, result: ownsOutput ? path.join(OUT, 'result.json') : null,
      conditions: report.conditions.length, screenshots: report.screenshots.length, error: report.error?.message}) + '\n');
  }
})();
