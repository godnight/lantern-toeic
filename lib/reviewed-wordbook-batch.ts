import {canonicalHash, canonicalJson} from './domain-command';

/** Pure intake only: no catalog writes, legacy rebinding, audio generation or fallback. */
export interface IntakeDocument {path:string; utf8:string}
export interface IntakeDocuments {
  ready:IntakeDocument; targets:IntakeDocument; identityMap:IntakeDocument;
  manifest:IntakeDocument; entries:IntakeDocument; review:IntakeDocument;
  /** Optional original review, required only for an explicit inherited-review revision. */
  reviewBasis?:IntakeDocument;
  /** Final encoded-product admission; raw WAV/QUALITY manifests cannot substitute. */
  audioGate?:IntakeDocument; audioPack?:IntakeDocument;
  privateAdmission?:{index:IntakeDocument; delivery:IntakeDocument; quality:IntakeDocument;
    sourceManifest:IntakeDocument; encodedManifest:IntakeDocument};
}
export interface AudioProfileIdentity {
  engine:string; modelRevision:string; profileId:string; voice:string; toolSha256:string;
  speed:number; seed:number|null; prosody:Record<string,unknown>|null;
}
export interface EncodedWordSlot {
  role:'headword'|'example'; memberId:string; contextHash:string;
  displayText:string; spokenText:string; textHash:string; spokenTextHash:string;
  mp3Sha256:string; wavSha256:string; assetKey:string;
  generationInput:Record<string,unknown>; generationInputHash:string;
  actualRenderInput:Record<string,unknown>; actualRenderInputSha256:string;
  provenance:AudioProfileIdentity; provenanceSha256:string;
  technicalStatus:'PASS'; automaticCandidatePass:true; blockingReasons:string[];
  sourceEvidence?:{generationInputHash:string; actualRenderInput:string; actualRenderInputSha256:string;
    sourceSpokenTextSha256:string; engineIdentitySha256:string; pronunciationPlanSha256:string};
}
export interface ProductAudioPair {
  memberId:string; contextHash:string; completeTeachingAudioPair:boolean;
  automaticCandidatePairPass:boolean; privatePracticeEligible:boolean;
  blockingReasons:string[]; roles:{headword:EncodedWordSlot; example:EncodedWordSlot};
  /** Private integration can be authorized before upstream product-activation flags change. */
  encodedPairComplete?:boolean;
}
/** New normalized seam, not a claim that an upstream encoded gate already exists. */
export interface ProductAudioBatchGate {
  schemaVersion:1; gateType:'WORDPAIR_PRODUCT_ADMISSION'; ownerRole:'architecture-audio';
  batchId:string; contentVersion:string; targetManifestSha256:string;
  inputManifestSha256:string; entriesSha256:string; independentTextReviewSha256:string;
  sourceVersionSha256:string; sourceManifestSha256:string; qualityResultSha256:string;
  packId:string; packManifestSha256:string;
  state:'PRIVATE_PRACTICE_READY'; holdMemberIds:string[]; pairs:ProductAudioPair[];
  humanListeningPerformed:boolean; humanAccepted:boolean; publishAllowed:false;
  stage?:'PRIVATE_INTEGRATION_CANDIDATE';
}
export interface WordAudioPackManifest {
  schemaVersion:1; packId:string; sourceVersionSha256:string; totalBytes:number;
  clips:{assetKey:string; mp3Sha256:string; memberId:string; contextHash:string;
    role:'headword'|'example'; provenanceSha256:string; byteLength:number}[];
}
export interface IntakePolicy {
  batchId:string; contentVersion:string;
  /** Pins from the integrator's current independently supplied receipts, never self-trusted JSON. */
  readySha256:string; targetManifestSha256:string; identityMapSha256:string;
  expectedTargetCount:number; requestedMemberIds:readonly string[];
  audioTrust?:{gateSha256:string; sourceVersionSha256:string; sourceManifestSha256:string;
    qualityResultSha256:string; packId:string; packManifestSha256:string; allowedProfiles:readonly AudioProfileIdentity[];
    privateAdmission?:{indexSha256:string; deliverySha256:string; encodedManifestSha256:string}};
}
export interface IntakeInventory {
  admissionIds:readonly string[];
  admittedMembers:readonly {memberId:string; contextHash:string}[];
  legacyBindings:readonly {productWordId:string; memberId:string}[];
  /** Current holds survive a changed batch/hash. No automatic waiver. */
  holds:readonly {memberId?:string; contextHash?:string; mp3Sha256?:string}[];
}
export interface AcceptedWord {
  memberId:string; canonicalKey:string; contextHash:string; contentVersion:string;
  lemma:string; pos:string; meaningZh:string; exampleEn:string; exampleZh:string;
  senseKey:string; pronunciationNotes:string; sourceInfo:Record<string,unknown>;
  candidateAliases:string[]; automaticLegacyRebinding:false;
  audioAdmission:{batchId:string; gateSha256:string; sourceVersionSha256:string;
    sourceManifestSha256:string; packId:string; packManifestSha256:string};
  audio:{headword:EncodedWordSlot; example:EncodedWordSlot};
}
export interface IntakeIssue {code:string; memberId?:string}
export interface IntakeResult {
  status:'accepted'|'pending'|'rejected'; admissionId:string|null;
  accepted:AcceptedWord[]; pending:IntakeIssue[]; errors:IntakeIssue[];
  /** Acceptance is a private integration candidate, never publication or human listening. */
  publishAllowed:false; legacyRecordsModified:false;
}

