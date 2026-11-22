'use strict';
// Execute the actual ETS logic with an isolated WebView and window fixture.
// This is not an ArkTS compile, a device test, or a claim about system UI.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const ROOT=path.resolve(__dirname,'..');
const DIR='harmony/entry/src/main/ets/theme/';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function settle(){for(let i=0;i<8;i++)await tick();}

function runtime(){
  const modules=new Map(),registered=[],deleted=[],logs=[];
  let frame='https://lantern.local/',url=frame,active=true,failCapture=false,failAttach=false;
  const controller={
    registerJavaScriptProxy(...args){if(failAttach)throw Error('attach');registered.push(args);},
    deleteJavaScriptRegister(name){deleted.push(name);},
    getLastJavascriptProxyCallingFrameUrl(){if(failCapture)throw Error('frame');return frame;},
    getUrl(){return url;}
  };
  const globals={console:{warn(message){logs.push(['warn',message]);},info(message){logs.push(['info',message]);}},Promise,Object,Array,Number,String,Boolean,Math,Error,RegExp,setTimeout,clearTimeout};
  function load(file){
    file=path.resolve(ROOT,file);
    assert.ok(file.startsWith(path.resolve(ROOT,DIR)+path.sep));
    if(modules.has(file))return modules.get(file);
    const out={};modules.set(file,out);
    const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(source,{...globals,exports:out,require(id){if(id.startsWith('@kit/'))return {};if(id.startsWith('.'))return load(path.resolve(path.dirname(file),id+'.ets'));throw Error('unexpected import '+id);}},{filename:file});
    return out;
  }
  const {ThemeWindowController,themeColors,safeBackgroundForStatus}=load(DIR+'ThemeWindow.ets');
  const {NativeThemeHost}=load(DIR+'NativeThemeHost.ets');
  const target=new ThemeWindowController(),host=new NativeThemeHost(controller,()=>active,target);
  return {host,target,themeColors,safeBackgroundForStatus,registered,deleted,logs,setFrame(value){frame=value;},setUrl(value){url=value;},setActive(value){active=value;},failCapture(){failCapture=true;},failAttach(){failAttach=true;}};
}

function fakeWindow({backgroundThrows=false,statusThrows=false,readThrows=false,initialStatus='#FF252626'}={}){
  const writes=[],gates=[];let status=initialStatus;
  return {writes,gates,setBackgroundThrows(value){backgroundThrows=value;},setStatusThrows(value){statusThrows=value;},
    getWindowSystemBarProperties(){if(readThrows)throw Error('read');return {statusBarContentColor:status};},
    setWindowBackgroundColor(color){writes.push(['background',color]);if(backgroundThrows)throw Error('background');},
    setWindowSystemBarProperties(props){writes.push(['status',props.statusBarContentColor,Object.keys(props).join(',')]);if(statusThrows)throw Error('status');const gate=deferred();gates.push(gate);return gate.promise.then(()=>{status=props.statusBarContentColor;});}};
}

function abilityFixture(target){
  const file=path.join(ROOT,'harmony/entry/src/main/ets/entryability/EntryAbility.ets');
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={},values=new Map(),timers=new Map();let sequence=0;
  vm.runInNewContext(source,{exports,Promise,console:{warn(){},error(){}},
    setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
    AppStorage:{setOrCreate(key,value){values.set(key,value);}},
    require(id){
      if(id==='@kit.AbilityKit')return {UIAbility:class{}};
      if(id==='@kit.ArkUI'||id==='@kit.BasicServicesKit')return {};
      if(id==='../theme/ThemeWindow')return {themeWindow:target};
      throw Error('unexpected import '+id);
    }},{filename:file});
  return {ability:new exports.default(),values,timers,runTimer(){const entry=timers.entries().next().value;if(entry){timers.delete(entry[0]);entry[1].fn();}}};
}

