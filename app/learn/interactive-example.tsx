'use client';

import type {ReactNode} from 'react';

export type ExampleLookup = (query:string,trigger:HTMLElement)=>void;
type Props={text:string;onLookup?:ExampleLookup;disabled?:boolean};

// Keep the original spelling, punctuation and whitespace. Lookup is deliberately
// literal: inflected words and contractions are not silently reduced to a lemma.
export function InteractiveExample({text,onLookup,disabled=false}:Props){
 if(!onLookup)return <span className="interactive-example" lang="en">{text}</span>;
 const parts:ReactNode[]=[];
 const pattern=/[\p{Script=Latin}\p{Mark}\d]+(?:['’ʼ‐‑-][\p{Script=Latin}\p{Mark}\d]+)*/gu;
 let cursor=0;
 for(const match of text.matchAll(pattern)){
  const word=match[0],start=match.index;
  if(!/\p{Script=Latin}/u.test(word))continue;
  if(start>cursor)parts.push(text.slice(cursor,start));
  parts.push(<button key={start} type="button" className="example-word" aria-label={'查词：'+word} aria-haspopup="dialog" disabled={disabled} onClick={event=>{if(!disabled)onLookup(word,event.currentTarget);}}>{word}</button>);
  cursor=start+word.length;
 }
 if(cursor<text.length)parts.push(text.slice(cursor));
 return <span className="interactive-example" lang="en">{parts}</span>;
}
