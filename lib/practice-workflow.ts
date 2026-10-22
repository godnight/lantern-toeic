import {initialPracticeTraining,materialHash,trainingHash,validatePracticeTraining,type PracticeTraining,type TrainingWrite} from './practice-training';
import {canonicalHash,canonicalJson,canonicalValue} from './domain-command';
import {openLearningDomainRepository,workflowScopeKey,type DomainCommitResult,type DomainRecord,type DomainWrite,type LearningDomainRepository,type WorkflowScope} from './learning-domain-repository';
import {createId,dayKey,type Attempt,type Checkin,type Question} from './study-model';

export type PracticeSettlementDraft={minutes:number;load:Checkin['load'];note:string};
type StoredStep={stepId:string;attemptId:string;commandId:string;initialSeen:boolean;status:'unanswered'|'prepared'|'applied';pendingPayload:Attempt|null};
type StoredSettlement={checkinId:string;commandId:string;status:'draft'|'prepared'|'applied';draft:PracticeSettlementDraft;pendingPayload:Checkin|null};
type StoredSession={kind:'practice-session';schemaVersion:1|2;training?:PracticeTraining;id:string;scopeKey:string;catalogVersion:string;chainId:string;questionIds:string[];unitIds:string[];cursor:number;steps:StoredStep[];status:'active'|'completed'|'left';startedAt:string;timezone:string;settlement:StoredSettlement};
type ActivePointer={kind:'practice-active';sessionId:string|null};
type BridgeCommand={kind:'practice-command';scopeKey:string;sessionId:string;stepId:string;intent:'practice-answer'|'settlement';status:'prepared'|'applied';legacyPayload:Attempt|Checkin};
export type PracticeStep={stepId:string;attemptId:string;commandId:string;initialSeen:boolean;status:'unanswered'|'pending'|'applied'|'reference-unverified';choice:number|null;attempt:Attempt|null};
export type PracticeSession={training:PracticeTraining;id:string;revision:number;catalogVersion:string;chainId:string;unitIds:string[];questionIds:string[];queue:Question[];cursor:number;steps:PracticeStep[];status:'active'|'completed'|'left';startedAt:string;timezone:string;integrityError:string|null;settlement:{checkinId:string;status:'draft'|'pending'|'applied'|'reference-unverified';draft:PracticeSettlementDraft;payload:Checkin|null}};
export type PracticeProjection={activeSessionId:string|null;sessions:PracticeSession[];pendingSettlements:PracticeSession[]};
export type PracticeResult={status:'started'|'restored'|'applied'|'replayed'|'updated'|'closed';sessionId:string;revision?:number}|{status:'pending'|'unknown';sessionId:string;reason:string}|{status:'conflict'|'blocked';reason:string;sessionId?:string};
export type PracticeLegacy={addAttempt:(attempt:Attempt)=>boolean;addCheckin:(checkin:Checkin)=>boolean;readAttempt:(id:string)=>Attempt|undefined;readCheckin:(id:string)=>Checkin|undefined};
export type PracticeStartOptions={unitIds:readonly string[];chainId?:string;initialSeenQids?:readonly string[]};
export type PracticeWorkflowOptions={scope:WorkflowScope;questions:readonly Question[];compatibleQuestionCatalogs?:readonly (readonly Question[])[];legacy:PracticeLegacy;timezone:string;repository?:LearningDomainRepository;factory?:IDBFactory;name?:string;now?:()=>Date;id?:()=>string;isCurrent?:()=>boolean;seenQuestionIds?:()=>readonly string[]};
const ACTIVE='practice:active';
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const json=(value:unknown)=>canonicalValue(value);
const validId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<250&&!/[\u0000-\u001f]/.test(value);
const stamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value));
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,allowed:readonly string[])=>{if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error('practice-schema-unsupported');};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validDraft(value:unknown):value is PracticeSettlementDraft {
 if(!plain(value))return false;
 return Number.isInteger(value.minutes)&&Number(value.minutes)>=1&&Number(value.minutes)<=240&&['轻','刚好','重'].includes(String(value.load))&&typeof value.note==='string'&&value.note.length<=1000&&Object.keys(value).every(key=>['minutes','load','note'].includes(key));
}
function validAttempt(value:unknown):value is Attempt {
 if(!plain(value))return false;
 return typeof value.id==='string'&&uuid.test(value.id)&&validId(value.qid)&&Number.isInteger(value.choice)&&Number(value.choice)>=0&&Number(value.choice)<=3&&typeof value.correct==='boolean'&&stamp(value.createdAt)&&Number.isInteger(value.seconds)&&Number(value.seconds)>=0&&Number(value.seconds)<=7200&&(value.mode==='first'||value.mode==='review')&&Object.keys(value).every(key=>['id','qid','choice','correct','createdAt','seconds','mode'].includes(key));
}
function validCheckin(value:unknown):value is Checkin {
 if(!plain(value))return false;
 const {id,date,createdAt,...draft}=value;
 return typeof id==='string'&&uuid.test(id)&&typeof date==='string'&&/^\d{4}-\d\d-\d\d$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date&&stamp(createdAt)&&validDraft(draft);
}
export function practiceCatalogVersion(questions:readonly Question[]):string {
 // JSON serialization drops optional undefined properties without changing authored text.
 return 'practice-v1:'+canonicalHash(canonicalJson(JSON.parse(JSON.stringify(questions))));
}
function unitId(question:Question){return question.groupId?`group:${question.part}:${question.groupId}`:`question:${question.id}`;}

type RegisteredPracticeCatalog={version:string;questions:readonly Question[];byId:Map<string,Question>};
function registerPracticeCatalogs(questions:readonly Question[],compatible:readonly (readonly Question[])[]=[]){
 const catalogs=new Map<string,RegisteredPracticeCatalog>();
 for(const rows of [questions,...compatible]){
  const byId=new Map(rows.map(question=>[question.id,question]));if(byId.size!==rows.length)throw Error('practice-catalog-duplicate');
  const version=practiceCatalogVersion(rows);catalogs.set(version,{version,questions:rows,byId});
 }
 return catalogs;
}
function parseRegisteredPracticeSession(row:DomainRecord<unknown>,scopeKey:string,primary:RegisteredPracticeCatalog,catalogs:Map<string,RegisteredPracticeCatalog>,now:()=>Date=()=>new Date()):StoredSession {
 const version=plain(row.value)&&typeof row.value.catalogVersion==='string'?row.value.catalogVersion:'';
 const registered=catalogs.get(version),source=registered??primary;
 const session=parsePracticeSession(row,scopeKey,source.version,source.byId,now);
 if(registered&&session.questionIds.some(id=>!registered.byId.has(id)))throw Error('practice-queue-invalid');
 return session;
}


