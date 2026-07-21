'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';

// Clarity Phase 1/3 — the Oracle header's idea quick-add ("idea: … files straight to the
// Ideas list") posts here with source='oracle'.

export interface CreateIdeaInput {
  text: string;
  source: 'session' | 'oracle' | 'email';
  source_ref?: string | null;
  created_by_id?: string | null;
}

export interface Idea {
  id: string;
  text: string;
  source: 'session' | 'oracle' | 'email';
  source_ref: string | null;
  status: 'open' | 'kept' | 'promoted' | 'discarded';
  promoted_task_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useCreateIdea() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateIdeaInput) => apiClient.post<Idea>('/ideas', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ideas'] });
      showToast.success('Caught');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to catch that idea');
    },
  });
}
