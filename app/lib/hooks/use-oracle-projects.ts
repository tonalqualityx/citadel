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
}

export interface OracleProjectsResponse {
  projects: OracleProjectCard[];
  stalled_count: number;
  generated_at: string;
  by_kind?: Record<string, Array<{ blocker: Blocker; project: { id: string; name: string } }>>;
}

export const oracleProjectsKeys = {
  all: ['oracle-projects'] as const,
  lens: (lens?: 'kind') => [...oracleProjectsKeys.all, lens ?? 'default'] as const,
};

export function useOracleProjects(lens?: 'kind') {
  return useQuery({
    queryKey: oracleProjectsKeys.lens(lens),
    queryFn: () =>
      apiClient.get<OracleProjectsResponse>('/oracle/projects', { params: lens ? { lens } : undefined }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
