'use client';

import * as React from 'react';
import '@/components/domain/home/home-tokens.css';
import { useAnswerQuestion, useTaskQuestions } from '@/lib/hooks/use-task-questions';
import { QuestionList } from './QuestionList';
import { QUESTION_COPY } from './question-copy';

/** One card's questions, loaded and answerable in place. `canAnswer` is true only for Mike; everyone else reads. */
export function TaskQuestions({ taskId, canAnswer, standalone = false }: { taskId: string; canAnswer: boolean; standalone?: boolean }) {
  const { data, isLoading } = useTaskQuestions(taskId);
  const answer = useAnswerQuestion(taskId);
  const body = isLoading ? <p className="home-small home-muted">{QUESTION_COPY.loading}</p> : <QuestionList questions={data?.questions ?? []} onAnswer={canAnswer ? answer : undefined} />;
  // On the home screen the page already carries data-home; the task page needs its own.
  return standalone ? (
    <div data-home data-testid="task-questions">
      {body}
    </div>
  ) : (
    <div data-testid="task-questions">{body}</div>
  );
}
