import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const root=fileURLToPath(new URL('..',import.meta.url));
const catalogue=JSON.parse(readFileSync(resolve(root,'art/themes.json'),'utf8'));
const references=JSON.parse(readFileSync(resolve(root,'art/references.json'),'utf8')).references;
assert.equal(catalogue.schemaVersion,1);
assert.match(catalogue.artVersion,/^\d+\.\d+\.\d+$/);
const ids=new Set();let count=0;
for(const theme of catalogue.themes){
 assert(['hollow','silk','paper','crystal'].includes(theme.id)&&!ids.has(theme.id));ids.add(theme.id);
 assert(theme.name&&theme.direction&&theme.version);
 for(const color of theme.palette)assert.match(color,/^#[0-9a-f]{6}$/i);
 assert(['hollow','silk'].includes(theme.family));
 assert(['water','snow','petals','crystal'].includes(theme.motion));
 assert(theme.alt && theme.thumbnail);
 for(const path of [theme.image,theme.portrait,theme.thumbnail])assert(theme.assets.some(a=>a.path===path),'Theme image missing from asset manifest');
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
assert.equal(ids.size,4);
const companionArt=JSON.parse(readFileSync(resolve(root,'art/theme-art-provenance-2026-10-12.json'),'utf8'));
const companionPaths=new Set();
for(const asset of companionArt.assets){
 assert(asset.path.startsWith('/images/themes-v3/')&&!asset.path.includes('..'));
 assert(!companionPaths.has(asset.path));companionPaths.add(asset.path);
 assert(asset.sourceFile&&asset.sourceSha256&&asset.encoding);
 const bytes=readFileSync(resolve(root,'public','.'+asset.path));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,'Stale companion art: '+asset.id);
 assert.equal(bytes.length,asset.bytes);
}
for(const theme of catalogue.themes)for(const asset of theme.assets)assert(companionPaths.has(asset.path),'Untracked companion art');
const referenceIds=new Set();
for(const item of references){
 assert(item.id&&!referenceIds.has(item.id));referenceIds.add(item.id);
 assert(['hollow','silk'].includes(item.theme)&&['character','scene','boss'].includes(item.category));
 for(const url of [item.sourceUrl,item.imageUrl].filter(Boolean))assert.equal(new URL(url).protocol,'https:');
 assert(item.title&&item.author&&item.checkedAt&&['link-only','pending'].includes(item.rightsStatus));
}
const maps=JSON.parse(readFileSync(resolve(root,'art/map-scenes.json'),'utf8'));
const supplied=JSON.parse(readFileSync(resolve(root,'art/map-art-provenance.json'),'utf8'));
const mapPaths=new Set();
for(const asset of supplied.assets){
 assert(asset.path.startsWith('/images/maps/')&&!asset.path.includes('..'));
 assert(!mapPaths.has(asset.path));mapPaths.add(asset.path);
 assert(asset.width>0&&asset.height>0&&asset.sourceSha256&&asset.sourceFile);
 const bytes=readFileSync(resolve(root,'public','.'+asset.path));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,'Stale supplied-art derivative: '+asset.id);
 assert.equal(bytes.length,asset.bytes);
}
assert.deepEqual(Object.keys(maps.views).sort(),['today','train','review','progress','resources'].sort());
for(const scene of Object.values(maps.views))for(const path of [scene.image,scene.mobile,scene.thumbnail])assert(mapPaths.has(path)||companionPaths.has(path),'Untracked map scene');
for(const path of [...maps.taskImages,maps.restImage])assert(mapPaths.has(path),'Untracked supporting scene');
const design=JSON.parse(readFileSync(resolve(root,'art/design-r1-webp.json'),'utf8'));
assert.equal(design.schemaVersion,1);
assert.deepEqual(design.assets.map(asset=>asset.id).sort(),['hollow-home','hollow-rain','hollow-lake','hollow-station','silk-home','silk-forest','silk-library','silk-calm'].sort());
let designBytes=0,designOriginalBytes=0;
for(const asset of design.assets){
 assert.equal(asset.path,`/design-r1/${asset.id}.webp`);
 assert.equal(asset.source.path,`public/design-r1/${asset.id}.png`);
 assert.match(asset.source.sha256,/^[a-f0-9]{64}$/);
 assert.equal(asset.source.deliveryBuildId,'v041-final200-20261023-r1-777eaa0d5ab6');
 assert(!existsSync(resolve(root,asset.source.path)),'Original PNG must remain archived outside the new runtime');
 const bytes=readFileSync(resolve(root,'public','.'+asset.path));
 assert.equal(bytes.length,asset.bytes);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,'Stale design-r1 derivative: '+asset.id);
 const image=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
 assert.equal(image.info.width,1672);assert.equal(image.info.height,941);
 assert.equal(asset.width,1672);assert.equal(asset.height,941);
 assert.equal(asset.source.width,1672);assert.equal(asset.source.height,941);
 assert(asset.psnrDb===null||asset.psnrDb>=34);
 designBytes+=bytes.length;designOriginalBytes+=asset.source.bytes;
}
const lake=design.assets.find(asset=>asset.id==='hollow-lake');
assert.equal(lake.source.sha256,'ec8407e9e739d3300f5fcadd8201f7f62bc2cdb0cf2ab23e092ac0697b0b2442');
assert.equal(lake.completeScene,true);
assert.equal(designBytes,design.totalDerivedBytes);assert.equal(designOriginalBytes,design.totalSourceBytes);
assert.equal(design.byteReduction,1-designBytes/designOriginalBytes);
console.log(`Design-r1 verified: eight decoded full-frame WebP derivatives, ${designBytes} bytes; archived original pins retained. This is not a visual or permission review.`);
console.log(`Art catalogue verified: ${ids.size} themes, ${count} bundled originals, ${references.length} external references, ${mapPaths.size} supplied map derivatives. This is not a visual or permission review.`);
