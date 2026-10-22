import {openLearningDomainRepository,workflowScopeKey,DOMAIN_COLLECTIONS, type DomainCollection, type DomainRecord, type DomainCommitResult, type DomainWrite, type DomainExpectation, type WorkflowBackup} from './learning-domain-repository';
import {canonicalJson, canonicalHash, canonicalValue, type JsonValue} from './domain-command';
import {validatePracticeWorkflowBackup} from './practice-workflow';
import questions from '../content/questions.json';
import type {Question} from './study-model';
import {vocabularyId, vocabularyState, validVocabularyEvent, type VocabularyEvent, type Word} from './vocabulary-model';
import {getWorkflowCatalog, WORKFLOW_WORDS, isWorkflowBookId, getCandidateLearningWord, CANDIDATE_CONTENT_PENDING, type WorkflowBookId} from './workflow-catalog';
import {FULL4109_CURRENT_MODE} from './vocabulary-content-catalog';

export type VocabularyWorkflowScope = {kind:'web-owner'|'harmony-owner'; ownerId:string} | {kind:'web-local'|'harmony-device'; partition:'existing-device'};
export type RawVocabularyRating = 'known'|'fuzzy'|'forgotten';
export type VocabularyIntent = 'new'|'due-review'|'manual-review'|'reinforcement';
export type CandidateKind = 'new'|'manual-review';
export type CandidateStatus = 'available-new'|'already-present'|'available-review'|'already-review'|'today-reviewed';
export type VocabularyStepTarget = {sessionId:string;stepId:string};
export type VocabularyReviewEvent = VocabularyEvent & {type:'review'};
export type VocabularyPlanDraft = {bookId:WorkflowBookId; goal:number; dailyNew:number; weekdays:number[]};
export type VocabularyPlan = VocabularyPlanDraft & {id:string; schemaVersion:1; revision:number; createdAt:string; updatedAt:string};
export type VocabularyDayWindow = {id:string; localDate:string; timezone:string; startAt:string; endAt:string};
export type VocabularyGoalCoverage = {goal:number; coverage:{wordId:string;eventId:string;eventHash:string}[]};
export type VocabularyDay = {schemaVersion:1; window:VocabularyDayWindow; newDone:string[]; reviewDone:string[]; goalCompleted:boolean; goalCoverage?:VocabularyGoalCoverage; carryFromDayId?:string};
export type VocabularyCandidate = {schemaVersion:1; word:Word; contentSource:string; kind:CandidateKind; dayId?:string; createdAt:string};
export type VocabularyStep = {id:string; wordId:string; word:Word; intent:VocabularyIntent; reasons:string[]; activeCommandId?:string; receipt?:VocabularyReceipt; pendingRating?:RawVocabularyRating};
export type VocabularySession = {id:string; schemaVersion:1; planRevision:number; dayWindow:VocabularyDayWindow; createdAt:string; queue:VocabularyStep[]; cursor:number; status:'active'|'completed'; currentStep?:VocabularyStep; blockedReason?:string};
export type VocabularyReceipt = {commandId:string; legacyEventId:string; legacyPayloadHash:string; occurredAt:string; rawRating:RawVocabularyRating; intent:VocabularyIntent; ratingPolicy:'three-label-conservative-v1'};
export type VocabularyCommand = {schemaVersion:1; id:string; sessionId:string; stepId:string; expectedRevision:number; occurredAt:string; payloadHash:string; intent:VocabularyIntent; legacyPayload:VocabularyReviewEvent; rawRating:RawVocabularyRating; ratingPolicy:'three-label-conservative-v1'; status:'prepared'|'applied'|'blocked'|'reference-unverified'; receipt?:VocabularyReceipt};
export type VocabularyProjection = {plan:VocabularyPlan|null; counts:{capacity:number; learned:number; remaining:number; reviewDue:number}; daily:{window:VocabularyDayWindow; newDone:number; reviewDone:number; newRemaining:number; reviewRemaining:number; newWordIds:string[]; reviewWordIds:string[]; goalCompleted:boolean; isLearningDay:boolean}; activeSession:VocabularySession|null; candidates:VocabularyCandidate[]; learnedWordIds:string[]; unresolvedReviewWordIds:string[]};
export type VocabularyWorkflowResult = {status:'applied'|'replayed'|'already-present'|'already-review'|'today-reviewed'|'stage-changed'|'empty'|'pending'|'unknown'|'conflict'|'blocked'; reason?:string; id?:string; receipt?:VocabularyReceipt; session?:VocabularySession; added?:number};
export type VocabularyLegacyAdapter = {readEvents:()=>VocabularyEvent[]|Promise<VocabularyEvent[]>; readEvent:(id:string)=>VocabularyEvent|undefined|Promise<VocabularyEvent|undefined>; writeReview:(event:VocabularyReviewEvent)=>unknown|Promise<unknown>};
export type VocabularyWorkflowOptions = {scope:VocabularyWorkflowScope; legacy:VocabularyLegacyAdapter; words?:Word[]; practiceQuestionCatalogs?:readonly (readonly Question[])[]; now?:()=>Date; repository?:Awaited<ReturnType<typeof openLearningDomainRepository>>; databaseName?:string; factory?:IDBFactory; isCurrent?:()=>boolean};

