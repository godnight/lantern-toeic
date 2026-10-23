import legacyData from '../content/questions.json';
import listening50Gate from '../content/questions-v041-listening50-text-image-gates.json';
import {validatedListening50Questions,LISTENING50_STATS} from './listening50-catalog';
import {getReviewedListeningAudio} from './question-audio-dispatch-v041';
import {LISTENING150_ADMISSION} from './listening150-package';
export {LISTENING50_STATS};
import b03Data from '../content/questions-v040-b03-r2.json';
import gateData from '../content/questions-v040-b03-r2-gates.json';
import mediaData from '../content/questions-v040-b03-r2-media.json';
import historicalR1Data from '../content/questions-v040-catalog-r1-snapshot.json';
import {canonicalHash,canonicalJson} from './domain-command';
import type {Question} from './study-model';

export type QuestionAudioSelection={audioKey:string;materialId:string;segmentId:string;voiceProfileId:string};
export type QuestionMediaUnit={unitId:string;questionIds:string[];sourceQuestionsSha256:string;effectiveAudioRequestsSha256:string;candidateStatus:'accepted-for-candidate';audio:QuestionAudioSelection};
export type QuestionCatalogGate={sourceQuestionsSha256:string;readingQuestionIds:readonly string[];listeningTextQuestionIds:readonly string[];imageHoldQuestionIds:readonly string[];audioInputs:{effective59RequestSha256:string}};
export const questionUnitId=(q:Question)=>q.groupId?`group:${q.part}:${q.groupId}`:`question:${q.id}`;
const unitCount=(rows:readonly Question[])=>new Set(rows.map(questionUnitId)).size;
export const LEGACY_QUESTIONS=legacyData as Question[];
export const B03_QUESTIONS=b03Data as Question[];
export const B03_SOURCE=gateData;

