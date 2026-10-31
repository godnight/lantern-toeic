'use client';

import {useEffect,useRef,useState} from 'react';
import type {MutableRefObject} from 'react';
import {Check} from 'lucide-react';

export function PlanEditorActions({onBack,backDisabled,saveDisabled,saveLabel}:{onBack:()=>void;backDisabled:boolean;saveDisabled:boolean;saveLabel:string}){
  return <div className="lp-editor-actions"><button type="button" className="button lp-return" disabled={backDisabled} onClick={onBack}>返回</button><button type="submit" className="button primary lp-save" disabled={saveDisabled}>{saveLabel}<Check size={17} aria-hidden="true"/></button></div>;
}

export type PlanBackRef=MutableRefObject<(()=>void)|null>;
/** Presentation only: leaving never cancels a command or rolls back storage. */
export function usePlanEditorExit({dirty,attempted,pending,onLeave,backRef}:{dirty:boolean;attempted:boolean;pending:boolean;onLeave:()=>void;backRef?:PlanBackRef}){
  const [confirm,setConfirm]=useState(false);
  const focus=useRef<HTMLElement|null>(null);
  const request=()=>{
    if(pending)return;
    if(confirm){keep();return;}
    if(!dirty&&!attempted){onLeave();return;}
    focus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    setConfirm(true);
  };
  useEffect(()=>{if(!backRef)return;backRef.current=request;return()=>{if(backRef.current===request)backRef.current=null;};});
  const keep=()=>{setConfirm(false);requestAnimationFrame(()=>{const target=focus.current;if(target?.isConnected&&!target.hasAttribute('disabled'))target.focus({preventScroll:true});});};
  return {confirm,request,keep,leave:()=>{setConfirm(false);onLeave();},attempted};
}

export function PlanExitPrompt({exit}:{exit:ReturnType<typeof usePlanEditorExit>}){
  const first=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(exit.confirm)first.current?.focus({preventScroll:true});},[exit.confirm]);
  if(!exit.confirm)return null;
  return <section className="lp-exit-prompt" role="alertdialog" aria-label={exit.attempted?'确认离开编辑器':'确认放弃修改'}>
    <p>{exit.attempted?'保存已尝试，结果可能尚未确认。离开不会撤销已发操作，未提交的草稿下次可能不保留。':'尚未提交的修改将被放弃。'}</p>
    <div className="button-row"><button ref={first} type="button" className="button secondary" onClick={exit.keep}>继续{exit.attempted?'核对':'编辑'}</button><button type="button" className="button secondary" onClick={exit.leave}>{exit.attempted?'仍返回':'放弃修改'}</button></div>
  </section>;
}

export const PLAN_SAVE_WAIT_MS=15000;
