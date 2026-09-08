import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
const json=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const questions=await json('content/questions.json');
const speaking=await json('content/speaking.json');
const exams=await json('content/exams/catalogue.json');
const all=new Set();
for(const q of questions){
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
console.log(`Validated ${questions.length} original questions, ${speaking.length} speaking prompts and ${exams.length} official resource records. Structural validation is not teacher review or reuse permission.`);