test('six native colors match the applied CSS/TypeScript palettes',()=>{
  const r=runtime();
  const tsSource=fs.readFileSync(path.join(ROOT,'lib/ui-theme.ts'),'utf8');
  const js=ts.transpileModule(tsSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};vm.runInNewContext(js,{exports,require(id){if(id==='./native-theme')return {syncAppliedNativeTheme(){}};throw Error('unexpected import '+id);},Object,Array,String});
  for(const [theme,ui] of Object.entries({paper:'day',crystal:'night',hollow:'hollow',silk:'silk','whale-bay':'whale-bay','whale-moon':'whale-moon'})){
    const native=r.themeColors(theme),expected=exports.UI_THEME_PALETTES[ui];
    assert.equal(native.background.toLowerCase(),expected.canvas);
    assert.equal(native.statusContent.toLowerCase(),expected.text);
  }
  for(const value of ['day','night','#ffffff','paper ','PAPER','','https://lantern.local/'])assert.equal(r.themeColors(value),undefined);
});

test('proxy is restricted to the trusted current main document and allowlist',()=>{
  const r=runtime();r.target.setForeground(true);
  assert.equal(r.host.apply('paper'),'REJECTED');assert.equal(r.host.attach(),true);
  assert.equal(r.registered.length,1);assert.equal(r.registered[0][1],'LanternThemeHost');
  assert.equal(JSON.stringify(r.registered[0][2]),JSON.stringify(['apply']));
  const permission=JSON.parse(r.registered[0][4]);
  assert.equal(permission.javascriptProxyPermission.methodList[0].methodName,'apply');
  assert.equal(permission.javascriptProxyPermission.urlPermissionList[0].host,'lantern.local');
  assert.equal(permission.javascriptProxyPermission.urlPermissionList[0].path,'/');
  for(const frame of ['https://evil.invalid/','https://lantern.local/child','https://lantern.local:8443/','http://lantern.local/','https://lantern.local.evil/']){
    r.setFrame(frame);assert.equal(r.host.apply('paper'),'REJECTED',frame);
  }
  r.setFrame('https://lantern.local/');r.setUrl('https://lantern.local/#other');assert.equal(r.host.apply('paper'),'REJECTED');
  r.setUrl('https://lantern.local/');r.setActive(false);assert.equal(r.host.apply('paper'),'REJECTED');
  r.setActive(true);assert.equal(r.host.apply('#ffffff'),'REJECTED');assert.equal(r.host.apply('paper'),'ACCEPTED');
  r.failCapture();assert.equal(r.host.apply('paper'),'REJECTED');
  r.host.dispose();assert.equal(r.host.apply('paper'),'REJECTED');assert.deepEqual(r.deleted,['LanternThemeHost']);
  const failed=runtime();failed.failAttach();assert.equal(failed.host.attach(),false);assert.equal(failed.host.apply('paper'),'REJECTED');
});

test('latest accepted theme waits for a ready window and serializes asynchronous writes',async()=>{
  const r=runtime();r.target.setForeground(true);r.host.attach();
  assert.equal(r.host.apply('paper'),'ACCEPTED');assert.equal(r.host.apply('crystal'),'ACCEPTED');
  const win=fakeWindow();assert.equal(win.writes.length,0);
  r.target.setReadyWindow(win);
  assert.deepEqual(win.writes,[['background','#181A19'],['status','#EDF0EE','statusBarContentColor']]);
  assert.equal(r.host.apply('hollow'),'ACCEPTED');assert.equal(r.host.apply('silk'),'ACCEPTED');
  assert.equal(win.writes.length,2,'No later window call may overtake a pending status operation');
  win.gates[0].resolve();await settle();
  assert.deepEqual(win.writes.slice(2),[['background','#201822'],['status','#F2E9E4','statusBarContentColor']]);
  win.gates[1].resolve();await settle();
});

test('actual ability binds the window only after content is ready and ignores an old stage',async()=>{
  const r=runtime(),{ability,values}=abilityFixture(r.target),firstGate=deferred(),secondGate=deferred();
  const first=fakeWindow(),second=fakeWindow();
  const stage1={loadContent(){return firstGate.promise;},getMainWindowSync(){return first;}};
  const stage2={loadContent(){return secondGate.promise;},getMainWindowSync(){return second;}};
  ability.onCreate({},{});ability.onForeground();assert.equal(values.get('lanternForeground'),true);
  ability.onWindowStageCreate(stage1);assert.equal(r.target.accept('paper'),true);
  await settle();assert.equal(first.writes.length,0,'No window color call before content finishes loading');
  ability.onWindowStageDestroy();ability.onWindowStageCreate(stage2);assert.equal(r.target.accept('silk'),true);
  secondGate.resolve();await settle();
  assert.deepEqual(second.writes,[['background','#201822'],['status','#F2E9E4','statusBarContentColor']]);
  firstGate.resolve();await settle();assert.equal(first.writes.length,0,'A late old stage must not be rebound');
  second.gates[0].resolve();ability.onBackground();assert.equal(values.get('lanternForeground'),false);
  ability.onDestroy();await settle();
});

