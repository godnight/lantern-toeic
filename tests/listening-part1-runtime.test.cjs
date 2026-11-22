'use strict';
// Actual source and compiled private candidates; browser seams below only
// exercise preparation ordering, not human listening or device playback.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {IDBFactory}=require('fake-indexeddb');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..');
const plain=value=>JSON.parse(JSON.stringify(value));

test('server publishes the full pinned 325 catalogue with both old and new exact audio',()=>{
 const loader=createSourceLoader({root}),catalog=loader.load('lib/question-catalog.ts');
 const dispatch=loader.load('lib/question-audio-dispatch-v041.ts');
 const old50=loader.load('lib/question-audio-bindings-v041.ts'),old150=loader.load('lib/listening150-package.ts').LISTENING150_ADMISSION;
 const identity=loader.load('lib/practice-catalog-identity.ts');
 assert.equal(catalog.BASE_QUESTIONS.length,313);assert.equal(catalog.QUESTIONS.length,325);
 assert.equal(catalog.LISTENING_COLLECTION_QUESTIONS.length,200);
 assert.equal(catalog.QUESTIONS.filter(q=>q.part===1).length,64);
 assert.equal(catalog.QUESTIONS.filter(q=>q.part<=4).length,265);
 assert(catalog.PRACTICE_QUESTION_CATALOGS.includes(catalog.BASE_QUESTIONS));
 assert(catalog.PRACTICE_QUESTION_CATALOGS.includes(catalog.QUESTIONS));
 assert.equal(identity.practiceCatalogIdentity(catalog.BASE_QUESTIONS),catalog.QUESTION_CATALOG_VERSIONS.listening200_313);
 assert.equal(identity.practiceCatalogIdentity(catalog.QUESTIONS),catalog.QUESTION_CATALOG_VERSIONS.part1Extra325);
 for(const q of catalog.LISTENING50_QUESTIONS)assert.deepEqual(plain(dispatch.getReviewedListeningAudio(q.id)),plain(old50.getListening50Audio(q.id)));
 for(const q of old150.questions)assert.deepEqual(plain(dispatch.getReviewedListeningAudio(q.id)),plain(old150.getAudio(q.id)));
 const added=catalog.QUESTIONS.slice(313);assert.equal(added.length,12);
 for(const q of added){const audio=dispatch.getReviewedListeningAudio(q.id);assert(audio&&audio.body.naturalOnly);assert.equal(audio.body.materialId,q.id);
  assert.equal(audio.body.text.replace(/\s+/g,' ').trim(),q.transcript.replace(/\s+/g,' ').trim());
  assert.deepEqual(plain(catalog.getQuestionAudioSelection(q.id)),plain(audio.body));
  assert(!catalog.LISTENING_COLLECTION_QUESTIONS.some(row=>row.id===q.id));}
});

test('browser gates catalogue and new audio on complete twelve-question admission and explicit retry',async()=>{
 let fail=true,runs=0;const base={BASE_QUESTIONS:[]},audio={body:{text:'synthetic',naturalOnly:true}};
 const imports={
  './prepare-natural-audio-catalog':{prepareNaturalAudioCatalog:async()=>{}},
  './prepare-listening150-package':{prepareListening150Package:async()=>{}},
  './prepare-vocabulary-catalog':{prepareVocabularyCatalog:async()=>{}},
  './learning-word-views-admission':{learningWordViewSteps:function*(){return {complete:true};}},
  './question-catalog-admission':{questionCatalogSteps:function*(){return base;}},
  './listening-part1-12-package-admission':{captureCompiledPart1TwelvePackage:()=>({input:{},pins:{},extensionPins:{}})},
  './listening-part1-12-catalog':{admitPart1TwelvePackageSteps:function*(){runs++;yield;if(fail)throw Error('bad-twelve-source');return {accepted:true};}},
  './extend-part1-catalog':{extendPart1Catalog:(old,accepted)=>{assert.equal(old,base);assert.equal(accepted.accepted,true);return Object.freeze({QUESTIONS:new Array(325),getReviewedPart1Audio:id=>id==='new'?audio:null});}},
  './lesson-audio':{prepareProductLessonAudio:async()=>({status:'ready'})},
 };
 const api=createSourceLoader({root,globals:{window:{}},imports}).load('lib/prepare-study-content.ts');
 assert.throws(()=>api.readPreparedQuestionCatalog(),/仍在核验/);assert.equal(api.readPreparedPart1Audio('new'),null);
 await assert.rejects(api.prepareStudyContent(),/bad-twelve-source/);assert.throws(()=>api.readPreparedQuestionCatalog(),/仍在核验/);
 assert.equal(api.readPreparedPart1Audio('new'),null);await assert.rejects(api.prepareStudyContent(),/bad-twelve-source/);assert.equal(runs,1);
 fail=false;await api.prepareStudyContent(true);assert.equal(api.readPreparedQuestionCatalog().QUESTIONS.length,325);
 assert.equal(api.readPreparedPart1Audio('new'),audio);assert.equal(runs,2);
});

