export type PracticeHistoryTarget={href:string;stateKey:string|null};
type Field='lanternPracticeView'|'lanternPracticeSubview';
type Guard={version:1;claim:(id:string,field:Field,target:PracticeHistoryTarget,onPop:(event:PopStateEvent)=>void)=>void;own:(id:string,state:unknown)=>void;release:(id:string)=>void;previous:(id:string,field:Field,state:unknown)=>PracticeHistoryTarget|null;consume:(target:PracticeHistoryTarget)=>void};
declare global {interface Window {__lanternPracticeHistory?:Guard}}
function stateKey(state:unknown):string|null{try{return JSON.stringify(state)??null;}catch{return null;}}
function capture():PracticeHistoryTarget{return {href:window.location.href,stateKey:stateKey(window.history.state)};}
function matches(target:PracticeHistoryTarget,event:PopStateEvent){return target.stateKey!==null&&window.location.href===target.href&&stateKey(event.state)===target.stateKey;}
export function claimPracticeHistory(id:string,field:Field,onPop:(event:PopStateEvent)=>void,prior?:PracticeHistoryTarget){
 const guard=window.__lanternPracticeHistory,current=window.history.state?.[field],old=current&&guard?.previous(current,field,window.history.state),reuse=!prior&&old?.href===window.location.href?old:null,target=prior??reuse??capture();
 const pop=(event:PopStateEvent)=>{if(matches(target,event))onPop(event);};
 if(guard)guard.claim(id,field,target,onPop);else window.addEventListener('popstate',pop,true);
 return {target,reuse:!!reuse,base:reuse?.stateKey?JSON.parse(reuse.stateKey):window.history.state,own:()=>guard?.own(id,window.history.state),release:()=>{if(guard)guard.release(id);else window.removeEventListener('popstate',pop,true);},consume:()=>{
  if(guard)guard.consume(target);else{const once=(event:PopStateEvent)=>{if(matches(target,event))event.stopImmediatePropagation();};window.addEventListener('popstate',once,{once:true,capture:true});}
 }};
}