test('late main-window availability retries safely and background pauses retries',async()=>{
  const r=runtime(),f=abilityFixture(r.target),gate=deferred(),win=fakeWindow();let ready=false;
  const stage={loadContent(){return gate.promise;},getMainWindowSync(){if(!ready)throw Error('not ready');return win;}};
  f.ability.onCreate({},{});f.ability.onForeground();f.ability.onWindowStageCreate(stage);
  assert.equal(r.target.accept('hollow'),true);gate.resolve();await settle();
  assert.equal(f.timers.size,1);assert.equal(win.writes.length,0);
  f.runTimer();assert.equal(f.timers.size,1);assert.equal(win.writes.length,0);
  f.ability.onBackground();assert.equal(f.timers.size,0);
  ready=true;f.ability.onForeground();assert.equal(win.writes.length,0,'Old background request was revoked');
  assert.equal(r.target.accept('silk'),true);
  assert.deepEqual(win.writes,[['background','#201822'],['status','#F2E9E4','statusBarContentColor']]);
  win.gates[0].resolve();f.ability.onWindowStageDestroy();await settle();assert.equal(f.timers.size,0);
});

test('permanently unavailable main window has bounded retries and retries on foreground',async()=>{
  const r=runtime(),f=abilityFixture(r.target),gate=deferred();let attempts=0;
  const stage={loadContent(){return gate.promise;},getMainWindowSync(){attempts++;throw Error('not ready');}};
  f.ability.onCreate({},{});f.ability.onForeground();f.ability.onWindowStageCreate(stage);gate.resolve();await settle();
  for(let i=0;i<19;i++)f.runTimer();
  assert.equal(attempts,20);assert.equal(f.timers.size,0,'No retry timer is leaked after the bounded attempt budget');
  f.ability.onBackground();f.ability.onForeground();assert.equal(attempts,21);assert.equal(f.timers.size,1);
  f.ability.onWindowStageDestroy();assert.equal(f.timers.size,0);
});

test('background, navigation and window replacement do not apply stale queued themes',async()=>{
  const r=runtime(),old=fakeWindow(),next=fakeWindow();r.target.setForeground(true);r.target.setReadyWindow(old);r.host.attach();
  assert.equal(r.host.apply('paper'),'ACCEPTED');assert.equal(r.host.apply('silk'),'ACCEPTED');
  r.host.invalidate();r.target.setForeground(false);old.gates[0].resolve();await settle();assert.equal(old.writes.length,2);
  r.target.setForeground(true);await settle();assert.equal(old.writes.length,2,'Foreground must wait for the current document theme');
  assert.equal(r.host.apply('hollow'),'ACCEPTED');assert.equal(old.writes.length,4);
  r.target.clearWindow();r.target.setReadyWindow(next);assert.equal(r.host.apply('crystal'),'ACCEPTED');
  assert.deepEqual(next.writes,[['background','#181A19'],['status','#EDF0EE','statusBarContentColor']]);
  old.gates[1].resolve();next.gates[0].resolve();await settle();assert.equal(old.writes.length,4);assert.equal(next.writes.length,2);
});

test('unknown initial system text is not guessed and alpha-aware fallback preserves contrast',()=>{
  const r=runtime();
  assert.equal(r.safeBackgroundForStatus('#E5FFFFFF'),'#181A19');
  assert.equal(r.safeBackgroundForStatus('#FF000000'),'#F5F5F5');
  assert.equal(r.safeBackgroundForStatus('#00FFFFFF'),undefined);
  assert.equal(r.safeBackgroundForStatus('not-a-color'),undefined);
  r.target.setForeground(true);r.host.attach();
  const bad=fakeWindow({readThrows:true});r.target.setReadyWindow(bad);
  assert.equal(r.host.apply('paper'),'ACCEPTED');assert.equal(bad.writes.length,0,'Unknown initial system text must leave the system state unchanged');
});

