// Contract probes for UI integration. Real hook/model/theme modules execute against
// private in-memory fixtures; this does not alter learner storage or add a hook signal.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const tick = () => new Promise(resolve => setImmediate(resolve));
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports,require(name){assert.ok(name in imports, 'Unexpected import: '+name);return imports[name];},Date,Map,Set,structuredClone,crypto:webcrypto,Blob,URL,AbortController,...globals}, {filename:file});
  return exports;
}
const model = load('lib/study-model.ts');
const backup = load('lib/study-backup.ts', {'./study-model':model,zod:require(path.join(root,'node_modules/zod'))});

function hookHarness(storage = new Map(), {online = false} = {}) {
  let slots = [], cursor = 0, effects = [], owner = 'alice';
  const errors = [], writes = [], listeners = new Map();
  const same = (a,b) => a && b && a.length===b.length && a.every((v,i)=>Object.is(v,b[i]));
  const react = {
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},
    useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useCallback(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn,deps};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}
  };
  const localStorage = {get length(){return storage.size;},key:i=>[...storage.keys()][i]??null,getItem:key=>storage.get(key)??null,setItem(key,value){writes.push(key);storage.set(key,String(value));},removeItem:key=>storage.delete(key)};
  const hook = load('lib/use-study.ts', {react,sonner:{toast:{error:message=>errors.push(message)}},'./study-model':model,'./study-backup':backup}, {
    localStorage,navigator:{onLine:online},window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},
    setTimeout:()=>1,clearTimeout(){},fetch:async()=>({ok:true,json:async()=>({...structuredClone(model.EMPTY_DATA),owner,hasProfile:true})})
  });
  const render = (nextOwner=owner) => {owner=nextOwner;cursor=0;const value=hook.useStudy(owner);const batch=effects;effects=[];batch.forEach(fn=>fn());return value;};
  return {render,storage,writes,errors,unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
const issue = {id:'rejected-fixture',kind:'op',status:'blocked',attempts:3,nextRetryAt:0,reason:'Fixture upload rejected'};


function shellProjection(fixtureApi) {
// Read-only integration probe of the actual StudyApp. No browser/storage/API I/O.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const observedFiles={};
function load(file,imports={},globals={}) {
 const source=fs.readFileSync(path.join(root,file),'utf8');observedFiles[file]=crypto.createHash('sha256').update(source).digest('hex');
 const exports={},code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{if(!(name in imports))throw Error(name);return imports[name];},Date,Intl,Set,Map,URLSearchParams,Blob,URL,...globals});return exports;
}
const model=load('lib/study-model.ts'),data=structuredClone(model.EMPTY_DATA);
const jsx=(type,props)=>({type,props}),proxy=new Proxy({},{get:(_,key)=>String(key)});
let slots=[],cursor=0,effects=[],frame=[],navigation=[],tree,nativeBack;
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
const hooks={useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||!same(old.deps,deps))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});}};
const listeners=new Map(),scrolls=[];let focused=null,controls=[];
class Element {
 constructor({tag='BUTTON',label='来源按钮',text='来源控件',identity='source'}={}){this.tagName=tag;this.label=label;this.textContent=text;this.identity=identity;this.isConnected=true;this.focusCount=0;}
 getAttribute(name){return name==='aria-label'?this.label:null;}
 focus(){this.focusCount++;focused=this;document.activeElement=this;}
}
const focus=new Element(),lookup=new Element({tag:'INPUT',label:'搜索单词或中文释义',text:'',identity:'lookup'});controls=[focus];
const document={activeElement:focus,querySelectorAll:()=>controls,querySelector:()=>shell()?.props.nav==='search'?lookup:null};
const window={location:{search:''},scrollY:0,scrollTo(x,y){this.scrollY=typeof x==='object'?x.top:y;scrolls.push(this.scrollY);},
 addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);},
 history:{entries:[{}],index:0,scrollRestoration:'auto',get state(){return this.entries[this.index];},
 pushState(value){this.entries.splice(this.index+1);this.entries.push(structuredClone(value));this.index++;},replaceState(value){this.entries[this.index]=structuredClone(value);},
 back(){navigation.push(()=>{if(!this.index)return;this.index--;for(const fn of [...listeners.get('popstate')||[]])fn({state:this.state});if(this.scrollRestoration==='auto')window.scrollTo(0,0);});}}
};
const appliedThemes=[];
const imports={react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':proxy,
 '@/lib/study-model':model,'@/lib/use-study':{useStudy:()=>fixtureApi},
 '@/lib/study-backup':{},'@/lib/speaking-recovery':load('lib/speaking-recovery.ts'),'@/lib/native-host':{registerNativeBack:fn=>{nativeBack=fn;return()=>{if(nativeBack===fn)nativeBack=null;};}},'@/lib/ui-theme':{applyDocumentTheme(theme){appliedThemes.push(theme);},UI_THEME_META:{paper:{name:'日间'},crystal:{name:'夜间'},hollow:{name:'空洞骑士'},silk:{name:'丝之歌'}}},
 sonner:{toast:{message(){},success(){},error(){}}},'./learn/workspace-shell':{WorkspaceShell:'WorkspaceShell',WorkspaceHeading:'WorkspaceHeading',BackToWorkspace:'BackToWorkspace'},
 './learn/ui-theme':{ThemeChooser:'ThemeChooser'},'./learn/vocabulary-library':{default:'VocabularyLibrary',VocabularyEntry:'VocabularyEntry',VocabularyReviewSummary:'VocabularyReviewSummary'},
 './learn/speaking':{default:'SpeakingRoom',SpeakingTaskCatalog:'SpeakingTaskCatalog',SpeakingRecordingHistory:'SpeakingRecordingHistory'}};
