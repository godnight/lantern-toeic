'use client';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {usePracticeSubviewBack} from './practice-records';
import {SpeechPlayer} from './practice';
import {getReviewedListeningAudio} from '@/lib/question-audio-dispatch-v041';
import {getQuestionPrivateAudio} from '@/lib/question-audio-bindings-v040';
import {practiceSavedCount,practiceTaskLabel} from '@/lib/practice-task';
import type {PracticeSession} from '@/lib/practice-workflow';
export function PracticeHistory({session,onClose}:{session:PracticeSession;onClose:()=>void}){
 const back=usePracticeSubviewBack(onClose,10);
 return <Dialog open onOpenChange={open=>{if(!open)back();}}><DialogContent className="settings-dialog practice-history"><DialogHeader><DialogTitle>{practiceTaskLabel(session)}</DialogTitle><DialogDescription>{session.status==='completed'?'已完成':'已结束'} · 已答{practiceSavedCount(session)}/{session.queue.length}题。查看答案与材料不会新增作答或学习时间。</DialogDescription></DialogHeader>{session.queue.map((q,i)=>{const step=session.steps[i],audio=getReviewedListeningAudio(q.id)?.body??getQuestionPrivateAudio(q.id);return <section className="practice-history-question" key={q.id}><h3>{i+1}. {q.title||`Part ${q.part}`}</h3>{audio&&<SpeechPlayer {...audio} label="听材料" naturalOnly/>}{q.image&&<img src={q.image} alt="本题配图"/>}{q.passage&&<p className="passage">{q.passage}</p>}<p>{q.prompt}</p><ol type="A">{q.options.map((option,j)=><li key={j}>{option}{j===q.correctIndex?' ✓':''}</li>)}</ol><p>{step.status==='applied'?`已保存选择：${'ABCD'[step.choice??0]}`:'本题未计作已保存作答'}</p><p>{q.explanation}</p>{(q.transcript||q.audioText)&&<details><summary>查看材料原文</summary><p>{q.transcript||q.audioText}</p></details>}</section>;})}<button type="button" className="button secondary" onClick={back}>返回练习记录</button></DialogContent></Dialog>;
}