type Row=Record<string,unknown>;
class Invalid extends Error {constructor(readonly code:string){super(code);}}
const need=(condition:unknown,code:string):void=>{if(!condition)throw new Invalid(code);};
const row=(value:unknown):Row=>{need(!!value&&typeof value==='object'&&!Array.isArray(value),'OBJECT_REQUIRED');return value as Row;};
const list=(value:unknown):unknown[]=>{need(Array.isArray(value),'ARRAY_REQUIRED');return value as unknown[];};
const string=(value:unknown):string=>{need(typeof value==='string'&&value.length>0,'STRING_REQUIRED');return value as string;};
const sha=(value:unknown):string=>{need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'SHA256_REQUIRED');return value as string;};
const normalized=(s:string)=>s.normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
const pathKey=(s:string)=>s.replace(/\\/g,'/');
const equal=(a:unknown,b:unknown,code:string)=>need(a===b,code);
function unique(values:unknown[],key:(v:unknown)=>string,code:string):Map<string,unknown>{
  const out=new Map<string,unknown>();for(const value of values){const id=key(value);need(!out.has(id),code);out.set(id,value);}return out;
}
function strings(value:unknown,code:string):Set<string>{return new Set(unique(list(value),string,code).keys());}
function document(input:IntakeDocument,expectedSha:string,expectedPath?:unknown):unknown{
  need(new TextEncoder().encode(input.utf8).length<=12*1024*1024,'DOCUMENT_TOO_LARGE');
  equal(canonicalHash(input.utf8),sha(expectedSha),'DOCUMENT_SHA_MISMATCH');
  if(expectedPath!==undefined)equal(pathKey(input.path),pathKey(string(expectedPath)),'DOCUMENT_PATH_MISMATCH');
  // Parsing only exact pinned bytes: duplicate-key ambiguity is also rejected rather than silently collapsed.
  rejectDuplicateKeys(input.utf8);
  const parsed:unknown=JSON.parse(input.utf8);canonicalJson(parsed);return parsed;
}
function rejectDuplicateKeys(json:string):void{
  const stack:({kind:'object';keys:Set<string>;key:boolean}|{kind:'array'})[]=[];
  for(let i=0;i<json.length;i++){
    const c=json[i];
    if(c==='"'){
      let end=i+1;for(;end<json.length;end++){if(json[end]==='\\'){end++;continue;}if(json[end]==='"')break;}
      const top=stack.at(-1);if(top?.kind==='object'&&top.key){
        const key=JSON.parse(json.slice(i,end+1)) as string;need(!top.keys.has(key),'DUPLICATE_JSON_KEY');top.keys.add(key);top.key=false;
      }i=end;
    }else if(c==='{')stack.push({kind:'object',keys:new Set(),key:true});
    else if(c==='[')stack.push({kind:'array'});
    else if(c==='}'||c===']')stack.pop();
    else if(c===','){const top=stack.at(-1);if(top?.kind==='object')top.key=true;}
  }
}
const contextFields=['canonicalKey','pos','meaningZh','exampleEn','exampleZh','senseKey','pronunciationNotes'] as const;
const profileFields=['engine','modelRevision','profileId','voice','toolSha256','speed','seed','prosody'] as const;
function checkedEntry(value:unknown,contentVersion:string):Row{
  const entry=row(value),id=string(entry.memberId);
  equal(id,normalized(string(entry.lemma)),'MEMBER_NOT_EXACT_LEMMA');equal(entry.canonicalKey,id,'CANONICAL_ID_MISMATCH');
  equal(entry.contentVersion,contentVersion,'ENTRY_VERSION_MISMATCH');
  const context:Row={};for(const field of contextFields)context[field]=string(entry[field]);
  equal(canonicalHash(canonicalJson(context)),sha(entry.contextHash),'CONTEXT_SHA_MISMATCH');
  row(entry.sourceInfo);string(entry.reviewStatus);string(entry.headwordSpokenText);string(entry.exampleSpokenText);
  equal(entry.textHash,canonicalHash(string(entry.headwordDisplayText??entry.lemma)),'ENTRY_TEXT_SHA_MISMATCH');
  const slots=unique(list(entry.audioSlots),v=>string(row(v).role),'DUPLICATE_TEXT_SLOT');
  equal(slots.size,2,'TEXT_PAIR_REQUIRED');
  for(const role of ['headword','example']){
    const slot=row(slots.get(role));
    const display=role==='headword'?(entry.headwordDisplayText??entry.lemma):entry.exampleEn;
    equal(slot.displayText,string(display),'DISPLAY_MISMATCH');
    equal(slot.spokenText,entry[role==='headword'?'headwordSpokenText':'exampleSpokenText'],'SPOKEN_MISMATCH');
    equal(slot.textHash,canonicalHash(string(display)),'SLOT_TEXT_SHA_MISMATCH');
    equal(slot.contextHash,entry.contextHash,'SLOT_CONTEXT_MISMATCH');
  }return entry;
}
async function mp3Hash(bytes:Uint8Array):Promise<string>{
  need(bytes.byteLength>0&&bytes.byteLength<=16*1024*1024,'MP3_SIZE_INVALID');
  need(!!globalThis.crypto?.subtle,'WEBCRYPTO_UNAVAILABLE');
  // Copy now so callers cannot mutate bytes while digesting them asynchronously.
  const hash=await globalThis.crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
}
function held(inventory:IntakeInventory,id:string,context:string,hashes:string[]=[]):boolean{
  return inventory.holds.some(h=>{
    // A known bad encoded asset remains held when reused under another member/context.
    if(h.mp3Sha256!==undefined&&hashes.includes(h.mp3Sha256))return true;
    return (h.memberId!==undefined||h.contextHash!==undefined)&&(h.memberId===undefined||h.memberId===id)&&
      (h.contextHash===undefined||h.contextHash===context);
  });
}

