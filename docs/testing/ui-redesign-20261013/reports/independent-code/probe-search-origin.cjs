// Read-only integration probe of the actual StudyApp. No browser/storage/API I/O.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..','..','theme-redesign-20261012','site');
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
const imports={react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':proxy,
 '@/lib/study-model':model,'@/lib/use-study':{useStudy:()=>({data,ready:true,recordsReadable:true,sync:'local',issues:[],syncNow(){},retryIssue(){},saveProfile(){},saveTheme(){},addAttempt(){},addCheckin(){},addRecording(){},recordingUrl(){}})},
 '@/lib/study-backup':{},'@/lib/native-host':{registerNativeBack:fn=>{nativeBack=fn;return()=>{if(nativeBack===fn)nativeBack=null;};}},'@/lib/ui-theme':{applyDocumentTheme(){},UI_THEME_META:{paper:{name:'日间'}}},
 sonner:{toast:{message(){},success(){},error(){}}},'./learn/workspace-shell':{WorkspaceShell:'WorkspaceShell',WorkspaceHeading:'WorkspaceHeading',BackToWorkspace:'BackToWorkspace'},
 './learn/ui-theme':{ThemeChooser:'ThemeChooser'},'./learn/vocabulary-library':{default:'VocabularyLibrary',VocabularyEntry:'VocabularyEntry',VocabularyReviewSummary:'VocabularyReviewSummary'},
 './learn/speaking':{default:'SpeakingRoom',SpeakingTaskCatalog:'SpeakingTaskCatalog',SpeakingRecordingHistory:'SpeakingRecordingHistory'}};
