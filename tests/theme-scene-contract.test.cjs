'use strict';
// Product scene rendering only; geometry and real image/network behavior are
// verified separately in a browser using the final Shared build.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..'),requireRoot=createRequire(path.join(root,'package.json'));
const React=requireRoot('react'),jsx=requireRoot('react/jsx-runtime'),{renderToStaticMarkup}=requireRoot('react-dom/server');
const slots=['todayHero','todayRest','vocabularyOverview','reviewOverview','progressOverview','practiceOverview','resourceLibrary','wordComplete'];
const themes=['paper','crystal','hollow','silk','whale-bay','whale-moon'];
const loader=createSourceLoader({root,imports:{react:React,'react/jsx-runtime':jsx,'lucide-react':requireRoot('lucide-react')}});
const {ThemeScene,workspaceSceneBackdrop}=loader.load('app/learn/ui-theme.tsx');
const render=(theme,scene)=>renderToStaticMarkup(React.createElement(ThemeScene,{theme,scene}));

test('all eight page scene slots retain a common frame in all six themes',()=>{
 for(const scene of slots)for(const theme of themes){
  const html=render(theme,scene);
  assert.match(html,/<figure\b/,`${theme}/${scene} must have a frame`);
  assert.match(html,/\bv041-theme-scene\b/);assert(html.includes(`data-scene="${scene}"`));
  assert.match(html,/data-scene-status="available"/);
  if(theme==='paper'||theme==='crystal'){
   assert(html.includes(`data-scene-source="neutral-${theme}"`));
   assert(html.includes('v041-neutral-page'));assert(html.includes('v041-neutral-light'));
   assert(!/<img\b/.test(html),'Neutral assets should not invent image URLs');
  }else{
   const src=html.match(/<img\b[^>]*\bsrc="([^"]+)"/);assert(src,`${theme}/${scene} requires real approved artwork`);
   assert(fs.existsSync(path.join(root,'public',decodeURIComponent(src[1]).replace(/^\//,''))),`${theme}/${scene} image missing: ${src[1]}`);
  }
 }
});

test('approved Hollow images remain assigned to their intended pages',()=>{
 assert(render('hollow','todayRest').includes('/design-r1/hollow-lake.webp'));
 assert(render('hollow','vocabularyOverview').includes('/images/maps/greenpath.webp'));
 assert(render('hollow','reviewOverview').includes('/images/maps/white-palace.webp'));
});

test('each whale theme has a distinct approved scene for each of the five learning pages',()=>{
 const pages={vocabulary:'vocabularyOverview',train:'practiceOverview',review:'reviewOverview',progress:'progressOverview',resources:'resourceLibrary'};
 for(const theme of ['whale-bay','whale-moon']){
  const ids=[];
  for(const [nav,slot] of Object.entries(pages)){
   const html=render(theme,slot),id=html.match(/data-scene-source="([^"]+)"/)?.[1];assert(id,`${theme}/${slot} must have a scene`);
   assert(!id.endsWith('-home'),`${theme}/${slot} must not use the complete character art`);
   assert(html.includes(`/images/whale-scenes-20261115/${id}.webp`));
   const backdrop=workspaceSceneBackdrop(theme,nav,false);assert(backdrop);assert.equal(backdrop.id,id,`${theme}/${nav} frame and backdrop must use the same scene`);
   ids.push(id);
  }
  assert.equal(new Set(ids).size,5,`${theme} should not repeat one ordinary scene across learning pages`);
 }
});

test('workspace backgrounds and the same page image windows resolve to one asset for every theme',()=>{
 const pages={today:'todayHero',vocabulary:'vocabularyOverview',train:'practiceOverview',review:'reviewOverview',progress:'progressOverview',resources:'resourceLibrary'};
 for(const theme of themes)for(const [nav,slot] of Object.entries(pages)){
  const html=render(theme,slot),id=html.match(/data-scene-source="([^"]+)"/)[1];
  const backdrop=workspaceSceneBackdrop(theme,nav,false);
  if(theme==='paper'||theme==='crystal'){assert.equal(backdrop,null,`${theme}/${nav} stays neutral`);continue;}
  assert(backdrop,`${theme}/${nav} requires a mapped backdrop`);
  assert.equal(backdrop.id,id,`${theme}/${nav} frame and backdrop must have the same asset identity`);
  const image=html.match(/<img\b[^>]*\bsrc="([^"]+)"/)[1];
  if(theme==='hollow'&&nav==='today'){
   assert(image.endsWith('/design-r1/hollow-home.webp'));
   assert(backdrop.background.includes('/phase2-theme/dirtmouth-hd-1x.webp'),'Today keeps its existing same-scene high-resolution variants');
  }else assert(backdrop.background.includes(image),`${theme}/${nav} backdrop differs from image ${image}`);
  for(const url of [...(backdrop.background+' '+backdrop.mobileBackground).matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g)].map(m=>m[1])){
   assert(fs.existsSync(path.join(root,'public',url.replace(/^\//,''))),`Missing mapped backdrop ${url}`);
  }
 }
});

test('approved image exceptions and the discovery feed remain isolated',()=>{
 const silkPractice=workspaceSceneBackdrop('silk','train'),silkReview=workspaceSceneBackdrop('silk','review');
 assert.equal(silkPractice.id,'crimson-bell-tower');assert(silkPractice.background.includes('/images/lantern-crimson-bell-tower.webp'));
 assert.equal(silkReview.id,'greymoor');assert(silkReview.background.includes('/images/maps/greymoor.webp'));
 assert(silkReview.mobileBackground.includes('/images/maps/greymoor-mobile.webp'));
 assert(workspaceSceneBackdrop('hollow','vocabulary').mobileBackground.includes('/images/maps/greenpath-mobile.webp'));
 assert.equal(workspaceSceneBackdrop('hollow','review').id,'white-palace');
 assert(render('hollow','todayRest').includes('/design-r1/hollow-lake.webp'),'Today rest must keep the approved blue lake');
 const css=fs.readFileSync(path.join(root,'app/v041-app-redesign.css'),'utf8');
 const dark=css.match(/body\[data-ui-theme="hollow"\]\s+\.v040-workspace-shell\[data-v040-view="review"\]\s*\{([^}]+)\}/);
 assert(dark,'Hollow review retains its explicit dark overlay');
 assert.match(dark[1],/--tab-shade:\s*rgba\(6,14,25,\.90\)/);
 assert.match(dark[1],/--tab-shade-mid:\s*rgba\(9,19,32,\.95\)/);
 for(const theme of themes)assert.equal(workspaceSceneBackdrop(theme,'resources',true),null,`${theme} discovery feed has no scene backdrop`);
 const {WorkspaceShell}=loader.load('app/learn/workspace-shell.tsx');
 const html=renderToStaticMarkup(React.createElement(WorkspaceShell,{theme:'hollow',nav:'resources',name:'Synthetic',scope:'Test',syncLabel:'',reviewCount:0,onNavigate(){},onSearch(){},onSync(){},discoveryFeedActive:true},null));
 assert(!html.includes('data-scene-background='));assert(!html.includes('--page-scene:'));
});

test('failed images retry after theme changes and stale errors cannot poison a new attempt',()=>{
 let state,tree;
 const fakeReact={useState(initial){if(state===undefined)state=typeof initial==='function'?initial():initial;return [state,next=>{state=typeof next==='function'?next(state):next;}];}};
 const fakeJsx=(type,props)=>({type,props});
 const actual=createSourceLoader({root,imports:{react:fakeReact,'react/jsx-runtime':{jsx:fakeJsx,jsxs:fakeJsx},'lucide-react':{Check:'icon'}}}).load('app/learn/ui-theme.tsx').ThemeScene;
 const nodes=(node,predicate)=>{const result=[],queue=[node];while(queue.length){const n=queue.shift();if(n==null||typeof n!=='object')continue;if(Array.isArray(n)){queue.push(...n);continue;}if(predicate(n))result.push(n);queue.push(n.props?.children);}return result;};
 const draw=(theme,scene='vocabularyOverview')=>tree=actual({theme,scene});
 const original=draw('hollow'),image=nodes(original,n=>n.type==='img')[0];assert(image);
 const lateError=image.props.onError;lateError();
 const failed=draw('hollow');assert.equal(failed.type,'figure');assert.equal(failed.props['data-scene-status'],'unavailable');
 assert.equal(failed.props.className,original.props.className,'Failure must keep the same frame classes');
 assert.equal(JSON.stringify(failed.props.style),JSON.stringify(original.props.style),'Failure must not alter frame sizing or scene position');
 assert.equal(nodes(failed,n=>n.type==='img').length,0);assert.equal(nodes(failed,n=>n.props?.className==='v041-scene-placeholder').length,1);
 const switched=draw('silk');assert.equal(switched.props['data-scene-status'],'available');assert.equal(nodes(switched,n=>n.type==='img').length,1);
 lateError();assert.equal(draw('silk').props['data-scene-status'],'available','Late A error cannot fail B');
 const retry=draw('hollow'),retryImage=nodes(retry,n=>n.type==='img')[0];assert(retryImage,'Returning to A retries its image');
 assert.equal(retry.props['data-scene-status'],'available');lateError();assert.equal(draw('hollow').props['data-scene-status'],'available','Old A error cannot poison the new A attempt');
 retryImage.props.onError();assert.equal(draw('hollow').props['data-scene-status'],'unavailable','The current A error must still show the placeholder');
 const other=draw('hollow','reviewOverview');assert.equal(other.props['data-scene-status'],'available');assert.equal(nodes(other,n=>n.type==='img').length,1);
});
