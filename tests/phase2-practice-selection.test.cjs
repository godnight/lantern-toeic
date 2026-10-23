const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const {createSourceLoader}=require(path.join(root,'tests/helpers/actual-source-loader.cjs'));
function load(file,imports={},globals={}){
 return createSourceLoader({root,imports,globals:{queueMicrotask,...globals}}).load(file);
}
const model = load('lib/study-model.ts');
const {selectPractice, practiceUnits} = load('lib/practice-selection.ts', {'./study-model': model});
const question = (id, part = 1, groupId) => ({id, part, groupId, options:['A','B','C'], correctIndex:0});
const answer = (qid, correct, createdAt = '2026-10-13T10:00:00Z') => ({id:qid+createdAt, qid, correct, createdAt, choice:0, seconds:1, mode:'first'});
const ids = result => Array.from(result.questions || [], q => q.id);
test('continue selects unseen units and never splits a shared conversation', () => {
  const questions = [question('seen'), question('g1',3,'dialogue'), question('g2',3,'dialogue'), question('g3',3,'dialogue')];
  const result = selectPractice(questions, [answer('seen',false)], {intent:'continue',targetCount:1});
  assert.deepEqual(ids(result), ['g1','g2','g3']); assert.equal(result.isReview,false);
});
test('continue does not disguise partially seen conversations as new material', () => {
  const questions = [question('g1',3,'shared'),question('g2',3,'shared'),question('new',5)];
  const result = selectPractice(questions,[answer('g1',true)],{intent:'continue',targetCount:1});
  assert.deepEqual(ids(result),['new']);
});
test('part filters and chain exclusions apply to complete authored units', () => {
  const questions = [question('a',3,'g'),question('b',3,'g'),question('other',4),question('next',3)];
  const result=selectPractice(questions,[],{intent:'continue',part:3,targetCount:3,excludeUnitIds:['group:3:g']});
  assert.deepEqual(ids(result),['next']);
});
test('wrong practice includes the full group containing the latest wrong answer', () => {
  const questions=[question('a',3,'g'),question('b',3,'g'),question('fixed',5)];
  const result=selectPractice(questions,[answer('b',false),answer('fixed',false),answer('fixed',true,'2026-10-14T09:00:00Z')],{intent:'wrong',targetCount:1});
  assert.deepEqual(ids(result),['a','b']); assert.equal(result.isReview,true);
});
test('exhausted continue is explicit and does not silently recycle completed questions', () => {
  const result=selectPractice([question('only')],[answer('only',true)],{intent:'continue',targetCount:3});
  assert.equal(result.kind,'exhausted'); assert.equal(result.reason,'no-unseen');
});
test('explicit custom practice can revisit seen material and labels review accurately', () => {
  const result=selectPractice([question('old'),question('new')],[answer('old',true)],{intent:'custom',targetCount:3});
  assert.deepEqual(ids(result),['new','old']); assert.equal(result.isReview,true);
});
test('due review uses the existing scheduler without changing early-review intervals', () => {
  const attempts=[answer('old',true,'2026-10-01T10:00:00Z'),answer('recent',true,'2026-10-14T10:00:00Z')];
  const result=selectPractice([question('old'),question('recent')],attempts,{intent:'review',targetCount:2},Date.parse('2026-10-14T12:00:00Z'));
  assert.deepEqual(ids(result),['old']);
});
test('unit identity keeps equal group names in different parts separate', () => {
  assert.equal(practiceUnits([question('a',3,'same'),question('b',7,'same')]).length,2);
});
test('invalid target counts cannot create empty successful sessions', () => {
  for(const targetCount of [0,-1,1.5,NaN,201]) assert.throws(()=>selectPractice([question('a')],[],{intent:'continue',targetCount}),/1至200/);
});
