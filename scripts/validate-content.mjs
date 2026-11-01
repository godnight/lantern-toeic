import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const json=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const legacyQuestions=await json('content/questions.json');
const batchBytes=await readFile(new URL('../content/questions-v040-b03-r2.json',import.meta.url));
const batch=JSON.parse(batchBytes),gate=await json('content/questions-v040-b03-r2-gates.json'),media=await json('content/questions-v040-b03-r2-media.json');
assert.equal(createHash('sha256').update(batchBytes).digest('hex'),gate.sourceQuestionsSha256,'B03 source bytes changed');
assert.equal(gate.sourceQuestionsSha256,'776c071ab3ae2763c9c0a13ca71448ead7ebabb8d8a638dc0ac1e975e6758821','B03 clearance targets another revision');
assert.equal(gate.sourceFreezeSha256,'85c2a316aa5419505c0ec2c70e1c356404b1002e28801a2ddc07de79e211cc7e');
const require=createRequire(import.meta.url),ts=require(process.env.LANTERN_DEPENDENCY_ROOT?process.env.LANTERN_DEPENDENCY_ROOT+'/node_modules/typescript':'typescript');
const {createSourceLoader}=require('../tests/helpers/actual-source-loader.cjs');
const catalogLoader=createSourceLoader({root:fileURLToPath(new URL('..',import.meta.url)),allowedFiles:[
 'lib/domain-command.ts','lib/question-catalog.ts','lib/question-catalog-admission.ts','lib/practice-catalog-identity.ts','lib/listening50-catalog.ts','lib/question-audio-bindings-v041.ts',
 'lib/question-audio-dispatch-v041.ts','lib/listening150-package.ts','lib/listening150-catalog.ts','lib/natural-audio-catalog-index.ts','content/natural-audio-catalog-v1.json',
 'lib/listening150-package-admission.ts','lib/natural-audio-catalog-admission.ts','lib/prepare-listening150-package.ts','lib/prepare-natural-audio-catalog.ts',
 'lib/prepare-study-content.ts','lib/prepare-vocabulary-catalog.ts','lib/cooperative-task.ts','lib/preparation-timing.ts',
 'content/questions-v041-listening150.json','content/questions-v041-listening150-text-image-gates.json','content/questions-v041-listening150-media.json',
 'content/questions.json','content/questions-v040-b03-r2.json','content/questions-v040-b03-r2-gates.json','content/questions-v040-b03-r2-media.json','content/questions-v040-catalog-r1-snapshot.json',
 'content/questions-v041-listening50.json','content/questions-v041-listening50-text-image-gates.json','content/questions-v041-listening50-media.json'
]});
const exports=catalogLoader.load('lib/question-catalog.ts');
const questions=exports.QUESTIONS,catalogCounts=exports.QUESTION_CATALOG_STATS;
const speaking=await json('content/speaking.json');
const exams=await json('content/exams/catalogue.json');
/** Local qualification of newly admitted exact image bytes, not pixel/semantic review. */
export function validateShaPng(bytes,expectedSha256){
 assert.equal(createHash('sha256').update(bytes).digest('hex'),expectedSha256,'New listening image byte hash differs from its exact URL');
 assert(bytes.length>=33&&bytes.length<25*1024*1024,'New listening image size is invalid');
 assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'New listening image PNG signature is invalid');
 assert.equal(bytes.readUInt32BE(8),13,'New listening PNG must begin with a complete IHDR');assert.equal(bytes.toString('ascii',12,16),'IHDR');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);assert(width>0&&height>0,'New listening PNG dimensions must be positive');
 return {bytes:bytes.length,width,height,sha256:expectedSha256};
}
const all=new Set();
for(const q of [...legacyQuestions,...batch,...exports.LISTENING_COLLECTION_QUESTIONS]){
 assert.equal(typeof q.id,'string');assert(!all.has(q.id),`Duplicate question ${q.id}`);all.add(q.id);
 assert(Number.isInteger(q.part)&&q.part>=1&&q.part<=7,q.id);
 assert.equal(q.options.length,q.part===2?3:4,q.id);
 assert(Number.isInteger(q.correctIndex)&&q.correctIndex>=0&&q.correctIndex<q.options.length,q.id);
 for(const field of ['title','prompt','explanation','evidence','skill'])assert(typeof q[field]==='string'&&q[field].trim(),`${q.id}: ${field}`);
 if(q.part<=4)assert(q.audioText||q.transcript,`${q.id}: no listening script`);
 if(q.image){
  const newImage=/^\/listening200-r1\/([a-f0-9]{64})\.png$/.exec(q.image);
  assert((q.image.startsWith('/images/')||/^\/listening50-r3\/[a-f0-9]{64}\.png$/.test(q.image)||newImage)&&!q.image.includes('..'));
  const imageUrl=new URL('../public'+q.image,import.meta.url);await access(imageUrl);
  if(newImage)validateShaPng(await readFile(imageUrl),newImage[1]);
 }
}
for(const s of speaking){
 assert(!all.has(s.id));all.add(s.id);
 assert(s.prompt&&s.sampleAnswer&&s.guide.length);
 assert(s.prepSeconds>=0&&s.answerSeconds>0);
}
const ids=new Set();
for(const r of exams){
 assert(!ids.has(r.id),`Duplicate resource ${r.id}`);ids.add(r.id);
 assert(['official-sample','official-preparation','official-past-paper'].includes(r.category));
 assert.equal(r.rights,'link-only');
 assert(/^\d{4}-\d{2}-\d{2}$/.test(r.verifiedAt));
 assert(r.provider&&r.title&&r.description&&r.usageSteps.length&&r.accessNote);
 for(const url of [r.landingUrl,r.downloadUrl].filter(Boolean))assert.equal(new URL(url).protocol,'https:');
 if(r.downloadUrl)assert(r.downloadCheck.includes('opened'),`${r.id}: unverified download`);
 if(r.category==='official-past-paper')assert(r.officialPastExamEvidence&&r.collectionScope==='released-past-exam-selected-items',`${r.id}: missing actual-exam evidence/scope`);
}
console.log(`Validated ${questions.length} available questions / ${catalogCounts.availableUnits} complete practice units (${catalogCounts.readingAddedQuestions} added reading questions); ${catalogCounts.listeningAwaitingMediaQuestions} listening questions await media and ${catalogCounts.imageHoldQuestions} image question remains held; ${speaking.length} speaking prompts and ${exams.length} official resource records. Structural validation is not teacher review or reuse permission.`);