test('first status exception rolls back to a safe background and permits retry',async()=>{
  const r=runtime();r.target.setForeground(true);r.host.attach();
  const win=fakeWindow({statusThrows:true,initialStatus:'#E5FFFFFF'});r.target.setReadyWindow(win);
  assert.equal(r.host.apply('paper'),'ACCEPTED');
  assert.deepEqual(win.writes,[['background','#F5F5F5'],['status','#252626','statusBarContentColor'],['background','#181A19']]);
  win.setStatusThrows(false);assert.equal(r.host.apply('paper'),'ACCEPTED');
  win.gates[0].resolve();await settle();assert.equal(win.writes.at(-1)[0],'status');
});

test('failed status rolls back the last confirmed background; stale failure cannot overwrite a newer theme',async()=>{
  const r=runtime(),win=fakeWindow();r.target.setForeground(true);r.target.setReadyWindow(win);r.host.attach();
  assert.equal(r.host.apply('paper'),'ACCEPTED');win.gates[0].resolve();await settle();
  assert.equal(r.host.apply('crystal'),'ACCEPTED');win.gates[1].reject(Error('synthetic rejection'));await settle();
  assert.deepEqual(win.writes.at(-1),['background','#F5F5F5'],'Rejected status must restore the last confirmed background');
  assert.equal(r.host.apply('silk'),'ACCEPTED');assert.equal(r.host.apply('whale-moon'),'ACCEPTED');
  const previous=win.writes.length;win.gates[2].reject(Error('older request'));await settle();
  assert.deepEqual(win.writes.slice(previous),[['background','#F5F5F5'],['background','#0F1B30'],['status','#EDF3F9','statusBarContentColor']],
    'Restore the safe pair before applying the newer accepted theme');
  win.gates[3].resolve();await settle();
});

test('navigation during a pending failure restores the last safe background without reviving the old theme',async()=>{
  const r=runtime(),win=fakeWindow();r.target.setForeground(true);r.target.setReadyWindow(win);r.host.attach();
  assert.equal(r.host.apply('paper'),'ACCEPTED');win.gates[0].resolve();await settle();
  assert.equal(r.host.apply('crystal'),'ACCEPTED');r.host.invalidate();
  win.gates[1].reject(Error('navigation during status update'));await settle();
  assert.deepEqual(win.writes.at(-1),['background','#F5F5F5']);
  assert.equal(win.writes.length,5,'Invalidated theme must not be retried');
});

test('a pending failed status restores the safe background after backgrounding',async()=>{
  const r=runtime(),win=fakeWindow();r.target.setForeground(true);r.target.setReadyWindow(win);
  assert.equal(r.target.accept('paper'),true);win.gates[0].resolve();await settle();
  assert.equal(r.target.accept('crystal'),true);r.target.setForeground(false);
  win.gates[1].reject({code:801});await settle();
  assert.deepEqual(win.writes.at(-1),['background','#F5F5F5']);
  assert.equal(win.writes.length,5,'Background invalidation must not retry the old theme');
  r.target.setForeground(true);assert.equal(r.target.accept('silk'),true);
  win.gates[2].resolve();await settle();
  assert.deepEqual(win.writes.slice(-2),[['background','#201822'],['status','#F2E9E4','statusBarContentColor']]);
});

test('a failed first theme restores its safe background before a newer read can fail',async()=>{
  const r=runtime(),gate=deferred(),writes=[];let reads=0;
  const win={getWindowSystemBarProperties(){if(++reads===2)throw {code:401};return {statusBarContentColor:'#FF252626'};},
    setWindowBackgroundColor(color){writes.push(['background',color]);},
    setWindowSystemBarProperties(props){writes.push(['status',props.statusBarContentColor]);return gate.promise;}};
  r.target.setForeground(true);r.target.setReadyWindow(win);
  assert.equal(r.target.accept('crystal'),true);assert.equal(r.target.accept('silk'),true);
  gate.reject({code:801});await settle();
  assert.equal(reads,2);
  assert.deepEqual(writes,[['background','#181A19'],['status','#EDF0EE'],['background','#F5F5F5']]);
  assert.ok(r.logs.some(([,message])=>message==='LANTERN theme read failed code=401'));
});

