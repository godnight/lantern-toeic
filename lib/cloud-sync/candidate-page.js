// Disabled integration candidate. Only synthetic databases may be opened.
// This module is not imported by the application entry point.
import {FENCE,COMMITS} from './idb-fence.js';
import {STORE} from './offline-queue.js';
import {STATE,SESSION,createStudyRunner} from './study-runner.js';
import {createSyntheticClient} from './client.js';
import {projectNativeVocabularyEvents} from './vocabulary-projection';
import {createCapturedVocabularyMarkPump} from './capture-vocabulary.js';
import {scanSyntheticStudyJournal} from './capture-study-journal.js';
import {importNativeVocabularySource} from './native-vocabulary-source';
import {guardStudyJournalUpload} from './study-source-upload-guard.js';

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
export function createCandidatePageClient({db,vocabTransport,studyTransport,autoCapture}){
 if(!db||typeof db.name!=='string'||!db.name.startsWith(PREFIX))throw Error('synthetic database required');
 if(autoCapture!==undefined&&(!autoCapture||typeof autoCapture!=='object'||!autoCapture.storage||!autoCapture.target))throw Error('capture unavailable');
 let client;
 const guardedStudy=autoCapture===undefined?studyTransport:guardStudyJournalUpload(autoCapture.storage,{get session(){return client?.session;},readStudy:()=>client.readStudy()},studyTransport);
 client=createSyntheticClient({db,project:projectNativeVocabularyEvents,vocabTransport,studyTransport:guardedStudy,createStudyRunner});
 if(autoCapture===undefined)return client;
 let pump,sourceStatus;
 const cancel=client.cancel,run=client.run;
 client.run=session=>{
  if(!sourceStatus||sourceStatus.session!==session||client.session!==session||session.signal.aborted)throw Error('source inspection unavailable');
  sourceStatus.guard();
  return run(session,sourceStatus.options);
 };
 client.start=owner=>{
  if(pump||!client.session||client.session.owner!==owner||client.session.signal.aborted)throw Error('session revoked');
  pump=createCapturedVocabularyMarkPump({storage:autoCapture.storage,owner,client,target:autoCapture.target,
   captureVocabulary:async session=>{
    if(client.session!==session||session.signal.aborted)throw Error('session revoked');
    sourceStatus=undefined;
    const imported=await importNativeVocabularySource(autoCapture.storage,client);
    if(client.session!==session||session.signal.aborted)throw Error('session revoked');
    const blockedEventIds=Object.freeze([...imported.conflictingEventIds,...imported.deferredCorrectionIds]);
    sourceStatus=Object.freeze({session,guard:imported.isCurrent,options:Object.freeze({blockedEventIds,
     sourceUnresolved:blockedEventIds.length>0,sourceGuard:imported.isCurrent})});
   },captureStudy:async session=>{if(client.session!==session||session.signal.aborted)throw Error('session revoked');
    await scanSyntheticStudyJournal(autoCapture.storage,owner,client);}});
 };
 client.cancel=async()=>{pump?.stop();pump=undefined;sourceStatus=undefined;await cancel();};
 return client;
}
