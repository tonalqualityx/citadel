import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { taskKeys } from '@/lib/api/query-keys';
import { triageCardKeys } from '@/lib/hooks/use-triage-card';
import type { PlanOut, PlanSectionName } from '@/lib/tasks/plan-schema';

export const planKeys = {
  all: ['task-plan'] as const,
  task: (taskId: string) => ['task-plan', taskId] as const,
};

/** GET /api/tasks/:id/plan. A 403 or 404 (not for this person) reads as null, so the tab is simply not there. */
export function useTaskPlan(taskId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: planKeys.task(taskId ?? 'none'),
    enabled: enabled && !!taskId,
    queryFn: async (): Promise<PlanOut | null> => {
      try {
        return await apiClient.get<PlanOut>(`/tasks/${taskId}/plan`);
      } catch {
        return null;
      }
    },
    staleTime: 5_000,
    retry: 0,
  });
}

/** The owner's two per-item controls: Remove and Mark wrong. Each refreshes the plan and the card (triage_rev moved). Returns true when it saved. */
export function usePlanItemActions(taskId: string) {
  const queryClient = useQueryClient();
  const run = useCallback(
    async (section: PlanSectionName, body: Record<string, unknown>): Promise<boolean> => {
      try {
        await apiClient.patch(`/tasks/${taskId}/plan/${section}`, body);
      } catch {
        showToast.error("That didn't save. Nothing changed.");
        return false;
      } finally {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: planKeys.task(taskId) }),
          queryClient.invalidateQueries({ queryKey: triageCardKeys.task(taskId) }),
          queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) }),
        ]);
      }
      return true;
    },
    [taskId, queryClient],
  );
  return {
    remove: (section: PlanSectionName, id: string) => run(section, { op: 'remove', id }),
    markWrong: (section: PlanSectionName, id: string, wrong: boolean) => run(section, { op: 'mark_wrong', id, wrong }),
  };
}
