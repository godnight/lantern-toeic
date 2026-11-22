'use strict';
// Completely synthetic material. This fixture neither grants any content
// rights nor represents real image review, recorded audio, or product pins.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..'),source=createSourceLoader({root}),domain=source.load('lib/domain-command.ts');
const hash=value=>domain.canonicalHash(domain.canonicalJson(value));
const selector=(textSha256,assetKey,materialId,segmentId,voiceProfileId,contextHash)=>hash({assetKey,materialId,segmentId,voiceProfileId,contextHash,textSha256});
const copy=value=>JSON.parse(JSON.stringify(value));

function fixture(){
 const base=Array.from({length:313},(_,i)=>({id:`old-${String(i).padStart(3,'0')}`,part:1}));
 const manifestSha256=hash('fake manifest'),sourceQuestionsSha256=hash('fake source'),sourceVersion='synthetic-part1-r1';
 const audioManifest=hash('fake audio manifest'),packId='v040-natural-'+audioManifest.slice(0,12);
 const descriptor={packId,manifestSha256:audioManifest,manifestPath:`/audio/natural/${packId}/manifest.json`,manifestFileSha256:hash('manifest file'),manifestBytes:1000,
  admissionPath:`/audio/natural/${packId}/admission.json`,admissionFileSha256:hash('admission file'),admissionBytes:1000,clipCount:12,declaredBytes:12000,memberCount:12};
 const index={schemaVersion:1,catalogId:'synthetic',basePackId:packId,packs:[copy(descriptor)],routes:{},bindings:{},wordExceptions:[],blockedAssetSha256:[],blockedContexts:[]};
 const questions=[],gates=[],units=[];
 for(let i=1;i<=12;i++){
  const id=`p1-fresh-${String(i).padStart(2,'0')}`,imageHash=hash('image:'+id),options=[`person ${i} walks.`,`person ${i} sits.`,`person ${i} cooks.`,`person ${i} sleeps.`];
  const transcript=options.map((s,j)=>`${'ABCD'[j]}. ${s}`).join('\n'),text=transcript.replace(/\s+/g,' ');
  const q={id,part:1,title:`Synthetic ${i}`,prompt:'Select the statement.',options,correctIndex:i%4,explanation:'Synthetic explanation',evidence:'Synthetic evidence',skill:'test',difficulty:'test',translation:'Synthetic translation',transcript,image:`/part1-new/${imageHash}.png`};
  const materialId=id,contextHash=hash('context:'+id),audioKey=hash('audio:'+id),mp3Sha256=hash('mp3:'+id),mediaTextSha256=domain.canonicalHash(text);
  const audio={audioKey,materialId,segmentId:'body',voiceProfileId:'synthetic-voice',contextHash};
  index.routes[audioKey]=[[0,selector(mediaTextSha256,audioKey,materialId,'body',audio.voiceProfileId,contextHash),mediaTextSha256,mp3Sha256,audioKey,contextHash,materialId]];
  questions.push(q);gates.push({qid:id,questionCanonicalSha256:hash(q),textReviewSha256:hash('text-review:'+id),image:{url:q.image,sha256:imageHash,bytes:1000,width:1536,height:1024,reviewSha256:hash('visual-review:'+id),status:'PASS_EXACT_SELECTED_IMAGE_AND_OPTIONS'}});
  units.push({qid:id,materialId,contextHash,packId,body:{text,label:'synthetic only',mediaTextSha256,mp3Sha256,sourceWavSha256:hash('wav:'+id),audio}});
 }
 const gate={schemaVersion:1,sourceVersion,sourceManifestSha256:manifestSha256,sourceQuestionsSha256,questions:gates};
 const media={schemaVersion:1,contentVersion:sourceVersion,sourceManifestSha256:manifestSha256,sourceQuestionsSha256,distribution:'private-practice',formalAllowed:false,publishAllowed:false,humanListeningPerformed:false,questionIds:questions.map(q=>q.id),units};
 const input={questions,gate,media},pins={sourceVersion,sourceManifestSha256:manifestSha256,sourceQuestionsSha256,questionsCanonicalSha256:hash(questions),gateCanonicalSha256:hash(gate),mediaCanonicalSha256:hash(media),base313CanonicalSha256:hash(base),combined325CanonicalSha256:hash([...base,...questions]),questionIdPrefix:'p1-fresh-',imagePathPrefix:'/part1-new/',imageExtension:'png',packDescriptor:copy(descriptor)};
 return {input,pins,base,index};
}
function validator(f){return createSourceLoader({root,imports:{'./natural-audio-catalog-index':{compiledNaturalAudioCatalog:f.index,naturalAudioSelectorDigest:selector}}}).load('lib/listening-part1-12-catalog.ts');}
// Re-pinning is used only to test structural defenses against a deliberately
// inconsistent fake publisher, not to establish authority in the product.
function repin(f){f.pins.questionsCanonicalSha256=hash(f.input.questions);f.pins.gateCanonicalSha256=hash(f.input.gate);f.pins.mediaCanonicalSha256=hash(f.input.media);f.pins.combined325CanonicalSha256=hash([...f.base,...f.input.questions]);}
function rejectAfterChange(change,expected){const f=fixture();change(f);repin(f);assert.throws(()=>validator(f).admitPart1TwelvePackage(f.input,f.pins,f.base),expected);}
// Keep every synthetic identity consistent, so oversized fields are rejected
// by the player's limits rather than merely failing an unrelated pinned hash.
function synchronizeFirst(f){
 const q=f.input.questions[0],gate=f.input.gate.questions[0],unit=f.input.media.units[0],track=unit.body,a=track.audio;
 q.transcript=q.options.map((s,i)=>`${'ABCD'[i]}. ${s}`).join('\n');track.text=q.transcript.replace(/\s+/g,' ');
 gate.questionCanonicalSha256=hash(q);track.mediaTextSha256=domain.canonicalHash(track.text);a.materialId=unit.materialId;
 const route=f.index.routes[a.audioKey][0];route[1]=selector(track.mediaTextSha256,a.audioKey,a.materialId,a.segmentId,a.voiceProfileId,a.contextHash);
 route[2]=track.mediaTextSha256;route[5]=a.contextHash;route[6]=a.materialId;repin(f);
}
function setAudioLength(f,length){const q=f.input.questions[0];q.options[0]='x';
 const current=q.options.map((s,i)=>`${'ABCD'[i]}. ${s}`).join(' ').length;
 q.options[0]='x'.repeat(length-current+1);synchronizeFirst(f);}

