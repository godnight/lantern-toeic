import {readFile,mkdir,writeFile} from 'node:fs/promises';
const entries=JSON.parse(await readFile(new URL('../content/exams/catalogue.json',import.meta.url),'utf8'));
const urls=[...new Set(entries.flatMap(r=>[r.landingUrl,r.downloadUrl]).filter(Boolean))];
const report=[];let cursor=0;
async function worker(){
 while(cursor<urls.length){
  const url=urls[cursor++];
  try{
   let r=await fetch(url,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(8000)});
   if(r.status===405||r.status===501){r=await fetch(url,{headers:{Range:'bytes=0-0'},redirect:'follow',signal:AbortSignal.timeout(8000)});await r.body?.cancel();}
   report.push({url,status:r.status,ok:r.ok,finalUrl:r.url,checkedAt:new Date().toISOString()});
  }catch(error){report.push({url,ok:false,error:error.name,checkedAt:new Date().toISOString()});}
 }
}
await Promise.all([worker(),worker(),worker()]);
await mkdir(new URL('../reports/',import.meta.url),{recursive:true});
await writeFile(new URL('../reports/resource-links.json',import.meta.url),JSON.stringify({note:'HTTP reachability only; no question text downloaded. Does not verify playback, identity of content or reuse permission.',results:report.sort((a,b)=>a.url.localeCompare(b.url))},null,2)+'\n');
console.log(`Checked ${urls.length} official URLs; ${report.filter(r=>!r.ok).length} need review. See reports/resource-links.json.`);
if(report.some(r=>!r.ok))process.exitCode=1;
