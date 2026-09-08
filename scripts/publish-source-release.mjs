import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const repo=process.env.GITHUB_REPOSITORY;
const sha=process.env.GITHUB_SHA;
assert.equal(repo,'godnight/lantern-toeic');
assert.equal(process.env.GITHUB_REF,'refs/heads/main');
assert.equal(process.env.GITHUB_EVENT_NAME,'push');
assert(/^[a-f0-9]{40}$/.test(sha));
assert(process.env.GH_TOKEN,'Missing workflow authentication');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const manifest=await read('release-manifest.json');
assert(/^\d+\.\d+\.\d+$/.test(manifest.version));
assert.equal(manifest.prerelease,true,'This workflow publishes source previews only');
const tag='v'+manifest.version;
assert.equal(manifest.notes,`docs/releases/${tag}.md`);
for(const path of ['package.json','mobile/package.json','harmony/package.json'])assert.equal((await read(path)).version,manifest.version,path);
assert.equal((await read('harmony/AppScope/app.json5')).app.versionName,manifest.version);
const notes=await readFile(manifest.notes,'utf8');
async function api(path,options={}){
 const r=await fetch(`https://api.github.com/repos/${repo}${path}`,{...options,headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'}});
 if(r.status===404)return null;
 if(!r.ok)throw Error(`GitHub ${r.status} for ${path}`);
 return r.json();
}
const existing=await api('/releases/tags/'+tag);
const ref=await api('/git/ref/tags/'+tag);
if(existing||ref){
 assert(existing&&ref,'Existing tag or release is incomplete; inspect manually without moving it');
 assert.equal(ref.object.type,'commit','Unexpected annotated tag; inspect manually');
 assert.equal(ref.object.sha,sha,'Version tags are immutable; use a new version');
 console.log(existing.html_url);
}else{
 const release=await api('/releases',{method:'POST',body:JSON.stringify({tag_name:tag,target_commitish:sha,name:`${tag} · 源码预览`,body:notes+`\n\nSource: ${sha}\n`,prerelease:true,make_latest:'false'})});
 console.log(release.html_url);
}