test('only the complete pinned 12-question batch is returned, deeply frozen and bound to audio',()=>{
 const f=fixture(),api=validator(f),steps=api.admitPart1TwelvePackageSteps(f.input,f.pins,f.base),original=f.input.questions[0].title;
 f.input.questions[0].title='changed after capture';f.pins.combined325CanonicalSha256='0'.repeat(64);f.base[0].id='changed';
 let next=steps.next(),yields=0;while(!next.done){yields++;next=steps.next();}
 assert(yields>=16);const batch=next.value;assert.equal(batch.questions.length,12);assert.equal(batch.questions[0].title,original);
 assert.deepEqual(copy(batch.stats),{questions:12,materials:12,bodyTracks:12,imageCount:12});
 assert(Object.isFrozen(batch)&&Object.isFrozen(batch.questions)&&Object.isFrozen(batch.questions[0])&&Object.isFrozen(batch.questions[0].options));
 const audio=batch.getAudio(batch.questions[0].id);assert.equal(audio.body.naturalOnly,true);assert(Object.isFrozen(audio.body));assert.equal(batch.getAudio('not-in-batch'),null);
});

test('untrusted changes cannot replace independent pins or the old 313 catalog',()=>{
 for(const change of [f=>f.input.questions[0].title='changed',f=>f.input.gate.questions[0].image.bytes++,f=>f.input.media.units[0].body.text+=' changed',f=>f.base[0].id='other']){
  const f=fixture();change(f);assert.throws(()=>validator(f).admitPart1TwelvePackage(f.input,f.pins,f.base),/sealed-|base-catalog-changed/);
 }
});

test('duplicate/old identities, incomplete batches and invalid Part1 structures fail atomically',()=>{
 rejectAfterChange(f=>f.input.questions.pop(),/question-count-or-identity/);
 rejectAfterChange(f=>{f.input.questions[1].id=f.input.questions[0].id;},/question-count-or-identity/);
 rejectAfterChange(f=>{f.input.questions[0].id=f.base[0].id;},/question-count-or-identity/);
 rejectAfterChange(f=>{f.base[0].id=f.input.questions[0].id;f.pins.base313CanonicalSha256=hash(f.base);},/question-count-or-identity/);
 rejectAfterChange(f=>{f.input.questions[0].part=2;},/question-shape/);
 rejectAfterChange(f=>{f.input.questions[0].groupId='improper';},/question-shape/);
 rejectAfterChange(f=>{f.input.questions[0].correctIndex=4;},/question-shape/);
 rejectAfterChange(f=>{f.input.questions[0].options[1]=f.input.questions[0].options[0];},/question-shape/);
});

