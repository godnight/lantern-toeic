'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs'),root=path.resolve(__dirname,'..');
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function drain(steps){let next=steps.next();while(!next.done)next=steps.next();return next.value;}
function deferred(){let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};}

test('cooperative sealing publishes no identity before full digest and caches only a matching deep-frozen graph',()=>{
 const base=createSourceLoader({root}).load('lib/domain-command.ts');let hashes=0;
 const loader=createSourceLoader({root,imports:{'./domain-command':{...base,canonicalHash:text=>{hashes++;return base.canonicalHash(text);}}}}),api=loader.load('lib/practice-catalog-identity.ts');
 const rows=[{id:'original',options:['A','汉🙂'],optional:undefined}],expected='practice-v1:'+base.canonicalHash(base.canonicalJson(JSON.parse(JSON.stringify(rows))));
 const pending=api.sealPracticeCatalogSteps(rows,expected);pending.next();
 assert.equal(api.practiceCatalogIdentity(rows),expected);assert.equal(hashes,1,'Pending preparation cannot prefill the expected identity');
 drain(pending);assert(Object.isFrozen(rows)&&Object.isFrozen(rows[0])&&Object.isFrozen(rows[0].options));
 assert.equal(hashes,2,'The complete original SHA path ran before caching');
 for(let i=0;i<10;i++)assert.equal(api.practiceCatalogIdentity(rows),expected);assert.equal(hashes,2);
 const wrong=[{id:'changed'}];assert.throws(()=>drain(api.sealPracticeCatalogSteps(wrong,expected)),/snapshot-mismatch/);
 assert.notEqual(api.practiceCatalogIdentity(wrong),expected);assert.equal(hashes,4,'Rejected snapshots do not enter the cache');
 const cancelled=[{id:'cancelled'}],cancel=api.sealPracticeCatalogSteps(cancelled,expected);cancel.next();cancel.return();api.practiceCatalogIdentity(cancelled);assert.equal(hashes,5);
});

test('cooperative deep freeze rejects accessors, symbols and non-JSON prototypes before reading executable data',()=>{
 const api=createSourceLoader({root}).load('lib/practice-catalog-identity.ts');let reads=0;
 const accessor={};Object.defineProperty(accessor,'prompt',{enumerable:true,get(){reads++;return 'unsafe';}});
 for(const value of [accessor,{[Symbol('hidden')]:true},new Date()])assert.throws(()=>drain(api.sealPracticeCatalogSteps([value],'untrusted')),/not-immutable-json/);
 assert.equal(reads,0);
});

test('locator captures the complete private snapshot before its first yield and preserves every held route',async()=>{
 const fs=require('node:fs'),input=JSON.parse(fs.readFileSync(path.join(root,'content/natural-audio-catalog-v1.json'))),before=JSON.stringify(input);
 const loader=createSourceLoader({root}),admission=loader.load('lib/natural-audio-catalog-admission.ts'),runner=loader.load('lib/cooperative-task.ts');
 const steps=admission.naturalAudioCatalogSteps(input);input.catalogId='changed-after-call';input.routes={};input.blockedContexts=[];
 let slices=0;const index=await runner.runCooperativeSteps(steps,async()=>{slices++;});
 assert(slices>1);assert.equal(JSON.stringify(index),before);assert(Object.isFrozen(index.routes)&&Object.isFrozen(index.packs)&&Object.isFrozen(index.blockedContexts));
});

test('locator shares pending work and a failed complete validation requires explicit retry without an empty ready value',async()=>{
 let fail=true,runs=0;const hold=deferred(),snapshot={schemaVersion:1};
 const api=createSourceLoader({root,globals:{window:{}},imports:{'./natural-audio-catalog-admission':{naturalAudioCatalogSteps:function*(){runs++;yield;if(fail)throw Error('invalid route');return snapshot;}},'./cooperative-task':{runCooperativeSteps:async steps=>{await hold.promise;return drain(steps);}}}}).load('lib/prepare-natural-audio-catalog.ts');
 assert.throws(api.readPreparedNaturalAudioCatalog,/仍在核验/);const first=api.prepareNaturalAudioCatalog();assert.equal(first,api.prepareNaturalAudioCatalog());
 assert.throws(api.readPreparedNaturalAudioCatalog,/仍在核验/);hold.resolve();await assert.rejects(first,/invalid route/);assert.throws(api.readPreparedNaturalAudioCatalog,/仍在核验/);
 await assert.rejects(api.prepareNaturalAudioCatalog(),/invalid route/);assert.equal(runs,1);fail=false;
 const retry=api.prepareNaturalAudioCatalog(true);assert.equal(retry,api.prepareNaturalAudioCatalog());assert.equal((await retry).index,snapshot);assert.equal(runs,2);
});

