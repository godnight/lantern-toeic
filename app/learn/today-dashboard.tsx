'use client';

import type {ReactNode} from 'react';
import {BookOpen,Headphones,RotateCcw} from 'lucide-react';

export type TodayDashboardProps = {
  /** Already formatted in the profile's learning timezone. */
  dateLabel: string;
  /** Existing TodayVocabularyTask, with its real start/resume/error handling. */
  wordTask: ReactNode;
  wordSummary: string;
  reviewSummary: string;
  practiceSummary?: string;
  onOpenPlan: () => void;
  onOpenPractice: () => void;
  onOpenReview: () => void;
  disabled?: boolean;
  notices?: ReactNode;
};

/** Presentation only. The parent supplies projections and the existing workflow action. */
export function TodayDashboard({dateLabel,wordTask,wordSummary,reviewSummary,
  practiceSummary='按专项选择练习',onOpenPlan,onOpenPractice,onOpenReview,
  disabled=false,notices}:TodayDashboardProps) {
  const tasks=[
    {key:'words',icon:BookOpen,title:'单词计划',summary:wordSummary,label:'看计划',onClick:onOpenPlan},
    {key:'practice',icon:Headphones,title:'听读专项',summary:practiceSummary,label:'去选择',onClick:onOpenPractice},
    {key:'review',icon:RotateCcw,title:'到期复习',summary:reviewSummary,label:'查看',onClick:onOpenReview},
  ];
  return <div className="v040-page v040-today" data-v040-page="today">
    <div className="v040-page-heading"><p className="v040-date">{dateLabel}</p><h1>今日学习</h1></div>
    {notices}
    <div className="v040-word-action">{wordTask}</div>
    <section aria-labelledby="v040-tasks-title">
      <div className="v040-section-heading"><h2 id="v040-tasks-title">今日安排</h2></div>
      <div className="v040-task-list">{tasks.map(task=><div className="v040-task-row" key={task.key}>
        <span className="v040-task-icon" aria-hidden="true"><task.icon size={22}/></span>
        <div className="v040-task-copy"><strong>{task.title}</strong><small>{task.summary}</small></div>
        <button type="button" className="v040-row-action" disabled={disabled} onClick={task.onClick}>{task.label}</button>
      </div>)}</div>
    </section>
  </div>;
}
