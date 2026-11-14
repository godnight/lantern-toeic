'use strict';
// Actual theme, backup/sync and useStudy modules; synthetic storage and React
// ports only. No device, network, recording or compiled Shared is exercised.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRequire}=require('node:module');
const root=path.resolve(process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..'));
const req=createRequire(path.join(root,'package.json'));
const React=req('react'),jsx=req('react/jsx-runtime'),{renderToStaticMarkup}=req('react-dom/server');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const {hookHarness,memoryStorage,plain}=require('./helpers/native-scope-runtime.cjs');
const loader=createSourceLoader({root,imports:{react:React,'react/jsx-runtime':jsx,'lucide-react':req('lucide-react')}});
const model=loader.load('lib/study-model.ts'),sync=loader.load('lib/study-sync.ts');
const ui=loader.load('lib/ui-theme.ts'),{ThemeChooser,ThemeScene,ThemeBrandMark}=loader.load('app/learn/ui-theme.tsx');
const whaleThemes=['whale-bay','whale-moon'];
const expectedThemes=['hollow','silk','paper','crystal',...whaleThemes];
const A='usr_aaaaaaaa-1111-4111-8111-111111111111',B='usr_bbbbbbbb-2222-4222-8222-222222222222';
const stamp='2026-01-01T10:00:00.000Z';
const records=()=>({
 ...plain(model.EMPTY_DATA),
 profile:{...plain(model.DEFAULT_PROFILE),name:'Synthetic whale theme learner',onboarded:true},
 attempts:[{id:'11111111-1111-4111-8111-111111111111',qid:'p1-01',choice:0,correct:true,createdAt:stamp,seconds:7,mode:'first'}],
 checkins:[{id:'22222222-2222-4222-8222-222222222222',date:'2026-01-01',minutes:5,load:'轻',note:'Keep saved learning facts',createdAt:stamp}],
});
const hookFactory=runtime=>{const {useStudy}=runtime.load('lib/use-study.ts');return ({owner})=>useStudy(owner,false);};
const ready=value=>value.ready&&value.recordsReadable;
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));

