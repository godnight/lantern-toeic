import media from '../content/questions-v041-listening50-media.json';

/** Current reviewed body and explicit question track. Never synthesize a selector from prompt text. */
export function getListening50Audio(qid:string){
 const units=media.units.filter(unit=>unit.questionIds.includes(qid)&&unit.privatePracticeEligible&&unit.formalAllowed===false&&unit.publishAllowed===false&&unit.humanListeningPerformed===false&&unit.validatedLocale===null);
 if(units.length!==1)return null;
 const unit=units[0],questions=unit.questionTracks.filter(track=>track.qid===qid);
 if((unit.part===3||unit.part===4)?questions.length!==1:questions.length!==0)return null;
 const body={text:unit.body.text,...unit.body.audio,naturalOnly:true as const,label:unit.body.label};
 return {body,...(questions.length?{question:{text:questions[0].text,...questions[0].audio,naturalOnly:true as const,label:questions[0].label}}:{})};
}
