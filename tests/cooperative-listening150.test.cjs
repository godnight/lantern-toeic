'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs'),{createSyntheticListening150}=require('./fixtures/listening200-synthetic.cjs'),root=path.resolve(__dirname,'..');
const actual=createSourceLoader({root}),domain=actual.load('lib/domain-command.ts'),index=actual.load('lib/natural-audio-catalog-index.ts');
const legacy=createSourceLoader({root,imports:{'./listening150-package':{LISTENING150_ADMISSION:null}}}).load('lib/question-catalog.ts');
function fixture(){return createSyntheticListening150({legacy163:legacy.QUESTIONS,canonicalHash:domain.canonicalHash,canonicalJson:domain.canonicalJson,naturalAudioSelectorDigest:index.naturalAudioSelectorDigest});}
function validator(f,imports={}){return createSourceLoader({root,imports:{'./natural-audio-catalog-index':{compiledNaturalAudioCatalog:f.index,naturalAudioSelectorDigest:index.naturalAudioSelectorDigest},...imports}}).load('lib/listening150-catalog.ts');}
function drain(steps){let next=steps.next();while(!next.done)next=steps.next();return next.value;}
function deferred(){let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};}

test('150 admission captures input and policy before its first yield and returns only the complete frozen package',async()=>{
 const f=fixture(),api=validator(f),original=f.input.questions[0].prompt,steps=api.admitListening150PackageSteps(f.input,f.policy);
 f.input.questions[0].prompt+=' changed after call';f.policy.questionsCanonicalSha256='0'.repeat(64);f.input.media.units.pop();
 const runner=actual.load('lib/cooperative-task.ts');let yields=0;const result=await runner.runCooperativeSteps(steps,async()=>{yields++;});
 assert(yields>0);assert.equal(result.questions.length,150);assert.equal(result.questions[0].prompt,original);assert.equal(result.stats.materials,102);assert(Object.isFrozen(result)&&Object.isFrozen(result.questions)&&Object.isFrozen(result.questions[0]));
 assert(result.getAudio(result.questions[0].id));assert.equal(result.getAudio('missing'),null);
});

test('complete questions, gate and media digests are checked separately before per-unit preparation',()=>{
 const f=fixture(),digests=[],api=validator(f,{'./domain-command':{...domain,canonicalHash:text=>{const hash=domain.canonicalHash(text);digests.push(hash);return hash;}}});
 const steps=api.admitListening150PackageSteps(f.input,f.policy);assert.equal(steps.next().done,false);assert.equal(digests.length,0);
 for(const expected of [f.policy.questionsCanonicalSha256,f.policy.gateCanonicalSha256,f.policy.mediaCanonicalSha256]){assert.equal(steps.next().done,false);assert.equal(digests.at(-1),expected);}
 let checkpoints=4,next=steps.next();while(!next.done){checkpoints++;next=steps.next();}
 assert(checkpoints>250,'Full units/questions have real internal checkpoints, not a single async wrapper');assert.equal(next.value.questions.length,150);
});

test('late validation failure never releases a 149-question prefix or a false old catalogue',async()=>{
 const f=fixture();f.input.questions.pop();const hash=value=>domain.canonicalHash(domain.canonicalJson(value));
 f.policy.questionsCanonicalSha256=hash(f.input.questions);
 const api=validator(f),runner=actual.load('lib/cooperative-task.ts');
 await assert.rejects(runner.runCooperativeSteps(api.admitListening150PackageSteps(f.input,f.policy)),/question-count-or-identity/);
});

test('package readers share pending work, stay blocked after failure and retry only explicitly',async()=>{
 const hold=deferred();let fail=true,runs=0;const ready=Object.freeze({questions:Object.freeze([{id:'complete'}])});
 const api=createSourceLoader({root,globals:{window:{}},imports:{
  './prepare-natural-audio-catalog':{prepareNaturalAudioCatalog:async()=>{}},
  './listening150-package-admission':{captureCompiledListening150Package:()=>({input:{},pins:{}})},
  './listening150-catalog':{admitListening150PackageSteps:function*(){runs++;yield;if(fail)throw Error('invalid complete package');return ready;}},
  './cooperative-task':{runCooperativeSteps:async steps=>{await hold.promise;return drain(steps);}},
 }}).load('lib/prepare-listening150-package.ts');
 assert.throws(api.readPreparedListening150Package,/仍在核验/);assert.throws(()=>api.installServerListening150Package(()=>ready),/仍在核验/);
 const first=api.prepareListening150Package();assert.equal(first,api.prepareListening150Package());assert.throws(api.readPreparedListening150Package,/仍在核验/);
 hold.resolve();await assert.rejects(first,/invalid complete package/);assert.throws(api.readPreparedListening150Package,/仍在核验/);await assert.rejects(api.prepareListening150Package(),/invalid complete package/);assert.equal(runs,1);
 fail=false;const retry=api.prepareListening150Package(true);assert.equal(api.prepareListening150Package(),retry);assert.equal(await retry,ready);assert.equal(api.readPreparedListening150Package(),ready);assert.equal(runs,2);
});

test('actual complete client package preserves all frozen394 questions, track selectors, pins and statistics',async()=>{
 const loader=createSourceLoader({root,globals:{window:{}}}),prepare=loader.load('lib/prepare-listening150-package.ts');
 const task=prepare.prepareListening150Package();assert.throws(prepare.readPreparedListening150Package,/仍在核验/);const value=await task;
 assert.equal(loader.load('lib/listening150-package.ts').LISTENING150_ADMISSION,value);
 const snapshot={questions:value.questions,combined:value.combined313CanonicalSha256,stats:value.stats,audio:value.questions.map(q=>[q.id,value.getAudio(q.id)])};
 // Captured from the actual frozen394 synchronous source before this layer.
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),'b2fa50a562a65b8f8f5affcb8bf3ceedf9da6d6abbdf752016f73c36feb71e67');
 assert.equal(value.questions.length,150);assert.equal(value.stats.bodyTracks,102);assert.equal(value.stats.questionTracks,72);assert.equal(value.stats.imageCount,42);
});


test('compiled early source snapshots cannot mutate or replace authority for another admission',()=>{
 const source=actual.load('lib/listening150-package-admission.ts'),first=source.captureCompiledListening150Package(),second=source.captureCompiledListening150Package();
 assert.notEqual(first,second);assert.notEqual(first.input.questions,second.input.questions);const original=second.pins.questionsCanonicalSha256,question=second.input.questions[0].prompt;
 first.pins.questionsCanonicalSha256='0'.repeat(64);first.input.questions[0].prompt+=' modified';
 const third=source.captureCompiledListening150Package();assert.equal(third.pins.questionsCanonicalSha256,original);assert.equal(third.input.questions[0].prompt,question);
});
