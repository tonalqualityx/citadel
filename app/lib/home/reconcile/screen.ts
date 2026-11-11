/**
 * Home Slice 9a: what the home screen reads for his sent-mail cards and notes. Read only, for the one user.
 *  - cards: his open cards (state open, not past their two weeks) whose task is still open (and still his, for done and waiting).
 *    A card whose task closed another way goes quietly (it is left out; it is marked expired the next time it is tapped or swept).
 *  - lines: the Handled for you lines for 72 hours: each automatic note (Undo and "This was wrong"), and a task marked done from a card
 *    with no time on it ("Log time? 30 min").
 */
import type { PrismaClient } from '@prisma/client';
import type { RawReconcileCard, RawReconcileLine } from '../types';
import { OPEN_TASK_STATUSES } from './load';
import { clampMinutes } from './estimate';

const LINE_MS = 72 * 3600 * 1000;
const CARD_KINDS = ['done', 'note', 'waiting', 'session', 'wait', 'track'] as const;

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

export async function loadReconcile(db: PrismaClient, userId: string, now: Date): Promise<{ cards: RawReconcileCard[]; lines: RawReconcileLine[] }> {
  const rows = await db.homeReconcileChange.findMany({
    where: { user_id: userId, mode: 'card', state: 'open', OR: [{ shown_until: null }, { shown_until: { gt: now } }] },
    select: {
      id: true,
      kind: true,
      title: true,
      lines: true,
      reason: true,
      link: true,
      created_at: true,
      plan: true,
      minutes_estimate: true,
      estimate_basis: true,
      quote_to: true,
      quote_at: true,
      target_key: true,
      message: { select: { lookback: true } },
    },
    orderBy: { created_at: 'desc' },
    take: 80,
  });
  const taskIds = rows.map((r) => (r.target_key && r.target_key.startsWith('task:') ? r.target_key.slice(5) : null)).filter((x): x is string => !!x);
  const live = taskIds.length
    ? await db.task.findMany({ where: { id: { in: taskIds }, is_deleted: false, status: { in: [...OPEN_TASK_STATUSES] } }, select: { id: true, assignee_id: true } })
    : [];
  const liveById = new Map(live.map((t) => [t.id, t.assignee_id]));
  const cards: RawReconcileCard[] = [];
  for (const r of rows) {
    if (!(CARD_KINDS as readonly string[]).includes(r.kind)) continue;
    const tid = r.target_key && r.target_key.startsWith('task:') ? r.target_key.slice(5) : null;
    if (tid) {
      if (!liveById.has(tid)) continue;
      if ((r.kind === 'done' || r.kind === 'waiting') && liveById.get(tid) !== userId) continue;
    }
    cards.push({
      id: r.id,
      kind: r.kind as RawReconcileCard['kind'],
      title: r.title,
      lines: strList(r.lines),
      reason: r.reason,
      link: r.link,
      created_at: r.created_at,
      look_back: r.message?.lookback === true,
      plan: asObj(r.plan),
      minutes_estimate: r.minutes_estimate,
      estimate_basis: r.estimate_basis,
      who: r.quote_to,
      quote_at: r.quote_at,
    });
  }

  const actionRows = await db.homeAction.findMany({
    where: {
      user_id: userId,
      created_at: { gte: new Date(now.getTime() - LINE_MS) },
      undone_at: null,
      OR: [{ source: 'reconcile', action: 'reconcile_note' }, { action: 'reconcile_card_yes' }],
    },
    select: { id: true, action: true, before: true, after: true, created_at: true, undo_until: true, source: true },
    orderBy: { created_at: 'desc' },
    take: 60,
  });
  const lines: RawReconcileLine[] = [];
  const doneCandidates: { row: (typeof actionRows)[number]; taskId: string; title: string }[] = [];
  for (const r of actionRows) {
    const after = asObj(r.after);
    const rec = asObj(after.reconcile);
    if (r.action === 'reconcile_note' && r.source === 'reconcile') {
      const text = typeof after.line === 'string' ? after.line.trim() : '';
      if (!text) continue;
      lines.push({ id: r.id, text, details: strList(after.details), link: typeof after.link === 'string' ? after.link : null, at: r.created_at, undo_until: r.undo_until, note: true, time_prompt: null });
    } else if (r.action === 'reconcile_card_yes' && rec.kind === 'done' && rec.time_entry_id === null && typeof rec.task_id === 'string') {
      doneCandidates.push({ row: r, taskId: rec.task_id, title: '' });
    }
  }
  if (doneCandidates.length > 0) {
    const ids = doneCandidates.map((d) => d.taskId);
    const [tasks, withTime] = await Promise.all([
      db.task.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, estimated_minutes: true } }),
      db.timeEntry.groupBy({ by: ['task_id'], where: { task_id: { in: ids }, is_deleted: false }, _count: { _all: true } }),
    ]);
    const timed = new Set(withTime.map((t) => t.task_id));
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const d of doneCandidates) {
      const t = byId.get(d.taskId);
      if (!t || timed.has(t.id)) continue;
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d.row.created_at);
      lines.push({
        id: d.row.id,
        text: `Marked "${t.title.replace(/\s+/g, ' ').slice(0, 90)}" done from your email card.`,
        details: [],
        link: null,
        at: d.row.created_at,
        undo_until: d.row.undo_until,
        note: false,
        time_prompt: { task_id: t.id, minutes: clampMinutes(t.estimated_minutes), day },
      });
    }
  }
  lines.sort((a, b) => b.at.getTime() - a.at.getTime());
  return { cards, lines };
}
