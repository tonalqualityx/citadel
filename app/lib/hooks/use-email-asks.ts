'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';

// Clarity Phase 4a — email on the Seeing Stone. Reads (crisis/intake) come bundled inside
// GET /api/waiting-on-me (see use-waiting-on-me.ts) — this file is mutations only: the
// crisis strip's Handled action, the intake drawer's Open/Dismiss, and Create/Create+open.

export interface UpdateEmailAskInput {
  state?: 'open' | 'handled' | 'dismissed';
  task_id?: string | null;
}

export interface CreateTaskFromEmailAskInput {
  arc_id?: string;
  arc_name?: string;
  sop_id?: string;
}

export interface EmailAskTaskResult {
  id: string;
  title: string;
  [key: string]: unknown;
}

function invalidateEmailSurfaces(queryClient: ReturnType<typeof useQueryClient>) {
  // Both the crisis strip and the intake drawer read off the SAME /api/waiting-on-me
  // response — one invalidation covers both, no separate email-asks query key exists.
  queryClient.invalidateQueries({ queryKey: ['waiting-on-me'] });
}

export function useUpdateEmailAsk() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateEmailAskInput }) =>
      apiClient.patch<EmailAsk>(`/email-asks/${id}`, data),
    onSuccess: () => {
      // Quiet: Handled/Dismiss are exception-clearing actions, not "created" moments —
      // no success toast, matching the Today pick completion's "sub-second, quiet" rule.
      invalidateEmailSurfaces(queryClient);
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update email');
    },
  });
}

/** Create (or, if already created, idempotently return) the Task behind an email ask. */
export function useCreateTaskFromEmailAsk() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: CreateTaskFromEmailAskInput }) =>
      apiClient.post<EmailAskTaskResult>(`/email-asks/${id}/create-task`, data ?? {}),
    onSuccess: (task) => {
      invalidateEmailSurfaces(queryClient);
      showToast.created(`Quest "${task.title}"`);
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create quest from email');
    },
  });
}
