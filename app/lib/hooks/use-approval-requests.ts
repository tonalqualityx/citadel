'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { oracleProjectsKeys } from '@/lib/hooks/use-oracle-projects';

// Oracle Projects Tab Phase 5 — the client-approval loop's own hooks, backing
// ApprovalPanel. The approval-requests feed lives at its own top-level route
// (/api/approval-requests, not nested under /api/oracle/projects), but every mutation
// still invalidates oracleProjectsKeys.all too — a status change here changes what the
// client_approval blocker on the Projects tab shows.

export type ApprovalRequestStatus =
  | 'draft'
  | 'queued'
  // Phase 5 fixes (HIGH-1/MEDIUM-1) — the machine-side sender's own claim, stamped
  // right before it invokes gog. Transient and read-only in the UI: ApprovalPanel offers
  // no action while a row is here (mirrors 'sent' — nothing to edit, nothing to cancel).
  | 'sending'
  | 'sent'
  | 'replied'
  | 'approved'
  | 'changes_requested'
  | 'cancelled';

export interface ApprovalRequest {
  id: string;
  task_id: string;
  task: { id: string; title: string } | null;
  project_id: string;
  contact_id: string | null;
  contact: { id: string; name: string | null; email: string } | null;
  status: ApprovalRequestStatus;
  subject: string;
  body: string;
  to_email: string | null;
  draft_source: 'graph' | 'bast' | 'mike' | null;
  message_id: string | null;
  thread_id: string | null;
  sent_at: string | null;
  replied_at: string | null;
  reply_excerpt: string | null;
  chase_after_days: number;
  seen_in_meeting_at: string | null;
  queued_at: string | null;
  queued_by_id: string | null;
  cancelled_at: string | null;
  approved_at: string | null;
  changes_requested_at: string | null;
  send_attempt_at: string | null;
  send_error: string | null;
  send_error_count: number;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export const approvalRequestsKeys = {
  all: ['approval-requests'] as const,
  byTask: (taskId: string) => [...approvalRequestsKeys.all, 'task', taskId] as const,
};

/** GET /api/approval-requests?task_id=... — ApprovalPanel's own fetch for one task's
 * approval history (status timeline, most recent row's editable draft, etc). */
export function useApprovalRequestsForTask(taskId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: approvalRequestsKeys.byTask(taskId),
    queryFn: () => apiClient.get<{ requests: ApprovalRequest[] }>('/approval-requests', { params: { task_id: taskId } }),
    enabled: (options?.enabled ?? true) && !!taskId,
  });
}

export interface CreateApprovalRequestInput {
  task_id: string;
  contact_id?: string | null;
  to_email?: string | null;
  subject?: string;
  body?: string;
}

/** POST /api/approval-requests — creates a draft. Never sends anything by itself. */
export function useCreateApprovalRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateApprovalRequestInput) => apiClient.post<ApprovalRequest>('/approval-requests', data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: approvalRequestsKeys.byTask(created.task_id) });
      queryClient.invalidateQueries({ queryKey: oracleProjectsKeys.all });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create the approval request');
    },
  });
}

export interface UpdateApprovalRequestInput {
  subject?: string;
  body?: string;
  to_email?: string | null;
  status?: 'queued' | 'cancelled' | 'approved' | 'changes_requested';
  reply_note?: string;
}

/** PATCH /api/approval-requests/[id] — the state-machine transitions plus draft edits.
 * `taskId` is only needed to invalidate the right query key; the route itself is keyed
 * purely on the approval request's own id. */
export function useUpdateApprovalRequest(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateApprovalRequestInput }) =>
      apiClient.patch<ApprovalRequest>(`/approval-requests/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalRequestsKeys.byTask(taskId) });
      queryClient.invalidateQueries({ queryKey: oracleProjectsKeys.all });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update the approval request');
    },
  });
}
