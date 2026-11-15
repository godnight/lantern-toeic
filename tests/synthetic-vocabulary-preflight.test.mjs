import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const loader=require('./helpers/actual-source-loader.cjs').createSourceLoader({root:process.cwd()});
const {SyntheticVocabularyFixture,inspectSyntheticVocabulary}=loader.load('lib/cloud-sync/synthetic-vocabulary-preflight.ts');
const {vocabularyReviewHash}=loader.load('lib/vocabulary-model.ts');
const owner='usr_aaaaaaaa-1111-4111-8111-111111111111',other='usr_bbbbbbbb-1111-4111-8111-111111111111';
const key='lantern-vocab-v1:owner:'+owner+':',device='lantern-vocab-v1:device:',foreign='lantern-vocab-v1:owner:'+other+':';
const at='2026-10-14T10:00:00.000Z',later='2026-10-14T10:00:02.000Z';
const review={id:'review-one',wordId:'word-a',createdAt:at,type:'review',grade:'remembered'};
const mark={id:'mark-one',wordId:'word-a',createdAt:at,type:'mark',starred:true,revision:1};
const correction={id:'correction-one',wordId:'word-a',createdAt:later,type:'review-correction',reviewId:review.id,reviewHash:vocabularyReviewHash(review),grade:'again'};
const chunk=(events,schemaVersion=1)=>JSON.stringify({kind:'lantern-vocabulary',schemaVersion,events});
const lease=()=>({owner,generation:1,active:true});
const plain=x=>JSON.parse(JSON.stringify(x));

test('inventories both legacy and captured owner chunks without reading device or other account data',()=>{
 const source=new SyntheticVocabularyFixture([[key+'a',chunk([review,mark])],[key+'cloud-new-mark-v1-b',chunk([mark])],[key+'c',chunk([correction],2)],[device+'private','do not read'],[foreign+'private','do not read']]);
 const before=plain(source.bytes()),reads=[];source.onRead=name=>reads.push(name);
 const result=plain(inspectSyntheticVocabulary(source,lease()));
 assert.equal(result.ready,false);assert.equal(result.requiresExclusiveLease,true);assert.equal(result.deviceDataPresent,true);
 assert.equal(result.events.length,3);assert.equal(result.events.find(x=>x.event.id===mark.id).sources.length,2);
 assert.deepEqual(result.unresolvedCorrectionIds,[]);assert(result.unsupported.includes('old vocabulary migration'));
 assert(!reads.includes(device+'private'));assert(!reads.includes(foreign+'private'));
 assert.deepEqual(plain(source.bytes()),before);
});

test('unresolved corrections are preserved instead of inventing the original grade or schedule',()=>{
 const result=plain(inspectSyntheticVocabulary(new SyntheticVocabularyFixture([[key+'x',chunk([correction],2)]]),lease()));
 assert.deepEqual(result.unresolvedCorrectionIds,[correction.id]);assert.equal(result.events.length,1);assert.equal(result.ready,false);
});

test('conflicts, damaged or unknown fields, and inconsistent corrections fail without altering bytes',()=>{
 const cases=[
  [[key+'a',chunk([review])],[key+'b',chunk([{...review,grade:'again'}])]],
  [[key+'a','not json']],[[key+'a',JSON.stringify({kind:'lantern-vocabulary',schemaVersion:1,events:[],future:true})]],
  [[key+'a',chunk([{...review,future:true}])]],[[key+'a',chunk([correction],1)]],
  [[key+'a',chunk([review,{...correction,wordId:'word-b'}],2)]],
  [[key+'a',chunk([review,{...correction,reviewHash:'0'.repeat(64)}],2)]],
  [[key+'a',chunk([review,{...correction,createdAt:'2026-10-14T09:59:00.000Z'}],2)]],
  [[key+'a',chunk([{...review,grade:'again'},correction],2)]]
 ];
 for(const entries of cases){const source=new SyntheticVocabularyFixture(entries),before=plain(source.bytes());assert.throws(()=>inspectSyntheticVocabulary(source,lease()));assert.deepEqual(plain(source.bytes()),before);}
});

test('a chunk changing during scan is retried; continuous changes or owner changes fail closed',()=>{
 const source=new SyntheticVocabularyFixture([[key+'a',chunk([review])]]);let changed=false;
 source.onRead=name=>{if(name===key+'a'&&!changed){changed=true;source.set(key+'b',chunk([mark]));}};
 const result=plain(inspectSyntheticVocabulary(source,lease()));assert.equal(result.events.length,2);
 const unstable=new SyntheticVocabularyFixture([[key+'a',chunk([review])]]);let n=0;
 unstable.onRead=name=>{if(name===key+'a')unstable.set(name,chunk([{...review,id:'r'+(++n)}]));};
 assert.throws(()=>inspectSyntheticVocabulary(unstable,lease()),/vocabulary changed/);
 const switched=new SyntheticVocabularyFixture([[key+'a',chunk([review])]]),session=lease();
 switched.onRead=name=>{if(name===key+'a')session.generation++;};
 assert.throws(()=>inspectSyntheticVocabulary(switched,session),/account lease changed/);
 assert.throws(()=>inspectSyntheticVocabulary({keys(){return [];},get(){return null;}},lease()),/synthetic fixture/);
});