function parsePracticeSession(row:DomainRecord<unknown>,scopeKey:string,catalogVersion:string,questions:Map<string,Question>,now:()=>Date=()=>new Date()):StoredSession {
  const value=row.value;
  if(!plain(value)||value.kind!=='practice-session'||(value.schemaVersion!==1&&value.schemaVersion!==2)||value.id!==row.id||value.scopeKey!==scopeKey||!validId(value.id)||typeof value.catalogVersion!=='string'||!validId(value.chainId)||!stamp(value.startedAt)||typeof value.timezone!=='string'||!Array.isArray(value.questionIds)||!value.questionIds.length||value.questionIds.length>200||!value.questionIds.every(validId)||new Set(value.questionIds).size!==value.questionIds.length||!Array.isArray(value.unitIds)||!value.unitIds.length||!value.unitIds.every(validId)||new Set(value.unitIds).size!==value.unitIds.length||!Array.isArray(value.steps)||value.steps.length!==value.questionIds.length||!Number.isInteger(value.cursor)||Number(value.cursor)<0||Number(value.cursor)>value.questionIds.length||!['active','completed','left'].includes(String(value.status)))throw Error('practice-session-corrupt');
  dayKey(now(),value.timezone);
  keys(value,['kind','schemaVersion','id','scopeKey','catalogVersion','chainId','questionIds','unitIds','cursor','steps','status','startedAt','timezone','settlement',...(value.schemaVersion===2?['training']:[])]);
  const session=value as unknown as StoredSession;
  if(!session.id.startsWith('practice:')||!/^practice-v1:[0-9a-f]{64}$/.test(session.catalogVersion))throw Error('practice-session-corrupt');
  const ids=new Set<string>();
  for(let i=0;i<session.steps.length;i++){
   const step=session.steps[i];
   if(!plain(step)||!validId(step.stepId)||!uuid.test(step.attemptId)||!validId(step.commandId)||typeof step.initialSeen!=='boolean'||!['unanswered','prepared','applied'].includes(step.status)||ids.has(step.attemptId))throw Error('practice-step-corrupt');
   ids.add(step.attemptId);
   keys(step,['stepId','attemptId','commandId','initialSeen','status','pendingPayload']);
   if(step.status==='unanswered'){if(step.pendingPayload!==null)throw Error('practice-step-corrupt');}
   else if(!validAttempt(step.pendingPayload)||step.pendingPayload.id!==step.attemptId||step.pendingPayload.qid!==session.questionIds[i]||step.pendingPayload.mode!==(step.initialSeen?'review':'first'))throw Error('practice-step-corrupt');
   if(step.pendingPayload&&session.catalogVersion===catalogVersion){const question=questions.get(session.questionIds[i]);if(!question||step.pendingPayload.choice>=question.options.length||step.pendingPayload.correct!==(step.pendingPayload.choice===question.correctIndex))throw Error('practice-step-corrupt');}
   if(i<session.cursor&&step.status!=='applied')throw Error('practice-cursor-unverified');
   if(i>session.cursor&&step.status!=='unanswered')throw Error('practice-cursor-corrupt');
  }
  if(session.status==='completed'&&session.cursor!==session.questionIds.length)throw Error('practice-cursor-corrupt');
  if(session.status==='active'&&session.cursor>=session.questionIds.length)throw Error('practice-cursor-corrupt');
  const settlement=session.settlement;
  if(!plain(settlement)||!uuid.test(settlement.checkinId)||!validId(settlement.commandId)||!['draft','prepared','applied'].includes(settlement.status)||!validDraft(settlement.draft)||(settlement.status==='draft'?settlement.pendingPayload!==null:!validCheckin(settlement.pendingPayload)||settlement.pendingPayload.id!==settlement.checkinId||!same({minutes:settlement.pendingPayload.minutes,load:settlement.pendingPayload.load,note:settlement.pendingPayload.note},settlement.draft)))throw Error('practice-settlement-corrupt');
  keys(settlement,['checkinId','commandId','status','draft','pendingPayload']);
  if(settlement.pendingPayload&&settlement.pendingPayload.date!==dayKey(settlement.pendingPayload.createdAt,session.timezone))throw Error('practice-settlement-corrupt');
  if(session.schemaVersion===2)validatePracticeTraining(session.training,session.unitIds,session.questionIds,session.cursor,session.steps.map(step=>step.status==='applied'),session.catalogVersion===catalogVersion?session.questionIds.map(id=>questions.get(id)!).filter(Boolean):undefined);
  return session;
 }

/** Whole-backup preflight. No storage/legacy reads, writes, receipt promotion or intent execution.
 * Generic repository validation still owns the envelope and other collections; this owns every
 * practice row and its fixed IDs, including historical practice snapshots in technical receipts. */
