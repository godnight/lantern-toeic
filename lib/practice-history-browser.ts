export type PracticeHistoryTarget={href:string;stateKey:string|null};
type Field='lanternPracticeView'|'lanternPracticeSubview';
type Guard={version:1;claim:(id:string,field:Field,target:PracticeHistoryTarget,onPop:(event:PopStateEvent)=>void)=>void;release:(id:string)=>void;previous:(id:string,field:Field)=>PracticeHistoryTarget|null;consume:(target:PracticeHistoryTarget)=>void};
declare global {interface Window {__lanternPracticeHistory?:Guard}}
function capture():PracticeHistoryTarget{let stateKey:string|null;try{stateKey=JSON.stringify(window.history.state);}catch{stateKey=null;}return {href:window.location.href,stateKey};}
export function claimPracticeHistory(id:string,field:Field,onPop:(event:PopStateEvent)=>void,prior?:PracticeHistoryTarget){
 const guard=window.__lanternPracticeHistory,current=window.history.state?.[field],old=current&&guard?.previous(current,field),reuse=!prior&&old?.href===window.location.href?old:null,target=prior??reuse??capture();
 if(guard)guard.claim(id,field,target,onPop);else window.addEventListener('popstate',onPop,true);
 return {target,reuse:!!reuse,base:reuse?.stateKey?JSON.parse(reuse.stateKey):window.history.state,release:()=>{if(guard)guard.release(id);else window.removeEventListener('popstate',onPop,true);},consume:()=>{
  if(guard)guard.consume(target);else{const once=(event:PopStateEvent)=>{if(window.location.href===target.href&&JSON.stringify(event.state)===target.stateKey)event.stopImmediatePropagation();};window.addEventListener('popstate',once,{once:true,capture:true});}
 }};
}
