// Executes the shipped SpeechPlayer with real lesson-audio logic. DOM/media/TTS are fixtures;
// this verifies ownership and checkpoint races, not browser codecs or native lifecycle acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,imports={},globals={}){const exports={},code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInNewContext(code,{exports,require:n=>{assert.ok(n in imports,n);return imports[n];},crypto:crypto.webcrypto,TextEncoder,structuredClone,Event,...globals},{filename:file});return exports;}
const textOf=n=>n==null?'':typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(textOf).join(''):textOf(n.props?.children);
function nodes(tree,fn){const out=[],todo=[tree];while(todo.length){const n=todo.shift();if(Array.isArray(n)){todo.push(...n);continue;}if(n&&typeof n==='object'){if(fn(n))out.push(n);todo.push(n.props?.children);}}return out;}
function environment(){
 const media=[],window=new EventTarget(),document=new EventTarget();document.visibilityState='visible';document.querySelectorAll=()=>media;window.speechSynthesis={cancel(){},getVoices:()=>[],speak(){}};
 const globals={window,document,SpeechSynthesisUtterance:class{constructor(text){this.text=text;}}};
 const lesson=load('lib/lesson-audio.ts',{},globals),canonical=load('lib/domain-command.ts'),training=load('lib/practice-training.ts',{'./domain-command':canonical}),model=load('lib/study-model.ts');
 let active;
 const react={useState:x=>active.useState(x),useRef:x=>active.useRef(x),useEffect:(fn,deps)=>active.useEffect(fn,deps)};
 const jsx=(type,props,key)=>({type,props,key}),stubs=new Proxy({},{get:(_,key)=>String(key)}),imports={react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':stubs,sonner:{toast:{error(){}}},'@/lib/domain-command':canonical,'@/lib/practice-training':training,'@/lib/study-model':model,'./use-practice-training':{},'@/lib/lesson-audio':lesson,'@/lib/native-host':{subscribeNativeState:()=>()=>{},registerNativeBack:()=>()=>{}}};
 for(const name of ['dialog','tabs','radio-group','select','progress'])imports['@/components/ui/'+name]=stubs;
 const SpeechPlayer=load('app/learn/practice.tsx',imports,globals).SpeechPlayer;
 class Audio extends EventTarget{currentTime=0;duration=30;readyState=1;paused=true;ended=false;playbackRate=1;plays=0;play(){this.paused=false;this.plays++;return Promise.resolve();}pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}}
 function player(props){let slots=[],cursor=0,effects=[],tree;const audio=new Audio();media.push(audio);
  const runtime={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
  const render=()=>{active=runtime;cursor=0;tree=SpeechPlayer(props);for(const node of nodes(tree,n=>n.type==='audio'))node.props.ref.current=audio;const pending=effects;effects=[];pending.forEach(fn=>fn());return tree;};
  const click=(restart=false)=>{const buttons=nodes(tree,n=>n.type==='button'),b=restart?buttons.find(n=>textOf(n)==='从头播放'):buttons[0];assert.ok(b);b.props.onClick();render();};render();return {audio,render,click,props,get tree(){return tree;},close(){slots.forEach(s=>s?.cleanup?.());}};
 }
 return {lesson,player,window,document};
}
test('only the latest played sentence captures on global stop; old mounted players cannot overwrite it',()=>{
 const e=environment(),events=[];const one=e.player({text:'First.',trackId:'sentence:0',onCheckpoint:v=>events.push(v.trackId)}),two=e.player({text:'Second.',trackId:'sentence:1',onCheckpoint:v=>events.push(v.trackId)});
 two.click();one.click();one.click();events.length=0;e.lesson.stopLessonAudio();assert.ok(events.length);assert.ok(events.every(v=>v==='sentence:0'));two.close();one.close();
});
test('native checkpoint restoration is silent; pause/resume and explicit restart keep distinct positions',()=>{
 const e=environment(),file='0123456789abcdef0123.mp3',events=[];e.lesson.installBundledLessonAudio([{text:'Native.',file}]);const p=e.player({text:'Native.',trackId:'sentence:0',checkpoint:{trackId:'sentence:0',sourceId:'bundled:'+file+':'+file,kind:'bundled',capability:'time',positionSeconds:6.25,rate:0.85},onCheckpoint:v=>events.push(v)});
 assert.equal(p.audio.plays,0);assert.equal(events.length,0);p.click();assert.equal(p.audio.currentTime,6.25);p.audio.currentTime=9.5;p.click();assert.equal(events.at(-1).positionSeconds,9.5);p.click();assert.equal(p.audio.currentTime,9.5);p.render();p.click(true);assert.equal(p.audio.currentTime,0);assert.equal(events.at(-1).positionSeconds,0);p.close();
});
test('old TTS cleanup never cancels the newly started source',()=>{
 const e=environment();let cancels=0;e.window.speechSynthesis.cancel=()=>cancels++;const one=e.player({text:'One.'}),two=e.player({text:'Two.'});one.click();two.click();const before=cancels;one.close();assert.equal(cancels,before);two.close();
});
