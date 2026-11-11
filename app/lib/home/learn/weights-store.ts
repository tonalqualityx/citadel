/**
 * Slice 7b: the weight rows. Every query is scoped to one user, and nothing here touches a Task, Arc, EmailAsk, Wait,
 * Decision or Project row (reads only). This is a leaf module (it imports no other home code but state.ts, evidence.ts
 * and the pure learn files) so act.ts and load.ts can use it without a cycle.
 */

import type { PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { parseItemKey } from '../item-key';
import { hasClientBlockingTag, hasLifelineTag, hasSecurityTag } from '../rules';
import { appendHomeAction, type HomeDb } from '../state';
import type { WeightRow } from './apply';
import { cleanLabel, learnedDetails, learnedLine, LEARNED_ACTION } from './copy';
import { evidenceKeys, evidenceKindOf, evidenceLabel, typeLabel, type EvidenceKind } from './evidence';
import { SIGNAL_ACTIONS, type ResolvedEvidence, type TapRow } from './signals';
import { WEIGHT, type CurrentWeight, type Shift } from './weights';
import { ymdInZone } from './working-hours';

const DAY_MS = 24 * 3600 * 1000;
const TAP_TAKE = 5000;
const RESOLVE_TAKE = 2000;

export const PUT_BACK_ACTION = 'weight_put_back';
/** Undo of a Put back stays open this long (the same 24 hours as his other taps). */
const PUT_BACK_UNDO_HOURS = 24;

// ============================================================================
// Reads
// ============================================================================

/** Learning is on unless the owner's settings row says off. A missing row means on. */
export async function learningOn(db: HomeDb, userId: string): Promise<boolean> {
  const row = await db.homeKeeperSettings.findUnique({ where: { user_id: userId }, select: { learn_weights: true } });
  return row ? row.learn_weights : true;
}

/** The weights the screen applies: every row not at 100. */
export async function loadWeights(db: HomeDb, userId: string): Promise<WeightRow[]> {
  const rows = await db.homeScoreWeight.findMany({
    where: { user_id: userId, weight_pct: { not: WEIGHT.start } },
    select: { evidence_key: true, label: true, weight_pct: true },
    orderBy: { evidence_key: 'asc' },
  });
  return rows;
}

/** Every weight row (also those at 100 and held), keyed by evidence. */
export async function loadCurrentWeights(db: HomeDb, userId: string): Promise<Map<string, CurrentWeight>> {
  const rows = await db.homeScoreWeight.findMany({ where: { user_id: userId }, select: { evidence_key: true, weight_pct: true, held_until: true } });
  return new Map(rows.map((r) => [r.evidence_key, { weight_pct: r.weight_pct, held_until: r.held_until }]));
}

/** Whole days from his first home tap (source home) to now; 0 when there is none. */
export async function historyDays(db: HomeDb, userId: string, now: Date): Promise<number> {
  const first = await db.homeAction.findFirst({ where: { user_id: userId, source: 'home' }, orderBy: { created_at: 'asc' }, select: { created_at: true } });
  return first ? Math.max(0, Math.floor((now.getTime() - first.created_at.getTime()) / DAY_MS)) : 0;
}

/** His taps of the signal kinds in the last `days` days (source home). Undone ones are marked, not dropped. */
export async function loadTaps(db: HomeDb, userId: string, now: Date, tz: string, days: number): Promise<TapRow[]> {
  const rows = await db.homeAction.findMany({
    where: { user_id: userId, source: 'home', action: { in: [...SIGNAL_ACTIONS] }, created_at: { gte: new Date(now.getTime() - days * DAY_MS) } },
    select: { item_key: true, action: true, after: true, undone_at: true, created_at: true },
    orderBy: { created_at: 'asc' },
    take: TAP_TAKE,
  });
  return rows.map((r) => {
    const origin = r.after && typeof r.after === 'object' && !Array.isArray(r.after) ? (r.after as Record<string, unknown>).origin : null;
    return {
      item_key: r.item_key,
      action: r.action,
      origin: typeof origin === 'string' ? origin : null,
      day: ymdInZone(r.created_at, tz),
      source: 'home',
      undone: r.undone_at !== null,
    };
  });
}

export interface ResolvedSet {
  evidence: Map<string, ResolvedEvidence>;
  /** Evidence key to its label, for the rows a shift will write. */
  labels: Map<string, string>;
}

/**
 * The evidence of each item key, rebuilt from the source rows (a closed task keeps its client, project and SOP; a thread
 * keeps its asks). A key whose row is gone, and a task not assigned to the owner (a bot's task), resolve to nothing.
 */
export async function resolveEvidence(db: HomeDb, userId: string, itemKeys: readonly string[]): Promise<ResolvedSet> {
  const evidence = new Map<string, ResolvedEvidence>();
  const labels = new Map<string, string>();
  const unique = Array.from(new Set(itemKeys)).slice(0, RESOLVE_TAKE);

  const taskIds: string[] = [];
  const waitIds: string[] = [];
  const projectIdsForKey = new Map<string, string>(); // item key -> project id (review, step)
  const sessionIds = new Map<string, string>(); // item key -> external id
  const threads = new Map<string, { account: string; thread_id: string }>();
  for (const k of unique) {
    const p = parseItemKey(k);
    if (!p) continue;
    if (p.kind === 'task') taskIds.push(p.id);
    else if (p.kind === 'wait') waitIds.push(p.id);
    else if (p.kind === 'review' && p.project_id) projectIdsForKey.set(k, p.project_id);
    else if (p.kind === 'step') projectIdsForKey.set(k, p.project_id);
    else if (p.kind === 'session') sessionIds.set(k, p.external_id);
    else if (p.kind === 'thread') threads.set(k, { account: p.account, thread_id: p.thread_id });
  }

  const [tasks, waits, projects, sessions] = await Promise.all([
    taskIds.length
      ? db.task.findMany({ where: { id: { in: taskIds }, assignee_id: userId }, select: { id: true, client_id: true, project_id: true, sop_id: true, tags: true } })
      : Promise.resolve([]),
    waitIds.length ? db.wait.findMany({ where: { id: { in: waitIds } }, select: { id: true, client_id: true, project_id: true } }) : Promise.resolve([]),
    projectIdsForKey.size
      ? db.project.findMany({ where: { id: { in: Array.from(new Set(projectIdsForKey.values())) } }, select: { id: true, client_id: true } })
      : Promise.resolve([]),
    sessionIds.size
      ? db.oracleSession.findMany({
          where: { external_id: { in: Array.from(sessionIds.values()) } },
          select: { external_id: true, last_event_at: true, updated_at: true, arc: { select: { client_id: true, project_id: true } } },
        })
      : Promise.resolve([]),
  ]);

  const threadHits = new Map<string, { client_id: string | null; project_id: string | null; sender: string; sales: boolean }>();
  for (const [k, t] of threads) {
    const ask = await db.emailAsk.findFirst({
      where: { account: t.account, OR: [{ thread_id: t.thread_id }, { thread_id: null, message_id: t.thread_id }] },
      orderBy: { received_at: 'desc' },
      select: { client_id: true, project_id: true, from_email: true, intent: true },
    });
    if (ask) threadHits.set(k, { client_id: ask.client_id, project_id: ask.project_id, sender: ask.from_email, sales: ask.intent === 'sales' });
  }

  const projectClient = new Map(projects.map((p) => [p.id, p.client_id]));
  const sessionByExternal = new Map<string, (typeof sessions)[number]>();
  for (const s of sessions) {
    const cur = sessionByExternal.get(s.external_id);
    if (!cur || (s.last_event_at ?? s.updated_at) > (cur.last_event_at ?? cur.updated_at)) sessionByExternal.set(s.external_id, s);
  }
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const waitById = new Map(waits.map((w) => [w.id, w]));

  const clientIds = new Set<string>();
  const projectIds = new Set<string>();
  const sopIds = new Set<string>();
  const put = (itemKey: string, kind: Parameters<typeof evidenceKeys>[0]['kind'], c: string | null, p: string | null, sop: string | null, sender: string | null, prot: boolean) => {
    const keys = evidenceKeys({ kind, client_id: c, project_id: p, sop_id: sop, sender });
    if (keys.length === 0) return;
    evidence.set(itemKey, { keys, protected: prot });
    if (c) clientIds.add(c);
    if (p) projectIds.add(p);
    if (sop) sopIds.add(sop);
    for (const key of keys) if (key.startsWith('sender:')) labels.set(key, evidenceLabel('sender', key.slice(7)));
  };

  for (const k of unique) {
    const p = parseItemKey(k);
    if (!p) continue;
    if (p.kind === 'task') {
      const t = taskById.get(p.id);
      if (t) put(k, 'task', t.client_id, t.project_id, t.sop_id, null, hasSecurityTag(t.tags) || hasLifelineTag(t.tags) || hasClientBlockingTag(t.tags));
    } else if (p.kind === 'wait') {
      const w = waitById.get(p.id);
      if (w) put(k, 'wait', w.client_id, w.project_id, null, null, false);
    } else if (p.kind === 'review') {
      const pid = p.project_id;
      if (pid) put(k, 'review', projectClient.get(pid) ?? null, pid, null, null, false);
      else put(k, 'review', null, null, null, null, false);
    } else if (p.kind === 'step') {
      put(k, 'step', projectClient.get(p.project_id) ?? null, p.project_id, null, null, false);
    } else if (p.kind === 'session') {
      const s = sessionByExternal.get(p.external_id);
      if (s) put(k, 'session', s.arc?.client_id ?? null, s.arc?.project_id ?? null, null, null, false);
    } else if (p.kind === 'thread') {
      const h = threadHits.get(k);
      if (h) put(k, 'thread', h.client_id, h.project_id, null, h.sender, h.sales);
    }
  }

  const [clients, projs, sops] = await Promise.all([
    clientIds.size ? db.client.findMany({ where: { id: { in: Array.from(clientIds) } }, select: { id: true, name: true } }) : Promise.resolve([]),
    projectIds.size ? db.project.findMany({ where: { id: { in: Array.from(projectIds) } }, select: { id: true, name: true } }) : Promise.resolve([]),
    sopIds.size ? db.sop.findMany({ where: { id: { in: Array.from(sopIds) } }, select: { id: true, title: true } }) : Promise.resolve([]),
  ]);
  for (const c of clients) labels.set(`client:${c.id}`, cleanLabel(evidenceLabel('client', c.name)));
  for (const p of projs) labels.set(`project:${p.id}`, cleanLabel(evidenceLabel('project', p.name)));
  for (const s of sops) labels.set(`sop:${s.id}`, cleanLabel(evidenceLabel('sop', s.title)));
  for (const ev of evidence.values()) for (const key of ev.keys) if (key.startsWith('type:')) labels.set(key, typeLabel(key) ?? key);
  return { evidence, labels };
}

// ============================================================================
// Writes
// ============================================================================

/** One weight, as recorded on an action row's before and after sides. */
export interface WeightRecord {
  evidence_key: string;
  weight_pct: number;
  held_until: string | null;
  /** What Undo does with the hold: 'hold' (30 days from the undo) or 'restore' (back to held_until). */
  on_undo?: 'hold' | 'restore';
}

export function weightRecords(v: unknown): WeightRecord[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  const w = (v as Record<string, unknown>).weights;
  if (!Array.isArray(w)) return [];
  const out: WeightRecord[] = [];
  for (const r of w) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.evidence_key !== 'string' || typeof o.weight_pct !== 'number') continue;
    out.push({
      evidence_key: o.evidence_key,
      weight_pct: o.weight_pct,
      held_until: typeof o.held_until === 'string' ? o.held_until : null,
      on_undo: o.on_undo === 'restore' ? 'restore' : 'hold',
    });
  }
  return out;
}