for(const file of ['dialog','tabs','select','radio-group','progress','sonner'])imports['@/components/ui/'+file]=proxy;
for(const file of ['resource-library','exam-collection','mock-exam','practice'])imports['./learn/'+file]={default:file};
for(const file of ['questions','speaking'])imports['@/content/'+file+'.json']={default:JSON.parse(fs.readFileSync(path.join(root,'content',file+'.json'),'utf8'))};
imports['@/release-manifest.json']={default:JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8'))};
Object.assign(imports,require('./helpers/phase2-shell-fixture.cjs').workflowShellFixture(hooks,load('lib/practice-selection.ts',{'./study-model':model})));
imports['@/public/build-identity.json']={default:JSON.parse(fs.readFileSync(path.join(root,'public/build-identity.json'),'utf8'))};
imports['@/lib/account-boundary']=load('lib/account-boundary.ts');
 imports['@/lib/lesson-audio']={stopLessonAudio(){}};
 imports['./learn/account-center']={FirstVisit:'FirstVisit',AccountCenter:'AccountCenter',SaveAndSync:'SaveAndSync',AboutProject:'AboutProject'};
 const app=load('app/study-app.tsx',imports,{window,document,HTMLElement:Element,navigator:{},requestAnimationFrame:fn=>frame.push(fn),setInterval:()=>1,clearInterval(){}}).StudyWorkspace;
function render(){for(let i=0;i<3;i++){cursor=0;effects=[];tree=app({owner:null,nativeMode:true});effects.forEach(fn=>fn());}const current=frame;frame=[];current.forEach(fn=>fn());return tree;}
function nodes(node){if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(nodes);return[node,...nodes(node.props?.children)];}
function shell(){return nodes(tree).find(node=>node.type==='WorkspaceShell');}
function settle(){let count=0;while(navigation.length){assert.ok(++count<20);navigation.shift()();render();}render();}
function key(values={}){let prevented=false;const event={key:'k',ctrlKey:true,metaKey:false,isComposing:false,keyCode:0,preventDefault(){prevented=true;},...values};for(const fn of [...listeners.get('keydown')||[]])fn(event);render();return prevented;}

const actualShell=load('app/learn/workspace-shell.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':proxy,'./ui-theme':{ThemeMotif:'ThemeMotif'}}).WorkspaceShell;
cursor=0;effects=[];tree=app({owner:'bob',nativeMode:false});effects.forEach(fn=>fn());
const props=shell().props,output=actualShell(props);
const nameNode=nodes(output).find(n=>n.type==='div'&&n.props?.className==='workspace-identity');
const identityText=nodes(nameNode).flatMap(n=>Array.isArray(n.props?.children)?n.props.children:[n.props?.children]).filter(x=>typeof x==='string').join(' ');
const reviewBadge=nodes(output).some(n=>n.type==='small'&&n.props?.children===1);
slots.forEach(slot=>slot?.cleanup?.());
return {props,identityText,reviewBadge,appliedTheme:appliedThemes.at(-1)};
}

