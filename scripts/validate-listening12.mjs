import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,realpath,readdir,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const canonical=(loader,value)=>loader.load('lib/domain-command.ts').canonicalJson(value);

/** Resolve only an exact product-owned path, and reject symlinks escaping the
 * public root. This validator reads assets; it never writes or deletes them. */
async function productFile(root,relative){
  assert(typeof relative==='string'&&relative.startsWith('/')&&!relative.includes('\\')&&!relative.includes('..'),'Invalid product asset path');
  const publicRoot=await realpath(path.join(root,'public'));
  const target=path.resolve(publicRoot,'.'+relative),relativeTarget=path.relative(publicRoot,target);
  assert(relativeTarget&&!relativeTarget.startsWith('..')&&!path.isAbsolute(relativeTarget),'Asset path escapes public root');
  const actual=await realpath(target),relativeActual=path.relative(publicRoot,actual);
  assert(relativeActual&&!relativeActual.startsWith('..')&&!path.isAbsolute(relativeActual),'Asset symlink escapes public root');
  assert.equal(path.relative(target,actual),'','Asset must remain in its declared product directory');
  assert((await stat(actual)).isFile(),'Product asset is not a file');
  return actual;
}

/** Verify the actual sealed private-candidate source and each shipped image and
 * audio clip. The real product admission and registry remain the authorities;
 * this build check does not claim human review or acoustic acceptance. */
