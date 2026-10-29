'use strict';
// Post-verification workspace fixtures use real fully admitted catalogues.
// Browser pending/owner/retry gates remain tested separately, never bypassed
// with an empty catalogue or a fabricated pinned identity.
const {createSourceLoader}=require('./actual-source-loader.cjs');
const cache=new Map();
exports.preparedWorkspaceImports=root=>{
 if(!cache.has(root)){
  const loader=createSourceLoader({root});
  cache.set(root,{content:loader.load('lib/vocabulary-content-catalog.ts'),questions:loader.load('lib/question-catalog.ts'),views:loader.load('lib/learning-word-views.ts'),index:loader.load('lib/natural-audio-catalog-index.ts')});
 }
 const {content,questions,views,index}=cache.get(root);
 return {'@/lib/vocabulary-content-catalog':content,'./vocabulary-content-catalog':content,'@/lib/question-catalog':questions,'./question-catalog':questions,'@/lib/learning-word-views':views,'./learning-word-views':views,'@/lib/natural-audio-catalog-index':index,'./natural-audio-catalog-index':index};
};