export interface AppliedShift {
  shift: Shift;
  label: string;
  action_id: string;
  line: string;
}

/** Write the shifts: the weight rows and one keeper_learned line each (Undo for 7 days). Runs inside the caller's transaction. */
export async function applyShifts(
  tx: HomeDb,
  userId: string,
  shifts: readonly Shift[],
  labels: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, CurrentWeight>,
  now: Date,
): Promise<AppliedShift[]> {
  const out: AppliedShift[] = [];
  for (const s of shifts) {
    const label = labels.get(s.evidence_key) ?? defaultLabel(s.evidence_key);
    const dir = s.to > s.from ? 'up' : 'down';
    const line = learnedLine(s.evidence_key, label, dir);
    const held = current.get(s.evidence_key)?.held_until?.toISOString() ?? null;
    const rec = (pct: number): { states: never[]; weights: WeightRecord[] } => ({
      states: [],
      weights: [{ evidence_key: s.evidence_key, weight_pct: pct, held_until: held, on_undo: 'hold' }],
    });
    const action = await appendHomeAction(tx, userId, {
      item_key: null,
      action: LEARNED_ACTION,
      source: 'keeper',
      before: rec(s.from),
      after: { ...rec(s.to), line, details: learnedDetails(s.up, s.down) },
      undo_until: new Date(now.getTime() + WEIGHT.undoDays * DAY_MS),
    });
    await tx.homeScoreWeight.upsert({
      where: { user_id_evidence_key: { user_id: userId, evidence_key: s.evidence_key } },
      create: { user_id: userId, evidence_key: s.evidence_key, label, weight_pct: s.to, signals_up: s.up, signals_down: s.down, changed_at: now, changed_by_action_id: action.id },
      update: { label, weight_pct: s.to, signals_up: s.up, signals_down: s.down, changed_at: now, changed_by_action_id: action.id },
    });
    out.push({ shift: s, label, action_id: action.id, line });
  }
  return out;
}

