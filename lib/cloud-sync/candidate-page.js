// Disabled integration candidate. Only synthetic databases may be opened.
// This module is not imported by the application entry point.
import {FENCE,COMMITS} from './idb-fence.js';
import {STORE} from './offline-queue.js';
import {STATE,SESSION,createStudyRunner} from './study-runner.js';
import {createSyntheticClient} from './client.js';
import {projectNativeVocabularyEvents} from './vocabulary-projection';

const PREFIX='lantern-synthetic-sync-';
export function openSyntheticSyncDatabase(factory,name){
 if(!factory||typeof factory.open!=='function'||typeof name!=='string'||!/^lantern-synthetic-sync-[a-z0-9-]{1,80}$/.test(name))return Promise.reject(Error('synthetic database required'));
 return new Promise((resolve,reject)=>{
  let blocked=false;const request=factory.open(name,1);
  request.onupgradeneeded=()=>{
   const db=request.result;
   db.createObjectStore(FENCE,{keyPath:'id'});db.createObjectStore(COMMITS,{keyPath:'id'});
   db.createObjectStore(STORE,{keyPath:'owner'});db.createObjectStore(STATE,{keyPath:'owner'});db.createObjectStore(SESSION,{keyPath:'id'});
  };
  request.onsuccess=()=>{if(blocked)request.result.close();else resolve(request.result);};
  request.onerror=()=>reject(request.error??Error('database unavailable'));
  request.onblocked=()=>{blocked=true;reject(Error('database blocked'));};
 });
}
export function createCandidatePageClient({db,vocabTransport,studyTransport}){
 if(!db||typeof db.name!=='string'||!db.name.startsWith(PREFIX))throw Error('synthetic database required');
 return createSyntheticClient({db,project:projectNativeVocabularyEvents,vocabTransport,studyTransport,createStudyRunner});
}
