import compiled from '../content/listening50-exact-pronunciation-exceptions.json';

type Pack={packId:string;manifestSha256:string};
type Clip={id:string;cacheKey:string;textSha256:string;sha256:string;sourceWavSha256:string;voiceProfileId:string;engine?:string;provenanceSha256?:string;encodingObservationSha256?:string};
type Reference={materialId:string;segmentId:string;contextHash?:string;activationAssetKey?:string};
const expectedEntry='7c25ac06f5292229af09afc7e4d4cd0f4da26633e221691a09a8a84d4bfb5734';
const expectedGate='3311ba9c880b711180b42cf409760f1a0ebec363fee7426cb6cf7c1b544f5933';
const source=Object.freeze(JSON.parse(JSON.stringify(compiled))) as typeof compiled;
/** A compiled, single assembled-body exception. Plain text and other cupboard assets stay held. */
export function compiledListening50PronunciationException(pack:Pack,clip:Clip,ref:Reference):boolean{
 if(source.schemaVersion!==1||source.authorityId!=='recovery-postunion002-p4r3-v1'||source.exceptions.length!==1)return false;
 const row=source.exceptions[0];
 return row.materialId==='v041-l50-p3-g05'&&row.segmentId==='body'&&row.contentVersion==='listening50-text-reviewed-r3'&&
  row.sourceHandoffEntrySha256===expectedEntry&&row.sourceGateSha256===expectedGate&&
  row.humanListeningPerformed===false&&row.humanAccepted===false&&row.publishAllowed===false&&
  row.packId===pack.packId&&row.manifestSha256===pack.manifestSha256&&row.clipId===clip.id&&row.cacheKey===clip.cacheKey&&
  row.textSha256===clip.textSha256&&row.encodedSha256===clip.sha256&&row.masterWavSha256===clip.sourceWavSha256&&
  row.voiceProfileId===clip.voiceProfileId&&row.engine===clip.engine&&row.provenanceSha256===clip.provenanceSha256&&
  row.encodingObservationSha256===clip.encodingObservationSha256&&row.materialId===ref.materialId&&row.segmentId===ref.segmentId&&
  row.contextHash===ref.contextHash&&(ref.activationAssetKey??clip.cacheKey)===row.cacheKey;
}
