'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { designKeys } from '@/lib/hooks/use-design';

// Designer Portal publish hooks (design D5, 7.1). The two-step publish: intent (token + what the dialog shows),
// then confirm (token + the typed main branch). apiClient throws Error(server message); the status is not kept.

export interface PublishGate {
  name: string;
  ok: boolean;
  summary?: string;
}

export interface PublishShown {
  target_label: string;
  target_words: string;
  heading: string;
  button_label: string;
  tone: 'client_preview' | 'production';
  live_url: string | null;
  main_role: 'client_preview' | 'production';
  main_branch: string;
  type_to_confirm: string;
  head_sha: string | null;
  diff_summary: { files_changed: number; insertions: number; deletions: number };
  files_changed: string[];
  pages_affected: string[];
  gates: { status: 'green' | 'red' | 'unknown'; entries: PublishGate[] };
  cost_usd: number;
}

export interface PublishIntent {
  publish_id: string;
  confirmation_token: string;
  expires_at: string;
  shown: PublishShown;
}

export interface PublishChange {
  id: string;
  summary: string;
  data_libs: string[];
  pages: string[];
  before_asset_ids: string[];
  after_asset_ids: string[];
  decision: string;
  edit_scope?: string | null;
  render_count?: number | null;
}

export interface PublishRecord {
  id: string;
  session_id: string;
  site_id: string;
  kind: 'publish' | 'rollback' | string;
  rolls_back_id: string | null;
  actor_id: string;
  actor_role: string;
  main_role: string;
  confirmation_shown: Partial<PublishShown> | null;
  confirmation_typed: string | null;
  confirmed_at: string | null;
  status: string;
  head_sha: string | null;
  from_main_sha: string | null;
  result_sha: string | null;
  deploy_url: string | null;
  alias_url: string | null;
  gates: unknown;
  diff_summary: unknown;
  cost_usd: number | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  [key: string]: unknown;
}

export interface PublishPageResponse {
  publish: PublishRecord;
  session: { id: string; task: { id: string; title: string }; designer: { name: string } };
  changes: PublishChange[];
  can_rollback: boolean;
  rollback_reason?: string;
}

export const publishKeys = {
  detail: (id: string) => [...designKeys.all, 'publish', id] as const,
};

export const PUBLISH_ACTIVE_STATUSES = ['awaiting_confirmation', 'queued', 'running'] as const;
export const PUBLISH_POLL_MS = 3000;

export function usePublishPage(id: string) {
  return useQuery({
    queryKey: publishKeys.detail(id),
    queryFn: () => apiClient.get<PublishPageResponse>(`/design/publishes/${id}`),
    refetchInterval: (query) => {
      const status = (query.state.data as PublishPageResponse | undefined)?.publish.status;
      return status && (PUBLISH_ACTIVE_STATUSES as readonly string[]).includes(status) ? PUBLISH_POLL_MS : false;
    },
  });
}

/** Step 1: POST /sessions/:id/publish {head_sha}. Queues nothing; hands back the token and what to show. */
export function useCreatePublishIntent(sessionId: string) {
  return useMutation({
    mutationFn: (headSha: string) => apiClient.post<PublishIntent>(`/design/sessions/${sessionId}/publish`, { head_sha: headSha }),
  });
}

/** Step 2: POST /publishes/:id/confirm. The dialog only calls this with a token and the exact branch name. */
export function useConfirmPublish(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { publishId: string; confirmation_token: string; typed_confirmation: string }) =>
      apiClient.post<{ publish_id: string }>(`/design/publishes/${v.publishId}/confirm`, {
        confirmation_token: v.confirmation_token,
        typed_confirmation: v.typed_confirmation,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designKeys.session(sessionId) });
      queryClient.invalidateQueries({ queryKey: designKeys.feedHistory(sessionId) });
    },
  });
}

/** POST /sessions/:id/request-publish {note?}: an FYI to the owner, only where an admin override switched designer publish off. */
export function useRequestPublish(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => apiClient.post(`/design/sessions/${sessionId}/request-publish`, note.trim() ? { note: note.trim() } : {}),
    onSuccess: () => {
      showToast.success('Sent to the owner');
      queryClient.invalidateQueries({ queryKey: designKeys.session(sessionId) });
    },
    onError: (e) => showToast.apiError(e, 'Could not send the note'),
  });
}

/** POST /publishes/:id/rollback: one click; the dialog is the confirmation. 202 {publish_id} of the rollback row. */
export function useRollbackPublish(publishId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<{ publish_id: string }>(`/design/publishes/${publishId}/rollback`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designKeys.all });
    },
    onError: (e) => showToast.apiError(e, 'Could not roll back'),
  });
}
