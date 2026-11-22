// Process-only navigation hint. Never a source of identity or learning facts.
export type NativeResumeNav='today'|'vocabulary'|'train'|'review'|'progress'|'resources';
export type VocabularyPrevious=Readonly<{sessionId:string;stepId:string;cursor:number}>;
export type DiscoveryResume=Readonly<{category: "all"|"video"|"podcast"|"article";query:string;savedOnly:boolean;sourceIds?:string[]}>;
export type NativeWorkspaceResume=Readonly<{owner:string;nav:NativeResumeNav;scroll:number;practiceSessionId:string|null;vocabularyPrevious?:VocabularyPrevious|null;discovery?:DiscoveryResume|null;listeningFocused?:boolean}>;
const navs:readonly string[]=['today','vocabulary','train','review','progress','resources'];
export function nativeWorkspaceResume(owner:string|null,nav:string,scroll:number,practiceSessionId:string|null,excluded:boolean,vocabularyPrevious:VocabularyPrevious|null=null,discovery:DiscoveryResume|null=null,listeningFocused=false):NativeWorkspaceResume|null{
 if(!owner||excluded||!navs.includes(nav)||!Number.isFinite(scroll)||scroll<0||scroll>1000000||
   practiceSessionId!==null&&!/^[a-zA-Z0-9:_-]{1,128}$/.test(practiceSessionId))return null;
 const previous=nav==='vocabulary'&&vocabularyPrevious&&/^[a-zA-Z0-9:_-]{1,128}$/.test(vocabularyPrevious.sessionId)&&/^[a-zA-Z0-9:_-]{1,128}$/.test(vocabularyPrevious.stepId)&&Number.isSafeInteger(vocabularyPrevious.cursor)&&vocabularyPrevious.cursor>0?vocabularyPrevious:null;
 const sourceIds=discovery?.sourceIds;
 const safeDiscovery=nav==='resources'&&discovery&&['all','video','podcast','article'].includes(discovery.category)&&typeof discovery.query==='string'&&discovery.query.length<=200&&typeof discovery.savedOnly==='boolean'&&(sourceIds===undefined||Array.isArray(sourceIds)&&sourceIds.length<=100&&sourceIds.every(id=>typeof id==='string'&&/^[a-zA-Z0-9:_-]{1,128}$/.test(id)))?{category:discovery.category,query:discovery.query,savedOnly:discovery.savedOnly,...sourceIds!==undefined?{sourceIds:[...sourceIds]}:{}}:null;
 return {owner,nav:nav as NativeResumeNav,scroll,practiceSessionId,...(previous?{vocabularyPrevious:previous}:{}),...(safeDiscovery?{discovery:safeDiscovery}:{}),...(nav==='train'&&listeningFocused===true?{listeningFocused:true}:{})};
}
export function resumeForOwner(value:NativeWorkspaceResume|null,owner:string|null):NativeWorkspaceResume|null{
 return value&&owner===value.owner?nativeWorkspaceResume(value.owner,value.nav,value.scroll,value.practiceSessionId,false,value.vocabularyPrevious??null,value.discovery??null,value.listeningFocused===true):null;
}
