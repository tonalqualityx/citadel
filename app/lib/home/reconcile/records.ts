/** Home Slice 9a: what a reconcile action row stores under `before.reconcile` and `after.reconcile`, so Undo can reverse exactly it. */

export type ReconcileRecord =
  | { kind: 'note'; change_id: string; message_id: string | null; comment_id: string; task_id: string }
  | { kind: 'done'; change_id: string; task_id: string; status_before: string; time_entry_id: string | null; time_started_at: string | null; time_duration: number | null }
  | { kind: 'wait'; change_id: string; wait_id: string }
  | { kind: 'session'; change_id: string }
  | {
      kind: 'track';
      change_id: string;
      project_id: string | null;
      project_made: boolean;
      /** Every task Track it made, the done one first. */
      task_ids: string[];
      time_entry_id: string | null;
      time_started_at: string | null;
      time_duration: number | null;
    }
  | { kind: 'log_time'; task_id: string; time_entry_id: string; started_at: string; duration: number }
  | { kind: 'no'; change_id: string };

export function readRecord(v: unknown): ReconcileRecord | null {
  if (!v || typeof v !== 'object') return null;
  const r = (v as { reconcile?: unknown }).reconcile;
  if (!r || typeof r !== 'object' || typeof (r as { kind?: unknown }).kind !== 'string') return null;
  return r as ReconcileRecord;
}

/** The task a record is about (for the holds), or null. */
export function recordTaskId(rec: ReconcileRecord): string | null {
  return 'task_id' in rec ? rec.task_id : null;
}
