import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PRIVATE_CANDIDATE_ROUTE='/audio/natural/v040-natural-572f7490ce71/*';

/** Check the generated deployment config, not only the Vite input. Static
 * assets normally bypass the Worker and must not bypass the integrity handler. */
export function checkLocalCandidateWorkerFirst(config){
 const assets=config?.assets;
 if(!assets||assets.binding!=='ASSETS'||assets.directory!=='../client'||
   !Array.isArray(assets.run_worker_first)||assets.run_worker_first.length!==1||
   assets.run_worker_first[0]!==PRIVATE_CANDIDATE_ROUTE){
  throw Error('Generated hosted config must bind ASSETS and route only the private candidate pack through the Worker first');
 }
 return true;
}

const here=path.dirname(fileURLToPath(import.meta.url));
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length>3){console.error('Usage: node scripts/check-local-candidate-worker-first.mjs [wrangler.json]');process.exitCode=1;}
 else try{
  const file=path.resolve(process.argv[2]??path.join(here,'../dist/server/wrangler.json'));
  checkLocalCandidateWorkerFirst(JSON.parse(await readFile(file,'utf8')));
  console.log('Private local-candidate Worker-first route is configured. This does not authorize deployment.');
 }catch(error){console.error(error instanceof Error?error.message:'Generated hosted config check failed');process.exitCode=1;}
}
