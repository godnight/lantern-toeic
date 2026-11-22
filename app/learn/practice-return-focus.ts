export type PracticeReturnFocusRequest = {
 target: HTMLElement | null;
 scrollTop: number;
 isCurrent: () => boolean;
 canFocus: () => boolean;
 canScroll?: () => boolean;
};

type Frame = (callback: FrameRequestCallback) => number;
type Options = {
 requestFrame: Frame;
 cancelFrame: (id: number) => void;
 scroll: (top: number) => void;
};

// A return can be requested before the originating control finishes saving and
// becomes enabled. Keep the target until the owner asks to retry or cancels it.
export function createPracticeReturnFocus({requestFrame,cancelFrame,scroll}:Options){
 let pending: (PracticeReturnFocusRequest & {scrolled:boolean}) | null = null;
 let frame: number | null = null;
 let generation = 0;
 function cancel(){
  generation++;
  pending = null;
  if(frame!==null){cancelFrame(frame);frame=null;}
 }
 function retry(){
  if(!pending || frame!==null)return;
  const token=generation;
  frame=requestFrame(()=>{
   if(token!==generation)return;
   frame=null;
   const current=pending;
   if(!current)return;
   if(!current.isCurrent()){cancel();return;}
   if(!current.scrolled){if(current.canScroll&&!current.canScroll())return;current.scrolled=true;scroll(current.scrollTop);}
   const target=current.target;
   if(!target){cancel();return;}
   if(!current.canFocus())return;
   if(!target.isConnected||target.matches(':disabled')||target.getAttribute('aria-disabled')==='true'||target.closest('[hidden], [inert], [aria-hidden="true"]')||target.getClientRects().length===0)return;
   // A focus handler can synchronously change the owner, route, or request.
   if(!current.isCurrent()){cancel();return;}
   target.focus({preventScroll:true});
   if(token!==generation)return;
   if(!current.isCurrent()||target.ownerDocument.activeElement===target)cancel();
  });
 }
 function request(value:PracticeReturnFocusRequest){
  cancel();
  pending={...value,scrolled:false};
  retry();
 }
 return {request,retry,cancel};
}
