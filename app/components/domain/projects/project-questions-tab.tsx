'use client';

import * as React from 'react';
import Link from 'next/link';
import { HelpCircle } from 'lucide-react';
import '@/components/domain/home/home-tokens.css';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { QuestionList } from '@/components/domain/tasks/questions/QuestionList';
import { askedDate } from '@/components/domain/tasks/questions/question-copy';
import { useAnswerProjectQuestion, useAskProjectQuestion, useProjectQuestions, type ProjectQuestion } from '@/lib/hooks/use-project-questions';
import { ProjectQuestionForm } from './project-question-form';

interface ProjectQuestionsTabProps {
  projectId: string;
  /** Only Mike answers (the answer route refuses everyone else); everyone else reads. */
  canAnswer: boolean;
  /** A pm or admin may ask a question on the project itself (no card). Left out, the tab only lists and answers. */
  canAsk?: boolean;
  /** The signed-in person's name: recorded as the source of a question they ask. */
  askerName?: string;
}

/** Who the question waits on: the client contact we sent it to, or Mike. */
export function questionFor(q: Pick<ProjectQuestion, 'asked_of_contact'>): string {
  const c = q.asked_of_contact;
  if (!c) return 'Mike';
  return c.name ? `${c.name} (client)` : `${c.email} (client)`;
}

/** Who asked it: the asker's name, else the agent lane that filed it, else nobody recorded. */
export function questionAsker(q: Pick<ProjectQuestion, 'asked_by' | 'asked_by_lane'>): string {
  if (q.asked_by?.name) return q.asked_by.name;
  if (q.asked_by_lane) return q.asked_by_lane.charAt(0).toUpperCase() + q.asked_by_lane.slice(1);
  return 'Not recorded';
}

function Meta({ q }: { q: ProjectQuestion }) {
  const blocks = q.blocks ?? [];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-sub" data-testid="project-question-meta">
      <Badge size="sm" variant={q.asked_of_contact ? 'info' : 'purple'}>
        For {questionFor(q)}
      </Badge>
      <span>Asked by {questionAsker(q)}</span>
      <span>{askedDate(q.created_at)}</span>
      {q.task ? (
        <Link href={`/tasks/${q.task.id}`} className="hover:underline">
          Card: {q.task.title}
        </Link>
      ) : (
        <span data-testid="project-question-on-project">On the project, no card yet</span>
      )}
      {!q.task ? null : blocks.length > 0 ? (
        <span>
          Holds:{' '}
          {blocks.map((b, i) => (
            <React.Fragment key={b.id}>
              {i > 0 ? ', ' : null}
              <Link href={`/tasks/${b.id}`} className="hover:underline">
                {b.title}
              </Link>
            </React.Fragment>
          ))}
        </span>
      ) : (
        <span>Holds no cards</span>
      )}
    </div>
  );
}

/**
 * Every open question on the project and its cards, oldest first, each answerable in place with the card screen's own answer form. A pm or
 * admin can also ask a question on the project itself, for when no card exists yet because the answer decides which cards get made.
 */
export function ProjectQuestionsTab({ projectId, canAnswer, canAsk = false, askerName = '' }: ProjectQuestionsTabProps) {
  const { data, isLoading, isError } = useProjectQuestions(projectId);
  const answer = useAnswerProjectQuestion(projectId);
  const ask = useAskProjectQuestion(projectId, askerName);
  const askForm = canAsk ? <ProjectQuestionForm onAsk={ask} /> : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !data) {
    return <EmptyState icon={<HelpCircle className="h-10 w-10" />} title="Questions could not be loaded" description="Reload the page to try again." />;
  }

  const questions = data.questions;
  if (questions.length === 0) {
    return (
      <div className="space-y-3">
        {askForm}
        <EmptyState
          icon={<HelpCircle className="h-10 w-10" />}
          title="No open questions"
          description="Questions waiting on Mike or a client, logged on this project or its cards, show here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="project-questions">
      {askForm}
      <p className="text-sm text-text-sub">
        {data.total} open {data.total === 1 ? 'question' : 'questions'}, oldest first.
        {data.total > questions.length ? ` Showing the first ${questions.length}.` : ''}
      </p>
      <ul className="border border-border rounded-lg divide-y divide-border">
        {questions.map((q) => (
          <li key={q.id} className="px-4 py-3 space-y-2" data-testid="project-question">
            <Meta q={q} />
            <div data-home>
              <QuestionList questions={[q]} onAnswer={canAnswer ? (_qid, body) => answer(q, body) : undefined} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