export function validatePracticeWorkflowBackup(input:unknown,questions:readonly Question[],expectedScopeKey?:string,compatibleQuestionCatalogs:readonly (readonly Question[])[]=[]):void {
 if(typeof input==='string'){try{input=JSON.parse(input);}catch{throw Error('practice-backup-json');}}
 if(!plain(input)||input.kind!=='lantern-workflow'||input.schemaVersion!==1||!plain(input.records)||!Array.isArray(input.records.sessions)||!Array.isArray(input.records.commands)||!Array.isArray(input.commands))throw Error('practice-backup-schema');
 const scopeKey=workflowScopeKey(input.scope as WorkflowScope);if(expectedScopeKey!==undefined&&scopeKey!==expectedScopeKey)throw Error('scope-mismatch');
 const catalogVersion=practiceCatalogVersion(questions),catalogs=registerPracticeCatalogs(questions,compatibleQuestionCatalogs),primary=catalogs.get(catalogVersion)!;
 const catalog=primary.byId,parse=(row:DomainRecord<unknown>)=>parseRegisteredPracticeSession(row,scopeKey,primary,catalogs);
 const sessions=new Map<string,StoredSession>(),commands=new Map<string,BridgeCommand>();let pointer:ActivePointer|undefined;
 const attemptIds=new Set<string>(),stepIds=new Set<string>(),commandIds=new Set<string>(),checkinIds=new Set<string>();
 const row=(raw:unknown):DomainRecord<unknown>=>{if(!plain(raw)||!validId(raw.id)||!Number.isSafeInteger(raw.revision)||Number(raw.revision)<1||!('value'in raw))throw Error('practice-backup-row');return raw as DomainRecord<unknown>;};
 const isPractice=(raw:DomainRecord<unknown>)=>raw.id.startsWith('practice:')||raw.id.startsWith('practice-answer:')||raw.id.startsWith('practice-settlement:')||(plain(raw.value)&&typeof raw.value.kind==='string'&&raw.value.kind.startsWith('practice-'));
 function commandValue(raw:DomainRecord<unknown>):BridgeCommand {
  const value=raw.value;
  if(!plain(value)||value.kind!=='practice-command'||value.scopeKey!==scopeKey||!validId(value.sessionId)||!validId(value.stepId)||!['practice-answer','settlement'].includes(String(value.intent))||!['prepared','applied'].includes(String(value.status))||(value.intent==='practice-answer'?!validAttempt(value.legacyPayload):!validCheckin(value.legacyPayload)))throw Error('practice-command-corrupt');
  keys(value,['kind','scopeKey','sessionId','stepId','intent','status','legacyPayload']);
  return value as unknown as BridgeCommand;
 }
 function validateUnits(session:StoredSession){
  const source=catalogs.get(session.catalogVersion);if(!source)return; // Unknown hashes remain preserved and read-only.
  const queue=session.questionIds.map(id=>source.byId.get(id));if(queue.some(question=>!question))throw Error('practice-queue-invalid');
  const fixed=queue as Question[],units=[...new Set(fixed.map(unitId))];if(!same(units,session.unitIds)||!same(fixed.map(question=>question.id),units.flatMap(unit=>fixed.filter(question=>unitId(question)===unit).map(question=>question.id))))throw Error('practice-units-invalid');
  for(const unit of units)if(!same(fixed.filter(question=>unitId(question)===unit).map(question=>question.id),source.questions.filter(question=>unitId(question)===unit).map(question=>question.id)))throw Error('practice-group-incomplete');
 }
 for(const raw of input.records.sessions){const item=row(raw);if(!isPractice(item))continue;
  if(item.id===ACTIVE){if(pointer||!plain(item.value)||item.value.kind!=='practice-active'||(item.value.sessionId!==null&&!validId(item.value.sessionId)))throw Error('practice-pointer-corrupt');keys(item.value,['kind','sessionId']);pointer=item.value as ActivePointer;continue;}
  const session=parse(item);if(sessions.has(session.id))throw Error('practice-session-duplicate');validateUnits(session);sessions.set(session.id,session);
  for(const step of session.steps){if(attemptIds.has(step.attemptId)||checkinIds.has(step.attemptId)||stepIds.has(step.stepId)||commandIds.has(step.commandId))throw Error('practice-fixed-id-duplicate');attemptIds.add(step.attemptId);stepIds.add(step.stepId);commandIds.add(step.commandId);}
  if(checkinIds.has(session.settlement.checkinId)||commandIds.has(session.settlement.commandId)||attemptIds.has(session.settlement.checkinId))throw Error('practice-fixed-id-duplicate');checkinIds.add(session.settlement.checkinId);commandIds.add(session.settlement.commandId);
 }
 for(const raw of input.records.commands){const item=row(raw);if(!isPractice(item))continue;if(commands.has(item.id))throw Error('practice-command-duplicate');commands.set(item.id,commandValue(item));}
 const used=new Set<string>();
 function checkCommand(id:string,session:StoredSession,stepId:string,intent:BridgeCommand['intent'],status:BridgeCommand['status'],legacyPayload:Attempt|Checkin){
  const actual=commands.get(id),expected:BridgeCommand={kind:'practice-command',scopeKey,sessionId:session.id,stepId,intent,status,legacyPayload};
  if(!actual||!same(actual,expected))throw Error('practice-command-reference');used.add(id);
 }
 for(const session of sessions.values()){
  for(const step of session.steps)if(step.pendingPayload)checkCommand(step.commandId,session,step.stepId,'practice-answer',step.status==='applied'?'applied':'prepared',step.pendingPayload);
  const settlement=session.settlement;if(settlement.pendingPayload)checkCommand(settlement.commandId,session,settlement.checkinId,'settlement',settlement.status==='applied'?'applied':'prepared',settlement.pendingPayload);
 }
 if(used.size!==commands.size)throw Error('practice-command-orphan');
 const active=[...sessions.values()].filter(session=>session.status==='active');
 if(sessions.size&&!pointer||active.length>1||active.length===1&&pointer?.sessionId!==active[0].id||pointer?.sessionId&&!active.some(session=>session.id===pointer?.sessionId))throw Error('practice-pointer-reference');
 function historical(item:DomainRecord<unknown>){
  if(item.id===ACTIVE){if(!plain(item.value)||item.value.kind!=='practice-active'||item.value.sessionId!==null&&!sessions.has(String(item.value.sessionId)))throw Error('practice-pointer-reference');keys(item.value,['kind','sessionId']);return;}
  if(plain(item.value)&&item.value.kind==='practice-command'){
   const value=commandValue(item),session=sessions.get(value.sessionId);if(!session)throw Error('practice-command-reference');
   const step=session.steps.find(candidate=>candidate.commandId===item.id),settlement=session.settlement;
   if(value.intent==='practice-answer'?!step||step.stepId!==value.stepId||!same(step.pendingPayload,value.legacyPayload):settlement.commandId!==item.id||settlement.checkinId!==value.stepId||!same(settlement.pendingPayload,value.legacyPayload))throw Error('practice-command-reference');return;
  }
  const value=parse(item),latest=sessions.get(value.id);if(!latest)throw Error('practice-session-reference');validateUnits(value);
  const identity=(session:StoredSession)=>({id:session.id,scopeKey:session.scopeKey,catalogVersion:session.catalogVersion,chainId:session.chainId,questionIds:session.questionIds,unitIds:session.unitIds,startedAt:session.startedAt,timezone:session.timezone,steps:session.steps.map(({stepId,attemptId,commandId,initialSeen})=>({stepId,attemptId,commandId,initialSeen})),settlement:{checkinId:session.settlement.checkinId,commandId:session.settlement.commandId}});
  if(!same(identity(value),identity(latest)))throw Error('practice-session-reference');
  for(let i=0;i<value.steps.length;i++)if(value.steps[i].pendingPayload&&!same(value.steps[i].pendingPayload,latest.steps[i].pendingPayload))throw Error('practice-command-reference');
  if(value.settlement.pendingPayload&&!same(value.settlement.pendingPayload,latest.settlement.pendingPayload))throw Error('practice-command-reference');
 }
 for(const raw of input.commands){if(!plain(raw)||!plain(raw.command)||!Array.isArray(raw.command.writes))throw Error('practice-backup-receipt');for(const write of raw.command.writes){const item=row(write);if(isPractice(item)){if(!plain(write)||!['sessions','commands'].includes(String(write.collection)))throw Error('practice-backup-collection');historical(item);}}}
 for(const [collection,items] of Object.entries(input.records))if(collection!=='sessions'&&collection!=='commands'&&Array.isArray(items))for(const raw of items)if(isPractice(row(raw)))throw Error('practice-backup-collection');
 const versions=new Map<string,Map<number,StoredSession>>();
 const remember=(item:DomainRecord<unknown>)=>{if(!plain(item.value)||item.value.kind!=='practice-session')return;const parsed=parse(item);let history=versions.get(item.id);if(!history){history=new Map();versions.set(item.id,history);}const prior=history.get(item.revision);if(prior&&!same(prior,parsed))throw Error('practice-history-revision-conflict');history.set(item.revision,parsed);};
 for(const raw of input.records.sessions)remember(row(raw));
 for(const raw of input.commands){const stored=raw as {command:{writes:DomainRecord<unknown>[]}};for(const write of stored.command.writes)remember(row(write));}
 const business=(session:StoredSession)=>{const {training,schemaVersion,...value}=session;return value;};
 for(const raw of input.commands){const stored=raw as {command:{commandId:string;occurredAt:string;payload:unknown;expected:unknown[];writes:(DomainRecord<unknown>&{collection:string})[]}},command=stored.command;
  if(!command.commandId.startsWith('practice-training:'))continue;
  if(!/^practice-training:[a-zA-Z0-9-]{1,100}$/.test(command.commandId)||!stamp(command.occurredAt)||!plain(command.payload)||command.payload.intent!=='practice-training'||typeof command.payload.sessionId!=='string'||typeof command.payload.expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(command.payload.expectedHash)||!Array.isArray(command.expected)||command.expected.length!==1||command.writes.length!==1)throw Error('practice-training-command-corrupt');
  keys(command.payload,['intent','sessionId','expectedHash','training']);const write=command.writes[0],guard=command.expected[0];
  if(write.collection!=='sessions'||write.id!==command.payload.sessionId||!plain(guard)||guard.collection!=='sessions'||guard.id!==write.id||guard.revision!==write.revision-1)throw Error('practice-training-command-reference');
  const after=parse(row(write)),before=versions.get(write.id)?.get(write.revision-1);
  if(!before||after.schemaVersion!==2||!same(after.training,command.payload.training)||!same(business(before),business(after)))throw Error('practice-training-changed-learning-facts');
  if(before.training||catalogs.has(before.catalogVersion)){const source=catalogs.get(before.catalogVersion)??primary,queue=before.questionIds.map(id=>source.byId.get(id)!).filter(Boolean),training=before.training??initialPracticeTraining(queue,before.cursor);if(trainingHash(training)!==command.payload.expectedHash)throw Error('practice-training-command-hash');}
 }

}

