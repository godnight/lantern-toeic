import {
  assertFeedbackRequest, assertLocalAsrResult, sameFeedbackBinding,
  type FeedbackBinding, type FeedbackRequest, type LocalAsrResult, type SpeakingFeedback, type TranscriptEdit,
} from './speaking-feedback-contract';
import {createSpeakingFeedback, linkSpeakingRepractice} from './speaking-feedback';

export const IMPORT_LIMITS = Object.freeze({request:32_768,result:262_144,evidence:4_194_304,completion:16_384,audio:12_000_000});
export type OfflineFeedbackRequest = FeedbackRequest & {language:'en';audioByteLength:number};
export type ImportFiles = {request:Blob;result:Blob;evidence:Blob;completion:Blob};
export type CurrentFeedbackSelection = {
  request:OfflineFeedbackRequest; activeBinding:FeedbackBinding; activeRequestId:string|null; audio:Blob;
};
export type ImportContext = {getCurrent:()=>CurrentFeedbackSelection;signal?:AbortSignal};
export type VerifiedFeedbackImport = Readonly<{
  request:OfflineFeedbackRequest;result:LocalAsrResult;feedback:SpeakingFeedback;providerVersion:string;
}>;
export class BrowserFeedbackImportError extends Error {
  readonly code:string;
  constructor(code:string) {super(code);this.name='BrowserFeedbackImportError';this.code=code;}
}
type JsonRecord = Record<string,unknown>;
const verifiedSelections = new WeakMap<object,CurrentFeedbackSelection>();
const verifiedFeedbacks = new WeakMap<object,CurrentFeedbackSelection>();
const requestKeys=['version','requestId','ownerKey','ownerGeneration','recordingId','promptId','audioSha256','modelVersion','processingPolicy','task','referenceText','audioReviewRequired','language','audioByteLength'] as const;
function fail(code:string):never {throw new BrowserFeedbackImportError(code);}
function record(value:unknown):value is JsonRecord {return !!value&&typeof value==='object'&&!Array.isArray(value);}
function finite(value:unknown):value is number {return typeof value==='number'&&Number.isFinite(value);}
function hashString(value:unknown):value is string {return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function abort(signal?:AbortSignal) {if(signal?.aborted)fail('ABORTED');}
function boundedBlob(blob:Blob,maximum:number) {
  if(!(blob instanceof Blob)||!Number.isSafeInteger(blob.size)||blob.size<=0||blob.size>maximum)fail('INPUT_SIZE');
}
async function read(blob:Blob,maximum:number,signal?:AbortSignal):Promise<Uint8Array> {
  boundedBlob(blob,maximum);abort(signal);
  const bytes=new Uint8Array(await blob.arrayBuffer());abort(signal);
  if(bytes.byteLength!==blob.size||bytes.byteLength>maximum)fail('INPUT_SIZE');
  return bytes;
}
async function sha256(bytes:Uint8Array,signal?:AbortSignal):Promise<string> {
  abort(signal);if(!globalThis.crypto?.subtle)fail('WEBCRYPTO_UNAVAILABLE');
  const hash=await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>);abort(signal);
  return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
}
/** Scan structure first: reject duplicate keys, dangerous names, nonfinite numbers and depth/node bombs. */
function strictJson(bytes:Uint8Array):unknown {
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}catch{fail('JSON_INVALID');}
  let index=0,nodes=0;
  const space=()=>{while(/[\x20\t\r\n]/.test(text[index]||'!'))index++;};
  const string=():string=>{
    const start=index;if(text[index++]!=='"')fail('JSON_INVALID');
    while(index<text.length) {
      const char=text[index++];if(char==='"'){try{return JSON.parse(text.slice(start,index));}catch{fail('JSON_INVALID');}}
      if(char==='\\')index++;else if(char.charCodeAt(0)<32)fail('JSON_INVALID');
    }fail('JSON_INVALID');
  };
  const value=(depth:number):void=>{
    if(depth>32||++nodes>100_000)fail('JSON_STRUCTURE_LIMIT');space();
    const char=text[index];
    if(char==='{') {
      index++;space();const keys=new Set<string>();if(text[index]==='}'){index++;return;}
      while(true) {
        space();const key=string();if(keys.has(key)||['__proto__','prototype','constructor'].includes(key))fail('JSON_DUPLICATE_OR_UNSAFE_KEY');keys.add(key);
        space();if(text[index++]!==':')fail('JSON_INVALID');value(depth+1);space();
        const end=text[index++];if(end==='}')return;if(end!==',')fail('JSON_INVALID');
      }
    }
    if(char==='[') {
      index++;space();if(text[index]===']'){index++;return;}
      while(true){value(depth+1);space();const end=text[index++];if(end===']')return;if(end!==',')fail('JSON_INVALID');}
    }
    if(char==='"'){string();return;}
    for(const token of ['true','false','null'])if(text.startsWith(token,index)){index+=token.length;return;}
    const number=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
    if(!number||!Number.isFinite(Number(number[0])))fail('JSON_INVALID');index+=number[0].length;
  };
  value(0);space();if(index!==text.length)fail('JSON_INVALID');
  try{return JSON.parse(text);}catch{fail('JSON_INVALID');}
}
function assertRequest(value:unknown):asserts value is OfflineFeedbackRequest {
  assertFeedbackRequest(value);
  const data=value as unknown as JsonRecord;
  if(Object.keys(data).some(key=>!requestKeys.includes(key as typeof requestKeys[number]))
    ||data.language!=='en'||!Number.isSafeInteger(data.audioByteLength)||Number(data.audioByteLength)<=0||Number(data.audioByteLength)>IMPORT_LIMITS.audio)fail('REQUEST_SCHEMA');
}
function requestEqual(a:OfflineFeedbackRequest,b:OfflineFeedbackRequest):boolean {
  return requestKeys.every(key=>a[key]===b[key]);
}
function snapshot(context:ImportContext):CurrentFeedbackSelection {
  abort(context.signal);const current=context.getCurrent();assertRequest(current.request);
  if(!sameFeedbackBinding(current.request,current.activeBinding)||current.activeRequestId!==current.request.requestId)fail('STALE_RESULT');
  boundedBlob(current.audio,IMPORT_LIMITS.audio);
  if(current.audio.size!==current.request.audioByteLength)fail('AUDIO_BINDING_MISMATCH');
  return {request:{...current.request},activeBinding:{...current.activeBinding},activeRequestId:current.activeRequestId,audio:current.audio};
}
function ensureCurrent(context:ImportContext,initial:CurrentFeedbackSelection):void {
  const current=snapshot(context);
  if(!requestEqual(initial.request,current.request)||!sameFeedbackBinding(initial.activeBinding,current.activeBinding)
    ||initial.activeRequestId!==current.activeRequestId||initial.audio!==current.audio)fail('STALE_RESULT');
}
function deepFreeze<T>(value:T):T {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))deepFreeze(item);}
  return value;
}
/** Selecting the four exact files is explicit; no directory scan or fetching imported URLs. */
export function feedbackFilesFromSelection(files:Iterable<File>):ImportFiles {
  const names:Record<string,keyof ImportFiles>={'request.json':'request','result.json':'result','evidence.json':'evidence','completion.json':'completion'};
  const result:Partial<ImportFiles>={};let count=0;
  for(const file of files){if(!Object.hasOwn(names,file.name))fail('FILE_SELECTION');const key=names[file.name];if(result[key]||++count>4)fail('FILE_SELECTION');boundedBlob(file,IMPORT_LIMITS[key]);result[key]=file;}
  if(count!==4)fail('FILE_SELECTION');return result as ImportFiles;
}
export async function importOfflineSpeakingFeedback(files:ImportFiles,context:ImportContext):Promise<VerifiedFeedbackImport> {
  const initial=snapshot(context);
  // Reject all sizes before any File read. Total JSON bytes are bounded by the four independent limits.
  for(const key of ['request','result','evidence','completion'] as const)boundedBlob(files[key],IMPORT_LIMITS[key]);
  const [requestBytes,resultBytes,evidenceBytes,completionBytes,audioBytes]=await Promise.all([
    read(files.request,IMPORT_LIMITS.request,context.signal),read(files.result,IMPORT_LIMITS.result,context.signal),
    read(files.evidence,IMPORT_LIMITS.evidence,context.signal),read(files.completion,IMPORT_LIMITS.completion,context.signal),
    read(initial.audio,IMPORT_LIMITS.audio,context.signal),
  ]);ensureCurrent(context,initial);
  const request=strictJson(requestBytes),result=strictJson(resultBytes),evidence=strictJson(evidenceBytes),completion=strictJson(completionBytes);
  assertRequest(request);assertLocalAsrResult(result);
  const resultData=result as unknown as JsonRecord;
  if(Object.keys(resultData).some(key=>!['version','requestId','ownerKey','ownerGeneration','recordingId','promptId','audioSha256','modelVersion','processingPolicy','status','transcript','recognizedText','segments','confidence','errorCode'].includes(key))
    ||result.segments.some(segment=>Object.keys(segment).some(key=>!['startSeconds','endSeconds','text','confidence'].includes(key))))fail('RESULT_SCHEMA');
  if(!requestEqual(request,initial.request))fail('BINDING_MISMATCH');
  if(!record(completion)||Object.keys(completion).sort().join(',')!=='evidenceSha256,requestSha256,resultSha256,status,version'
    ||completion.version!==1||!hashString(completion.requestSha256)||!hashString(completion.resultSha256)||!hashString(completion.evidenceSha256)
    ||completion.status!==result.status)fail('COMPLETION_SCHEMA');
  const [requestSha,resultSha,evidenceSha,audioSha]=await Promise.all([
    sha256(requestBytes,context.signal),sha256(resultBytes,context.signal),sha256(evidenceBytes,context.signal),sha256(audioBytes,context.signal),
  ]);ensureCurrent(context,initial);
  if(completion.requestSha256!==requestSha||completion.resultSha256!==resultSha||completion.evidenceSha256!==evidenceSha)fail('HASH_MISMATCH');
  if(audioSha!==initial.request.audioSha256)fail('AUDIO_BINDING_MISMATCH');
  if(!record(evidence)||!['local-wav-v1','local-media-v2'].includes(String(evidence.providerVersion))||evidence.requestSha256!==requestSha
    ||evidence.audioUploaded!==false||evidence.networkAllowed!==false||evidence.localFilesOnly!==true||evidence.expectedTextPrompt!==false
    ||evidence.language!=='en'||!hashString(evidence.scriptSha256)||!finite(evidence.elapsedSeconds)||evidence.elapsedSeconds<0
    ||typeof evidence.inferenceInvoked!=='boolean')fail('EVIDENCE_SCHEMA');
  if(result.confidence!==null||result.segments.some(segment=>segment.confidence!==undefined))fail('CONFIDENCE_MISMATCH');
  if(result.status==='ok') {
    if(!evidence.inferenceInvoked||!record(evidence.model)||evidence.model.modelVersion!==request.modelVersion
      ||!record(evidence.audio)||evidence.audio.audioSha256!==request.audioSha256||evidence.audio.byteLength!==request.audioByteLength
      ||!finite(evidence.audio.durationSeconds)||evidence.audio.durationSeconds<=0||evidence.audio.durationSeconds>240
      ||resultData.recognizedText!==result.transcript||!Array.isArray(evidence.rawSegments)
      ||evidence.rawSegments.length!==result.segments.length)fail('EVIDENCE_MISMATCH');
    const raw=evidence.rawSegments;
    let recognized='';
    for(let i=0;i<result.segments.length;i++) {
      const segment=result.segments[i],part=raw[i];
      if(!record(part)||part.startSeconds!==segment.startSeconds||part.endSeconds!==segment.endSeconds||part.text!==segment.text
        ||segment.endSeconds>evidence.audio.durationSeconds+0.25)fail('TIMESTAMPS_MISMATCH');
      recognized+=segment.text;
    }
    if(recognized!==result.transcript)fail('EVIDENCE_MISMATCH');
  } else if(result.transcript!==''||result.segments.length!==0||!record(evidence.failure)||typeof evidence.failure.code!=='string')fail('FAILURE_SCHEMA');
  const feedback=createSpeakingFeedback(initial.request,result,{activeBinding:initial.activeBinding,activeRequestId:initial.activeRequestId});
  ensureCurrent(context,initial);
  const imported=deepFreeze({request:{...request},result:{...result},feedback,providerVersion:String(evidence.providerVersion)});
  verifiedSelections.set(imported,initial);
  verifiedFeedbacks.set(imported.feedback,initial);
  return imported;
}
/** Explicit user confirmation/correction; never changes original transcript or recording time. */
export function confirmImportedTranscript(imported:VerifiedFeedbackImport,edit:TranscriptEdit,context:ImportContext):SpeakingFeedback {
  const initial=verifiedSelections.get(imported);if(!initial)fail('UNVERIFIED_IMPORT');ensureCurrent(context,initial);
  const feedback=deepFreeze(createSpeakingFeedback(initial.request,imported.result,{activeBinding:initial.activeBinding,activeRequestId:initial.activeRequestId,edit}));
  verifiedFeedbacks.set(feedback,initial);return feedback;
}
/** App supplies the new independently saved recording/result; no synthetic attempts or minutes are created here. */
export function associateImportedRepractice(previous:SpeakingFeedback,next:SpeakingFeedback,context:ImportContext) {
  const selection=verifiedFeedbacks.get(next);
  if(!selection||!verifiedFeedbacks.has(previous))fail('UNVERIFIED_IMPORT');
  ensureCurrent(context,selection);
  if(previous.status!=='ready'||next.status!=='ready'||!previous.edit||!next.edit)fail('REVIEW_REQUIRED');
  const linked=linkSpeakingRepractice(previous,next);ensureCurrent(context,selection);return deepFreeze(linked);
}
