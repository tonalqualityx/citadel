'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { taskKeys } from '@/lib/api/query-keys';
import { todayKeys } from '@/lib/hooks/use-today';
import { timeEntryKeys } from '@/lib/hooks/use-time-entries';
import type { TodayPick } from '@/lib/hooks/use-today';
import { formatParkNoteText, type ParkNoteInput } from '@/components/domain/oracle/focus/focus-mode-logic';

// Clarity Phase 7 (Seeing Stone Reckoning P2) — Focus Mode's park action (spec Q8). The
// spec's literal wording is "appended to the task description" — that's exactly what
// happens for a task-type pick (a real BlockNote paragraph append via the existing task
// PATCH). Every OTHER pick type (arc/session/note/lead) has no task description to append
// to, so the same capture appends to the Today pick's own free-form `label` field instead
// (already PATCH-able, always present, same "closes the loop somewhere real" guarantee) —
// a documented, deliberate deviation from the literal task-only wording, not a silent gap.
//
// TimeEntry recording is scoped to task-type picks only: TimeEntry's schema carries
// task_id/project_id, never arc_id/session_external_id/pick_id, so it's the one pick type
// that link cleanly. (OracleEvent — the spec's suggested fallback — requires a NOT NULL
// machine_id FK to an OracleMachine row; a browser-triggered focus session has no machine
// context, so it doesn't fit either. Elapsed-time recording for non-task picks is simply
// skipped rather than forced into a model it doesn't belong in — the park note capture
// itself, the load-bearing research-backed behavior, still always happens.)

interface ParkParams {
  pick: TodayPick;
  note: ParkNoteInput;
  nowMs: number;
  startedAtMs: number;
  // The task's CURRENT description (already fetched by FocusMode while it was displaying
  // the card) — passed in rather than re-fetched, since the caller already has it cached.
  currentTaskDescription?: unknown;
}

function appendParagraph(existing: unknown, text: string): unknown[] {
  const blocks = Array.isArray(existing) ? existing : [];
  return [
    ...blocks,
    {
      id: crypto.randomUUID(),
      type: 'paragraph',
      content: [{ type: 'text', text, styles: {} }],
    },
  ];
}

export function useParkFocusSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ pick, note, nowMs, startedAtMs, currentTaskDescription }: ParkParams) => {
      const text = formatParkNoteText(note, nowMs);

      if (pick.item_type === 'task' && pick.task_id) {
        await apiClient.patch(`/tasks/${pick.task_id}`, {
          description: appendParagraph(currentTaskDescription, text),
        });

        const minutes = Math.max(0, Math.round((nowMs - startedAtMs) / 60_000));
        if (minutes > 0) {
          await apiClient.post('/time-entries', {
            task_id: pick.task_id,
            started_at: new Date(startedAtMs).toISOString(),
            ended_at: new Date(nowMs).toISOString(),
            duration: minutes,
            description: 'Focus session',
          });
        }
      } else {
        await apiClient.patch(`/today/${pick.id}`, { label: text });
      }
    },
    onSuccess: (_data, variables) => {
      if (variables.pick.task_id) {
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(variables.pick.task_id) });
        queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      }
      queryClient.invalidateQueries({ queryKey: todayKeys.all });
      queryClient.invalidateQueries({ queryKey: timeEntryKeys.all });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to save where you left off');
    },
  });
}
