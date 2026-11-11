/**
 * Slice 2a keeper: the whole plan for one owner at one moment. Pure.
 *
 * Dates are read first and the screen is selected again with those readings in place, so a task whose reading makes
 * it worth showing is not also given a day. Then the days are planned from that second selection.
 */

import { selectHome } from '../select';
import { DATE_READ } from '../rules';
import type { KeeperPlan, RawHomeInputs, RawItemState } from '../types';
import { planDates } from './dates';
import { keeperLines } from './lines';
import { planStagger } from './stagger';
import { zonedDateString } from '../act';
import { taskKey } from '../item-key';

/** The owner's states as they will stand once the date readings are written (never written by this call). */
export function withReadings(states: readonly RawItemState[], raw: RawHomeInputs, now: Date): RawItemState[] {
  const plan = planDates(raw.tasks, states, now);
  const reads = new Map(plan.filter((d) => d.outcome === 'read').map((d) => [d.item_key, d]));
  const dueOf = new Map(raw.tasks.map((t) => [taskKey(t.id), t.due_date]));
  const done = new Set(plan.map((d) => d.item_key));
  const out: RawItemState[] = states.map((s) => {
    if (!done.has(s.item_key)) return s;
    const r = reads.get(s.item_key);
    const due = dueOf.get(s.item_key);
    return { ...s, dates_read_at: now, read_hard_due_at: r && due ? due : s.read_hard_due_at, read_hard_due_source: r ? DATE_READ.unclearSource : s.read_hard_due_source };
  });
  const have = new Set(states.map((s) => s.item_key));
  for (const d of plan) {
    if (have.has(d.item_key)) continue;
    const due = dueOf.get(d.item_key) ?? null;
    out.push({
      item_key: d.item_key,
      park_count: 0,
      view_at: null,
      boosted_at: null,
      not_emergency_at: null,
      working_since: null,
      left_off_note: null,
      arc_added_at: null,
      arc_added_group: null,
      arc_removed_at: null,
      arc_removed_group: null,
      first_seen_at: now,
      last_shown_at: null,
      view_set_by: null,
      keeper_hold_until: null,
      read_hard_due_at: d.outcome === 'read' ? due : null,
      read_hard_due_source: d.outcome === 'read' ? DATE_READ.unclearSource : null,
      dates_read_at: now,
      card_summary: null,
      card_checklist: null,
      card_summary_hash: null,
      card_summary_at: null,
    });
  }
  return out;
}

export function planKeeper(raw: RawHomeInputs, states: readonly RawItemState[], now: Date, tz: string): KeeperPlan {
  const dates = planDates(raw.tasks, states, now);
  const after = withReadings(states, raw, now);
  const sel = selectHome({ raw, states: after, now });
  const stagger = planStagger(sel, after, now, tz);
  const date = zonedDateString(now, tz);
  const plan: KeeperPlan = {
    owner_id: raw.user_id,
    date,
    stagger,
    dates,
    lines: [],
    counts: {
      stagger: stagger.length,
      dates_read: dates.filter((d) => d.outcome === 'read').length,
      dates_set_aside: dates.filter((d) => d.outcome === 'set_aside').length,
    },
  };
  plan.lines = keeperLines(plan);
  return plan;
}