/** Register explicit text clearance and complete, identity-bound media units only. */
export function registerQuestionCatalog(legacy:readonly Question[],batch:readonly Question[],gate:QuestionCatalogGate,media:readonly QuestionMediaUnit[]=[]) {
 const all=new Map<string,Question>();for(const q of [...legacy,...batch]){if(all.has(q.id))throw Error('question-catalog-duplicate');all.set(q.id,q);}
 const legacyUnits=new Set(legacy.map(questionUnitId));if(batch.some(q=>legacyUnits.has(questionUnitId(q))))throw Error('question-unit-collision');
 const source=new Map(batch.map(q=>[q.id,q])),reading=new Set(gate.readingQuestionIds),listening=new Set(gate.listeningTextQuestionIds),held=new Set(gate.imageHoldQuestionIds);
 if(reading.size!==gate.readingQuestionIds.length||listening.size!==gate.listeningTextQuestionIds.length||held.size!==gate.imageHoldQuestionIds.length)throw Error('question-clearance-duplicate');
 for(const id of reading){const q=source.get(id);if(!q||q.part<5||held.has(id)||listening.has(id))throw Error('question-reading-clearance-invalid');}
 for(const id of listening){const q=source.get(id);if(!q||q.part<2||q.part>4||held.has(id))throw Error('question-listening-clearance-invalid');}
 for(const id of held)if(!source.has(id))throw Error('question-hold-unknown');
 const activated=new Set(reading),audioByQuestion=new Map<string,QuestionAudioSelection>(),units=new Set<string>();
 for(const unit of media){
  if(units.has(unit.unitId)||unit.candidateStatus!=='accepted-for-candidate'||unit.sourceQuestionsSha256!==gate.sourceQuestionsSha256||unit.effectiveAudioRequestsSha256!==gate.audioInputs.effective59RequestSha256)throw Error('question-media-identity-invalid');
  const expected=batch.filter(q=>questionUnitId(q)===unit.unitId);
  if(!expected.length||JSON.stringify(expected.map(q=>q.id))!==JSON.stringify(unit.questionIds)||expected.some(q=>!listening.has(q.id)||held.has(q.id)))throw Error('question-media-unit-incomplete');
  if(!unit.audio||!['audioKey','materialId','segmentId','voiceProfileId'].every(key=>typeof unit.audio[key as keyof QuestionAudioSelection]==='string'&&!!unit.audio[key as keyof QuestionAudioSelection].trim()))throw Error('question-media-selector-missing');
  units.add(unit.unitId);for(const q of expected){activated.add(q.id);audioByQuestion.set(q.id,unit.audio);}
 }
 // A grouped text clearance cannot silently create a partial practice unit.
 for(const q of batch)if(activated.has(q.id)&&q.groupId&&batch.some(other=>questionUnitId(other)===questionUnitId(q)&&!activated.has(other.id)))throw Error('question-text-group-incomplete');
 const added=batch.filter(q=>activated.has(q.id)),questions=[...legacy,...added];
 return {questions,added,audioByQuestion,counts:{legacyQuestions:legacy.length,legacyUnits:unitCount(legacy),availableQuestions:questions.length,availableUnits:unitCount(questions),addedQuestions:added.length,addedUnits:unitCount(added),readingAddedQuestions:added.filter(q=>q.part>=5).length,readingAddedUnits:unitCount(added.filter(q=>q.part>=5)),listeningAddedQuestions:added.filter(q=>q.part<=4).length,listeningAddedUnits:unitCount(added.filter(q=>q.part<=4)),listeningAwaitingMediaQuestions:batch.filter(q=>listening.has(q.id)&&!activated.has(q.id)).length,imageHoldQuestions:held.size}};
}
if(mediaData.sourceQuestionsSha256!==gateData.sourceQuestionsSha256||mediaData.effectiveAudioRequestsSha256!==gateData.audioInputs.effective59RequestSha256)throw Error('question-media-source-mismatch');
const registered=registerQuestionCatalog(LEGACY_QUESTIONS,B03_QUESTIONS,gateData,mediaData.units as QuestionMediaUnit[]);
export const CANDIDATE_R2_QUESTIONS:Question[]=registered.questions;
export const LISTENING50_QUESTIONS=validatedListening50Questions(CANDIDATE_R2_QUESTIONS);
export const LISTENING50_CATALOG_163:Question[]=[...CANDIDATE_R2_QUESTIONS,...LISTENING50_QUESTIONS];
const additionalListening=LISTENING150_ADMISSION?.questions??[];
if(additionalListening.some(q=>LISTENING50_CATALOG_163.some(old=>old.id===q.id)))throw Error('listening150-legacy-id-collision');
export const LISTENING_COLLECTION_QUESTIONS:Question[]=[...LISTENING50_QUESTIONS,...additionalListening];
export const LISTENING_COLLECTION_STATS={questions:LISTENING_COLLECTION_QUESTIONS.length,materials:unitCount(LISTENING_COLLECTION_QUESTIONS),targetQuestions:200,ready200:additionalListening.length===150};
export const QUESTIONS:Question[]=[...LISTENING50_CATALOG_163,...additionalListening];
export const QUESTION_CATALOG_STATS={...registered.counts,availableQuestions:QUESTIONS.length,availableUnits:unitCount(QUESTIONS),newListening50Questions:50,newListening50Units:30,newListening150Questions:additionalListening.length,newListening150Units:unitCount(additionalListening),priorListeningQuestions:CANDIDATE_R2_QUESTIONS.filter(q=>q.part<=4).length};
/** App opts in explicitly; default workflow APIs and legacy expression seeds remain unchanged. */
export const READING_ONLY_QUESTIONS=registerQuestionCatalog(LEGACY_QUESTIONS,B03_QUESTIONS,gateData,[]).questions;
/** Exact r1 question objects remain available to resume their original practice hash. */
export const R1_QUESTIONS=historicalR1Data as Question[];
export const QUESTION_CATALOG_VERSIONS={
 legacy68:'practice-v1:4d988136891fac939c17ebad3f7ab5a2e32c2d8df3155a5be1a9e9a39b95dc9e',
 reading93:'practice-v1:d160c266be1fa18b59f6cf7af559bb81209d3f97804454fa7cbb04e24002ced8',
 frozenR1_106:'practice-v1:e468ef5e6bb6c0dd7d7ebd8c5f98bbc2f742f81cb7bcba94447cd474f3ff2371',
 candidateR2_113:'practice-v1:3dff085048aeb511e4c2539ba4d7e876b8cf7213385472d489c817987f879c1e',
 listening50_163:'practice-v1:'+listening50Gate.combinedCatalogCanonicalSha256,
 ...(LISTENING150_ADMISSION?{listening200_313:'practice-v1:'+LISTENING150_ADMISSION.combined313CanonicalSha256}:{})
} as const;
function assertExactCatalogSnapshot(rows:readonly Question[],version:string){
 if('practice-v1:'+canonicalHash(canonicalJson(JSON.parse(JSON.stringify(rows))))!==version)throw Error('question-catalog-snapshot-mismatch');
}
assertExactCatalogSnapshot(LEGACY_QUESTIONS,QUESTION_CATALOG_VERSIONS.legacy68);
assertExactCatalogSnapshot(READING_ONLY_QUESTIONS,QUESTION_CATALOG_VERSIONS.reading93);
assertExactCatalogSnapshot(R1_QUESTIONS,QUESTION_CATALOG_VERSIONS.frozenR1_106);
assertExactCatalogSnapshot(CANDIDATE_R2_QUESTIONS,QUESTION_CATALOG_VERSIONS.candidateR2_113);
assertExactCatalogSnapshot(LISTENING50_CATALOG_163,QUESTION_CATALOG_VERSIONS.listening50_163);
if(LISTENING150_ADMISSION)assertExactCatalogSnapshot(QUESTIONS,'practice-v1:'+LISTENING150_ADMISSION.combined313CanonicalSha256);
export const PRACTICE_QUESTION_CATALOGS:readonly (readonly Question[])[]=[LEGACY_QUESTIONS,READING_ONLY_QUESTIONS,R1_QUESTIONS,CANDIDATE_R2_QUESTIONS,LISTENING50_CATALOG_163,...(LISTENING150_ADMISSION?[QUESTIONS]:[])];
export function getQuestionAudioSelection(qid:string):QuestionAudioSelection|null{return getReviewedListeningAudio(qid)?.body??registered.audioByQuestion.get(qid)??null;}