test('six registered themes preserve the old default and offer complete palettes',()=>{
 assert.deepEqual(plain(model.THEME_IDS),expectedThemes);
 assert.equal(model.DEFAULT_PROFILE.theme,'paper');assert.equal(model.DATA_SCHEMA_VERSION,2);
 assert.deepEqual(plain(ui.UI_THEME_ORDER),['paper','crystal','hollow','silk',...whaleThemes]);
 for(const theme of expectedThemes){
  assert(ui.UI_THEME_META[theme]);assert(ui.UI_THEME_BY_PERSISTED[theme]);
  const palette=ui.UI_THEME_PALETTES[ui.UI_THEME_BY_PERSISTED[theme]];
  assert.deepEqual(Object.keys(palette).sort(),['canvas','surface','surfaceMuted','text','textSecondary','primary','onPrimary','selection','divider','controlBorder','focus','success','warning','danger','dangerSoft','warningSoft'].sort());
  assert(Object.values(palette).every(color=>/^#[a-f0-9]{6}$/i.test(color)));
 }
 assert.equal(ui.UI_THEME_META['whale-bay'].name,'咕噜海湾');assert.equal(ui.UI_THEME_META['whale-moon'].name,'澜音星海');
 assert.equal(ui.UI_THEME_META['whale-bay'].colorScheme,'light');assert.equal(ui.UI_THEME_META['whale-moon'].colorScheme,'dark');
});

for(const theme of whaleThemes){
 test(`${theme} survives real saveTheme, hook restart and another owner without changing learning facts`,async()=>{
  const storage=memoryStorage(),saved=records(),key='lantern-v1-'+A;
  storage.setItem(key,JSON.stringify({data:saved}));
  const first=hookHarness(hookFactory,{owner:A},{storage});let reopened,firstDisposed=false;
  try{
   await first.settle(ready);assert.equal(first.value.saveTheme(theme),true);await first.settle(ready);
   assert.equal(first.value.data.profile.theme,theme);
   for(const name of ['attempts','checkins','recordings','questionMarks','resourceTasks'])assert.deepEqual(plain(first.value.data[name]),saved[name]);
   const stale=first.value,bytesA=storage.getItem(key);
   first.render({owner:B});await first.settle(ready);
   assert.equal(first.value.data.profile.theme,'paper');assert.equal(first.value.data.attempts.length,0);
   assert.equal(stale.saveTheme(theme==='whale-bay'?'whale-moon':'whale-bay'),false,'A callback cannot write after switching to B');
   assert.equal(storage.getItem(key),bytesA);
   assert.equal(first.value.saveTheme('silk'),true);await first.settle(ready);
   first.render({owner:A});await first.settle(ready);assert.equal(first.value.data.profile.theme,theme);
   assert.equal(first.calls.length,0,'Native theme changes stay local with remote transport disabled');
   first.dispose();firstDisposed=true;
   reopened=hookHarness(hookFactory,{owner:A},{storage});await reopened.settle(ready);
   assert.equal(reopened.value.data.profile.theme,theme);
   for(const name of ['attempts','checkins','recordings','questionMarks','resourceTasks'])assert.deepEqual(plain(reopened.value.data[name]),saved[name]);
   reopened.render({owner:B});await reopened.settle(ready);assert.equal(reopened.value.data.profile.theme,'silk');assert.equal(reopened.value.data.attempts.length,0);
   assert.equal(reopened.calls.length,0);
  }finally{if(!firstDisposed)first.dispose();reopened?.dispose();}
 });

 test(`${theme} is accepted by legacy and paginated sync without weakening owner or unknown-theme checks`,()=>{
  const saved=records();saved.profile.theme=theme;
  const legacy={...saved,owner:A,hasProfile:true};
  assert.equal(sync.parseLegacyStudySync(legacy,A).profile.theme,theme);
  const page={syncProtocol:'pages-v1',schemaVersion:2,owner:A,hasProfile:true,changes:[{revision:1,kind:'profile',id:A,data:saved.profile}],nextCursor:null,checkpoint:{version:1,owner:A,epoch:'a'.repeat(32),revision:1}};
  assert.equal(sync.parseStudySyncPage(page,A).changes[0].data.theme,theme);
  assert.equal(sync.applyStudySyncPage(records(),page).profile.theme,theme);
  assert.throws(()=>sync.parseLegacyStudySync(legacy,B));assert.throws(()=>sync.parseStudySyncPage(page,B));
  for(const invalid of ['whale-other','blue-lake','',null,42]){
   assert.throws(()=>sync.parseLegacyStudySync({...legacy,profile:{...saved.profile,theme:invalid}},A));
   assert.throws(()=>sync.parseStudySyncPage({...page,changes:[{...page.changes[0],data:{...saved.profile,theme:invalid}}]},A));
  }
 });
}

test('theme chooser exposes six concise choices, selected state and approved whale home previews',()=>{
 const html=render(ThemeChooser,{theme:'whale-bay',onChange(){}});
 assert.equal((html.match(/<button\b/g)||[]).length,6);assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
 for(const theme of expectedThemes)assert(html.includes(`data-theme-choice="${theme}"`));
 for(const theme of whaleThemes){
  assert(html.includes(`/images/whale-themes/${theme}-home.webp`));
  assert(html.includes(`aria-label="${ui.UI_THEME_META[theme].name}${theme==='whale-bay'?'，正在使用':''}"`));
 }
 assert.equal((html.match(/object-position:72% 48%/g)||[]).length,2);
 assert(!/<p(?:\s|>)/.test(html));assert(!/聊天|奖励|已完成学习/.test(html));
});

const slots=['todayHero','todayRest','vocabularyOverview','reviewOverview','progressOverview','practiceOverview','resourceLibrary','wordComplete'];
const pageScenes={
 'whale-bay':{vocabularyOverview:'bay-word-lighthouse',practiceOverview:'bay-practice-dawn-pier',reviewOverview:'bay-review-tide-garden',progressOverview:'bay-progress-cliff',resourceLibrary:'bay-resource-bookshop'},
 'whale-moon':{vocabularyOverview:'moon-word-gallery',practiceOverview:'moon-practice-reef',reviewOverview:'moon-review-moonlit-cove',progressOverview:'moon-progress-star-observatory',resourceLibrary:'moon-resource-bookshop'},
};
for(const theme of whaleThemes){
 test(`${theme} uses approved page-specific scenes and the complete character only for rest and word completion`,()=>{
  for(const scene of slots){
   const html=render(ThemeScene,{theme,scene});
   const character=scene==='todayRest'||scene==='wordComplete';
   assert(html.includes(`data-scene="${scene}"`));
   const expected=character?`${theme}-home`:scene==='todayHero'?`${theme}-study`:pageScenes[theme][scene];
   const directory=character||scene==='todayHero'?'whale-themes':'whale-scenes-20261115';
   assert(html.includes(`data-scene-source="${expected}"`),`${theme}/${scene} must use its approved scene`);
   assert(html.includes(`/images/${directory}/${expected}.webp`));
   assert.equal(html.includes(`/images/whale-themes/${theme}-home.webp`),character,`${scene} must not repeat the character`);
   assert(html.includes('width="1672"'));assert(html.includes('height="941"'));
  }
 });
}

test('the retained blue-lake full scene and brand asset remain available',()=>{
 const lake=render(ThemeScene,{theme:'hollow',scene:'blue-lake'});
 assert(lake.includes('/design-r1/hollow-lake.webp'));assert(lake.includes('data-scene=\"todayRest\"'));
 const brand=render(ThemeBrandMark,{size:40});assert(brand.includes('/phase2-theme/knight-icon-96.png'));
 assert(brand.includes('/phase2-theme/knight-icon-48.png'));assert(brand.includes('/phase2-theme/knight-icon-256.png'));
});