test('C09: real owner-switch pre-effect snapshot cannot project prior nickname, review badge or document theme',()=>{
  const alice=structuredClone(model.EMPTY_DATA);alice.profile={...alice.profile,name:'PRIVATE Alice Owner A',theme:'silk'};
  alice.attempts=[{id:'private-owner-attempt',qid:'owner-wrong-question',choice:0,correct:false,createdAt:'2026-10-12T00:00:00.000Z',seconds:12,mode:'first'}];
  const storage=new Map([['lantern-v1-alice',JSON.stringify({data:alice})],['lantern-v1-bob:required-schema',JSON.stringify({schemaVersion:999})]]);
  const original=storage.get('lantern-v1-alice'),h=hookHarness(storage);h.render('alice');const readable=h.render('alice');
  const normal=shellProjection(readable);assert.equal(normal.props.name,'PRIVATE Alice Owner A');assert.equal(normal.props.reviewCount,1);assert.equal(normal.reviewBadge,true);assert.equal(normal.appliedTheme,'silk');
  const switching=h.render('bob');assert.equal(switching.ready,true);assert.equal(switching.recordsReadable,false);assert.equal(switching.data.profile.name,'PRIVATE Alice Owner A','Fixture must reproduce the actual retained snapshot before owner effect');
  const blocked=shellProjection(switching);assert.equal(blocked.props.name,'记录暂不可读');assert.doesNotMatch(blocked.identityText,/PRIVATE Alice/);assert.equal(blocked.reviewBadge,false);assert.equal(blocked.props.reviewCount,0);assert.equal(blocked.appliedTheme,'paper');
  const failed=h.render('bob');assert.equal(failed.sync,'blocked');assert.equal(failed.recordsReadable,false);assert.equal(failed.data.attempts.length,0);
  const failure=shellProjection(failed);assert.equal(failure.props.name,'记录暂不可读');assert.equal(failure.reviewBadge,false);assert.equal(failure.appliedTheme,'paper');
  assert.equal(h.writes.length,0);assert.equal(storage.get('lantern-v1-alice'),original);h.unmount();
});

test('C09: loading shell with stale data uses neutral identity and hides review badge before effects',()=>{
  const original=structuredClone(model.EMPTY_DATA);original.profile={...original.profile,name:'PRIVATE Loading Previous Owner',theme:'hollow'};
  original.attempts=[{id:'stale-review',qid:'previous-question',choice:0,correct:false,createdAt:'2026-10-12T00:00:00.000Z',seconds:12,mode:'first'}];
  const shell=shellProjection({data:original,ready:false,recordsReadable:false,sync:'loading',issues:[],syncNow(){}});
  assert.equal(shell.props.name,'正在读取记录');assert.doesNotMatch(shell.identityText,/PRIVATE Loading/);assert.equal(shell.props.reviewCount,0);assert.equal(shell.reviewBadge,false);assert.equal(shell.appliedTheme,'paper');
  assert.equal(original.profile.name,'PRIVATE Loading Previous Owner');assert.equal(original.profile.theme,'hollow');assert.equal(original.attempts.length,1,'Projection must not clear stored records');
});