const PLAN_ID='vocab:plan', ACTIVE_ID='vocab:active', POLICY='three-label-conservative-v1' as const;
const unique=(items:string[])=>[...new Set(items)];
const json=(value:unknown)=>canonicalValue(value);
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const stamp=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function admittedNewCandidate(candidate:VocabularyCandidate):boolean {
  if(!FULL4109_CURRENT_MODE)return true;
  const current=getCandidateLearningWord(candidate.word);
  return !!current&&current.id===candidate.word.id&&(['word','pos','meaning','example','translation'] as const).every(key=>current[key]===candidate.word[key]);
}
/** One coverage membership for saved plans, draft forecasts and future groups. */
export function vocabularyPlanMembers(bookId:WorkflowBookId,candidates:readonly VocabularyCandidate[]):Word[] {
  const map=new Map(getWorkflowCatalog(bookId).map(word=>[word.id,word]));
  for(const candidate of candidates)if(candidate.kind==='new'&&admittedNewCandidate(candidate))map.set(candidate.word.id,candidate.word);
  return [...map.values()];
}
function wordSnapshot(input:Word):Word {
  if(!input||!/^[a-zA-Z0-9-]{1,100}$/.test(input.id)||typeof input.word!=='string'||!input.word.trim()||input.word.length>200)throw Error('词条标识或内容无效，请选择明确词条。');
  const result:Word={id:input.id,word:input.word,pos:input.pos,meaning:input.meaning,category:input.category,example:input.example,translation:input.translation,collocation:input.collocation};
  for(const key of ['pos','meaning','category','example','translation','collocation'] as const)if(typeof result[key]!=='string'||result[key].length>20000)throw Error('词条内容无效。');
  for(const key of ['phonetics','senses','etymology','forms','source'] as const)if(input[key]!==undefined)Object.assign(result,{[key]:input[key]});
  return json(result) as unknown as Word;
}
function legacyReview(value:VocabularyEvent|undefined):VocabularyReviewEvent|undefined {
  if(!value||value.type!=='review'||!validVocabularyEvent(value))return;
  return {id:value.id,wordId:value.wordId,createdAt:new Date(value.createdAt).toISOString(),type:'review',grade:value.grade};
}
function resultOf(result:DomainCommitResult):VocabularyWorkflowResult {
  if(result.status==='committed'||result.status==='replayed')return {status:result.status==='committed'?'applied':'replayed'};
  if(result.status==='unknown')return {status:'unknown',id:result.commandId};
  return {status:result.status,reason:'reason' in result?result.reason:'工作流状态未确认。'};
}
const good=(result:VocabularyWorkflowResult)=>result.status==='applied'||result.status==='replayed';
const withCurrent=(session:VocabularySession):VocabularySession=>({...session,...(session.queue[session.cursor]?{currentStep:session.queue[session.cursor]}:{})});
const DAY_FORMATTERS=new Map<string,Intl.DateTimeFormat>();
function localDate(time:number,timezone:string) {
  let formatter=DAY_FORMATTERS.get(timezone);
  if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});DAY_FORMATTERS.set(timezone,formatter);}
  const parts=formatter.formatToParts(time),part=(key:string)=>parts.find(row=>row.type===key)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function midnight(date:string,timezone:string) {
  const center=Date.parse(date+'T00:00:00.000Z');let left=center-36*3600000,right=center+36*3600000;
  while(left<right){const middle=Math.floor((left+right)/2);if(localDate(middle,timezone)<date)left=middle+1;else right=middle;}
  return left;
}
export function vocabularyDayWindow(now:Date,timezone:string):VocabularyDayWindow {
  const date=localDate(now.getTime(),timezone),next=new Date(Date.parse(date+'T12:00:00.000Z')+86400000).toISOString().slice(0,10);
  const start=midnight(date,timezone),end=midnight(next,timezone);
  return {id:'vocab:day:'+start,localDate:date,timezone,startAt:new Date(start).toISOString(),endAt:new Date(end).toISOString()};
}
function validWindow(window:VocabularyDayWindow) {
  if(!window||typeof window.id!=='string'||!window.id.startsWith('vocab:day:')||!/^\d{4}-\d\d-\d\d$/.test(window.localDate)||!stamp(window.startAt)||!stamp(window.endAt)||Date.parse(window.endAt)<=Date.parse(window.startAt))throw Error('日窗口损坏，已停止工作流。');
  localDate(Date.parse(window.startAt),window.timezone);
}
function validateValue(collection:DomainCollection,id:string,value:unknown) {
  if(!id.startsWith('vocab:'))return;
  if(!object(value)||value.schemaVersion!==1)throw Error('词汇工作流版本不支持或内容损坏。');
  if(collection==='plans'){
    const row=value as unknown as VocabularyPlan;
    if(id!==PLAN_ID||row.id!==PLAN_ID||!isWorkflowBookId(row.bookId)||!Number.isSafeInteger(row.revision)||row.revision<1||!Number.isSafeInteger(row.goal)||row.goal<0||!Number.isSafeInteger(row.dailyNew)||row.dailyNew<1||row.dailyNew>1000||!Array.isArray(row.weekdays)||row.weekdays.length>7||row.weekdays.some(day=>!Number.isInteger(day)||day<1||day>7)||!stamp(row.createdAt)||!stamp(row.updatedAt))throw Error('单词计划损坏。');
  }else if(collection==='days'){
    const row=value as unknown as VocabularyDay;
    validWindow(row.window);if(row.window.id!==id||!Array.isArray(row.newDone)||!Array.isArray(row.reviewDone)||[...row.newDone,...row.reviewDone].some(item=>typeof item!=='string')||typeof row.goalCompleted!=='boolean')throw Error('单词日账本损坏。');
    if(row.goalCoverage&&(!Number.isSafeInteger(row.goalCoverage.goal)||row.goalCoverage.goal<0||!Array.isArray(row.goalCoverage.coverage)||row.goalCoverage.coverage.length!==row.goalCoverage.goal||new Set(row.goalCoverage.coverage.map(ref=>ref.wordId)).size!==row.goalCoverage.goal||row.goalCoverage.coverage.some(ref=>typeof ref.wordId!=='string'||typeof ref.eventId!=='string'||typeof ref.eventHash!=='string')))throw Error('目标覆盖引用损坏。');
  }else if(collection==='candidates'){
    const row=value as unknown as VocabularyCandidate;
    wordSnapshot(row.word);if(!['new','manual-review'].includes(row.kind)||!stamp(row.createdAt)||typeof row.contentSource!=='string'||(row.kind==='manual-review'&&typeof row.dayId!=='string'))throw Error('词汇候选损坏。');
  }else if(collection==='sessions'){
    if(id===ACTIVE_ID){if(typeof value.sessionId!=='string')throw Error('活动词组引用损坏。');return;}
    const row=value as unknown as VocabularySession;
    validWindow(row.dayWindow);
    if(row.id!==id||!id.startsWith('vocab:session:')||!Array.isArray(row.queue)||!row.queue.length||row.queue.length>20||!Number.isSafeInteger(row.cursor)||row.cursor<0||row.cursor>row.queue.length||!['active','completed'].includes(row.status)||(row.status==='completed'&&row.cursor!==row.queue.length)||(row.status==='active'&&row.cursor===row.queue.length)||!Number.isSafeInteger(row.planRevision)||!stamp(row.createdAt)||new Set(row.queue.map(step=>step.id)).size!==row.queue.length||new Set(row.queue.map(step=>step.wordId)).size!==row.queue.length)throw Error('词汇活动组损坏。');
    for(const step of row.queue){wordSnapshot(step.word);if(typeof step.id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(step.id)||step.wordId!==step.word.id||!['new','due-review','manual-review','reinforcement'].includes(step.intent)||!Array.isArray(step.reasons)||step.reasons.some(reason=>typeof reason!=='string'))throw Error('词汇步骤损坏。');}
  }else if(collection==='commands'){
    const row=value as unknown as VocabularyCommand;
    const review=legacyReview(row.legacyPayload);
    if(row.id!==id||!review||!same(review,row.legacyPayload)||!['known','fuzzy','forgotten'].includes(row.rawRating)||!['new','due-review','manual-review','reinforcement'].includes(row.intent)||review.grade!==(row.rawRating==='known'?'remembered':'again')||row.ratingPolicy!==POLICY||row.payloadHash!==canonicalHash(canonicalJson(review))||!['prepared','applied','blocked','reference-unverified'].includes(row.status)||!stamp(row.occurredAt)||row.occurredAt!==review.createdAt||!Number.isSafeInteger(row.expectedRevision)||row.expectedRevision<1||typeof row.sessionId!=='string'||typeof row.stepId!=='string')throw Error('词汇反馈命令损坏。');
  }else throw Error('词汇工作流包含未知记录。');
}

