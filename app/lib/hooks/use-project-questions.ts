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
  task: { id: string; title: string; status: string; project_id: string | null; project: { id: string; name: string } | null };
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
        const out = await apiClient.post<{ released_task_ids?: string[] }>(`/tasks/${q.task_id}/questions/${q.id}/answer`, body);
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
      queryClient.invalidateQueries({ queryKey: questionKeys.task(q.task_id) });
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(q.task_id) });
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
