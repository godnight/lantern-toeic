'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
test('actual catalog dependency closure admits all50 only through the real unchanged gates',()=>{
 const l=createSourceLoader({root}),c=l.load('lib/question-catalog.ts');
 const plain=value=>JSON.parse(JSON.stringify(value));
 const admission=l.load('lib/listening150-package.ts').LISTENING150_ADMISSION;
 assert.equal(c.LISTENING50_CATALOG_163.length,163);assert.equal(c.LISTENING50_QUESTIONS.length,50);
 assert.deepEqual(plain(c.QUESTIONS.slice(0,163)),plain(c.LISTENING50_CATALOG_163),'Every original question/body remains an exact prefix');
 assert.deepEqual(plain(c.PRACTICE_QUESTION_CATALOGS.slice(0,5).map(rows=>rows.length)),[68,93,106,113,163]);
 const registry={legacy68:'practice-v1:4d988136891fac939c17ebad3f7ab5a2e32c2d8df3155a5be1a9e9a39b95dc9e',reading93:'practice-v1:d160c266be1fa18b59f6cf7af559bb81209d3f97804454fa7cbb04e24002ced8',frozenR1_106:'practice-v1:e468ef5e6bb6c0dd7d7ebd8c5f98bbc2f742f81cb7bcba94447cd474f3ff2371',candidateR2_113:'practice-v1:3dff085048aeb511e4c2539ba4d7e876b8cf7213385472d489c817987f879c1e',listening50_163:'practice-v1:fc3250aed12bcff3c2b18c217fc30283aa1f67f65ee8c0e2da49a8dee082a203'};
 for(const [key,hash]of Object.entries(registry))assert.equal(c.QUESTION_CATALOG_VERSIONS[key],hash);
 if(admission===null){
  assert.equal(c.QUESTIONS.length,163);assert.equal(c.LISTENING_COLLECTION_QUESTIONS.length,50);assert.equal(c.LISTENING_COLLECTION_STATS.ready200,false);
  assert.equal(c.QUESTION_CATALOG_STATS.availableUnits,93);assert.equal(c.QUESTION_CATALOG_STATS.newListening150Questions,0);assert.equal(c.PRACTICE_QUESTION_CATALOGS.length,5);
 }else{
  assert.equal(admission.questions.length,150);assert.equal(c.QUESTIONS.length,313);assert.equal(c.LISTENING_COLLECTION_QUESTIONS.length,200);assert.equal(c.LISTENING_COLLECTION_STATS.ready200,true);
  assert.equal(c.QUESTION_CATALOG_STATS.availableUnits,195);assert.equal(c.QUESTION_CATALOG_STATS.newListening150Units,102);assert.equal(c.PRACTICE_QUESTION_CATALOGS.length,6);
  assert.deepEqual(plain(c.QUESTIONS.slice(163)),plain(admission.questions));assert.equal(c.QUESTION_CATALOG_VERSIONS.listening200_313,'practice-v1:'+admission.combined313CanonicalSha256);
  assert.deepEqual(plain(c.PRACTICE_QUESTION_CATALOGS[5]),plain(c.QUESTIONS));
 }
 assert.deepEqual(JSON.parse(JSON.stringify(c.LISTENING50_STATS.byPart)),{'1':8,'2':12,'3':15,'4':15});
 assert.equal(l.load('lib/question-catalog.ts'),c,'One graph reuses the same actual module instance');
});
test('unapproved external, missing local and outside-root dependencies remain closed',()=>{
 const l=createSourceLoader({root});
 assert.throws(()=>l.resolve('unapproved-package','lib/study-model.ts'),/Unexpected external/);
 assert.throws(()=>l.resolve('../../outside.ts','lib/study-model.ts'),/Missing actual|outside/);
 assert.throws(()=>l.load('../../outside-loader-qa.ts'),/outside/);
 assert.throws(()=>createSourceLoader({root,allowedFiles:['lib/question-catalog.ts']}).load('lib/question-catalog.ts'),/Unapproved dependency/);
});
test('explicit platform seam wins while ordinary dependencies and node builtins remain actual',()=>{
 const react={useEffect(){},useRef:x=>({current:x})},l=createSourceLoader({root,imports:{react}});
 assert.equal(l.resolve('react','lib/use-dialog-viewport.ts'),react);
 assert.equal(l.resolve('node:crypto','lib/study-model.ts').createHash,require('node:crypto').createHash);
 assert.equal(typeof l.load('lib/use-dialog-viewport.ts').useDialogViewport,'function');
});
test('changed question bytes cannot become eligible through the repaired loader',()=>{
 const rows=JSON.parse(fs.readFileSync(path.join(root,'content/questions-v041-listening50.json'),'utf8'));
 rows[0].explanation+=' changed-test-only';
 const l=createSourceLoader({root,imports:{'../content/questions-v041-listening50.json':{__esModule:true,default:rows}}});
 assert.throws(()=>l.load('lib/question-catalog.ts'),/listening50-content-changed/);
});
test('a missing eligible audio binding still blocks the whole material despite successful loading',()=>{
 const media=JSON.parse(fs.readFileSync(path.join(root,'content/questions-v041-listening50-media.json'),'utf8'));
 media.units[0].privatePracticeEligible=false;
 const l=createSourceLoader({root,imports:{'../content/questions-v041-listening50-media.json':{__esModule:true,default:media}}});
 assert.throws(()=>l.load('lib/question-catalog.ts'),/listening50-text-or-media-clearance/);
});

test('independent dependency graphs never share mutable model exports after compilation reuse',()=>{
 const first=createSourceLoader({root}).load('lib/study-model.ts');
 const original=first.EMPTY_DATA.profile.name;first.EMPTY_DATA.profile.name='SYNTHETIC TEST ONLY';
 const second=createSourceLoader({root}).load('lib/study-model.ts');
 assert.notEqual(first,second);assert.equal(second.EMPTY_DATA.profile.name,original);
});

test('H5 first-run hook follows its real model and preference dependencies',()=>{
 const react={useEffect(){},useRef:x=>({current:x}),useState:x=>[x,()=>{}],useCallback:x=>x};
 const loader=createSourceLoader({root,imports:{react}});
 assert.equal(typeof loader.load('lib/use-first-run.ts').useFirstRun,'function');
 assert.equal(typeof loader.load('lib/first-run.ts'),'object');
});