/** Pure preflight, shared by every whole-scope restore entry point. It validates
 * vocabulary metadata without treating an imported receipt as a learning fact. */
export function validateVocabularyWorkflowBackup(input:unknown,expectedScopeKey?:string):void {
  const value=(typeof input==='string'?JSON.parse(input):input) as WorkflowBackup;
  if(!object(value)||value.kind!=='lantern-workflow'||value.schemaVersion!==1||!object(value.records)||!Array.isArray(value.commands))throw Error('工作流备份版本不支持。');
  if(expectedScopeKey&&workflowScopeKey(value.scope)!==expectedScopeKey)throw Error('工作流账号或入口不匹配。');
  for(const collection of DOMAIN_COLLECTIONS){
    const records=value.records[collection];if(!Array.isArray(records))throw Error('工作流备份不完整。');
    for(const row of records){
      if(!object(row)||typeof row.id!=='string'||(!row.id.startsWith('vocab:')&&!/^practice(?::|-(?:answer|settlement):)/.test(row.id)))throw Error('工作流备份含未知领域记录。');
      validateValue(collection,row.id,row.value);
      if(row.id===PLAN_ID&&(row.value as unknown as VocabularyPlan).revision!==row.revision)throw Error('单词计划版本引用损坏。');
    }
  }
  for(const stored of value.commands)if(!object(stored)||!object(stored.command)||typeof stored.command.commandId!=='string'||(!stored.command.commandId.startsWith('vocab:')&&!/^practice(?::|-(?:answer|settlement|start|next|leave|draft|training):)/.test(stored.command.commandId)))throw Error('工作流备份含未知命令领域。');
  const sessions=value.records.sessions.filter(row=>row.id.startsWith('vocab:')&&row.id!==ACTIVE_ID) as unknown as DomainRecord<VocabularySession>[],commands=value.records.commands.filter(row=>row.id.startsWith('vocab:')) as unknown as DomainRecord<VocabularyCommand>[];
  const seenLegacyIds=new Set<string>();
  for(const row of commands){
    const command=row.value,session=sessions.find(item=>item.id===command.sessionId),step=session?.value.queue.find(item=>item.id===command.stepId);
    if(!step||step.activeCommandId!==command.id||step.wordId!==command.legacyPayload.wordId||step.intent!==command.intent||seenLegacyIds.has(command.legacyPayload.id))throw Error('词汇反馈与固定词组关联损坏。');
    seenLegacyIds.add(command.legacyPayload.id);
    if(command.status==='applied'&&(!command.receipt||!same(command.receipt,receiptFor(command))||!step.receipt||!same(step.receipt,command.receipt)))throw Error('词汇反馈回执损坏。');
  }
  for(const row of sessions){
    const day=value.records.days.find(day=>day.id===row.value.dayWindow.id);
    if(!day||!same((day.value as unknown as VocabularyDay).window,row.value.dayWindow))throw Error('词组原日窗口缺失或不一致。');
    row.value.queue.forEach((step,index)=>{const command=commands.find(item=>item.id===step.activeCommandId);if(step.activeCommandId&&!command)throw Error('词卡反馈引用缺失。');if(index<row.value.cursor&&command?.value.status!=='applied')throw Error('词组游标缺少已应用反馈。');});
  }
  const pointer=value.records.sessions.find(row=>row.id===ACTIVE_ID);
  if(pointer&&!sessions.some(row=>row.id===(pointer.value as {sessionId?:string}).sessionId))throw Error('活动词组引用缺失。');
  for(const candidate of value.records.candidates.filter(row=>row.id.startsWith('vocab:'))){const data=candidate.value as unknown as VocabularyCandidate,expected=data.kind==='new'?`vocab:candidate:new:${data.word.id}`:`vocab:candidate:${data.dayId}:manual-review:${data.word.id}`;if(candidate.id!==expected)throw Error('词汇候选稳定标识不一致。');}
}

/** Plans and workflow metadata live in IDB. Legacy vocabulary events remain the
 * only learning/scheduling facts; an IDB receipt never replaces their readback. */
