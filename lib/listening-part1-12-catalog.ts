import {canonicalHash,canonicalJson} from './domain-command';
import {compiledNaturalAudioCatalog,naturalAudioSelectorDigest,type NaturalAudioPackDescriptor} from './natural-audio-catalog-index';
import type {Question} from './study-model';
import type {ReviewedListeningAudio} from './listening150-catalog';

/** These are recorded attestations, not a substitute for viewing the image,
 * hearing the audio, or verifying the source's rights. This module does not
 * open the image file; the build must independently verify its actual bytes. */
export type Part1TwelveGateRow={qid:string;questionCanonicalSha256:string;textReviewSha256:string;
  image:{url:string;sha256:string;bytes:number;width:number;height:number;reviewSha256:string;
    status:'PASS_EXACT_SELECTED_IMAGE_AND_OPTIONS'}};
export type Part1TwelveGate={schemaVersion:1;sourceVersion:string;sourceManifestSha256:string;sourceQuestionsSha256:string;
  questions:Part1TwelveGateRow[]};
export type Part1TwelveSelector={audioKey:string;materialId:string;segmentId:string;voiceProfileId:string;contextHash:string};
export type Part1TwelveTrack={text:string;label:string;mediaTextSha256:string;mp3Sha256:string;sourceWavSha256:string;audio:Part1TwelveSelector};
export type Part1TwelveUnit={qid:string;materialId:string;contextHash:string;packId:string;body:Part1TwelveTrack};
export type Part1TwelveMedia={schemaVersion:1;contentVersion:string;sourceManifestSha256:string;sourceQuestionsSha256:string;
  distribution:'private-practice';formalAllowed:false;publishAllowed:false;humanListeningPerformed:boolean;
  listeningReviewSha256?:string;questionIds:string[];units:Part1TwelveUnit[]};
export type Part1TwelveInput={questions:Question[];gate:Part1TwelveGate;media:Part1TwelveMedia};
/** Pins must be imported from an independently compiled, reviewed source;
 * never derive them from activation input or an untrusted remote manifest. */
export type Part1TwelvePins={sourceVersion:string;sourceManifestSha256:string;sourceQuestionsSha256:string;
  questionsCanonicalSha256:string;gateCanonicalSha256:string;mediaCanonicalSha256:string;
  base313CanonicalSha256:string;combined325CanonicalSha256:string;questionIdPrefix:string;
  imagePathPrefix:string;imageExtension:'png'|'webp';packDescriptor:NaturalAudioPackDescriptor};

const hash=(value:unknown)=>canonicalHash(canonicalJson(value));
const hex=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const nonempty=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const normalize=(value:string)=>value.trim().replace(/\s+/g,' ');
function reject(code:string):never{throw Error('listening-part1-12-'+code);}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

/** Capture all supplied inputs before the first yield; no partial batch is ever
 * returned. Actual media bytes and human attestations need separate review. */
export function admitPart1TwelvePackageSteps(input:Part1TwelveInput,pins:Part1TwelvePins,base313:readonly Question[]){
 const value=JSON.parse(canonicalJson(input)) as Part1TwelveInput;
 const policy=JSON.parse(canonicalJson(pins)) as Part1TwelvePins;
 const base=JSON.parse(canonicalJson(base313)) as Question[];
 return validateSteps(value,policy,base);
}

