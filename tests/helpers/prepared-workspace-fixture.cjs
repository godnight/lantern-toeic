'use strict';
// Post-verification workspace unit fixtures start after the real content
// validator, rather than bypassing the browser's pending gate with empty data.
// Root readiness, cancellation and retry are tested in cold-catalog.test.cjs.
const {createSourceLoader}=require('./actual-source-loader.cjs');
const cache=new Map();
exports.preparedWorkspaceImports=root=>{
 if(!cache.has(root))cache.set(root,createSourceLoader({root}).load('lib/vocabulary-content-catalog.ts'));
 const content=cache.get(root);
 return {'@/lib/vocabulary-content-catalog':content,'./vocabulary-content-catalog':content};
};
