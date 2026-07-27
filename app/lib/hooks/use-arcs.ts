'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { hasCompletionNudge, showCompletionNudge } from '@/lib/hooks/use-completion-nudge';

// Clarity Phase 1/3 — Arc (lightweight micro-project grouping) reads/writes for the Oracle
// Today section and the arc board (/oracle/arcs/[id]).

export type ArcStatus = 'empty' | 'open' | 'complete';

export interface ArcTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  due_date: string | null;
  assignee_id: string | null;
  assignee: { id: string; name: string } | null;
  needs_review: boolean;
  approved: boolean;
  // Clarity Phase 4c — the arc board header's time estimate sums these across the arc's
  // open tasks.
  estimated_minutes: number | null;
}

// Clarity Phase 4c — the arc board header's session panel: one of the arc's linked
// sessions (origin_session_external_id + any arc_id-linked OracleSession rows, merged
// server-side — see lib/arc-sessions.ts).
export interface ArcSessionSummary {
  id: string;
  external_id: string;
  title: string | null;
  status: string;
  remote_url: string | null;
  needs_attention: boolean;
  last_event_at: string | null;
}

// Clarity Phase 7 — the arc detail's attached-email summary (see /api/arcs/[id]'s
// formatArcEmailAskSummary). Focus Mode's arc-linked deep-links read this.
export interface ArcEmailAskSummary {
  id: string;
  subject: string;
  from_email: string;
  from_name: string | null;
  gist: string | null;
  deep_link: string;
  received_at: string;
}

// Clarity Phase 3 (Seeing Stone Reckoning) — the arc workspace's accord panel: the
// sales-pipeline link's lead-contact summary. `status` is shown as plain text, never a
// stage-editing control (spec Q1: the glass never treats accord stage as the tracked
// thing).
export interface ArcAccordSummary {
  id: string;
  name: string;
  status: string;
  lead_name: string | null;
  lead_business_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
}

export interface ArcDetail {
  id: string;
  name: string;
  description: string | null;
  status: ArcStatus;
  client_id: string | null;
  client: { id: string; name: string } | null;
  project_id: string | null;
  project: { id: string; name: string; status: string } | null;
  origin_session_external_id: string | null;
  closed_at: string | null;
  // Clarity Phase 5 — the Soothsayer's snooze action.
  snoozed_until: string | null;
  // Clarity Phase 3 (Reckoning) — the anti-drop-net "act by" date, distinct from
  // snoozed_until ("hide until"). Never conflated (see the schema's own doc comment).
  next_touch: string | null;
  // Clarity Phase 3 (Reckoning) — the sales-pipeline link (was already returned by the
  // API since Phase 1; the type just hadn't caught up until the arc workspace needed it).
  accord_id: string | null;
  accord: ArcAccordSummary | null;
  // Clarity Phase 3 (Reckoning) — the arc board card's cover image.
  cover_url: string | null;
  // Clarity Phase 4c — the arc board header enrichment.
  estimate_override_minutes: number | null;
  estimated_minutes_total: number;
  sessions: ArcSessionSummary[];
  task_count: number;
  created_at: string;
  updated_at: string;
  tasks: ArcTask[];
  // Clarity Phase 7 — emails attached directly to this arc (was already in the API
  // response; the type just hadn't caught up until Focus Mode needed it for its
  // "attached email deep-links" panel — see focus-mode-logic.ts).
  email_asks: ArcEmailAskSummary[];
  // Clarity Phase 7 — present ONLY on the PATCH response for the newly-closing transition
  // (closed_at set, was null) when the arc has an attached email — see
  // use-completion-nudge.ts's hasCompletionNudge (key-presence check, not truthiness).
  completion_nudge?: { thread_id: string | null; subject: string; from_email: string };
}

// Clarity Phase 3 (Reckoning) — the sibling-arc surfacing hook: GET /api/arcs/{id}/context
// (the session-briefing endpoint) already computes "other arcs on the same accord" server-
// side; the arc workspace's accord panel reads the same endpoint for that one list rather
// than re-deriving it client-side.
export interface ArcContextSiblingArc {
  id: string;
  name: string;
  closed_at: string | null;
}