function privateAdmissionProof(documents:IntakeDocuments,policy:IntakePolicy,gate:Row,requested:Set<string>):void{
  const trust=policy.audioTrust!,pins=trust.privateAdmission,docs=documents.privateAdmission;
  need(!!pins&&!!docs,'PRIVATE_ADMISSION_PROOF_REQUIRED');
  const index=row(document(docs!.index,pins!.indexSha256)),delivery=row(document(docs!.delivery,pins!.deliverySha256));
  const quality=row(document(docs!.quality,trust.qualityResultSha256));
  const source=row(document(docs!.sourceManifest,trust.sourceManifestSha256));
  const encoded=row(document(docs!.encodedManifest,pins!.encodedManifestSha256));
  const pm=row(unique(list(index.batches),v=>string(row(v).batchId),'DUPLICATE_PM_BATCH').get(policy.batchId));
  equal(index.targetManifestSha256,policy.targetManifestSha256,'PM_TARGET_MISMATCH');
  for(const bound of [pm,delivery]){
    equal(bound.batchId,policy.batchId,'PM_BATCH_MISMATCH');equal(bound.contentVersion,policy.contentVersion,'PM_VERSION_MISMATCH');
    equal(bound.targetManifestSha256,policy.targetManifestSha256,'PM_TARGET_MISMATCH');
    equal(bound.audioGateSha256,trust.qualityResultSha256,'PM_GATE_MISMATCH');
    equal(bound.encodedManifestSha256,pins!.encodedManifestSha256,'PM_ENCODED_MANIFEST_MISMATCH');
  }
  equal(pm.audioDeliverySha256,pins!.deliverySha256,'PM_DELIVERY_MISMATCH');
  equal(delivery.candidateOnly,true,'PRIVATE_CANDIDATE_ONLY_REQUIRED');equal(delivery.publishAllowed,false,'PUBLICATION_NOT_AUTHORIZED');
  for(const bound of [quality,encoded,delivery]){
    equal(bound.sourceManifestSha256,trust.sourceManifestSha256,'PRIVATE_SOURCE_MANIFEST_MISMATCH');
    equal(bound.sourceVersionSha256,trust.sourceVersionSha256,'PRIVATE_SOURCE_VERSION_MISMATCH');
  }
  equal(source.sourceVersionSha256,trust.sourceVersionSha256,'PRIVATE_SOURCE_VERSION_MISMATCH');
  const cleared=strings(pm.acceptedMemberIds,'DUPLICATE_PM_MEMBER');
  const holds=new Set([...strings(pm.holdMemberIds,'DUPLICATE_PM_HOLD'),...strings(delivery.holdMemberIds,'DUPLICATE_DELIVERY_HOLD'),...strings(quality.holdMemberIds,'DUPLICATE_QUALITY_HOLD')]);
  const delivered=unique(list(delivery.acceptedPairs),v=>string(row(v).memberId),'DUPLICATE_DELIVERED_MEMBER');
  const passed=unique(list(quality.pairs),v=>string(row(v).memberId),'DUPLICATE_QUALITY_MEMBER');
  const normalizedPairs=unique(list(gate.pairs),v=>string(row(v).memberId),'DUPLICATE_AUDIO_MEMBER');
  const sourceItems=unique(list(source.items),v=>string(row(row(v).job).id),'DUPLICATE_SOURCE_ITEM');
  for(const id of requested){
    need(cleared.has(id)&&!holds.has(id),'PRIVATE_MEMBER_NOT_ADMITTED');
    const pair=row(delivered.get(id)),qa=row(passed.get(id)),normalizedPair=row(normalizedPairs.get(id));
    equal(pair.contextHash,normalizedPair.contextHash,'PRIVATE_CONTEXT_MISMATCH');equal(qa.contextHash,pair.contextHash,'PRIVATE_CONTEXT_MISMATCH');
    equal(pair.entriesSha256,gate.entriesSha256,'PRIVATE_ENTRIES_MISMATCH');equal(pair.textReviewSha256,gate.independentTextReviewSha256,'PRIVATE_REVIEW_MISMATCH');
    equal(pair.textReviewStatus,'PASS','PRIVATE_REVIEW_NOT_PASS');equal(pair.textReviewContextHash,pair.contextHash,'PRIVATE_REVIEW_CONTEXT_MISMATCH');
    equal(qa.technicalPairComplete,true,'PRIVATE_TECHNICAL_PAIR_REQUIRED');equal(qa.automaticCandidatePairPass,true,'PRIVATE_AUTOMATIC_PAIR_REQUIRED');
    // Preserve the raw product-activation fact; never silently promote its false value.
    equal(normalizedPair.completeTeachingAudioPair,qa.completeTeachingAudioPair,'RAW_PRODUCT_PAIR_FLAG_CHANGED');
    equal(normalizedPair.encodedPairComplete,true,'ENCODED_PAIR_REQUIRED');
    for(const role of ['headword','example']){
      const slot=row(row(pair.slots)[role]),qaSlot=row(row(qa.roles)[role]),normalizedSlot=row(row(normalizedPair.roles)[role]);
      const item=row(sourceItems.get(string(slot.itemId))),job=row(item.job),evidence=row(normalizedSlot.sourceEvidence);
      equal(qaSlot.itemId,slot.itemId,'PRIVATE_ITEM_MISMATCH');equal(qaSlot.technicalStatus,'PASS','PRIVATE_SLOT_TECHNICAL_REQUIRED');
      equal(qaSlot.automaticCandidatePass,true,'PRIVATE_SLOT_AUTOMATIC_REQUIRED');equal(list(qaSlot.blockingReasons).length,0,'PRIVATE_SLOT_HOLD');
      equal(list(slot.sourceHoldReasons).length,0,'PRIVATE_SOURCE_HOLD');
      for(const field of ['memberId','role','contextHash','displayText','textHash'])equal(slot[field],normalizedSlot[field],'PRIVATE_SLOT_BINDING_MISMATCH');
      equal(job.memberId,id,'PRIVATE_JOB_MEMBER_MISMATCH');equal(job.role,role,'PRIVATE_JOB_ROLE_MISMATCH');equal(job.contextHash,pair.contextHash,'PRIVATE_JOB_CONTEXT_MISMATCH');
      equal(slot.sourceSpokenText,normalizedSlot.spokenText,'PRIVATE_SPOKEN_MISMATCH');equal(slot.sourceSpokenTextSha256,canonicalHash(string(slot.sourceSpokenText)),'PRIVATE_SPOKEN_SHA_MISMATCH');
      equal(slot.actualRenderInput,item.actualRenderInput,'PRIVATE_RENDER_MISMATCH');
      equal(slot.actualRenderInputSha256,canonicalHash(string(slot.actualRenderInput)),'PRIVATE_RENDER_SHA_MISMATCH');
      equal(evidence.actualRenderInput,slot.actualRenderInput,'SOURCE_EVIDENCE_RENDER_MISMATCH');
      equal(evidence.actualRenderInputSha256,slot.actualRenderInputSha256,'SOURCE_EVIDENCE_RENDER_SHA_MISMATCH');
      equal(evidence.sourceSpokenTextSha256,slot.sourceSpokenTextSha256,'SOURCE_EVIDENCE_SPOKEN_SHA_MISMATCH');
      equal(evidence.generationInputHash,sha(item.generationInputHash),'SOURCE_EVIDENCE_GENERATION_MISMATCH');
      equal(evidence.pronunciationPlanSha256,slot.pronunciationPlanSha256,'SOURCE_EVIDENCE_PRONUNCIATION_MISMATCH');
      equal(evidence.engineIdentitySha256,canonicalHash(canonicalJson(slot.engineIdentity)),'SOURCE_EVIDENCE_ENGINE_MISMATCH');
      equal(canonicalJson(slot.engineIdentity),canonicalJson(item.engineIdentity),'PRIVATE_ENGINE_IDENTITY_MISMATCH');
      equal(canonicalJson(slot.profile),canonicalJson(item.profile),'PRIVATE_SOURCE_PROFILE_MISMATCH');
      equal(row(normalizedSlot.actualRenderInput).renderText,slot.actualRenderInput,'PRIVATE_NORMALIZED_RENDER_TEXT_MISMATCH');
      equal(row(normalizedSlot.generationInput).renderText,slot.actualRenderInput,'PRIVATE_NORMALIZED_GENERATION_TEXT_MISMATCH');
      const provenance=row(normalizedSlot.provenance),profile=row(slot.profile),engine=row(slot.engineIdentity);
      const cache=row(item.cachePayload),request=row(cache.effectiveRequest);
      equal(canonicalJson(cache.engineIdentity),canonicalJson(slot.engineIdentity),'PRIVATE_CACHE_ENGINE_MISMATCH');
      for(const field of ['speed','seed','pauseMs'])equal(request[field],profile[field],'PRIVATE_CACHE_PROFILE_MISMATCH');
      const turn=row(list(request.turns)[0]);equal(list(request.turns).length,1,'PRIVATE_SINGLE_SLOT_TURN_REQUIRED');
      equal(turn.text,slot.actualRenderInput,'PRIVATE_CACHE_RENDER_MISMATCH');equal(turn.voice,slot.voice,'PRIVATE_CACHE_VOICE_MISMATCH');
      for(const [field,expected] of Object.entries({engine:slot.engine,modelRevision:engine.modelRevision,toolSha256:engine.adapterSha256,
        profileId:profile.id,voice:slot.voice,speed:profile.speed,seed:profile.seed}))equal(provenance[field],expected,'PRIVATE_NORMALIZED_PROFILE_MISMATCH');
      equal(canonicalJson(provenance.prosody),canonicalJson({pauseMs:profile.pauseMs}),'PRIVATE_NORMALIZED_PROSODY_MISMATCH');
      const master=row(slot.master),mp3=row(slot.encoded);equal(master.sha256,row(item.audio).sha256,'PRIVATE_MASTER_MISMATCH');
      equal(qaSlot.wavSha256,master.sha256,'PRIVATE_QA_MASTER_MISMATCH');equal(mp3.masterWavSha256,master.sha256,'PRIVATE_MP3_MASTER_MISMATCH');
      equal(normalizedSlot.wavSha256,master.sha256,'PRIVATE_NORMALIZED_MASTER_MISMATCH');equal(normalizedSlot.mp3Sha256,mp3.sha256,'PRIVATE_NORMALIZED_MP3_MISMATCH');
      equal(mp3.format,'MP3','PRIVATE_MP3_FORMAT_REQUIRED');for(const flag of ['fullDecodeValidated','finiteSamples','sameFrameCountAsMaster'])equal(mp3[flag],true,'PRIVATE_MP3_TECHNICAL_REQUIRED');
    }
  }
}


