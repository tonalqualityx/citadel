'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { designKeys, pollInterval } from '@/lib/hooks/use-design';
import type { BriefBody } from '@/lib/design/brief-schema';

// Designer Portal v2: the Brief tab's data (SPEC 4.1, 4.11 rows 1 and 2).

export type BriefReactionKind = 'useful' | 'not_relevant';

/** The body as the route returns it: `client` is renamed `client_name` by the server's projection. */
export type BriefViewBody = Omit<BriefBody, 'client'> & { client_name?: string };

export interface BriefAssetView {
  id: string;
  kind: string;
  content_type: string | null;
  width: number | null;
  height: number | null;
  url: string | null;
}

export interface BriefReactionView {
  card_id: string;
  reaction: string;
  note: string | null;
}

export interface ClientStatementView {
  id: string;
  quote: string;
  speaker_name: string;
  speaker_role: string;
  source_date: string;
  source_kind: string;
  is_paraphrase: boolean;
  subject: string;
  category: string;
  polarity: string;
  status: string;
}

export interface BriefResponse {
  brief: { id: string; version: number; published_at: string | null; body: BriefViewBody } | null;
  assets: BriefAssetView[];
  reactions: BriefReactionView[];
  client_statements: ClientStatementView[];
}

export const briefKey = (sessionId: string) => [...designKeys.all, 'brief', sessionId] as const;

/** GET /api/design/sessions/:id/brief, polled gently (the drawer cadence: 15 s visible, 30 s hidden) so a new brief appears. */
export function useDesignBrief(sessionId: string, nextPollMs?: number | null) {
  return useQuery({
    queryKey: briefKey(sessionId),
    queryFn: () => apiClient.get<BriefResponse>(`/design/sessions/${sessionId}/brief`),
    refetchInterval: () => pollInterval(nextPollMs),
    refetchOnWindowFocus: false,
  });
}

export interface BriefReactionInput {
  card_id: string;
  reaction: BriefReactionKind;
  note?: string;
}

/** POST brief/reactions with an optimistic update; a failure restores the previous reactions. */
export function useBriefReaction(sessionId: string) {
  const qc = useQueryClient();
  const key = briefKey(sessionId);
  return useMutation({
    mutationFn: (input: BriefReactionInput) =>
      apiClient.post<{ reaction: BriefReactionView }>(`/design/sessions/${sessionId}/brief/reactions`, input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BriefResponse>(key);
      if (previous) {
        const next: BriefReactionView = { card_id: input.card_id, reaction: input.reaction, note: input.note ?? null };
        qc.setQueryData<BriefResponse>(key, {
          ...previous,
          reactions: [...previous.reactions.filter((r) => r.card_id !== input.card_id), next],
        });
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });
}
