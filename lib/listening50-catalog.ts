import data from '../content/questions-v041-listening50.json';
import gate from '../content/questions-v041-listening50-text-image-gates.json';
import media from '../content/questions-v041-listening50-media.json';
import {canonicalHash,canonicalJson} from './domain-command';
import {getListening50Audio} from './question-audio-bindings-v041';
import type {Question} from './study-model';

export const LISTENING50_STATS={questions:50,materials:30,bodyTracks:30,questionTracks:30,imageCount:8,byPart:{'1':8,'2':12,'3':15,'4':15}} as const;
const unitId=(q:Question)=>q.groupId?`group:${q.part}:${q.groupId}`:`question:${q.id}`;
const hex=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
/** Separate, complete reviewed P1–4 package admission. Old B03 P1 HOLD rules stay intact. */
export function validatedListening50Questions(legacy:readonly Question[]):Question[]{
 const rows=data as Question[],ids=new Set(rows.map(q=>q.id)),old=new Set(legacy.map(q=>q.id));
 if(rows.length!==50||ids.size!==50||rows.some(q=>old.has(q.id))||gate.sourceVersion!=='listening50-text-reviewed-r3'||gate.questions.length!==50||media.units.length!==30)throw Error('listening50-package-identity');
 if(canonicalHash(canonicalJson(rows))!==gate.runtimeQuestionsCanonicalSha256)throw Error('listening50-content-changed');
 const units=new Set(rows.map(unitId));if(units.size!==30)throw Error('listening50-group-count');
 for(const part of [1,2,3,4] as const)if(rows.filter(q=>q.part===part).length!==LISTENING50_STATS.byPart[String(part) as keyof typeof LISTENING50_STATS.byPart])throw Error('listening50-part-count');
 for(const q of rows){
  const gates=gate.questions.filter(row=>row.qid===q.id),binding=getListening50Audio(q.id);
  if(gates.length!==1||gates[0].textReviewStatus!=='PASS'||!hex(gates[0].textReviewSha256)||gates[0].sourceVersion!==gate.sourceVersion||gates[0].runtimeQuestionCanonicalSha256!==canonicalHash(canonicalJson(q))||gates[0].humanReviewed!==false||gates[0].publishAllowed!==false||!binding)throw Error('listening50-text-or-media-clearance');
  const same=rows.filter(other=>unitId(other)===unitId(q));
  if((q.part>=3&&same.length!==3)||(q.part<=2&&same.length!==1)||q.options.length!==(q.part===2?3:4)||!Number.isInteger(q.correctIndex)||q.correctIndex<0||q.correctIndex>=q.options.length||!q.explanation||!q.evidence)throw Error('listening50-question-incomplete');
  if(q.part===1){const image=gates[0].image;if(!image||image.status!=='PASS_EXACT_SELECTED_IMAGE_AND_OPTIONS'||!hex(image.sha256)||image.url!==q.image||image.url!==`/listening50-r3/${image.sha256}.png`||image.bytes<1)throw Error('listening50-image-not-cleared');}
  if(binding.body.materialId!==gates[0].materialId||binding.body.segmentId!=='body'||binding.question&&binding.question.materialId!==gates[0].materialId)throw Error('listening50-audio-material-mismatch');
  for(const audio of [binding.body,...(binding.question?[binding.question]:[])])if(!audio.naturalOnly||!hex(audio.contextHash)||!audio.audioKey||!audio.materialId||!audio.segmentId||!audio.voiceProfileId||!audio.text)throw Error('listening50-audio-selector-missing');
  if(q.part>=3&&!binding.question||q.part<=2&&binding.question)throw Error('listening50-question-track-missing');
 }
 return rows;
}