function defaultLabel(key: string): string {
  const kind = evidenceKindOf(key) as EvidenceKind | null;
  return kind ? evidenceLabel(kind, key.slice(key.indexOf(':') + 1)) : key;
}

/**
 * Undo of one weight record, compare-and-set: the weight goes back only if it still holds the value the change wrote.
 * Whatever happens the key is held (30 days from the undo), unless the record says restore (a Put back being undone).
 * Returns true when the weight was put back.
 */
export async function undoWeightRecord(tx: HomeDb, userId: string, before: WeightRecord, after: WeightRecord | undefined, now: Date): Promise<boolean> {
  const hold = new Date(now.getTime() + WEIGHT.holdDays * DAY_MS);
  const held = before.on_undo === 'restore' ? (before.held_until ? new Date(before.held_until) : null) : hold;
  const expected = after ? after.weight_pct : null;
  let restored = false;
  if (expected !== null) {
    const res = await tx.homeScoreWeight.updateMany({
      where: { user_id: userId, evidence_key: before.evidence_key, weight_pct: expected },
      data: { weight_pct: before.weight_pct, held_until: held },
    });
    restored = res.count === 1;
  }
  if (!restored) {
    // The weight moved on since (or the row is gone). Leave it, and still hold the key.
    await tx.homeScoreWeight.updateMany({ where: { user_id: userId, evidence_key: before.evidence_key }, data: { held_until: hold } });
  }
  return restored;
}

