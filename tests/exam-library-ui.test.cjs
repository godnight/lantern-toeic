// Actual TSX + download/file validators; React rendering, network and local import are controlled.
// Does not replace browser/ArkWeb acceptance.
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..'),ts=require(path.join(root,'node_modules/typescript'));
function load(file,imports={},globals={}){const exports={},code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInNewContext(code,{exports,require:name=>{if(!Object.hasOwn(imports,name))return require('./helpers/actual-source-loader.cjs').createSourceLoader({root,imports,globals:globals}).resolve(name,file);return imports[name];},Date,Map,Set,Error,JSON,Promise,TextEncoder,TextDecoder,Uint8Array,Uint32Array,ArrayBuffer,Blob,File,URL,Request,Response,Headers,ReadableStream,AbortController,atob,btoa,crypto:crypto.webcrypto,...globals},{filename:file});return exports;}
const model=load('lib/exam-model.ts'),library=load('lib/exam-library.ts',{'@/lib/exam-model':model});
const storage=load('lib/exam-storage.ts',{'./exam-model':model});
const fixture=require(path.join(root,'tests/fixtures/synthetic-exam.cjs'));
const body=JSON.stringify(fixture()),item={id:crypto.randomUUID(),examId:fixture().id,version:1,title:fixture().title,bytes:Buffer.byteLength(body),sha256:crypto.createHash('sha256').update(body).digest('hex'),createdAt:new Date().toISOString(),state:'ready'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function nodes(tree,predicate){const out=[],queue=[tree];while(queue.length){const n=queue.shift();if(!n)continue;if(Array.isArray(n)){queue.push(...n);continue;}if(typeof n==='object'){if(predicate(n))out.push(n);queue.push(n.props?.children);}}return out;}
function textOf(n){return n==null||typeof n==='boolean'?'':typeof n==='object'?Array.isArray(n)?n.map(textOf).join(''):textOf(n.props?.children):String(n);}
function harness({owner='alice',native=false,fetcher,prepare=library.prepareLibraryFile}={}){
 let slots=[],cursor=0,pending=[],tree,dead=false,writesAfterUnmount=0;const calls=[],imports=[];
 const repository=storage.openExamRepository(owner,{factory:new (require('fake-indexeddb').IDBFactory)(),name:'synthetic-library-ui'});
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{if(dead)writesAfterUnmount++;slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};pending.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
 const jsx=(type,props)=>({type,props});
 const component=load('app/learn/exam-library.tsx',{react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'@/lib/exam-library':{...library,prepareLibraryFile:prepare},'@/lib/exam-model':model},{window:{location:{origin:native?'https://lantern.local':'https://study.test'}},fetch:async(url,options={})=>{calls.push({url,options});return fetcher?fetcher(url,options):Response.json({items:[item]});}}).default;
 const render=()=>{cursor=0;tree=component({ownerId:owner,disabled:false,onImport:async source=>{const repo=await repository;const result=await repo.importPackageFile(source.file,{expected:source.expected,signal:source.signal});imports.push(JSON.stringify(await repo.getPackage(result.summary.key)));}});const effects=pending;pending=[];effects.forEach(fn=>fn());return tree;};
 const click=label=>{const button=nodes(tree,n=>n.type==='button'&&textOf(n)===label)[0];assert.ok(button,'Missing '+label);button.props.onClick();render();};
 const changeFiles=files=>{nodes(tree,n=>n.type==='input')[0].props.onChange({target:{files,value:'test'}});render();};
 return {render,click,changeFiles,calls,imports,get tree(){return tree;},get busy(){return nodes(tree,n=>n.type==='button'&&['加载个人题包库','刷新个人题包库'].includes(textOf(n)))[0]?.props.disabled===true;},get writesAfterUnmount(){return writesAfterUnmount;},unmount(){slots.forEach(s=>s?.cleanup?.());dead=true;void repository.then(repo=>repo.close());}};
}
async function drain(h){
 if(!h){for(let i=0;i<12;i++)await new Promise(r=>setTimeout(r,2));return;}
 const deadline=Date.now()+5000;
 do{await new Promise(r=>setTimeout(r,2));h.render();if(!h.busy)return;}while(Date.now()<deadline);
 assert.fail('Actual cloud action did not settle within the bounded5s fixture deadline');
}
test('native mode exposes only authenticated-browser download guidance and performs no API calls',async()=>{
 const h=harness({native:true});h.render();h.render();assert.match(textOf(h.tree),/浏览器登录下载/);
 assert.equal(nodes(h.tree,n=>n.type==='a'&&n.props.href===library.EXAM_LIBRARY_URL).length,1);assert.equal(nodes(h.tree,n=>n.type==='input').length,0);assert.equal(h.calls.length,0);h.unmount();
});
test('normal cloud download verifies real package bytes then imports once using bound owner',async()=>{
 const h=harness({fetcher:url=>url.includes('?id=')?new Response(body,{headers:{'content-type':'application/json','content-length':String(item.bytes)}}):Response.json({items:[item]})});
 h.render();h.click('加载个人题包库');await drain(h);h.click('下载到本机题包');await drain(h);
 assert.deepEqual(h.imports,[body]);assert.ok(h.calls.every(c=>c.options.headers['x-lantern-owner']==='alice'));assert.match(textOf(h.tree),/已校验并保存到本机/);h.unmount();
});
test('leaving old owner view aborts pending download and a late response never imports into another owner',async()=>{
 const delayed=deferred(),a=harness({fetcher:url=>url.includes('?id=')?delayed.promise:Response.json({items:[item]})});
 a.render();a.click('加载个人题包库');await drain(a);a.click('下载到本机题包');a.unmount();
 const b=harness({owner:'bob',fetcher:()=>Response.json({items:[]})});b.render();b.click('加载个人题包库');await drain(b);
 assert.equal(a.calls.at(-1).options.signal.aborted,true);delayed.resolve(new Response(body,{headers:{'content-type':'application/json'}}));await drain();
 assert.equal(a.imports.length,0);assert.equal(b.imports.length,0);assert.equal(a.writesAfterUnmount,0);assert.match(textOf(b.tree),/还是空的/);b.unmount();
});
test('leaving during local validation prevents a late file read from uploading under stale owner',async()=>{
 const delayed=deferred(),h=harness({prepare:()=>delayed.promise});h.render();h.changeFiles([new File([body],'exam.json',{type:'application/json'})]);h.unmount();
 delayed.resolve(item);await drain();assert.equal(h.calls.length,0);assert.equal(h.writesAfterUnmount,0);assert.equal(h.imports.length,0);
});
test('double action is locked and corrupt cloud download reports failure without local import',async()=>{
 const gate=deferred(),h=harness({fetcher:url=>url.includes('?id=')?new Response(body.slice(0,-1),{headers:{'content-type':'application/json'}}):gate.promise});
 h.render();h.click('加载个人题包库');h.click('加载个人题包库');assert.equal(h.calls.length,1);
 gate.resolve(Response.json({items:[item]}));await drain(h);h.click('下载到本机题包');await drain(h);
 assert.equal(h.imports.length,0);assert.match(textOf(h.tree),/不完整/);h.unmount();
});
test('server owner conflict and HTML login page cannot become a successful cloud import',async()=>{
 for(const response of [Response.json({error:'账号已切换，请刷新后重试'},{status:409}),new Response('<html>login</html>',{headers:{'content-type':'text/html'}})]){
  const h=harness({fetcher:()=>response});h.render();h.click('加载个人题包库');await drain(h);assert.equal(h.imports.length,0);assert.equal(nodes(h.tree,n=>n.props?.role==='alert').length,1);h.unmount();
 }
});
