import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { taskKeys } from '@/lib/api/query-keys';
import { HOME_KEYS } from '@/lib/hooks/use-home';
import type { QuestionAnswerBody, QuestionView } from '@/lib/tasks/question-context';

export const questionKeys = {
  all: ['task-questions'] as const,
  task: (taskId: string) => ['task-questions', taskId] as const,
};

export interface TaskQuestionsResponse {
  questions: QuestionView[];
  open_count: number;
}

export const QUESTION_FAILURE_TEXT = "That answer didn't save. Nothing changed.";

/** GET /api/tasks/:id/questions. A 404 (not visible to this person) reads as no questions. */
export function useTaskQuestions(taskId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: questionKeys.task(taskId ?? 'none'),
    enabled: enabled && !!taskId,
    queryFn: async (): Promise<TaskQuestionsResponse> => {
      try {
        return await apiClient.get<TaskQuestionsResponse>(`/tasks/${taskId}/questions`);
      } catch {
        return { questions: [], open_count: 0 };
      }
    },
    staleTime: 15_000,
    retry: 0,
  });
}

/** `(question id, answer) => Promise<boolean>`: saves Mike's answer, then refreshes the list, the card and the home screen counts. */
export function useAnswerQuestion(taskId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    async (qid: string, body: QuestionAnswerBody): Promise<boolean> => {
      try {
        await apiClient.post(`/tasks/${taskId}/questions/${qid}/answer`, body);
      } catch {
        showToast.error(QUESTION_FAILURE_TEXT);
        return false;
      }
      showToast.success('Answer saved.');
      await queryClient.invalidateQueries({ queryKey: questionKeys.task(taskId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      try {
        await queryClient.refetchQueries({ queryKey: HOME_KEYS.all });
      } catch {
        // the old home screen stays
      }
      return true;
    },
    [queryClient, taskId],
  );
}
