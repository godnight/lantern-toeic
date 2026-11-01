import media from '../content/questions-v040-b03-r2-media.json';
/** The complete assembled text is required by the resolver; question prompt alone cannot select a unit. */
export function getQuestionPrivateAudio(qid:string){
 const units=media.units.filter(unit=>unit.questionIds.includes(qid)&&unit.privatePracticeEligible&&unit.formalAllowed===false&&unit.publishAllowed===false&&unit.humanListeningPerformed===false&&unit.validatedLocale===null);
 if(units.length!==1)return null;const unit=units[0];return {text:unit.spokenText,...unit.audio,label:unit.label};
}