test('each image and text clearance must be complete, distinct and match the actual question',()=>{
 rejectAfterChange(f=>{f.input.gate.questions[0].image.bytes=0;},/image-or-question-clearance/);
 rejectAfterChange(f=>{f.input.gate.questions[0].image.height=0;},/image-or-question-clearance/);
 rejectAfterChange(f=>{f.input.gate.questions[0].image.reviewSha256='';},/image-or-question-clearance/);
 rejectAfterChange(f=>{f.input.gate.questions[0].image.url='/another-path.png';},/image-or-question-clearance/);
 rejectAfterChange(f=>{delete f.input.gate.questions[0].image;},/image-or-question-clearance/);
 rejectAfterChange(f=>{f.input.gate.questions[0].qid=f.input.gate.questions[1].qid;},/duplicate-clearance/);
 rejectAfterChange(f=>{f.input.questions[0].options[0]='A modified option.';},/image-or-question-clearance/);
 rejectAfterChange(f=>{const q=f.input.questions[1],g=f.input.gate.questions[1],first=f.input.gate.questions[0].image; q.image=first.url;g.image=copy(first);g.questionCanonicalSha256=hash(q);},/image-or-question-clearance/);
});

test('full A–D audio text and exact compiled selector, context and track must match',()=>{
 rejectAfterChange(f=>{f.input.media.units[0].body.text='A. Only one spoken option.';},/audio-selector-or-text/);
 rejectAfterChange(f=>{f.input.media.units[0].body.mediaTextSha256='0'.repeat(64);},/audio-selector-or-text/);
 rejectAfterChange(f=>{f.input.media.units[0].body.audio.contextHash='0'.repeat(64);},/audio-selector-or-text/);
 rejectAfterChange(f=>{f.input.media.units[0].body.sourceWavSha256='';},/audio-selector-or-text/);
 rejectAfterChange(f=>{f.input.media.units[0].body.mp3Sha256='0'.repeat(64);},/compiled-route-or-pair/);
 rejectAfterChange(f=>{const unit=f.input.media.units[0];f.index.routes[unit.body.audio.audioKey].push(copy(f.index.routes[unit.body.audio.audioKey][0]));},/compiled-route-or-pair/);
 rejectAfterChange(f=>{f.index.blockedAssetSha256.push(f.input.media.units[0].body.mp3Sha256);},/compiled-route-or-pair/);
 rejectAfterChange(f=>{const unit=f.input.media.units[0];f.index.blockedContexts.push([unit.materialId,unit.contextHash]);},/compiled-route-or-pair/);
 rejectAfterChange(f=>{f.input.media.units.pop();},/media-source-or-completeness/);
});

test('player text, material and voice length limits match exact accepted boundaries',()=>{
 const atLimit=fixture();setAudioLength(atLimit,12000);
 atLimit.input.media.units[0].materialId='m'.repeat(200);atLimit.input.media.units[0].body.audio.voiceProfileId='v'.repeat(160);synchronizeFirst(atLimit);
 assert.equal(atLimit.input.media.units[0].body.text.length,12000);
 assert.equal(validator(atLimit).admitPart1TwelvePackage(atLimit.input,atLimit.pins,atLimit.base).questions.length,12);
 const tooLongText=fixture();setAudioLength(tooLongText,12001);
 assert.throws(()=>validator(tooLongText).admitPart1TwelvePackage(tooLongText.input,tooLongText.pins,tooLongText.base),/audio-selector-or-text/);
 for(const change of [f=>{f.input.media.units[0].materialId='m'.repeat(201);},f=>{f.input.media.units[0].body.audio.voiceProfileId='v'.repeat(161);}]){
  const f=fixture();change(f);synchronizeFirst(f);
  assert.throws(()=>validator(f).admitPart1TwelvePackage(f.input,f.pins,f.base),/audio-selector-or-text/);
 }
});

test('private scope, human-listening attestation and compiled pack identity cannot be fabricated by omission',()=>{
 rejectAfterChange(f=>{f.input.media.publishAllowed=true;},/media-source-or-completeness/);
 rejectAfterChange(f=>{f.input.media.humanListeningPerformed=true;},/media-source-or-completeness/);
 rejectAfterChange(f=>{f.pins.packDescriptor.packId='wrong';},/compiled-pack-identity/);
 const f=fixture();f.input.media.humanListeningPerformed=true;f.input.media.listeningReviewSha256=hash('synthetic reviewer record');repin(f);
 assert.equal(validator(f).admitPart1TwelvePackage(f.input,f.pins,f.base).questions.length,12);
});
