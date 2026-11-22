'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..');

function harness({origin='https://lantern.local',pathname='/',frame=false}={}){
  const calls=[];
  const documentListeners=new Map(),windowListeners=new Map();
  const on=(listeners,type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);};
  const off=(listeners,type,fn)=>listeners.get(type)?.delete(fn);
  const emit=(listeners,type,event={})=>{for(const fn of listeners.get(type)||[])fn(event);};
  const document={documentElement:{dataset:{},style:{}},body:{dataset:{},style:{}},visibilityState:'visible',
    addEventListener(type,fn){on(documentListeners,type,fn);},removeEventListener(type,fn){off(documentListeners,type,fn);},querySelectorAll(){return [];}};
  const window={location:{origin,pathname},speechSynthesis:{cancel(){}},LanternThemeHost:{apply(theme){
    calls.push({theme,html:document.documentElement.dataset.uiTheme,body:document.body?.dataset.uiTheme});return 'ACCEPTED';
  }},addEventListener(type,fn){on(windowListeners,type,fn);},removeEventListener(type,fn){off(windowListeners,type,fn);}};
  window.top=frame?{}:window;
  const loader=createSourceLoader({root,globals:{window,document}});
  const host=loader.load('lib/native-host.ts'),native=loader.load('lib/native-theme.ts'),ui=loader.load('lib/ui-theme.ts');
  return {window,document,calls,host,native,ui,emitDocument:(type,event)=>emit(documentListeners,type,event),emitWindow:(type,event)=>emit(windowListeners,type,event)};
}

test('six themes are sent only after both document roots reflect the applied theme',()=>{
  const h=harness();h.host.installHarmonyHost();h.native.installNativeThemeSync();h.window.__LANTERN_HARMONY__.onAppState(true);
  const rows=[['paper','day'],['crystal','night'],['hollow','hollow'],['silk','silk'],['whale-bay','whale-bay'],['whale-moon','whale-moon']];
  for(const [theme,applied] of rows){
    h.ui.applyDocumentTheme(theme);
    assert.deepEqual(h.calls.at(-1),{theme,html:applied,body:applied});
    assert.equal(h.window.__LANTERN_THEME_SYNC__(),true);
    assert.deepEqual(h.calls.at(-1),{theme,html:applied,body:applied});
  }
  assert.equal(h.calls.length,12);
});

test('foreign origins, non-main paths, frames and inaccessible top cannot install or send',()=>{
  for(const options of [{origin:'https://example.com'},{pathname:'/other'},{frame:true}]){
    const h=harness(options);h.native.installNativeThemeSync();h.ui.applyDocumentTheme('hollow');
    assert.equal(h.window.__LANTERN_THEME_SYNC__,undefined);assert.equal(h.calls.length,0);
    assert.equal(h.document.body.dataset.uiTheme,'hollow');
  }
  const h=harness();Object.defineProperty(h.window,'top',{get(){throw Error('cross-origin');}});
  h.native.installNativeThemeSync();h.ui.applyDocumentTheme('paper');
  assert.equal(h.calls.length,0);assert.equal(h.window.__LANTERN_THEME_SYNC__,undefined);
});

test('cold start, bridge readiness and foreground resume resync the current applied theme',()=>{
  const h=harness();h.host.installHarmonyHost();h.native.installNativeThemeSync();
  const native=h.window.LanternThemeHost;delete h.window.LanternThemeHost;
  h.ui.applyDocumentTheme('paper');assert.equal(h.calls.length,0);
  h.window.__LANTERN_HARMONY__.onAppState(true);
  h.window.LanternThemeHost=native;
  assert.equal(h.window.__LANTERN_THEME_SYNC__(),true);assert.equal(h.calls.at(-1).theme,'paper');
  h.window.__LANTERN_HARMONY__.onAppState(false);
  h.ui.applyDocumentTheme('silk');assert.equal(h.calls.length,1);
  assert.equal(h.window.__LANTERN_THEME_SYNC__(),false);
  h.window.__LANTERN_HARMONY__.onAppState(true);
  assert.equal(h.calls.at(-1).theme,'silk');assert.equal(h.window.__LANTERN_THEME_SYNC__(),true);
});

test('missing, inconsistent, hidden, refused and throwing states fail closed without affecting themes',()=>{
  const h=harness();h.host.installHarmonyHost();h.native.installNativeThemeSync();h.window.__LANTERN_HARMONY__.onAppState(true);
  assert.equal(h.window.__LANTERN_THEME_SYNC__(),false);
  h.ui.applyDocumentTheme('paper');h.calls.length=0;
  h.document.body.dataset.uiTheme='night';assert.equal(h.window.__LANTERN_THEME_SYNC__(),false);
  h.document.body.dataset.uiTheme='day';h.document.visibilityState='hidden';assert.equal(h.window.__LANTERN_THEME_SYNC__(),false);
  h.document.visibilityState='visible';h.document.documentElement.dataset.uiTheme='unknown';h.document.body.dataset.uiTheme='unknown';
  assert.equal(h.window.__LANTERN_THEME_SYNC__(),false);assert.equal(h.calls.length,0);
  h.window.LanternThemeHost={apply(){return 'REJECTED';}};h.ui.applyDocumentTheme('crystal');
  assert.equal(h.window.__LANTERN_THEME_SYNC__(),false);assert.equal(h.document.body.dataset.uiTheme,'night');
  h.window.LanternThemeHost={apply(){throw Error('not available');}};h.ui.applyDocumentTheme('whale-bay');
  assert.equal(h.window.__LANTERN_THEME_SYNC__(),false);assert.equal(h.document.body.dataset.uiTheme,'whale-bay');
  h.document.body=null;h.ui.applyDocumentTheme('hollow');assert.equal(h.window.__LANTERN_THEME_SYNC__(),false);
  assert.equal(h.document.documentElement.dataset.uiTheme,'hollow');
});

test('confirmed foreground and actual visibility recover a ready bridge, and unload removes listeners',()=>{
  const h=harness();h.host.installHarmonyHost();h.native.installNativeThemeSync();
  h.ui.applyDocumentTheme('hollow');assert.equal(h.calls.length,0,'Default foreground is not a native lifecycle signal');
  h.document.visibilityState='hidden';h.window.__LANTERN_HARMONY__.onAppState(true);
  assert.equal(h.window.__LANTERN_THEME_SYNC__(),false);assert.equal(h.calls.length,0);
  h.document.visibilityState='visible';h.emitDocument('visibilitychange');
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].theme,'hollow');
  h.emitWindow('pagehide',{persisted:true});h.emitDocument('visibilitychange');assert.equal(h.calls.length,2,'BFCache retains sync');
  h.emitWindow('pagehide',{persisted:false});assert.equal(h.window.__LANTERN_THEME_SYNC__,undefined);
  h.emitDocument('visibilitychange');assert.equal(h.calls.length,2,'Unloaded page cannot resync');
});
