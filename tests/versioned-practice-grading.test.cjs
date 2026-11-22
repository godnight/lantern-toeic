'use strict';
// Synthetic catalogues exercise the actual pure source; there is no server,
// account, database or network in this test.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..'),loader=createSourceLoader({root});
const {canonicalJson,canonicalHash}=loader.load('lib/domain-command.ts');
const {createVersionedPracticeGrader}=loader.load('lib/versioned-practice-grading.ts');
const version=rows=>'practice-v1:'+canonicalHash(canonicalJson(rows));
const question=(id,answer=0)=>({id,part:1,title:'Synthetic question '+id,prompt:'Choose the statement.',
 options:['The box is open.','The box is closed.','The box is empty.','The box is blue.'],correctIndex:answer,
 explanation:'Synthetic explanation.',evidence:'Synthetic evidence.',skill:'Synthetic skill.',difficulty:'未标定'});
const catalog=rows=>({catalogVersion:version(rows),questions:rows});
const plain=value=>JSON.parse(JSON.stringify(value));

test('server grades against the specified immutable version and retains the old version',()=>{
 const shared=question('shared'),oldOnly=question('old-only',1),newOnly=question('new-only',2);
 const a=catalog([shared,oldOnly]),b=catalog([shared,oldOnly,newOnly]);
 const grader=createVersionedPracticeGrader([a,b]);
 assert.deepEqual(plain(grader.grade({catalogVersion:a.catalogVersion,qid:'old-only',choice:1})),
  {catalogVersion:a.catalogVersion,qid:'old-only',choice:1,correct:true});
 assert.equal(grader.grade({catalogVersion:a.catalogVersion,qid:'old-only',choice:0}).correct,false);
 assert.equal(grader.grade({catalogVersion:b.catalogVersion,qid:'new-only',choice:2}).correct,true);
 assert.throws(()=>grader.grade({catalogVersion:a.catalogVersion,qid:'new-only',choice:2}),/unknown-question/);
 assert(Object.isFrozen(grader));assert(Object.isFrozen(grader.grade({catalogVersion:b.catalogVersion,qid:'new-only',choice:0})));
});

test('strict request shape rejects client correctness, invalid versions, IDs and choices',()=>{
 const rows=[question('q1')],a=catalog(rows),grader=createVersionedPracticeGrader([a]);
 const request={catalogVersion:a.catalogVersion,qid:'q1',choice:0};
 for(const bad of [null,[],{...request,correct:true},{...request,correct:false},{...request,mode:'first'},
   {...request,choice:'0'},{...request,choice:NaN},{...request,choice:1.5},{...request,qid:''},
   {...request,qid:'x'.repeat(101)},{...request,catalogVersion:'latest'},
   {catalogVersion:a.catalogVersion,qid:'q1'}])assert.throws(()=>grader.grade(bad));
 assert.throws(()=>grader.grade({...request,catalogVersion:'practice-v1:'+'0'.repeat(64)}),/unknown-catalog/);
 assert.throws(()=>grader.grade({...request,qid:'unknown'}),/unknown-question/);
 assert.throws(()=>grader.grade({...request,choice:-1}),/choice/);
 assert.throws(()=>grader.grade({...request,choice:4}),/choice/);
 let called=false;const accessor={catalogVersion:a.catalogVersion,qid:'q1',get choice(){called=true;return 0;}};
 assert.throws(()=>grader.grade(accessor));assert.equal(called,false,'The request accessor must not execute');
});

test('full digests, unique IDs and cross-version identical question content are enforced',()=>{
 const one=question('one'),old=catalog([one]),badPin={...old,catalogVersion:'practice-v1:'+'1'.repeat(64)};
 assert.throws(()=>createVersionedPracticeGrader([badPin]),/catalog-digest/);
 assert.throws(()=>createVersionedPracticeGrader([old,old]),/catalog/);
 assert.throws(()=>createVersionedPracticeGrader([catalog([one,one])]),/question/);
 for(const bad of [question('one',4),{...one,options:['same','same']},{...one,options:['only one']},
   {...one,options:['one','']},{...one,id:'\n'},{...one,id:'x'.repeat(101)}]){
  assert.throws(()=>createVersionedPracticeGrader([catalog([bad])]));
 }
 for(const changed of [{...one,correctIndex:1},{...one,explanation:'A different explanation'},
   {...one,options:['changed',...one.options.slice(1)]}]){
  assert.throws(()=>createVersionedPracticeGrader([old,catalog([changed])]),/question-id-reused/);
 }
});

