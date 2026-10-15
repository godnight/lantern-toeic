import {readFile,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const target=value('--target')||'web';
const manifest=JSON.parse(await readFile(path.join(root,'content/public-distribution.json'),'utf8'));
const issues=[];
if(!['web','harmony','source'].includes(target))issues.push('Unsupported public target');
for(const group of manifest.groups.filter(group=>group.targets.includes(target))){
 if(group.status!=='allowed')issues.push(group.id+': '+group.reason);
 for(const evidence of group.evidence){
  const file=path.resolve(root,evidence.path);
  if(!file.startsWith(root+path.sep)){issues.push(group.id+': evidence outside source');continue;}
  const digest=createHash('sha256').update(await readFile(file)).digest('hex');
  if(digest!==evidence.sha256)issues.push(group.id+': source evidence changed: '+evidence.path);
 }
}
const artifact=value('--artifact-root');
let checkedFiles=0;
if(!artifact)issues.push('No exact public artifact supplied; source review cannot approve a generated bundle');
else {
 const base=await realpath(path.resolve(artifact));
 async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
  const filename=path.join(folder,entry.name),relative=path.relative(base,filename).replaceAll('\\','/');
  if(entry.isSymbolicLink()){issues.push('Symlink excluded: '+relative);continue;}
  if(entry.isDirectory()){await walk(filename);continue;}
  checkedFiles++;
  if(/(^|\/)(\.env[^/]*|agconnect-services\.json|.*\.(p12|pfx|jks|keystore|pem)|.*(?:private-backup|my-study-records|recording-export).*)$/i.test(relative)){issues.push('Private/configuration input excluded: '+relative);continue;}
  const allowed=manifest.files.find(row=>row.path===relative&&row.targets.includes(target));
  if(!allowed||allowed.status!=='allowed'){issues.push('No reviewed file allowlist entry: '+relative);continue;}
  const digest=createHash('sha256').update(await readFile(filename)).digest('hex');
  if(digest!==allowed.sha256)issues.push('Artifact bytes differ: '+relative);
 }}
 await walk(base);
 if(!checkedFiles)issues.push('Empty artifact cannot pass public release gate');
}
console.log(JSON.stringify({target,eligible:issues.length===0,checkedFiles,issues,scope:'Public distribution only; local development build remains separate'},null,2));
if(issues.length)process.exitCode=1;
