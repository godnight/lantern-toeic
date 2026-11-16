'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const loader=require('./helpers/actual-source-loader.cjs').createSourceLoader({root:path.resolve(__dirname,'..')});
const model=loader.load('lib/vocabulary-model.ts');
const {captureNativeVocabularySource,nativeVocabularySourceIsCurrent}=loader.load('lib/cloud-sync/native-vocabulary-source.ts');
const owner='usr_aaaaaaaa-1111-4111-8111-111111111111',other='usr_bbbbbbbb-1111-4111-8111-111111111111';
const review={id:'review-1',wordId:'archive',createdAt:'2026-01-01T10:00:00.000Z',type:'review',grade:'remembered'};
const correction={id:'correction-1',wordId:'archive',createdAt:'2026-01-01T10:01:00.000Z',type:'review-correction',reviewId:review.id,reviewHash:model.vocabularyReviewHash(review),grade:'again'};
const mark={id:'mark-1',wordId:'archive',createdAt:'2026-01-01T10:02:00.000Z',type:'mark',starred:true,revision:1};
function storage(){const map=new Map(),reads=[],writes=[];return {map,reads,writes,get length(){return map.size;},key(i){return [...map.keys()][i]??null;},getItem(k){reads.push(k);return map.get(k)??null;},setItem(k,v){writes.push(k);map.set(k,String(v));}};}
function lease(){const controller=new AbortController();let current=true;return {owner,signal:controller.signal,isCurrent:()=>current,revoke(){current=false;controller.abort();}};}
const clone=value=>JSON.parse(JSON.stringify(value));

test('reads real owner review, correction and mark chunks, never guest or another account',()=>{
 const store=storage(),key=model.vocabularyKey(owner);model.writeVocabulary(store,key,[review]);model.writeVocabulary(store,key,[correction]);model.writeVocabulary(store,key,[mark]);
 store.setItem(model.vocabularyKey(other)+'private','not readable');store.setItem(model.vocabularyKey(null)+'private','not readable');
 const bytes=[...store.map.entries()],writes=store.writes.length;store.reads.length=0;const access=lease(),snapshot=captureNativeVocabularySource(store,access);
 assert.equal(store.writes.length,writes);assert.deepEqual([...store.map.entries()],bytes);
 assert.equal(store.reads.some(name=>name.startsWith(model.vocabularyKey(other))||name.startsWith(model.vocabularyKey(null))),false);
 assert.deepEqual(clone(snapshot.events).map(e=>e.id),['review-1','mark-1','correction-1']);
 assert.deepEqual(clone(snapshot.deferredCorrectionIds),[]);assert.equal(nativeVocabularySourceIsCurrent(store,access,snapshot),true);
 model.writeVocabulary(store,key,[{id:'review-2',wordId:'archive',createdAt:'2026-01-02T10:00:00.000Z',type:'review',grade:'again'}]);
 assert.equal(nativeVocabularySourceIsCurrent(store,access,snapshot),false);
});

test('leaves a correction without its original review deferred and preserves the source',()=>{
 const store=storage(),key=model.vocabularyKey(owner);store.setItem(key+'missing',JSON.stringify(model.vocabularyBackup([correction])));
 const before=[...store.map.entries()],access=lease(),result=captureNativeVocabularySource(store,access);
 assert.deepEqual(clone(result.events),[]);assert.deepEqual(clone(result.deferredCorrectionIds),['correction-1']);assert.deepEqual([...store.map.entries()],before);
});

test('rejects conflicting IDs, malformed data and mismatched corrections before publishing a snapshot',()=>{
 for(const bad of [
  [model.vocabularyBackup([review]),model.vocabularyBackup([{...review,grade:'again'}])],
  [model.vocabularyBackup([review]),{kind:'lantern-vocabulary',schemaVersion:1,events:[{...mark,extra:'unknown'}]}],
  [model.vocabularyBackup([review]),model.vocabularyBackup([{...correction,reviewHash:'0'.repeat(64)}])],
 ]){
  const store=storage(),key=model.vocabularyKey(owner);store.setItem(key+'a',JSON.stringify(bad[0]));store.setItem(key+'b',JSON.stringify(bad[1]));const before=[...store.map.entries()];
  assert.throws(()=>captureNativeVocabularySource(store,lease()));assert.deepEqual([...store.map.entries()],before);
 }
});

test('rejects changing chunks or revoked account and never uses a stale snapshot as current',()=>{
 const store=storage(),key=model.vocabularyKey(owner);model.writeVocabulary(store,key,[review]);const access=lease(),snapshot=captureNativeVocabularySource(store,access);
 const originalGet=store.getItem.bind(store);let once=false;store.getItem=k=>{const v=originalGet(k);if(k.startsWith(key)&&!once){once=true;store.map.set(key+'new',JSON.stringify(model.vocabularyBackup([mark])));}return v;};
 assert.throws(()=>captureNativeVocabularySource(store,access),/source changed/);assert.equal(nativeVocabularySourceIsCurrent(store,access,snapshot),false);
 access.revoke();assert.throws(()=>captureNativeVocabularySource(store,access),/account lease unavailable/);assert.equal(nativeVocabularySourceIsCurrent(store,access,snapshot),false);
});
