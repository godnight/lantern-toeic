import {createHash} from 'node:crypto';
import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const source=path.join(root,'mobile/dist');
const target=path.join(root,'harmony/entry/src/main/resources/rawfile/web');
const check=process.argv.includes('--check');
const excluded=new Set(['sw.js','manifest.webmanifest','offline.html']);
async function files(dir,prefix=''){
 const result=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const name=path.posix.join(prefix,entry.name);
  if(entry.isSymbolicLink())throw new Error(`Unexpected symlink: ${name}`);
  if(entry.isDirectory())result.push(...await files(path.join(dir,entry.name),name));
  else if(entry.isFile()&&!excluded.has(name))result.push(name);
 }
 return result.sort();
}
const html=await readFile(path.join(source,'index.html'),'utf8').catch(()=>{throw new Error('Build the shared frontend first: npm --prefix mobile run build');});
if(!html.includes('id="root"')||!html.includes('type="module"'))throw new Error('Missing React entrypoint');
const names=await files(source);
if(!check){
 await rm(target,{recursive:true,force:true});
 await mkdir(target,{recursive:true});
 for(const name of names){await mkdir(path.dirname(path.join(target,name)),{recursive:true});await cp(path.join(source,name),path.join(target,name));}
}
const entries=[];
for(const name of names){
 const expected=await readFile(path.join(source,name));
 const actual=await readFile(path.join(target,name));
 if(!expected.equals(actual))throw new Error(`Stale HarmonyOS asset: ${name}`);
 entries.push({path:name,bytes:actual.length,sha256:createHash('sha256').update(actual).digest('hex')});
}
const targetNames=(await files(target)).filter(name=>name!=='bundle-manifest.json');
if(JSON.stringify(names)!==JSON.stringify(targetNames))throw new Error('Unexpected or missing HarmonyOS assets');
for(const image of ['hollow-v2-wide.webp','silk-v2-wide.webp','hollow-v2-portrait.webp','silk-v2-portrait.webp','office-practice.webp']){
 if(!names.includes(`images/${image}`))throw new Error(`Missing required practice/theme image: ${image}`);
}
const manifest={schemaVersion:1,platform:'HarmonyOS',nativeBuildVerified:false,files:entries};
if(!check)await writeFile(path.join(target,'bundle-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
else if(JSON.stringify(JSON.parse(await readFile(path.join(target,'bundle-manifest.json'),'utf8')))!==JSON.stringify(manifest))throw new Error('Asset manifest does not match the bundle');
console.log(`Verified ${names.length} shared frontend assets for HarmonyOS. This is not an HAP compilation.`);