/** Explicit compatibility for the two pinned independent text-review schemas. */
function checkedIndependentReview(review:Row,priorBasis=false):void{
  equal(review.schemaVersion,1,'REVIEW_SCHEMA_UNSUPPORTED');
  if(review.status==='PASS'){
    need(typeof review.reviewer==='string'&&review.reviewer.includes('independent'),'INDEPENDENT_REVIEW_REQUIRED');
    const integrity=row(review.sourceIntegrity);equal(integrity.unchanged,true,'REVIEW_SOURCE_DRIFT');
    return;
  }
  need(review.status==='PASS_INDEPENDENT_AI_TEXT'||(priorBasis&&review.status==='REVIEWED_WITH_TEXT_HOLDS'),'REVIEW_STATUS_UNSUPPORTED');
  const reviewer=row(review.reviewer);
  equal(canonicalJson(Object.keys(reviewer).sort()),canonicalJson(['authorOfReviewedEntries','id','independent','type']),'INDEPENDENT_REVIEW_REQUIRED');
  string(reviewer.id);equal(reviewer.type,'independent_ai','INDEPENDENT_REVIEW_REQUIRED');
  equal(reviewer.independent,true,'INDEPENDENT_REVIEW_REQUIRED');equal(reviewer.authorOfReviewedEntries,false,'INDEPENDENT_REVIEW_REQUIRED');
  // The alternate schema omits sourceIntegrity; an explicit false/conflicting field cannot be waived.
  need(review.sourceIntegrity===undefined,'REVIEW_SOURCE_INTEGRITY_CONFLICT');
  equal(review.inputUnchanged,true,'REVIEW_SOURCE_DRIFT');equal(review.sourceWrites,false,'REVIEW_SOURCE_DRIFT');
  equal(review.humanReview,false,'REVIEW_SCHEMA_UNSUPPORTED');equal(review.productQa,false,'REVIEW_SCHEMA_UNSUPPORTED');
}
function checkedReviewFindings(reviewed:Row,entry:Row):void{
  equal(reviewed.status,'PASS','TEXT_REVIEW_NOT_PASS');
  for(const value of list(reviewed.findings)){
    const finding=row(value);
    equal(canonicalJson(Object.keys(finding).sort()),canonicalJson(['code','field','issue','original','severity','suggestion']),'TEXT_REVIEW_FINDINGS');
    need(finding.code==='ZH_STYLE_OPTIONAL'&&finding.severity==='NOTE'&&finding.field==='exampleZh','TEXT_REVIEW_FINDINGS');
    equal(finding.original,entry.exampleZh,'TEXT_REVIEW_FINDINGS');string(finding.issue);string(finding.suggestion);
  }
}
function inheritedReviewBasis(documents:IntakeDocuments,review:Row,policy:IntakePolicy):{entries:Map<string,unknown>;holds:Set<string>}|null{
  const entries=list(review.perEntry);
  const inherited=entries.some(value=>row(value).inheritedFromPriorPass!==undefined||row(value).newSemanticReview!==undefined);
  const declared=review.metadataRebindingException!==undefined||review.reviewBasisPath!==undefined||review.reviewBasisSha256!==undefined;
  if(!inherited&&!declared)return null;
  equal(review.status,'PASS_INDEPENDENT_AI_TEXT','REVIEW_INHERITANCE_SCHEMA_UNSUPPORTED');
  need(inherited&&declared&&!!documents.reviewBasis,'REVIEW_BASIS_REQUIRED');
  string(review.metadataRebindingException);
  const basis=row(document(documents.reviewBasis!,sha(review.reviewBasisSha256),string(review.reviewBasisPath)));
  checkedIndependentReview(basis,true);
  equal(basis.targetManifestSha256,policy.targetManifestSha256,'REVIEW_BASIS_TARGET_MISMATCH');
  need(string(basis.batchId)!==policy.batchId&&string(basis.contentVersion)!==policy.contentVersion,'REVIEW_BASIS_VERSION_MISMATCH');
  for(const value of entries){const entry=row(value);need(typeof entry.inheritedFromPriorPass==='boolean'&&typeof entry.newSemanticReview==='boolean'&&entry.inheritedFromPriorPass!==entry.newSemanticReview,'REVIEW_INHERITANCE_DECLARATION_REQUIRED');}
  return {entries:unique(list(basis.perEntry),value=>string(row(value).memberId),'DUPLICATE_REVIEW_BASIS_MEMBER'),holds:strings(basis.textHoldIds,'DUPLICATE_REVIEW_BASIS_HOLD')};
}

