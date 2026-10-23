import {getListening50Audio} from './question-audio-bindings-v041';
import {LISTENING150_ADMISSION} from './listening150-package';

/** Preserve every old50 exact output; new questions require sealed admission. */
export function getReviewedListeningAudio(qid:string){
 return getListening50Audio(qid)??LISTENING150_ADMISSION?.getAudio(qid)??null;
}