export async function validateListening12Assets({repoRoot,loader,readBytes=readFile}){
  const root=path.resolve(repoRoot),require=createRequire(path.join(root,'package.json'));
  const sharp=require('sharp');
  const {input,pins,extensionPins}=loader.load('lib/listening-part1-12-package-admission.ts').captureCompiledPart1TwelvePackage();
  const catalog=loader.load('lib/question-catalog.ts');
  const index=loader.load('lib/natural-audio-catalog-index.ts').compiledNaturalAudioCatalog;
  const {admitPart1TwelvePackage}=loader.load('lib/listening-part1-12-catalog.ts');
  assert.equal(input.gate.humanReviewed,false,'Model image review is not human review');
  assert.equal(input.gate.reviewKind,'AI_KNOWN_KEY_FINAL_PIXEL_CHECK','The final image review must remain accurately described');
  assert.equal(input.gate.formalAllowed,false);assert.equal(input.gate.publishAllowed,false);
  assert.equal(input.media.distribution,'private-practice');assert.equal(input.media.humanReviewed,false);
  assert.equal(input.media.humanListeningPerformed,false);assert.equal(input.media.formalAllowed,false);assert.equal(input.media.publishAllowed,false);
  assert(hex(input.media.asrDifferenceReviewSha256),'ASR difference evidence must remain identified');
  const sourceBytes=await readBytes(path.join(root,'content/questions-v041-part1-twelve.json'));
  assert.equal(sha256(sourceBytes),pins.sourceQuestionsSha256,'Question source bytes differ from the pinned final text');
  const admitted=admitPart1TwelvePackage(input,pins,catalog.BASE_QUESTIONS);
  assert.equal(admitted.questions.length,12);assert.equal(catalog.BASE_QUESTIONS.length,313);
  assert.equal(extensionPins.base313CanonicalSha256,pins.base313CanonicalSha256);
  assert.equal(extensionPins.combined325CanonicalSha256,pins.combined325CanonicalSha256);
  assert(catalog.PRACTICE_QUESTION_CATALOGS.includes(catalog.BASE_QUESTIONS),'Old 313 catalogue must remain registered');
  assert.equal(catalog.QUESTIONS.length,325,'New catalogue must contain all 325 questions');
  assert.equal(catalog.LISTENING_COLLECTION_QUESTIONS.length,200,'The original listening collection must remain 200');
  assert.equal(canonical(loader,catalog.QUESTIONS.slice(-12)),canonical(loader,admitted.questions),'Active catalogue differs from the sealed new questions');

  const gates=new Map(input.gate.questions.map(row=>[row.qid,row])),seen=new Set();
  for(const q of admitted.questions){
    const row=gates.get(q.id),image=row?.image;
    assert(image&&image.url===q.image&&image.status==='PASS_EXACT_SELECTED_IMAGE_AND_OPTIONS');
    assert(hex(image.sha256)&&hex(image.reviewSha256)&&hex(row.textReviewSha256));
    assert.equal(image.url,`/listening12/${image.sha256}.png`,'New image URL must be hash-bound and within its own directory');
    assert(!seen.has(image.sha256),'New images must be distinct');seen.add(image.sha256);
    const bytes=await readBytes(await productFile(root,image.url));
    assert.equal(bytes.length,image.bytes,'New image byte size changed');assert.equal(sha256(bytes),image.sha256,'New image hash changed');
    assert(bytes.length>=33&&bytes.length<25*1024*1024,'New PNG size is invalid');
    assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'New PNG signature is invalid');
    assert.equal(bytes.readUInt32BE(8),13);assert.equal(bytes.toString('ascii',12,16),'IHDR');
    assert.equal(bytes.readUInt32BE(16),image.width);assert.equal(bytes.readUInt32BE(20),image.height);
    const result=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
    assert.equal(result.info.width,image.width,'PNG decode width differs');assert.equal(result.info.height,image.height,'PNG decode height differs');
    assert(result.data.length>0,'PNG decoded to an empty image');
  }

  const descriptor=pins.packDescriptor;
  assert(/^v040-natural-[a-f0-9]{12}$/.test(descriptor.packId),'Invalid compiled pack ID');
  assert.equal(descriptor.packId,`v040-natural-${descriptor.manifestSha256.slice(0,12)}`);
  assert.equal(descriptor.manifestPath,`/audio/natural/${descriptor.packId}/manifest.json`);
  assert.equal(descriptor.admissionPath,`/audio/natural/${descriptor.packId}/admission.json`);
  const ordinal=index.packs.findIndex(row=>row.packId===descriptor.packId);
  assert.equal(ordinal,23,'New pack must follow the unchanged 23-pack baseline');
  assert.equal(canonical(loader,index.packs[ordinal]),canonical(loader,descriptor),'Compiled descriptor differs from the pinned descriptor');
  const sourceKeys=new Set(input.media.units.map(unit=>unit.body.audio.audioKey));assert.equal(sourceKeys.size,12);
  const ordinalKeys=[];
  for(const [key,rows] of Object.entries(index.routes))for(const row of rows)if(row[0]===ordinal)ordinalKeys.push(key);
  assert.equal(ordinalKeys.length,12,'New pack must have exactly 12 routes');
  assert.deepEqual(new Set(ordinalKeys),sourceKeys,'New pack routes must match the admitted selectors');
  const manifestBytes=await readBytes(await productFile(root,descriptor.manifestPath));
  const admissionBytes=await readBytes(await productFile(root,descriptor.admissionPath));
  assert.equal(manifestBytes.length,descriptor.manifestBytes,'Audio manifest byte size changed');
  assert.equal(sha256(manifestBytes),descriptor.manifestFileSha256,'Audio manifest hash changed');
  assert.equal(admissionBytes.length,descriptor.admissionBytes,'Audio admission byte size changed');
  assert.equal(sha256(admissionBytes),descriptor.admissionFileSha256,'Audio admission hash changed');
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.packId,descriptor.packId);assert.equal(manifest.manifestSha256,descriptor.manifestSha256);
  assert.equal(manifest.status,'PRIVATE_LOCAL_CANDIDATE');assert.equal(manifest.humanAccepted,false);assert.equal(manifest.publishAllowed,false);
  assert.equal(manifest.clips.length,12);assert.equal(descriptor.clipCount,12);assert.equal(descriptor.memberCount,12);
  assert.equal(manifest.sourceFiles.find(row=>row.path==='questions.frozen.json')?.sha256,pins.sourceQuestionsSha256);
  const expectedNames=new Set(['manifest.json','admission.json',...manifest.clips.map(clip=>`${clip.sha256}.mp3`)]);
  assert.equal(expectedNames.size,14,'Audio clip identities must be distinct');
  const packDirectory=path.dirname(await productFile(root,descriptor.manifestPath));
  const entries=await readdir(packDirectory,{withFileTypes:true});
  assert.equal(entries.length,14,'Audio pack must contain exactly its 14 declared files');
  assert(entries.every(entry=>entry.isFile()&&expectedNames.has(entry.name)),'Unexpected or non-file entry in audio pack');
  assert.equal(manifest.clips.reduce((sum,clip)=>sum+clip.bytes,0),descriptor.declaredBytes);

  const admission=loader.load('lib/natural-audio-admission.ts');
  const audio=loader.load('lib/natural-audio.ts');
  const releaseAdmission=admission.registerCompiledNaturalAudioAdmission(descriptor.packId,new Uint8Array(admissionBytes));
  let allocated=0,revoked=0;
  try{
    const checked=await audio.validateNaturalAudioManifest(manifest,true);assert.equal(checked.clips.length,12);
    const registry=new audio.NaturalAudioRegistry();
    const activated=await registry.activate(manifest,{allowLocalCandidate:true});assert.equal(activated.status,'ready',activated.reason);
    const dispatch=loader.load('lib/question-audio-dispatch-v041.ts');
    for(const q of admitted.questions){
      const binding=admitted.getAudio(q.id);assert(binding?.body);
      assert.equal(canonical(loader,dispatch.getReviewedListeningAudio(q.id)),canonical(loader,binding),'Real practice/history dispatcher does not match the admitted track');
      const body=binding.body,selector={assetKey:body.audioKey,materialId:body.materialId,segmentId:body.segmentId,voiceProfileId:body.voiceProfileId,contextHash:body.contextHash};
      const resolved=registry.resolve(body.text,selector);assert(resolved,`Missing exact audio route for ${q.id}`);
      assert.equal(resolved.url,`/audio/natural/${descriptor.packId}/${resolved.clip.sha256}.mp3`);
      const bytes=await readBytes(await productFile(root,resolved.url));
      assert.equal(bytes.length,resolved.clip.bytes,`Audio byte size changed for ${q.id}`);
      assert.equal(sha256(bytes),resolved.clip.sha256,`Audio hash changed for ${q.id}`);
      const prepared=await registry.prepare(body.text,{...selector,cacheStorage:null,
        fetcher:async url=>{assert.equal(url,resolved.url);return new Response(bytes,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}});},
        createObjectURL:blob=>{assert.equal(blob.size,bytes.length);allocated++;return `blob:content-check-${allocated}`;},
        revokeObjectURL:()=>{revoked++;}});
      prepared.release();prepared.release();
    }
  }finally{releaseAdmission();}
  assert.equal(allocated,12);assert.equal(revoked,12);
  return {questions:12,images:12,audioTracks:12,packId:descriptor.packId};
}