/** "Put back": the weight goes to 100 and the key is held 30 days. Own action row (source home), Undo for 24 hours. */
export async function putBack(db: PrismaClient, userId: string, evidenceKey: string, now: Date): Promise<{ action_id: string; undo_until: string }> {
  return db.$transaction(async (tx) => {
    const row = await tx.homeScoreWeight.findUnique({ where: { user_id_evidence_key: { user_id: userId, evidence_key: evidenceKey } } });
    if (!row || row.weight_pct === WEIGHT.start) throw new ApiError('That is not something the home screen learned.', 404, 'not_found');
    const hold = new Date(now.getTime() + WEIGHT.holdDays * DAY_MS);
    const undoUntil = new Date(now.getTime() + PUT_BACK_UNDO_HOURS * 3600 * 1000);
    const priorHeld = row.held_until ? row.held_until.toISOString() : null;
    const action = await appendHomeAction(tx, userId, {
      item_key: null,
      action: PUT_BACK_ACTION,
      source: 'home',
      before: { states: [], weights: [{ evidence_key: evidenceKey, weight_pct: row.weight_pct, held_until: priorHeld, on_undo: 'restore' }] },
      after: { states: [], weights: [{ evidence_key: evidenceKey, weight_pct: WEIGHT.start, held_until: hold.toISOString() }] },
      undo_until: undoUntil,
    });
    const res = await tx.homeScoreWeight.updateMany({
      where: { id: row.id, weight_pct: row.weight_pct },
      data: { weight_pct: WEIGHT.start, held_until: hold, changed_at: now, changed_by_action_id: action.id },
    });
    if (res.count !== 1) throw new ApiError('That changed just now. Reload and try again.', 409, 'conflict');
    return { action_id: action.id, undo_until: undoUntil.toISOString() };
  });
}

/** The "Learn from my taps" switch. Creates the owner's settings row if there is none (the other switches keep their defaults, off). */
export async function setLearning(db: HomeDb, userId: string, on: boolean): Promise<boolean> {
  const row = await db.homeKeeperSettings.upsert({
    where: { user_id: userId },
    create: { user_id: userId, learn_weights: on },
    update: { learn_weights: on },
    select: { learn_weights: true },
  });
  return row.learn_weights;
}
