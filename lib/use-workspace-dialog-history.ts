'use client';
import {useEffect,useRef} from 'react';
import {createId} from './study-model';

/** Root dialogs consume one browser Back before their underlying workspace page. */
export function useWorkspaceDialogHistory(kind:string|null,onClose:(kind:string)=>void,beforeClose?:(kind:string)=>boolean){
 const current=useRef<{kind:string;token:string}|null>(null);
 const close=useRef(onClose);close.current=onClose;
 const guard=useRef(beforeClose);guard.current=beforeClose;
 const consumed=useRef(false);
 useEffect(()=>{
  if(!kind){
   const previous=current.current;current.current=null;
   if(previous&&window.history.state?.lanternWorkspaceDialog===previous.token){
    consumed.current=true;window.history.back();
   }
   return;
  }
  const previous=current.current;
  if(previous?.kind===kind)return;
  const next={kind,token:previous?.token||createId()};current.current=next;
  const state={...window.history.state,lanternWorkspaceDialog:next.token};
  if(previous&&window.history.state?.lanternWorkspaceDialog===previous.token)window.history.replaceState(state,'');
  else window.history.pushState(state,'');
 },[kind]);
 useEffect(()=>{
  const pop=(event:PopStateEvent)=>{
   if(consumed.current){consumed.current=false;event.stopImmediatePropagation();return;}
   const active=current.current;
   if(!active||event.state?.lanternWorkspaceDialog===active.token)return;
   event.stopImmediatePropagation();
   if(guard.current&&!guard.current(active.kind)){
    // A dirty/pending editor owns this Back. Restore only this local dialog entry.
    window.history.pushState({...event.state,lanternWorkspaceDialog:active.token},'');return;
   }
   current.current=null;close.current(active.kind);
  };
  window.addEventListener('popstate',pop,true);
  return()=>window.removeEventListener('popstate',pop,true);
 },[]);
}
