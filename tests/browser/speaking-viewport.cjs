'use strict';
// Isolated real-DOM layout regression. No build, device, microphone or real recording.
// Optional LANTERN_SPEAKING_CSS points at the actual staged/minified CSS to test.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const {pathToFileURL} = require('node:url');
const REPO = path.resolve(__dirname, '../..');
const SOURCE = path.resolve(process.env.LANTERN_SPEAKING_SOURCE_REPO || REPO);
const req = createRequire(path.join(REPO, 'package.json'));
const {chromium} = req('playwright');
const RUN = path.resolve(REPO, '../dev-speaking', new Date().toISOString().replaceAll(':', '-') + '-' + crypto.randomBytes(3).toString('hex'));
const compiledCSS = process.env.LANTERN_SPEAKING_CSS && path.resolve(process.env.LANTERN_SPEAKING_CSS);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {
  scope: 'SpeakingRoom and unsaved-discard actual React DOM viewport regression',
  startedAt: new Date().toISOString(), source: SOURCE,
  cssMode: compiledCSS ? 'actual staged CSS' : 'source CSS through Vite development transforms',
  limitations: [
    'Desktop Chromium fixture is not Harmony ArkWeb or native acceptance.',
    'VisualViewport resize/scroll is controlled IME simulation, not an operating-system keyboard.',
    'No microphone, recording, audio playback, account, production API, or device operation.',
    'Source-CSS success alone cannot close a production CSS minification defect.',
    'Unsaved recovery uses a synthetic Blob solely to render the existing layout.'
  ],
  steps: [], screenshots: [], pageErrors: [], consoleErrors: [], httpErrors: [], blockedExternal: []
};
let server, browser, context, page, origin;

