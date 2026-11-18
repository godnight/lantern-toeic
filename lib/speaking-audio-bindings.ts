import speakingData from '../content/speaking.json';
import bindingsData from '../content/speaking-audio-bindings-v041.json';
import naturalManifest from '../content/natural-audio-manifest.json';
import {canonicalHash,canonicalJson} from './domain-command';
import {compiledNaturalAudioRows} from './natural-audio-admission';
import type {Speaking} from './study-model';

type SampleBinding={
 promptId:string;role:'sampleAnswer';textSha256:string;snapshotContextSha256:string;
 requestContextHash:string;mp3Sha256:string;sourceWavSha256:string;
 engine:'kokoro'|'qwen';modelRevision:string;provenanceSha256:string;
 audio:{audioKey:string;materialId:string;segmentId:string;voiceProfileId:string};
};
type SampleTable={schemaVersion:1;packId:string;manifestSha256:string;sourceSpeakingSha256:string;sourceCatalogSha256:string;rows:SampleBinding[]};
const table=bindingsData as unknown as SampleTable;
const HEX=/^[a-f0-9]{64}$/;
const sourceCatalogSha256=canonicalHash(canonicalJson(speakingData));
export function speakingSampleContext(prompt:Speaking):string {
 return canonicalHash(canonicalJson({id:prompt.id,type:prompt.type,title:prompt.title,prompt:prompt.prompt,
  passage:prompt.passage??null,image:prompt.image??null,sampleAnswer:prompt.sampleAnswer}));
}
/** Exact reviewed sample only. A missing binding never means legacy/system audio. */
export function getSpeakingSampleAudio(prompt:Speaking):{text:string;audioKey:string;materialId:string;segmentId:string;voiceProfileId:string;contextHash:string}|null {
 try{
  if(table.schemaVersion!==1||table.sourceCatalogSha256!==sourceCatalogSha256||!HEX.test(table.sourceSpeakingSha256)||
    table.packId!==naturalManifest.packId||table.manifestSha256!==naturalManifest.manifestSha256)return null;
  const matches=table.rows.filter(row=>row.promptId===prompt.id);if(matches.length!==1)return null;
  const row=matches[0],audio=row.audio;
  if(row.role!=='sampleAnswer'||!audio||audio.materialId!==prompt.id||audio.segmentId!=='sampleAnswer'||
    ![row.textSha256,row.snapshotContextSha256,row.requestContextHash,row.mp3Sha256,row.sourceWavSha256,row.provenanceSha256].every(value=>HEX.test(value))||
    !/^[a-f0-9]{40}$/.test(row.modelRevision)||row.textSha256!==canonicalHash(prompt.sampleAnswer)||row.snapshotContextSha256!==speakingSampleContext(prompt))return null;
  const admitted=compiledNaturalAudioRows(table.packId,table.manifestSha256).filter(item=>
   [item.cacheKey,item.activationAssetKey,item.clipId].includes(audio.audioKey)&&item.materialId===audio.materialId&&
   item.segmentId===audio.segmentId&&item.voiceProfileId===audio.voiceProfileId&&item.textSha256===row.textSha256&&
   item.contextHash===row.requestContextHash&&item.encodedSha256===row.mp3Sha256&&item.masterWavSha256===row.sourceWavSha256&&
   item.engine===row.engine&&item.provenanceSha256===row.provenanceSha256);
  if(admitted.length!==1)return null;
  const clip=naturalManifest.clips.find(item=>item.id===admitted[0].clipId);
  if(!clip||clip.engine!==row.engine||clip.sha256!==row.mp3Sha256||clip.sourceWavSha256!==row.sourceWavSha256||
    !clip.provenance.segments.every((item:{engine:string;modelRevision:string;voiceProfileId:string})=>item.engine===row.engine&&item.modelRevision===row.modelRevision&&item.voiceProfileId===audio.voiceProfileId))return null;
  return {text:prompt.sampleAnswer,...audio,contextHash:row.requestContextHash};
 }catch{return null;}
}