for(const file of ['dialog','tabs','select','radio-group','progress','sonner'])imports['@/components/ui/'+file]=proxy;
for(const file of ['resource-library','exam-collection','mock-exam','practice'])imports['./learn/'+file]={default:file};
for(const file of ['questions','speaking'])imports['@/content/'+file+'.json']={default:JSON.parse(fs.readFileSync(path.join(root,'content',file+'.json'),'utf8'))};
imports['@/release-manifest.json']={default:JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8'))};
const app=load('app/study-app.tsx',imports,{window,document,HTMLElement:Element,navigator:{},requestAnimationFrame:fn=>frame.push(fn),setInterval:()=>1,clearInterval(){}}).default;
function render(){for(let i=0;i<3;i++){cursor=0;effects=[];tree=app({owner:null,nativeMode:true});effects.forEach(fn=>fn());}const current=frame;frame=[];current.forEach(fn=>fn());return tree;}
function nodes(node){if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(nodes);return[node,...nodes(node.props?.children)];}
function shell(){return nodes(tree).find(node=>node.type==='WorkspaceShell');}
function settle(){let count=0;while(navigation.length){assert.ok(++count<20);navigation.shift()();render();}render();}
function key(values={}){let prevented=false;const event={key:'k',ctrlKey:true,metaKey:false,isComposing:false,keyCode:0,preventDefault(){prevented=true;},...values};for(const fn of [...listeners.get('keydown')||[]])fn(event);render();return prevented;}
render();assert.equal(window.history.scrollRestoration,'manual');shell().props.onNavigate('resources');render();window.scrollY=420;
shell().props.onSearch();render();const stackAfterOpen=window.history.entries.map(x=>x.lanternWorkspaceView||'initial');window.history.back();settle();
const browser={nav:shell().props.nav,scroll:window.scrollY,focusCalls:focus.focusCount,stack:stackAfterOpen};
window.scrollY=420;shell().props.onSearch();render();nodes(tree).find(node=>node.type==='VocabularyLibrary').props.onBack();settle();
const button={nav:shell().props.nav,scroll:window.scrollY,focusCalls:focus.focusCount,stack:window.history.entries.map(x=>x.lanternWorkspaceView||'initial')};
window.history.back();settle();const afterButtonBack={nav:shell().props.nav,scroll:window.scrollY};
shell().props.onNavigate('resources');render();window.scrollY=640;shell().props.onSearch();render();assert.equal(nativeBack(),true);settle();
const native={nav:shell().props.nav,scroll:window.scrollY,focusCalls:focus.focusCount};
assert.equal(browser.nav,'resources');assert.equal(browser.scroll,420);assert.equal(button.nav,'resources');assert.equal(button.scroll,420);
assert.equal(afterButtonBack.nav,'today');assert.equal(native.nav,'resources');assert.equal(native.scroll,640);assert.equal(focused,focus);

// Source button is genuinely discarded while search mounts. Equivalent controls
// are then rebuilt; two repeated labels model real official resource card rows.
const first=new Element({label:null,text:'学完记一笔',identity:'resource-1'}),second=new Element({label:null,text:'学完记一笔',identity:'resource-2'});
controls=[first,second];document.activeElement=second;window.scrollY=5342;const beforeLookup=lookup.focusCount;
key({isComposing:true,keyCode:229});assert.equal(shell().props.nav,'resources');assert.equal(lookup.focusCount,beforeLookup);
assert.equal(key(),true);assert.equal(shell().props.nav,'search');assert.equal(focused,lookup);
first.isConnected=false;second.isConnected=false;
const rebuiltFirst=new Element({label:null,text:'学完记一笔',identity:'resource-1-rebuilt'}),rebuiltSecond=new Element({label:null,text:'学完记一笔',identity:'resource-2-rebuilt'});controls=[rebuiltFirst,rebuiltSecond];
nodes(tree).find(node=>node.type==='VocabularyLibrary').props.onBack();render();
window.scrollTo(0,0); // A delayed platform/layout adjustment after initial rAF.
settle();assert.equal(shell().props.nav,'resources');assert.equal(window.scrollY,5342);
assert.equal(focused,rebuiltSecond,'Rebuilt repeated-name controls must restore the original occurrence, not the first card');
const rebuiltOrigin={scroll:window.scrollY,focusIdentity:focused.identity,searchFocusTransferred:lookup.focusCount>beforeLookup,scrollRestoration:window.history.scrollRestoration};

shell().props.onSearch();render();let search=nodes(tree).find(node=>node.type==='VocabularyLibrary');
search.props.onQuestion(imports['@/content/questions.json'].default[0].id);render();
const overlayDuringPractice=nodes(tree).find(node=>node.type==='VocabularyLibrary').props.overlayBlocked;
assert.equal(overlayDuringPractice,true);const practice=nodes(tree).find(node=>node.type==='practice');assert.ok(practice);
practice.props.onFinish(5);render();const overlayDuringCheckin=nodes(tree).find(node=>node.type==='VocabularyLibrary').props.overlayBlocked;
assert.equal(overlayDuringCheckin,true);const modalFocus=new Element({identity:'modal'});document.activeElement=modalFocus;modalFocus.focus();const blockedLookupCount=lookup.focusCount;
assert.equal(key(),true);assert.equal(lookup.focusCount,blockedLookupCount);assert.equal(focused,modalFocus);
assert.equal(nativeBack(),true);render();
const navAfterCheckinBack=shell().props.nav,overlayAfterCheckinBack=nodes(tree).find(node=>node.type==='VocabularyLibrary').props.overlayBlocked;
assert.equal(navAfterCheckinBack,'search');assert.equal(overlayAfterCheckinBack,false);
slots.forEach(slot=>slot?.cleanup?.());assert.equal(window.history.scrollRestoration,'auto');
console.log(JSON.stringify({timestamp:new Date().toISOString(),observedFiles,result:'passed',browser,button,afterButtonBack,native,
 rebuiltOrigin,manualRestorationReleased:window.history.scrollRestoration==='auto',blockedShortcutKeptModalFocus:focused===modalFocus,
 rootOverlayHandoff:{overlayDuringPractice,overlayDuringCheckin,navAfterCheckinBack,overlayAfterCheckinBack},
 limits:'Actual StudyApp TSX with controlled Hook, rebuilt DOM controls, rAF and asynchronous history queues; automatic UA scroll reset modeled only when scrollRestoration=auto. Vocabulary/Practice descriptors. No real ReactDOM/Chrome/ArkWeb, child dispatcher or storage'},null,2));
