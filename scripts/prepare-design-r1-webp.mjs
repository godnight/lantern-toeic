import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import sharp from 'sharp';

// Originals live in the preserved previous delivery, outside this runtime.
// Only these eight explicitly pinned images may be encoded; no resize or crop.
const root=fileURLToPath(new URL('..',import.meta.url));
const args=process.argv.slice(2);
assert.equal(args.length,2,'Usage: node scripts/prepare-design-r1-webp.mjs --source-root <preserved-source-root>');
assert.equal(args[0],'--source-root');
const sourceRoot=resolve(args[1]);
const manifestPath=resolve(root,'art/design-r1-webp.json');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
assert.equal(manifest.assets.length,8);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const prepared=[];
for(const asset of manifest.assets){
  assert.match(asset.id,/^(hollow-(home|rain|lake|station)|silk-(home|forest|library|calm))$/);
  assert.equal(asset.source.path,`public/design-r1/${asset.id}.png`);
  assert.equal(asset.path,`/design-r1/${asset.id}.webp`);
  const source=await readFile(resolve(sourceRoot,asset.source.path));
  assert.equal(source.length,asset.source.bytes);assert.equal(sha(source),asset.source.sha256);
  const metadata=await sharp(source).metadata();
  assert.equal(metadata.width,1672);assert.equal(metadata.height,941);
  const encoded=await sharp(source).webp(manifest.encoding.options).toBuffer();
  const decoded=await sharp(encoded).raw().toBuffer({resolveWithObject:true});
  assert.equal(decoded.info.width,1672);assert.equal(decoded.info.height,941);
  const originalPixels=await sharp(source).removeAlpha().raw().toBuffer();
  const derivedPixels=await sharp(encoded).removeAlpha().raw().toBuffer();
  assert.equal(originalPixels.length,derivedPixels.length);
  let squaredError=0;
  for(let i=0;i<originalPixels.length;i++)squaredError+=(originalPixels[i]-derivedPixels[i])**2;
  const mse=squaredError/originalPixels.length;
  const psnr=mse===0?null:10*Math.log10(255**2/mse);
  assert(psnr===null||psnr>=34,'Unexpected pixel loss: '+asset.id);
  prepared.push({asset,encoded,details:{bytes:encoded.length,sha256:sha(encoded),width:1672,height:941,psnrDb:psnr===null?null:Number(psnr.toFixed(3))}});
}
// All source pins and complete decodes succeed before writing a derivative.
for(const {asset,encoded,details} of prepared){
  const path=resolve(root,'public','.'+asset.path);
  try{const previous=await readFile(path);assert.equal(sha(previous),details.sha256,'Refusing to replace a different derivative');}
  catch(error){if(error.code!=='ENOENT')throw error;await writeFile(path,encoded,{flag:'wx'});}
  Object.assign(asset,details);
}
manifest.encoding.versions={sharp:sharp.versions.sharp,vips:sharp.versions.vips,webp:sharp.versions.webp};
manifest.totalSourceBytes=manifest.assets.reduce((sum,asset)=>sum+asset.source.bytes,0);
manifest.totalDerivedBytes=manifest.assets.reduce((sum,asset)=>sum+asset.bytes,0);
manifest.byteReduction=1-manifest.totalDerivedBytes/manifest.totalSourceBytes;
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({images:8,originalBytes:manifest.totalSourceBytes,derivedBytes:manifest.totalDerivedBytes,reduction:manifest.byteReduction}));
