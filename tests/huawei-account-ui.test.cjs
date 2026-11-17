const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const source=ts.transpileModule(fs.readFileSync(path.join(root,'mobile/src/NativeAccountRoot.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const A={id:'usr_aaaaaaaa-1111-4111-8111-111111111111',username:'synthetic_a'};
const ready=user=>({status:'ready',user,capabilities:{passwordLogin:true,phoneLogin:false},unavailable:false,message:'',access:{owner:user?.id??null,epoch:1,canAccess:()=>true,assertAccess:()=>true}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
test('workspace resume hints accept only same-owner whitelisted pages and bounded values',()=>{
 const {nativeWorkspaceResume,resumeForOwner}=require('./helpers/actual-source-loader.cjs').createSourceLoader({root}).load('lib/native-workspace-resume.ts');
 const snapshot=nativeWorkspaceResume(A.id,'train',240,'session-1',false);assert(snapshot);assert(resumeForOwner(snapshot,A.id));
 assert.equal(resumeForOwner(snapshot,'usr_bbbbbbbb-2222-4222-8222-222222222222'),null);
 assert.equal(nativeWorkspaceResume(A.id,'account',0,null,false),null);assert.equal(nativeWorkspaceResume(A.id,'train',-1,null,false),null);
 assert.equal(nativeWorkspaceResume(A.id,'train',0,'../bad',false),null);assert.equal(nativeWorkspaceResume(A.id,'train',0,null,true),null);
});
test('previous vocabulary hint requires the same active session and a saved immediate predecessor',()=>{
 const {nativeWorkspaceResume,resumeForOwner,validVocabularyPrevious}=require('./helpers/actual-source-loader.cjs').createSourceLoader({root}).load('lib/native-workspace-resume.ts');
 const hint={sessionId:'vocab:one',stepId:'step:one'},session={id:'vocab:one',status:'active',cursor:1,queue:[{id:'step:one',receipt:{commandId:'saved'}},{id:'step:two'}]};
 const snapshot=nativeWorkspaceResume(A.id,'vocabulary',40,null,false,hint);assert(snapshot);assert.equal(resumeForOwner(snapshot,'usr_bbbbbbbb-2222-4222-8222-222222222222'),null);assert(validVocabularyPrevious(hint,session));
 assert.equal(nativeWorkspaceResume(A.id,'train',0,null,false,hint),null);assert.equal(nativeWorkspaceResume(A.id,'vocabulary',0,null,false,{...hint,stepId:'../bad'}),null);
 for(const bad of [{...session,id:'vocab:other'},{...session,status:'completed'},{...session,cursor:0},{...session,cursor:2},{...session,queue:[{id:'step:one'}]},{...session,queue:[{id:'step:one',receipt:{},correctionPending:true}]}])assert.equal(validVocabularyPrevious(hint,bad),false);
});

// Runs the actual root component with controlled React scheduling and external
// controller/lifecycle ports. No authentication or SDK result is fabricated in
// the product; these tests exercise only the UI's use of verified outcomes.
function harness(initial=ready(null),memoryResume=false){
 let cursor=0,instance,nativeListener,output;
 const cells=[],effects=[],windowEvents=new Map(),documentEvents=new Map(),calls=[],providers=deferred();
 const bind=map=>({addEventListener:(name,fn)=>{const set=map.get(name)??new Set();set.add(fn);map.set(name,set);},removeEventListener:(name,fn)=>map.get(name)?.delete(fn)});
 const target={...bind(windowEvents)},document={...bind(documentEvents),visibilityState:'visible',documentElement:{dataset:{uiTheme:'paper'}}};
 class Controller{
  constructor(){instance=this;this.state=initial;this.listeners=new Set();this.pending=deferred();}
  getSnapshot=()=>this.state;
  subscribe=fn=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};
  emit(state){this.state=state;for(const listener of this.listeners)listener(state,true);}
  start(){calls.push('start');this.emit(this.state);}
  getProviders(){calls.push('providers');return providers.promise;}
  mutateHuawei(purpose){calls.push(purpose);return this.pending.promise;}
  suspend(...args){calls.push(['suspend',...args]);}
  resume(){calls.push('resume');}
  dispose(){calls.push('dispose');}
 }
 const StudyApp=()=>null,AccountPanel=()=>null;
 const React={useState(initial){const index=cursor++;if(!cells[index])cells[index]={value:initial};return [cells[index].value,value=>{cells[index].value=typeof value==='function'?value(cells[index].value):value;}];},useRef(initial){const index=cursor++;if(!cells[index])cells[index]={current:initial};return cells[index];},useEffect(fn,deps){const index=cursor++,old=cells[index];if(!old||deps.some((dep,i)=>!Object.is(dep,old.deps[i])))effects.push(()=>{old?.cleanup?.();cells[index]={deps,cleanup:fn()};});}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const actualResume=require('./helpers/actual-source-loader.cjs').createSourceLoader({root}).load('lib/native-workspace-resume.ts');
 const imports={react:React,'react/jsx-runtime':jsx,'react-dom':{flushSync:fn=>fn()},'@/app/study-app':{default:StudyApp},'@/app/account/account-panel':{AccountPanel},'@/app/learn/guest-data-recovery':{GuestDataRecovery:()=>null},'@/lib/native-host':{subscribeNativeState:fn=>{nativeListener=fn;return()=>{nativeListener=null;};},registerNativeBack:()=>()=>{}},'@/lib/native-auth-transport':{createNativeAuthTransport:()=>({}),nativePhoneClient:()=>({})},'@/lib/native-account-controller':{INITIAL_NATIVE_ACCOUNT_STATE:{status:'checking',message:''},NativeAccountController:Controller},'@/lib/ui-theme':{applyDocumentTheme(){}},'@/lib/cloud-sync/native-account-root':{attachNativeAccountSync:()=>()=>{}},'@/lib/native-workspace-resume':actualResume};
 const exports={};const uiSource=memoryResume?source.replace('const MEMORY_RESUME_ENABLED = false;','const MEMORY_RESUME_ENABLED = true;'):source;
 if(memoryResume)assert.notEqual(uiSource,source,'test must enable the isolated UI candidate');
 vm.runInNewContext(uiSource,{exports,require:name=>{assert(Object.hasOwn(imports,name),'Unexpected UI dependency '+name);return imports[name];},window:target,document},{filename:'mobile/src/NativeAccountRoot.tsx'});
 const render=()=>{cursor=0;output=exports.default();while(effects.length)effects.shift()();return output;};
 const fire=(map,name)=>{for(const listener of map.get(name)??[])listener();};
 render();render();
 return {render,providers,calls,StudyApp,AccountPanel,get controller(){return instance;},hide(){document.visibilityState='hidden';fire(documentEvents,'visibilitychange');},pagehide(){fire(windowEvents,'pagehide');},native(active){nativeListener(active);},unmount(){for(const cell of cells)cell?.cleanup?.();},panel(){const tree=render();assert.equal(tree.type,AccountPanel);return tree.props;}};
}

test('native resume hint is kept only through background and only for its verified owner',()=>{
 const h=harness(ready(A),true);try{
  const first=h.render();assert.equal(first.type,h.StudyApp);first.props.onResumeSnapshot({owner:A.id,nav:'train',scroll:240,practiceSessionId:'session-1'});
  h.native(false);h.controller.emit({status:'blocked',message:'background'});h.native(true);h.controller.emit(ready(A));
  let view=h.render();assert.equal(view.props.resumeSnapshot.nav,'train');assert.equal(view.props.resumeSnapshot.practiceSessionId,'session-1');
  h.controller.emit({status:'blocked',message:'foreground account failure'});h.controller.emit(ready(A));view=h.render();assert.equal(view.props.resumeSnapshot,null);
  view.props.onResumeSnapshot({owner:A.id,nav:'train',scroll:10,practiceSessionId:null});
  h.controller.emit(ready({id:'usr_bbbbbbbb-2222-4222-8222-222222222222',username:'synthetic_b'}));view=h.render();assert.equal(view.props.resumeSnapshot,null);
 }finally{h.unmount();}
});

test('native UI discovers providers once and only publishes successful discovery',async()=>{
 const h=harness();try{
  assert.equal(h.panel().huawei.login,false);assert.equal(h.panel().huawei.binding,false);
  h.providers.resolve({huaweiLogin:true,huaweiBinding:true});await tick();
  assert.equal(h.panel().huawei.login,true);assert.equal(h.panel().huawei.binding,true);
  h.native(false);h.native(true);h.render();assert.equal(h.calls.filter(call=>call==='providers').length,1);
 }finally{h.unmount();}
 const failed=harness();try{failed.providers.reject(new Error('Unavailable'));await tick();assert.equal(failed.panel().huawei.login,false);}finally{failed.unmount();}
});

test('Huawei login enters learning only after successful verified controller outcome',async()=>{
 for(const success of [true,false]){
  const h=harness();try{
   h.panel().huawei.onLogin();assert.equal(h.render().type,h.AccountPanel);
   h.controller.emit(ready(A));assert.equal(h.render().type,h.AccountPanel,'A live snapshot alone cannot finish an in-flight UI action');
   h.controller.pending.resolve(success);await tick();assert.equal(h.render().type,success?h.StudyApp:h.AccountPanel);
  }finally{h.unmount();}
 }
 const noIdentity=harness();try{noIdentity.panel().huawei.onLogin();noIdentity.controller.pending.resolve(true);await tick();assert.equal(noIdentity.render().type,noIdentity.AccountPanel);}finally{noIdentity.unmount();}
});

test('binding remains in account management and retains an explicit return to the same owner',async()=>{
 const h=harness(ready(A));try{
  h.render().props.onAccount();const panel=h.panel();assert.equal(typeof panel.onBack,'function');
  panel.huawei.onBind();h.controller.emit(ready(A));h.controller.pending.resolve(true);await tick();
  const bound=h.panel();assert.equal(typeof bound.onBack,'function');bound.onBack();assert.equal(h.render().type,h.StudyApp);
 }finally{h.unmount();}
});

test('native and visibility suspension preserve SDK interaction while page departure invalidates it',()=>{
 const h=harness();try{
  h.hide();h.native(false);h.pagehide();
  assert.deepEqual(h.calls.filter(Array.isArray),[['suspend',true,true],['suspend',true,true],['suspend',true,false]]);
 }finally{h.unmount();}
 assert(h.calls.includes('dispose'));
});
