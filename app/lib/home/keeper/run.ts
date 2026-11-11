/**
 * Slice 2a keeper: run it for the owner. The only writes are the owner's home_item_state rows, home_actions rows with
 * source 'keeper' and one home_keeper_runs row. It never touches an EmailAsk, Wait, Comment or Notification and never
 * sends anything. The one exception is Slice 2c (keeper/arcs.ts): Arc rows and Task.arc_id on his own tasks, each write
 * behind its own switch in home_keeper_settings (all off with no row, and then nothing of 2c runs).
 *
 * Dry run: plan only, nothing written. Real run: one transaction (30 s): take the day's run row, write each change
 * guarded on the value the plan saw (a row that changed meanwhile is skipped), append one home_actions row per kind
 * with before, after, line and details in the shape runHomeUndo reads, write counts, mark the run finished.
 */

import type { PrismaClient } from '@prisma/client';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';
import { KEEPER } from '../rules';
import { zonedDateString } from '../act';
import { parseItemKey } from '../item-key';
import { loadHomeInputs } from '../load';
import { appendHomeAction, dateOnly, loadItemStates, type HomeDb } from '../state';
import type { KeeperActionKind, KeeperDateChange, KeeperPlan, KeeperResult, KeeperStaggerChange, RawItemState } from '../types';
import { DATE_READ } from '../rules';
import { keeperLines } from './lines';
import { planKeeper } from './plan';
import { applyArcs, loadArcSwitches, planArcs, type ArcPlan } from './arcs';

const HOUR_MS = 3_600_000;
/** A run row left unfinished this long may be taken over. */
export const RUN_STALE_MS = HOUR_MS;
const RUN_KIND = 'nightly';
const TX_TIMEOUT_MS = 30_000;

export interface RunKeeperOptions {
  dryRun: boolean;
}

