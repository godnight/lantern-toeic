// Process-only navigation hint. Never a source of identity or learning facts.
export type NativeResumeNav='today'|'vocabulary'|'train'|'review'|'progress'|'resources';
export type NativeWorkspaceResume=Readonly<{owner:string;nav:NativeResumeNav;scroll:number;practiceSessionId:string|null}>;
const navs:readonly string[]=['today','vocabulary','train','review','progress','resources'];
export function nativeWorkspaceResume(owner:string|null,nav:string,scroll:number,practiceSessionId:string|null,excluded:boolean):NativeWorkspaceResume|null{
 if(!owner||excluded||!navs.includes(nav)||!Number.isFinite(scroll)||scroll<0||scroll>1000000||
   practiceSessionId!==null&&!/^[a-zA-Z0-9:_-]{1,128}$/.test(practiceSessionId))return null;
 return {owner,nav:nav as NativeResumeNav,scroll,practiceSessionId};
}
export function resumeForOwner(value:NativeWorkspaceResume|null,owner:string|null):NativeWorkspaceResume|null{
 return value&&owner===value.owner?nativeWorkspaceResume(value.owner,value.nav,value.scroll,value.practiceSessionId,false):null;
}
