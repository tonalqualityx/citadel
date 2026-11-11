/**
 * Slice 2a keeper, part 2: read the dates already on the owner's tasks, once per task. Pure.
 *
 * Covers open tasks with a due_date, no Task.hard_due_at, no Slice 1 hard date (promised_to, job-watch or lifeline
 * tag) and no dates_read_at. A due date 4 to 6 days after creation is an invented default and is set aside; so is one
 * more than 14 days in the past. Anything else is read as "date from the task, source unclear". Nothing on the Task
 * changes; the outcome lives on the owner's home_item_state row.
 */

import { DATE_READ } from '../rules';
import { calendarDaysUntilDue, dueCivil, hardDateInfo } from '../score';
import { taskKey } from '../item-key';
import type { KeeperDateChange, RawItemState, RawTask } from '../types';

/** 'YYYY-MM-DD' of the civil day a due date stands for. */
export function dueYmd(due: Date): string {
  const c = dueCivil(due);
  return `${String(c.y).padStart(4, '0')}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

/** The class of one task's date, or null when it is not for the keeper to read. */
export function classifyDate(task: RawTask, state: RawItemState | undefined, now: Date): 'read' | 'set_aside' | null {
  if (!task.due_date) return null;
  if (task.hard_due_at) return null;
  if (hardDateInfo(task, null)) return null;
  if (state?.dates_read_at) return null;
  const afterCreation = calendarDaysUntilDue(task.due_date, task.created_at);
  if (afterCreation >= DATE_READ.inventedMinDays && afterCreation <= DATE_READ.inventedMaxDays) return 'set_aside';
  if (calendarDaysUntilDue(task.due_date, now) < -DATE_READ.deadPastDays) return 'set_aside';
  return 'read';
}

export function planDates(tasks: readonly RawTask[], states: readonly RawItemState[], now: Date): KeeperDateChange[] {
  const byKey = new Map(states.map((s) => [s.item_key, s]));
  const out: KeeperDateChange[] = [];
  for (const t of tasks) {
    const key = taskKey(t.id);
    const outcome = classifyDate(t, byKey.get(key), now);
    if (!outcome || !t.due_date) continue;
    out.push({
      item_key: key,
      title: t.title,
      outcome,
      due_date: dueYmd(t.due_date),
      client_facing: t.client !== null,
    });
  }
  return out;
}
