'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { projectKeys, taskKeys } from '@/lib/api/query-keys';
import { HOME_KEYS } from '@/lib/hooks/use-home';
import { questionKeys, QUESTION_FAILURE_TEXT } from '@/lib/hooks/use-task-questions';
import { QUESTION_CHANGED_MESSAGE, type QuestionAnswerBody, type QuestionView } from '@/lib/tasks/question-context';

/** One open question on a project card, as GET /api/questions returns it: the question, its card, and who asked it. */
export interface ProjectQuestion extends QuestionView {
  created_at: string;
  asked_by_lane: string | null;
  asked_by: { id: string; name: string } | null;
  /** The question's card. Null for a project question (asked on the project itself). */
  task: { id: string; title: string; status: string; project_id: string | null; project: { id: string; name: string } | null } | null;
  project?: { id: string; name: string } | null;
}

export interface ProjectQuestionsResponse {
  questions: ProjectQuestion[];
  total: number;
}

/** The most the screen reads in one go (the route's own ceiling). */
export const PROJECT_QUESTIONS_LIMIT = 500;

/** Every open question on the project's cards, oldest first (GET /api/questions?state=open&project_id=). pm and admin only; Triage cards count for Mike only. */
export function useProjectQuestions(projectId: string, enabled = true) {
  return useQuery({
    queryKey: projectKeys.questions(projectId),
    queryFn: () =>
      apiClient.get<ProjectQuestionsResponse>(`/questions?state=open&for=all&project_id=${encodeURIComponent(projectId)}&limit=${PROJECT_QUESTIONS_LIMIT}&include_triage=1`),
    enabled: enabled && !!projectId,
    staleTime: 15_000,
  });
}

/** "Answer saved." plus how many waiting cards the answer let go. */
export function answerSavedText(released: number): string {
  if (released === 0) return 'Answer saved.';
  return `Answer saved. ${released} ${released === 1 ? 'card it held is' : 'cards it held are'} free to start.`;
}

/**
 * `(question, answer) => Promise<boolean>`: saves Mike's answer on the question's own card (the same route the card screen uses, which releases
 * the cards the question blocked), then refreshes the project's questions, the project, the card and the home screen counts.
 */
export function useAnswerProjectQuestion(projectId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    async (q: Pick<ProjectQuestion, 'id' | 'task_id'>, body: QuestionAnswerBody): Promise<boolean> => {
      let released = 0;
      try {
        // A card question is answered on its card; a project question (no card) on the project.
        const path = q.task_id ? `/tasks/${q.task_id}/questions/${q.id}/answer` : `/projects/${projectId}/questions/${q.id}/answer`;
        const out = await apiClient.post<{ released_task_ids?: string[] }>(path, body);
        released = out?.released_task_ids?.length ?? 0;
      } catch (e) {
        if (e instanceof Error && e.message === QUESTION_CHANGED_MESSAGE) {
          // The question changed after he opened it: show the new wording and ask again.
          showToast.error(QUESTION_CHANGED_MESSAGE);
          await queryClient.invalidateQueries({ queryKey: projectKeys.questions(projectId) });
          return false;
        }
        showToast.error(QUESTION_FAILURE_TEXT);
        return false;
      }
      showToast.success(answerSavedText(released));
      await queryClient.invalidateQueries({ queryKey: projectKeys.questions(projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.communication(projectId) });
      if (q.task_id) {
        queryClient.invalidateQueries({ queryKey: questionKeys.task(q.task_id) });
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(q.task_id) });
      }
      queryClient.invalidateQueries({ queryKey: taskKeys.byProject(projectId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      try {
        await queryClient.refetchQueries({ queryKey: HOME_KEYS.all });
      } catch {
        // the old home screen stays
      }
      return true;
    },
    [queryClient, projectId],
  );
}

/** What the "Ask a question" form collects: the question and the Context parts the server requires of every question. */
export interface ProjectQuestionDraft {
  question: string;
  what_it_is: string;
  checked: string;
  unknown: string;
  if_nobody: string;
}

/** The body the project question route takes for a question a person typed: their own words are the source, and it waits for its answer. */
export function projectQuestionBody(draft: ProjectQuestionDraft, askerName: string, today: string) {
  return {
    question: draft.question.trim(),
    what_it_is: draft.what_it_is.trim(),
    sources: [{ who: askerName.trim() || 'Staff', said: draft.what_it_is.trim().slice(0, 1000), at: today }],
    checked: draft.checked.trim(),
    unknown: draft.unknown.trim(),
    if_nobody: draft.if_nobody.trim(),
    if_nobody_action: 'wait' as const,
  };
}

/**
 * `(draft) => Promise<boolean>`: asks a question on the project itself (no card), then refreshes the project's questions. The server's own
 * message is shown when it refuses the question (a part too short, the same question already open, ten already open).
 */
export function useAskProjectQuestion(projectId: string, askerName: string) {
  const queryClient = useQueryClient();
  return useCallback(
    async (draft: ProjectQuestionDraft): Promise<boolean> => {
      try {
        await apiClient.post(`/projects/${projectId}/questions`, projectQuestionBody(draft, askerName, new Date().toISOString().slice(0, 10)));
      } catch (e) {
        showToast.apiError(e, 'The question could not be saved');
        return false;
      }
      showToast.success('Question added.');
      await queryClient.invalidateQueries({ queryKey: projectKeys.questions(projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.communication(projectId) });
      return true;
    },
    [queryClient, projectId, askerName],
  );
}
