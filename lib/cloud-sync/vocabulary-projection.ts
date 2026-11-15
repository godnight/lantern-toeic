/**
 * Pure, unconnected vocabulary synchronization projection candidate.
 * It performs no storage or networking. Both the local events and captured
 * response must eventually be committed with the response cursor in the same
 * owner-scoped transaction; existing localStorage/IDB writers do not yet share
 * such a fence, so this function MUST NOT be connected to real user data.
 */
import {mergeVocabularyEvents,validVocabularyEvent,vocabularyReviewHash,vocabularyState,type VocabularyEvent} from '../vocabulary-model';
import type {NativeStudyLease} from '../native-study-m2a';
import {StudySyncError} from '../study-sync';

export type NativeVocabularyCandidateSnapshot={version:1;owner:string;stateVersion:number;events:VocabularyEvent[]};
export type NativeVocabularyCandidatePage={version:1;owner:string;events:VocabularyEvent[]};
export type NativeVocabularyCandidateResult=NativeVocabularyCandidateSnapshot & {unresolvedCorrectionIds:string[]};
const OWNER=/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventFields={review:['id','wordId','createdAt','type','grade'],mark:['id','wordId','createdAt','type','starred','revision'],'review-correction':['id','wordId','createdAt','type','reviewId','reviewHash','grade']} as const;
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:readonly string[])=>Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const invalid=()=>new StudySyncError('词卡同步内容无效，本机记录已保留',422);
function current(lease:NativeStudyLease,owner:string){
 if(!OWNER.test(owner)||lease?.owner!==owner||!lease.signal||lease.signal.aborted||typeof lease.isCurrent!=='function'||!lease.isCurrent())throw new StudySyncError('账号已切换，同步已取消',409);
}
function validEvent(value:unknown):value is VocabularyEvent{
 if(!isObject(value)||typeof value.type!=='string'||!Object.hasOwn(eventFields,value.type))return false;
 return exact(value,eventFields[value.type as keyof typeof eventFields])&&validVocabularyEvent(value);
}

/** The caller must retain exactly the version captured when dispatching and
 * atomically compare it to durable state again when committing the result. */
export function projectNativeVocabularyEvents(snapshot:NativeVocabularyCandidateSnapshot,page:unknown,request:{owner:string;stateVersion:number},lease:NativeStudyLease):NativeVocabularyCandidateResult{
 current(lease,snapshot?.owner);
 if(!isObject(snapshot)||!exact(snapshot,['version','owner','stateVersion','events'])||snapshot.version!==1||!Number.isSafeInteger(snapshot.stateVersion)||snapshot.stateVersion<0||snapshot.stateVersion>=Number.MAX_SAFE_INTEGER||!Array.isArray(snapshot.events)||snapshot.events.length>100000||!snapshot.events.every(validEvent))throw invalid();
 if(!isObject(request)||!exact(request,['owner','stateVersion'])||request.owner!==snapshot.owner||request.stateVersion!==snapshot.stateVersion)throw new StudySyncError('词卡同步请求已过期，本机记录已保留',409);
 if(!isObject(page)||!exact(page,['version','owner','events'])||page.version!==1||page.owner!==snapshot.owner||!Array.isArray(page.events)||page.events.length>1000||!page.events.every(validEvent))throw invalid();
 let bytes:number;try{bytes=new TextEncoder().encode(JSON.stringify(page)).byteLength;}catch{throw invalid();}
 if(bytes>256*1024)throw invalid();
 let events:VocabularyEvent[];try{events=mergeVocabularyEvents(snapshot.events,page.events as VocabularyEvent[]);}catch{throw new StudySyncError('词卡记录标识冲突，本机记录已保留',409);}
 if(events.length>100000)throw invalid();
 const byId=new Map(events.map(event=>[event.id,event])),unresolved:string[]=[];
 for(const event of events){
  if(event.type!=='review-correction')continue;
  const review=byId.get(event.reviewId);
  if(!review){unresolved.push(event.id);continue;}
  if(review.type!=='review'||review.grade!=='remembered'||review.wordId!==event.wordId||Date.parse(event.createdAt)<Date.parse(review.createdAt)||vocabularyReviewHash(review)!==event.reviewHash)throw new StudySyncError('词卡改判与原记录不一致，本机记录已保留',409);
 }
 current(lease,snapshot.owner);
 return {version:1,owner:snapshot.owner,stateVersion:snapshot.stateVersion+1,events:copy(events),unresolvedCorrectionIds:unresolved.sort()};
}

/** Only for isolated calculation tests. This value is NEVER a confirmed SRS:
 * another page may contain a correction that has not been received yet. */
export function candidateVocabularyTentativeSrs(result:NativeVocabularyCandidateResult,wordId:string){
 if(result.events.some(event=>event.type==='review-correction'&&event.wordId===wordId&&result.unresolvedCorrectionIds.includes(event.id)))return null;
 return vocabularyState(result.events,wordId);
}

/** This protocol has no authenticated stable snapshot/checkpoint and cannot
 * prove whether another page exists. Until that contract is implemented and
 * verified, SRS is always unconfirmed, even when no orphan was seen. */
export function candidateVocabularySrs(_result:NativeVocabularyCandidateResult,_wordId:string):null{return null;}