export async function createVocabularyWorkflow(options:VocabularyWorkflowOptions) {
  const repo=options.repository??await openLearningDomainRepository(options.scope,{factory:options.factory,name:options.databaseName});
  if(repo.scopeKey!==workflowScopeKey(options.scope))throw Error('工作流仓储分区与当前入口不匹配。');
  const now=options.now??(()=>new Date()),current=()=>options.isCurrent?.()!==false;
  const knownWords=new Map((options.words??WORKFLOW_WORDS).map(word=>[word.id,wordSnapshot(word)]));
  let cached:VocabularyProjection|null=null;
  function assertCurrent(){if(!current())throw Error('账号或入口已切换，原操作已保留。');}
  async function rows<T>(collection:DomainCollection){const result=(await repo.list<T>(collection)).filter(row=>row.id.startsWith('vocab:'));for(const row of result)validateValue(collection,row.id,row.value);return result;}
  async function read<T>(collection:DomainCollection,id:string){const row=await repo.read<T>(collection,id);if(row)validateValue(collection,id,row.value);return row;}
  const write=(collection:DomainCollection,id:string,value:unknown,row?:DomainRecord<unknown>):DomainWrite=>({collection,id,revision:(row?.revision??0)+1,value:json(value)});
  const expected=(collection:DomainCollection,id:string,row?:DomainRecord<unknown>):DomainExpectation=>({collection,id,revision:row?.revision??null});
  async function commit(id:string,payload:unknown,writes:DomainWrite[],guards:DomainExpectation[],occurredAt=now().toISOString()){assertCurrent();return resultOf(await repo.commit({commandId:id,occurredAt,payload:json(payload),writes,expected:guards}));}
  async function dayFor(timezone:string,dayRows:DomainRecord<VocabularyDay>[]) {
    const time=now().getTime(),open=dayRows.filter(row=>Date.parse(row.value.window.startAt)<=time&&time<Date.parse(row.value.window.endAt)).sort((a,b)=>Date.parse(b.value.window.startAt)-Date.parse(a.value.window.startAt))[0];
    if(open)return {row:open,value:open.value};
    let window=vocabularyDayWindow(now(),timezone);const last=dayRows.filter(row=>Date.parse(row.value.window.endAt)<=time).sort((a,b)=>Date.parse(b.value.window.endAt)-Date.parse(a.value.window.endAt))[0];
    let carryNew:string[]=[],carryReview:string[]=[],carryFromDayId:string|undefined,goalCoverage:VocabularyGoalCoverage|undefined;
    if(last&&last.value.window.timezone!==timezone&&Date.parse(window.startAt)<Date.parse(last.value.window.endAt)){
      // An overlapping timezone transition cannot grant a second new-word quota.
      window={...window,startAt:last.value.window.endAt,id:'vocab:day:'+Date.parse(last.value.window.endAt)};carryNew=last.value.newDone;carryReview=last.value.reviewDone;carryFromDayId=last.id;goalCoverage=last.value.goalCoverage;
    }
    const row=dayRows.find(item=>item.id===window.id);
    return {row,value:row?.value??{schemaVersion:1 as const,window,newDone:carryNew,reviewDone:carryReview,goalCompleted:!!goalCoverage,...(carryFromDayId?{carryFromDayId}:{}),...(goalCoverage?{goalCoverage}:{})}};
  }
  async function facts(){const events=await options.legacy.readEvents();if(!Array.isArray(events)||!events.every(validVocabularyEvent))throw Error('旧词卡记录无法安全读取，工作流已停止写入。');return events;}
  function members(plan:VocabularyPlan|null,candidates:VocabularyCandidate[]) {
    return vocabularyPlanMembers(plan?.bookId??'scene',candidates);
  }
  function coverageFor(plan:VocabularyPlan,candidates:VocabularyCandidate[],events:VocabularyEvent[]):VocabularyGoalCoverage {
    const selected=new Set(members(plan,candidates).map(word=>word.id)),covered=new Map<string,VocabularyReviewEvent>();
    for(const row of events){const review=legacyReview(row);if(review&&selected.has(review.wordId)&&!covered.has(review.wordId))covered.set(review.wordId,review);}
    return {goal:plan.goal,coverage:[...covered.values()].slice(0,plan.goal).map(event=>({wordId:event.wordId,eventId:event.id,eventHash:canonicalHash(canonicalJson(event))}))};
  }
  async function load(timezone:string) {
    assertCurrent();const [snapshot,events]=await Promise.all([repo.exportBackup(),facts()]);
    const fromSnapshot=<T>(collection:DomainCollection)=>snapshot.records[collection].filter(row=>row.id.startsWith('vocab:')).map(row=>{validateValue(collection,row.id,row.value);return row as unknown as DomainRecord<T>;});
    const plan=fromSnapshot<VocabularyPlan>('plans').find(row=>row.id===PLAN_ID),days=fromSnapshot<VocabularyDay>('days'),candidateRows=fromSnapshot<VocabularyCandidate>('candidates'),sessions=fromSnapshot<VocabularySession>('sessions'),commands=fromSnapshot<VocabularyCommand>('commands');
    const day=await dayFor(timezone,days),candidates=candidateRows.map(row=>row.value),memberWords=members(plan?.value??null,candidates);
    const learned=new Set(events.filter(row=>row.type==='review').map(row=>row.wordId)),eventMap=new Map(events.map(event=>[event.id,event]));
    // Persisted old candidates remain available for factual reviews. Unlearned
    // stale candidates must not override a current admitted new-group snapshot.
    const byId=new Map([...knownWords,...memberWords.map(word=>[word.id,word] as const),...candidates.filter(row=>row.kind==='manual-review'||learned.has(row.word.id)||admittedNewCandidate(row)).map(row=>[row.word.id,row.word] as const)]);
    const verified=new Set(commands.filter(row=>{const event=legacyReview(eventMap.get(row.value.legacyPayload.id));return !!event&&same(event,row.value.legacyPayload);}).map(row=>row.id));
    const pointer=sessions.find(row=>row.id===ACTIVE_ID) as unknown as DomainRecord<{schemaVersion:1;sessionId:string}>|undefined;
    if(pointer)validateValue('sessions',ACTIVE_ID,pointer.value);
    const active=sessions.find(row=>row.id===pointer?.value.sessionId);
    // Imported receipts are display-inert until the old journal confirms them.
    let activeValue=active?withCurrent({...active.value,queue:active.value.queue.map(step=>{
      const command=commands.find(row=>row.id===step.activeCommandId)?.value,copy={...step};delete copy.receipt;
      if(command&&command.sessionId===active.id&&command.stepId===step.id&&command.legacyPayload.wordId===step.wordId&&command.intent===step.intent){
        copy.pendingRating=command.rawRating;
        if(command.status==='applied'&&verified.has(command.id))copy.receipt=receiptFor(command);
      }
      return copy;
    })}):null;
    if(activeValue){const missing=activeValue.queue.findIndex((step,index)=>(index<activeValue!.cursor||!!step.activeCommandId&&commands.find(row=>row.id===step.activeCommandId)?.value.status==='applied')&&!step.receipt);if(missing>=0)activeValue=withCurrent({...activeValue,cursor:missing,status:'active',blockedReason:'工作流备份尚缺对应旧词卡事件；恢复旧词卡备份后才能确认完成。'});}
    const carryDay=days.find(row=>row.id===day.value.carryFromDayId),carryValid=!!carryDay&&carryDay.value.window.endAt===day.value.window.startAt&&carryDay.value.window.timezone!==day.value.window.timezone&&Date.parse(day.value.window.startAt)-Date.parse(carryDay.value.window.startAt)<=48*3600000;
    const dayCommands=commands.filter(row=>verified.has(row.id)&&row.value.status==='applied'&&(()=>{const session=sessions.find(session=>session.id===row.value.sessionId);return session?.value.dayWindow.id===day.value.window.id||(carryValid&&session?.value.dayWindow.id===carryDay!.id);})());
    const newDone=unique(dayCommands.filter(row=>row.value.intent==='new').map(row=>row.value.legacyPayload.wordId));
    const reviewDone=unique(dayCommands.filter(row=>row.value.intent!=='new'&&row.value.intent!=='reinforcement').map(row=>row.value.legacyPayload.wordId));
    // Counters come only from verified commands in this exact window (or its
    // explicit adjacent timezone transition), never from imported counter arrays.
    const learnedCount=memberWords.filter(word=>learned.has(word.id)).length;
    // A book change cannot hide an existing due review. Unknown old IDs remain
    // visible as unresolved work; a guessed word is never substituted for them.
    const dueIds=[...learned].filter(id=>{const state=vocabularyState(events,id);return state.due>0&&state.due<=now().getTime()&&!reviewDone.includes(id);});
    const manual=candidates.filter(row=>row.kind==='manual-review'&&row.dayId===day.value.window.id&&!reviewDone.includes(row.word.id));
    const reviewIds=unique([...dueIds,...manual.map(row=>row.word.id)]);
    const weekday=((new Date(day.value.window.localDate+'T12:00:00.000Z').getUTCDay()+6)%7)+1,isLearningDay=!!plan?.value.weekdays.includes(weekday);
    const newRemaining=plan&&isLearningDay?Math.max(0,Math.min(plan.value.dailyNew-newDone.length,plan.value.goal-learnedCount)):0;
    const requestedNew=candidates.filter(row=>row.kind==='new'&&!learned.has(row.word.id)&&admittedNewCandidate(row)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.word.id.localeCompare(b.word.id)).map(row=>row.word.id);
    const newIds=unique([...requestedNew,...memberWords.filter(word=>!learned.has(word.id)).map(word=>word.id)]).slice(0,newRemaining);
    const coverage=day.value.goalCoverage,coveredFact=day.value.goalCompleted&&!!coverage&&coverage.coverage.every(ref=>{const event=legacyReview(eventMap.get(ref.eventId));return event?.wordId===ref.wordId&&canonicalHash(canonicalJson(event))===ref.eventHash;});
    const projection:VocabularyProjection={plan:plan?.value??null,counts:{capacity:memberWords.length,learned:learnedCount,remaining:Math.max(0,(plan?.value.goal??memberWords.length)-learnedCount),reviewDue:dueIds.length},daily:{window:day.value.window,newDone:newDone.length,reviewDone:reviewDone.length,newRemaining,reviewRemaining:reviewIds.length,newWordIds:newIds,reviewWordIds:reviewIds,goalCompleted:coveredFact||(!!plan&&learnedCount>=plan.value.goal),isLearningDay},activeSession:activeValue,candidates,learnedWordIds:[...learned],unresolvedReviewWordIds:reviewIds.filter(id=>!byId.has(id))};
    cached=projection;cachedReviewDone=new Set(reviewDone);return {projection,plan,day,candidateRows,sessions,commands,events,learned,verified,byId,pointer,active};
  }
  async function readProjection(timezone='UTC'):Promise<VocabularyProjection> {
    await confirmVocabularyRows();
    const state=await load(timezone);
    // Recover a write-before-crash without resubmitting an absent old event.
    const command=state.commands.find(row=>row.value.status==='prepared'&&state.verified.has(row.id));
    if(command){const recovered=await apply(command.value);if(good(recovered))return (await load(timezone)).projection;}
    return state.projection;
  }
  async function savePlan(draft:VocabularyPlanDraft,expectedRevision:number|null,timezone='UTC'):Promise<VocabularyWorkflowResult> {
    try{
      if(!isWorkflowBookId(draft.bookId))return {status:'blocked',reason:'不支持的词书，原计划保留。'};
      const state=await load(timezone),capacity=members({...draft,id:PLAN_ID,schemaVersion:1,revision:1,createdAt:now().toISOString(),updatedAt:now().toISOString()},state.projection.candidates),learned=capacity.filter(word=>state.learned.has(word.id)).length;
      // Goal errors have priority over the independent no-study-days error.
      if(!isWorkflowBookId(draft.bookId)||!Number.isSafeInteger(draft.goal)||draft.goal<learned||draft.goal>capacity.length)return {status:'blocked',reason:`目标须为 ${learned} 至 ${capacity.length} 的整数。`};
      if(!Array.isArray(draft.weekdays)||(!draft.weekdays.length&&draft.goal>learned)||draft.weekdays.some(day=>!Number.isInteger(day)||day<1||day>7))return {status:'blocked',reason:'请至少选择一个学习日。'};
      if(!Number.isSafeInteger(draft.dailyNew)||draft.dailyNew<1||draft.dailyNew>1000)return {status:'blocked',reason:'每日新词须为 1 至 1000 的整数。'};
      if((state.plan?.revision??null)!==expectedRevision)return {status:'conflict',reason:'计划已在另一窗口更新，请重新读取。'};
      const value:VocabularyPlan={...draft,weekdays:[...new Set(draft.weekdays)].sort(),schemaVersion:1,id:PLAN_ID,revision:(state.plan?.revision??0)+1,createdAt:state.plan?.value.createdAt??now().toISOString(),updatedAt:now().toISOString()};
      const nextDay:VocabularyDay={...state.day.value,goalCompleted:state.day.value.goalCompleted||learned>=draft.goal};
      if(learned>=draft.goal&&!nextDay.goalCoverage)nextDay.goalCoverage=coverageFor(value,state.projection.candidates,state.events);
      const writes=[write('plans',PLAN_ID,value,state.plan),write('days',state.day.value.window.id,nextDay,state.day.row)],guards=[expected('plans',PLAN_ID,state.plan),expected('days',state.day.value.window.id,state.day.row)];
      return await commit('vocab:plan-save:'+vocabularyId(),value,writes,guards);
    }catch(error){return {status:'blocked',reason:error instanceof Error?error.message:'计划保存失败。'};}
  }
  function candidateStatus(word:Word):CandidateStatus {
    if(!cached?.learnedWordIds.includes(word.id))word=getCandidateLearningWord(word)??word;
    if(!cached||!cached.learnedWordIds.includes(word.id))return cached?.candidates.some(candidate=>candidate.kind==='new'&&candidate.word.id===word.id)?'already-present':'available-new';
    if(cachedReviewDone.has(word.id))return 'today-reviewed';
    if(cached.candidates.some(row=>row.kind==='manual-review'&&row.dayId===cached?.daily.window.id&&row.word.id===word.id))return 'already-review';
    if(cached.daily.reviewDone>0&&cached.activeSession?.queue.some(step=>step.wordId===word.id&&step.intent!=='new'&&step.receipt&&cached?.activeSession?.dayWindow.id===cached?.daily.window.id))return 'today-reviewed';
    // A completed review can belong to an older completed group as well.
    return cachedReviewDone.has(word.id)?'today-reviewed':'available-review';
  }
  let cachedReviewDone=new Set<string>();
  async function addCandidate(word:Word,kind:CandidateKind,commandId=vocabularyId(),timezone='UTC'):Promise<VocabularyWorkflowResult> {
    try{
      const offered=wordSnapshot(word),state=await load(timezone);
      const reusableWord=getCandidateLearningWord(offered);
      if(kind==='new'&&!reusableWord)return {status:'blocked',reason:CANDIDATE_CONTENT_PENDING};
      const snapshot=state.learned.has(offered.id)?offered:(reusableWord??offered);
      if(!state.plan)return {status:'blocked',reason:'请先保存单词计划。'};
      const stage=state.learned.has(word.id)?'manual-review':'new';if(kind!==stage)return {status:'stage-changed',reason:'该词学习阶段已变化，请按最新按钮重新选择。'};
      const reviewed=state.commands.some(row=>state.verified.has(row.id)&&row.value.status==='applied'&&row.value.intent!=='new'&&row.value.intent!=='reinforcement'&&row.value.legacyPayload.wordId===word.id&&state.sessions.find(session=>session.id===row.value.sessionId)?.value.dayWindow.id===state.day.value.window.id);
      if(kind==='manual-review'&&reviewed)return {status:'today-reviewed'};
      const id=kind==='new'?`vocab:candidate:new:${word.id}`:`vocab:candidate:${state.day.value.window.id}:manual-review:${word.id}`;
      if(state.candidateRows.some(row=>row.id===id))return {status:kind==='new'?'already-present':'already-review'};
      const value:VocabularyCandidate={schemaVersion:1,word:snapshot,contentSource:snapshot.source??(snapshot.category==='questions'?'lantern-question-expression':'lantern-authored'),kind,createdAt:now().toISOString(),...(kind==='manual-review'?{dayId:state.day.value.window.id}:{})};
      const guards=[expected('candidates',id),expected('plans',PLAN_ID,state.plan)];
      const writes=[write('candidates',id,value)];if(!state.day.row){writes.push(write('days',state.day.value.window.id,state.day.value));guards.push(expected('days',state.day.value.window.id));}
      const response=await commit('vocab:candidate-add:'+commandId,{id,kind,word:snapshot},writes,guards);
      if(response.status==='conflict'&&(await repo.read('candidates',id)))return {status:kind==='new'?'already-present':'already-review'};
      if(good(response)){const refreshed=await load(timezone);if((refreshed.learned.has(word.id)?'manual-review':'new')!==kind)return {status:'stage-changed',reason:'该词的学习阶段已变化，候选已保留，请重新查看。'};if(kind==='manual-review'&&cachedReviewDone.has(word.id))return {status:'today-reviewed'};}
      return response;
    }catch(error){return {status:'blocked',reason:error instanceof Error?error.message:'加入候选失败。'};}
  }
  async function startGroup(intent:'daily'|'new'|'review'|'extra'='daily',timezone='UTC'):Promise<VocabularyWorkflowResult> {
    try{
      const state=await load(timezone);if(!state.plan)return {status:'blocked',reason:'请先保存单词计划。'};
      if(state.active?.value.status==='active')return {status:'replayed',id:state.active.id,session:withCurrent(state.active.value)};
      const reviewIds=intent==='new'?[]:state.projection.daily.reviewWordIds;
      let newIds=intent==='review'?[]:state.projection.daily.newWordIds;
      if(intent==='extra')newIds=members(state.plan.value,state.projection.candidates).filter(word=>!state.learned.has(word.id)).map(word=>word.id);
      const available=unique([...reviewIds,...newIds]);
      if(intent==='extra'&&!available.length)available.push(...members(state.plan.value,state.projection.candidates).filter(word=>state.learned.has(word.id)).map(word=>word.id));
      const selected=available.filter(id=>state.byId.has(id)).slice(0,20);if(!selected.length)return available.length?{status:'blocked',reason:`还有 ${available.length} 个旧词条待定位；请通过查词选择其明确词条后再复习，旧记录已保留。`}:{status:'empty',reason:'当前没有待开始的词卡；可调整计划或明确加入主动复练。'};
      const id='vocab:session:'+vocabularyId(),queue:VocabularyStep[]=selected.map(wordId=>{
        const manual=state.projection.candidates.some(row=>row.kind==='manual-review'&&row.dayId===state.day.value.window.id&&row.word.id===wordId),due=vocabularyState(state.events,wordId).due<=now().getTime();
        const type:VocabularyIntent=!state.learned.has(wordId)?'new':intent==='extra'&&cachedReviewDone.has(wordId)?'reinforcement':due?'due-review':'manual-review';
        return {id:vocabularyId(),wordId,word:wordSnapshot(state.byId.get(wordId)!),intent:type,reasons:type==='new'?['plan-new']:[...(due?['due']:[]),...(manual?['manual']:[]),...(!due&&!manual?['explicit-extra']:[])]};
      });
      const value:VocabularySession={id,schemaVersion:1,planRevision:state.plan.revision,dayWindow:state.day.value.window,createdAt:now().toISOString(),queue,cursor:0,status:'active'};
      const writes=[write('sessions',id,value),write('sessions',ACTIVE_ID,{schemaVersion:1,sessionId:id},state.pointer)],guards=[expected('sessions',id),expected('sessions',ACTIVE_ID,state.pointer),expected('plans',PLAN_ID,state.plan)];
      if(!state.day.row){writes.push(write('days',state.day.value.window.id,state.day.value));guards.push(expected('days',state.day.value.window.id));}
      const response=await commit('vocab:start:'+id,{intent,session:value},writes,guards);
      return good(response)?{...response,id,session:withCurrent(value)}:response;
    }catch(error){return {status:'blocked',reason:error instanceof Error?error.message:'活动组创建失败。'};}
  }
  async function apply(command:VocabularyCommand):Promise<VocabularyWorkflowResult> {
    try{
      assertCurrent();const event=legacyReview(await options.legacy.readEvent(command.legacyPayload.id));
      if(!event)return {status:'pending',id:command.id,reason:'旧词卡事件尚未确认，当前卡片已保留。'};
      if(!same(event,command.legacyPayload))return {status:'blocked',id:command.id,reason:'旧事件同 ID 内容冲突，已停止该反馈。'};
      const [stored,session,day,plan]=await Promise.all([read<VocabularyCommand>('commands',command.id),read<VocabularySession>('sessions',command.sessionId),rows<VocabularyDay>('days'),read<VocabularyPlan>('plans',PLAN_ID)]);
      if(!stored||!session)return {status:'blocked',reason:'反馈引用缺失。'};
      if(stored.value.status==='applied')return {status:'replayed',id:command.id,receipt:stored.value.receipt};
      const index=session.value.queue.findIndex(step=>step.id===command.stepId),step=session.value.queue[index];
      if(!step||step.activeCommandId!==command.id)return {status:'conflict',reason:'反馈未占有该步骤。'};
      const dayRow=day.find(row=>row.id===session.value.dayWindow.id);if(!dayRow)return {status:'blocked',reason:'原组日窗口缺失。'};
      const receipt=receiptFor(command);
      const queue=session.value.queue.map((row,i)=>i===index?{...row,receipt}:row),nextDay={...dayRow.value,newDone:command.intent==='new'?unique([...dayRow.value.newDone,step.wordId]):dayRow.value.newDone,reviewDone:command.intent!=='new'&&command.intent!=='reinforcement'?unique([...dayRow.value.reviewDone,step.wordId]):dayRow.value.reviewDone};
      if(plan){const events=await facts(),learned=new Set(events.filter(row=>row.type==='review').map(row=>row.wordId)),candidates=(await rows<VocabularyCandidate>('candidates')).map(row=>row.value);if(members(plan.value,candidates).filter(word=>learned.has(word.id)).length>=plan.value.goal){nextDay.goalCompleted=true;if(!nextDay.goalCoverage)nextDay.goalCoverage=coverageFor(plan.value,candidates,events);}}
      const writes=[write('commands',command.id,{...stored.value,status:'applied',receipt},stored),write('sessions',session.id,{...session.value,queue},session),write('days',dayRow.id,nextDay,dayRow)];
      const response=await commit('vocab:apply:'+command.id,{command,receipt},writes,[expected('commands',command.id,stored),expected('sessions',session.id,session),expected('days',dayRow.id,dayRow)],command.occurredAt);
      if(response.status==='conflict'){const latest=await read<VocabularyCommand>('commands',command.id);if(latest?.value.status==='applied')return {status:'replayed',id:command.id,receipt:latest.value.receipt};}
      return good(response)?{...response,id:command.id,receipt}:response;
    }catch(error){return {status:'unknown',id:command.id,reason:error instanceof Error?error.message:'反馈状态尚未确认。'};}
  }
  async function submitRating(rawRating:RawVocabularyRating,timezone='UTC',target?:VocabularyStepTarget):Promise<VocabularyWorkflowResult> {
    try{
      if(!['known','fuzzy','forgotten'].includes(rawRating))return {status:'blocked',reason:'请选择有效自评。'};
      if(!target)return {status:'blocked',reason:'缺少当前可见词卡标识，未提交反馈。'};
      const state=await load(timezone),session=state.active,step=session?.value.queue[session.value.cursor];if(!session||!step)return {status:'blocked',reason:'当前没有待反馈词卡。'};
      if(state.projection.activeSession?.blockedReason)return {status:'blocked',reason:state.projection.activeSession.blockedReason};
      if(target&&(target.sessionId!==session.id||target.stepId!==step.id))return {status:'conflict',reason:'另一窗口已切换词卡，未替新词提交旧反馈。'};
      let command:VocabularyCommand;
      if(step.activeCommandId){const row=await read<VocabularyCommand>('commands',step.activeCommandId);if(!row)return {status:'blocked',reason:'已准备反馈缺失。'};command=row.value;if(command.rawRating!==rawRating)return {status:'conflict',reason:'该词已固定另一自评，请继续原反馈。'};}
      else {
        const id='vocab:command:'+vocabularyId(),occurredAt=now().toISOString(),legacyPayload:VocabularyReviewEvent={id:vocabularyId(),wordId:step.wordId,type:'review',grade:rawRating==='known'?'remembered':'again',createdAt:occurredAt};
        command={schemaVersion:1,id,sessionId:session.id,stepId:step.id,expectedRevision:session.revision,occurredAt,payloadHash:canonicalHash(canonicalJson(legacyPayload)),intent:step.intent,legacyPayload,rawRating,ratingPolicy:POLICY,status:'prepared'};
        const queue=session.value.queue.map((row,index)=>index===session.value.cursor?{...row,activeCommandId:id}:row);
        const prepared=await commit('vocab:prepare:'+id,command,[write('commands',id,command),write('sessions',session.id,{...session.value,queue},session)],[expected('commands',id),expected('sessions',session.id,session)],command.occurredAt);
        if(!good(prepared)){
          if(prepared.status==='conflict'){
            const latest=await read<VocabularySession>('sessions',session.id),reserved=latest?.value.queue[session.value.cursor]?.activeCommandId;
            if(reserved){const winner=await read<VocabularyCommand>('commands',reserved);if(winner?.value.rawRating===rawRating)command=winner.value;else return {status:'conflict',reason:'另一窗口已固定该词的自评。'};}else return prepared;
          }else return prepared;
        }
      }
      if(command.status==='blocked')return {status:'blocked',reason:'该反馈被阻止，请保留备份。'};
      if(command.status==='applied')return apply(command);
      assertCurrent();
      const existing=legacyReview(await options.legacy.readEvent(command.legacyPayload.id));
      if(existing&&!same(existing,command.legacyPayload))return {status:'blocked',reason:'旧词卡事件标识冲突。'};
      if(!existing){try{await options.legacy.writeReview(command.legacyPayload);}catch{/* Readback decides, including a lost response after a durable write. */}}
      assertCurrent();return await apply(command);
    }catch(error){return {status:'unknown',reason:error instanceof Error?error.message:'反馈未确认，当前词卡保留。'};}
  }
  async function nextStep(timezone='UTC',target?:VocabularyStepTarget):Promise<VocabularyWorkflowResult> {
    try{
      if(!target)return {status:'blocked',reason:'缺少当前可见词卡标识，未切换词卡。'};
      const state=await load(timezone),session=state.active;if(!session)return {status:'blocked',reason:'没有活动词组。'};
      if(state.projection.activeSession?.blockedReason)return {status:'blocked',reason:state.projection.activeSession.blockedReason};
      if(session.value.status==='completed')return {status:'replayed',id:session.id,session:withCurrent(session.value)};
      const step=session.value.queue[session.value.cursor],command=state.commands.find(row=>row.id===step?.activeCommandId);
      if(target&&(target.sessionId!==session.id||target.stepId!==step?.id))return {status:'conflict',reason:'词卡已在另一窗口切换，请重新读取。'};
      if(!step?.receipt||!command||command.value.status!=='applied'||!state.verified.has(command.id))return {status:'blocked',reason:'请先完成并确认当前词的反馈。'};
      const cursor=session.value.cursor+1,value={...session.value,cursor,status:cursor===session.value.queue.length?'completed' as const:'active' as const};
      const response=await commit(`vocab:next:${session.id}:${step.id}`,{sessionId:session.id,stepId:step.id},[write('sessions',session.id,value,session)],[expected('sessions',session.id,session)],command.value.occurredAt);
      return good(response)?{...response,id:session.id,session:withCurrent(value)}:response;
    }catch(error){return {status:'blocked',reason:error instanceof Error?error.message:'下一词尚未保存。'};}
  }
  async function exportWorkflow(){assertCurrent();const backup=await repo.exportBackup();validateBackup(backup);return backup;}
  async function confirmVocabularyRows(){
    const collections=['plans','days','candidates','sessions','commands'] as DomainCollection[];
    const loaded=await Promise.all(collections.map(async collection=>({collection,records:await rows<unknown>(collection)})));
    if(!loaded.some(group=>group.records.some(row=>row.provenance==='restored-unverified')))return;
    const commandRows=loaded.find(group=>group.collection==='commands')!.records as DomainRecord<VocabularyCommand>[],sessionRows=loaded.find(group=>group.collection==='sessions')!.records as DomainRecord<VocabularySession>[];
    const actual=new Map((await facts()).map(event=>[event.id,event]));
    const safeCommand=(command:VocabularyCommand)=>command.status==='prepared'||(command.status==='applied'&&!!legacyReview(actual.get(command.legacyPayload.id))&&same(legacyReview(actual.get(command.legacyPayload.id)),command.legacyPayload));
    const safeSession=(session:VocabularySession)=>session.queue.every((step,index)=>{
      if(!step.activeCommandId)return !step.receipt&&index>=session.cursor;
      const command=commandRows.find(row=>row.id===step.activeCommandId)?.value;
      return !!command&&command.sessionId===session.id&&command.stepId===step.id&&command.legacyPayload.wordId===step.wordId&&command.intent===step.intent&&safeCommand(command)&&(index>=session.cursor||command.status==='applied');
    });
    const confirmations:DomainWrite[]=[];
    for(const {collection,records} of loaded)for(const row of records){
      if(row.provenance!=='restored-unverified')continue;
      if(collection==='commands'&&!safeCommand(row.value as VocabularyCommand))continue;
      if(collection==='sessions'){
        if(row.id===ACTIVE_ID){const target=sessionRows.find(item=>item.id===(row.value as {sessionId:string}).sessionId);if(!target||!safeSession(target.value))continue;}
        else if(!safeSession(row.value as VocabularySession))continue;
      }
      confirmations.push({collection,id:row.id,revision:row.revision,value:json(row.value)});
    }
    for(let offset=0;offset<confirmations.length;offset+=900){assertCurrent();const result=await repo.confirmRestored({records:confirmations.slice(offset,offset+900),commands:[]});if(result.status==='blocked'||result.status==='conflict')throw Error('恢复记录仍待核对：'+result.reason);}
  }
  function validateBackup(input:unknown):asserts input is WorkflowBackup {
    validateVocabularyWorkflowBackup(input,repo.scopeKey);
    validatePracticeWorkflowBackup(input,questions as Question[],repo.scopeKey,options.practiceQuestionCatalogs);
  }
  async function restoreWorkflow(input:unknown,timezone='UTC'):Promise<VocabularyWorkflowResult> {
    try{assertCurrent();validateBackup(input);const result=await repo.restoreBackup(input);if('reason'in result)return {status:result.status,reason:result.reason};await readProjection(timezone);return {status:result.status==='committed'?'applied':'replayed',added:result.addedRecords,reason:'工作流已合并；旧词卡备份另行恢复，缺失引用不计完成。'};}catch(error){return {status:'blocked',reason:error instanceof Error?error.message:'工作流恢复失败，原数据保留。'};}
  }
  return {repository:repo,readProjection,savePlan,candidateStatus,addCandidate,startGroup,submitRating,nextStep,readCommand:(id:string)=>read<VocabularyCommand>('commands',id),exportWorkflow,restoreWorkflow,close:()=>repo.close()};
}

function receiptFor(command:VocabularyCommand):VocabularyReceipt {
  return {commandId:command.id,legacyEventId:command.legacyPayload.id,legacyPayloadHash:command.payloadHash,occurredAt:command.occurredAt,rawRating:command.rawRating,intent:command.intent,ratingPolicy:POLICY};
}