export interface ArcContext {
  arc: {
    id: string;
    name: string;
    description: string | null;
    status: ArcStatus;
    next_touch: string | null;
    snoozed_until: string | null;
    closed_at: string | null;
    cover_url: string | null;
    created_at: string;
    updated_at: string;
  };
  client: { id: string; name: string } | null;
  project: { id: string; name: string; status: string } | null;
  accord: (ArcAccordSummary & { other_arcs: ArcContextSiblingArc[] }) | null;
  tasks: {
    open: Array<{ id: string; title: string; status: string; priority: number; due_date: string | null }>;
    recent: Array<{ id: string; title: string; status: string; priority: number; due_date: string | null; updated_at: string }>;
  };
  emails: Array<{ id: string; subject: string; gist: string | null; deep_link: string; received_at: string }>;
  sessions: Array<{
    external_id: string;
    title: string | null;
    status: string;
    goal: string | null;
    waiting_on: string | null;
    last_event_at: string | null;
  }>;
  next_touch: string | null;
  activity: {
    last_task_activity_at: string | null;
    last_email_received_at: string | null;
    last_session_activity_at: string | null;
    arc_updated_at: string;
  };
}

export interface ArcSummary {
  id: string;
  name: string;
  description: string | null;
  status: ArcStatus;
  client_id: string | null;
  client: { id: string; name: string } | null;
  project_id: string | null;
  project: { id: string; name: string; status: string } | null;
  origin_session_external_id: string | null;
  closed_at: string | null;
  // Clarity Phase 5 — the Soothsayer's snooze action.
  snoozed_until: string | null;
  // Clarity Phase 4c — always present (a raw column); the list endpoint doesn't compute
  // estimated_minutes_total/sessions (those need extra queries only the detail route does).
  estimate_override_minutes: number | null;
  task_count: number;
  created_at: string;
  updated_at: string;
}

export interface ArcsResponse {
  arcs: ArcSummary[];
  total: number;
}

export const arcKeys = {
  all: ['arcs'] as const,
  list: (status?: string) => [...arcKeys.all, 'list', status ?? 'any'] as const,
  detail: (id: string) => [...arcKeys.all, 'detail', id] as const,
  context: (id: string) => [...arcKeys.all, 'context', id] as const,
};

export function useArcs(status?: ArcStatus) {
  return useQuery({
    queryKey: arcKeys.list(status),
    queryFn: () => apiClient.get<ArcsResponse>('/arcs', { params: status ? { status } : undefined }),
  });
}

export function useArc(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: arcKeys.detail(id),
    queryFn: () => apiClient.get<ArcDetail>(`/arcs/${id}`),
    enabled: options?.enabled ?? !!id,
  });
}

// Clarity Phase 3 (Reckoning) — the arc workspace's accord panel: sibling arcs on the
// same accord (the "relevant details from earlier rounds" hook).
export function useArcContext(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: arcKeys.context(id),
    queryFn: () => apiClient.get<ArcContext>(`/arcs/${id}/context`),
    enabled: options?.enabled ?? !!id,
  });
}

export interface CreateArcInput {
  name: string;
  description?: string | null;
  client_id?: string | null;
}

// Clarity Phase 3 (Reckoning, spec Q4) — the New-arc button: starts a shapeless
// container (name + optional client, zero other required structure); the caller
// navigates straight into the new arc's workspace page on success.
export function useCreateArc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateArcInput) => apiClient.post<ArcDetail>('/arcs', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: arcKeys.all });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create arc');
    },
  });
}

// Clarity Phase 3 (Reckoning) — the arc workspace's next-touch inline edit (spec Q2's
// real, distinct-from-snooze "act by" column).
export function useUpdateArcNextTouch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, nextTouch }: { id: string; nextTouch: string | null }) =>
      apiClient.patch<ArcDetail>(`/arcs/${id}`, { next_touch: nextTouch }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: arcKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: arcKeys.all });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update next touch');
    },
  });
}

export function useCloseArc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, close }: { id: string; close: boolean }) =>
      apiClient.patch<ArcDetail>(`/arcs/${id}`, { closed_at: close ? new Date().toISOString() : null }),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: arcKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: arcKeys.all });
      // Clarity Phase 7 (P2) — the completion nudge (spec Q12).
      if (hasCompletionNudge(data)) showCompletionNudge(data.completion_nudge);
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update arc');
    },
  });
}

// Clarity Phase 4c — the arc board header's time-estimate override. `minutes: null`
// clears the override (reverts the display to the computed estimated_minutes_total).
export function useUpdateArcEstimate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, minutes }: { id: string; minutes: number | null }) =>
      apiClient.patch<ArcDetail>(`/arcs/${id}`, { estimate_override_minutes: minutes }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: arcKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: arcKeys.all });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update estimate');
    },
  });
}

// Clarity Phase 5 — the Soothsayer's snooze action. `snoozedUntil: null` un-snoozes.
export function useSnoozeArc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, snoozedUntil }: { id: string; snoozedUntil: string | null }) =>
      apiClient.patch<ArcDetail>(`/arcs/${id}`, { snoozed_until: snoozedUntil }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: arcKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: arcKeys.all });
      queryClient.invalidateQueries({ queryKey: ['soothsayer'] });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update snooze');
    },
  });
}