test('mutating caller data or requests after construction cannot change the indexed answers',()=>{
 const first=question('first',2),rows=[first],a=catalog(rows),grader=createVersionedPracticeGrader([a]);
 first.correctIndex=1;first.options[2]='Changed';rows.push(question('injected'));
 assert.equal(grader.grade({catalogVersion:a.catalogVersion,qid:'first',choice:2}).correct,true);
 assert.equal(grader.grade({catalogVersion:a.catalogVersion,qid:'first',choice:1}).correct,false);
 assert.throws(()=>grader.grade({catalogVersion:a.catalogVersion,qid:'injected',choice:0}),/unknown-question/);
 assert.throws(()=>createVersionedPracticeGrader([a]),/catalog-digest/);
});

test('catalog wrapper getters, symbols and extra properties cannot change the checked map key',()=>{
 const rows=[question('wrapper-question',1)],actual=version(rows),forged='practice-v1:'+'f'.repeat(64);
 let getterReads=0;const getterWrapper={questions:rows};
 Object.defineProperty(getterWrapper,'catalogVersion',{enumerable:true,get(){getterReads++;return getterReads===1?actual:forged;}});
 assert.throws(()=>createVersionedPracticeGrader([getterWrapper]),/catalog/);
 assert.equal(getterReads,0,'An accessor used as catalog authority must never run');
 const extra={catalogVersion:actual,questions:rows};Object.defineProperty(extra,'hidden',{value:1});
 assert.throws(()=>createVersionedPracticeGrader([extra]),/catalog/);
 const symbol={catalogVersion:actual,questions:rows,[Symbol('extra')]:1};
 assert.throws(()=>createVersionedPracticeGrader([symbol]),/catalog/);
 let dynamicReads=0;
 const dynamic=new Proxy({catalogVersion:actual,questions:rows},{get(target,key,receiver){
  if(key==='catalogVersion'){dynamicReads++;return dynamicReads<=4?actual:forged;}
  return Reflect.get(target,key,receiver);
 }});
 const grader=createVersionedPracticeGrader([dynamic]);
 assert.equal(dynamicReads,0,'Version must come from one detached data-property snapshot');
 assert.equal(grader.grade({catalogVersion:actual,qid:'wrapper-question',choice:1}).correct,true);
 assert.throws(()=>grader.grade({catalogVersion:forged,qid:'wrapper-question',choice:1}),/unknown-catalog/);
});

test('all six historical catalogues and the new 325 catalogue remain compatible with the versioned server index',()=>{
 const original=loader.load('lib/question-catalog.ts');
 const snapshots=original.PRACTICE_QUESTION_CATALOGS.map(questions=>({catalogVersion:version(questions),questions}));
 assert.deepEqual(plain(snapshots.map(c=>c.questions.length)),[68,93,106,113,163,313,325]);
 const grader=createVersionedPracticeGrader(snapshots);
 for(const item of snapshots){
  const sample=item.questions[0];
  assert.equal(grader.grade({catalogVersion:item.catalogVersion,qid:sample.id,choice:sample.correctIndex}).correct,true);
 }
 const newest=snapshots.at(-1),newQuestion=newest.questions.find(q=>!snapshots[0].questions.some(old=>old.id===q.id));
 assert(newQuestion);assert.equal(grader.grade({catalogVersion:newest.catalogVersion,qid:newQuestion.id,choice:newQuestion.correctIndex}).correct,true);
 assert.throws(()=>grader.grade({catalogVersion:snapshots[0].catalogVersion,qid:newQuestion.id,choice:newQuestion.correctIndex}),/unknown-question/);
 const added=newest.questions.find(q=>!snapshots[5].questions.some(old=>old.id===q.id));assert(added);
 assert.equal(grader.grade({catalogVersion:newest.catalogVersion,qid:added.id,choice:added.correctIndex}).correct,true);
 assert.throws(()=>grader.grade({catalogVersion:snapshots[5].catalogVersion,qid:added.id,choice:added.correctIndex}),/unknown-question/);
});
