'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { oracleProjectsKeys } from '@/lib/hooks/use-oracle-projects';

// Oracle Projects Tab Phase 5 — BlockerRow's Dismiss control and the drawer's Dismissed
// items list (with Undo). Both mutations invalidate the projects feed so the blocker
// disappears/reappears on the next fetch — same convention as every other Projects-tab
// mutation hook.

export interface CreateBlockerDismissalInput {
  kind: string;
  source_id: string;
  source_marker?: string | null;
  note?: string | null;
}

/** POST /api/oracle/projects/[id]/dismiss */
export function useCreateBlockerDismissal(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateBlockerDismissalInput) =>
      apiClient.post(`/oracle/projects/${projectId}/dismiss`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: oracleProjectsKeys.all });
      showToast.success('Dismissed');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to dismiss');
    },
  });
}

/** DELETE /api/oracle/projects/[id]/dismiss?dismissal_id=... — undo by the dismissal's
 * own id (distinct from the project id in the URL). */
export function useUndoBlockerDismissal(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dismissalId: string) =>
      apiClient.delete(`/oracle/projects/${projectId}/dismiss`, undefined, {
        params: { dismissal_id: dismissalId },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: oracleProjectsKeys.all });
      showToast.success('Restored');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to undo the dismissal');
    },
  });
}
