'use client';

/**
 * Client hooks for "What the home screen learned" (Slice 7b). Sentences only: the server never sends a weight.
 * Browser session only: the routes answer 403 to an API key, so the chat cannot reach them.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { HOME_KEYS } from '@/lib/hooks/use-home';

export interface HomeLearnedItem {
  evidence_key: string;
  sentence: string;
  since: string | null;
}

export interface HomeLearned {
  on: boolean;
  items: HomeLearnedItem[];
}

export const HOME_LEARNED_KEY = ['home', 'learned'] as const;
const FAILURE = "That didn't go through. Nothing changed.";

export function useHomeLearned(enabled = true) {
  return useQuery({
    queryKey: HOME_LEARNED_KEY,
    queryFn: () => apiClient.get<HomeLearned>('/home/learned'),
    enabled,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

type Body = { action: 'put_back'; evidence_key: string } | { action: 'learning'; on: boolean };

export function useHomeLearnedChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Body) => apiClient.post<HomeLearned & { ok: true }>('/home/learned', body),
    onSuccess: (res, body) => {
      queryClient.setQueryData(HOME_LEARNED_KEY, { on: res.on, items: res.items });
      queryClient.invalidateQueries({ queryKey: HOME_KEYS.all });
      showToast.success(body.action === 'put_back' ? 'Put back.' : res.on ? 'Learning is on.' : 'Learning is off.');
    },
    onError: (error) => {
      showToast.error(error instanceof Error && error.message ? error.message : FAILURE);
    },
  });
}