type Fields = Record<string, string | null>;
interface UndoRecord {
  item_key: string;
  existed: boolean;
  fields: Fields;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Whether the owner may have a run: an active admin whose home_view is 'home'. */
export async function ownerOnHome(db: HomeDb, ownerId: string): Promise<{ ok: boolean; timezone: string }> {
  const user = await db.user.findUnique({
    where: { id: ownerId },
    select: { is_active: true, role: true, preferences: { select: { home_view: true, timezone: true } } },
  });
  const pref = user?.preferences;
  const ok = !!user && user.is_active && user.role === 'admin' && pref?.home_view === 'home';
  return { ok, timezone: pref?.timezone || DEFAULT_DISPLAY_TIMEZONE };
}

/** Keep only changes on tasks assigned to the owner (the loader already filters; this is the second lock). */
async function ownTasksOnly(db: HomeDb, ownerId: string, plan: KeeperPlan): Promise<KeeperPlan> {
  const keys = new Set([...plan.stagger.map((s) => s.item_key), ...plan.dates.map((d) => d.item_key)]);
  const ids: string[] = [];
  for (const k of keys) {
    const p = parseItemKey(k);
    if (p && p.kind === 'task') ids.push(p.id);
  }
  const rows = ids.length
    ? await db.task.findMany({ where: { id: { in: ids }, assignee_id: ownerId, is_deleted: false }, select: { id: true } })
    : [];
  const mine = new Set(rows.map((r) => `task:${r.id}`));
  return rebuild(plan, plan.stagger.filter((s) => mine.has(s.item_key)), plan.dates.filter((d) => mine.has(d.item_key)));
}

function rebuild(plan: KeeperPlan, stagger: KeeperStaggerChange[], dates: KeeperDateChange[]): KeeperPlan {
  const next: KeeperPlan = {
    ...plan,
    stagger,
    dates,
    counts: {
      stagger: stagger.length,
      dates_read: dates.filter((d) => d.outcome === 'read').length,
      dates_set_aside: dates.filter((d) => d.outcome === 'set_aside').length,
    },
    lines: [],
  };
  next.lines = keeperLines(next);
  return next;
}

/** Plan for the owner as of `now`, no writes. Null when the owner is not on the home view. */
async function buildPlan(db: PrismaClient, ownerId: string, now: Date, timezone: string) {
  const [raw, states] = await Promise.all([loadHomeInputs(db, ownerId, now, { timezone }), loadItemStates(db, ownerId)]);
  const plan = await ownTasksOnly(db, ownerId, planKeeper(raw, states, now, timezone));
  return { plan, states, raw };
}

export async function runKeeper(db: PrismaClient, ownerId: string, now: Date, opts: RunKeeperOptions): Promise<KeeperResult> {
  const { ok, timezone } = await ownerOnHome(db, ownerId);
  if (!ok) return { dry_run: opts.dryRun, skipped: 'home_off', action_ids: [] };

  if (opts.dryRun) {
    const { plan, states, raw } = await buildPlan(db, ownerId, now, timezone);
    // Slice 2c: what the arc rules would do, shown whatever the switches say, written never.
    const [switches, arcPlan] = await Promise.all([
      loadArcSwitches(db, ownerId),
      planArcs(db, ownerId, raw, states, now, zonedDateString(now, timezone)),
    ]);
    return {
      dry_run: true,
      plan,
      arcs: { switches, would_make: arcPlan.make ? [arcPlan.make] : [], would_close: arcPlan.close.map((c) => ({ arc_id: c.arc_id, name: c.name, reason: c.reason, open_tasks: c.open_tasks, line: c.line })) },
      action_ids: [],
    };
  }

  const date = zonedDateString(now, timezone);
  const runDate = dateOnly(date);
  const runKey = { user_id_date_kind: { user_id: ownerId, date: runDate, kind: RUN_KIND } };

  // Cheap early answer before the heavy reads.
  const prior = await db.homeKeeperRun.findUnique({ where: runKey, select: { finished_at: true, started_at: true } });
  if (prior && (prior.finished_at || now.getTime() - prior.started_at.getTime() < RUN_STALE_MS)) {
    return { dry_run: false, already_ran: true, action_ids: [] };
  }

  const { plan: wanted, states, raw } = await buildPlan(db, ownerId, now, timezone);
  const stateByKey = new Map(states.map((s) => [s.item_key, s]));
  const dueByKey = new Map(raw.tasks.map((t) => [`task:${t.id}`, t.due_date]));

  // Slice 2c: with every switch off nothing below runs, so the run is exactly what it was before 2c.
  const wanted2c = await loadArcSwitches(db, ownerId);
  const arcsOn = wanted2c.arcs_create || wanted2c.arcs_close;
  const arcPlan: ArcPlan | null = arcsOn
    ? await planArcs(db, ownerId, raw, states, now, date, { make: wanted2c.arcs_create, close: wanted2c.arcs_close })
    : null;

  return db.$transaction(
    async (tx): Promise<KeeperResult> => {
      // 1. Take the run row.
      const row = await tx.homeKeeperRun.findUnique({ where: runKey });
      if (row) {
        if (row.finished_at || now.getTime() - row.started_at.getTime() < RUN_STALE_MS) {
          return { dry_run: false, already_ran: true, action_ids: [] };
        }
        const taken = await tx.homeKeeperRun.updateMany({
          where: { id: row.id, finished_at: null, started_at: row.started_at },
          data: { started_at: now, error: null },
        });
        if (taken.count !== 1) return { dry_run: false, already_ran: true, action_ids: [] };
      } else {
        const made = await tx.homeKeeperRun.createMany({
          data: [{ user_id: ownerId, date: runDate, kind: RUN_KIND, started_at: now }],
          skipDuplicates: true,
        });
        if (made.count !== 1) return { dry_run: false, already_ran: true, action_ids: [] };
      }

      // 2. Second lock on the owner's tasks, taken inside the transaction.
      const plan = await ownTasksOnly(tx, ownerId, wanted);

      // 3. Date readings first, then days. Each write is guarded on what the plan saw.
      const created = new Set<string>();
      const appliedDates: KeeperDateChange[] = [];
      const dateBefore: UndoRecord[] = [];
      const dateAfter: UndoRecord[] = [];
      for (const d of plan.dates) {
        const st = stateByKey.get(d.item_key);
        const due = dueByKey.get(d.item_key) ?? null;
        const read = d.outcome === 'read' && due;
        const data = {
          dates_read_at: now,
          ...(read ? { read_hard_due_at: due, read_hard_due_source: DATE_READ.unclearSource } : {}),
        };
        let applied = false;
        if (st) {
          const r = await tx.homeItemState.updateMany({
            where: { user_id: ownerId, item_key: d.item_key, dates_read_at: null },
            data,
          });
          applied = r.count === 1;
        } else {
          const r = await tx.homeItemState.createMany({ data: [{ user_id: ownerId, item_key: d.item_key, ...data }], skipDuplicates: true });
          applied = r.count === 1;
          if (applied) created.add(d.item_key);
        }
        if (!applied) continue;
        appliedDates.push(d);
        dateBefore.push({
          item_key: d.item_key,
          existed: !!st,
          fields: { read_hard_due_at: iso(st?.read_hard_due_at), read_hard_due_source: st?.read_hard_due_source ?? null, dates_read_at: null },
        });
        dateAfter.push({
          item_key: d.item_key,
          existed: true,
          fields: {
            read_hard_due_at: read ? iso(due) : iso(st?.read_hard_due_at),
            read_hard_due_source: read ? DATE_READ.unclearSource : st?.read_hard_due_source ?? null,
            dates_read_at: iso(now),
          },
        });
      }

      const appliedStagger: KeeperStaggerChange[] = [];
      const staggerBefore: UndoRecord[] = [];
      const staggerAfter: UndoRecord[] = [];
      for (const s of plan.stagger) {
        let st: RawItemState | undefined | { view_at: null; view_set_by: null } = stateByKey.get(s.item_key);
        if (!st && created.has(s.item_key)) st = { view_at: null, view_set_by: null };
        const at = new Date(s.view_at);
        let applied = false;
        if (st) {
          const r = await tx.homeItemState.updateMany({
            where: {
              user_id: ownerId,
              item_key: s.item_key,
              view_at: st.view_at,
              view_set_by: st.view_set_by,
              OR: [{ keeper_hold_until: null }, { keeper_hold_until: { lte: now } }],
            },
            data: { view_at: at, view_set_by: 'keeper' },
          });
          applied = r.count === 1;
        } else {
          const r = await tx.homeItemState.createMany({
            data: [{ user_id: ownerId, item_key: s.item_key, view_at: at, view_set_by: 'keeper' }],
            skipDuplicates: true,
          });
          applied = r.count === 1;
        }
        if (!applied) continue;
        appliedStagger.push(s);
        staggerBefore.push({ item_key: s.item_key, existed: !!st, fields: { view_at: iso(st?.view_at), view_set_by: st?.view_set_by ?? null } });
        staggerAfter.push({ item_key: s.item_key, existed: true, fields: { view_at: s.view_at, view_set_by: 'keeper' } });
      }

      // 4. Lines from what really happened, one home_actions row per kind with changes.
      const done = rebuild(plan, appliedStagger, appliedDates);
      const undoUntil = new Date(now.getTime() + KEEPER.undoHours * HOUR_MS);
      const actionIds: string[] = [];
      const byKind: Record<string, { before: UndoRecord[]; after: UndoRecord[] }> = {
        keeper_stagger: { before: staggerBefore, after: staggerAfter },
        keeper_dates: { before: dateBefore, after: dateAfter },
      };
      for (const line of done.lines) {
        const recs = byKind[line.action as KeeperActionKind];
        if (!recs) continue;
        const action = await appendHomeAction(tx, ownerId, {
          item_key: null,
          action: line.action,
          source: 'keeper',
          before: { states: recs.before },
          after: { states: recs.after, line: line.text, details: line.details },
          undo_until: undoUntil,
        });
        actionIds.push(action.id);
      }

      // 4b. Slice 2c: arcs, each write behind its own switch read again here.
      const arcs = arcPlan ? await applyArcs(tx, ownerId, arcPlan, now, date) : null;
      if (arcs) actionIds.push(...arcs.action_ids);

      // 5. Counts, finished.
      await tx.homeKeeperRun.update({
        where: runKey,
        data: {
          finished_at: now,
          counts: {
            ...done.counts,
            skipped_changed: plan.stagger.length + plan.dates.length - appliedStagger.length - appliedDates.length,
            ...(arcs ? { arcs_made: arcs.made.length, arcs_closed: arcs.closed.length } : {}),
          },
        },
      });
      return {
        dry_run: false,
        plan: done,
        ...(arcs ? { arcs_written: { switches: arcs.switches, made: arcs.made, closed: arcs.closed } } : {}),
        action_ids: actionIds,
      };
    },
    { timeout: TX_TIMEOUT_MS },
  );
}
