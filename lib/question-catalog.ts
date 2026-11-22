import {completeQuestionCatalogSynchronously} from './question-catalog-admission';
import {installServerQuestionCatalog,readPreparedQuestionCatalog} from './prepare-study-content';
import {captureCompiledPart1TwelvePackage} from './listening-part1-12-package-admission';
import {admitPart1TwelvePackage} from './listening-part1-12-catalog';
import {extendPart1Catalog} from './extend-part1-catalog';
export {registerQuestionCatalog,questionUnitId,LISTENING50_STATS} from './question-catalog-admission';
export type {QuestionAudioSelection,QuestionMediaUnit,QuestionCatalogGate} from './question-catalog-admission';
// Browser consumers enter only after all complete catalogue identities match.
const createServerCatalog=()=>{
 const base=completeQuestionCatalogSynchronously();
 const source=captureCompiledPart1TwelvePackage();
 const accepted=admitPart1TwelvePackage(source.input,source.pins,base.BASE_QUESTIONS);
 return extendPart1Catalog(base,accepted,source.extensionPins);
};
const catalog=typeof window==='undefined'?installServerQuestionCatalog(createServerCatalog):readPreparedQuestionCatalog();
export const {LEGACY_QUESTIONS,B03_QUESTIONS,B03_SOURCE,CANDIDATE_R2_QUESTIONS,LISTENING50_QUESTIONS,LISTENING50_CATALOG_163,LISTENING_COLLECTION_QUESTIONS,LISTENING_COLLECTION_STATS,BASE_QUESTIONS,QUESTIONS,QUESTION_CATALOG_STATS,READING_ONLY_QUESTIONS,R1_QUESTIONS,QUESTION_CATALOG_VERSIONS,PRACTICE_QUESTION_CATALOGS,getQuestionAudioSelection}=catalog;
