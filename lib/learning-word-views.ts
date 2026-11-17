import {completeLearningWordViewsSynchronously} from './learning-word-views-admission';
import {installServerLearningWordViews,readPreparedLearningWordViews} from './prepare-study-content';
const views=typeof window==='undefined'?installServerLearningWordViews(completeLearningWordViewsSynchronously):readPreparedLearningWordViews();
export const {SCENE_WORDS,EXPRESSION_WORDS,WORKFLOW_WORDS,WORKFLOW_BOOKS,importedCatalogs,reusableWords,learningWords,core,extraWords,questionWords}=views;
