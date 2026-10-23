import {canonicalHash,canonicalJson} from './domain-command';
import {compiledNaturalAudioCatalog,naturalAudioSelectorDigest,type NaturalAudioPackDescriptor} from './natural-audio-catalog-index';
import type {Question} from './study-model';

export type Listening150Selector={audioKey:string;materialId:string;segmentId:string;voiceProfileId:string;contextHash:string};
export type Listening150Track={text:string;label:string;audio:Listening150Selector;mediaTextSha256:string;mp3Sha256:string;sourceWavSha256:string};
export type Listening150Unit={unitId:string;part:number;materialId:string;questionIds:string[];contextHash:string;packId:string;
 contentVersion:string;sourceQuestionsSha256:string;privatePracticeEligible:true;formalAllowed:false;publishAllowed:false;
 humanListeningPerformed:false;validatedLocale:null;printedOptionsOnly:boolean;body:Listening150Track;
 questionTracks:(Listening150Track&{qid:string})[]};
export type Listening150GateRow={qid:string;part:number;materialId:string;contextHash:string;sourceVersion:string;
 runtimeQuestionCanonicalSha256:string;questionCanonicalSha256:string;materialCanonicalSha256:string;
 textReviewStatus:'PASS';textReviewSha256:string;runtimeCandidateOnly:true;humanReviewed:false;publishAllowed:false;
 audioAdmission:'REQUIRES_EXACT_COMPILED_ASSEMBLED_TRACK_BINDING';
 image?:{url:string;sha256:string;bytes:number;width:number;height:number;reviewSha256:string;status:'PASS_EXACT_SELECTED_IMAGE_AND_OPTIONS'}};
export type Listening150Gate={schemaVersion:1;sourceVersion:string;packageManifestSha256:string;sourceQuestionsSha256:string;
 runtimeQuestionsCanonicalSha256:string;combinedCatalogCanonicalSha256:string;questions:Listening150GateRow[]};
export type Listening150Media={schemaVersion:1;status:'PRIVATE_CURRENT_SOURCE_CANDIDATE';contentVersion:string;sourceContentVersion:string;
 sourceContentManifestSha256:string;sourceQuestionsSha256:string;runtimeTrackCount:number;rawSourceSlotCount:number;
 formalAllowed:false;publishAllowed:false;humanListeningPerformed:false;validatedLocale:null;
 packId?:string;packIds?:string[];questionIds:string[];units:Listening150Unit[]};
/** Exact final pins are supplied by one compiled source module, never activation input. */
export type Listening150Pins={sourceVersion:string;packageManifestSha256:string;sourceQuestionsSha256:string;
 questionsCanonicalSha256:string;gateCanonicalSha256:string;mediaCanonicalSha256:string;combined313CanonicalSha256:string;
 imagePathPrefix:string;unitPrefix:string;packDescriptors:NaturalAudioPackDescriptor[]};
export type Listening150Input={questions:Question[];gate:Listening150Gate;media:Listening150Media};
export type ReviewedListeningAudio={body:Listening150Selector&{text:string;label:string;naturalOnly:true};
 question?:Listening150Selector&{text:string;label:string;naturalOnly:true}};
const hash=(value:unknown)=>canonicalHash(canonicalJson(value));
const hex=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const nonempty=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const unitId=(q:Question)=>q.groupId?`group:${q.part}:${q.groupId}`:`question:${q.id}`;
const exact=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
function reject(code:string):never{throw Error('listening150-'+code);}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

