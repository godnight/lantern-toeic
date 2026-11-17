'use client';
import {useEffect,useRef,useState} from 'react';
import {PracticeTrainingDraft} from '@/lib/practice-training-draft';
import type {PracticeTraining,TrainingWrite} from '@/lib/practice-training';
import type {PracticeResult} from '@/lib/practice-workflow';

export function usePracticeTraining(initial:PracticeTraining,write:(value:TrainingWrite)=>Promise<PracticeResult>,revision=0,writable=true){
 const writer=useRef(write);writer.current=write;
 const writableRef=useRef(writable);writableRef.current=writable;
 const composing=useRef(false),dirtySince=useRef(0);
 const holder=useRef<PracticeTrainingDraft|null>(null);if(!holder.current)holder.current=new PracticeTrainingDraft(initial,value=>writer.current(value),undefined,undefined,revision,()=>!composing.current&&writableRef.current);
 const draft=holder.current,[version,render]=useState(0);
 useEffect(()=>draft.subscribe(()=>render(v=>v+1)),[draft]);
 useEffect(()=>{draft.sync(initial,revision);},[draft,initial,revision]);
 useEffect(()=>{if(!draft.dirty){dirtySince.current=0;return;}if(!writable||draft.status!=='dirty'||composing.current)return;if(!dirtySince.current)dirtySince.current=Date.now();const timer=setTimeout(()=>{if(writableRef.current&&!composing.current&&draft.status==='dirty'){dirtySince.current=0;void draft.flush(false,false);}},Math.max(0,Math.min(500,1500-(Date.now()-dirtySince.current))));return()=>clearTimeout(timer);},[draft,version,writable]);
 useEffect(()=>{const leave=()=>void draft.flush();window.addEventListener('pagehide',leave);return()=>{window.removeEventListener('pagehide',leave);void draft.flush();};},[draft]);
 return {draft,training:draft.value,edit:(value:PracticeTraining)=>draft.edit(value),flush:(retry=false)=>composing.current?Promise.resolve(false):draft.flush(retry),composition:(value:boolean)=>{composing.current=value;render(v=>v+1);}};
}
