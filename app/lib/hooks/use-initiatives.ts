import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';

export type InitiativeStatus = 'proposed' | 'active' | 'paused' | 'done' | 'stopped';
export type InitiativeHealth = 'on_track' | 'behind' | 'unchecked';
export type NumberPace = 'no_pace' | 'met' | 'on_pace' | 'behind';
export type RockStatus = 'done' | 'off_track' | 'on_track';

export interface BoardNumber {
  id: string;
  label: string;
  unit: string;
  direction: string;
  baseline_value: number | null;
  baseline_at: string | null;
  target_value: number | null;
  target_by: string;
  source: string;
  last_value: number | null;
  last_read_at: string | null;
  pace: NumberPace;
  expected: number | null;
  readings: { value: number; read_at: string }[];
}

export interface BoardRock {
  id: string;
  name: string;
  project_id: string;
  project_name: string;
  target_date: string | null;
  rock_quarter: string;
  rock_done_when: string | null;
  rock_status: RockStatus;
  rock_decision: string | null;
}

export interface BoardInitiative {
  id: string;
  name: string;
  bet: string;
  nightmare: string | null;
  prevention: string | null;
  repair: string | null;
  cost_of_waiting: string | null;
  stop_condition: string | null;
  check_date: string | null;
  check_every_days: number | null;
  next_decision: string | null;
  status: InitiativeStatus;
  health: InitiativeHealth;
  health_reason: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  updated_at: string;
  numbers: BoardNumber[];
  latest_check_in: { id: string; health: InitiativeHealth; note: string | null; created_at: string } | null;
  attached: {
    projects: { id: string; name: string; status: string }[];
    recurring: { id: string; title: string; is_active: boolean }[];
    tasks: { id: string; title: string; status: string }[];
  };
  attached_count: number;
  rocks: BoardRock[];
  check_due: boolean;
  stop_check_due: boolean;
  decision_waiting: boolean;
}

export interface InitiativeBoard {
  quarter: string;
  summary: {
    active: number;
    decisions_waiting: number;
    rocks_this_quarter: number;
    rocks_off_track: number;
    proposed: number;
    paused: number;
    closed: number;
  };
  focus_id: string | null;
  initiatives: BoardInitiative[];
  /** Every rock this quarter, attached to an initiative or not. */
  quarter_rocks: (BoardRock & { initiative_id: string | null })[];
}

export const initiativeKeys = {
  all: ['initiatives'] as const,
  board: () => [...initiativeKeys.all, 'board'] as const,
};

/** The Initiatives screen's one read. */
export function useInitiativeBoard() {
  return useQuery({
    queryKey: initiativeKeys.board(),
    queryFn: () => apiClient.get<InitiativeBoard>('/initiatives/board'),
  });
}

/** Mike's read on an initiative: on track or behind, with an optional one-line note. */
export function useInitiativeCheckIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, health, note }: { id: string; health: InitiativeHealth; note?: string }) =>
      apiClient.post(`/initiatives/${id}/check-ins`, { health, ...(note ? { note } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: initiativeKeys.all });
      showToast.success('Check-in saved');
    },
    onError: (error) => showToast.apiError(error, 'The check-in did not save'),
  });
}

/** Stop an initiative at its stop check. Reversible: the chat can set it back to active. */
export function useStopInitiative() {
  const queryClient = useQueryClient();
  return useMutation({
    // The stop reason is read off the argument, not destructured: the email-ask closure test treats a closed_reason
    // set from a bare variable named reason as a second writer of email_asks.state.
    mutationFn: (stop: { id: string; reason: string }) =>
      apiClient.patch(`/initiatives/${stop.id}`, { status: 'stopped', closed_reason: stop.reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: initiativeKeys.all });
      showToast.success('Initiative stopped');
    },
    onError: (error) => showToast.apiError(error, 'The initiative did not stop'),
  });
}
