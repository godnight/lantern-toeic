'use strict';
// Actual repository modules, fake IndexedDB/journal, and explicitly synthetic
// new-media gate/compiled-locator fixtures. No browser/ArkWeb/media-hearing QA.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRequire}=require('node:module');
const root=path.resolve(process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..'));
const req=createRequire(path.join(root,'package.json')),{IDBFactory}=req('fake-indexeddb');
const {createSourceLoader}=require(path.join(root,'tests/helpers/actual-source-loader.cjs'));
const {createSyntheticListening150}=require('./fixtures/listening200-synthetic.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
const loader=imports=>createSourceLoader({root,imports});
const actual=loader({}),pending=loader({'./listening150-package':{LISTENING150_ADMISSION:null}});
const old=pending.load('lib/question-catalog.ts'),canonical=actual.load('lib/domain-command.ts');
const realIndex=actual.load('lib/natural-audio-catalog-index.ts'),workflow=actual.load('lib/practice-workflow.ts');
const hash=value=>canonical.canonicalHash(canonical.canonicalJson(value)),unitId=q=>q.groupId?`group:${q.part}:${q.groupId}`:`question:${q.id}`;
function fixture(){return createSyntheticListening150({legacy163:old.QUESTIONS,canonicalHash:canonical.canonicalHash,
 canonicalJson:canonical.canonicalJson,naturalAudioSelectorDigest:realIndex.naturalAudioSelectorDigest});}
function repin(f){f.policy.questionsCanonicalSha256=hash(f.input.questions);f.policy.gateCanonicalSha256=hash(f.input.gate);f.policy.mediaCanonicalSha256=hash(f.input.media);}
function admit(f){return loader({'./natural-audio-catalog-index':{compiledNaturalAudioCatalog:f.index,
 naturalAudioSelectorDigest:realIndex.naturalAudioSelectorDigest}}).load('lib/listening150-catalog.ts').admitListening150Package(f.input,f.policy);}
const admitted=admit(fixture()),expanded=loader({'./listening150-package':{LISTENING150_ADMISSION:admitted}}).load('lib/question-catalog.ts');

test('pending package preserves actual original 163 catalog and 50-question collection',()=>{
 assert.equal(old.QUESTIONS.length,163);assert.equal(old.LISTENING50_CATALOG_163.length,163);
 assert.equal(old.LISTENING_COLLECTION_QUESTIONS.length,50);assert.equal(old.LISTENING_COLLECTION_STATS.ready200,false);
 assert.equal(old.QUESTION_CATALOG_STATS.newListening150Questions,0);
 assert.deepEqual(plain(old.QUESTIONS),plain(old.LISTENING50_CATALOG_163));
});
test('all five original canonical catalog hashes are exact and remain registered',()=>{
 const versions={legacy68:'practice-v1:4d988136891fac939c17ebad3f7ab5a2e32c2d8df3155a5be1a9e9a39b95dc9e',
 reading93:'practice-v1:d160c266be1fa18b59f6cf7af559bb81209d3f97804454fa7cbb04e24002ced8',
 frozenR1_106:'practice-v1:e468ef5e6bb6c0dd7d7ebd8c5f98bbc2f742f81cb7bcba94447cd474f3ff2371',
 candidateR2_113:'practice-v1:3dff085048aeb511e4c2539ba4d7e876b8cf7213385472d489c817987f879c1e',
 listening50_163:'practice-v1:fc3250aed12bcff3c2b18c217fc30283aa1f67f65ee8c0e2da49a8dee082a203'};
 assert.deepEqual(plain(old.QUESTION_CATALOG_VERSIONS),versions);
 assert.deepEqual(plain(old.PRACTICE_QUESTION_CATALOGS.map(rows=>rows.length)),[68,93,106,113,163]);
 assert.deepEqual(plain(old.PRACTICE_QUESTION_CATALOGS.map(workflow.practiceCatalogVersion)),Object.values(versions));
 for(const [key,value]of Object.entries(versions))assert.equal(expanded.QUESTION_CATALOG_VERSIONS[key],value);
});
test('all 50 old dispatcher body/question selectors equal the original binding module',()=>{
 const dispatch=pending.load('lib/question-audio-dispatch-v041.ts'),original=actual.load('lib/question-audio-bindings-v041.ts');
 for(const q of old.LISTENING50_QUESTIONS)assert.deepEqual(plain(dispatch.getReviewedListeningAudio(q.id)),plain(original.getListening50Audio(q.id)));
 assert.equal(dispatch.getReviewedListeningAudio('v041-l200-p1-01'),null);assert.equal(dispatch.getReviewedListeningAudio('not-a-question'),null);
});
test('actual compiled provider reports only its truly admitted count',()=>{
 const packageValue=actual.load('lib/listening150-package.ts'),catalog=actual.load('lib/question-catalog.ts');
 if(packageValue.LISTENING150_ADMISSION===null){assert.equal(catalog.QUESTIONS.length,163);assert.equal(catalog.LISTENING_COLLECTION_QUESTIONS.length,50);assert.equal(catalog.LISTENING_COLLECTION_STATS.ready200,false);}
 else{assert.equal(catalog.QUESTIONS.length,313);assert.equal(catalog.LISTENING_COLLECTION_QUESTIONS.length,200);assert.equal(catalog.LISTENING_COLLECTION_STATS.ready200,true);assert.equal(workflow.practiceCatalogVersion(catalog.QUESTIONS),catalog.QUESTION_CATALOG_VERSIONS.listening200_313);}
});
test('synthetic gate fixture: complete150 produces 313 catalog, 200 collection, 253 all-listening and 132 materials',()=>{
 assert.equal(admitted.questions.length,150);assert.equal(expanded.QUESTIONS.length,313);assert.equal(expanded.LISTENING_COLLECTION_QUESTIONS.length,200);
 assert.equal(expanded.QUESTIONS.filter(q=>q.part<=4).length,253);assert.equal(expanded.LISTENING_COLLECTION_STATS.materials,132);
 const ids=new Set(expanded.LISTENING_COLLECTION_QUESTIONS.map(q=>q.id));assert.equal(old.CANDIDATE_R2_QUESTIONS.filter(q=>q.part<=4&&ids.has(q.id)).length,0);
 assert.deepEqual(plain(expanded.LISTENING50_CATALOG_163),plain(old.QUESTIONS));assert.equal(expanded.PRACTICE_QUESTION_CATALOGS.length,6);
 assert.equal(workflow.practiceCatalogVersion(expanded.QUESTIONS),expanded.QUESTION_CATALOG_VERSIONS.listening200_313);
});
test('synthetic gate fixture: body is shared but current-question selectors never cross between questions',()=>{
 const group=admitted.questions.filter(q=>q.part===3).slice(0,3),a=admitted.getAudio(group[0].id),b=admitted.getAudio(group[1].id);
 assert.equal(a.body.audioKey,b.body.audioKey);assert.notEqual(a.question.audioKey,b.question.audioKey);assert.equal(a.question.segmentId,'prompt:'+group[0].id);
 assert.equal(admitted.getAudio('not-a-question'),null);assert(Object.isFrozen(admitted.questions));
});
test('synthetic gate fixture: sealed question text mutation is rejected before repinning',()=>{const f=fixture();f.input.questions[0].prompt+=' changed';assert.throws(()=>admit(f),/sealed-content-changed/);});
const mutations=[
 ['149 questions cannot be partially ready',f=>{f.input.questions.pop();}],
 ['one missing material cannot be ready',f=>{f.input.media.units.pop();}],
 ['missing text review rejects',f=>{f.input.gate.questions[0].textReviewStatus='HOLD';}],
 ['wrong runtime canonical hash rejects',f=>{f.input.gate.questions[0].runtimeQuestionCanonicalSha256=hash('wrong');}],
 ['missing actual-pixel review hash rejects',f=>{delete f.input.gate.questions[0].image.reviewSha256;}],
 ['wrong SHA-bound image URL rejects',f=>{f.input.gate.questions[0].image.url='/listening200-r1/'+hash('wrong')+'.png';}],
 ['duplicate selected image rejects',f=>{f.input.gate.questions[1].image=plain(f.input.gate.questions[0].image);}],
 ['missing current-question prompt track rejects',f=>{f.input.media.units.find(u=>u.part===3).questionTracks.pop();}],
 ['foreign prompt qid rejects',f=>{f.input.media.units.find(u=>u.part===3).questionTracks[0].qid='foreign';}],
 ['cross-context selector rejects',f=>{f.input.media.units[0].body.audio.contextHash=hash('foreign-context');}],
 ['cross-text selector rejects',f=>{f.input.media.units[0].body.text='Unrelated text.';}],
 ['missing compiled natural route rejects',f=>{delete f.index.routes[f.input.media.units[0].body.audio.audioKey];}],
 ['wrong compiled material pair rejects',f=>{f.index.routes[f.input.media.units[0].body.audio.audioKey][0][6]='other-material';}],
 ['changed compiled pack descriptor rejects',f=>{f.policy.packDescriptors[0].manifestFileSha256=hash('wrong-descriptor');}],
 ['blocked MP3 never releases',f=>{f.index.blockedAssetSha256.push(f.input.media.units[0].body.mp3Sha256);}],
 ['blocked context never releases',f=>{const u=f.input.media.units[0];f.index.blockedContexts.push([u.materialId,u.contextHash]);}],
 ['formal/human claim is not inherited',f=>{f.input.media.units[0].formalAllowed=true;}],
 ['200 tracks are not 200 questions',f=>{f.input.media.runtimeTrackCount=200;}],
 ['foreign source manifest pair rejects',f=>{f.input.media.sourceContentManifestSha256=hash('foreign-source');}],
];
for(const [label,mutate]of mutations)test('synthetic gate fixture: '+label,()=>{const f=fixture();mutate(f);repin(f);assert.throws(()=>admit(f));});

function facts(){const attempts=new Map(),checkins=new Map(),state={fail:false,writes:0};return{attempts,checkins,state,adapter:{
 addAttempt(value){state.writes++;if(state.fail)return false;attempts.set(value.id,plain(value));return true;},
 addCheckin(value){checkins.set(value.id,plain(value));return true;},readAttempt:id=>attempts.get(id),readCheckin:id=>checkins.get(id)}};}
async function restorePending(rows){const factory=new IDBFactory(),legacy=facts(),options={scope:{kind:'web-owner',ownerId:'test-only-owner'},timezone:'Asia/Shanghai',factory,name:'listening200-portable',legacy:legacy.adapter,now:()=>new Date('2026-10-14T23:59:59.000Z')};
 const first=await workflow.createPracticeWorkflow({...options,questions:rows});let restarted;
 try{const queue=rows.filter(q=>!q.groupId).slice(0,2),started=await first.start(queue,{unitIds:queue.map(unitId)});assert.equal(started.status,'started');legacy.state.fail=true;
 assert.equal((await first.submit(started.sessionId,2,41,0)).status,'pending');const stored=plain(await first.repository.read('sessions',started.sessionId));first.close();
 restarted=await workflow.createPracticeWorkflow({...options,questions:expanded.QUESTIONS,compatibleQuestionCatalogs:expanded.PRACTICE_QUESTION_CATALOGS,now:()=>new Date('2026-10-20T00:00:00Z')});
 const s=(await restarted.readProjection()).sessions.find(row=>row.id===started.sessionId);assert.equal(s.catalogVersion,workflow.practiceCatalogVersion(rows));
 assert.deepEqual(plain(s.questionIds),plain(queue.map(q=>q.id)));assert.equal(s.cursor,0);assert.equal(s.steps[0].choice,2);assert.equal(s.steps[0].status,'pending');assert.equal(s.integrityError,null);
 assert.deepEqual(plain((await restarted.repository.read('sessions',started.sessionId)).value.steps),stored.value.steps);assert.equal((await restarted.next(started.sessionId,0)).status,'blocked');
 legacy.state.fail=false;assert.equal((await restarted.submit(started.sessionId,2,99,0)).status,'applied');assert.deepEqual(legacy.attempts.get(stored.value.steps[0].attemptId),stored.value.steps[0].pendingPayload);
 assert.equal((await restarted.readProjection()).sessions.find(row=>row.id===started.sessionId).cursor,0);assert.equal((await restarted.next(started.sessionId,0)).status,'applied');assert.equal(legacy.attempts.size,1);
 }finally{first.close();restarted?.close();}}
test('actual old113 pending session keeps hash/queue/choice/41secs/IDs on synthetic313 restart',()=>restorePending(old.CANDIDATE_R2_QUESTIONS));
test('actual old163 pending session keeps hash/queue/choice/41secs/IDs on synthetic313 restart',()=>restorePending(old.QUESTIONS));
test('actual selector hard cap preserves a whole unit at the 200 boundary',()=>{
 const select=actual.load('lib/practice-selection.ts').selectPractice,singles=Array.from({length:199},(_,i)=>({...plain(old.QUESTIONS.find(q=>!q.groupId)),id:'test-boundary-'+i})),group=plain(admitted.questions.filter(q=>q.part===3).slice(0,3));
 const result=select([...singles,...group],[],{intent:'custom',targetCount:200});assert.equal(result.kind,'queue');assert.equal(result.questions.length,199);assert.equal(result.questions.some(q=>q.groupId),false);
 for(const targetCount of [1,5,50,163,200]){const before=select(old.QUESTIONS,[],{intent:'custom',targetCount});assert(before.questions.length<=163);for(const q of before.questions)if(q.groupId)assert.equal(before.questions.filter(other=>unitId(other)===unitId(q)).length,old.QUESTIONS.filter(other=>unitId(other)===unitId(q)).length);}
});
test('actual workflow accepts synthetic full200 but blocks201 and incomplete authored groups',async()=>{
 const legacy=facts(),w=await workflow.createPracticeWorkflow({scope:{kind:'web-owner',ownerId:'test-only-fresh'},timezone:'Asia/Shanghai',questions:expanded.QUESTIONS,compatibleQuestionCatalogs:expanded.PRACTICE_QUESTION_CATALOGS,factory:new IDBFactory(),name:'listening200-fresh',legacy:legacy.adapter});
 try{const all=expanded.LISTENING_COLLECTION_QUESTIONS,tooMany=[...all,old.CANDIDATE_R2_QUESTIONS.find(q=>!q.groupId)];assert.equal((await w.start(tooMany,{unitIds:[...new Set(tooMany.map(unitId))]})).status,'blocked');
 const partial=all.filter(q=>q.part===3).slice(0,2);assert.equal((await w.start(partial,{unitIds:[...new Set(partial.map(unitId))]})).status,'blocked');
 assert.equal((await w.start(all,{unitIds:[...new Set(all.map(unitId))]})).status,'started');assert.equal((await w.readProjection()).sessions[0].catalogVersion,expanded.QUESTION_CATALOG_VERSIONS.listening200_313);assert.equal(legacy.attempts.size,0);
 }finally{w.close();}
});
function home(questions,listening){const noop=()=>null,jsx=(type,props)=>({type,props}),calls=[];
 const ui=loader({react:{useState:value=>[value,()=>{}]},'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{ArrowRight:noop,BookOpen:noop,Headphones:noop,Mic:noop,Clock:noop},
 '@/components/ui/tabs':{Tabs:noop,TabsContent:noop,TabsList:noop,TabsTrigger:noop},
 '@/components/ui/dialog':{Dialog:noop,DialogContent:noop,DialogHeader:noop,DialogTitle:noop,DialogDescription:noop}}).load('app/learn/practice-home.tsx');
 const tree=ui.PracticeHome({questions,listening,busy:false,tab:'lr',onTab(){},onStart:rows=>calls.push(['start',rows.length]),onPart(){},onCustom:(part,count)=>calls.push(['custom',part,count]),onWrong(){},onListeningWrong(){},onMock(){},children:null}),nodes=[];
 function walk(value){if(Array.isArray(value))return value.forEach(walk);if(!value||typeof value!=='object')return;nodes.push(value);walk(value.props?.children);}walk(tree);
 function text(value){if(value==null)return '';if(Array.isArray(value))return value.map(text).join('');return typeof value==='object'?text(value.props?.children):String(value);}return{calls,nodes,text};}
test('actual PracticeHome presents 200 only for actual200 props and bounds the large-catalog handler',()=>{
 const ui=home(expanded.QUESTIONS,expanded.LISTENING_COLLECTION_QUESTIONS);assert.equal(ui.text(ui.nodes.find(n=>n.type==='option'&&n.props.value==='listening50')),'听力200题');
 ui.nodes.find(n=>n.type==='button'&&ui.text(n)==='综合练习').props.onClick();assert.deepEqual(ui.calls,[['custom',undefined,200]]);
 const prior=home(old.QUESTIONS,old.LISTENING_COLLECTION_QUESTIONS);assert.equal(prior.text(prior.nodes.find(n=>n.type==='option'&&n.props.value==='listening50')),'听力50题');
 prior.nodes.find(n=>n.type==='button'&&prior.text(n)==='综合练习').props.onClick();assert.deepEqual(prior.calls,[['start',163]]);
});
