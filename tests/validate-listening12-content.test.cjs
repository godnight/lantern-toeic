'use strict';
// These checks read the actual repository source, 12 PNGs and 14-file audio
// pack. Faults are injected into in-memory reads; source files are never edited.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..'),loader=createSourceLoader({root});
const candidate=loader.load('lib/listening-part1-12-package-admission.ts').captureCompiledPart1TwelvePackage();
const imageName=path.posix.basename(candidate.input.questions[0].image);
const audioName=candidate.input.media.units[0].body.mp3Sha256+'.mp3';
const helper=import(pathToFileURL(path.join(root,'scripts/validate-listening12.mjs')).href);
const run=async readBytes=>(await helper).validateListening12Assets({repoRoot:root,loader,...(readBytes?{readBytes}:{})});
const fault=(target,mutation)=>async file=>{
 const bytes=await fs.readFile(file);
 return path.basename(file)===target?mutation(bytes):bytes;
};

test('actual pinned images and tracks pass the real loader and audio registry',async()=>{
 const result=await run();
 assert.deepEqual({questions:result.questions,images:result.images,audioTracks:result.audioTracks},{questions:12,images:12,audioTracks:12});
 assert.equal(result.packId,candidate.pins.packDescriptor.packId);
});

test('a missing reviewed image cannot be admitted by metadata alone',async()=>{
 await assert.rejects(run(fault(imageName,()=>{throw Error('synthetic missing image');})),/synthetic missing image/);
});

test('a corrupted reviewed image is rejected by its actual byte hash',async()=>{
 await assert.rejects(run(fault(imageName,bytes=>{const bad=Buffer.from(bytes);bad[bad.length-1]^=1;return bad;})),/New image hash changed/);
});

test('a corrupted audio track cannot reach the real player registry',async()=>{
 await assert.rejects(run(fault(audioName,bytes=>{const bad=Buffer.from(bytes);bad[bad.length-1]^=1;return bad;})),/Audio hash changed/);
});

test('a missing audio track cannot be treated as an available question',async()=>{
 await assert.rejects(run(fault(audioName,()=>{throw Error('synthetic missing audio');})),/synthetic missing audio/);
});

test('a corrupted audio manifest fails before the player is initialized',async()=>{
 await assert.rejects(run(fault('manifest.json',bytes=>{const bad=Buffer.from(bytes);bad[bad.length-1]^=1;return bad;})),/Audio manifest hash changed/);
});

test('a missing audio admission table fails closed',async()=>{
 await assert.rejects(run(fault('admission.json',()=>{throw Error('synthetic missing admission');})),/synthetic missing admission/);
});

test('private machine review cannot be reported as human approval',async()=>{
 const invalid=structuredClone(candidate);invalid.input.gate.humanReviewed=true;
 const guarded={load(name){return name==='lib/listening-part1-12-package-admission.ts'?{captureCompiledPart1TwelvePackage:()=>invalid}:loader.load(name);}};
 await assert.rejects((await helper).validateListening12Assets({repoRoot:root,loader:guarded}),/Model image review is not human review/);
});
