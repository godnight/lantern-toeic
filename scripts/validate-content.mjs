import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const json=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const legacyQuestions=await json('content/questions.json');
const batchBytes=await readFile(new URL('../content/questions-v040-b03-r2.json',import.meta.url));
const batch=JSON.parse(batchBytes),gate=await json('content/questions-v040-b03-r2-gates.json'),media=await json('content/questions-v040-b03-r2-media.json');
assert.equal(createHash('sha256').update(batchBytes).digest('hex'),gate.sourceQuestionsSha256,'B03 source bytes changed');
assert.equal(gate.sourceQuestionsSha256,'776c071ab3ae2763c9c0a13ca71448ead7ebabb8d8a638dc0ac1e975e6758821','B03 clearance targets another revision');
assert.equal(gate.sourceFreezeSha256,'85c2a316aa5419505c0ec2c70e1c356404b1002e28801a2ddc07de79e211cc7e');
const require=createRequire(import.meta.url),ts=require(process.env.LANTERN_DEPENDENCY_ROOT?process.env.LANTERN_DEPENDENCY_ROOT+'/node_modules/typescript':'typescript');
const domainExports={};
const domainSource=await readFile(new URL('../lib/domain-command.ts',import.meta.url),'utf8');
vm.runInNewContext(ts.transpileModule(domainSource,{fileName:'domain-command.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:domainExports,TextEncoder,TextDecoder},{filename:'lib/domain-command.ts'});
const catalogImports={'../content/questions.json':legacyQuestions,'../content/questions-v040-b03-r2.json':batch,'../content/questions-v040-b03-r2-gates.json':gate,'../content/questions-v040-b03-r2-media.json':media,'../content/questions-v040-catalog-r1-snapshot.json':await json('content/questions-v040-catalog-r1-snapshot.json'),'./domain-command':domainExports},exports={};
const source=await readFile(new URL('../lib/question-catalog.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{fileName:'question-catalog.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
vm.runInNewContext(compiled,{exports,require:name=>{assert(Object.hasOwn(catalogImports,name),'Unexpected catalog dependency '+name);return catalogImports[name];}},{filename:'lib/question-catalog.ts'});
const questions=exports.QUESTIONS,catalogCounts=exports.QUESTION_CATALOG_STATS;
const speaking=await json('content/speaking.json');
const exams=await json('content/exams/catalogue.json');
const all=new Set();
for(const q of [...legacyQuestions,...batch]){
 assert.equal(typeof q.id,'string');assert(!all.has(q.id),`Duplicate question ${q.id}`);all.add(q.id);
 assert(Number.isInteger(q.part)&&q.part>=1&&q.part<=7,q.id);
 assert.equal(q.options.length,q.part===2?3:4,q.id);
 assert(Number.isInteger(q.correctIndex)&&q.correctIndex>=0&&q.correctIndex<q.options.length,q.id);
 for(const field of ['title','prompt','explanation','evidence','skill'])assert(typeof q[field]==='string'&&q[field].trim(),`${q.id}: ${field}`);
 if(q.part<=4)assert(q.audioText||q.transcript,`${q.id}: no listening script`);
 if(q.image){assert(q.image.startsWith('/images/')&&!q.image.includes('..'));await access(new URL('../public'+q.image,import.meta.url));}
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
