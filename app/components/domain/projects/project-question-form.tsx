'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PART_MIN, QUESTION_MAX } from '@/lib/tasks/question-context';
import type { ProjectQuestionDraft } from '@/lib/hooks/use-project-questions';

export const PROJECT_QUESTION_FORM_COPY = {
  open: 'Ask a question',
  intro: 'A question on the project itself, for when no card exists yet because the answer decides which cards get made.',
  question: 'The question',
  questionHint: 'One line, ending in a question mark.',
  whatItIs: 'What it is about',
  checked: 'What you checked',
  unknown: 'What is still unknown',
  ifNobody: 'What happens if nobody decides',
  save: 'Add question',
  cancel: 'Cancel',
} as const;

const EMPTY: ProjectQuestionDraft = { question: '', what_it_is: '', checked: '', unknown: '', if_nobody: '' };

/** Why the draft cannot be sent yet, or null. The server checks the same things again (lib/tasks/question-context.ts). */
export function projectQuestionProblem(d: ProjectQuestionDraft): string | null {
  const q = d.question.trim();
  if (q.length < 5) return 'Write the question.';
  if (q.length > QUESTION_MAX) return `The question is one line, ${QUESTION_MAX} characters at most.`;
  if (!q.endsWith('?')) return 'The question ends in a question mark.';
  const parts: Array<[string, string]> = [
    [PROJECT_QUESTION_FORM_COPY.whatItIs, d.what_it_is],
    [PROJECT_QUESTION_FORM_COPY.checked, d.checked],
    [PROJECT_QUESTION_FORM_COPY.unknown, d.unknown],
    [PROJECT_QUESTION_FORM_COPY.ifNobody, d.if_nobody],
  ];
  for (const [label, value] of parts) {
    if (value.trim().length < PART_MIN) return `${label} needs a real sentence.`;
  }
  return null;
}

interface ProjectQuestionFormProps {
  /** Saves the question; true closes and clears the form. */
  onAsk: (draft: ProjectQuestionDraft) => Promise<boolean>;
}

/** "Ask a question" on a project: closed until asked for, then the question and the four parts every question carries. */
export function ProjectQuestionForm({ onAsk }: ProjectQuestionFormProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ProjectQuestionDraft>(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const [tried, setTried] = React.useState(false);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-testid="project-question-ask">
        {PROJECT_QUESTION_FORM_COPY.open}
      </Button>
    );
  }

  const problem = projectQuestionProblem(draft);
  const set = (k: keyof ProjectQuestionDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const close = () => {
    setOpen(false);
    setDraft(EMPTY);
    setTried(false);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (problem || saving) return;
    setSaving(true);
    const ok = await onAsk(draft);
    setSaving(false);
    if (ok) close();
  };

  return (
    <form onSubmit={submit} className="border border-border rounded-lg p-4 space-y-3" data-testid="project-question-form">
      <p className="text-sm text-text-sub">{PROJECT_QUESTION_FORM_COPY.intro}</p>
      <div>
        <Input label={PROJECT_QUESTION_FORM_COPY.question} value={draft.question} onChange={set('question')} maxLength={QUESTION_MAX} autoFocus />
        <p className="mt-1 text-xs text-text-sub">{PROJECT_QUESTION_FORM_COPY.questionHint}</p>
      </div>
      <Textarea label={PROJECT_QUESTION_FORM_COPY.whatItIs} value={draft.what_it_is} onChange={set('what_it_is')} />
      <Textarea label={PROJECT_QUESTION_FORM_COPY.checked} value={draft.checked} onChange={set('checked')} />
      <Textarea label={PROJECT_QUESTION_FORM_COPY.unknown} value={draft.unknown} onChange={set('unknown')} />
      <Textarea label={PROJECT_QUESTION_FORM_COPY.ifNobody} value={draft.if_nobody} onChange={set('if_nobody')} />
      {tried && problem ? (
        <p className="text-sm text-red-500" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {PROJECT_QUESTION_FORM_COPY.save}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={close} disabled={saving}>
          {PROJECT_QUESTION_FORM_COPY.cancel}
        </Button>
      </div>
    </form>
  );
}
