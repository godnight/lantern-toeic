'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
test('generated hosted config must route exactly the candidate pack through the Worker first',async()=>{
 const {checkLocalCandidateWorkerFirst,PRIVATE_CANDIDATE_ROUTE}=await import(pathToFileURL(path.resolve(__dirname,'../scripts/check-local-candidate-worker-first.mjs')).href);
 const valid={assets:{binding:'ASSETS',directory:'../client',run_worker_first:[PRIVATE_CANDIDATE_ROUTE]}};
 assert.equal(checkLocalCandidateWorkerFirst(valid),true);
 for(const assets of [undefined,{...valid.assets,run_worker_first:true},{...valid.assets,run_worker_first:[]},{...valid.assets,run_worker_first:[PRIVATE_CANDIDATE_ROUTE,'/*']},{...valid.assets,binding:'OTHER'},{...valid.assets,directory:'../other'}]){
  assert.throws(()=>checkLocalCandidateWorkerFirst({assets}));
 }
});