test('actual old and added question sessions preserve choices, catalogue identities and exact audio after restart',async()=>{
 const loader=createSourceLoader({root}),catalog=loader.load('lib/question-catalog.ts');
 const workflow=loader.load('lib/practice-workflow.ts'),dispatch=loader.load('lib/question-audio-dispatch-v041.ts');
 for(const which of ['old','new']){
  const factory=new IDBFactory(),attempts=new Map();
  const legacy={addAttempt:value=>{attempts.set(value.id,plain(value));return true;},readAttempt:id=>attempts.get(id),addCheckin:()=>true,readCheckin:()=>undefined};
  const options={scope:{kind:'web-owner',ownerId:'synthetic-'+which},timezone:'Asia/Shanghai',factory,name:'part1-real-'+which,legacy};
  const original=which==='old'?catalog.BASE_QUESTIONS:catalog.QUESTIONS;
  const old150=loader.load('lib/listening150-package.ts').LISTENING150_ADMISSION;
  const queue=which==='old'?[catalog.LISTENING50_QUESTIONS.find(q=>q.part===1),old150.questions.find(q=>q.part===1)]:original.slice(313,315);
  assert(queue.every(Boolean));
  const oldAudio=queue.map(q=>plain(dispatch.getReviewedListeningAudio(q.id)));
  assert(oldAudio.every(audio=>audio?.body?.naturalOnly),'The old50/old150 and new question selections require their exact natural audio');
  const versions=which==='old'?catalog.PRACTICE_QUESTION_CATALOGS.filter(rows=>rows.length<=313):catalog.PRACTICE_QUESTION_CATALOGS;
  const first=await workflow.createPracticeWorkflow({...options,questions:original,compatibleQuestionCatalogs:versions});let second;
  try{
   const started=await first.start(queue,{unitIds:queue.map(q=>'question:'+q.id)});assert.equal(started.status,'started');
   assert.equal((await first.submit(started.sessionId,queue[0].correctIndex,7,0)).status,'applied');first.close();
   second=await workflow.createPracticeWorkflow({...options,questions:catalog.QUESTIONS,compatibleQuestionCatalogs:catalog.PRACTICE_QUESTION_CATALOGS});
   const session=(await second.readProjection()).sessions.find(row=>row.id===started.sessionId);assert(session);
   assert.equal(session.catalogVersion,which==='old'?catalog.QUESTION_CATALOG_VERSIONS.listening200_313:catalog.QUESTION_CATALOG_VERSIONS.part1Extra325);
   assert.equal(session.integrityError,null);assert.deepEqual(plain(session.queue),plain(queue));
   assert.equal(session.steps[0].status,'applied');assert.equal(session.steps[1].status,'unanswered');
   assert.deepEqual(queue.map(q=>plain(dispatch.getReviewedListeningAudio(q.id))),oldAudio);
   assert.equal((await second.resume(session.id)).status,'restored');assert.equal(attempts.size,1);
  }finally{first.close();second?.close();}
 }
});
