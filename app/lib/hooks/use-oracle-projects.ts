'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { Blocker } from '@/lib/oracle/projects/blockers';

// Oracle Projects Tab Phase 2 — the Projects tab's signals feed (GET /api/oracle/projects).
// 60s refetch: projects move slowly enough (task/comment/email cadence, not seconds) that
// this doesn't need the tighter polling the waiting-on-me feed uses.

export interface OracleProjectOwner {
  id: string;
  name: string;
  is_mike: boolean;
}

export interface OracleProjectNextStep {
  text: string;
  owner: { id: string; name: string } | null;
  // Phase 3 — an owner who isn't a User (e.g. a client contact, "Andy (client)").
  // Mutually exclusive with `owner`.
  owner_label: string | null;
  source: 'graph' | 'bast' | 'mike' | 'none';
  at: string | null;
}

export interface OracleProjectMovement {
  at: string;
  who: string;
  what: string;
}

export interface OracleProjectLinkedEmail {
  id: string;
  from: string;
  subject: string;
  gist: string | null;
  received_at: string; // ISO
  replied: boolean;
  deep_link: string;
}

export interface OracleProjectCard {
  id: string;
  name: string;
  client: { id: string; name: string };
  status: string;
  next_step: OracleProjectNextStep;
  last_movement: OracleProjectMovement | null;
  days_quiet: number | null;
  stale: boolean;
  stalled_on_mike: boolean;
  blockers: Blocker[];
  counts_by_kind: Record<string, number>;
  // Phase 3 — set while a next-step refresh is queued but not yet written.
  refresh_requested_at: string | null;
  open_url: string;
  // Phase 4 — the drawer's Email summary section.
  email_summary: string | null;
  email_summary_at: string | null;
  linked_emails: OracleProjectLinkedEmail[];
  // Phase 5 — the drawer's Dismissed items section.
  dismissals: OracleProjectDismissal[];
}

export interface OracleProjectDismissal {
  id: string;
  kind: string;
  source_id: string;
  source_marker: string | null;
  note: string | null;
  dismissed_at: string; // ISO
  dismissed_by: { id: string; name: string } | null;
}

export interface OracleProjectsResponse {
  projects: OracleProjectCard[];
  stalled_count: number;
  generated_at: string;
}

// Phase 5 carry-over E — `?lens=kind` removed: the by-kind lens derives its groups
// from this same lens-agnostic response via `deriveByKind()` (projects-logic.ts), so
// there is only ever one query key now.
export const oracleProjectsKeys = {
  all: ['oracle-projects'] as const,
};

export function useOracleProjects() {
  return useQuery({
    queryKey: oracleProjectsKeys.all,
    queryFn: () => apiClient.get<OracleProjectsResponse>('/oracle/projects'),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
