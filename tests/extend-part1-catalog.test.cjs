'use strict';
// These synthetic records are never exposed as product content or an approval.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {IDBFactory}=require('fake-indexeddb');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..'),loader=createSourceLoader({root});
const base=loader.load('lib/question-catalog-admission.ts').completeQuestionCatalogSynchronously(),domain=loader.load('lib/domain-command.ts');
const {extendPart1Catalog}=loader.load('lib/extend-part1-catalog.ts');
const workflow=loader.load('lib/practice-workflow.ts');
const hash=value=>domain.canonicalHash(domain.canonicalJson(value)),plain=value=>JSON.parse(JSON.stringify(value));
const hex=value=>domain.canonicalHash(value);
function fixture(){
 const source=base.BASE_QUESTIONS.find(q=>q.part===1&&!q.groupId);
 assert(source);const questions=Array.from({length:12},(_,i)=>({...plain(source),id:`synthetic-part1-${i+1}`}));
 const rows=questions.map((q,i)=>[q.id,{body:{audioKey:hex(`key-${i}`),materialId:q.id,segmentId:'body',voiceProfileId:'synthetic-voice',contextHash:hex(`context-${i}`),text:'synthetic audio',label:'audio',naturalOnly:true}}]);
 const map=new Map(rows),combined=hash([...base.BASE_QUESTIONS,...questions]);
 const admitted={questions,combined325CanonicalSha256:combined,stats:{questions:12,materials:12,bodyTracks:12,imageCount:12},getAudio:id=>map.get(id)??null};
 const pins={base313CanonicalSha256:base.QUESTION_CATALOG_VERSIONS.listening200_313.slice('practice-v1:'.length),combined325CanonicalSha256:combined,audioBindingsCanonicalSha256:hash(rows)};
 return {questions,rows,admitted,pins};
}

test('extends only the sealed old 313, preserving its 200 collection and audio while adding twelve Part 1 questions',()=>{
 const f=fixture(),result=extendPart1Catalog(base,f.admitted,f.pins);
 assert.equal(result.BASE_QUESTIONS,base.BASE_QUESTIONS);assert.equal(result.BASE_QUESTIONS.length,313);
 assert.equal(result.LISTENING_COLLECTION_QUESTIONS,base.LISTENING_COLLECTION_QUESTIONS);
 assert.equal(result.LISTENING_COLLECTION_STATS,base.LISTENING_COLLECTION_STATS);
 assert.equal(result.LISTENING_COLLECTION_QUESTIONS.length,200);
 assert.equal(result.QUESTIONS.length,325);assert.equal(result.QUESTIONS.filter(q=>q.part<=4).length,265);
 assert.equal(result.QUESTIONS.filter(q=>q.part===1).length,64);
 assert(Object.isFrozen(result.QUESTIONS));assert(result.QUESTIONS.every(q=>Object.isFrozen(q)));
 assert.equal(workflow.practiceCatalogVersion(result.BASE_QUESTIONS),base.QUESTION_CATALOG_VERSIONS.listening200_313);
 assert.equal(workflow.practiceCatalogVersion(result.QUESTIONS),result.QUESTION_CATALOG_VERSIONS.part1Extra325);
 assert(result.PRACTICE_QUESTION_CATALOGS.includes(base.BASE_QUESTIONS));assert(result.PRACTICE_QUESTION_CATALOGS.includes(result.QUESTIONS));
 assert.equal(result.QUESTION_CATALOG_STATS.availableQuestions,325);
 assert.equal(result.QUESTION_CATALOG_STATS.availableUnits,base.QUESTION_CATALOG_STATS.availableUnits+12);
 assert.equal(result.QUESTION_CATALOG_STATS.newPart1Questions,12);
 for(const [id,audio] of f.rows){assert.deepEqual(plain(result.getReviewedPart1Audio(id)),audio);assert.deepEqual(plain(result.getQuestionAudioSelection(id)),audio.body);}
 const original=base.BASE_QUESTIONS.find(q=>base.getQuestionAudioSelection(q.id));assert(original);
 assert.deepEqual(plain(result.getQuestionAudioSelection(original.id)),plain(base.getQuestionAudioSelection(original.id)));
 assert.equal(result.getReviewedPart1Audio(original.id),null);
 // Subsequent changes to the synthetic caller cannot replace committed objects.
 f.questions[0].title='changed';f.rows[0][1].body.text='changed';
 assert.notEqual(result.QUESTIONS[313].title,'changed');assert.notEqual(result.getReviewedPart1Audio(f.questions[0].id).body.text,'changed');
});

