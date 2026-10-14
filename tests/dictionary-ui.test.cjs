// Executes the real TSX and vocabulary model. React lifecycle, native widgets and I/O are simulated;
// this is component behavior coverage, not browser/device rendering or audio acceptance.
const assert=require('node:assert/strict'), test=require('node:test'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), crypto=require('node:crypto');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const componentFile=process.env.LANTERN_SEARCH_COMPONENT||path.join(root,'app/learn/vocabulary-library.tsx');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function load(file,imports={},globals={}){
 const exports={};const code=ts.transpileModule(fs.readFileSync(file==='app/learn/vocabulary-library.tsx'?componentFile:path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{assert.ok(name in imports,name);return imports[name];},Date,Map,Set,Intl,Error,crypto:crypto.webcrypto,setTimeout,clearTimeout,...globals},{filename:file});return exports;
}
const study=load('lib/study-model.ts'),vocab=load('lib/vocabulary-model.ts',{'./study-model':study}),dict=load('lib/dictionary-model.ts',{'./vocabulary-model':vocab});
const sourceEntry={id:'dict-0123456789abcdef0123',word:'foobarquux',phonetics:[],forms:['foobarquuxed'],senses:[{pos:'noun',meaning:'字典首义'},{pos:'verb',meaning:'预订座位独特'}]};
function nodes(tree,predicate){const result=[],queue=[tree];while(queue.length){const node=queue.shift();if(!node)continue;if(Array.isArray(node)){queue.push(...node);continue;}if(typeof node==='object'){if(predicate(node))result.push(node);queue.push(node.props?.children);}}return result;}
function textOf(node){if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);return Array.isArray(node)?node.map(textOf).join(''):textOf(node.props?.children);}
function harness({entries=[sourceEntry],native=false,loadPromise,initialEvents=[]}={}){
 let slots=[],cursor=0,pending=[],events=initialEvents;const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const react={
  useId(){const i=cursor++;if(!(i in slots))slots[i]='qa-dictionary-'+i;return slots[i];},
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useMemo(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn(),deps};return slots[i].value;},
  useDeferredValue(value){return value;},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};pending.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}
 };
 // Run the real hook-free attribution component so text/link assertions inspect its rendered output.
 // Other children remain platform stubs; do not silently execute future components with their own hooks.
 const jsx=(type,props)=>typeof type==='function'&&type.name==='DictionarySources'?type(props):({type,props}),stubs=new Proxy({},{get:(_,name)=>String(name)});
 const imports={'./vocabulary-redesign.css':{},react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':stubs,'@/components/ui/dialog':stubs,'@/components/ui/select':stubs,sonner:{toast:{success(){},error(){}}},'@/lib/native-host':{registerNativeBack:()=>()=>{}},'@/lib/vocabulary-model':vocab,'@/lib/dictionary-model':dict,'@/lib/load-dictionary':{loadDictionary:()=>loadPromise||Promise.resolve({entries})},'@/lib/lesson-audio':{bundledLessonAudio:()=>null},'./practice':{SpeechPlayer:'SpeechPlayer'},'@/lib/use-vocabulary':{useVocabulary:()=>({events,ready:true,error:'',sync:'local',mark(wordId,starred){const revision=vocab.vocabularyState(events,wordId).revision+1;events=vocab.mergeVocabularyEvents(events,[{id:crypto.randomUUID(),wordId,createdAt:new Date().toISOString(),type:'mark',starred,revision}]);return true;},review(wordId,grade,id){events=vocab.mergeVocabularyEvents(events,[{id,wordId,grade,createdAt:new Date().toISOString(),type:'review'}]);return true;},backup:()=>({kind:'lantern-vocabulary',schemaVersion:1,events}),retry(){}})}};
 for(const name of ['vocabulary','questions','vocabulary-expansion','dictionary-metadata'])imports['@/content/'+name+'.json']={default:JSON.parse(fs.readFileSync(path.join(root,'content',name+'.json'),'utf8'))};
 const component=load('app/learn/vocabulary-library.tsx',imports,{window:{__LANTERN_HARMONY__:native,scrollTo(){}},setInterval:()=>1,clearInterval(){}}).default;
 let tree;const render=()=>{cursor=0;tree=component({owner:null,onQuestion(){}});const batch=pending;pending=[];batch.forEach(fn=>fn());return tree;};
 const click=label=>{const button=nodes(tree,node=>node.type==='button'&&textOf(node)===label)[0];assert.ok(button,'Missing button '+label);button.props.onClick();return render();};
 const search=value=>{nodes(tree,node=>node.type==='input'&&node.props['aria-label']==='搜索单词或中文释义')[0].props.onChange({target:{value}});return render();};
 return {render,click,search,get tree(){return tree;},get events(){return events;},star(){nodes(tree,node=>node.type==='button'&&node.props['aria-label']==='加入生词本：foobarquux')[0].props.onClick();return render();},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}

for(const query of ['预订座位独特','foobarquuxed'])test(`dictionary search retains secondary sense/form result after switching to starred: ${query}`,async()=>{
 const h=harness();h.render();await tick();h.render();h.click('英汉查词');h.search(query);await tick();h.render();
 assert.equal(nodes(h.tree,n=>n.props?.className==='word-row').length,1);
 h.star();h.click('我的生词');assert.equal(h.events.length,1);
 assert.equal(nodes(h.tree,n=>n.props?.className==='word-row').length,1,'The same matched word must remain visible after starring/filtering');h.unmount();
});

test('a new dictionary word enters actual flashcard UI and writes the original review event',async()=>{
 const h=harness();h.render();await tick();h.render();h.click('英汉查词');h.search('foobarquux');await tick();h.render();h.star();h.click('词卡自测 · 1 词');
 assert.match(textOf(h.tree),/先回想，再翻卡/);h.click('查看释义与例句');h.click('记住了');
 assert.equal(h.events.length,2);const state=vocab.vocabularyState(h.events,sourceEntry.id);assert.equal(state.starred,true);assert.equal(state.level,1);assert.match(textOf(h.tree),/这一组，复习完成/);h.unmount();
});

test('native dictionary detail without bundled audio gives the accurate offline-audio limitation',async()=>{
 const h=harness({native:true});h.render();await tick();h.render();h.click('英汉查词');h.search('foobarquux');await tick();h.render();
 nodes(h.tree,n=>n.type==='button'&&n.props.className==='word-open')[0].props.onClick();h.render();
 assert.match(textOf(h.tree),/暂无离线发音/);assert.equal(nodes(h.tree,n=>n.type==='SpeechPlayer').length,0);assert.match(textOf(h.tree),/词源参考不等于记忆联想/);
 const links=nodes(h.tree,n=>n.type==='a').map(n=>n.props.href);
 assert.ok(links.includes('https://zh.wiktionary.org/wiki/foobarquux'));
 assert.ok(links.includes('https://zh.wiktionary.org/w/index.php?title=foobarquux&action=history'));
 assert.ok(links.includes('https://creativecommons.org/licenses/by-sa/4.0/'));h.unmount();
});

test('restored dictionary marks remain intact and are visibly pending until lazy content arrives',async()=>{
 let resolve;const loadPromise=new Promise(done=>{resolve=done;});
 const initialEvents=[{id:'restored-star',wordId:sourceEntry.id,createdAt:'2026-01-01T00:00:00.000Z',type:'mark',starred:true,revision:1}];
 const h=harness({loadPromise,initialEvents});h.render();h.click('我的生词');h.render();
 assert.match(textOf(h.tree),/正在读取历史生词对应的词典内容/);assert.match(textOf(h.tree),/结果尚未完整读入|正在准备词典/);
 assert.equal(h.events.length,1);resolve({entries:[sourceEntry]});await tick();h.render();
 assert.equal(nodes(h.tree,n=>n.props?.className==='word-row').length,1);assert.equal(h.events.length,1);h.unmount();
});

test('a dictionary load failure leaves authored vocabulary searchable and restored history unchanged',async()=>{
 const h=harness({loadPromise:Promise.reject(Error('词典文件未能读取，请重试。'))});h.render();h.click('英汉查词');h.search('reservation');await tick();h.render();h.click('托业场景词');
 assert.match(textOf(h.tree),/场景词仍可使用/);assert.ok(nodes(h.tree,n=>n.props?.className==='word-row').length>0);assert.equal(h.events.length,0);h.unmount();
});

test('real attribution component preserves source and author-history links for every merged case variant',async()=>{
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'content/dictionary-metadata.json'),'utf8'));
 const [key,variants]=Object.entries(metadata.headwordCaseVariants).find(([head,forms])=>head.includes(' ')&&forms.length>1);
 const payload=JSON.parse(fs.readFileSync(path.join(root,'public/dictionaries',metadata.file),'utf8'));
 const entry=payload.entries.find(row=>vocab.searchText(row.word)===key);assert.ok(entry,'Real merged headword is in the bundled dictionary');
 const h=harness({entries:[entry]});h.render();await tick();h.render();h.click('英汉查词');h.search(entry.word);await tick();h.render();
 nodes(h.tree,n=>n.type==='button'&&n.props.className==='word-open'&&textOf(n).includes(entry.word))[0].props.onClick();h.render();
 const links=nodes(h.tree,n=>n.type==='a').map(n=>n.props.href);
 for(const variant of variants){assert.ok(links.includes('https://zh.wiktionary.org/wiki/'+encodeURIComponent(variant)),variant+' original source');assert.ok(links.includes('https://zh.wiktionary.org/w/index.php?title='+encodeURIComponent(variant)+'&action=history'),variant+' contributor history');}
 assert.ok(links.includes(metadata.licenseUrl));assert.match(textOf(h.tree),/中文维基词典贡献者/);assert.match(textOf(h.tree),/词源参考不等于记忆联想/);h.unmount();
});
