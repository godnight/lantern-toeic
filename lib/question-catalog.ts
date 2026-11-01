import {completeQuestionCatalogSynchronously} from './question-catalog-admission';
import {installServerQuestionCatalog,readPreparedQuestionCatalog} from './prepare-study-content';
export {registerQuestionCatalog,questionUnitId,LISTENING50_STATS} from './question-catalog-admission';
export type {QuestionAudioSelection,QuestionMediaUnit,QuestionCatalogGate} from './question-catalog-admission';
// Browser consumers enter only after all complete catalogue identities match.
const catalog=typeof window==='undefined'?installServerQuestionCatalog(completeQuestionCatalogSynchronously):readPreparedQuestionCatalog();
export const {LEGACY_QUESTIONS,B03_QUESTIONS,B03_SOURCE,CANDIDATE_R2_QUESTIONS,LISTENING50_QUESTIONS,LISTENING50_CATALOG_163,LISTENING_COLLECTION_QUESTIONS,LISTENING_COLLECTION_STATS,QUESTIONS,QUESTION_CATALOG_STATS,READING_ONLY_QUESTIONS,R1_QUESTIONS,QUESTION_CATALOG_VERSIONS,PRACTICE_QUESTION_CATALOGS,getQuestionAudioSelection}=catalog;
