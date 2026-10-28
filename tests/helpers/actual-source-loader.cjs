'use strict';
// Executes repository TS/JSON dependencies. Only caller-supplied I/O/React seams
// are substituted; unknown packages and paths outside the selected source fail.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{webcrypto}=require('node:crypto');
const compiledSources=new Map();
const explicitLearningPermit=()=>true;
exports.createSourceLoader=({root,imports={},globals={},allowedFiles,permitLearningAccess=false}={})=>{
 root=path.resolve(root);const fromRoot=createRequire(path.join(root,'package.json')),ts=fromRoot('typescript'),cache=new Map();
 const allowed=allowedFiles&&new Set(allowedFiles),folders=new Set(['lib','app','db','content','components','hooks']);
 function relative(file){
  const absolute=path.resolve(root,file),rel=path.relative(root,absolute).replaceAll('\\','/');
  assert(rel&&!rel.startsWith('../')&&!path.isAbsolute(rel)&&(folders.has(rel.split('/')[0])||rel==='public/build-identity.json'||rel==='release-manifest.json'),'Source dependency outside selected root: '+file);
  assert(!allowed||allowed.has(rel),'Unapproved dependency: '+rel);return rel;
 }
 function load(file){
  file=relative(file);if(cache.has(file))return cache.get(file);
  if(file.endsWith('.json')){const value={__esModule:true,default:JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))};cache.set(file,value);return value;}
  // Stylesheets are a Node module-format seam only; no CSS is injected or altered.
  if(file.endsWith('.css')){fs.readFileSync(path.join(root,file));const style={};cache.set(file,style);return style;}
  assert(/\.(?:tsx?|mjs|cjs|js)$/.test(file),'Unsupported source dependency: '+file);
  const exports={};cache.set(file,exports);
  const source=fs.readFileSync(path.join(root,file),'utf8'),cacheKey=path.join(root,file),prior=compiledSources.get(cacheKey);
  let output=prior?.source===source?prior.output:undefined;
  if(output===undefined){const result=ts.transpileModule(source,{fileName:file.replace(/\.mjs$/,'.js'),reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,allowJs:true}});
   assert(!(result.diagnostics||[]).some(d=>d.category===ts.DiagnosticCategory.Error),'Source transpilation failed: '+file);output=result.outputText;compiledSources.set(cacheKey,{source,output});}
  vm.runInNewContext(output,{exports,require:name=>resolve(name,file),Date,Intl,Map,Set,Error,SyntaxError,JSON,Object,Number,Array,Math,RegExp,Promise,structuredClone,TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView,ArrayBuffer,URL,URLSearchParams,Request,Response,Headers,ReadableStream,TransformStream,CompressionStream,DecompressionStream,Buffer,Blob,File,FormData,AbortController,DOMException,Event,crypto:webcrypto,atob,btoa,setTimeout,clearTimeout,...globals},{filename:file});
  return exports;
 }
 function resolve(name,from){
  if(Object.hasOwn(imports,name))return imports[name];
  // Explicit authority seam for older business-only fixtures, never a product default.
  if(permitLearningAccess&&(name==='@/lib/learning-access'||name==='./learning-access'))return {useLearningAccess:()=>explicitLearningPermit,LearningAccessContext:{Provider:'ExplicitTestLearningAccess'}};
  if(name.startsWith('node:'))return fromRoot(name);
  if(!name.startsWith('.')&&!name.startsWith('@/')){
   assert(['zod','drizzle-orm','drizzle-orm/sqlite-core','drizzle-orm/sqlite-proxy','react-dom'].includes(name),'Unexpected external source dependency: '+name);return fromRoot(name);
  }
  const base=name.startsWith('@/')?name.slice(2):path.posix.join(path.posix.dirname(relative(from)),name);
  const file=[base,base+'.ts',base+'.tsx',base+'.json',base+'.mjs',base+'.js',base+'.cjs',base+'/index.ts',base+'/index.tsx'].find(f=>{const p=path.join(root,f);return fs.existsSync(p)&&fs.statSync(p).isFile();});
  assert(file,'Missing actual source dependency '+name+' from '+from);return load(file);
 }
 return {load,resolve};
};
