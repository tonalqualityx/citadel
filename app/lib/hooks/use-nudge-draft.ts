'use client';

import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';

// Oracle Projects Tab Phase 5 — POST /api/oracle/projects/nudge-draft. Never sends
// anything itself: NudgePanel posts a comment (through usePostInternalComment) for a
// 'comment' channel, or builds a mailto: link for an 'email' channel — Mike always
// sends the email himself.

export interface NudgeDraftInput {
  blocker_id: string;
  project_id: string;
  owner: { user_id?: string } | { contact_id?: string } | { label?: string };
}

export interface NudgeDraft {
  channel: 'comment' | 'email';
  to: string;
  subject?: string;
  body: string;
}

export function useNudgeDraft() {
  return useMutation({
    mutationFn: (data: NudgeDraftInput) => apiClient.post<NudgeDraft>('/oracle/projects/nudge-draft', data),
    onError: (error) => {
      showToast.apiError(error, 'Failed to draft the nudge');
    },
  });
}
