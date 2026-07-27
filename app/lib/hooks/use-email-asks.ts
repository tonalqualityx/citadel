'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { arcKeys } from '@/lib/hooks/use-arcs';
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';

// Clarity Phase 4a — email on the Seeing Stone. Reads (crisis/intake) come bundled inside
// GET /api/waiting-on-me (see use-waiting-on-me.ts) — this file is mutations only: the
// crisis strip's Handled action, the intake drawer's Open/Dismiss, and Create/Create+open.

export interface UpdateEmailAskInput {
  state?: 'open' | 'handled' | 'dismissed' | 'archive_requested';
  task_id?: string | null;
  training_note?: string | null;
  // Clarity Phase 6 — the meeting-lane card's "Add to calendar" button intent flag.
  calendar_requested?: boolean;
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

export interface AttachEmailAskInput {
  arc_id?: string;
  task_id?: string;
}

// Clarity Phase 3 (Seeing Stone Reckoning, spec Q4/Q11) — the intake drawer's "Attach
// to…" picker: POSTs to the already-built /api/email-asks/{id}/attach endpoint (arc_id
// XOR task_id), which sets state=handled server-side — the ask leaves the drawer's
// list the instant this succeeds, same "resolved from Mike's perspective immediately"
// convention as Archive/Dismiss. Invalidates the attached arc's own detail query too, so
// its attached-emails panel picks up the new email without a manual refresh.
export function useAttachEmailAsk() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: AttachEmailAskInput }) =>
      apiClient.post<EmailAsk>(`/email-asks/${id}/attach`, data),
    onSuccess: (_data, variables) => {
      invalidateEmailSurfaces(queryClient);
      if (variables.data.arc_id) {
        queryClient.invalidateQueries({ queryKey: arcKeys.detail(variables.data.arc_id) });
      }
      showToast.success('Attached');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to attach email');
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