async function sourceManifest() {
  const files = ['app/learn/speaking.tsx', 'app/learn/speaking-redesign.css', 'components/ui/dialog.tsx', 'lib/use-dialog-viewport.ts', 'app/globals.css', 'app/redesign.css'];
  return Promise.all(files.map(async name => ({path: name, sha256: await fs.readFile(path.join(SOURCE, name)).then(hash).catch(error => error.code === 'ENOENT' ? 'absent' : Promise.reject(error))})));
}
async function eventually(action, label, timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  do {try {const result = await action(); if (result) return result;} catch (error) {last = error;} await delay(60);} while (Date.now() < end);
  throw Error(label + (last ? ': ' + last.message : ''));
}
async function step(name, action) {
  const start = Date.now();
  try {
    const details = await action();
    report.steps.push({name, status: 'passed', elapsedMs: Date.now() - start, details});
    console.log(JSON.stringify({step: name, status: 'passed'}));
  } catch (error) {
    report.steps.push({name, status: 'failed', elapsedMs: Date.now() - start, error: String(error.stack || error)});
    if (page) {
      await fs.writeFile(path.join(RUN, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => ''));
      await page.screenshot({path: path.join(RUN, 'failure.png'), fullPage: true}).catch(() => {});
      report.failureLayout = await layout('.speaking-room').catch(() => null);
      report.failureDiscardLayout = await layout('.speaking-discard').catch(() => null);
    }
    throw error;
  }
}
async function snapshot(name) {
  const file = path.join(RUN, name + '.png');
  await page.screenshot({path: file, fullPage: true, animations: 'disabled'});
  report.screenshots.push({name, path: file});
}
async function prepare() {
  await fs.mkdir(RUN, {recursive: true});
  report.sourceBefore = await sourceManifest();
  if (compiledCSS) report.compiledCSS = {path: compiledCSS, sha256: hash(await fs.readFile(compiledCSS))};
  const fixture = path.join(RUN, 'fixture');
  await fs.mkdir(fixture);
  const posix = value => value.replaceAll('\\', '/');
  const cssImports = compiledCSS ? '' : `import ${JSON.stringify(posix(path.join(SOURCE, 'app/globals.css')))};\nimport ${JSON.stringify(posix(path.join(SOURCE, 'app/redesign.css')))};`;
  const entry = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import SpeakingRoom from ${JSON.stringify(posix(path.join(SOURCE, 'app/learn/speaking.tsx')))};
import prompts from ${JSON.stringify(posix(path.join(SOURCE, 'content/speaking.json')))};
${cssImports}
document.body.dataset.uiTheme='day';
const prompt=prompts.find(p=>p.type==='read-aloud');
const recovery={prompt,meta:{id:'layout-only-synthetic',promptId:prompt.id,title:prompt.title,duration:7,createdAt:'2026-10-15T00:00:00.000Z',mime:'audio/webm',note:''},blob:new Blob(['layout-only synthetic data'],{type:'audio/webm'})};
function Fixture(){const [mode,setMode]=useState('');return <><main aria-label="Isolated layout fixture"><h1>Speaking viewport development fixture</h1><button onClick={()=>setMode('ready')}>Open ready fixture</button><button onClick={()=>setMode('unsaved')}>Open unsaved fixture</button><p>No recording or media playback is exercised.</p></main>{mode&&<SpeakingRoom key={mode} prompt={prompt} nativeMode timezone="Asia/Shanghai" recovery={mode==='unsaved'?recovery:undefined} onClose={()=>setMode('')} onSave={async()=>{throw Error('Layout fixture never persists recordings');}} onFinish={()=>{throw Error('Layout fixture never creates study facts');}}/>}</>}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
`;
  await fs.writeFile(path.join(fixture, 'entry.tsx'), entry, {flag: 'wx'});
  await fs.writeFile(path.join(fixture, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${compiledCSS ? '<link rel="stylesheet" href="/__staged-css/' + encodeURIComponent(path.basename(compiledCSS)) + '">' : ''}</head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>`, {flag: 'wx'});
  const [{createServer}, {default: react}, {default: tailwind}] = await Promise.all([
    import(pathToFileURL(req.resolve('vite')).href), import(pathToFileURL(req.resolve('@vitejs/plugin-react')).href), import(pathToFileURL(req.resolve('@tailwindcss/postcss')).href)
  ]);
  const owner = crypto.randomBytes(12).toString('hex');
  const plugin = {name: 'owned-speaking-layout-fixture', configureServer(vite) {
    vite.middlewares.use(async (request, response, next) => {
      response.setHeader('X-Lantern-Layout-Owner', owner);
      if (!compiledCSS || !request.url.startsWith('/__staged-css/')) return next();
      try {
        const relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname.slice('/__staged-css/'.length));
        const root = path.dirname(compiledCSS), file = path.resolve(root, relative);
        assert.ok(file.startsWith(root + path.sep), 'Staged CSS asset path escaped its directory');
        const body = await fs.readFile(file);
        response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream');
        response.end(body);
      } catch (error) {response.statusCode = 404; response.end(String(error.message));}
    });
  }};
  server = await createServer({
    configFile: false, root: fixture, cacheDir: path.join(RUN, 'vite-cache'), publicDir: path.join(SOURCE, 'public'),
    plugins: [plugin, react()], css: {postcss: {plugins: [tailwind()]}}, logLevel: 'warn',
    resolve: {alias: {'@': SOURCE, react: path.dirname(req.resolve('react/package.json')), 'react-dom': path.dirname(req.resolve('react-dom/package.json'))}, dedupe: ['react', 'react-dom']},
    server: {host: '127.0.0.1', port: 0, open: false, fs: {allow: [SOURCE, REPO, RUN]}}
  });
  await server.listen();
  origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  const response = await fetch(origin);
  assert.equal(response.headers.get('x-lantern-layout-owner'), owner);
  assert.equal(response.status, 200);
  report.server = {origin, kind: 'self-owned Vite development server; no build or preview'};
  let executablePath;
  if (!await fs.access(chromium.executablePath()).then(() => true, () => false)) {
    for (const dir of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      const candidate = path.join(dir, 'Google/Chrome/Application/chrome.exe');
      if (await fs.access(candidate).then(() => true, () => false)) {executablePath = candidate; break;}
    }
    assert.ok(executablePath, 'No installed Chromium/Chrome; no downloads permitted');
  }
  browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
  report.browser = {executable: executablePath || chromium.executablePath(), version: await browser.version()};
}
async function fresh(width, height, dpr) {
  if (context) await context.close();
  context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: dpr, locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block'});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {report.blockedExternal.push(url.origin + url.pathname); return route.abort('blockedbyclient');}
    if (url.pathname.startsWith('/api/')) {report.httpErrors.push({unexpectedAPI: url.pathname}); return route.abort('blockedbyclient');}
    return route.continue();
  });
  await context.addInitScript(() => {
    const state = {width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0};
    const viewport = new EventTarget();
    for (const key of Object.keys(state)) Object.defineProperty(viewport, key, {get: () => state[key]});
    Object.defineProperties(viewport, {scale: {get: () => 1}, pageTop: {get: () => state.offsetTop}, pageLeft: {get: () => state.offsetLeft}});
    Object.defineProperty(window, 'visualViewport', {configurable: true, value: viewport});
    window.__setSpeakingViewport = (next, type = 'resize') => {Object.assign(state, next); viewport.dispatchEvent(new Event(type));};
    window.__layoutMicRequests = 0; window.__layoutMediaPlays = 0;
    if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {configurable: true, value: async () => {window.__layoutMicRequests++; throw Error('Microphone prohibited in layout fixture');}});
    HTMLMediaElement.prototype.play = function() {window.__layoutMediaPlays++; return Promise.reject(Error('Playback prohibited in layout fixture'));};
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push(message.text().slice(0, 2000));});
  page.on('response', response => {if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) report.httpErrors.push({url: response.url(), status: response.status()});});
  await page.goto(origin, {waitUntil: 'networkidle'});
  await page.getByRole('button', {name: 'Open ready fixture', exact: true}).waitFor();
}
async function layout(selector) {
  return page.locator(selector).evaluate(element => {
    const rect = value => {const r = value.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom};};
    const css = getComputedStyle(element), viewport = window.visualViewport;
    const scroll = element.querySelector('.speaking-room-scroll');
    return {dialog: rect(element), viewport: {left: viewport.offsetLeft, top: viewport.offsetTop, width: viewport.width, height: viewport.height}, css: {position: css.position, transform: css.transform, translate: css.translate, maxHeight: css.maxHeight, overflowY: css.overflowY, display: css.display}, document: {width: document.documentElement.scrollWidth, viewport: innerWidth}, scroll: scroll && {rect: rect(scroll), height: scroll.clientHeight, content: scroll.scrollHeight, top: scroll.scrollTop, overflowY: getComputedStyle(scroll).overflowY}, toolbar: element.querySelector('.speaking-room-toolbar') && rect(element.querySelector('.speaking-room-toolbar'))};
  });
}
function bounded(rect, viewport, label) {
  const tolerance = 1.5;
  assert.ok(rect.width > 0 && rect.height > 0, label + ' empty ' + JSON.stringify(rect));
  assert.ok(rect.left >= viewport.left - tolerance && rect.top >= viewport.top - tolerance && rect.right <= viewport.left + viewport.width + tolerance && rect.bottom <= viewport.top + viewport.height + tolerance, label + ' outside visual viewport ' + JSON.stringify({rect, viewport}));
}
async function roomBounds() {
  const value = await layout('.speaking-room');
  bounded(value.dialog, value.viewport, 'Speaking dialog');
  bounded(value.toolbar, value.viewport, 'Return toolbar');
  assert.ok(value.scroll.height > 24, 'No usable internal scrolling area: ' + JSON.stringify(value));
  assert.ok(['auto', 'scroll'].includes(value.scroll.overflowY), 'Internal scroll must own overflow');
  assert.ok(value.document.width <= value.document.viewport + 1, 'Document horizontal overflow');
  return value;
}
async function reachable(locator, clipSelector) {
  await locator.scrollIntoViewIfNeeded();
  const result = await locator.evaluate((element, selector) => {
    const r = element.getBoundingClientRect(), v = visualViewport;
    const clip = selector && document.querySelector(selector)?.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
    return {rect: {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height}, viewport: {left: v.offsetLeft, top: v.offsetTop, width: v.width, height: v.height}, clip: clip && {left: clip.left, right: clip.right, top: clip.top, bottom: clip.bottom}, hit: !!hit && (element === hit || element.contains(hit))};
  }, clipSelector);
  bounded(result.rect, result.viewport, 'Action button');
  if (result.clip) assert.ok(result.rect.top >= result.clip.top - 1.5 && result.rect.bottom <= result.clip.bottom + 1.5, 'Action clipped by internal scroll: ' + JSON.stringify(result));
  assert.equal(result.hit, true, 'Action must receive hit testing: ' + JSON.stringify(result));
  return result;
}
async function prepareReachable() {
  const scroll = page.locator('.speaking-room-scroll');
  const before = await scroll.evaluate(element => {element.scrollTop = 0; return {top: element.scrollTop, max: element.scrollHeight - element.clientHeight};});
  if (before.max > 2) {
    await scroll.hover(); await page.mouse.wheel(0, 320);
    await eventually(() => scroll.evaluate(element => element.scrollTop > 0), 'Internal content must respond to wheel scrolling');
  }
  const action = await reachable(page.getByRole('button', {name: '开始准备', exact: true}), '.speaking-room-scroll');
  assert.equal(await page.evaluate(() => window.__layoutMicRequests), 0, 'Layout checks must not request a microphone');
  return {scroll: await layout('.speaking-room'), action};
}
async function setViewport(next, type = 'resize') {
  await page.evaluate(({next, type}) => window.__setSpeakingViewport(next, type), {next, type});
  // Wait for the actual layout rather than assuming a React commit timer.
  await eventually(async () => {try {await roomBounds(); return true;} catch {return false;}}, 'Dialog must fit the changed visualViewport');
}
async function scenario(width, height, dpr) {
  const name = width + 'x' + height + '-dpr' + dpr;
  await step(name + ' ready dialog and internal scrolling', async () => {
    await fresh(width, height, dpr);
    await page.getByRole('button', {name: 'Open ready fixture', exact: true}).click();
    await page.locator('.speaking-room').waitFor();
    await eventually(async () => {try {await roomBounds(); return true;} catch {return false;}}, 'Initial speaking bounds');
    const bounds = await roomBounds(), reachable = await prepareReachable();
    if (width <= 430) assert.ok(bounds.scroll.content > bounds.scroll.height, 'Small-screen case must actually exercise overflow');
    await snapshot(name + '-ready');
    return {bounds, reachable};
  });
  await step(name + ' controlled IME resize and pan', async () => {
    await setViewport({height: 420, offsetTop: 32});
    const resize = {bounds: await roomBounds(), action: await prepareReachable()};
    await snapshot(name + '-controlled-ime');
    await setViewport({offsetTop: 64}, 'scroll');
    const pan = {bounds: await roomBounds(), action: await prepareReachable()};
    await setViewport({height, width, offsetTop: 0, offsetLeft: 0});
    await reachable(page.getByRole('button', {name: '返回口语目录', exact: true}));
    await page.getByRole('button', {name: '返回口语目录', exact: true}).click();
    await page.locator('.speaking-room').waitFor({state: 'detached'});
    return {resize, pan};
  });
  await step(name + ' unsaved confirmation remains reachable', async () => {
    await page.getByRole('button', {name: 'Open unsaved fixture', exact: true}).click();
    await page.locator('.speaking-room').waitFor();
    await eventually(() => page.getByRole('button', {name: '放弃并离开', exact: true}).isVisible(), 'Synthetic unsaved recovery UI');
    await setViewport({height: 420, offsetTop: 32});
    await page.getByRole('button', {name: '返回口语目录', exact: true}).click();
    await page.locator('.speaking-discard').waitFor();
    const discard = await layout('.speaking-discard');
    bounded(discard.dialog, discard.viewport, 'Unsaved discard dialog');
    const stay = page.locator('.speaking-discard').getByRole('button', {name: '留在这里', exact: true});
    await reachable(stay); await stay.click();
    await page.locator('.speaking-discard').waitFor({state: 'detached'});
    assert.equal(await page.locator('.speaking-room').count(), 1, 'Stay must preserve the recovery room');
    await page.getByRole('button', {name: '返回口语目录', exact: true}).click();
    const leave = page.locator('.speaking-discard').getByRole('button', {name: '确认放弃并离开', exact: true});
    const action = await reachable(leave, '.speaking-discard');
    await snapshot(name + '-controlled-ime-discard');
    await leave.click();
    await page.locator('.speaking-room').waitFor({state: 'detached'});
    await page.locator('.speaking-discard').waitFor({state: 'detached'});
    await page.evaluate(({width, height}) => window.__setSpeakingViewport({width, height, offsetTop: 0, offsetLeft: 0}), {width, height});
    await page.getByRole('button', {name: 'Open ready fixture', exact: true}).click();
    await eventually(async () => {try {await roomBounds(); return true;} catch {return false;}}, 'Reopened dialog must not retain old viewport/overlay');
    const reopened = await roomBounds();
    await page.getByRole('button', {name: '返回口语目录', exact: true}).click();
    await page.locator('.speaking-room').waitFor({state: 'detached'});
    const counters = await page.evaluate(() => ({microphone: window.__layoutMicRequests, mediaPlay: window.__layoutMediaPlays}));
    assert.deepEqual(counters, {microphone: 0, mediaPlay: 0});
    return {discard, action, reopened, counters};
  });
}
(async () => {
  let error;
  try {
    await prepare();
    for (const [width, height, dpr] of [[320, 920, 2], [430, 920, 3], [1440, 900, 1]]) await scenario(width, height, dpr);
    assert.deepEqual(report.pageErrors, [], 'Unexpected uncaught browser errors');
    assert.deepEqual(report.httpErrors, [], 'Unexpected local HTTP/API failures');
    report.status = 'passed';
  } catch (caught) {error = caught; report.status = 'failed'; report.error = String(caught.stack || caught);}
  finally {
    try {if (browser) await browser.close();} finally {if (server) await server.close();}
    report.serverStopped = true;
    report.sourceAfter = await sourceManifest();
    report.sourceUnchanged = JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
    if (!report.sourceUnchanged) {report.status = 'failed'; error ||= Error('Runtime source changed during this layout run');}
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(RUN, {recursive: true});
    await fs.writeFile(path.join(RUN, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({status: report.status, report: path.join(RUN, 'report.json'), passed: report.steps.filter(step => step.status === 'passed').length, total: report.steps.length, sourceUnchanged: report.sourceUnchanged}));
  }
  if (error) {console.error(String(error.stack || error)); process.exitCode = 1;}
})();