/** Additional package only. This never relaxes old 50/legacy or natural-media admission. */
export function admitListening150Package(input:Listening150Input,pins:Listening150Pins){
 const value=JSON.parse(JSON.stringify(input)) as Listening150Input,policy=JSON.parse(JSON.stringify(pins)) as Listening150Pins;
 const {questions:rows,gate,media}=value,index=compiledNaturalAudioCatalog;
 if(!index||!nonempty(policy.sourceVersion)||!nonempty(policy.unitPrefix)||!/^\/[a-z0-9-]+\/$/.test(policy.imagePathPrefix)||
  ![policy.packageManifestSha256,policy.sourceQuestionsSha256,policy.questionsCanonicalSha256,policy.gateCanonicalSha256,
    policy.mediaCanonicalSha256,policy.combined313CanonicalSha256].every(hex))reject('sealed-pins-missing');
 if(hash(rows)!==policy.questionsCanonicalSha256||hash(gate)!==policy.gateCanonicalSha256||hash(media)!==policy.mediaCanonicalSha256)reject('sealed-content-changed');
 if(!Array.isArray(rows)||rows.length!==150||new Set(rows.map(q=>q.id)).size!==150||rows.some(q=>!/^v041-l200-p[1-4]-/.test(q.id)))reject('question-count-or-identity');
 if(gate.schemaVersion!==1||gate.sourceVersion!==policy.sourceVersion||gate.packageManifestSha256!==policy.packageManifestSha256||
  gate.sourceQuestionsSha256!==policy.sourceQuestionsSha256||gate.runtimeQuestionsCanonicalSha256!==policy.questionsCanonicalSha256||
  gate.combinedCatalogCanonicalSha256!==policy.combined313CanonicalSha256||gate.questions.length!==150)reject('text-source-identity');
 if(media.schemaVersion!==1||media.status!=='PRIVATE_CURRENT_SOURCE_CANDIDATE'||media.contentVersion!==policy.sourceVersion||
  media.sourceContentVersion!==policy.sourceVersion||media.sourceContentManifestSha256!==policy.packageManifestSha256||
  media.sourceQuestionsSha256!==policy.sourceQuestionsSha256||media.runtimeTrackCount!==174||media.rawSourceSlotCount!==457||
  media.formalAllowed!==false||media.publishAllowed!==false||media.humanListeningPerformed!==false||media.validatedLocale!==null||
  !exact(media.questionIds,rows.map(q=>q.id))||media.units.length!==102)reject('media-source-or-completeness');
 const packs=policy.packDescriptors,packIds=packs.map(p=>p.packId);
 if(!packs.length||new Set(packIds).size!==packs.length||packs.some(p=>!exact(index.packs.find(actual=>actual.packId===p.packId),p))||
  media.packId!==undefined&&media.packIds!==undefined||!exact(media.packId!==undefined?[media.packId]:media.packIds,packIds))reject('compiled-pack-identity');
 const byUnit=new Map<string,Question[]>();for(const q of rows){const key=unitId(q);byUnit.set(key,[...(byUnit.get(key)??[]),q]);}
 if(byUnit.size!==102||![1,2,3,4].every(part=>rows.filter(q=>q.part===part).length===(part===1?42:36)))reject('part-or-material-count');
 const gates=new Map<string,Listening150GateRow>();for(const row of gate.questions){if(gates.has(row.qid))reject('duplicate-clearance');gates.set(row.qid,row);}
 const bindings=new Map<string,ReviewedListeningAudio>(),seenMaterials=new Set<string>(),seenImages=new Set<string>();let tracks=0;
 const audio=(track:Listening150Track,unit:Listening150Unit,segmentId:string)=>{
  const a=track.audio,textHash=canonicalHash(track.text);
  if(!nonempty(track.text)||!nonempty(track.label)||!hex(track.mediaTextSha256)||track.mediaTextSha256!==textHash||!hex(track.mp3Sha256)||!hex(track.sourceWavSha256)||
    !a||!hex(a.audioKey)||!nonempty(a.voiceProfileId)||a.materialId!==unit.materialId||a.segmentId!==segmentId||a.contextHash!==unit.contextHash||!hex(a.contextHash))reject('audio-selector-or-text');
  const routes=(index.routes[a.audioKey]??[]).filter(row=>index.packs[row[0]]?.packId===unit.packId&&
    row[1]===naturalAudioSelectorDigest(textHash,a.audioKey,a.materialId,a.segmentId,a.voiceProfileId,a.contextHash)&&
    row[2]===textHash&&row[3]===track.mp3Sha256&&row[5]===a.contextHash&&row[6]===unit.materialId);
  if(routes.length!==1||index.blockedAssetSha256?.includes(track.mp3Sha256)||index.blockedAssetSha256?.includes(track.sourceWavSha256)||
    index.blockedContexts?.some(row=>row[0]===a.materialId&&row[1]===a.contextHash))reject('compiled-route-or-pair');
  tracks++;return freeze({...a,text:track.text,label:track.label,naturalOnly:true as const});
 };
 for(const unit of media.units){
  const members=rows.filter(q=>(q.groupId||q.id)===unit.materialId);
  if(seenMaterials.has(unit.materialId)||!members.length||unit.unitId!==policy.unitPrefix+':'+unit.materialId||
    !packIds.includes(unit.packId)||unit.contentVersion!==policy.sourceVersion||unit.sourceQuestionsSha256!==policy.sourceQuestionsSha256||
    unit.privatePracticeEligible!==true||unit.formalAllowed!==false||unit.publishAllowed!==false||unit.humanListeningPerformed!==false||unit.validatedLocale!==null||
    !hex(unit.contextHash)||!exact(unit.questionIds,members.map(q=>q.id))||members.some(q=>q.part!==unit.part)||
    (unit.part>=3?members.length!==3||unit.printedOptionsOnly!==true:members.length!==1||unit.printedOptionsOnly!==false)||
    unit.questionTracks.length!==(unit.part>=3?3:0))reject('incomplete-or-duplicate-unit');
  seenMaterials.add(unit.materialId);const body=audio(unit.body,unit,'body');
  if(unit.part>=3&&!exact(unit.questionTracks.map(q=>q.qid),unit.questionIds))reject('question-track-order');
  for(const q of members){
   const g=gates.get(q.id);
   if(!g||g.part!==q.part||g.materialId!==unit.materialId||g.contextHash!==unit.contextHash||g.sourceVersion!==policy.sourceVersion||
    g.textReviewStatus!=='PASS'||!hex(g.textReviewSha256)||!hex(g.questionCanonicalSha256)||!hex(g.materialCanonicalSha256)||
    g.runtimeQuestionCanonicalSha256!==hash(q)||g.runtimeCandidateOnly!==true||g.humanReviewed!==false||g.publishAllowed!==false||
    g.audioAdmission!=='REQUIRES_EXACT_COMPILED_ASSEMBLED_TRACK_BINDING')reject('question-clearance');
   if(![1,2,3,4].includes(q.part)||q.options.length!==(q.part===2?3:4)||!q.options.every(nonempty)||!Number.isInteger(q.correctIndex)||q.correctIndex<0||q.correctIndex>=q.options.length||
    ![q.title,q.prompt,q.explanation,q.evidence,q.skill,q.difficulty,q.transcript].every(nonempty)||q.part>=3&&!q.groupId||q.part<=2&&q.groupId)reject('question-shape');
   if(q.part===1){const image=g.image;
    if(!image||image.status!=='PASS_EXACT_SELECTED_IMAGE_AND_OPTIONS'||!hex(image.sha256)||!hex(image.reviewSha256)||
     image.url!==q.image||image.url!==policy.imagePathPrefix+image.sha256+'.png'||!positive(image.bytes)||image.bytes>=25*1024*1024||!positive(image.width)||!positive(image.height)||seenImages.has(image.sha256))reject('image-not-cleared');
    seenImages.add(image.sha256);
   }else if(g.image!==undefined||q.image!==undefined)reject('unexpected-image');
   const question=unit.part>=3?audio(unit.questionTracks.find(track=>track.qid===q.id)!,unit,'prompt:'+q.id):undefined;
   if(bindings.has(q.id))reject('duplicate-question-unit');bindings.set(q.id,freeze({body,...(question?{question}:{})}));
  }
 }
 if(bindings.size!==150||seenMaterials.size!==102||seenImages.size!==42||tracks!==174)reject('final-completeness');
 freeze(rows);return Object.freeze({questions:rows as readonly Question[],combined313CanonicalSha256:policy.combined313CanonicalSha256,
  stats:Object.freeze({questions:150,materials:102,bodyTracks:102,questionTracks:72,imageCount:42}),
  getAudio:(qid:string)=>bindings.get(qid)??null});
}