/** Caller supplies exact MP3 bytes by assetKey. This function never fetches or modifies them. */
export async function validateReviewedWordbookBatch(
  documents:IntakeDocuments,policy:IntakePolicy,inventory:IntakeInventory,
  encodedAssets:ReadonlyMap<string,Uint8Array>=new Map(),
):Promise<IntakeResult>{
  const result:IntakeResult={status:'rejected',admissionId:null,accepted:[],pending:[],errors:[],publishAllowed:false,legacyRecordsModified:false};
  try{
    // Copy policy/inventory synchronously before the first await (pure caller-owned state).
    policy=JSON.parse(canonicalJson(policy)) as IntakePolicy;
    inventory=JSON.parse(canonicalJson(inventory)) as IntakeInventory;
    const ready=row(document(documents.ready,policy.readySha256));
    const targets=list(document(documents.targets,policy.targetManifestSha256));
    const identities=list(document(documents.identityMap,policy.identityMapSha256));
    equal(ready.targetManifestSha256,policy.targetManifestSha256,'READY_TARGET_MISMATCH');
    const targetIds=unique(targets,v=>string(row(v).lemma),'DUPLICATE_TARGET');
    equal(targetIds.size,policy.expectedTargetCount,'TARGET_COUNT_MISMATCH');
    for(const id of targetIds.keys())equal(id,normalized(id),'TARGET_NOT_CANONICAL');
    const identityMap=unique(identities,v=>string(row(v).memberId),'DUPLICATE_IDENTITY');
    equal(identityMap.size,targetIds.size,'IDENTITY_COUNT_MISMATCH');
    const aliasOwners=new Map<string,string>();
    for(const [id,value] of identityMap){
      const identity=row(value);need(targetIds.has(id),'IDENTITY_NOT_TARGET');equal(identity.canonicalKey,id,'IDENTITY_CANONICAL_MISMATCH');
      equal(identity.aliasNotAutomaticAudioMatch,true,'ALIAS_MUST_NOT_REBIND');
      // Multiple source evidence rows for the same member/old ID are legitimate (e.g. accountant).
      const aliases=new Set(list(identity.productAliases).map(a=>string(row(a).productWordId)));
      for(const alias of aliases){need(!aliasOwners.has(alias)||aliasOwners.get(alias)===id,'AMBIGUOUS_LEGACY_ALIAS');aliasOwners.set(alias,id);}
    }
    for(const binding of inventory.legacyBindings){need(!aliasOwners.has(binding.productWordId)||aliasOwners.get(binding.productWordId)===binding.memberId,'EXISTING_ALIAS_CONFLICT');}
    const batches=unique(list(ready.batches),v=>string(row(v).batchId),'DUPLICATE_BATCH');
    need(batches.has(policy.batchId),'BATCH_NOT_CURRENT_READY');const batch=row(batches.get(policy.batchId));
    equal(batch.contentVersion,policy.contentVersion,'BATCH_VERSION_MISMATCH');equal(batch.targetManifestSha256,policy.targetManifestSha256,'BATCH_TARGET_MISMATCH');
    const manifest=row(document(documents.manifest,sha(batch.inputManifestSha256),batch.inputManifestPath));
    const entries=list(document(documents.entries,sha(batch.entriesSha256),batch.entriesPath));
    const review=row(document(documents.review,sha(batch.independentTextReviewSha256),batch.independentTextReviewPath));
    for(const bound of [manifest,review]){
      equal(bound.batchId,policy.batchId,'SOURCE_BATCH_MISMATCH');equal(bound.contentVersion,policy.contentVersion,'SOURCE_VERSION_MISMATCH');
      equal(bound.targetManifestSha256,policy.targetManifestSha256,'SOURCE_TARGET_MISMATCH');equal(bound.entriesSha256,batch.entriesSha256,'SOURCE_ENTRIES_MISMATCH');
      equal(pathKey(string(bound.entriesPath)),pathKey(documents.entries.path),'SOURCE_ENTRIES_PATH_MISMATCH');
    }
    equal(review.inputManifestSha256,batch.inputManifestSha256,'REVIEW_MANIFEST_MISMATCH');
    checkedIndependentReview(review);
    const inheritedBasis=inheritedReviewBasis(documents,review,policy);
    const eligible=strings(batch.eligibleMemberIds,'DUPLICATE_ELIGIBLE_MEMBER');
    const requested=strings([...policy.requestedMemberIds],'DUPLICATE_REQUESTED_MEMBER');need(requested.size>0,'EMPTY_REQUEST');
    const textHolds=new Set([...strings(batch.textHoldIds,'DUPLICATE_TEXT_HOLD'),...strings(review.textHoldIds,'DUPLICATE_REVIEW_HOLD')]);
    const contexts=unique(list(batch.exactContexts),v=>string(row(v).memberId),'DUPLICATE_CLEARANCE_CONTEXT');
    const reviewed=unique(list(review.perEntry),v=>string(row(v).memberId),'DUPLICATE_REVIEW_MEMBER');
    const textEntries=unique(entries,v=>string(row(v).memberId),'DUPLICATE_ENTRY_MEMBER');
    const manifestIds=strings(manifest.memberIds,'DUPLICATE_MANIFEST_MEMBER');
    equal(textEntries.size,manifestIds.size,'MANIFEST_MEMBER_COUNT_MISMATCH');
    for(const id of textEntries.keys())need(manifestIds.has(id),'MANIFEST_MEMBER_MISMATCH');
    const selected:Row[]=[];
    for(const id of requested){
      need(targetIds.has(id)&&identityMap.has(id),'MEMBER_NOT_TARGET');need(eligible.has(id),'MEMBER_NOT_TEXT_CLEARED');
      need(!textHolds.has(id),'TEXT_HOLD');const entry=checkedEntry(textEntries.get(id),policy.contentVersion);
      const reviewedEntry=row(reviewed.get(id));checkedReviewFindings(reviewedEntry,entry);
      if(inheritedBasis&&reviewedEntry.inheritedFromPriorPass===true){
        const prior=row(inheritedBasis.entries.get(id));need(!inheritedBasis.holds.has(id),'REVIEW_BASIS_MEMBER_HELD');
        checkedReviewFindings(prior,entry);equal(prior.contextHash,entry.contextHash,'REVIEW_BASIS_CONTEXT_MISMATCH');
      }
      equal(reviewedEntry.contextHash,entry.contextHash,'REVIEW_CONTEXT_MISMATCH');
      equal(row(contexts.get(id)).contextHash,entry.contextHash,'CLEARANCE_CONTEXT_MISMATCH');
      need(!inventory.admittedMembers.some(v=>v.memberId===id),'MEMBER_ALREADY_ADMITTED');
      need(!held(inventory,id,string(entry.contextHash)),'CURRENT_HOLD');selected.push(entry);
    }
    // The current v3 WAV + automatic screening documents intentionally stop here.
    if(!documents.audioGate||!policy.audioTrust){
      result.status='pending';result.pending=[...requested].map(memberId=>({code:'ENCODED_PRODUCT_AUDIO_GATE_MISSING',memberId}));return result;
    }
    const trust=policy.audioTrust,gate=row(document(documents.audioGate,trust.gateSha256));
    equal(gate.schemaVersion,1,'AUDIO_GATE_SCHEMA');equal(gate.gateType,'WORDPAIR_PRODUCT_ADMISSION','AUDIO_GATE_TYPE');
    equal(gate.ownerRole,'architecture-audio','AUDIO_GATE_OWNER');equal(gate.state,'PRIVATE_PRACTICE_READY','AUDIO_GATE_STATE');
    for(const [field,expected] of Object.entries({batchId:policy.batchId,contentVersion:policy.contentVersion,targetManifestSha256:policy.targetManifestSha256,
      inputManifestSha256:batch.inputManifestSha256,entriesSha256:batch.entriesSha256,independentTextReviewSha256:batch.independentTextReviewSha256,
      sourceVersionSha256:sha(trust.sourceVersionSha256),sourceManifestSha256:sha(trust.sourceManifestSha256),qualityResultSha256:sha(trust.qualityResultSha256),
      packId:string(trust.packId),packManifestSha256:sha(trust.packManifestSha256)}))equal(gate[field],expected,'AUDIO_GATE_BINDING_MISMATCH');
    equal(gate.publishAllowed,false,'PUBLICATION_NOT_AUTHORIZED');
    need(typeof gate.humanAccepted==='boolean'&&typeof gate.humanListeningPerformed==='boolean','HUMAN_STATUS_REQUIRED');
    need(gate.humanAccepted!==true||gate.humanListeningPerformed===true,'HUMAN_STATUS_INCONSISTENT');
    const audioHolds=strings(gate.holdMemberIds,'DUPLICATE_AUDIO_HOLD');
    const pairs=unique(list(gate.pairs),v=>string(row(v).memberId),'DUPLICATE_AUDIO_MEMBER');
    const privateCandidate=gate.stage==='PRIVATE_INTEGRATION_CANDIDATE';
    if(privateCandidate)privateAdmissionProof(documents,policy,gate,requested);
    if(!documents.audioPack){result.status='pending';result.pending=[...requested].map(memberId=>({code:'PACK_MANIFEST_MISSING',memberId}));return result;}
    const pack=row(document(documents.audioPack,trust.packManifestSha256));
    equal(pack.schemaVersion,1,'PACK_SCHEMA_MISMATCH');equal(pack.packId,trust.packId,'PACK_ID_MISMATCH');
    equal(pack.sourceVersionSha256,trust.sourceVersionSha256,'PACK_SOURCE_VERSION_MISMATCH');
    const packClips=unique(list(pack.clips),v=>string(row(v).assetKey),'DUPLICATE_PACK_ASSET');
    // Existing runtime single-pack constraints: the caller must route independent/lazy batches.
    need(packClips.size<=4096,'PACK_CLIP_LIMIT');
    let totalBytes=0;for(const clip of packClips.values()){
      const length=row(clip).byteLength;need(typeof length==='number'&&Number.isSafeInteger(length)&&length>0&&length<=16*1024*1024,'PACK_CLIP_SIZE_INVALID');totalBytes+=length as number;
    }
    equal(pack.totalBytes,totalBytes,'PACK_BYTE_TOTAL_MISMATCH');need(totalBytes<=64*1024*1024,'PACK_BYTE_LIMIT');
    const admissionId=canonicalHash(canonicalJson({batchId:policy.batchId,contentVersion:policy.contentVersion,
      target:policy.targetManifestSha256,entries:batch.entriesSha256,review:batch.independentTextReviewSha256,
      gate:trust.gateSha256,sourceVersion:trust.sourceVersionSha256,members:[...requested].sort()}));
    result.admissionId=admissionId;need(!inventory.admissionIds.includes(admissionId),'ADMISSION_REPLAY');
    // Snapshot all selected byte arrays before any digest yields; do not retain caller references.
    const assets=new Map<string,Uint8Array>();for(const entry of selected){
      const pair=pairs.get(string(entry.memberId));if(!pair)continue;
      const roles=row(row(pair).roles);for(const role of ['headword','example']){
        const slot=roles[role];if(!slot)continue;const key=string(row(slot).assetKey),bytes=encodedAssets.get(key);
        if(bytes){need(bytes instanceof Uint8Array,'MP3_BYTES_REQUIRED');
          need(packClips.has(key),'ASSET_NOT_IN_PACK');equal(bytes.byteLength,row(packClips.get(key)).byteLength,'MP3_BYTE_LENGTH_MISMATCH');
          assets.set(key,new Uint8Array(bytes));}
      }
    }
    const admitted:AcceptedWord[]=[];
    for(const entry of selected){
      const id=string(entry.memberId),context=string(entry.contextHash),raw=pairs.get(id);
      if(!raw){result.pending.push({code:'AUDIO_PAIR_MISSING',memberId:id});continue;}
      const pair=row(raw);equal(pair.contextHash,context,'AUDIO_CONTEXT_MISMATCH');
      if(audioHolds.has(id)||(!privateCandidate&&pair.completeTeachingAudioPair!==true)||pair.automaticCandidatePairPass!==true||pair.privatePracticeEligible!==true||list(pair.blockingReasons).length){
        result.pending.push({code:'AUDIO_PAIR_NOT_ADMITTED',memberId:id});continue;
      }
      const roles=row(pair.roles);equal(Object.keys(roles).sort().join(','),'example,headword','EXACT_TWO_AUDIO_ROLES_REQUIRED');
      const checked:Record<string,EncodedWordSlot>={};let missing=false;
      for(const role of ['headword','example'] as const){
        const slot=row(roles[role]);equal(slot.role,role,'AUDIO_ROLE_MISMATCH');equal(slot.memberId,id,'AUDIO_MEMBER_MISMATCH');equal(slot.contextHash,context,'AUDIO_SLOT_CONTEXT_MISMATCH');
        const textSlot=row(list(entry.audioSlots).find(v=>row(v).role===role));
        equal(slot.displayText,textSlot.displayText,'AUDIO_DISPLAY_MISMATCH');equal(slot.spokenText,textSlot.spokenText,'AUDIO_SPOKEN_MISMATCH');
        equal(slot.textHash,textSlot.textHash,'AUDIO_TEXT_SHA_MISMATCH');equal(slot.spokenTextHash,canonicalHash(string(textSlot.spokenText)),'AUDIO_SPOKEN_SHA_MISMATCH');
        equal(slot.technicalStatus,'PASS','AUDIO_TECHNICAL_NOT_PASS');equal(slot.automaticCandidatePass,true,'AUDIO_AUTOMATIC_NOT_PASS');
        equal(list(slot.blockingReasons).length,0,'AUDIO_SLOT_HOLD');
        sha(slot.mp3Sha256);sha(slot.wavSha256);sha(slot.generationInputHash);
        const provenance=row(slot.provenance);for(const field of ['engine','modelRevision','profileId','voice'])string(provenance[field]);
        sha(provenance.toolSha256);need(typeof provenance.speed==='number'&&Number.isFinite(provenance.speed)&&provenance.speed>0,'SPEED_REQUIRED');
        need(provenance.seed===null||Number.isSafeInteger(provenance.seed),'SEED_REQUIRED');
        if(provenance.prosody!==null)row(provenance.prosody);
        equal(slot.provenanceSha256,canonicalHash(canonicalJson(provenance)),'PROVENANCE_SHA_MISMATCH');
        need(trust.allowedProfiles.some(p=>canonicalJson(p)===canonicalJson(provenance)),'UNAPPROVED_AUDIO_PROFILE');
        const render=row(slot.actualRenderInput);equal(slot.actualRenderInputSha256,canonicalHash(canonicalJson(render)),'RENDER_SHA_MISMATCH');
        const generation=row(slot.generationInput);equal(slot.generationInputHash,canonicalHash(canonicalJson(generation)),'GENERATION_SHA_MISMATCH');
        equal(generation.sourceVersionSha256,trust.sourceVersionSha256,'GENERATION_SOURCE_VERSION_MISMATCH');
        equal(generation.spokenText,slot.spokenText,'GENERATION_SPOKEN_MISMATCH');equal(generation.role,role,'GENERATION_ROLE_MISMATCH');
        equal(generation.memberId,id,'GENERATION_MEMBER_MISMATCH');equal(generation.contextHash,context,'GENERATION_CONTEXT_MISMATCH');
        for(const field of profileFields)equal(canonicalJson(generation[field]),canonicalJson(provenance[field]),'GENERATION_PROFILE_MISMATCH');
        for(const field of profileFields)equal(canonicalJson(render[field]),canonicalJson(provenance[field]),'RENDER_PROFILE_MISMATCH');
        equal(render.spokenText,slot.spokenText,'RENDER_SPOKEN_MISMATCH');equal(render.role,role,'RENDER_ROLE_MISMATCH');
        equal(render.memberId,id,'RENDER_MEMBER_MISMATCH');equal(render.contextHash,context,'RENDER_CONTEXT_MISMATCH');
        const assetKey=string(slot.assetKey);need(/^audio\/natural\/[a-zA-Z0-9_/-]+\.mp3$/.test(assetKey)&&!assetKey.includes('..'),'LOCAL_MP3_KEY_REQUIRED');
        need(packClips.has(assetKey),'ASSET_NOT_IN_PACK');const packed=row(packClips.get(assetKey));
        for(const field of ['mp3Sha256','memberId','contextHash','role','provenanceSha256'])equal(packed[field],slot[field],'PACK_CLIP_BINDING_MISMATCH');
        const bytes=assets.get(assetKey);if(!bytes){missing=true;continue;}
        equal(await mp3Hash(bytes),slot.mp3Sha256,'MP3_SHA_MISMATCH');checked[role]=slot as unknown as EncodedWordSlot;
      }
      equal(canonicalJson(row(roles.headword).provenance),canonicalJson(row(roles.example).provenance),'PAIR_PROFILE_MISMATCH');
      need(!held(inventory,id,context,[string(row(roles.headword).mp3Sha256),string(row(roles.example).mp3Sha256)]),'CURRENT_AUDIO_HASH_HOLD');
      if(missing){result.pending.push({code:'MP3_BYTES_MISSING',memberId:id});continue;}
      const aliases=[...new Set(list(row(identityMap.get(id)).productAliases).map(v=>string(row(v).productWordId)))];
      admitted.push({memberId:id,canonicalKey:id,contextHash:context,contentVersion:policy.contentVersion,
        lemma:string(entry.lemma),pos:string(entry.pos),meaningZh:string(entry.meaningZh),exampleEn:string(entry.exampleEn),exampleZh:string(entry.exampleZh),
        senseKey:string(entry.senseKey),pronunciationNotes:string(entry.pronunciationNotes),sourceInfo:row(entry.sourceInfo),
        candidateAliases:aliases,automaticLegacyRebinding:false,
        audioAdmission:{batchId:policy.batchId,gateSha256:trust.gateSha256,sourceVersionSha256:trust.sourceVersionSha256,
          sourceManifestSha256:trust.sourceManifestSha256,packId:trust.packId,packManifestSha256:trust.packManifestSha256},
        audio:{headword:checked.headword,example:checked.example}});
    }
    result.accepted=admitted;result.status=result.pending.length?'pending':'accepted';return result;
  }catch(error){
    result.accepted=[];result.pending=[];result.status='rejected';
    result.errors=[{code:error instanceof Invalid?error.code:'MALFORMED_INPUT'}];return result;
  }
}
