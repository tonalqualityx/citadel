'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface MentionSuggestionUser {
  id: string;
  name: string;
  email: string;
  role: 'tech' | 'pm' | 'admin';
  avatar_url: string | null;
}

export interface MentionSuggestionContact {
  id: string;
  name: string;
  email: string;
  role: string | null;
  is_primary: boolean;
}

export interface MentionSuggestionsResponse {
  users: MentionSuggestionUser[];
  contacts: MentionSuggestionContact[];
}

/**
 * Mention candidates for a task's comment composer: all active team members plus only this
 * task's client's contacts. See GET /api/tasks/[id]/mention-suggestions.
 */
export function useMentionSuggestions(taskId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['mention-suggestions', taskId],
    queryFn: () =>
      apiClient.get<MentionSuggestionsResponse>(`/tasks/${taskId}/mention-suggestions`),
    enabled: options?.enabled ?? !!taskId,
  });
}