function* validateSteps(value:Part1TwelveInput,policy:Part1TwelvePins,base:Question[]){
 yield;
 const index=compiledNaturalAudioCatalog,{questions,gate,media}=value;
 if(!index||!nonempty(policy.sourceVersion)||!nonempty(policy.questionIdPrefix)||
   !/^[a-z0-9][a-z0-9-]{1,63}-$/.test(policy.questionIdPrefix)||
   !/^\/[a-z0-9-]+\/$/.test(policy.imagePathPrefix)||!['png','webp'].includes(policy.imageExtension)||
   ![policy.sourceManifestSha256,policy.sourceQuestionsSha256,policy.questionsCanonicalSha256,
     policy.gateCanonicalSha256,policy.mediaCanonicalSha256,policy.base313CanonicalSha256,
     policy.combined325CanonicalSha256].every(hex)||!policy.packDescriptor)reject('sealed-pins-missing');
 if(hash(questions)!==policy.questionsCanonicalSha256)reject('sealed-questions-changed');
 yield;
 if(hash(gate)!==policy.gateCanonicalSha256)reject('sealed-gate-changed');
 yield;
 if(hash(media)!==policy.mediaCanonicalSha256)reject('sealed-media-changed');
 yield;
 if(!Array.isArray(base)||base.length!==313||hash(base)!==policy.base313CanonicalSha256||
   new Set(base.map(q=>q.id)).size!==313)reject('base-catalog-changed');
 if(!Array.isArray(questions)||questions.length!==12||new Set(questions.map(q=>q.id)).size!==12||
   questions.some(q=>!nonempty(q.id)||!q.id.startsWith(policy.questionIdPrefix)||!/^[a-z0-9][a-z0-9-]{0,95}$/.test(q.id)||base.some(old=>old.id===q.id)))reject('question-count-or-identity');
 if(hash([...base,...questions])!==policy.combined325CanonicalSha256)reject('combined-catalog-changed');
 yield;
 if(gate.schemaVersion!==1||gate.sourceVersion!==policy.sourceVersion||gate.sourceManifestSha256!==policy.sourceManifestSha256||
   gate.sourceQuestionsSha256!==policy.sourceQuestionsSha256||!Array.isArray(gate.questions)||gate.questions.length!==12)reject('gate-source-or-completeness');
 if(media.schemaVersion!==1||media.contentVersion!==policy.sourceVersion||media.sourceManifestSha256!==policy.sourceManifestSha256||
   media.sourceQuestionsSha256!==policy.sourceQuestionsSha256||media.distribution!=='private-practice'||media.formalAllowed!==false||
   media.publishAllowed!==false||typeof media.humanListeningPerformed!=='boolean'||
   (media.humanListeningPerformed?!hex(media.listeningReviewSha256):media.listeningReviewSha256!==undefined)||
   !Array.isArray(media.questionIds)||canonicalJson(media.questionIds)!==canonicalJson(questions.map(q=>q.id))||
   !Array.isArray(media.units)||media.units.length!==12)reject('media-source-or-completeness');
 const descriptor=policy.packDescriptor,packMatches=index.packs.filter(pack=>canonicalJson(pack)===canonicalJson(descriptor));
 if(packMatches.length!==1||index.packs.filter(pack=>pack.packId===descriptor.packId).length!==1)reject('compiled-pack-identity');
 const gates=new Map<string,Part1TwelveGateRow>(),units=new Map<string,Part1TwelveUnit>();
 for(const row of gate.questions){if(gates.has(row.qid))reject('duplicate-clearance');gates.set(row.qid,row);}
 for(const unit of media.units){if(units.has(unit.qid))reject('duplicate-media-unit');units.set(unit.qid,unit);}
 const bindings=new Map<string,ReviewedListeningAudio>(),seenImages=new Set<string>(),seenMaterials=new Set<string>();
 for(const q of questions){
  yield;
  if(q.part!==1||q.groupId!==undefined||!Array.isArray(q.options)||q.options.length!==4||!q.options.every(nonempty)||
    new Set(q.options.map(s=>normalize(s).toLowerCase())).size!==4||!Number.isInteger(q.correctIndex)||q.correctIndex<0||q.correctIndex>3||
    ![q.title,q.prompt,q.explanation,q.evidence,q.skill,q.difficulty,q.transcript,q.translation].every(nonempty))reject('question-shape');
  const gateRow=gates.get(q.id),image=gateRow?.image;
  if(!gateRow||gateRow.questionCanonicalSha256!==hash(q)||!hex(gateRow.textReviewSha256)||!image||
    image.status!=='PASS_EXACT_SELECTED_IMAGE_AND_OPTIONS'||!hex(image.sha256)||!hex(image.reviewSha256)||
    image.url!==q.image||image.url!==policy.imagePathPrefix+image.sha256+'.'+policy.imageExtension||
    !positive(image.bytes)||image.bytes>=25*1024*1024||!positive(image.width)||!positive(image.height)||seenImages.has(image.sha256))reject('image-or-question-clearance');
  seenImages.add(image.sha256);
  const unit=units.get(q.id),track=unit?.body,a=track?.audio;
  const expected=q.options.map((option,i)=>`${'ABCD'[i]}. ${option.trim()}`).join(' ');
  if(!unit||!nonempty(unit.materialId)||unit.materialId.length>200||seenMaterials.has(unit.materialId)||!hex(unit.contextHash)||unit.packId!==descriptor.packId||
    !track||!nonempty(track.text)||track.text.length>12000||!nonempty(track.label)||normalize(track.text)!==normalize(expected)||normalize(q.transcript!)!==normalize(expected)||
    !hex(track.mediaTextSha256)||track.mediaTextSha256!==canonicalHash(track.text)||!hex(track.mp3Sha256)||!hex(track.sourceWavSha256)||
    !a||!hex(a.audioKey)||!nonempty(a.voiceProfileId)||a.voiceProfileId.length>160||a.materialId!==unit.materialId||a.segmentId!=='body'||a.contextHash!==unit.contextHash)reject('audio-selector-or-text');
  seenMaterials.add(unit.materialId);
  const routes=(index.routes[a.audioKey]??[]).filter(row=>index.packs[row[0]]?.packId===unit.packId&&
    row[1]===naturalAudioSelectorDigest(track.mediaTextSha256,a.audioKey,a.materialId,a.segmentId,a.voiceProfileId,a.contextHash)&&
    row[2]===track.mediaTextSha256&&row[3]===track.mp3Sha256&&row[5]===a.contextHash&&row[6]===unit.materialId);
  if(routes.length!==1||index.blockedAssetSha256?.includes(track.mp3Sha256)||index.blockedAssetSha256?.includes(track.sourceWavSha256)||
    index.blockedContexts?.some(row=>row[0]===a.materialId&&row[1]===a.contextHash))reject('compiled-route-or-pair');
  bindings.set(q.id,freeze({body:{...a,text:track.text,label:track.label,naturalOnly:true as const}}));
 }
 if(bindings.size!==12||seenImages.size!==12||seenMaterials.size!==12)reject('final-completeness');
 freeze(questions);
 return Object.freeze({questions:questions as readonly Question[],combined325CanonicalSha256:policy.combined325CanonicalSha256,
  stats:Object.freeze({questions:12,materials:12,bodyTracks:12,imageCount:12}),getAudio:(qid:string)=>bindings.get(qid)??null});
}

export function admitPart1TwelvePackage(input:Part1TwelveInput,pins:Part1TwelvePins,base313:readonly Question[]){
 const steps=admitPart1TwelvePackageSteps(input,pins,base313);let next=steps.next();while(!next.done)next=steps.next();return next.value;
}
export type Part1TwelveAdmission=ReturnType<typeof admitPart1TwelvePackage>;