test('shared preparation overlaps independent questions and vocabulary but gates views, mounting and explicit retry',async()=>{
 const hold=deferred(),order=[],marks=[];let fail=true,viewRuns=0;
 const api=createSourceLoader({root,globals:{window:{},performance:{now:()=>performance.now(),mark:name=>marks.push(name)}},imports:{
  './prepare-natural-audio-catalog':{prepareNaturalAudioCatalog:async()=>{}},
  './lesson-audio':{prepareProductLessonAudio:async()=>({status:'ready'})},
  './prepare-vocabulary-catalog':{prepareVocabularyCatalog:async()=>{await hold.promise;order.push('vocabulary');}},
  './question-catalog-admission':{questionCatalogSteps:function*(){order.push('questions');yield;return {validated:true};}},
  './learning-word-views-admission':{learningWordViewSteps:function*(){order.push('views');viewRuns++;yield;if(fail)throw Error('view failure');return {complete:true};}},
 }}).load('lib/prepare-study-content.ts');
 const first=api.prepareStudyContent();assert.equal(api.prepareStudyContent(),first);assert.deepEqual(order,[]);
 assert.throws(api.readPreparedQuestionCatalog,/仍在核验/);assert.throws(api.readPreparedLearningWordViews,/仍在核验/);
 hold.resolve();await assert.rejects(first,/view failure/);assert(order.indexOf('views')>order.indexOf('vocabulary'));assert.equal(order.filter(item=>item==='questions').length,1);assert.equal(api.readPreparedQuestionCatalog().validated,true);assert.throws(api.readPreparedLearningWordViews,/仍在核验/);
 await assert.rejects(api.prepareStudyContent(),/view failure/);assert.equal(viewRuns,1);assert(!marks.includes('lantern:required-content-ready'));fail=false;await api.prepareStudyContent(true);assert.equal(viewRuns,2);assert.equal(api.readPreparedLearningWordViews().complete,true);assert.equal(marks.filter(name=>name==='lantern:required-content-ready').length,1);
});

test('complete browser preparation retains frozen practice pins and both exact historical word-view orders',async()=>{
 const loader=createSourceLoader({root,globals:{window:{}},imports:{'./lesson-audio':{prepareProductLessonAudio:async()=>({status:'ready'})}}}),api=loader.load('lib/prepare-study-content.ts');
 await api.prepareStudyContent();
 const questions=loader.load('lib/question-catalog.ts'),identity=loader.load('lib/practice-catalog-identity.ts'),domain=loader.load('lib/domain-command.ts'),views=loader.load('lib/learning-word-views.ts');
 assert.equal(questions.QUESTIONS.length,313);assert.equal(questions.LISTENING_COLLECTION_QUESTIONS.length,200);
 assert.equal(questions.PRACTICE_QUESTION_CATALOGS.length,6);
 for(const rows of questions.PRACTICE_QUESTION_CATALOGS){assert(Object.isFrozen(rows)&&Object.isFrozen(rows[0]));assert.equal(identity.practiceCatalogIdentity(rows),'practice-v1:'+domain.canonicalHash(domain.canonicalJson(JSON.parse(JSON.stringify(rows)))));}
 // These digests came from the actual frozen d73 source declarations, before
 // this layer was implemented (cold-ready/views-baseline.json).
 assert.equal(views.learningWords.length,4256);assert.equal(sha(views.learningWords),'5f39e1655898064ede980c1e6d60237ca1e5e68bbf4aa13082ef08182505b204');
 assert.equal(sha(views.WORKFLOW_WORDS),'224a28c578a9aa29cd05eac008dbd139b2a66918d5f628b52d97173ac48c174e');
 assert.equal(sha(views.SCENE_WORDS),'4fea17a70a5df907d5e7171b20370d4ec386a989335095feadc44d7c486823ff');
 assert.equal(sha(views.EXPRESSION_WORDS),'c120ccda6b60f8c7bf4826930518e56a7a63efd47c509fbc8769198044399fa1');
});


test('explicit legacy recovery prepares workflow only, without practice registration or audio activation',async()=>{
 let vocab=0,view=0,questions=0,audio=0;
 const api=createSourceLoader({root,globals:{window:{}},imports:{
  './prepare-vocabulary-catalog':{prepareVocabularyCatalog:async()=>{vocab++;}},
  './learning-word-views-admission':{learningWordViewSteps:function*(){view++;yield;return {complete:true};}},
  './question-catalog-admission':{questionCatalogSteps:function*(){questions++;throw Error('Unexpected practice load');}},
  './lesson-audio':{prepareProductLessonAudio:async()=>{audio++;}},
 }}).load('lib/prepare-study-content.ts');
 await api.prepareWorkflowContent();assert.equal(vocab,1);assert.equal(view,1);assert.equal(questions,0);assert.equal(audio,0);assert.throws(api.readPreparedQuestionCatalog,/仍在核验/);
});
