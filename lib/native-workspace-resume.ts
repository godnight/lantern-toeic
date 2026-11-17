// Process-only navigation hint. Never a source of identity or learning facts.
export type NativeResumeNav='today'|'vocabulary'|'train'|'review'|'progress'|'resources';
export type NativeVocabularyPrevious=Readonly<{sessionId:string;stepId:string}>;
export type NativeWorkspaceResume=Readonly<{owner:string;nav:NativeResumeNav;scroll:number;practiceSessionId:string|null;vocabularyPrevious?:NativeVocabularyPrevious|null}>;
const navs:readonly string[]=['today','vocabulary','train','review','progress','resources'];
export function nativeWorkspaceResume(owner:string|null,nav:string,scroll:number,practiceSessionId:string|null,excluded:boolean,vocabularyPrevious:NativeVocabularyPrevious|null=null):NativeWorkspaceResume|null{
 if(!owner||excluded||!navs.includes(nav)||!Number.isFinite(scroll)||scroll<0||scroll>1000000||
   practiceSessionId!==null&&!/^[a-zA-Z0-9:_-]{1,128}$/.test(practiceSessionId)||
   vocabularyPrevious!==null&&(nav!=='vocabulary'||practiceSessionId!==null||![vocabularyPrevious.sessionId,vocabularyPrevious.stepId].every(id=>typeof id==='string'&&/^[a-zA-Z0-9:_-]{1,128}$/.test(id))))return null;
 return {owner,nav:nav as NativeResumeNav,scroll,practiceSessionId,vocabularyPrevious};
}
export function resumeForOwner(value:NativeWorkspaceResume|null,owner:string|null):NativeWorkspaceResume|null{
 return value&&owner===value.owner?nativeWorkspaceResume(value.owner,value.nav,value.scroll,value.practiceSessionId,false,value.vocabularyPrevious??null):null;
}
// Only a persisted, immediately preceding receipt can be reconstructed.
export function validVocabularyPrevious(value:NativeVocabularyPrevious|null|undefined,session:{id:string;status:string;cursor:number;queue:readonly {id:string;receipt?:unknown;correctionPending?:unknown}[]}|null):value is NativeVocabularyPrevious{
 if(!value||!session||session.status!=='active'||session.id!==value.sessionId||!Number.isInteger(session.cursor)||session.cursor<1)return false;
 const step=session.queue[session.cursor-1];return !!step&&step.id===value.stepId&&!!step.receipt&&!step.correctionPending;
}