/** Workflow state coordinates existing Study facts; it never replaces their journal authority. */
export class PracticeWorkflow {
 readonly scopeKey:string;readonly catalogVersion:string;
 private readonly questions:Map<string,Question>;private readonly catalogs:Map<string,RegisteredPracticeCatalog>;private readonly primaryCatalog:RegisteredPracticeCatalog;private readonly now:()=>Date;private readonly id:()=>string;
 private closed=false;
 constructor(readonly repository:LearningDomainRepository,private readonly options:PracticeWorkflowOptions){
  this.scopeKey=workflowScopeKey(options.scope);this.catalogVersion=practiceCatalogVersion(options.questions);
  if(repository.scopeKey!==this.scopeKey)throw Error('scope-mismatch');
  this.catalogs=registerPracticeCatalogs(options.questions,options.compatibleQuestionCatalogs);
  this.primaryCatalog=this.catalogs.get(this.catalogVersion)!;this.questions=this.primaryCatalog.byId;
  // A registered legacy version is an immutable complete subset, not an alias for changed answers.
  for(const source of this.catalogs.values())if(source.version!==this.catalogVersion){
   for(const question of source.questions)if(!this.questions.has(question.id)||!same(JSON.parse(JSON.stringify(question)),JSON.parse(JSON.stringify(this.questions.get(question.id)))))throw Error('practice-compatible-catalog-changed');
   for(const unit of new Set(source.questions.map(unitId)))if(!same(source.questions.filter(question=>unitId(question)===unit).map(question=>question.id),options.questions.filter(question=>unitId(question)===unit).map(question=>question.id)))throw Error('practice-compatible-group-changed');
  }
  this.now=options.now??(()=>new Date());this.id=options.id??createId;
  dayKey(this.now(),options.timezone);
 }
 close(){this.closed=true;this.repository.close();}
 private current(){if(this.closed||this.options.isCurrent?.()===false)throw Error('scope-changed');}
 private parse(row:DomainRecord<unknown>):StoredSession {return parseRegisteredPracticeSession(row,this.scopeKey,this.primaryCatalog,this.catalogs,this.now);}
 private async sessionRow(id:string){const row=await this.repository.read<unknown>('sessions',id);this.current();if(!row)throw Error('practice-session-missing');return {...row,value:this.parse(row)};}
 private async pointer(){const row=await this.repository.read<ActivePointer>('sessions',ACTIVE);this.current();if(row&&(!plain(row.value)||row.value.kind!=='practice-active'||(row.value.sessionId!==null&&!validId(row.value.sessionId))))throw Error('practice-pointer-corrupt');return row;}
 private async bridgeRow(session:StoredSession,id:string,stepId:string,intent:BridgeCommand['intent'],status:BridgeCommand['status'],payload:Attempt|Checkin){
  const row=await this.repository.read<BridgeCommand>('commands',id);this.current();
  if(!row||!plain(row.value)||row.value.kind!=='practice-command'||row.value.scopeKey!==this.scopeKey||row.value.sessionId!==session.id||row.value.stepId!==stepId||row.value.intent!==intent||row.value.status!==status||!same(row.value.legacyPayload,payload))throw Error('practice-command-corrupt');
  return row;
 }
 /** Explicit action reconciliation validates the domain snapshot and every applied legacy fact.
  * Prepared payloads remain intents; this only permits the user's requested original-ID retry. */
 private async reconcile(row:DomainRecord<StoredSession>){
  if(row.provenance!=='restored-unverified')return;
  const session=this.parse(row),records:DomainWrite[]=[{collection:'sessions',id:row.id,revision:row.revision,value:json(session)}];
  for(const step of session.steps){
   if(!step.pendingPayload)continue;
   const command=await this.bridgeRow(session,step.commandId,step.stepId,'practice-answer',step.status==='applied'?'applied':'prepared',step.pendingPayload);
   if(step.status==='applied'){const actual=this.options.legacy.readAttempt(step.attemptId);this.current();if(!actual||!same(actual,step.pendingPayload))throw Error('reference-unverified');}
   records.push({collection:'commands',id:command.id,revision:command.revision,value:json(command.value)});
  }
  const settlement=session.settlement;
  if(settlement.pendingPayload){
   const command=await this.bridgeRow(session,settlement.commandId,settlement.checkinId,'settlement',settlement.status==='applied'?'applied':'prepared',settlement.pendingPayload);
   if(settlement.status==='applied'){const actual=this.options.legacy.readCheckin(settlement.checkinId);this.current();if(!actual||!same(actual,settlement.pendingPayload))throw Error('reference-unverified');}
   records.push({collection:'commands',id:command.id,revision:command.revision,value:json(command.value)});
  }
  const pointer=await this.pointer();
  if(session.status==='active'&&pointer?.value.sessionId!==session.id)throw Error('practice-pointer-corrupt');
  if(pointer?.value.sessionId===session.id)records.push({collection:'sessions',id:pointer.id,revision:pointer.revision,value:json(pointer.value)});
  this.current();const result=await this.repository.confirmRestored({records,commands:[]});this.current();
  if(result.status==='blocked'||result.status==='conflict')throw Error(result.reason);
 }
 private async project(row:DomainRecord<StoredSession>):Promise<PracticeSession>{
  const value=row.value;let integrityError:string|null=null;
  const source=this.catalogs.get(value.catalogVersion),queue=value.questionIds.map(id=>(source?.byId??this.questions).get(id)).filter((question):question is Question=>!!question);
  if(!source||queue.length!==value.questionIds.length)integrityError='catalog-mismatch';
  const steps:PracticeStep[]=value.steps.map(step=>{
   let status:PracticeStep['status']=step.status==='prepared'?'pending':step.status;
   if(step.status==='applied'){
    try{const actual=this.options.legacy.readAttempt(step.attemptId);this.current();if(!actual||!same(actual,step.pendingPayload)){status='reference-unverified';integrityError='reference-unverified';}}
    catch{status='reference-unverified';integrityError='reference-unverified';}
   }
   return {stepId:step.stepId,attemptId:step.attemptId,commandId:step.commandId,initialSeen:step.initialSeen,status,choice:step.pendingPayload?.choice??null,attempt:status==='applied'?step.pendingPayload:null};
  });
  let settlementStatus:PracticeSession['settlement']['status']=value.settlement.status==='prepared'?'pending':value.settlement.status;
  if(value.settlement.status==='applied'){
   try{const actual=this.options.legacy.readCheckin(value.settlement.checkinId);this.current();if(!actual||!same(actual,value.settlement.pendingPayload)){settlementStatus='reference-unverified';integrityError='reference-unverified';}}
   catch{settlementStatus='reference-unverified';integrityError='reference-unverified';}
  }
  this.current();
  return {training:value.training??initialPracticeTraining(queue,value.cursor),id:value.id,revision:row.revision,catalogVersion:value.catalogVersion,chainId:value.chainId,unitIds:[...value.unitIds],questionIds:[...value.questionIds],queue,cursor:value.cursor,steps,status:value.status,startedAt:value.startedAt,timezone:value.timezone,integrityError,settlement:{checkinId:value.settlement.checkinId,status:settlementStatus,draft:{...value.settlement.draft},payload:settlementStatus==='applied'?value.settlement.pendingPayload:null}};
 }
 async readProjection(retry=0):Promise<PracticeProjection>{
  this.current();const pointer=await this.pointer(),rows=await this.repository.list<unknown>('sessions'),after=await this.pointer();this.current();
  // Start/finish changes pointer and session atomically. Separate read transactions may straddle
  // that commit; retry that ordinary race instead of mistaking it for corrupt storage.
  if(pointer?.revision!==after?.revision||pointer?.value.sessionId!==after?.value.sessionId){if(retry<3)return this.readProjection(retry+1);throw Error('practice-snapshot-changed');}
  const sessions:PracticeSession[]=[];
  for(const row of rows){if(row.id===ACTIVE)continue;if(row.id.startsWith('practice:')&&(!plain(row.value)||row.value.kind!=='practice-session'))throw Error('practice-session-corrupt');if(plain(row.value)&&row.value.kind==='practice-session')sessions.push(await this.project({...row,value:this.parse(row)}));}
  sessions.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.id.localeCompare(b.id));
  const activeSessionId=pointer?.value.sessionId??null;
  if(activeSessionId&&!sessions.some(session=>session.id===activeSessionId&&session.status==='active'))throw Error('practice-pointer-corrupt');
  if(sessions.some(session=>session.status==='active'&&session.id!==activeSessionId))throw Error('practice-pointer-corrupt');
  this.current();return {activeSessionId,sessions,pendingSettlements:sessions.filter(session=>session.status!=='active'&&session.steps.some(step=>step.status!=='unanswered')&&session.settlement.status!=='applied')};
 }
 private outcome(result:DomainCommitResult,sessionId:string,success:'started'|'applied'|'updated'|'closed'='updated'):PracticeResult{
  if(result.status==='committed')return {status:success,sessionId};
  if(result.status==='replayed')return {status:'replayed',sessionId};
  if(result.status==='unknown')return {status:'unknown',sessionId,reason:'durability-unknown'};
  if(result.status==='blocked'||result.status==='conflict')return {status:result.status,reason:result.reason,sessionId};
  return {status:'blocked',reason:'practice-transaction-unconfirmed',sessionId};
 }
 private blocked(error:unknown,sessionId?:string):PracticeResult {return {status:'blocked',reason:error instanceof Error?error.message:'practice-unavailable',...(sessionId?{sessionId}:{})};}
 private async transact(commandId:string,occurredAt:string,payload:unknown,rows:{collection:'sessions'|'commands';row:DomainRecord<unknown>|undefined;id:string;value:unknown}[]){
  this.current();const result=await this.repository.commit({commandId,occurredAt,payload:json(payload),expected:rows.map(({collection,row,id})=>({collection,id,revision:row?.revision??null})),writes:rows.map(({collection,row,id,value})=>({collection,id,revision:(row?.revision??0)+1,value:json(value)}))});this.current();return result;
 }
 async start(queue:readonly Question[],start:PracticeStartOptions):Promise<PracticeResult>{
  let id='';try{
   this.current();const pointer=await this.pointer();
   const existing=await this.readProjection();if(existing.sessions.some(session=>session.integrityError))throw Error(existing.sessions.find(session=>session.integrityError)?.integrityError??'reference-unverified');
   if(pointer?.value.sessionId){const active=await this.sessionRow(pointer.value.sessionId);if(active.value.status!=='active')throw Error('practice-pointer-corrupt');return {status:'restored',sessionId:active.id};}
   // A restored empty pointer contains no learning assertion, but still requires an explicit action.
   if(pointer?.provenance==='restored-unverified'){await this.readProjection();const confirmed=await this.repository.confirmRestored({records:[{collection:'sessions',id:ACTIVE,revision:pointer.revision,value:json(pointer.value)}],commands:[]});this.current();if(confirmed.status==='blocked'||confirmed.status==='conflict')throw Error(confirmed.reason);}
   if(!queue.length||queue.length>200||new Set(queue.map(question=>question.id)).size!==queue.length)throw Error('practice-queue-invalid');
   const chosen=new Set(queue.map(question=>question.id));
   for(const question of queue){const authored=this.questions.get(question.id);if(!authored||!same(JSON.parse(JSON.stringify(question)),JSON.parse(JSON.stringify(authored))))throw Error('practice-catalog-mismatch');if(question.groupId&&this.options.questions.some(other=>other.part===question.part&&other.groupId===question.groupId&&!chosen.has(other.id)))throw Error('practice-group-incomplete');}
   const unitIds=[...new Set(queue.map(unitId))];if(!same(unitIds,start.unitIds))throw Error('practice-units-invalid');
   for(const unit of unitIds){if(!same(queue.filter(question=>unitId(question)===unit).map(question=>question.id),this.options.questions.filter(question=>unitId(question)===unit).map(question=>question.id)))throw Error('practice-group-order-invalid');}
   const chainId=start.chainId??this.id();if(!validId(chainId))throw Error('practice-chain-invalid');
   if(start.chainId){const prior=await this.readProjection();if(prior.sessions.some(session=>session.chainId===chainId&&session.unitIds.some(unit=>unitIds.includes(unit))))return {status:'conflict',reason:'practice-chain-unit-repeated'};}
   id='practice:'+this.id();const at=this.now().toISOString(),seen=new Set(start.initialSeenQids??this.options.seenQuestionIds?.()??[]);
   const value:StoredSession={kind:'practice-session',schemaVersion:1,id,scopeKey:this.scopeKey,catalogVersion:this.catalogVersion,chainId,questionIds:queue.map(question=>question.id),unitIds,cursor:0,steps:queue.map(question=>({stepId:this.id(),attemptId:this.id(),commandId:'practice-answer:'+this.id(),initialSeen:seen.has(question.id),status:'unanswered',pendingPayload:null})),status:'active',startedAt:at,timezone:this.options.timezone,settlement:{checkinId:this.id(),commandId:'practice-settlement:'+this.id(),status:'draft',draft:{minutes:1,load:'刚好',note:''},pendingPayload:null}};
   this.parse({id,revision:1,value});
   const result=await this.transact('practice-start:'+this.id(),at,{intent:'practice-start',sessionId:id},[{collection:'sessions',row:undefined,id,value},{collection:'sessions',row:pointer,id:ACTIVE,value:{kind:'practice-active',sessionId:id}}]);
   if(result.status==='conflict'){const latest=await this.pointer();if(latest?.value.sessionId)return {status:'restored',sessionId:latest.value.sessionId};}
   return this.outcome(result,id,'started');
  }catch(error){return this.blocked(error,id||undefined);}
 }
 async resume(id:string):Promise<PracticeResult>{try{const row=await this.sessionRow(id),projection=await this.project(row);if(projection.integrityError)throw Error(projection.integrityError);return {status:'restored',sessionId:id};}catch(error){return this.blocked(error,id);}}
 async submit(id:string,choice:number,seconds:number,expectedCursor:number):Promise<PracticeResult>{
  try{
   this.current();let row=await this.sessionRow(id),session=row.value;
   await this.reconcile(row);
   const currentProjection=await this.project(row);if(currentProjection.integrityError)throw Error(currentProjection.integrityError);
   if(session.status!=='active'||session.cursor!==expectedCursor)return {status:'conflict',reason:'practice-cursor-changed',sessionId:id};
   const source=this.catalogs.get(session.catalogVersion);if(!source)throw Error('catalog-mismatch');
   const question=source.byId.get(session.questionIds[expectedCursor]);if(!question)throw Error('catalog-mismatch');
   if(!Number.isInteger(choice)||choice<0||choice>=question.options.length||choice>3||!Number.isInteger(seconds)||seconds<0||seconds>7200)throw Error('practice-answer-invalid');
   let step=session.steps[expectedCursor];
   if(step.status==='unanswered'){
    const payload:Attempt={id:step.attemptId,qid:question.id,choice,correct:choice===question.correctIndex,createdAt:this.now().toISOString(),seconds,mode:step.initialSeen?'review':'first'};
    const next=structuredClone(session);next.steps[expectedCursor]={...step,status:'prepared',pendingPayload:payload};
    const command:BridgeCommand={kind:'practice-command',scopeKey:this.scopeKey,sessionId:id,stepId:step.stepId,intent:'practice-answer',status:'prepared',legacyPayload:payload};
    const result=await this.transact(step.commandId+':prepare',payload.createdAt,{intent:'practice-answer',legacyPayload:payload},[{collection:'sessions',row,id,value:next},{collection:'commands',row:undefined,id:step.commandId,value:command}]);
    if(result.status!=='committed'&&result.status!=='replayed'&&result.status!=='conflict')return this.outcome(result,id);
    row=await this.sessionRow(id);session=row.value;
    if(session.cursor!==expectedCursor)return {status:'conflict',reason:'practice-cursor-changed',sessionId:id};
    step=session.steps[expectedCursor];
   }
   if(!step.pendingPayload||step.pendingPayload.choice!==choice)return {status:'conflict',reason:'practice-answer-frozen',sessionId:id};
   const commandRow=await this.bridgeRow(session,step.commandId,step.stepId,'practice-answer',step.status==='applied'?'applied':'prepared',step.pendingPayload);
   let actual:Attempt|undefined;
   try{actual=this.options.legacy.readAttempt(step.attemptId);this.current();if(actual&&!same(actual,step.pendingPayload))return {status:'conflict',reason:'legacy-attempt-conflict',sessionId:id};if(!actual&&step.status==='applied')return {status:'blocked',reason:'reference-unverified',sessionId:id};if(!actual){this.options.legacy.addAttempt(step.pendingPayload);this.current();actual=this.options.legacy.readAttempt(step.attemptId);this.current();}}
   catch(error){return {status:'pending',reason:error instanceof Error?error.message:'legacy-attempt-unavailable',sessionId:id};}
   if(!actual)return {status:'pending',reason:'legacy-attempt-unconfirmed',sessionId:id};
   if(!same(actual,step.pendingPayload))return {status:'conflict',reason:'legacy-attempt-conflict',sessionId:id};
   if(step.status==='applied')return {status:'replayed',sessionId:id};
   const next=structuredClone(session);next.steps[expectedCursor].status='applied';
   const result=await this.transact(step.commandId+':apply',step.pendingPayload.createdAt,{intent:'practice-answer-applied',legacyPayload:step.pendingPayload},[{collection:'sessions',row,id,value:next},{collection:'commands',row:commandRow,id:step.commandId,value:{...commandRow.value,status:'applied'}}]);
   if(result.status==='conflict'){const latest=await this.sessionRow(id);if(latest.value.steps[expectedCursor].status==='applied'&&same(latest.value.steps[expectedCursor].pendingPayload,step.pendingPayload))return {status:'replayed',sessionId:id};}
   return this.outcome(result,id,'applied');
  }catch(error){return this.blocked(error,id);}
 }
 async next(id:string,expectedCursor:number):Promise<PracticeResult>{
  try{
   const row=await this.sessionRow(id),session=row.value;
   await this.reconcile(row);
   const projection=await this.project(row);if(projection.integrityError)return {status:'blocked',reason:projection.integrityError,sessionId:id};
   if(session.cursor!==expectedCursor)return session.cursor===expectedCursor+1?{status:'replayed',sessionId:id}:{status:'conflict',reason:'practice-cursor-changed',sessionId:id};
   if(session.status!=='active')return {status:'conflict',reason:'practice-not-active',sessionId:id};
   if(projection.steps[expectedCursor]?.status!=='applied')return {status:'blocked',reason:'practice-answer-unconfirmed',sessionId:id};
   const next=structuredClone(session);next.cursor++;if(next.training){next.training.viewIndex=next.cursor;const q=this.catalogs.get(next.catalogVersion)?.byId.get(next.questionIds[next.cursor]);const item=q&&next.training.materials.find(item=>item.unitId===unitId(q)&&item.materialHash===materialHash(q));if(item&&next.steps[next.cursor]?.status!=='applied')item.step='answer';}if(next.cursor===next.questionIds.length)next.status='completed';
   const pointer=await this.pointer();if(pointer?.value.sessionId!==id)throw Error('practice-pointer-changed');
   const rows:{collection:'sessions';row:DomainRecord<unknown>|undefined;id:string;value:unknown}[]=[{collection:'sessions',row,id,value:next}];
   if(next.status==='completed')rows.push({collection:'sessions',row:pointer,id:ACTIVE,value:{kind:'practice-active',sessionId:null}});
   const result=await this.transact(`practice-next:${session.steps[expectedCursor].stepId}`,this.now().toISOString(),{intent:'practice-next',sessionId:id,cursor:expectedCursor},rows);
   if(result.status==='conflict'){const latest=await this.sessionRow(id);if(latest.value.cursor===expectedCursor+1)return {status:'replayed',sessionId:id};}
   return this.outcome(result,id,'applied');
  }catch(error){return this.blocked(error,id);}
 }
 async updateTraining(id:string,write:TrainingWrite):Promise<PracticeResult>{
  try{
   if(!/^[a-zA-Z0-9-]{1,100}$/.test(write.operationId)||!stamp(write.occurredAt)||!/^([a-f0-9]{64})$/.test(write.expectedHash))throw Error('practice-training-command-invalid');
   const row=await this.sessionRow(id);await this.reconcile(row);const projection=await this.project(row);if(projection.integrityError)throw Error(projection.integrityError);
   const commandId='practice-training:'+write.operationId,payload={intent:'practice-training',sessionId:id,expectedHash:write.expectedHash,training:write.training};
   const known=await this.repository.readCommand(commandId);this.current();
   if(known){if(!same(known.command.payload,payload)||known.command.occurredAt!==write.occurredAt)return {status:'conflict',reason:'practice-training-operation-conflict',sessionId:id};if(known.provenance!=='local')return {status:'blocked',reason:'reference-unverified',sessionId:id};return {status:'replayed',sessionId:id,revision:known.command.writes.find(item=>item.collection==='sessions'&&item.id===id)?.revision};}
   if(same(projection.training,write.training))return {status:'replayed',sessionId:id,revision:row.revision};
   if(trainingHash(projection.training)!==write.expectedHash)return {status:'conflict',reason:'practice-training-changed',sessionId:id};
   const next={...row.value,schemaVersion:2 as const,training:structuredClone(write.training)};this.parse({...row,value:next});
   const result=this.outcome(await this.transact(commandId,write.occurredAt,payload,[{collection:'sessions',row,id,value:next}]),id);return result.status==='updated'||result.status==='replayed'?{...result,revision:row.revision+1}:result;
  }catch(error){return this.blocked(error,id);}
 }
 async leave(id:string):Promise<PracticeResult>{
  try{const row=await this.sessionRow(id);if(row.value.status!=='active')return {status:'replayed',sessionId:id};await this.reconcile(row);const pointer=await this.pointer();if(pointer?.value.sessionId!==id)throw Error('practice-pointer-changed');return this.outcome(await this.transact('practice-leave:'+this.id(),this.now().toISOString(),{intent:'practice-leave',sessionId:id},[{collection:'sessions',row,id,value:{...row.value,status:'left'}},{collection:'sessions',row:pointer,id:ACTIVE,value:{kind:'practice-active',sessionId:null}}]),id,'closed');}catch(error){return this.blocked(error,id);}
 }
 async updateSettlementDraft(id:string,draft:PracticeSettlementDraft):Promise<PracticeResult>{
  try{if(!validDraft(draft))throw Error('practice-settlement-invalid');const row=await this.sessionRow(id);if(row.value.settlement.status!=='draft')return {status:'conflict',reason:'practice-settlement-frozen',sessionId:id};await this.reconcile(row);return this.outcome(await this.transact('practice-draft:'+this.id(),this.now().toISOString(),{intent:'practice-settlement-draft',sessionId:id,draft},[{collection:'sessions',row,id,value:{...row.value,settlement:{...row.value.settlement,draft}}}]),id);}catch(error){return this.blocked(error,id);}
 }
 async settle(id:string,draft?:PracticeSettlementDraft):Promise<PracticeResult>{
  try{
   let row=await this.sessionRow(id),session=row.value;
   await this.reconcile(row);
   if(session.status==='active')return {status:'blocked',reason:'practice-not-finished',sessionId:id};
   const projection=await this.project(row);if(projection.integrityError)return {status:'blocked',reason:projection.integrityError,sessionId:id};
   let settlement=session.settlement;
   if(settlement.status==='draft'){
    const frozen=draft??settlement.draft;if(!validDraft(frozen))throw Error('practice-settlement-invalid');
    const createdAt=this.now().toISOString(),payload:Checkin={id:settlement.checkinId,date:dayKey(createdAt,session.timezone),minutes:frozen.minutes,load:frozen.load,note:frozen.note,createdAt};
    const command:BridgeCommand={kind:'practice-command',scopeKey:this.scopeKey,sessionId:id,stepId:settlement.checkinId,intent:'settlement',status:'prepared',legacyPayload:payload};
    const result=await this.transact(settlement.commandId+':prepare',createdAt,{intent:'settlement',legacyPayload:payload},[{collection:'sessions',row,id,value:{...session,settlement:{...settlement,status:'prepared',draft:frozen,pendingPayload:payload}}},{collection:'commands',row:undefined,id:settlement.commandId,value:command}]);
    if(result.status!=='committed'&&result.status!=='replayed'&&result.status!=='conflict')return this.outcome(result,id);
    row=await this.sessionRow(id);session=row.value;settlement=session.settlement;
   }
   if(!settlement.pendingPayload)throw Error('practice-command-corrupt');
   if(draft&&!same(draft,settlement.draft))return {status:'conflict',reason:'practice-settlement-frozen',sessionId:id};
   const commandRow=await this.bridgeRow(session,settlement.commandId,settlement.checkinId,'settlement',settlement.status==='applied'?'applied':'prepared',settlement.pendingPayload);
   let actual:Checkin|undefined;
   try{actual=this.options.legacy.readCheckin(settlement.checkinId);this.current();if(actual&&!same(actual,settlement.pendingPayload))return {status:'conflict',reason:'legacy-checkin-conflict',sessionId:id};if(!actual&&settlement.status==='applied')return {status:'blocked',reason:'reference-unverified',sessionId:id};if(!actual){this.options.legacy.addCheckin(settlement.pendingPayload);this.current();actual=this.options.legacy.readCheckin(settlement.checkinId);this.current();}}
   catch(error){return {status:'pending',reason:error instanceof Error?error.message:'legacy-checkin-unavailable',sessionId:id};}
   if(!actual)return {status:'pending',reason:'legacy-checkin-unconfirmed',sessionId:id};
   if(!same(actual,settlement.pendingPayload))return {status:'conflict',reason:'legacy-checkin-conflict',sessionId:id};
   if(settlement.status==='applied')return {status:'replayed',sessionId:id};
   const result=await this.transact(settlement.commandId+':apply',settlement.pendingPayload.createdAt,{intent:'settlement-applied',legacyPayload:settlement.pendingPayload},[{collection:'sessions',row,id,value:{...session,settlement:{...settlement,status:'applied'}}},{collection:'commands',row:commandRow,id:settlement.commandId,value:{...commandRow.value,status:'applied'}}]);
   if(result.status==='conflict'){const latest=await this.sessionRow(id);if(latest.value.settlement.status==='applied'&&same(latest.value.settlement.pendingPayload,settlement.pendingPayload))return {status:'replayed',sessionId:id};}
   return this.outcome(result,id,'applied');
  }catch(error){return this.blocked(error,id);}
 }
}
export async function createPracticeWorkflow(options:PracticeWorkflowOptions):Promise<PracticeWorkflow>{
 const repository=options.repository??await openLearningDomainRepository(options.scope,{factory:options.factory,name:options.name});
 return new PracticeWorkflow(repository,options);
}