test('separate trusted pins reject altered base, forged extra content or substituted audio',()=>{
 let f=fixture();assert.throws(()=>extendPart1Catalog({...base,BASE_QUESTIONS:[...base.BASE_QUESTIONS]},f.admitted,f.pins),/base-catalog/);
 f=fixture();assert.throws(()=>extendPart1Catalog(base,f.admitted,{...f.pins,base313CanonicalSha256:'0'.repeat(64)}),/base-catalog/);
 f=fixture();f.questions[0].id=base.BASE_QUESTIONS[0].id;assert.throws(()=>extendPart1Catalog(base,f.admitted,f.pins),/question-identity/);
 f=fixture();f.questions[0].part=2;assert.throws(()=>extendPart1Catalog(base,f.admitted,f.pins),/question-identity/);
 f=fixture();f.questions[0].prompt='changed';assert.throws(()=>extendPart1Catalog(base,f.admitted,f.pins),/combined-digest/);
 f=fixture();f.rows[0][1].body.text='substituted';assert.throws(()=>extendPart1Catalog(base,f.admitted,f.pins),/audio-digest/);
 f=fixture();f.rows[0][1].body.naturalOnly=false;assert.throws(()=>extendPart1Catalog(base,f.admitted,f.pins),/audio-missing/);
 f=fixture();assert.throws(()=>extendPart1Catalog(base,f.admitted,{...f.pins,combined325CanonicalSha256:'0'.repeat(64)}),/admission/);
});

test('a persisted answered and unanswered old session resumes under the 325 catalogue',async()=>{
 const f=fixture(),extended=extendPart1Catalog(base,f.admitted,f.pins),factory=new IDBFactory(),attempts=new Map();
 const legacy={addAttempt:value=>{attempts.set(value.id,plain(value));return true;},readAttempt:id=>attempts.get(id),addCheckin:()=>true,readCheckin:()=>undefined};
 const options={scope:{kind:'web-owner',ownerId:'synthetic-extension-owner'},timezone:'Asia/Shanghai',factory,name:'extend-part1-resume',legacy};
 const first=await workflow.createPracticeWorkflow({...options,questions:base.BASE_QUESTIONS,compatibleQuestionCatalogs:base.PRACTICE_QUESTION_CATALOGS});let second;
 try{
  const queue=base.BASE_QUESTIONS.filter(q=>q.part===1&&!q.groupId).slice(0,2);
  const started=await first.start(queue,{unitIds:queue.map(q=>'question:'+q.id)});assert.equal(started.status,'started');
  assert.equal((await first.submit(started.sessionId,queue[0].correctIndex,7,0)).status,'applied');first.close();
  second=await workflow.createPracticeWorkflow({...options,questions:extended.QUESTIONS,compatibleQuestionCatalogs:extended.PRACTICE_QUESTION_CATALOGS});
  const session=(await second.readProjection()).sessions.find(row=>row.id===started.sessionId);assert(session);
  assert.equal(session.catalogVersion,base.QUESTION_CATALOG_VERSIONS.listening200_313);assert.equal(session.integrityError,null);
  assert.deepEqual(plain(session.questionIds),plain(queue.map(q=>q.id)));
  assert.equal(session.steps[0].status,'applied');assert.equal(session.steps[1].status,'unanswered');
  assert.deepEqual(plain(session.queue),plain(queue));
  assert.equal((await second.resume(session.id)).status,'restored');assert.equal(attempts.size,1);
 }finally{first.close();second?.close();}
});
