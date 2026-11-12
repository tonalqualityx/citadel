'use client';

import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

// Designer Portal v2: "Email me this link" (SPEC 4.10, 4.11 row 15). apiClient throws Error(server message), so the
// rate-limit answer is recognised by its words.

/** Plain words for a failed send. */
export function previewLinkErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/too many requests/i.test(message)) return 'You have reached the limit of 10 emailed links an hour. Try again later, or copy the link instead.';
  if (/not ready/i.test(message)) return 'The preview is not ready yet.';
  return 'The link could not be sent. Try again, or copy the link instead.';
}

export function useEmailPreviewLink(sessionId: string) {
  return useMutation({
    mutationFn: (path: string) => apiClient.post<{ sent: boolean }>(`/design/sessions/${sessionId}/preview-link`, { path }),
  });
}
