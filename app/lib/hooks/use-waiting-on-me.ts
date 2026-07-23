'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

// Clarity Phase 1/3 — the merged "everything waiting on Mike" feed backing the Oracle's
// Needs Reshi section (Decide/Answer/Review columns; `do` is fetched but deliberately not
// rendered there — DO-work surfaces via Today/quests instead, per the mockup's own note).

export interface WaitingOnMeCard {
  type: 'task' | 'session_ask';
  id: string;
  title: string | null;
  status: string;
  priority: number | null;
  severity: 'client_blocking' | 'launch_blocking' | 'internal' | null;
  task_id: string | null;
  session_external_id: string | null;
  arc: { id: string; name: string } | null;
  // Clarity Phase 5 — the Review column's client grouping. Task cards carry it when set;
  // session_ask cards never do (they fall back to arc, then "Other").
  client: { id: string; name: string } | null;
  due_date: string | null;
  // Clarity Phase 5 — the Review grouping's "oldest-wait age" (best-available proxy per
  // card kind — see app/api/waiting-on-me/route.ts's taskToCard/sessionToCard).
  waiting_since: string | null;
}

// Clarity Phase 5 — a `waiting` queue item additionally carries which of the (now-merged)
// decide/answer queues it came from, for the small type chip.
export interface WaitingQueueCard extends WaitingOnMeCard {
  queue_type: 'decision' | 'reply';
}

// Clarity Phase 4a — email on the Seeing Stone. Its own surface: never merged into
// decide/answer/review/do.
export interface EmailAsk {
  id: string;
  message_id: string;
  thread_id: string | null;
  account: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  gist: string | null;
  queue: 'decide' | 'answer' | 'review' | 'do' | null;
  severity: 'client_blocking' | 'launch_blocking' | 'internal' | null;
  is_urgent: boolean;
  // Clarity Phase 4b: archive_requested — Mike's Archive action; drops out of the intake
  // drawer immediately (its query filters state=open), the classifier executes the real
  // Gmail archive machine-side on its next pass.
  state: 'open' | 'handled' | 'dismissed' | 'archive_requested';
  // Clarity Phase 4b — Mike's own correction/calibration note on this classification.
  training_note: string | null;
  // Clarity Phase 6 — email lanes & calendar intents. null intent renders as "general"
  // (see components/domain/oracle/intake/intake-drawer-logic.ts's laneForAsk). The
  // proposed_event_* trio is the classifier's HIGH-CONFIDENCE parsed meeting date only —
  // null means no parsed time and no Add-to-calendar affordance (never guessed).
  // calendar_event_id is set only by the machine-side cron, never by this UI.
  intent: 'general' | 'meeting' | 'sales' | null;
  proposed_event_at: string | null;
  proposed_event_title: string | null;
  proposed_event_minutes: number | null;
  calendar_requested: boolean;
  calendar_event_id: string | null;
  task_id: string | null;
  deep_link: string;
  received_at: string;
  created_at: string;
  updated_at: string;
}

export interface WaitingOnMeResponse {
  // Clarity Phase 5 — the merged "Waiting on you" queue the UI reads. decide/answer stay
  // below, unchanged, for API back-compat for one release.
  waiting: WaitingQueueCard[];
  decide: WaitingOnMeCard[];
  answer: WaitingOnMeCard[];
  review: WaitingOnMeCard[];
  do: WaitingOnMeCard[];
  // Clarity Phase 4a
  crisis: EmailAsk[];
  intake: {
    count: number;
    newest_at: string | null;
    // Clarity Phase 6 — per-lane counts backing the header trigger chip's three quiet
    // counts. Null intent counts as general, same rule the drawer's own grouping uses.
    lanes: { general: number; meeting: number; sales: number };
    items: EmailAsk[];
  };
  meta: {
    counts: { waiting: number; decide: number; answer: number; review: number; do: number; total: number };
  };
}

export function useWaitingOnMe(userId?: string) {
  return useQuery({
    queryKey: ['waiting-on-me', userId ?? 'self'],
    queryFn: () =>
      apiClient.get<WaitingOnMeResponse>('/waiting-on-me', { params: userId ? { user_id: userId } : undefined }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