test('a failed status from a retired window cannot change the replacement window',async()=>{
  const r=runtime(),old=fakeWindow(),next=fakeWindow();r.target.setForeground(true);r.target.setReadyWindow(old);
  assert.equal(r.target.accept('crystal'),true);r.target.clearWindow();r.target.setReadyWindow(next);
  assert.equal(r.target.accept('silk'),true);next.gates[0].resolve();await settle();
  old.gates[0].reject({code:801});await settle();
  assert.equal(old.writes.length,2,'Retired window must not receive rollback');
  assert.deepEqual(next.writes,[['background','#201822'],['status','#F2E9E4','statusBarContentColor']]);
});

test('background setter exceptions are caught and do not invoke the status setter',()=>{
  const r=runtime(),win=fakeWindow({backgroundThrows:true});r.target.setForeground(true);r.target.setReadyWindow(win);r.host.attach();
  assert.equal(r.host.apply('paper'),'ACCEPTED');
  assert.deepEqual(win.writes,[['background','#F5F5F5'],['background','#F5F5F5']]);
});

test('window operation diagnostics identify outcomes without exposing exception contents',async()=>{
  const success=runtime(),good=fakeWindow();success.target.setForeground(true);success.target.setReadyWindow(good);
  assert.equal(success.target.accept('paper'),true);good.gates[0].resolve();await settle();
  assert.deepEqual(success.logs,[['info','LANTERN theme read ok'],['info','LANTERN theme background ok'],['info','LANTERN theme status ok']]);

  const read=runtime();read.target.setForeground(true);read.target.setReadyWindow({
    getWindowSystemBarProperties(){throw {code:401,message:'secret identity'};}
  });
  assert.equal(read.target.accept('paper'),true);
  assert.deepEqual(read.logs,[['warn','LANTERN theme read failed code=401'],['warn','LANTERN theme safe fallback unavailable code=unknown']]);

  const failed=runtime();let backgroundCalls=0;const gate=deferred();
  failed.target.setForeground(true);failed.target.setReadyWindow({
    getWindowSystemBarProperties(){return {statusBarContentColor:'#FF252626'};},
    setWindowBackgroundColor(){if(++backgroundCalls===2)throw {code:1300001,message:'secret rollback'};},
    setWindowSystemBarProperties(){return gate.promise;}
  });
  assert.equal(failed.target.accept('crystal'),true);
  gate.reject({code:801,message:'secret status'});await settle();
  assert.deepEqual(failed.logs,[['info','LANTERN theme read ok'],['info','LANTERN theme background ok'],
    ['warn','LANTERN theme status failed code=801'],['warn','LANTERN theme rollback failed code=1300001']]);

  const unknown=runtime();let calls=0;
  unknown.target.setForeground(true);unknown.target.setReadyWindow({
    getWindowSystemBarProperties(){return {statusBarContentColor:'#FF252626'};},
    setWindowBackgroundColor(){if(++calls===1)throw {code:'secret string code',message:'secret background'};}
  });
  assert.equal(unknown.target.accept('paper'),true);
  assert.deepEqual(unknown.logs,[['info','LANTERN theme read ok'],['warn','LANTERN theme background failed code=unknown'],['info','LANTERN theme rollback ok']]);
  assert.doesNotMatch(JSON.stringify([...read.logs,...failed.logs,...unknown.logs]),/secret/);
});

test('integration keeps the safe area and resends only after the native bridge is ready',()=>{
  const ability=fs.readFileSync(path.join(ROOT,'harmony/entry/src/main/ets/entryability/EntryAbility.ets'),'utf8');
  const index=fs.readFileSync(path.join(ROOT,'harmony/entry/src/main/ets/pages/Index.ets'),'utf8');
  assert.match(ability,/loadContent\('pages\/Index'\)\.then\(\(\) => \{[\s\S]{0,200}this\.bindReadyWindow/);
  assert.match(ability,/generation !== this\.stageGeneration/);
  assert.match(ability,/themeWindow\.clearWindow\(\)/);
  assert.match(index,/this\.bridgeReady = true;[\s\S]{0,400}this\.requestThemeSync/);
  assert.match(index,/__LANTERN_THEME_SYNC__/);
  assert.match(index,/this\.themeHost\?\.invalidate\(\)/);
  assert.match(index,/frame-src 'none'; frame-ancestors 'none'/);
  const theme=fs.readFileSync(path.join(ROOT,DIR,'ThemeWindow.ets'),'utf8');
  assert.doesNotMatch(theme,/setWindowLayoutFullScreen|expandSafeArea|navigationBarColor|navigationBarContentColor/);
});
