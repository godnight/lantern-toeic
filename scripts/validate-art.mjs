import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const catalogue=JSON.parse(readFileSync(resolve(root,'art/themes.json'),'utf8'));
const references=JSON.parse(readFileSync(resolve(root,'art/references.json'),'utf8')).references;
assert.equal(catalogue.schemaVersion,1);
assert.match(catalogue.artVersion,/^\d+\.\d+\.\d+$/);
const ids=new Set();let count=0;
for(const theme of catalogue.themes){
 assert(['hollow','silk','paper'].includes(theme.id)&&!ids.has(theme.id));ids.add(theme.id);
 assert(theme.name&&theme.direction&&theme.version);
 for(const color of theme.palette)assert.match(color,/^#[0-9a-f]{6}$/i);
 for(const path of [theme.image,theme.portrait].filter(Boolean))assert(theme.assets.some(a=>a.path===path),'Theme image missing from asset manifest');
 if(theme.download){assert(theme.download.startsWith('/art-packs/')&&!theme.download.includes('..'));assert.equal(createHash('sha256').update(readFileSync(resolve(root,'public','.'+theme.download))).digest('hex'),theme.downloadSha256,'Stale theme archive');}
 const assetIds=new Set();
 for(const asset of theme.assets){
  assert(!assetIds.has(asset.id));assetIds.add(asset.id);
  assert(asset.path.startsWith('/images/')&&!asset.path.includes('..'));
  const path=resolve(root,'public','.'+asset.path);assert(path.startsWith(resolve(root,'public')+sep)&&existsSync(path));
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),asset.sha256,'Stale art hash: '+asset.id);
  assert(asset.width>0&&asset.height>0&&asset.author&&asset.license&&asset.provenance&&asset.status==='approved');count++;
 }
}
assert.equal(ids.size,3);
const referenceIds=new Set();
for(const item of references){
 assert(item.id&&!referenceIds.has(item.id));referenceIds.add(item.id);
 assert(ids.has(item.theme)&&['character','scene','boss'].includes(item.category));
 for(const url of [item.sourceUrl,item.imageUrl].filter(Boolean))assert.equal(new URL(url).protocol,'https:');
 assert(item.title&&item.author&&item.checkedAt&&['link-only','pending'].includes(item.rightsStatus));
}
console.log(`Art catalogue verified: ${ids.size} themes, ${count} bundled originals, ${references.length} external references. This is not a visual or permission review.`);
